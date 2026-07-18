---
phase: 18
plan: 01
subsystem: task-dispatch
tags: [task-queue, sqlite-concurrency, begin-immediate, lifecycle, cancel, unit-tests, node-test]
dependency-graph:
  requires:
    - Phase 15 schema (migration 007 — agent_task_queue + idx_one_pending_task_per_issue_agent)
    - Phase 17 task-queue-store slice (enqueueTaskForIssue + cancel helpers)
    - knexfile.ts pool={min:1, max:1} invariant
  provides:
    - claimTask(runtimeId) — atomic dispatch under BEGIN IMMEDIATE
    - startTask(taskId) — dispatched → running with status guard
    - completeTask(taskId, result) — running → completed with discarded-cancel semantics
    - failTask(taskId, error) — dispatched|running → failed with discarded-cancel semantics
    - cancelTask(taskId) — DB flip to cancelled + task:cancelled WS broadcast
    - isTaskCancelled(taskId) — cheap read surface for daemon/hosted cancel polling
    - Wave-0 test harness (apps/server/tests/unit/test-db.ts) — reused by 18-02, 18-03, Phase 21 BACKEND-07
  affects:
    - Phase 19 will wire /api/daemon/runtimes/:id/tasks/claim + /tasks/:id/complete routes on top of these service fns
    - Phase 19 will consume isTaskCancelled() from the daemon cancel-poll loop (5 s SLA)
    - Phase 20 will consume isTaskCancelled() from HostedTaskWorker
    - Plan 18-02 (task-message-batcher) reuses withImmediateTx helper pattern
    - Plan 18-03 (task-reaper) reuses the Wave-0 test harness
tech-stack:
  added: []
  patterns:
    - "withImmediateTx helper — knex.transaction()-wrapped ROLLBACK + BEGIN IMMEDIATE to work around Knex's hard-coded BEGIN DEFERRED on better-sqlite3"
    - "Dependency-injected Knex override (dbOverride?: Knex) on every exported service fn so unit tests swap the throwaway test DB without mocking"
    - "Service-layer status guards (.andWhere('status', <expected>)) as the lifecycle transition contract; migration 007 CHECK triggers are the schema backstop"
    - "Discarded-completion pattern: read status first, return {discarded:true, status:'cancelled'} on cancelled-race (no throw)"
key-files:
  created:
    - apps/server/tests/unit/test-db.ts
    - apps/server/tests/unit/task-queue.test.ts
    - apps/server/tests/unit/task-message-batcher.test.ts (stub)
    - apps/server/tests/unit/task-reaper.test.ts (stub)
    - apps/server/tests/unit/README.md
  modified:
    - apps/server/src/services/task-queue-store.ts
decisions:
  - "BEGIN IMMEDIATE via ROLLBACK-then-re-BEGIN inside knex.transaction() — keeps pool=1 connection pinning + upgrades txn mode past Knex's deferred default"
  - "task:claimed/task:started events not emitted (frozen TaskEventType union has no such entries); use existing task:dispatch for claim and no separate start event; task:completed/failed/cancelled flow from Plan 18-04 cascade as designed"
  - "Unit tests via node --test + tsx (no Jest/Vitest dependency); matches Phase 21 BACKEND-07 plan and keeps zero dev-dep cost"
  - "dbOverride parameter added to every Phase-18 service fn (breaking the Phase-17 trx-only override) so tests inject a throwaway Knex without needing to wrap every call in a transaction"
metrics:
  tasks_completed: 3
  tests_added: 12 (real) + 9 stubs (for 18-02/18-03 waves)
  files_created: 5
  files_modified: 1
  total_duration: ~25 min
  completed_date: 2026-04-16
---

# Phase 18 Plan 01: Task-Queue Lifecycle (Claim / Start / Complete / Fail / Cancel) Summary

Atomic claim + lifecycle transitions for the agent task queue, plus a reusable Wave-0 unit-test harness shared by Plans 18-02, 18-03, and Phase 21 BACKEND-07. Service functions dispatch work under `BEGIN IMMEDIATE` with a ROLLBACK-then-re-BEGIN dance that upgrades Knex's default deferred transaction past PITFALLS §SQ1's "deferred-upgrade SQLITE_BUSY" trap.

## One-liner

Wave-0 test harness (`test-db.ts`) + extended `task-queue-store.ts` with `claimTask`/`startTask`/`completeTask`/`failTask`/`cancelTask`/`isTaskCancelled`, all wrapped in a `BEGIN IMMEDIATE` txn with status-guarded UPDATEs and TASK-06 discarded-cancel semantics, verified by 12 unit tests including a 20-concurrent claim-coalescing proof.

## What was built

### Task 1 — Wave-0 test harness (commit 0b28ce9)

- `apps/server/tests/unit/test-db.ts` — per-test throwaway SQLite file in `os.tmpdir()`, boot PRAGMAs applied and read back (WAL / busy_timeout=5000 / FK=ON), all migrations run. Seed helpers for `runtime` / `agent` / `issue` / `task` bound to the default `'AQ'` workspace (seeded by migration 003).
- `apps/server/tests/unit/task-queue.test.ts` — initial stub that Task 3 replaced with the 12 real tests.
- `apps/server/tests/unit/task-message-batcher.test.ts` — stub for TASK-03 (Plan 18-02 will implement).
- `apps/server/tests/unit/task-reaper.test.ts` — stub for TASK-04 (Plan 18-03 will implement).
- `apps/server/tests/unit/README.md` — conventions: node --test, tsx, per-test DB isolation, service dbOverride.

### Task 2 — Extended task-queue-store with lifecycle surface (commit c31df32)

Extended `apps/server/src/services/task-queue-store.ts` with six new exports. All writes open with `BEGIN IMMEDIATE`; all WS broadcasts emit AFTER commit.

| Fn | Signature | Transition | Notes |
|----|-----------|------------|-------|
| `claimTask(runtimeId, db?)` | `Promise<ClaimedTask \| null>` | `queued → dispatched` | Inner SELECT respects `agent.max_concurrent_tasks` + `agent.archived_at`; UPDATE adds `.andWhere('status', 'queued')` race guard; emits `task:dispatch` WS |
| `startTask(taskId, db?)` | `Promise<{ started, status }>` | `dispatched → running` | `.andWhere('status', 'dispatched')` guard; returns `{started:false, status: actual}` on race |
| `completeTask(taskId, result, db?)` | `Promise<TerminalResult>` | `running → completed` | Pre-reads status: if `cancelled` → `{discarded:true, status:'cancelled'}` (TASK-06). Other non-running status also `discarded=true` for idempotency |
| `failTask(taskId, error, db?)` | `Promise<TerminalResult>` | `dispatched\|running → failed` | Same discarded-cancel semantics |
| `cancelTask(taskId, db?)` | `Promise<{cancelled, previousStatus}>` | `queued\|dispatched\|running → cancelled` | Emits `task:cancelled` WS after commit; runtime-side abort (SIGTERM / AbortController) deferred to Phase 19 / 20 |
| `isTaskCancelled(taskId, db?)` | `Promise<boolean>` | (read only) | Cheap indexed read; false if task not found |

Also added `withImmediateTx(kx, fn)` helper — the shared write-transaction primitive for this module (see "Deviations from Plan" for the Knex-dance it does).

### Task 3 — Real unit tests (commit a5f76ff)

Replaced the Wave-0 todo stubs in `task-queue.test.ts` with 12 tests covering:

| # | Test | Requirement |
|---|------|-------------|
| 1 | claim: single queued → dispatched exactly once | TASK-01 |
| 2 | claim: 20 concurrent pollers over 5 queued → exactly 5 distinct dispatches | TASK-01 / SC-1 |
| 3 | claim: respects `agent.max_concurrent_tasks=1` cap | AGENT-02 |
| 4 | lifecycle: claim → start → complete happy path | TASK-02 |
| 5 | startTask on queued (not dispatched) returns `started:false` | TASK-02 race guard |
| 6 | completeTask on cancelled → `{discarded:true, status:'cancelled'}` | TASK-06 |
| 7 | failTask on cancelled → `{discarded:true, status:'cancelled'}` | TASK-06 |
| 8 | completeTask on already-completed → idempotent discarded | TASK-06 idempotency |
| 9 | cancelTask on queued flips status; isTaskCancelled returns true | TASK-05 surface |
| 10 | cancelTask on running flips to cancelled | TASK-05 |
| 11 | cancelTask on terminal is no-op | TASK-05 idempotency |
| 12 | isTaskCancelled on unknown id returns false (no throw) | TASK-05 surface |

## Architecture decisions

### Decision 1: `BEGIN IMMEDIATE` via ROLLBACK-then-re-BEGIN inside `knex.transaction()`

**Problem.** The research prescribed `trx.raw('BEGIN IMMEDIATE')` at the top of every `kx.transaction()` callback. In practice this errors with `SqliteError: BEGIN IMMEDIATE - cannot start a transaction within a transaction` — Knex has already emitted a plain `BEGIN;` before the callback runs. Attempting to bypass Knex and issue `kx.raw('BEGIN IMMEDIATE')` on the root instance ALSO fails under concurrency because the second caller runs on the same pool=1 connection that the first caller's IMMEDIATE txn still holds open.

**Resolution.** `withImmediateTx(kx, fn)` wraps Knex's `kx.transaction()` callback, immediately issues `ROLLBACK` to close Knex's default DEFERRED transaction, then issues `BEGIN IMMEDIATE` on the same pinned connection. Knex's connection pool (pool=1) still serialises concurrent callers; the IMMEDIATE upgrade survives for the future reader-worker scenario (PITFALLS §SQ2).

Proof: the 20-concurrent test seeds 5 queued tasks + fires 20 simultaneous `claimTask` calls. Before the fix, the second caller's `BEGIN IMMEDIATE` would throw and the test would fail. After: exactly 5 distinct tasks dispatched, 0 duplicates, 15 `null` returns — matches SC-1 precisely.

### Decision 2: `dbOverride?: Knex` parameter on every Phase-18 service fn

Phase 17 used `trx?: Knex.Transaction` so callers (issue-store) could chain enqueue + cancel in one transaction. Phase 18 functions are terminal (they OPEN their own write transaction via `withImmediateTx`) and cannot be nested, so a `trx` override would be meaningless. Instead, each Phase-18 fn takes an optional `Knex` override so unit tests can inject the throwaway test DB without touching production code.

The default path (`dbOverride` omitted) uses the app singleton `defaultDb` imported from `db/index.ts` — same behaviour as Phase 17.

### Decision 3: No new WS event types; reuse existing enum

The constraint doc mentioned `task:claimed` / `task:started`. The frozen `TaskEventType` union in `packages/shared/src/v14-types.ts:234` has only `task:dispatch | task:progress | task:message | task:completed | task:failed | task:cancelled`. `claimTask` emits `task:dispatch` (matching the enum + the research's §Runtime State Inventory). `startTask` does NOT emit a WS event in Phase 18 — the daemon transitioning dispatched → running is an internal signal; the UI already sees `task:dispatch` and will learn about completion/failure/cancellation via their own events. If a product need for a distinct `task:started` event surfaces, Plan 18-04 or Phase 24 can add it to the enum.

### Decision 4: Node `--test` via `tsx`, not Jest/Vitest

`tsx` is already in `apps/server/package.json` devDependencies (used by the `dev` script). `node:test` is built-in. Zero new deps; matches Phase 21 BACKEND-07 plan. README spells out the conventions for future test files.

## Deviations from plan

### Rule 3 — Fix blocking issue: Knex does not expose IMMEDIATE transactions

**Found during:** Task 3 first test run (`cannot start a transaction within a transaction`).

**Issue:** `trx.raw('BEGIN IMMEDIATE')` inside `kx.transaction()` errors because Knex has already issued `BEGIN;`. Moving the IMMEDIATE to the root `kx` bypassed pool=1 connection pinning and broke concurrent callers.

**Fix:** Introduced `withImmediateTx(kx, fn)` helper that uses `kx.transaction(...)` for pool serialisation + connection pinning, then issues `ROLLBACK` + `BEGIN IMMEDIATE` inside the callback to upgrade the transaction mode. Knex still drives the final COMMIT/ROLLBACK based on callback return/throw.

**Files modified:** `apps/server/src/services/task-queue-store.ts` (added helper; refactored `claimTask`/`startTask`/`completeTask`/`failTask`/`cancelTask` to use it).

**Commit:** `a5f76ff`

### Rule 1 — Fix bug: stale `db` references after import rename

**Found during:** Task 2 when extending the Phase-17 file.

**Issue:** Renaming `import { db } from '../db/index.js'` to `import { db as defaultDb } from '../db/index.js'` left three call sites (`db.fn.now()` × 5, `db.transaction(doEnqueue)`) using the old identifier → TS errors.

**Fix:** Replaced all `db.*` refs in the Phase-17 code path with `defaultDb.*` to match the new import alias.

**Commit:** `c31df32`

### Rule 2 — Add missing unit-test helper coverage

**Found during:** Task 1.

**Issue:** Research specified only `test-db.ts` + stub test files. But ergonomic seeding in tests requires helpers for runtime / agent / issue / task rows (otherwise every test repeats 50 lines of `ctx.db('runtimes').insert(...)`).

**Fix:** Added `seedRuntime` / `seedAgent` / `seedIssue` / `seedTask` exports to `test-db.ts`. Matches the DRY expectation for the 12 tests that followed; also primes 18-02 and 18-03 to reuse them.

**Commit:** `0b28ce9`

## Authentication gates

None encountered. No auth / network / third-party credentials required.

## Test coverage

```bash
$ cd apps/server && npx tsx --test 'tests/unit/*.test.ts'
# 12 pass (real), 6 todo (18-02 + 18-03 stubs)
# duration ~400 ms

$ grep -c "BEGIN IMMEDIATE" apps/server/src/services/task-queue-store.ts
# 12 (requirement: ≥ 5)

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium
# exit 0
```

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `0b28ce9` | test(18-01): add Wave 0 test harness + Phase-18 unit test stubs |
| 2 | `c31df32` | feat(18-01): add task-queue lifecycle (claim/start/complete/fail/cancel) |
| 3 | `a5f76ff` | test(18-01): add unit tests for claim/lifecycle/discard + fix BEGIN IMMEDIATE |

## Known stubs

The following files are stubs and will be fully implemented in later plans:

| Stub | Plan | Reason |
|------|------|--------|
| `apps/server/tests/unit/task-message-batcher.test.ts` | 18-02 | TASK-03 (streaming seq batcher) lives in Plan 18-02 |
| `apps/server/tests/unit/task-reaper.test.ts` | 18-03 | TASK-04 (periodic reaper) lives in Plan 18-03 |

These stubs currently contain only `test.todo(...)` placeholders and do not block the build — they exist so the Wave-0 test-db fixture is already in place when 18-02 and 18-03 start executing in parallel.

## Self-Check: PASSED

- `apps/server/tests/unit/test-db.ts` — FOUND
- `apps/server/tests/unit/task-queue.test.ts` — FOUND (≥ 5 test blocks; 12 real)
- `apps/server/tests/unit/task-message-batcher.test.ts` — FOUND (stub)
- `apps/server/tests/unit/task-reaper.test.ts` — FOUND (stub)
- `apps/server/tests/unit/README.md` — FOUND
- `apps/server/src/services/task-queue-store.ts` — MODIFIED (claimTask/startTask/completeTask/failTask/cancelTask/isTaskCancelled added)
- Commit `0b28ce9` — FOUND
- Commit `c31df32` — FOUND
- Commit `a5f76ff` — FOUND
- `grep -c "BEGIN IMMEDIATE" apps/server/src/services/task-queue-store.ts` = 12 (≥ 5)
- `npx tsx --test apps/server/tests/unit/task-queue.test.ts` → 12 pass / 0 fail / 0 todo
- `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` → exit 0
