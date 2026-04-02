/**
 * Instance Proxy Route
 *
 * Provides a secure HTTP + WebSocket reverse proxy from the platform to
 * a running OpenClaw Gateway instance.
 *
 * Route: /api/instances/:id/ui/*
 *
 * Auth chain:
 *   1. Platform JWT (requireAuth middleware)
 *   2. Ownership check — user must own the instance
 *   3. Inject Gateway auth token as `Authorization: Bearer <authToken>` header
 *
 * Security:
 *   - Only 'running' instances can be proxied
 *   - Request body capped at 1 MB (express.json already in place; raw body limited here)
 *   - Path whitelist: blocks obviously dangerous paths like /../
 *   - Rate limit: 100 req/min per user (simple in-memory counter)
 */

import { Router, Request, Response } from 'express';
import { createServer as createHttpServer, request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import type { ApiResponse, Instance } from '@aquarium/shared';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';

// ── Rate limiter (in-memory, per userId, 100 req / 60s) ──────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── Path sanitisation ─────────────────────────────────────────────────────────

function sanitizePath(rawPath: string): string | null {
  // Must start with /
  const p = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  // Block path traversal
  if (p.includes('..') || p.includes('%2e%2e') || p.includes('%2E%2E')) return null;
  // Block null bytes
  if (p.includes('\0') || p.includes('%00')) return null;
  return p;
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

/**
 * GET/POST/PUT/DELETE/PATCH /api/instances/:id/ui/*
 * Proxy the request to the Gateway HTTP API.
 */
router.all('/:id/ui/*', async (req: Request, res: Response): Promise<void> => {
  if (!checkRateLimit(req.auth!.userId)) {
    res.status(429).json({ ok: false, error: 'Rate limit exceeded' } satisfies ApiResponse);
    return;
  }

  const instanceId = Array.isArray(req.params['id']) ? req.params['id'][0] : req.params['id'];
  let instance;
  try {
    instance = await getInstance(instanceId, req.auth!.userId);
  } catch {
    res.status(500).json({ ok: false, error: 'Failed to load instance' } satisfies ApiResponse);
    return;
  }

  if (!instance) {
    res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
    return;
  }

  if (instance.status !== 'running' || !instance.controlEndpoint) {
    res.status(400).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
    return;
  }

  // Build upstream path — strip the /api/instances/:id/ui prefix
  const suffix = (req.params as Record<string, string>)[0] ?? '';
  const upstreamPath = sanitizePath('/' + suffix + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  if (!upstreamPath) {
    res.status(400).json({ ok: false, error: 'Invalid path' } satisfies ApiResponse);
    return;
  }

  // Parse the control endpoint to determine host/port
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(instance.controlEndpoint);
  } catch {
    res.status(502).json({ ok: false, error: 'Invalid control endpoint' } satisfies ApiResponse);
    return;
  }

  // Build proxy request options
  const isHttps = upstreamUrl.protocol === 'https:';
  const reqFn = isHttps ? httpsRequest : httpRequest;
  const port = upstreamUrl.port || (isHttps ? '443' : '80');

  // Forward request headers, injecting Gateway auth, stripping platform cookies
  const forwardHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    // Strip platform-specific headers
    if (lower === 'cookie' || lower === 'host' || lower === 'connection' || lower === 'transfer-encoding') continue;
    forwardHeaders[key] = value as string | string[] | undefined;
  }
  forwardHeaders['authorization'] = `Bearer ${instance.authToken}`;
  forwardHeaders['host'] = `${upstreamUrl.hostname}:${port}`;
  forwardHeaders['x-forwarded-for'] = req.ip ?? '';
  forwardHeaders['x-forwarded-proto'] = req.protocol;

  // Collect request body
  const bodyChunks: Buffer[] = [];
  let bodySize = 0;
  const MAX_BODY = 1_048_576; // 1 MB

  req.on('data', (chunk: Buffer) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY) {
      res.status(413).json({ ok: false, error: 'Request body too large' } satisfies ApiResponse);
      req.destroy();
      return;
    }
    bodyChunks.push(chunk);
  });

  req.on('end', () => {
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
    if (body) {
      forwardHeaders['content-length'] = String(body.length);
    } else {
      delete forwardHeaders['content-length'];
    }

    const proxyReq = reqFn({
      hostname: upstreamUrl.hostname,
      port,
      path: upstreamPath,
      method: req.method,
      headers: forwardHeaders,
      timeout: 30_000,
    }, (proxyRes: IncomingMessage) => {
      // Strip headers that block iframe embedding — the platform itself
      // serves the iframe so same-origin framing is safe.
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      // Rewrite CSP frame-ancestors to allow our platform origin
      if (typeof headers['content-security-policy'] === 'string') {
        headers['content-security-policy'] = headers['content-security-policy']
          .replace(/frame-ancestors\s+[^;]+/i, "frame-ancestors 'self'");
      }
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: `Gateway unreachable: ${err.message}` } satisfies ApiResponse);
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ ok: false, error: 'Gateway timeout' } satisfies ApiResponse);
      }
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.status(400).json({ ok: false, error: 'Request error' } satisfies ApiResponse);
    }
  });
});

export default router;

// ── WebSocket proxy setup (called from index.ts after server is created) ──────

/**
 * Attach a WebSocket proxy to the HTTP server.
 * Listens for upgrade requests on /api/instances/:id/ui (same path the
 * Gateway Control UI connects to) and tunnels them to the Gateway's
 * WebSocket endpoint.
 *
 * The instanceId is extracted from the URL path.
 * Auth: cookie `token` (same-origin iframe) or `?token=<jwt>` query param.
 */
export function attachWebSocketProxy(
  httpServer: HttpServer,
  getInstanceFn: (id: string, userId: string) => Promise<Instance | null>,
  verifyJwt: (token: string) => Promise<{ userId: string; email: string } | null> | { userId: string; email: string } | null,
): void {
  // We do NOT create a wss — we handle the raw 'upgrade' event ourselves to
  // avoid interference with the existing WebSocket server on the same HTTP server.
  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const match = url.match(/^\/api\/instances\/([^/?]+)\/ui(-ws)?(\/.*)?(?:\?.*)?$/);
    if (!match) return; // not our route

    const instanceId = match[1];
    const pathSuffix = match[3] ?? '/';
    const queryString = (url.includes('?') ? url.slice(url.indexOf('?')) : '');

    // Extract JWT from query param or cookie
    const params = new URLSearchParams(queryString.replace(/^\?/, ''));
    let jwtToken = params.get('token');
    if (!jwtToken && req.headers.cookie) {
      const cookieMatch = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
      if (cookieMatch) jwtToken = cookieMatch[1];
    }
    if (!jwtToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    void (async () => {
      try {
        const auth = await verifyJwt(jwtToken);
        if (!auth) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const instance = await getInstanceFn(instanceId, auth.userId);
        if (!instance || instance.status !== 'running' || !instance.controlEndpoint) {
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
          return;
        }

        if (!checkRateLimit(auth.userId)) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
          socket.destroy();
          return;
        }

        const upstream = new URL(instance.controlEndpoint);
        const wsProto = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
        const targetUrl = `${wsProto}//${upstream.host}${pathSuffix}${queryString}`;

        // Build upgrade headers — inject Gateway auth
        const upgradeHeaders: Record<string, string> = {
          'Authorization': `Bearer ${instance.authToken}`,
        };
        // Forward selected request headers
        for (const [key, value] of Object.entries(req.headers)) {
          const lower = key.toLowerCase();
          if (['host', 'cookie', 'connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version'].includes(lower)) continue;
          if (typeof value === 'string') upgradeHeaders[key] = value;
        }

        const upstreamWs = new WebSocket(targetUrl, {
          headers: upgradeHeaders,
        });

        upstreamWs.on('open', () => {
          // Now perform handshake with the browser socket
          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
            // Bidirectional pipe
            browserWs.on('message', (data, isBinary) => {
              if (upstreamWs.readyState !== WebSocket.OPEN) return;

              // Intercept the Gateway Control UI 'connect' request and inject
              // auth token so the Gateway authenticates via token instead of
              // device pairing (which would require a paired device identity).
              if (!isBinary) {
                try {
                  const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
                  const msg: unknown = JSON.parse(text);
                  if (
                    typeof msg === 'object' && msg !== null &&
                    'type' in msg && (msg as Record<string, unknown>).type === 'req' &&
                    'method' in msg && (msg as Record<string, unknown>).method === 'connect' &&
                    'params' in msg && typeof (msg as Record<string, unknown>).params === 'object'
                  ) {
                    const params = (msg as Record<string, unknown>).params as Record<string, unknown>;
                    // Replace device-based auth with token-based auth
                    delete params.device;
                    params.auth = { token: instance.authToken };
                    const patched = JSON.stringify(msg);
                    upstreamWs.send(patched);
                    return;
                  }
                } catch {
                  // Not valid JSON — forward as-is
                }
              }

              upstreamWs.send(data, { binary: isBinary });
            });
            browserWs.on('close', (code, reason) => {
              const safeCode = code >= 1000 && code <= 4999 ? code : 1000;
              if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
                upstreamWs.close(safeCode, reason);
              }
            });
            browserWs.on('error', () => upstreamWs.close());

            upstreamWs.on('message', (data, isBinary) => {
              if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(data, { binary: isBinary });
              }
            });
            upstreamWs.on('close', (code, reason) => {
              const safeCode = code >= 1000 && code <= 4999 ? code : 1000;
              if (browserWs.readyState === WebSocket.OPEN || browserWs.readyState === WebSocket.CONNECTING) {
                browserWs.close(safeCode, reason);
              }
            });
            upstreamWs.on('error', () => browserWs.close());
          });
        });

        upstreamWs.on('error', (err: Error) => {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          socket.destroy();
        });
      } catch {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    })();
  });
}
