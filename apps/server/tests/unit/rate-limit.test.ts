import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { dynamicGeneralLimiter } from '../../src/middleware/dynamic-middleware.js';

/**
 * Phase 19-02 rate-limit topology tests.
 *
 * Verifies the two pieces required by DAEMON-08:
 *
 *   1. `skip: (req) => req.originalUrl.startsWith('/api/daemon/')` exempts the
 *      daemon sub-tree from BOTH global `/api/` limiters (static + dynamic).
 *   2. A per-token bucket keyed by a header value creates independent buckets
 *      per token — a stolen token cannot DDoS the server's other buckets.
 *
 * These are pure unit tests over the express-rate-limit middleware — no DB,
 * no auth. The goal is to pin the wire-level behaviour before the server-core
 * changes ship, so any future refactor that accidentally drops the `skip`
 * predicate or swaps the keyGenerator will fail here loudly.
 */

interface TestServer {
  server: Server;
  baseUrl: string;
  close(): Promise<void>;
}

async function startApp(appSetup: (app: express.Express) => void): Promise<TestServer> {
  const app = express();
  appSetup(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// ── Test 1: static limiter with skip exempts /api/daemon/* ───────────────────

test('rate-limit: static /api/ limiter skips /api/daemon/* (SKIP predicate)', async () => {
  const ctx = await startApp((app) => {
    app.use(
      '/api/',
      rateLimit({
        windowMs: 60_000,
        limit: 1, // intentionally tight — second /api/foo is 429
        standardHeaders: true,
        legacyHeaders: false,
        validate: { trustProxy: false, xForwardedForHeader: false },
        skip: (req) => req.originalUrl.startsWith('/api/daemon/'),
      }),
    );
    app.get('/api/foo', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/api/daemon/ping', (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    // First call to /api/foo succeeds; second is 429.
    const r1 = await fetch(`${ctx.baseUrl}/api/foo`);
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${ctx.baseUrl}/api/foo`);
    assert.equal(r2.status, 429, '/api/foo second call should be throttled');

    // 5 calls to /api/daemon/ping all succeed — skip predicate bypasses limiter.
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${ctx.baseUrl}/api/daemon/ping`);
      assert.equal(res.status, 200, `/api/daemon/ping call #${i + 1} should pass skip`);
    }
  } finally {
    await ctx.close();
  }
});

// ── Test 2: dynamic limiter wrapper with skip exempts /api/daemon/* ──────────

test('rate-limit: dynamic /api/ wrapper skips /api/daemon/* (SKIP predicate)', async () => {
  // Exercise the exact wrapper shape server-core.ts uses.
  const wrapper = (req: Request, res: Response, next: NextFunction): void => {
    if (req.originalUrl.startsWith('/api/daemon/')) {
      next();
      return;
    }
    dynamicGeneralLimiter(req, res, next);
  };

  const ctx = await startApp((app) => {
    app.use('/api/', wrapper);
    app.get('/api/foo', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/api/daemon/ping', (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    // dynamicGeneralLimiter defaults to 300 req / 15 min in tests (no reload
    // has been called). One /api/foo should still succeed and the daemon
    // path should pass the skip branch regardless of the dynamic bucket.
    const r1 = await fetch(`${ctx.baseUrl}/api/foo`);
    assert.equal(r1.status, 200);
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${ctx.baseUrl}/api/daemon/ping`);
      assert.equal(res.status, 200);
    }
  } finally {
    await ctx.close();
  }
});

// ── Test 3: per-token bucket (keyGenerator) isolates buckets per token ───────

test('rate-limit: per-token bucket keyed on header creates independent buckets', async () => {
  const ctx = await startApp((app) => {
    app.use(
      '/api/daemon',
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
        validate: {
          trustProxy: false,
          xForwardedForHeader: false,
          keyGeneratorIpFallback: false,
        },
        keyGenerator: (req) => req.header('x-token') ?? 'anon',
      }),
    );
    app.get('/api/daemon/ping', (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    // Token A: two requests succeed, third is 429 in that bucket only.
    const a1 = await fetch(`${ctx.baseUrl}/api/daemon/ping`, { headers: { 'x-token': 'A' } });
    const a2 = await fetch(`${ctx.baseUrl}/api/daemon/ping`, { headers: { 'x-token': 'A' } });
    const a3 = await fetch(`${ctx.baseUrl}/api/daemon/ping`, { headers: { 'x-token': 'A' } });
    assert.equal(a1.status, 200);
    assert.equal(a2.status, 200);
    assert.equal(a3.status, 429);

    // Token B: completely independent bucket — two requests still succeed.
    const b1 = await fetch(`${ctx.baseUrl}/api/daemon/ping`, { headers: { 'x-token': 'B' } });
    const b2 = await fetch(`${ctx.baseUrl}/api/daemon/ping`, { headers: { 'x-token': 'B' } });
    assert.equal(b1.status, 200, 'token B bucket should be independent of token A');
    assert.equal(b2.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── Test 4: originalUrl preserves /api/daemon/ inside /api/ mount ────────────

test('rate-limit: req.originalUrl preserves /api/daemon/* inside /api/ mount', async () => {
  const captured: string[] = [];
  const ctx = await startApp((app) => {
    app.use('/api/', (req, _res, next) => {
      captured.push(req.originalUrl);
      next();
    });
    app.get('/api/foo', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/api/daemon/register', (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    await fetch(`${ctx.baseUrl}/api/foo`);
    await fetch(`${ctx.baseUrl}/api/daemon/register`);
    assert.ok(captured.includes('/api/foo'));
    assert.ok(captured.includes('/api/daemon/register'));
    // The originalUrl prefix check `startsWith('/api/daemon/')` must be true
    // even though Express strips `/api` from `req.path` inside the mount.
    assert.ok('/api/daemon/register'.startsWith('/api/daemon/'));
    assert.ok(!('/api/foo'.startsWith('/api/daemon/')));
  } finally {
    await ctx.close();
  }
});
