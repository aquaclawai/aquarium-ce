import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Regression: CE's `/api/auth/test-signup` must generate a UUID for the
 * new user's `id` before inserting into the `users` table. SQLite's
 * `addUuidPrimary` creates `string(36)` with no default — the app is
 * responsible for generating the id via `adapter.generateId()`.
 *
 * The original bug (Phase 26, caught by the release pre-push gate) was
 * that `test-signup` relied on `.returning(['id'])` to surface a DB-
 * generated id. On SQLite there is no DB-side default, so the returned
 * id was `null` and every downstream E2E that needed cookie auth broke.
 *
 * This test asserts the source-level invariant: inside the test-signup
 * handler block, `adapter.generateId()` is called before `.insert(` into
 * `users`, and the `id` key is present in the insert payload.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_ROUTE_PATH = resolve(__dirname, '../../src/routes/auth.ts');

function readSource(): string {
  return readFileSync(AUTH_ROUTE_PATH, 'utf8');
}

test('test-signup handler calls adapter.generateId() before inserting into users', () => {
  const src = readSource();

  const signupStart = src.indexOf(`router.post('/test-signup'`);
  assert.ok(signupStart >= 0, 'test-signup route handler must exist');

  // Find the end of this handler — the first "});" that closes the router.post call
  // after the first `.insert(` inside this handler.
  const usersInsertIdx = src.indexOf(`db('users')`, signupStart);
  assert.ok(usersInsertIdx >= 0, 'test-signup must call db(\'users\')');
  assert.ok(
    usersInsertIdx > signupStart,
    'the db(\'users\') call must be inside the test-signup handler',
  );

  const insertPayloadStart = src.indexOf('.insert({', usersInsertIdx);
  assert.ok(insertPayloadStart >= 0, 'test-signup must insert a users row');

  const generateIdIdx = src.indexOf('generateId()', signupStart);
  assert.ok(
    generateIdIdx >= 0 && generateIdIdx < insertPayloadStart,
    'adapter.generateId() must be called before inserting into users',
  );

  // Assert the id key is actually in the insert payload (not just generated and thrown away).
  // Find the end of the insert payload (next `})` after `.insert({`).
  const payloadEnd = src.indexOf('})', insertPayloadStart);
  const payload = src.slice(insertPayloadStart, payloadEnd);
  assert.match(
    payload,
    /\bid\b\s*[,:]/,
    'users insert payload must include an `id` field (either `id` shorthand or `id: ...`)',
  );
});

test('test-signup handler calls generateId() before inserting into auth_events', () => {
  const src = readSource();

  const signupStart = src.indexOf(`router.post('/test-signup'`);
  const authEventsIdx = src.indexOf(`db('auth_events')`, signupStart);
  assert.ok(authEventsIdx >= 0, 'test-signup must log an auth_events row');

  const insertPayloadStart = src.indexOf('.insert({', authEventsIdx);
  assert.ok(insertPayloadStart >= 0, 'test-signup must insert into auth_events');

  const payloadEnd = src.indexOf('})', insertPayloadStart);
  const payload = src.slice(insertPayloadStart, payloadEnd);
  assert.match(
    payload,
    /\bid\s*:/,
    'auth_events insert payload must include an explicit `id:` field with generateId() value',
  );
  assert.match(
    payload,
    /generateId\(\)/,
    'auth_events insert payload must call generateId() for the `id` field',
  );
});

test('test-login handler supplies an id to auth_events insert', () => {
  const src = readSource();

  const loginStart = src.indexOf(`router.post('/test-login'`);
  assert.ok(loginStart >= 0, 'test-login route handler must exist');

  const authEventsIdx = src.indexOf(`db('auth_events')`, loginStart);
  assert.ok(authEventsIdx >= 0, 'test-login must log an auth_events row');

  const insertPayloadStart = src.indexOf('.insert({', authEventsIdx);
  const payloadEnd = src.indexOf('})', insertPayloadStart);
  const payload = src.slice(insertPayloadStart, payloadEnd);
  assert.match(
    payload,
    /\bid\s*:/,
    'auth_events login payload must include an explicit `id:` field',
  );
  assert.match(
    payload,
    /generateId\(\)/,
    'auth_events login payload must call generateId() for the `id` field',
  );
});
