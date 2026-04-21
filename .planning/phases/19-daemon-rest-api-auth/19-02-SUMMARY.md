---
phase: 19-daemon-rest-api-auth
plan: 02
subsystem: daemon-rest
tags: [express, express-rate-limit, bearer-token, ratelimit, rest-api, workspace-scoping, websocket, idempotency]

# Dependency graph
requires:
  - phase: 19-daemon-rest-api-auth
    plan: "01"
    provides: requireDaemonAuth middleware + req.daemonAuth payload (tokenId/workspaceId/daemonId/tokenHash) + __setDaemonAuthDbForTests__ hook
  - phase: 16-runtime-registry-runtime-bridge
    provides: upsertDaemonRuntime / updateHeartbeat / setRuntimeOffline / getById — consumed unchanged
  - phase: 18-task-queue-dispatch
    provides: claimTask / startTask / completeTask / failTask / isTaskCancelled + TerminalResult + task-message-batcher appendTaskMessage
provides:
  - /api/daemon/register  (DAEMON-01) — upserts Runtime rows per provider and persists daemon_id on the token
  - /api/daemon/heartbeat (DAEMON-02) — touches last_heartbeat_at; 409 when daemonId is null
  - /api/daemon/deregister (DAEMON-03) — flips daemon runtimes to offline
  - /api/daemon/runtimes/:id/tasks/claim (DAEMON-04) — workspace-scoped IDOR guard + claimTask delegation
  - /api/daemon/tasks/:id/start (DAEMON-05a)
  - /api/daemon/tasks/:id/progress (DAEMON-05b) — WS-only, no DB write (Q4)
  - /api/daemon/tasks/:id/messages (DAEMON-05c) — batch ingest via appendTaskMessage, 100-msg / 64-KB cap
  - /api/daemon/tasks/:id/complete (DAEMON-05d) — HTTP 200 + { discarded: true } on cancel race (TASK-06)
  - /api/daemon/tasks/:id/fail (DAEMON-05e) — same discarded semantics
  - /api/daemon/tasks/:id/status (DAEMON-06) — read status + cancelled flag
  - daemonBucket rate-limiter (1000 req / 60s, keyed by tokenHash) mounted after requireDaemonAuth
  - Two skip predicates on the global /api/ rate-limiters in server-core.ts (static + dynamic)
  - Proxy-based db/index.ts with __setDbForTests__ / __resetDbForTests__ hooks
affects:
  - 19-03 (daemon-tokens user routes — will rely on /api/daemon mount being present for E2E proof)
  - 19-04 (E2E test wave — Playwright can now call the 10 daemon endpoints over HTTP)
  - 20-hosted-runtime-worker (HostedTaskWorker will reuse the same service dispatch path — claim/start/complete — so HTTP-layer semantics here are the reference)
  - 21-daemon-cli (CLI consumes all 10 endpoints verbatim)

# Tech tracking
tech-stack:
  added: []  # all primitives already installed (express-rate-limit@8.3.2, node:http, express@4)
  patterns:
    - thin-HTTP-wrapper — every endpoint delegates to Phase 16/17/18 services; route-level DB reads are limited to workspace-scope guards (issue_id for WS routing, status for polling) and one UPDATE on daemon_tokens for daemon_id lifecycle
    - ApiResponse<T> with `satisfies` — 34 occurrences in routes/daemon.ts, pinning every response body shape against shared types at the type layer
    - skip predicate on server-wide rate-limiters — daemon traffic is exempted from both the static and dynamic /api/ limiters via `req.originalUrl.startsWith('/api/daemon/')`
    - per-token rate-limit bucket via keyGenerator — tokenHash-keyed bucket means a stolen token can only flood its own 1000-req window, never the whole server
    - HTTP 200 for idempotent-race outcomes — { discarded: true } on complete/fail-of-cancelled never maps to 4xx (TASK-06 contract)
    - Proxy-based db singleton for test swappability — preserves `db()` callable + `db.fn.now()` / `db.raw()` / `db.transaction()` property access while letting unit tests swap the underlying knex without changing 44 consumer import sites

key-files:
  created:
    - apps/server/src/routes/daemon.ts
    - apps/server/tests/unit/daemon-routes.test.ts
    - apps/server/tests/unit/rate-limit.test.ts
  modified:
    - apps/server/src/server-core.ts (adds skip predicate on static limiter, wraps dynamic limiter with skip, mounts daemon routes)
    - apps/server/src/db/index.ts (replaces `export const db = knex(config)` with a Proxy + __setDbForTests__/__resetDbForTests__ hooks so route-layer services that import the singleton directly (runtime-registry, instance-manager, …) can be pointed at a throwaway SQLite fixture from unit tests)

key-decisions:
  - "Rate-limiter topology: 2 skip predicates + 1 per-token bucket (1000 req/60s keyed by tokenHash). Guarded by NODE_ENV=production to match existing server-core pattern"
  - "Batch cap on /messages: 100 messages OR 64KB JSON (whichever first). 413 on overflow. Pairs with Phase 18 BUFFER_SOFT_CAP=500 in the batcher"
  - "/heartbeat returns 409 when req.daemonAuth.daemonId is null — forces correct /register lifecycle (Q8 lock-in)"
  - "/progress is WS-only: no DB write (Phase 15 schema has no progress column). Verified with before/after updated_at assertion"
  - "Workspace-scoped IDOR guard: every URL-carried runtime/task id is resolved via a workspace-filtered SELECT before dispatching to the service (404 on mismatch)"
  - "`{ discarded: true }` from completeTask/failTask returns HTTP 200 — never 4xx. The daemon is reporting truthfully; the server just dropped the state change because the task was already cancelled"
  - "Proxy-backed db/index.ts is the test-swap vector, not a per-service `dbOverride` parameter. Smaller diff (1 file vs rewiring 4 service signatures) and lets Phase 16/17/18 services stay byte-identical"
  - "Fallback keyGenerator returns a fixed 'anon' string (not req.ip) to avoid the express-rate-limit ipv6-bypass validator false positive — in practice req.daemonAuth is always populated because requireDaemonAuth runs first"

patterns-established:
  - "Route-level workspace-scope guard: `const row = await db('tbl').where({id, workspace_id: req.daemonAuth.workspaceId}).first()` before any mutation or delegation — cross-workspace id → 404"
  - "Read-only route DB calls for WS routing: fetch issue_id once, hand it to broadcast(), never mutate"
  - "satisfies ApiResponse<T> on every response body — uses inline object-literal type so the response shape is checked against the ApiResponse contract at the call site"
  - "Discarded-result routes pattern: service returns `{ discarded: boolean, status }`; route forwards as ApiResponse<TerminalResult> with HTTP 200; /fail wraps error string from req.body"

requirements-completed: [DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, DAEMON-08]

# Metrics
duration: ~25min
completed: 2026-04-16
---

# Phase 19 Plan 02: Daemon REST Endpoints + Rate-Limit Topology Summary

**Ships 10 daemon-auth REST endpoints under `/api/daemon/*` with per-token rate limiting and two skip predicates on the global `/api/` limiters — no new business logic; every endpoint is a thin HTTP wrapper over Phase 16/17/18 services.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (both TDD: RED tests written → GREEN implementation)
- **Files modified:** 5 (3 created + 2 modified)
- **Commits:** 2 per-task + 1 docs commit

## Accomplishments

- 10 daemon REST endpoints shipped under `/api/daemon/*`, all gated by `router.use(requireDaemonAuth)` from Plan 19-01.
- Every endpoint workspace-scoped: URL-carried runtime/task ids are resolved against `req.daemonAuth.workspaceId` before dispatching to service calls (AUTH4 IDOR guard — cross-workspace ids → 404).
- Per-token rate-limit bucket (`daemonBucket`) mounted AFTER `requireDaemonAuth` — 1000 req / 60s keyed by `tokenHash`. A stolen token floods only its own bucket, not the user UI's limiter.
- Both global `/api/` limiters in `server-core.ts` now skip `/api/daemon/*`: the static limiter via `skip:` predicate, the dynamic limiter via a `if (originalUrl...) next(); else dynamicGeneralLimiter(...)` wrapper.
- `{ discarded: true }` on complete/fail-of-cancelled returns HTTP 200 (TASK-06 contract): the daemon's truthful report is never 4xx'd.
- `/messages` batch caps: 100 messages OR 64KB JSON (whichever triggers first), 413 on overflow — pairs with Phase 18's `BUFFER_SOFT_CAP=500` in the batcher.
- `/progress` endpoint is WS-only: no DB mutation (Phase 15 has no `progress` column). Verified by before/after `updated_at` assertion.
- `/heartbeat` returns 409 when `req.daemonAuth.daemonId` is null — enforces the `/register` → `/heartbeat` lifecycle (Q8).
- 24 unit tests green (20 daemon-routes + 4 rate-limit) covering every behaviour in `must_haves.truths`; 52 pre-existing tests still green (no regressions).

## Endpoint Signatures

| # | Req ID | Method | Path | Request body | Response body |
|---|--------|--------|------|--------------|---------------|
| 1 | DAEMON-01 | POST | `/api/daemon/register` | `DaemonRegisterRequest` | `ApiResponse<DaemonRegisterResponse>` = `{ ok, data: { runtimes: Runtime[] } }` |
| 2 | DAEMON-02 | POST | `/api/daemon/heartbeat` | `{ runtimeIds: string[] }` | `ApiResponse<{ pendingPings: unknown[], pendingUpdates: unknown[] }>` |
| 3 | DAEMON-03 | POST | `/api/daemon/deregister` | `{ runtimeIds: string[] }` | `ApiResponse<{ ok: boolean }>` |
| 4 | DAEMON-04 | POST | `/api/daemon/runtimes/:id/tasks/claim` | (empty) | `ApiResponse<{ task: ClaimedTask \| null }>` |
| 5 | DAEMON-05a | POST | `/api/daemon/tasks/:id/start` | (empty) | `ApiResponse<{ started: boolean, status: TaskStatus }>` |
| 6 | DAEMON-05b | POST | `/api/daemon/tasks/:id/progress` | `{ progress?: number, note?: string }` | `ApiResponse<{ ok: boolean }>` |
| 7 | DAEMON-05c | POST | `/api/daemon/tasks/:id/messages` | `{ messages: PendingTaskMessage[] }` | `ApiResponse<{ accepted: number }>` |
| 8 | DAEMON-05d | POST | `/api/daemon/tasks/:id/complete` | `{ result?: unknown }` | `ApiResponse<TerminalResult>` |
| 9 | DAEMON-05e | POST | `/api/daemon/tasks/:id/fail` | `{ error?: string }` | `ApiResponse<TerminalResult>` |
|10 | DAEMON-06 | GET | `/api/daemon/tasks/:id/status` | — | `ApiResponse<{ status: TaskStatus, cancelled: boolean }>` |

`TerminalResult = { discarded: boolean, status: TaskStatus }`. All endpoints use `satisfies ApiResponse<...>` on the JSON body so the shape is type-checked against the shared contract at the call site.

## Rate-Limiter Topology Change

**Before** (server-core.ts, production only):

```ts
// Static: 300 req / 15 min, IP-keyed
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 300, ... }));

// Dynamic: admin-configurable, IP-keyed
app.use('/api/', dynamicGeneralLimiter);
```

**After**:

```ts
// Static: same bucket, but /api/daemon/* skipped
app.use('/api/', rateLimit({
  windowMs: 15*60*1000,
  max: 300,
  ...,
  skip: (req) => req.originalUrl.startsWith('/api/daemon/'),
}));

// Dynamic: wrapped so /api/daemon/* bypasses, user routes still hit the limiter
app.use('/api/', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/daemon/')) { next(); return; }
  dynamicGeneralLimiter(req, res, next);
});

// Mount daemon routes
app.use('/api/daemon', daemonRoutes);
```

**And inside `routes/daemon.ts`** (mounted AFTER `requireDaemonAuth` so tokenHash is populated):

```ts
const daemonBucket = rateLimit({
  windowMs: 60*1000,
  limit: 1000,
  validate: { ..., keyGeneratorIpFallback: false },
  keyGenerator: (req) => req.daemonAuth?.tokenHash ?? 'anon',
});
if (process.env.NODE_ENV === 'production') {
  router.use(daemonBucket);
}
```

Stolen-token DDoS isolation is verified by `rate-limit.test.ts::per-token bucket ...` — token A saturates its bucket at limit=2 and gets 429, while token B's bucket is independent and still accepts requests.

## Test Counts

| Suite | Tests | Duration |
|-------|-------|----------|
| `daemon-routes.test.ts` | 20 | ~900ms |
| `rate-limit.test.ts` | 4 | ~450ms |
| **Total new** | **24** | **~1.3s** |

Regression check:
- `task-queue.test.ts` — 20 tests green
- `daemon-auth.test.ts` — 10 tests green
- `daemon-token-store.test.ts` — 11 tests green
- `auth-guard.test.ts` — 5 tests green
- `task-message-batcher.test.ts` — 4 tests green
- `task-reaper.test.ts` — 2 tests green
- **Total regression: 52 tests green, 0 broken.**

## Task Commits

1. **Task 1: routes/daemon.ts + daemon-routes.test.ts (20 tests)** — `43cdad8` (feat)
   - RED: 20 supertest-style tests written, expected module-not-found.
   - GREEN: 10 endpoints + `daemonBucket` shipped, all 20 tests pass, typecheck clean.
   - Incidental: `db/index.ts` converted to Proxy + `__setDbForTests__` hook (needed because `runtime-registry` doesn't accept a `dbOverride`). No behaviour change in production — the Proxy transparently delegates to the same singleton.
2. **Task 2: server-core.ts wiring + rate-limit.test.ts (4 tests)** — `3afbfaf` (feat)
   - RED: 4 rate-limit tests written and green BEFORE server-core change (they are pure unit tests over the library; they pin the behaviour contract).
   - GREEN: three surgical edits — skip on static limiter, wrapper on dynamic limiter, mount daemon routes. All 24 new tests + 52 pre-existing tests green.

## Decisions Made

- **`db/index.ts` Proxy (deviation from plan's literal prescription).** Plan 19-02 Task 1 action block said "Check `apps/server/src/db/index.ts` for a `__setDbForTests__` helper; if none exists, ADD it as part of this task." The original file was `export const db = knex(knexConfig)`. A literal `__setTestDb__(kx)` export cannot swap a live `const`-bound knex instance across 44 consumer modules (ES modules freeze imported bindings). Solution: wrap the active knex in a Proxy with `apply` (for `db(table)` calls) + `get` (for `db.fn`, `db.raw`, `db.transaction`, `db.schema`, `db.migrate` access). Tests call `__setDbForTests__(ctx.db)` once, all consumers transparently see the test fixture. Zero production behaviour change.
- **Batch cap values: 100 msgs / 64KB.** 64KB is ~5× an average streamed message body (tool-use JSON with code snippets). 100 is 20% of Phase 18's `BUFFER_SOFT_CAP=500` — one HTTP batch fits 5× inside the batcher buffer.
- **daemonBucket fallback key: `'anon'` not `req.ip`.** `express-rate-limit@8.3.2` validates that a custom `keyGenerator` doesn't use `req.ip` without the `ipKeyGenerator` helper (ipv6 bypass concern). Our key is the SHA-256 hex tokenHash — never an IP — so we disable `keyGeneratorIpFallback` validation and fall back to `'anon'` in the impossible case `req.daemonAuth` is missing. `anon` is a single shared bucket (intentional — unauthenticated traffic should never reach this middleware anyway).
- **Route-level DB access (CE1 deviation, documented).** The plan's `<action>` prescribes direct `db('daemon_tokens').update(...)` on /register (daemon_id lifecycle metadata, no existing service wraps it), `db('agent_task_queue').first('issue_id')` on /progress and /messages (read-only WS routing), and `db('agent_task_queue').first('status')` on /status (core of the endpoint). These are either read-only guards or lifecycle metadata writes — the plan's own `<success_criteria>` acknowledges this: "progress reads issue_id for WS fan-out only; messages reads issue_id once — both read-only, no mutation." The external SC check `grep -c "db(" returns 0` is stricter than the plan; the 4 occurrences in `routes/daemon.ts` are all plan-prescribed.

## Deviations from Plan

**1. [Rule 2 — Missing critical functionality] Added db swap hook via Proxy instead of export const rebinding**
- **Found during:** Task 1 RED → GREEN
- **Issue:** Plan says "Add a test-only `__setTestDb__(kx)` exporter in `apps/server/src/db/index.ts`". But `export const db = knex(knexConfig)` is a live binding across 44 consumer modules and cannot be rebound from inside the module.
- **Fix:** Proxy-wrap the active knex instance. `__setDbForTests__(kx)` swaps the underlying reference; the exported `db` Proxy transparently routes `apply`/`get` traps to the active instance.
- **Files modified:** `apps/server/src/db/index.ts`
- **Commit:** `43cdad8` (Task 1 commit)

**2. [Rule 3 — Blocking issue] Disabled express-rate-limit `keyGeneratorIpFallback` validator**
- **Found during:** Task 1 GREEN (first test run)
- **Issue:** `express-rate-limit@8.3.2` prints a validation warning (`ERR_ERL_KEY_GEN_IPV6`) at `rateLimit(...)` init because our `keyGenerator` returned `req.daemonAuth?.tokenHash ?? req.ip ?? 'unknown'`.
- **Fix:** Added `validate: { keyGeneratorIpFallback: false }` + changed fallback from `req.ip` to `'anon'`. The library's concern is ipv6 bypass via partial-address keys — our key is a 64-char hex token hash, never an IP.
- **Files modified:** `apps/server/src/routes/daemon.ts`
- **Commit:** `43cdad8` (Task 1 commit)

**3. [Scope noted, not a deviation] `RuntimeDeviceInfo` field mapping**
- **Found during:** Task 1 typecheck
- **Issue:** Plan shows `deviceInfo = { deviceName, cliVersion, launchedBy }` but `RuntimeDeviceInfo` (packages/shared/v14-types.ts:36) uses `{ os?, hostname?, arch?, version? }`.
- **Fix:** Mapped `deviceName → hostname`, `cliVersion → version`. `launchedBy` is informational — Phase 21 (daemon CLI) can revisit if needed.
- **Files modified:** `apps/server/src/routes/daemon.ts`
- **Commit:** `43cdad8` (Task 1 commit)

No plan-level behaviour was compromised by any of the above.

## Issues Encountered

- **express-rate-limit eager validation** — the library validates the `keyGenerator` / fallback at `rateLimit({...})` construction time, not at first-request time. This means even when `process.env.NODE_ENV !== 'production'` (so the bucket isn't mounted) the validator still runs. Fixed by passing `validate: { keyGeneratorIpFallback: false }` and using a non-IP fallback.
- **No regressions in pre-existing tests.** Ran all 52 unit tests from Phase 16/17/18/19-01 — all pass.

## User Setup Required

None. No external configuration required — the daemon bucket and skip predicates activate automatically when `NODE_ENV=production`; in dev/test the endpoints respond without rate limiting.

## Next Plan Readiness

- **19-03 (daemon-tokens user routes)** unblocked: `/api/daemon` mount is active; the issue/list/revoke endpoints from 19-01's service can now be wired to `/api/daemon-tokens`.
- **19-04 (E2E test wave)** unblocked: Playwright can call the 10 daemon endpoints over HTTP end-to-end; the `seedDaemonToken` helper from 19-01 is the bearer-fixture producer.

## Self-Check: PASSED

Created files verified present:
- `apps/server/src/routes/daemon.ts` — FOUND (349 lines)
- `apps/server/tests/unit/daemon-routes.test.ts` — FOUND
- `apps/server/tests/unit/rate-limit.test.ts` — FOUND

Modified files verified:
- `apps/server/src/server-core.ts` — FOUND (skip on static, wrapper on dynamic, mount)
- `apps/server/src/db/index.ts` — FOUND (Proxy + test hooks)

Commits verified in `git log`:
- `43cdad8` — FOUND (Task 1: daemon routes + 20 tests)
- `3afbfaf` — FOUND (Task 2: server-core wiring + 4 rate-limit tests)

Acceptance criteria all green:
- `router.use(requireDaemonAuth)` in daemon.ts: 1 occurrence (=1 required)
- 10 endpoint definitions (register, heartbeat, deregister, claim, start, progress, messages, complete, fail, status): all present
- `keyGenerator` in daemon.ts: 3 occurrences (>=1 required)
- `daemonBucket` in daemon.ts: 2 occurrences (>=1 required)
- `satisfies ApiResponse` in daemon.ts: 34 occurrences (>=10 required)
- `skip:` in server-core.ts: 1 occurrence (>=1 required)
- `/api/daemon/` in server-core.ts: 6 occurrences (>=2 required)
- `originalUrl.startsWith('/api/daemon/')` in server-core.ts: 2 occurrences (>=2 required)
- `import daemonRoutes` in server-core.ts: 1 occurrence (=1 required)
- `app.use('/api/daemon',` in server-core.ts: 1 occurrence (=1 required)
- 20/20 daemon-routes tests pass
- 4/4 rate-limit tests pass
- 52/52 pre-existing tests pass (no regressions)
- `npm run typecheck -w @aquaclawai/aquarium` exits 0
- `npm run build -w @aquarium/shared` exits 0

Note on prompt's `grep -c "db(" returns 0` criterion: the plan's action block explicitly prescribes 4 route-level db calls (`/register` daemon_id UPDATE, `/progress` issue_id read, `/messages` issue_id read, `/status` status read — all documented in the plan's success criteria as "read-only, no mutation" or lifecycle metadata). These are intentional and plan-authoritative.

---
*Phase: 19-daemon-rest-api-auth*
*Completed: 2026-04-16*
