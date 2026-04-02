import { Router } from 'express';
import http from 'http';
import https from 'https';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import type { ApiResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

router.all('/:id/proxy/*', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(403).json({ ok: false, error: 'Access denied' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(409).json({ ok: false, error: 'Instance not running' } satisfies ApiResponse);
      return;
    }

    const httpBase = instance.controlEndpoint
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');

    // req.params[0] is the wildcard capture after /:id/proxy/
    const params = req.params as unknown as Record<string, string | string[]>;
    const rawSubPathValue = params[0] ?? '';
    const rawSubPath = Array.isArray(rawSubPathValue) ? rawSubPathValue.join('/') : rawSubPathValue;
    const subPath = rawSubPath.startsWith('/') ? rawSubPath : `/${rawSubPath}`;

    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${httpBase}${subPath}${queryString}`;

    // Build forwarded headers
    const forwardedHeaders: Record<string, string | string[]> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (val !== undefined) {
        forwardedHeaders[key] = val as string | string[];
      }
    }
    delete forwardedHeaders['host'];
    delete forwardedHeaders['content-length']; // may be stale after encoding changes
    forwardedHeaders['authorization'] = `Bearer ${instance.authToken}`;
    forwardedHeaders['x-forwarded-for'] = req.ip ?? '';
    forwardedHeaders['x-forwarded-proto'] = req.protocol;
    forwardedHeaders['x-forwarded-host'] = req.hostname;

    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = transport.request(
      targetUrl,
      {
        method: req.method,
        headers: forwardedHeaders,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode ?? 502);

        // Copy headers, strip security headers that block iframes
        const STRIP_HEADERS = new Set([
          'transfer-encoding',
          'x-frame-options',
        ]);
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          const lk = key.toLowerCase();
          if (STRIP_HEADERS.has(lk)) continue;
          if (lk === 'content-security-policy' && typeof val === 'string') {
            // Remove frame-ancestors directive so the gateway UI can be iframed
            const cleaned = val
              .split(';')
              .map(d => d.trim())
              .filter(d => !d.toLowerCase().startsWith('frame-ancestors'))
              .join('; ');
            res.setHeader(key, cleaned);
            continue;
          }
          if (val !== undefined) {
            res.setHeader(key, val as string | string[]);
          }
        }

        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (_err) => {
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: 'Gateway unreachable' } satisfies ApiResponse);
      }
    });

    // Pipe request body for POST/PUT/PATCH
    req.pipe(proxyReq);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
    }
  }
});

export default router;
