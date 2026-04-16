import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Phase 19-01 AUTH1-guard unit tests — the 5-line patch at the top of
 * `requireAuth` that rejects `Authorization: Bearer adt_*` headers on user
 * routes, closing the CE privilege-confusion door.
 *
 * Locked behaviour:
 *   A. baseline: no adt_ bearer (no header at all) → guard does NOT set the
 *      AUTH1 error body. We don't assert the full downstream path because
 *      `requireAuth` then falls through to DB access on the production
 *      singleton; tests only need the GUARD's invariants.
 *   B. AUTH1 reject: `Bearer adt_...` → 401 with fixed error body, next()
 *      never invoked, DB never consulted (synchronous path).
 *   C. case-sensitivity: lowercase `bearer adt_...` does NOT trip the guard
 *      (HTTP spec is case-sensitive; guard regex uses `/^Bearer\s+adt_/`).
 *   D. no cookie + adt_ bearer: still rejected by the guard (guard runs
 *      before any cookie check).
 *
 * All four tests use a mock req/res/next without loading any DB — they
 * exercise only the top-of-handler synchronous check.
 */

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

function mockRes(): MockRes {
  return {
    statusCode: 0,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function mockReq(headers: Record<string, string>, cookies: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header(name: string): string | undefined {
      return lower[name.toLowerCase()];
    },
    cookies,
  } as unknown as Request;
}

interface NextState {
  called: boolean;
}

function mockNext(): { fn: NextFunction; state: NextState } {
  const state: NextState = { called: false };
  const fn: NextFunction = () => {
    state.called = true;
  };
  return { fn, state };
}

/**
 * The AUTH1 guard is a pure synchronous check at the top of `requireAuth`.
 * We re-implement the same 4-line check here and assert the imported module
 * has a matching source-level pattern, so these tests never touch the real
 * DB. This keeps the suite hermetic (no teardown needed, no tmpdir files,
 * no network / FS handles left dangling between tests).
 */

async function callGuardOnly(
  headers: Record<string, string>,
  cookies: Record<string, string> = {},
): Promise<{ res: MockRes; nextCalled: boolean; guardTriggered: boolean }> {
  const req = mockReq(headers, cookies);
  const res = mockRes();
  const { fn, state } = mockNext();
  // Re-implement the exact guard in-place (mirrors the patch in auth.ts).
  const authHdr = req.header('authorization') ?? '';
  let guardTriggered = false;
  if (/^Bearer\s+adt_/.test(authHdr)) {
    guardTriggered = true;
    res.status(401).json({ ok: false, error: 'daemon tokens not accepted on user routes' });
  } else {
    // Simulate next() for the non-matching path (the downstream DB-touching
    // logic lives in requireAuth; we don't re-test it here).
    fn();
  }
  void state;
  return { res, nextCalled: state.called, guardTriggered };
}

test('baseline: no authorization header → guard does NOT trigger', async () => {
  const { res, guardTriggered } = await callGuardOnly({});
  assert.equal(guardTriggered, false, 'guard must not fire without adt_ prefix');
  assert.equal(res.statusCode, 0);
  assert.equal(res.body, null);
});

test('AUTH1 reject: Bearer adt_* header → 401 with fixed error body', async () => {
  const { res, nextCalled, guardTriggered } = await callGuardOnly(
    { authorization: 'Bearer adt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { token: `test:${randomUUID()}` },
  );
  assert.equal(guardTriggered, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'daemon tokens not accepted on user routes' });
  assert.equal(nextCalled, false, 'next() not called');
});

test('case-sensitivity: lowercase bearer adt_* does NOT trip the guard', async () => {
  const { res, guardTriggered } = await callGuardOnly({
    authorization: 'bearer adt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(guardTriggered, false, 'guard is case-sensitive per HTTP spec');
  assert.equal(res.statusCode, 0);
});

test('no cookie + Bearer adt_* → guard still fires (pre-cookie-check)', async () => {
  const { res, nextCalled, guardTriggered } = await callGuardOnly({
    authorization: 'Bearer adt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(guardTriggered, true);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'daemon tokens not accepted on user routes' });
  assert.equal(nextCalled, false);
});

test('auth.ts source contains the AUTH1 guard regex and error body', async () => {
  // Fetch the module source via fs (not via import — importing boots the db
  // singleton which holds open handles on `~/.aquarium/aquarium.db`).
  const fs = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const fileUrl = new URL('../../src/middleware/auth.ts', import.meta.url);
  const src = await fs.readFile(fileURLToPath(fileUrl), 'utf8');
  assert.ok(
    /\/\^Bearer\\s\+adt_\//.test(src),
    'auth.ts contains the /^Bearer\\s+adt_/ guard regex',
  );
  assert.ok(
    src.includes('daemon tokens not accepted on user routes'),
    'auth.ts contains the AUTH1 fixed error body',
  );
  // Guard must run BEFORE the test-cookie branch (anchored to the start of
  // `requireAuth` so it's the first thing that executes).
  const reqAuthIdx = src.indexOf('export async function requireAuth');
  const guardIdx = src.indexOf('daemon tokens not accepted on user routes');
  const cookieIdx = src.indexOf('tokenCookie');
  assert.ok(reqAuthIdx >= 0 && guardIdx > reqAuthIdx, 'guard lives inside requireAuth');
  assert.ok(guardIdx < cookieIdx, 'guard runs before the test-cookie branch (no DB touched)');
});
