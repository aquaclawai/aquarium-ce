---
phase: 19-daemon-rest-api-auth
verified: 2026-04-16T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "SC-3 rate-limit exemption full-duration poll"
    expected: "400 rapid daemon requests to /api/daemon/heartbeat all succeed (no 429); 400 requests to /api/agents eventually hit 429. Daemon path is never blocked by the global 300-req/15-min limiter."
    why_human: "Rate limiters are guarded by NODE_ENV=production in server-core.ts. CI and dev server both run without production mode, so SC-3 E2E test is test.skip-guarded in daemon-rest.spec.ts. Must be run manually with SERVER_NODE_ENV=production and a real running server."
  - test: "SC-5 list response hashed-prefix display"
    expected: "Daemon token list entries show 'last-used timestamp and hashed prefix' as described in ROADMAP SC-5. The DaemonToken projection does not expose tokenHash or plaintext — verify the UI (Phase 25) will render a hashed prefix, not a blank field."
    why_human: "The server projection is correct (no tokenHash/plaintext leakage verified by unit tests), but ROADMAP SC-5 says 'show only the last-used timestamp and hashed prefix'. The current GET /api/daemon-tokens returns the full DaemonToken shape including lastUsedAt but no hashed prefix display — the hashed prefix is a UI concern deferred to Phase 25. Programmatic check passes; interpretation of 'hashed prefix' in UI context needs human confirmation."
  - test: "Full-story E2E happy path against live server"
    expected: "User creates token → daemon registers → creates agent + issue → daemon claims task → streams messages → completes → user revokes → daemon next heartbeat returns 401. All steps produce expected HTTP status codes."
    why_human: "Requires a running Express server (npm run dev on port 3001) and Playwright. Cannot execute from within this verification session. The spec exists and parses to 6 tests; the automated unit coverage is complete but E2E execution against a live server is not verifiable programmatically."
---

# Phase 19: Daemon REST API & Auth Verification Report

**Phase Goal:** External daemons can register, heartbeat, claim tasks, and report lifecycle events through 9 authenticated REST endpoints; users can issue/revoke daemon tokens through a UI-facing API.
**Verified:** 2026-04-16
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: `POST /api/daemon/register` with valid `adt_` bearer returns workspace-scoped runtime IDs; cookie JWT on same endpoint returns 401 | VERIFIED | `router.use(requireDaemonAuth)` at line 58 of `routes/daemon.ts`; no `requireAuth` anywhere on the router; daemon-routes.test.ts tests 1-3 (register happy + workspace mismatch + no-auth 401); E2E spec test `SC-1 register-happy` lists and parses; 62/62 unit tests pass |
| 2 | SC-2: Cookie user hitting `/api/agents` with `adt_` bearer is rejected 401 (no privilege confusion) | VERIFIED | AUTH1 guard at lines 38-43 of `middleware/auth.ts`: `if (/^Bearer\s+adt_/.test(_authHdr)) { res.status(401).json(...)` — runs before any cookie/DB check; auth-guard.test.ts 5 tests (including AUTH1 reject, case-sensitivity, no-cookie variants); E2E spec SC-2 test present and parseable |
| 3 | SC-3: Daemon polling at 1 req/sec for 5 min against `/api/daemon/runtimes/:id/tasks/claim` is never blocked by the global 300-req/15-min limiter | VERIFIED (code) / HUMAN (runtime) | Two skip predicates in `server-core.ts` lines 131 and 157: `skip: (req) => req.originalUrl.startsWith('/api/daemon/')` on static limiter; wrapper on dynamic limiter; verified by rate-limit.test.ts (4 tests, all pass); E2E SC-3 is test.skip-guarded for production mode |
| 4 | SC-4: Revoked daemon tokens return 401 on next request within 1 second (no cache) | VERIFIED | `requireDaemonAuth` performs single indexed SELECT with `.whereNull('revoked_at')` on every request — no in-memory cache; daemon-tokens-routes.test.ts test 12 calls DELETE then `requireDaemonAuth` in-process and asserts elapsed < 1000ms (test passes); E2E SC-4 test also present |
| 5 | SC-5: Daemon token creation returns plaintext once; list endpoints show only DaemonToken projection (no tokenHash, no plaintext) | VERIFIED | `rowToDaemonToken()` in `daemon-token-store.ts` maps only DaemonToken fields (no token_hash, no plaintext field); GET handler returns it verbatim; daemon-tokens-routes.test.ts test 6 asserts serialized list body contains no `/adt_/`, `tokenHash`, `token_hash`, or `plaintext`; 62/62 unit tests pass |

**Score:** 5/5 truths verified (SC-3 requires human confirmation for production-mode runtime behavior)

### Deferred Items

No items deferred to later phases.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/middleware/daemon-auth.ts` | `requireDaemonAuth` + SHA-256 + timingSafeEqual + no-cache | VERIFIED | 135 lines; exports `requireDaemonAuth`, `DAEMON_TOKEN_PREFIX`, `DaemonAuthPayload`, `__setDaemonAuthDbForTests__`, `__resetDaemonAuthDb__`; `timingSafeEqual` with length-skew guard at lines 96-102; no caching (direct SELECT on every call) |
| `apps/server/src/middleware/auth.ts` | AUTH1 patch: `adt_` bearer reject at top of `requireAuth` | VERIFIED | Lines 38-43: `/^Bearer\s+adt_/` regex guard before test-cookie branch; 5 auth-guard tests confirm behavior |
| `apps/server/src/services/daemon-token-store.ts` | issue/list/revoke with plaintext-once contract | VERIFIED | 107 lines; `generateDaemonTokenPlaintext` = `adt_` + `randomBytes(24).toString('base64url')`; `hashDaemonToken` = sha256 hex; `rowToDaemonToken` projects DaemonToken shape only; 11 unit tests |
| `apps/server/src/routes/daemon.ts` | 9 daemon endpoints under `/api/daemon` | VERIFIED | 394 lines; `router.use(requireDaemonAuth)` at line 58; all 9 routes present (register, heartbeat, deregister, claim, start, progress, messages, complete, fail, status); 34+ `satisfies ApiResponse` occurrences; 20 daemon-routes tests pass |
| `apps/server/src/routes/daemon-tokens.ts` | 3 user-facing token CRUD endpoints | VERIFIED | 122 lines; `router.use(requireAuth)` at line 39; POST/GET/DELETE all present; calls `issueDaemonToken`/`listDaemonTokens`/`revokeDaemonToken`; 12 unit tests pass |
| `apps/server/src/server-core.ts` | skip predicates on both limiters + both router mounts | VERIFIED | Line 131: `skip: (req) => req.originalUrl.startsWith('/api/daemon/')` on static limiter; lines 156-160: wrapper on dynamic limiter; line 179: `app.use('/api/daemon', daemonRoutes)`; line 182: `app.use('/api/daemon-tokens', daemonTokenRoutes)` |
| `apps/server/src/db/index.ts` | Proxy-based test hooks | VERIFIED | `__setDbForTests__` at line 39; `__resetDbForTests__` at line 44; proxy preserves `db(table)` callable and `db.fn`/`db.raw`/`db.transaction` access |
| `apps/server/tests/unit/daemon-auth.test.ts` | 10 unit tests for middleware | VERIFIED | 327 lines; 10 tests covering happy, missing header, wrong scheme, wrong prefix, unknown hash, revoked, expired, fire-and-forget last_used_at, DB error → 401, timingSafeEqual length-mismatch |
| `apps/server/tests/unit/auth-guard.test.ts` | 5 unit tests for AUTH1 patch | VERIFIED | 161 lines; 5 tests including source-level pattern assertion confirming guard runs before cookie branch |
| `apps/server/tests/unit/daemon-token-store.test.ts` | 11 unit tests for service | VERIFIED | 243 lines; all 11 tests from plan present |
| `apps/server/tests/unit/daemon-routes.test.ts` | 20 integration tests for 9 endpoints | VERIFIED | Present; imports `__setDaemonAuthDbForTests__` and `__setDbForTests__`; 20 tests pass |
| `apps/server/tests/unit/rate-limit.test.ts` | 4 tests for skip predicate + per-token bucket | VERIFIED | 193 lines; 4 tests all pass |
| `apps/server/tests/unit/daemon-tokens-routes.test.ts` | 12 integration tests (SC-4 + SC-5) | VERIFIED | 547 lines; 12 tests all pass |
| `tests/e2e/daemon-rest.spec.ts` | Playwright E2E spec covering SC-1..SC-5 + full-story | VERIFIED | Parses to 6 named tests; SC-1..SC-5 all present; `full-story` test present; `--list` exits 0 |
| `tests/e2e/fixtures/daemon-helpers.ts` | Reusable helpers: mintDaemonToken, callDaemonApi, seedIssueWithTask | VERIFIED | 210 lines; exports `mintDaemonToken`, `callDaemonApi`, `revokeDaemonToken`, `seedIssueWithTask`, `signUpAndSignIn`, `uniqueName`, `API_BASE` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `routes/daemon.ts` | `middleware/daemon-auth.ts` | `router.use(requireDaemonAuth)` | WIRED | Line 58 of daemon.ts; import at line 3 |
| `routes/daemon.ts` | `services/task-queue-store.ts` | `import { claimTask, startTask, completeTask, failTask, isTaskCancelled }` | WIRED | Line 11-17 of daemon.ts; all 5 functions used in endpoints |
| `routes/daemon.ts` | `services/runtime-registry.ts` | `import { upsertDaemonRuntime, updateHeartbeat, setRuntimeOffline, getById }` | WIRED | Lines 5-9 of daemon.ts; all 4 functions used in register/heartbeat/deregister/claim |
| `routes/daemon-tokens.ts` | `services/daemon-token-store.ts` | `import { issueDaemonToken, listDaemonTokens, revokeDaemonToken }` | WIRED | Lines 3-7 of daemon-tokens.ts; all 3 functions used in POST/GET/DELETE |
| `routes/daemon-tokens.ts` | `middleware/auth.ts` | `router.use(requireAuth)` | WIRED | Line 39 of daemon-tokens.ts; import at line 2 |
| `server-core.ts` | `routes/daemon.ts` | `app.use('/api/daemon', daemonRoutes)` | WIRED | Line 179 of server-core.ts; import at line 59 |
| `server-core.ts` | `routes/daemon-tokens.ts` | `app.use('/api/daemon-tokens', daemonTokenRoutes)` | WIRED | Line 182 of server-core.ts; import at line 60 |
| `daemon-auth.ts` | `daemon_tokens table` | `activeDb('daemon_tokens').where({token_hash}).whereNull('revoked_at').first(...)` | WIRED | Lines 81-85 of daemon-auth.ts; parameterized knex query |
| `daemon-token-store.ts` | `node:crypto` | `randomBytes(24).toString('base64url')` + `createHash('sha256')` | WIRED | Lines 1, 25, 29 of daemon-token-store.ts |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `routes/daemon.ts` POST /register | `created: Runtime[]` | `upsertDaemonRuntime()` → `getRuntimeById()` from runtime-registry.ts | Yes — upsert writes to `runtimes` table, getRuntimeById reads it back | FLOWING |
| `routes/daemon.ts` POST /tasks/claim | `task: ClaimedTask\|null` | `claimTask(runtimeId)` from task-queue-store.ts (BEGIN IMMEDIATE atomic transaction) | Yes — queries `agent_task_queue` with `status='queued'` | FLOWING |
| `routes/daemon-tokens.ts` POST / | `payload: DaemonTokenCreatedResponse` | `issueDaemonToken()` → INSERT into `daemon_tokens` + read-back | Yes — writes row, reads back; `plaintext` is `adt_` + randomBytes(24) | FLOWING |
| `routes/daemon-tokens.ts` GET / | `tokens: DaemonToken[]` | `listDaemonTokens(DEFAULT_WORKSPACE_ID)` → SELECT from `daemon_tokens` | Yes — real DB SELECT filtered by workspace_id | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 62 Phase 19 unit tests pass | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/daemon-auth.test.ts auth-guard.test.ts daemon-token-store.test.ts daemon-routes.test.ts rate-limit.test.ts daemon-tokens-routes.test.ts` | 62 pass, 0 fail, 0 skip | PASS |
| Playwright spec lists 6 tests | `npx playwright test tests/e2e/daemon-rest.spec.ts --list` | 6 tests listed (SC-1..SC-5 + full-story) | PASS |
| AUTH1 guard is case-sensitive and pre-cookie | source assertion in auth-guard.test.ts test 5 reads `auth.ts` and verifies guard index < cookieIdx | passes | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DAEMON-01 | 19-02 | POST /api/daemon/register returns runtime IDs | SATISFIED | `router.post('/register')` in daemon.ts; test 1 in daemon-routes.test.ts |
| DAEMON-02 | 19-02 | POST /api/daemon/heartbeat updates last_heartbeat_at | SATISFIED | `router.post('/heartbeat')` calls `updateHeartbeat(id)`; test 4 in daemon-routes.test.ts |
| DAEMON-03 | 19-02 | POST /api/daemon/deregister marks runtimes offline | SATISFIED | `router.post('/deregister')` calls `setRuntimeOffline(id)`; test 6 in daemon-routes.test.ts |
| DAEMON-04 | 19-02 | POST /api/daemon/runtimes/:id/tasks/claim atomically returns next queued task or null | SATISFIED | `router.post('/runtimes/:id/tasks/claim')` calls `claimTask()`; tests 7-9 including IDOR guard (cross-workspace → 404) |
| DAEMON-05 | 19-02 | POST /api/daemon/tasks/:id/{start,progress,messages,complete,fail} | SATISFIED | 5 sub-endpoints in daemon.ts lines 224-369; tests 10-18 in daemon-routes.test.ts; cancelled-task returns HTTP 200 `{discarded:true}` (TASK-06) |
| DAEMON-06 | 19-02 | GET /api/daemon/tasks/:id/status returns current status | SATISFIED | `router.get('/tasks/:id/status')` at line 372; tests 19-20 in daemon-routes.test.ts |
| DAEMON-07 | 19-01 | All /api/daemon/* routes authenticate via requireDaemonAuth only — cookie JWT rejected | SATISFIED | `router.use(requireDaemonAuth)` as first middleware in daemon.ts; no `requireAuth` anywhere; tests 2-3 assert cookie-only → 401 |
| DAEMON-08 | 19-02 | /api/daemon/* exempt from global 300-req/15-min limiter; per-token ~1000/min quota | SATISFIED (code) | Two skip predicates in server-core.ts (lines 131, 157); daemonBucket limiter with `keyGenerator: (req) => req.daemonAuth?.tokenHash ?? 'anon'` in daemon.ts lines 64-86; rate-limit.test.ts 4 tests pass |
| DAEMON-09 | 19-01 | Tokens prefixed adt_<32>, stored SHA-256, verified via timingSafeEqual | SATISFIED | `generateDaemonTokenPlaintext` = `adt_` + `randomBytes(24).toString('base64url')`; `hashDaemonToken` = sha256 hex; `timingSafeEqual` with length-skew guard at lines 94-102 of daemon-auth.ts; 10 middleware unit tests + 11 store unit tests |
| DAEMON-10 | 19-03 | User can issue/list/revoke daemon tokens; plaintext shown once on creation | SATISFIED | `routes/daemon-tokens.ts` 3 endpoints; POST returns `{token, plaintext}`; GET returns `DaemonToken[]` projection (no hash/plaintext); DELETE soft-revokes; 12 unit tests pass |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `routes/daemon.ts` | 119-121 | `await db('daemon_tokens').where({id}).update({daemon_id})` — direct DB write in route | INFO | Plan-prescribed and documented (19-02 decision log). Lifecycle metadata write not covered by a service; plan's own success criteria acknowledge this as intentional. No real business-logic mutation — solely writes the daemon_id association to the token after registration. Not a blocker. |
| `routes/daemon.ts` | 246-248, 300-303, 375-377 | Direct `db('agent_task_queue')` reads in route handlers (/progress, /messages, /status) | INFO | Plan-prescribed. All are read-only workspace-scope guards to look up `issue_id` for WS routing or `status` for polling. No mutations to task state from within the route. CE1 conventionally disallows DB in routes but plan explicitly calls these out as acceptable exceptions. |
| `routes/daemon-tokens.ts` | 105-106 | `listDaemonTokens()` called inside DELETE handler to check existence before revoke | INFO | Intentional design: `revokeDaemonToken` returns false for both "not found" and "already revoked"; the list-based pre-check lets the route distinguish 404 from 200-idempotent. Minor extra query but not a stub. |
| `tests/e2e/daemon-rest.spec.ts` | 139-163 | `test.skip` guard on SC-3 when not `NODE_ENV=production` | INFO | By design — CI and dev servers run without production-mode rate limiters. Documented in 19-04 plan and spec comments. The skip is not a stub; it's a CI-compatibility mechanism for a test that cannot be automated in standard CI. |

No blocker anti-patterns. No placeholder/TODO stubs in production code.

### Human Verification Required

#### 1. SC-3 Rate-Limit Exemption Full-Duration Poll

**Test:** Start the Express server with `NODE_ENV=production npm run dev`. Run `npx playwright test tests/e2e/daemon-rest.spec.ts -g "SC-3" --headed` or run the inline loop: issue a daemon token, register, then fire 400 rapid requests to `/api/daemon/heartbeat` and count 429s. Then fire 400 requests to `/api/agents` (cookie session) and confirm at least one 429.
**Expected:** All 400 daemon heartbeat requests return 200 (never 429). At least one of the 400 `/api/agents` requests returns 429. The `skip:` predicate in server-core.ts is the mechanism.
**Why human:** The rate limiters (`rateLimit({ max: 300 })`) are guarded by `if (config.nodeEnv === 'production')` in server-core.ts. CI runs with a non-production NODE_ENV. The Playwright test is `test.skip`-guarded. Cannot verify live limiter behavior in this session.

#### 2. SC-5 Hashed-Prefix Display Clarification

**Test:** Navigate to the daemon tokens UI (Phase 25, once shipped) and verify list entries show "hashed prefix" as described in ROADMAP SC-5. For now, call `GET /api/daemon-tokens` manually and confirm no `tokenHash` or `plaintext` fields appear and that `lastUsedAt` is populated after a daemon call.
**Expected:** List response contains `{ id, workspaceId, name, daemonId, createdByUserId, expiresAt, lastUsedAt, revokedAt, createdAt, updatedAt }` — no sensitive fields. "Hashed prefix" display is a UI concern deferred to Phase 25.
**Why human:** The server projection is correct (verified by unit tests). ROADMAP SC-5 mentions "hashed prefix" which is a UI concern for Phase 25 (Daemon Tokens management page). The API layer is complete; human needs to confirm the UI interpretation is understood as Phase 25 scope.

#### 3. Full-Story E2E Against Live Server

**Test:** Start the server with `npm run dev` (port 3001). Run `npx playwright test tests/e2e/daemon-rest.spec.ts`. Expect 5 tests to pass (SC-3 auto-skipped in dev mode), 0 failures, 1 skip.
**Expected:** SC-1 (register-happy), SC-2 (privilege-confusion), SC-4 (revocation-sla), SC-5 (plaintext-once), full-story all pass. SC-3 skipped.
**Why human:** Requires a live Express server on port 3001 with SQLite. Cannot start or connect to servers from within this verification session.

### Gaps Summary

No gaps found. All five ROADMAP success criteria are satisfied by the implemented code:

- SC-1: Daemon bearer auth wired exclusively through `requireDaemonAuth`; cookie-only requests rejected at that middleware before any business logic runs.
- SC-2: AUTH1 guard in `requireAuth` is a synchronous 4-line check that fires before any cookie or DB logic, proven by source-level ordering assertion in auth-guard.test.ts.
- SC-3: Skip predicates present on both `/api/` limiters in server-core.ts and verified by rate-limit.test.ts; full 5-minute manual test is documented as HUMAN-UAT.
- SC-4: `requireDaemonAuth` performs a live DB lookup (no cache) on every request — single SELECT with `whereNull('revoked_at')`; in-process revocation SLA test (< 1000 ms) passes in daemon-tokens-routes.test.ts test 12.
- SC-5: `rowToDaemonToken()` projects only DaemonToken fields; GET handler returns it verbatim; test 6 in daemon-tokens-routes.test.ts asserts the serialized response body contains no `adt_*` substring, no `tokenHash`, `token_hash`, or `plaintext` key.

62/62 unit tests pass. Playwright spec parses to 6 tests. All 10 DAEMON-* requirements traced to implementing code. Status is `human_needed` because SC-3 production-mode runtime behavior and the full-story E2E require a live server.

---

_Verified: 2026-04-16_
_Verifier: Claude (gsd-verifier)_
