import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Knex } from 'knex';
import {
  setupTestDb,
  teardownTestDb,
  seedDaemonToken,
} from './test-db.js';
import {
  requireDaemonAuth,
  __setDaemonAuthDbForTests__,
  __resetDaemonAuthDb__,
  DAEMON_TOKEN_PREFIX,
  type DaemonAuthPayload,
} from '../../src/middleware/daemon-auth.js';

/**
 * Phase 19-01 requireDaemonAuth unit tests.
 *
 * Covers DAEMON-07, DAEMON-09, AUTH2, AUTH3, AUTH4:
 *   1. valid token → next() called, req.daemonAuth populated
 *   2. missing header → 401 "daemon token required"
 *   3. wrong scheme (Basic ...) → 401 "daemon token required"
 *   4. wrong prefix (Bearer xyz_...) → 401 "daemon token required"
 *   5. unknown hash → 401 "invalid or revoked daemon token"
 *   6. revoked token → 401 "invalid or revoked daemon token"
 *   7. expired token → 401 "daemon token expired"
 *   8. fire-and-forget last_used_at is updated shortly after next()
 *   9. DB error path → 401 "daemon authentication failed" (never 500)
 *  10. timingSafeEqual length-mismatch guard → 401, no throw
 *
 * Fixtures use a mock req/res/next rather than booting Express; the middleware
 * is intentionally pure (`req.header(name)` is the only call on the Express
 * surface area we rely on).
 */

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: null,
    status(code: number): MockRes {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown): MockRes {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function mockReq(headers: Record<string, string>): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header(name: string): string | undefined {
      return lower[name.toLowerCase()];
    },
  } as unknown as Request;
}

interface NextState {
  called: boolean;
  args: unknown[];
}

function mockNext(): { fn: NextFunction; state: NextState } {
  const state: NextState = { called: false, args: [] };
  const fn: NextFunction = (...args: unknown[]) => {
    state.called = true;
    state.args = args;
  };
  return { fn, state };
}

async function run(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  headers: Record<string, string>,
): Promise<{ req: Request; res: MockRes; next: NextState }> {
  const req = mockReq(headers);
  const res = mockRes();
  const { fn, state } = mockNext();
  await middleware(req, res as unknown as Response, fn);
  return { req, res, next: state };
}

test('valid token → next() called with no args and req.daemonAuth populated', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const seeded = await seedDaemonToken(ctx.db, { workspaceId: 'AQ', name: 'ok' });
    const { req, res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${seeded.plaintext}`,
    });
    assert.equal(res.statusCode, 0, 'no status set');
    assert.equal(res.body, null, 'no body set');
    assert.equal(next.called, true, 'next() invoked');
    assert.equal(next.args.length, 0, 'next() called with no args');
    const payload = (req as Request & { daemonAuth?: DaemonAuthPayload }).daemonAuth;
    assert.ok(payload, 'req.daemonAuth populated');
    assert.equal(payload.tokenId, seeded.id);
    assert.equal(payload.workspaceId, 'AQ');
    assert.equal(payload.daemonId, null);
    assert.equal(payload.tokenHash, seeded.tokenHash);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('missing Authorization header → 401 "daemon token required"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const { res, next } = await run(requireDaemonAuth, {});
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'daemon token required' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('wrong scheme (Basic adt_...) → 401 "daemon token required"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const seeded = await seedDaemonToken(ctx.db, { workspaceId: 'AQ' });
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Basic ${seeded.plaintext}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'daemon token required' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('wrong token prefix → 401 "daemon token required"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const bogus = 'xyz_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${bogus}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'daemon token required' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('unknown (never-issued) hash → 401 "invalid or revoked daemon token"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const unknown = `${DAEMON_TOKEN_PREFIX}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${unknown}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'invalid or revoked daemon token' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('revoked token → 401 "invalid or revoked daemon token"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const seeded = await seedDaemonToken(ctx.db, { workspaceId: 'AQ', revoked: true });
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${seeded.plaintext}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'invalid or revoked daemon token' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('expired token → 401 "daemon token expired"', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const expiredIso = new Date(Date.now() - 1000).toISOString();
    const seeded = await seedDaemonToken(ctx.db, {
      workspaceId: 'AQ',
      expiresAt: expiredIso,
    });
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${seeded.plaintext}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'daemon token expired' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('last_used_at is fire-and-forget — populated shortly after next()', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    const seeded = await seedDaemonToken(ctx.db, { workspaceId: 'AQ' });
    const { next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${seeded.plaintext}`,
    });
    assert.equal(next.called, true, 'middleware called next() synchronously');

    // Poll up to 500ms for the fire-and-forget update to land.
    const deadline = Date.now() + 500;
    let lastUsed: unknown = null;
    while (Date.now() < deadline) {
      const row = await ctx.db('daemon_tokens').where({ id: seeded.id }).first();
      if (row?.last_used_at) {
        lastUsed = row.last_used_at;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(lastUsed, 'last_used_at populated within 500ms');
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});

test('DB error → 401 "daemon authentication failed" (never 500)', async () => {
  const throwingDb = (() => {
    const fn = () => ({
      where: () => ({
        whereNull: () => ({
          first: async () => {
            throw new Error('simulated DB failure');
          },
        }),
      }),
    });
    return fn as unknown as Knex;
  })();
  __setDaemonAuthDbForTests__(throwingDb);
  try {
    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${DAEMON_TOKEN_PREFIX}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    });
    assert.equal(res.statusCode, 401, 'never 500, never 403');
    assert.deepEqual(res.body, { ok: false, error: 'daemon authentication failed' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
  }
});

test('timingSafeEqual length-mismatch guard → 401 without ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH', async () => {
  const ctx = await setupTestDb();
  __setDaemonAuthDbForTests__(ctx.db);
  try {
    // Compute the hash we EXPECT the middleware to produce, then plant a row
    // whose token_hash has that same value but is truncated to 63 chars so the
    // `row.token_hash === computedHash` equality in knex still won't match but
    // we still need to assert that the length-mismatch branch doesn't throw.
    // Easier: plant a DIFFERENT hash length so knex lookup misses — the
    // middleware returns "invalid or revoked daemon token" from the !row branch.
    // To actually exercise the length-mismatch branch of timingSafeEqual we
    // must make the SELECT return a row whose token_hash differs in length
    // from the 64-char computed hash. We do that by bypassing generation: use
    // tokenHashOverride with a 63-char value AND craft a plaintext whose real
    // hash would coincide with that short value — impossible under sha256.
    // Instead we route this test through the explicit length-mismatch branch
    // by constructing a fake knex override that returns a shorter row.
    const plaintext = `${DAEMON_TOKEN_PREFIX}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const computed = createHash('sha256').update(plaintext).digest('hex');
    const tamperedShort = computed.slice(0, 63); // 63 chars — length mismatch
    const fakeDb = (() => {
      const fn = () => ({
        where: () => ({
          whereNull: () => ({
            first: async () => ({
              id: 'synthetic-id',
              workspace_id: 'AQ',
              daemon_id: null,
              token_hash: tamperedShort,
              expires_at: null,
            }),
          }),
        }),
      });
      return fn as unknown as Knex;
    })();
    __setDaemonAuthDbForTests__(fakeDb);

    const { res, next } = await run(requireDaemonAuth, {
      authorization: `Bearer ${plaintext}`,
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'invalid or revoked daemon token' });
    assert.equal(next.called, false);
  } finally {
    __resetDaemonAuthDb__();
    await teardownTestDb(ctx);
  }
});
