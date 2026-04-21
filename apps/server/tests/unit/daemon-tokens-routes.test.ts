import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  setupTestDb,
  teardownTestDb,
  seedDaemonToken,
  type TestDbContext,
} from './test-db.js';
import {
  __setDaemonAuthDbForTests__,
  __resetDaemonAuthDb__,
  requireDaemonAuth,
} from '../../src/middleware/daemon-auth.js';
import {
  __setDbForTests__,
  __resetDbForTests__,
} from '../../src/db/index.js';

/**
 * Phase 19-03 daemon-tokens user-route integration tests.
 *
 * Mounts `routes/daemon-tokens.ts` under `/api/daemon-tokens` on a throwaway
 * Express app, pointed at an isolated SQLite fixture via `__setDbForTests__`
 * (so the real `requireAuth` — which reads `db('users')` — can authenticate
 * the seeded test user via the `test:<userId>` cookie path in `auth.ts`).
 *
 * Test matrix (12 tests) — covers:
 *   SC-5 plaintext-once:
 *     1. POST / → 200 with { token, plaintext: 'adt_<32>' }, DB hash matches, created_by_user_id set
 *     2. POST / with expiresAt → DB expires_at populated
 *     3. POST / empty body → 400 "name required"
 *     4. POST / name too long → 400 "name too long"
 *     5. POST / with adt_* bearer + no cookie → 401 (AUTH1 — real requireAuth)
 *
 *   GET no-leak projection:
 *     6. GET / lists 3 tokens, ordered created_at DESC, NO plaintext / token_hash / tokenHash / adt_* in any field
 *     7. GET / filters by workspace ('AQ' only sees AQ tokens, not OTHER)
 *
 *   DELETE revocation:
 *     8. DELETE /:id sets revoked_at
 *     9. DELETE /:id idempotent (second call still 200 { ok: true })
 *    10. DELETE /:id other workspace → 404, row untouched
 *    11. DELETE /:id unknown id → 404
 *
 *   SC-4 revocation SLA (in-process <1000ms):
 *    12. seed token → requireDaemonAuth(bearer) passes → DELETE → requireDaemonAuth(bearer) 401, elapsed < 1000ms
 */

interface TestServer {
  server: Server;
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

async function startTestApp(): Promise<TestServer> {
  // Dynamic import so the router resolves AFTER we call __setDbForTests__.
  const { default: daemonTokensRoutes } = await import(
    '../../src/routes/daemon-tokens.js'
  );
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/daemon-tokens', daemonTokensRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface Ctx {
  db: TestDbContext;
  app: TestServer;
  userId: string;
  cookie: string;
}

async function seedUser(db: TestDbContext['db']): Promise<string> {
  const id = randomUUID();
  await db('users').insert({
    id,
    email: `user-${id.slice(0, 8)}@test.local`,
    password_hash: null,
    display_name: 'Test User',
    role: 'user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

async function bootstrap(): Promise<Ctx> {
  const db = await setupTestDb();
  __setDaemonAuthDbForTests__(db.db);
  __setDbForTests__(db.db);
  const userId = await seedUser(db.db);
  const app = await startTestApp();
  // NODE_ENV is 'test' by default for node:test harness → requireAuth honours
  // `token=test:<userId>` cookie → authenticates as this user.
  const cookie = `token=test:${userId}`;
  return { db, app, userId, cookie };
}

async function shutdown(ctx: Ctx): Promise<void> {
  try {
    await ctx.app.close();
  } catch {
    // ignore
  }
  __resetDaemonAuthDb__();
  __resetDbForTests__();
  await teardownTestDb(ctx.db);
}

async function jsonFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown; rawText: string }> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const rawText = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = null;
  }
  return { status: res.status, body, rawText };
}

// ── Test 1: POST / plaintext-once SC-5 happy path ───────────────────────────

test('daemon-tokens: POST / returns token + plaintext once; DB hash matches (SC-5)', async () => {
  const ctx = await bootstrap();
  try {
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'POST',
      headers: { cookie: ctx.cookie },
      body: { name: 'laptop' },
    });
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      data: {
        token: {
          id: string;
          workspaceId: string;
          name: string;
          daemonId: string | null;
          createdByUserId: string | null;
          revokedAt: string | null;
        };
        plaintext: string;
      };
    };
    assert.equal(body.ok, true);
    assert.ok(body.data.token.id, 'token.id present');
    assert.equal(body.data.token.workspaceId, 'AQ');
    assert.equal(body.data.token.name, 'laptop');
    assert.equal(body.data.token.daemonId, null);
    assert.equal(body.data.token.createdByUserId, ctx.userId, 'createdByUserId = req.auth.userId');
    assert.equal(body.data.token.revokedAt, null);
    assert.match(body.data.plaintext, /^adt_[A-Za-z0-9_-]{32}$/);

    // DB row hash matches the plaintext we received.
    const { hashDaemonToken } = await import('../../src/services/daemon-token-store.js');
    const row = await ctx.db.db('daemon_tokens').where({ id: body.data.token.id }).first();
    assert.ok(row, 'row persisted');
    assert.equal(row.token_hash, hashDaemonToken(body.data.plaintext));
    assert.equal(row.created_by_user_id, ctx.userId);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 2: POST / with expiresAt ───────────────────────────────────────────

test('daemon-tokens: POST / with expiresAt persists expires_at', async () => {
  const ctx = await bootstrap();
  try {
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'POST',
      headers: { cookie: ctx.cookie },
      body: { name: 'laptop', expiresAt },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { token: { id: string; expiresAt: string | null } } };
    assert.equal(body.ok, true);
    assert.equal(body.data.token.expiresAt, expiresAt);

    const row = await ctx.db.db('daemon_tokens').where({ id: body.data.token.id }).first();
    assert.ok(row);
    assert.equal(row.expires_at, expiresAt);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 3: POST / empty body → 400 ─────────────────────────────────────────

test('daemon-tokens: POST / empty body returns 400 "name required"', async () => {
  const ctx = await bootstrap();
  try {
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'POST',
      headers: { cookie: ctx.cookie },
      body: {},
    });
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /name required/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 4: POST / name too long → 400 ──────────────────────────────────────

test('daemon-tokens: POST / name.length > 100 returns 400 "name too long"', async () => {
  const ctx = await bootstrap();
  try {
    const tooLong = 'x'.repeat(101);
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'POST',
      headers: { cookie: ctx.cookie },
      body: { name: tooLong },
    });
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /name too long/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 5: AUTH1 — adt_* bearer + no cookie → 401 ──────────────────────────

test('daemon-tokens: POST / with adt_* bearer and no cookie returns 401 (AUTH1)', async () => {
  const ctx = await bootstrap();
  try {
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer adt_Xyz1234567890AbCdEfGhIjKlMnOpQrStUv',
        // deliberately NO cookie — exercises the real requireAuth AUTH1 path
      },
      body: { name: 'laptop' },
    });
    assert.equal(res.status, 401);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /daemon tokens not accepted on user routes/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 6: GET / no-leak projection ────────────────────────────────────────

test('daemon-tokens: GET / returns projection with no plaintext/tokenHash leak', async () => {
  const ctx = await bootstrap();
  try {
    // Seed 3 tokens with slight delays so created_at ordering is deterministic.
    const a = await seedDaemonToken(ctx.db.db, { name: 'alpha' });
    await new Promise((r) => setTimeout(r, 10));
    const b = await seedDaemonToken(ctx.db.db, { name: 'beta' });
    await new Promise((r) => setTimeout(r, 10));
    const c = await seedDaemonToken(ctx.db.db, { name: 'gamma' });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'GET',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: Array<Record<string, unknown>> };
    assert.equal(body.ok, true);
    assert.equal(body.data.length, 3);

    // Ordered created_at DESC → last inserted (c) first, first inserted (a) last.
    const names = body.data.map((t) => t.name);
    assert.deepEqual(names, ['gamma', 'beta', 'alpha']);

    // No field in the raw response text contains the plaintext, hash, or hash-adjacent names.
    assert.ok(
      !/adt_[A-Za-z0-9_-]{32}/.test(res.rawText),
      `raw response text must not contain any adt_ plaintext. Body: ${res.rawText}`,
    );
    for (const plain of [a.plaintext, b.plaintext, c.plaintext]) {
      assert.ok(
        !res.rawText.includes(plain),
        `raw response text must not contain seeded plaintext ${plain}`,
      );
    }
    // Hash must not be present as either hex value or field name.
    for (const hash of [a.tokenHash, b.tokenHash, c.tokenHash]) {
      assert.ok(
        !res.rawText.includes(hash),
        `raw response text must not contain token_hash ${hash}`,
      );
    }
    assert.ok(
      !/token_hash|tokenHash|plaintext/.test(res.rawText),
      'raw response text must not contain hash/plaintext field names',
    );

    // Expected DaemonToken projection fields present (DAEMON-10 contract).
    for (const t of body.data) {
      assert.ok('id' in t);
      assert.ok('workspaceId' in t);
      assert.ok('name' in t);
      assert.ok('daemonId' in t);
      assert.ok('createdByUserId' in t);
      assert.ok('expiresAt' in t);
      assert.ok('lastUsedAt' in t);
      assert.ok('revokedAt' in t);
      assert.ok('createdAt' in t);
      assert.ok('updatedAt' in t);
    }
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 7: GET / filters by workspace ──────────────────────────────────────

test('daemon-tokens: GET / only returns tokens for the current workspace (AQ)', async () => {
  const ctx = await bootstrap();
  try {
    // Need to pre-seed an OTHER workspace for the FK on daemon_tokens.workspace_id.
    await ctx.db.db('workspaces').insert({
      id: 'OTHER',
      name: 'Other Workspace',
      issue_prefix: 'OTHER',
      issue_counter: 0,
      metadata: JSON.stringify({}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const aq1 = await seedDaemonToken(ctx.db.db, { workspaceId: 'AQ', name: 'aq-1' });
    const aq2 = await seedDaemonToken(ctx.db.db, { workspaceId: 'AQ', name: 'aq-2' });
    await seedDaemonToken(ctx.db.db, { workspaceId: 'OTHER', name: 'other-1' });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens`, {
      method: 'GET',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: Array<{ id: string; name: string; workspaceId: string }> };
    assert.equal(body.ok, true);
    assert.equal(body.data.length, 2);
    const ids = body.data.map((t) => t.id).sort();
    assert.deepEqual(ids, [aq1.id, aq2.id].sort());
    for (const t of body.data) {
      assert.equal(t.workspaceId, 'AQ');
    }
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 8: DELETE /:id sets revoked_at ─────────────────────────────────────

test('daemon-tokens: DELETE /:id sets revoked_at', async () => {
  const ctx = await bootstrap();
  try {
    const { id } = await seedDaemonToken(ctx.db.db, { name: 'to-revoke' });
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { ok: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.data.ok, true);

    const row = await ctx.db.db('daemon_tokens').where({ id }).first('revoked_at');
    assert.ok(row);
    assert.ok(row.revoked_at, 'revoked_at populated');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 9: DELETE /:id idempotent ──────────────────────────────────────────

test('daemon-tokens: DELETE /:id is idempotent (second call still 200 { ok: true })', async () => {
  const ctx = await bootstrap();
  try {
    const { id } = await seedDaemonToken(ctx.db.db);
    const first = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(first.status, 200);
    const second = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(second.status, 200);
    const body = second.body as { ok: boolean; data: { ok: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.data.ok, true);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 10: DELETE /:id cross-workspace → 404, row untouched ──────────────

test('daemon-tokens: DELETE /:id cross-workspace returns 404 and leaves row untouched', async () => {
  const ctx = await bootstrap();
  try {
    await ctx.db.db('workspaces').insert({
      id: 'OTHER',
      name: 'Other Workspace',
      issue_prefix: 'OTHER',
      issue_counter: 0,
      metadata: JSON.stringify({}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const { id } = await seedDaemonToken(ctx.db.db, { workspaceId: 'OTHER', name: 'foreign' });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.status, 404);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /not found/);

    const row = await ctx.db.db('daemon_tokens').where({ id }).first('revoked_at');
    assert.ok(row);
    assert.equal(row.revoked_at, null, 'foreign token NOT revoked');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 11: DELETE /:id unknown id → 404 ───────────────────────────────────

test('daemon-tokens: DELETE /:id unknown id returns 404', async () => {
  const ctx = await bootstrap();
  try {
    const res = await jsonFetch(
      `${ctx.app.baseUrl}/api/daemon-tokens/${randomUUID()}`,
      { method: 'DELETE', headers: { cookie: ctx.cookie } },
    );
    assert.equal(res.status, 404);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /not found/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 12: SC-4 revocation SLA <1000ms ────────────────────────────────────

test('daemon-tokens: revocation invalidates bearer on the next requireDaemonAuth call (<1000ms) (SC-4)', async () => {
  const ctx = await bootstrap();
  try {
    const { id, plaintext } = await seedDaemonToken(ctx.db.db, { name: 'sla-target' });

    // 1. Pre-revoke: requireDaemonAuth(bearer) passes → next() invoked.
    const runAuth = async (): Promise<{ statusCode: number; body: unknown; nextCalled: boolean }> => {
      let statusCode = 200;
      let body: unknown = null;
      let nextCalled = false;
      // Typed minimally — only the surface requireDaemonAuth touches.
      const req = {
        header(name: string): string | undefined {
          return name.toLowerCase() === 'authorization' ? `Bearer ${plaintext}` : undefined;
        },
      } as unknown as import('express').Request;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as unknown as import('express').Response;
      const next = () => {
        nextCalled = true;
      };
      await requireDaemonAuth(req, res, next);
      return { statusCode, body, nextCalled };
    };

    const before = await runAuth();
    assert.equal(before.nextCalled, true, 'bearer valid before revoke');
    assert.equal(before.statusCode, 200);

    // 2. Revoke via HTTP DELETE.
    const startHr = process.hrtime.bigint();
    const del = await jsonFetch(`${ctx.app.baseUrl}/api/daemon-tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(del.status, 200);

    // 3. Immediately re-run the auth — must now 401.
    const after = await runAuth();
    const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

    assert.equal(after.nextCalled, false, 'bearer rejected after revoke');
    assert.equal(after.statusCode, 401);
    const payload = after.body as { ok: boolean; error: string };
    assert.equal(payload.ok, false);
    assert.match(payload.error, /invalid or revoked daemon token/);
    assert.ok(elapsedMs < 1000, `SC-4 revocation SLA: elapsed ${elapsedMs.toFixed(2)}ms must be < 1000ms`);
  } finally {
    await shutdown(ctx);
  }
});
