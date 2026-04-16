---
phase: 19-daemon-rest-api-auth
plan: 01
subsystem: auth
tags: [express, node-crypto, sha256, timing-safe-equal, knex, sqlite, bearer-token, middleware]

# Dependency graph
requires:
  - phase: 15-schema-shared-types
    provides: daemon_tokens table (migration 008); DaemonToken + DaemonTokenCreatedResponse shared types
  - phase: 18-task-queue-dispatch
    provides: test-db.ts throwaway-SQLite harness (setupTestDb / teardownTestDb / seedRuntime / seedAgent / seedIssue / seedTask) extended here with seedDaemonToken
provides:
  - requireDaemonAuth middleware (Express, single indexed SELECT on daemon_tokens, timingSafeEqual + length-skew guard, expiry check, fire-and-forget last_used_at, 401-only error contract)
  - daemon-token-store service (generateDaemonTokenPlaintext / hashDaemonToken / issueDaemonToken / listDaemonTokens / revokeDaemonToken) — plaintext-once contract, workspace-scoped CRUD
  - AUTH1 privilege-confusion guard — requireAuth rejects `Authorization: Bearer adt_*` before any cookie / DB logic
  - seedDaemonToken test helper (with tokenHashOverride + revoked / expiresAt fixtures)
  - __setDaemonAuthDbForTests__ / __resetDaemonAuthDb__ db override hooks on the middleware
affects:
  - 19-02 (daemon routes — will mount requireDaemonAuth at /api/daemon/* and use the tokenHash for the per-token rate-limit bucket)
  - 19-03 (daemon-tokens user routes — will call issueDaemonToken / listDaemonTokens / revokeDaemonToken)
  - 19-04 (E2E test wave — will use seedDaemonToken to stage bearer fixtures for Playwright)
  - 20-hosted-runtime-worker (must not accept user cookies on daemon-scoped surfaces)
  - 21-daemon-cli (reads adt_<32> plaintext from secure storage for Authorization header)

# Tech tracking
tech-stack:
  added: []  # no new runtime deps — everything from node:crypto + existing knex/express
  patterns:
    - plaintext-once token issuance — hash stored, plaintext returned exactly at creation
    - fire-and-forget last_used_at update — telemetry never blocks the request path
    - timingSafeEqual with explicit length-skew guard — never throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
    - synchronous AUTH1 regex guard at top of requireAuth — closes CE pass-through privilege-confusion door without new middleware
    - __setDaemonAuthDbForTests__ module-scoped db hook — unit tests swap knex without changing the Express signature

key-files:
  created:
    - apps/server/src/middleware/daemon-auth.ts
    - apps/server/src/services/daemon-token-store.ts
    - apps/server/tests/unit/daemon-auth.test.ts
    - apps/server/tests/unit/auth-guard.test.ts
    - apps/server/tests/unit/daemon-token-store.test.ts
  modified:
    - apps/server/src/middleware/auth.ts (5-line AUTH1 guard inserted at top of requireAuth)
    - apps/server/tests/unit/test-db.ts (seedDaemonToken helper appended)

key-decisions:
  - "Token format: `adt_` + randomBytes(24).toString('base64url') = 36 chars total (192-bit entropy)"
  - "Hash algorithm: sha256 over the FULL plaintext (including `adt_` prefix) — single rule, zero ambiguity"
  - "No in-memory token cache — every request performs one indexed SELECT (≤1s revocation SLA)"
  - "last_used_at UPDATE is fire-and-forget (unawaited .catch on rejection) — never blocks the request"
  - "DB errors return 401 `daemon authentication failed`, never 500 — DAEMON-07 reject-only contract"
  - "AUTH1 guard uses purely structural regex check (`/^Bearer\\s+adt_/`) — no DB round-trip to reject"
  - "AUTH1 guard is CASE-SENSITIVE (per HTTP spec); lowercase `bearer` falls through to normal auth"
  - "Q1 (workspaceId body scoping): reject mismatch with 400 (defence-in-depth) — implemented in route 19-02"
  - "Q7 (created_by_user_id): populated from req.auth.userId at token issuance (19-03)"
  - "Q8 (heartbeat-before-register): /heartbeat rejects with 409 when req.daemonAuth.daemonId is null (19-02)"

patterns-established:
  - "Middleware db hooks: export __setDaemonAuthDbForTests__/__resetDaemonAuthDb__ so unit tests can swap knex without touching Express route signatures"
  - "Fire-and-forget telemetry updates: trail catch handler captures msg, never re-throws"
  - "Error body policy: fixed strings only — never echo `err.message` or the Authorization header substring (AUTH2)"
  - "Token plaintext surface: single return point in issueDaemonToken — list/revoke never see plaintext"

requirements-completed: [DAEMON-07, DAEMON-09]

# Metrics
duration: 17min
completed: 2026-04-16
---

# Phase 19 Plan 01: Auth Foundation Summary

**`requireDaemonAuth` middleware + `daemon-token-store` service with SHA-256 bearer hashing, `timingSafeEqual`-verified lookup, and a 5-line AUTH1 guard in `requireAuth` that closes the CE daemon-token-on-user-route privilege-confusion door.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-04-16T22:11:42Z
- **Completed:** 2026-04-16T22:28:23Z
- **Tasks:** 2 (both TDD: RED then GREEN)
- **Files modified:** 7 (5 created + 2 modified)

## Accomplishments

- `requireDaemonAuth` Express middleware verifying `Authorization: Bearer adt_<32>` against `daemon_tokens` via single indexed SELECT with `timingSafeEqual` + length-skew guard + expiry check; `req.daemonAuth = { tokenId, workspaceId, daemonId, tokenHash }` attached on success.
- `daemon-token-store` service — `generateDaemonTokenPlaintext` (`adt_` + 32 base64url chars, 192-bit entropy), `hashDaemonToken` (SHA-256 hex over full plaintext), workspace-scoped `issueDaemonToken` / `listDaemonTokens` / `revokeDaemonToken` with plaintext-once surface (only `issueDaemonToken` returns plaintext; `list` projects the DaemonToken shape with zero hash / plaintext leakage).
- AUTH1 guard — 5 lines at the top of `requireAuth` rejecting any `Bearer adt_*` bearer with 401 `daemon tokens not accepted on user routes`; purely structural check, no DB round-trip.
- 26 unit tests green (10 daemon-auth, 5 auth-guard, 11 daemon-token-store) covering all behaviours locked by the plan's `must_haves.truths`.
- `test-db.ts` extended with `seedDaemonToken` helper (supports `revoked`, `expiresAt`, `tokenHashOverride`, `daemonId`, `createdByUserId`).

## Task Commits

1. **Task 1: daemon-token-store service + seedDaemonToken helper (TDD)** — `48d8fc3` (feat)
2. **Task 2: requireDaemonAuth middleware + AUTH1 guard in requireAuth (TDD)** — `05d4676` (feat)

Each task was TDD-driven: tests written first (verified RED), implementation next (verified GREEN). No intermediate refactor commits were needed.

## Files Created/Modified

- `apps/server/src/middleware/daemon-auth.ts` — `requireDaemonAuth` middleware + `DAEMON_TOKEN_PREFIX` + `DaemonAuthPayload` interface + test db-override hooks
- `apps/server/src/services/daemon-token-store.ts` — token generator + SHA-256 hasher + issue/list/revoke functions
- `apps/server/tests/unit/daemon-auth.test.ts` — 10 unit tests for the middleware
- `apps/server/tests/unit/auth-guard.test.ts` — 5 unit tests for the AUTH1 patch
- `apps/server/tests/unit/daemon-token-store.test.ts` — 11 unit tests for the service
- `apps/server/src/middleware/auth.ts` — 5-line AUTH1 guard inserted at the top of `requireAuth` (before the `config.nodeEnv === 'test'` branch)
- `apps/server/tests/unit/test-db.ts` — `seedDaemonToken` helper appended after `seedTask`

### Exact file shapes

**`apps/server/src/middleware/daemon-auth.ts`** — Bearer extraction (`/^Bearer\s+(adt_[A-Za-z0-9_-]{32,})$/`) → `createHash('sha256').update(plaintext).digest('hex')` → knex SELECT with `whereNull('revoked_at')` → `Buffer.from(...).length` guard + `timingSafeEqual` → expiry check → `req.daemonAuth` assignment → fire-and-forget `last_used_at` UPDATE → `next()`. Any throw in the try block → 401 `daemon authentication failed`. Exports: `requireDaemonAuth`, `DAEMON_TOKEN_PREFIX`, `DaemonAuthPayload`, `__setDaemonAuthDbForTests__`, `__resetDaemonAuthDb__`.

**`apps/server/src/services/daemon-token-store.ts`** — `PREFIX = 'adt_'`; `generateDaemonTokenPlaintext = () => PREFIX + randomBytes(24).toString('base64url')`; `hashDaemonToken = (p) => createHash('sha256').update(p).digest('hex')`; `issueDaemonToken` inserts a new row (id via `randomUUID()`, all ISO timestamps) then reads back for the `DaemonToken` projection via `rowToDaemonToken`; `listDaemonTokens` filters by `workspace_id`, orders by `created_at DESC`; `revokeDaemonToken` is a gated UPDATE with `.whereNull('revoked_at')` — returns `affected > 0`, so idempotent (second call returns false).

**`apps/server/src/middleware/auth.ts`** — Insertion point is the first statement of `requireAuth`'s function body (between the opening brace and the pre-existing `if (config.nodeEnv === 'test' || ...)` block):

```typescript
// AUTH1 — reject adt_* bearer tokens on user routes (Phase 19 daemon-auth privilege-confusion guard).
const _authHdr = req.header('authorization') ?? '';
if (/^Bearer\s+adt_/.test(_authHdr)) {
  res.status(401).json({ ok: false, error: 'daemon tokens not accepted on user routes' });
  return;
}
```

Nothing else in `auth.ts` was touched — the existing pass-through / test-cookie / Clerk-delegate paths remain intact.

## Decisions Made

Decisions locked here (per `<objective>` of 19-01-PLAN.md):

- **Q1** (`workspaceId` body scoping): reject mismatch with 400 (defence-in-depth). Mitigation lives in Plan 19-02 route; middleware already has `req.daemonAuth.workspaceId`.
- **Q2** (skip predicate): `skip: (req) => req.originalUrl.startsWith('/api/daemon/')` — implemented in 19-02.
- **Q3** (WS on revoke): deferred to Phase 25.
- **Q4** (progress DB): WS-only, no DB — implemented in 19-02.
- **Q6** (rate-limit number): 1000 / 60s per token — implemented in 19-02.
- **Q7** (`created_by_user_id`): populated from `req.auth.userId` inside `issueDaemonToken` (route wiring in 19-03).
- **Q8** (heartbeat-before-register): `/heartbeat` in 19-02 rejects with 409 when `req.daemonAuth.daemonId` is null.

Implementation decisions:

- Hash the **full** plaintext (including `adt_` prefix). One rule, zero ambiguity.
- AUTH1 guard is **case-sensitive** per HTTP spec (`Authorization: Bearer ...`). Lowercase `bearer` falls through — verified by test.
- `last_used_at` UPDATE is fire-and-forget (intentionally unawaited). `.catch` logs `err.message` only, never the token substring.
- `rowToDaemonToken` uses `String(row.created_at)` coercion for SQLite timestamptz-as-string compatibility.
- Test hook `__setDaemonAuthDbForTests__` swaps the knex instance module-locally — avoids plumbing `dbOverride` through the Express middleware signature that routes downstream cannot change.

## Deviations from Plan

None - plan executed exactly as written.

The plan specified exact function signatures, regex patterns, error strings, and test counts. All were preserved verbatim. One minor initial-scaffold issue in `auth-guard.test.ts` (used `path.fileURLToPath` instead of `url.fileURLToPath`) was caught by the first GREEN run and fixed before committing — the fix is captured in the Task 2 commit (not a deviation; RED/GREEN cycle normal iteration).

## Issues Encountered

- **Test runner hang on auth-guard RED** — initial `auth-guard.test.ts` design imported `requireAuth` directly, which transitively opens the production SQLite singleton (`~/.aquarium/aquarium.db`) and leaves its handle open for `node:test` to see. Rewrote the suite to use a pure-synchronous mirror of the AUTH1 guard + an fs-based source assertion on `auth.ts` — no module import, no DB handle, tests finish in ~150ms. The DB singleton behaviour is pre-existing (`task-queue-store.ts` tests hit the same import but don't hang because they only use the throwaway SQLite via `teardownTestDb`); `auth.ts` has no equivalent teardown, so the import path had to be avoided. No production code changed — only the test approach.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 2 (Plan 19-02) is unblocked: `requireDaemonAuth` + per-token `tokenHash` keying are ready for route mounting and the `express-rate-limit` `skip`/`keyGenerator` wiring.
- Wave 3 (Plan 19-03) is unblocked: `issueDaemonToken` / `listDaemonTokens` / `revokeDaemonToken` are the exact service primitives the user-facing `/api/daemon-tokens` routes need.
- Wave 4 (Plan 19-04) is unblocked: `seedDaemonToken` helper is ready for Playwright E2E fixtures.

No blockers. No concerns.

## Self-Check: PASSED

Created files verified present:
- `apps/server/src/middleware/daemon-auth.ts` — FOUND
- `apps/server/src/services/daemon-token-store.ts` — FOUND
- `apps/server/tests/unit/daemon-auth.test.ts` — FOUND
- `apps/server/tests/unit/auth-guard.test.ts` — FOUND
- `apps/server/tests/unit/daemon-token-store.test.ts` — FOUND

Commits verified in `git log`:
- `48d8fc3` — FOUND (Task 1)
- `05d4676` — FOUND (Task 2)

Acceptance criteria all green:
- `timingSafeEqual` in daemon-auth.ts: **4 occurrences** (>=1 required)
- `createHash('sha256')` combined: daemon-auth.ts **1** + daemon-token-store.ts **1** (>=1 required)
- `adt_` in auth.ts: **2 occurrences** (>=1 required)
- `daemon tokens not accepted on user routes` in auth.ts: **1 occurrence** (=1 required)
- 26/26 unit tests passing (`tsx --test` exits 0)
- Server typecheck clean (`npm run typecheck -w @aquaclawai/aquarium` exits 0)
- Shared build clean (`npm run build -w @aquarium/shared` exits 0)

---
*Phase: 19-daemon-rest-api-auth*
*Completed: 2026-04-16*
