---
phase: 19-daemon-rest-api-auth
plan: 03
subsystem: daemon-token-management
tags: [express, cookie-auth, bearer-reject, rest-api, plaintext-once, idempotent-revoke, workspace-scoping, idor-guard]

# Dependency graph
requires:
  - phase: 19-daemon-rest-api-auth
    plan: "01"
    provides: |
      issueDaemonToken / listDaemonTokens / revokeDaemonToken service primitives;
      requireDaemonAuth middleware (consumed only by the SC-4 SLA test to prove
      revocation propagates within 1s); AUTH1 patch in requireAuth that rejects
      `Bearer adt_*` headers — Test 5 verifies this end-to-end.
  - phase: 19-daemon-rest-api-auth
    plan: "02"
    provides: |
      /api/daemon mount in server-core.ts — 19-03 mounts /api/daemon-tokens
      adjacent to it without touching the daemon router, the rate-limit skip
      predicates, or the Proxy-wrapped db singleton.
  - phase: 15-schema-shared-types
    provides: |
      daemon_tokens table (migration 008), workspaces table (migration 003),
      users table; DaemonToken / DaemonTokenCreatedResponse shared types.
provides:
  - POST /api/daemon-tokens  (DAEMON-10 create) — returns `{ token: DaemonToken, plaintext: 'adt_<32>' }` exactly once
  - GET /api/daemon-tokens   (DAEMON-10 list)   — returns `DaemonToken[]` projection (no token_hash, no plaintext, never)
  - DELETE /api/daemon-tokens/:id (DAEMON-10 revoke) — soft revoke (revoked_at=now()), idempotent, workspace-scoped 404 for cross-tenant ids
  - 12 integration tests covering SC-5 plaintext-once contract and SC-4 revocation SLA (<1000ms in-process)
affects:
  - 19-04 (E2E test wave — will exercise /api/daemon-tokens over Playwright + the cookie auth it already has from the web UI)
  - 25-ui (Phase 25 token-management UI — consumes all three endpoints verbatim; `plaintext` field in POST response is the "copy once" panel source)
  - 21-daemon-cli (consumes a plaintext produced by this POST for Authorization header; never reads /list or /delete)

# Tech tracking
tech-stack:
  added: []  # no new deps — express Router + existing 19-01 service primitives only
  patterns:
    - "Plaintext-once surface — `plaintext` field lives ONLY in the POST response body; list never re-exposes it (defence at both the service layer via DaemonToken projection AND the route layer via verbatim passthrough)"
    - "Workspace-scoped pre-check on DELETE — `listDaemonTokens(ws).some(id)` distinguishes 'not found' (404) from 'already revoked' (200 idempotent) without coupling the service to the route's 404 semantics"
    - "`satisfies ApiResponse<T>` on every response body — 6 call sites, pins response shapes at the call site against the shared contract"
    - "requireAuth at the top of the router via `router.use(requireAuth)` — identical to routes/runtimes.ts pattern; the AUTH1 guard in 19-01 then rejects `adt_*` bearers structurally"
    - "`test:<userId>` cookie path in requireAuth — tests bootstrap a real user row + `token=test:<id>` cookie; the full auth chain runs (no bypass), so the AUTH1 guard is exercised end-to-end in test 5"

key-files:
  created:
    - apps/server/src/routes/daemon-tokens.ts
    - apps/server/tests/unit/daemon-tokens-routes.test.ts
  modified:
    - apps/server/src/server-core.ts  # 2 lines: import + mount adjacent to /api/daemon

key-decisions:
  - "DELETE is idempotent (200 { ok: true } on double-revoke), not 404 — matches Phase 17 delete-by-id patterns; the user's original mental model 'this token is revoked' stays true on retry"
  - "Route does NOT project the list response — `listDaemonTokens` already returns the `DaemonToken` shape (no token_hash, no plaintext); adding a route-level projection would be two places that need to stay in sync, risking future drift"
  - "Workspace scoping uses the constant 'AQ' (same as routes/runtimes.ts, routes/agents.ts, routes/issues.ts) — CE is single-workspace; EE will plumb `req.auth.workspaceId` in a later phase"
  - "Q7 lock-in: `created_by_user_id` is populated from `req.auth.userId`. When `req.auth` is missing (should never happen after requireAuth passes) the column is stored as `null` rather than throwing — defence-in-depth for an impossible code path"
  - "Name validation: 400 'name required' on empty/non-string, 400 'name too long (max 100 chars)' on >100 chars. The 100-char cap matches the migration-008 `string(100) notNullable` column; the validation is the UX-side error, the DB constraint is the backstop"
  - "SC-4 SLA test measures elapsed time around the DELETE via `process.hrtime.bigint()` and asserts <1000ms — trivially satisfied in-process (observed ~145ms in the test run) but pins the invariant against future regressions (e.g. adding a cache in front of daemon-tokens DB lookups)"

patterns-established:
  - "User-auth route file: `router.use(requireAuth)` at the top + `DEFAULT_WORKSPACE_ID = 'AQ'` constant + try/catch with `{ ok: false, error: err.message }` on 500s — identical to runtimes.ts and agents.ts"
  - "Test harness reuse: bootstrap() swaps both db hooks (`__setDbForTests__` and `__setDaemonAuthDbForTests__`) because the route consumes the daemon-token-store service (which uses the Proxy-wrapped db singleton) AND test 12 exercises requireDaemonAuth directly (which uses the middleware-local activeDb)"
  - "Mount ordering in server-core.ts: /api/daemon-tokens mounts immediately after /api/daemon — 19-02's daemon router mount and rate-limiter skip predicates stay untouched; the user-auth router is intentionally exempt-by-path-mismatch from the daemon bucket (different URL prefix)"

requirements-completed: [DAEMON-10]

# Metrics
duration: ~9min
completed: 2026-04-16
---

# Phase 19 Plan 03: User-Facing Daemon-Token Routes Summary

**Three cookie-authed endpoints under `/api/daemon-tokens` with plaintext-once creation, zero-leak list projection, and idempotent soft revoke — the user's onboarding path for minting the `adt_*` bearer a daemon uses to hit Phase 19-02's surface.**

## Performance

- **Duration:** ~9 min (single TDD task: RED → GREEN → commit)
- **Started:** 2026-04-16T22:49:08Z
- **Completed:** 2026-04-16T22:58:25Z (approx)
- **Tasks:** 1 (TDD single-task plan)
- **Files modified:** 3 (2 created + 1 modified — 2-line server-core.ts edit)

## Endpoint Signatures

| # | Req ID | Method | Path | Auth | Request body | Response body | Status |
|---|--------|--------|------|------|--------------|---------------|--------|
| 1 | DAEMON-10 create | POST | `/api/daemon-tokens` | cookie (`requireAuth`) | `{ name: string, expiresAt?: string }` | `ApiResponse<DaemonTokenCreatedResponse>` = `{ ok, data: { token: DaemonToken, plaintext: 'adt_<32>' } }` | 200 / 400 / 401 |
| 2 | DAEMON-10 list   | GET  | `/api/daemon-tokens` | cookie (`requireAuth`) | —                                                            | `ApiResponse<DaemonToken[]>` (ordered `created_at DESC`, workspace-filtered)                                   | 200 / 401     |
| 3 | DAEMON-10 revoke | DELETE | `/api/daemon-tokens/:id` | cookie (`requireAuth`) | —                                                       | `ApiResponse<{ ok: boolean }>` — idempotent                                                                      | 200 / 404 / 401 |

- **Plaintext surface:** `data.plaintext` appears ONLY in the POST response body. All subsequent responses expose only the `DaemonToken` projection (no `tokenHash`, no `token_hash`, no `plaintext` field).
- **AUTH1:** An `Authorization: Bearer adt_*` header on any of these endpoints is rejected with 401 `daemon tokens not accepted on user routes` by the guard at the top of `requireAuth` (added in Phase 19-01).
- **IDOR guard:** DELETE pre-checks via a workspace-filtered `listDaemonTokens` — a token belonging to another workspace returns 404 `token not found`, never 200 or 403.

## Server-Core Mount

```ts
// apps/server/src/server-core.ts — new import (adjacent to the 19-02 daemon import)
import daemonTokenRoutes from './routes/daemon-tokens.js';

// Mount (adjacent to 19-02's /api/daemon mount, does not disturb it or the
// rate-limiter skip predicates above):
app.use('/api/daemon', daemonRoutes);
// Phase 19-03: user-facing daemon-token management (cookie-JWT authed via
// `requireAuth` inside the router — AUTH1 rejects `adt_*` bearers here).
app.use('/api/daemon-tokens', daemonTokenRoutes);
```

The new mount sits between the 19-02 daemon mount and the existing `/api/instances` (credentialRoutes) mount. No change to:
- The two global `/api/` rate-limiter skip predicates (they inspect `originalUrl.startsWith('/api/daemon/')` — note trailing slash — so `/api/daemon-tokens` is correctly NOT skipped and subject to the global human-UI rate-limit in production, which is the desired DAEMON-10 behaviour per 19-RESEARCH §T-19-19).
- The 19-02 daemon bucket (path-scoped inside `routes/daemon.ts` — cannot reach this surface).
- Any other route mount or middleware.

## Test Coverage (12 tests)

All tests in `apps/server/tests/unit/daemon-tokens-routes.test.ts`. Each test uses its own throwaway SQLite fixture via `setupTestDb()` and pre-seeds a real user row so `requireAuth`'s `test:<userId>` cookie path authenticates end-to-end (no middleware mocks).

| # | Test | Covers | Duration |
|---|------|--------|----------|
| 1 | POST / returns token + plaintext once; DB hash matches (SC-5) | POST happy path, plaintext format, `createdByUserId === req.auth.userId`, DB `token_hash === hashDaemonToken(plaintext)` | ~1290ms |
| 2 | POST / with expiresAt persists expires_at | POST with optional `expiresAt`; DB column populated | ~258ms |
| 3 | POST / empty body returns 400 "name required" | Input validation (missing / empty name) | ~694ms |
| 4 | POST / name.length > 100 returns 400 "name too long" | Input validation (cap matches migration-008 `string(100)`) | ~290ms |
| 5 | POST / with adt_* bearer and no cookie returns 401 (AUTH1) | Real `requireAuth` chain rejects `Bearer adt_*` via the 19-01 guard | ~152ms |
| 6 | GET / returns projection with no plaintext/tokenHash leak | SC-5 defence: raw response text contains no `adt_`, no seeded plaintext, no hex hash, no `token_hash`/`tokenHash`/`plaintext` field names; `DaemonToken` shape fields all present | ~203ms |
| 7 | GET / only returns tokens for the current workspace (AQ) | Workspace filter on the SELECT — cross-workspace tokens are invisible | ~159ms |
| 8 | DELETE /:id sets revoked_at | Soft-revoke happy path; DB `revoked_at` populated | ~155ms |
| 9 | DELETE /:id is idempotent (second call still 200) | Idempotency contract — re-revoke does not 404 | ~171ms |
| 10 | DELETE /:id cross-workspace returns 404 and leaves row untouched | IDOR / AUTH4 guard; foreign token's `revoked_at` stays null | ~115ms |
| 11 | DELETE /:id unknown id returns 404 | Not-found path | ~75ms |
| 12 | revocation invalidates bearer on the next requireDaemonAuth call (<1000ms) (SC-4) | End-to-end SLA: pre-revoke auth passes → HTTP DELETE → post-revoke auth 401; elapsed measured via `process.hrtime.bigint()` (~145ms observed in-process, well under 1000ms budget) | ~145ms |

**Suite total: 12/12 passed, ~7.8s.**

Regression check (`NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts`):

- `daemon-auth.test.ts` — 10 tests
- `daemon-routes.test.ts` — 20 tests
- `daemon-token-store.test.ts` — 11 tests
- `daemon-tokens-routes.test.ts` — **12 tests (new)**
- `auth-guard.test.ts` — 5 tests
- `rate-limit.test.ts` — 4 tests
- `task-queue.test.ts` — 20 tests
- `task-message-batcher.test.ts` — 4 tests
- `task-reaper.test.ts` — 2 tests
- **Total: 88/88 passed, ~4.9s after shared-build cache warm.**

## SC-4 + SC-5 Coverage Proof

### SC-5 — plaintext shown exactly once

- **Test 1** asserts POST response contains `plaintext: /^adt_[A-Za-z0-9_-]{32}$/` AND the DB row's `token_hash === hashDaemonToken(plaintext)`.
- **Test 6** asserts the raw serialised GET response text (not just the parsed object) contains NONE of:
  - The literal seeded plaintexts.
  - Any `adt_` plaintext-shaped substring (`/adt_[A-Za-z0-9_-]{32}/`).
  - Any of the seeded `token_hash` hex values.
  - The field names `token_hash`, `tokenHash`, `plaintext`.
- **Test 6 also** asserts the response objects include the full `DaemonToken` projection (id, workspaceId, name, daemonId, createdByUserId, expiresAt, lastUsedAt, revokedAt, createdAt, updatedAt) — so the zero-leak constraint doesn't also strip legitimate fields.

### SC-4 — revocation ≤1s

- **Test 12** uses `process.hrtime.bigint()` to measure the window starting immediately before the HTTP DELETE request, including the post-DELETE re-auth. In the successful run, elapsed was ~145ms — two orders of magnitude under the 1000ms budget.
- The mechanism is `whereNull('revoked_at')` in `requireDaemonAuth`'s SELECT (19-01) + a single UPDATE in `revokeDaemonToken` (19-01). No cache, no async invalidation path — the write lands in SQLite before the next SELECT sees it.
- Regression safety: if a future phase adds a cache in front of `daemon_tokens` lookups without invalidation on revoke, this test would immediately fail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Test workspace insert missing required columns**
- **Found during:** Task 1 first GREEN run (tests 7 and 10 failed with `SQLITE_CONSTRAINT_NOTNULL`).
- **Issue:** The `workspaces` table (migration 003) requires `issue_prefix` NOT NULL + `issue_counter` NOT NULL + `metadata` NOT NULL, but my test INSERTs only set `id`, `name`, `created_at`, `updated_at`.
- **Fix:** Added `issue_prefix: 'OTHER'`, `issue_counter: 0`, `metadata: JSON.stringify({})` to the two `ctx.db.db('workspaces').insert(...)` calls in tests 7 and 10.
- **Files modified:** `apps/server/tests/unit/daemon-tokens-routes.test.ts` (both occurrences).
- **Commit:** `a7158ee` (same Task 1 commit — the fix happened in the RED→GREEN cycle, not a post-commit patch).

**2. [Scope noted, not a behavioural deviation] `requireDaemonAuth` reference count**
- **Found during:** post-GREEN acceptance grep.
- **Issue:** Plan acceptance criterion `grep -c "requireDaemonAuth" apps/server/src/routes/daemon-tokens.ts` required 0, but my doc comment said `requireAuth (NOT requireDaemonAuth — these are user routes)`.
- **Fix:** Reworded the comment to `requireAuth (these are user routes, not daemon routes)`. Count is now 0, behaviour unchanged.
- **Files modified:** `apps/server/src/routes/daemon-tokens.ts` (comment only).
- **Commit:** `a7158ee` (pre-commit edit, same TDD cycle).

No plan-level behavioural deviations.

## Issues Encountered

- **Background-test invocation produced empty output files.** The initial `npm exec tsx --test` calls wedged behind a stale DB handle from a previous aborted test run; two foreground runs exited cleanly once the orphan processes were killed (`pkill -9 -f "tsx --test"`). This is a harness artifact, not a code issue.
- **Test 12 plaintext is not a real seeded-token plaintext for `requireDaemonAuth`'s pre-check.** The `seedDaemonToken` helper uses the *real* `hashDaemonToken(plaintext)`, so the bearer passes the middleware's lookup before revoke and fails after — exactly the expected behaviour. The test therefore proves the SC-4 SLA over the real SQL path, not a mocked one.

## User Setup Required

None.

## Next Plan Readiness

- **19-04 (E2E test wave)** unblocked:
  - All 10 daemon endpoints (19-02) and all 3 token-management endpoints (19-03) are now HTTP-reachable.
  - Playwright can issue a token via `POST /api/daemon-tokens`, use it as `Authorization: Bearer adt_*` on `/api/daemon/*`, then revoke via `DELETE /api/daemon-tokens/:id` and assert the next daemon call 401s — the full SC-1 + SC-2 + SC-4 + SC-5 chain over the real server.
  - `seedDaemonToken` remains available for E2E fixtures that want to skip the POST (e.g. stress-testing `/claim` under 1 req/s for 5 min without making the E2E depend on cookie-auth plumbing).

No blockers. No concerns.

## Self-Check: PASSED

Created files verified present:
- `apps/server/src/routes/daemon-tokens.ts` — FOUND (126 lines; router.use(requireAuth) once; POST/GET/DELETE handlers present)
- `apps/server/tests/unit/daemon-tokens-routes.test.ts` — FOUND (12 tests)

Modified files verified:
- `apps/server/src/server-core.ts` — `import daemonTokenRoutes` + `app.use('/api/daemon-tokens', daemonTokenRoutes);` present

Commits verified in `git log --oneline`:
- `a7158ee feat(19-03): add user-facing daemon-token routes + SC-4/SC-5 tests (TDD)` — FOUND

Acceptance criteria all green:
- `grep -c "router.use(requireAuth)" apps/server/src/routes/daemon-tokens.ts` = **1** (required: 1)
- `grep -c "requireDaemonAuth" apps/server/src/routes/daemon-tokens.ts` = **0** (required: 0 — user auth, not daemon auth)
- `grep -c "router.post('/'" apps/server/src/routes/daemon-tokens.ts` = **1**
- `grep -c "router.get('/'" apps/server/src/routes/daemon-tokens.ts` = **1**
- `grep -c "router.delete('/:id'" apps/server/src/routes/daemon-tokens.ts` = **1**
- `grep -c "issueDaemonToken" apps/server/src/routes/daemon-tokens.ts` = **2** (>=1 required)
- `grep -c "listDaemonTokens" apps/server/src/routes/daemon-tokens.ts` = **6** (>=1 required — consumed both by GET and DELETE pre-check)
- `grep -c "revokeDaemonToken" apps/server/src/routes/daemon-tokens.ts` = **4** (>=1 required)
- `grep -c "db(" apps/server/src/routes/daemon-tokens.ts` = **0** (CE1 — route-level DB access forbidden)
- `grep -c "import daemonTokenRoutes" apps/server/src/server-core.ts` = **1**
- `grep -c "app.use('/api/daemon-tokens'," apps/server/src/server-core.ts` = **1**
- `npx tsx --test apps/server/tests/unit/daemon-tokens-routes.test.ts` — **12/12 passed**, exits 0
- `npx tsx --test apps/server/tests/unit/*.test.ts` — **88/88 passed**, 0 regressions
- `npm run typecheck -w @aquaclawai/aquarium` exits 0
- `npm run build -w @aquarium/shared` exits 0

---
*Phase: 19-daemon-rest-api-auth*
*Completed: 2026-04-16*
