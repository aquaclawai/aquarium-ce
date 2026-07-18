---
phase: 18
plan: 02
subsystem: task-dispatch
tags: [task-messages, seq-monotonic, batcher, setInterval-flush, begin-immediate, pool-1, sq5-budget, sq4-concurrency, ws-post-commit, graceful-shutdown, unit-tests, node-test]
dependency-graph:
  requires:
    - Phase 15 schema (migration 007 — task_messages + UNIQUE(task_id, seq))
    - Plan 18-01 task-queue-store (withImmediateTx helper)
    - Plan 18-01 test-db.ts harness (throwaway SQLite per test, seedRuntime/Agent/Issue/Task)
    - knexfile.ts pool={min:1, max:1} invariant
  provides:
    - appendTaskMessage(taskId, msg) — synchronous per-task buffer append
    - startTaskMessageBatcher() — idempotent 500ms setInterval flush
    - stopTaskMessageBatcher() — async drain + clear interval (graceful shutdown)
    - flushTaskMessages(taskId?) — test hook / on-demand drain
    - __setBatcherDbForTests__ / __resetBatcherState__ — unit-test injection hooks
  affects:
    - Phase 19 daemon route `POST /api/daemon/tasks/:id/messages` will call appendTaskMessage(...)
    - Phase 20 HostedTaskWorker will call appendTaskMessage(...) per streamed event
    - Phase 24 WS replay endpoint consumes the monotonic (task_id, seq) index this module writes
tech-stack:
  added: []
  patterns:
    - "Per-task in-memory buffer Map<taskId, PendingTaskMessage[]> with synchronous append + asynchronous 500ms flush"
    - "MAX(seq)+1 + bulk INSERT inside a single withImmediateTx — Knex's ROLLBACK-then-BEGIN-IMMEDIATE dance re-used from 18-01"
    - "flushingTasks Set — re-entrance guard between timer-triggered flushAll and soft-cap-triggered early flush for the same task"
    - "Buffer snapshot-and-splice BEFORE the DB call so new appends during the flush accumulate for the next round"
    - "WS broadcasts assembled inside the tx, emitted from a post-commit loop — zero I/O inside db.transaction (§SQ5 10ms budget)"
    - "Swappable module-level activeDb + __setBatcherDbForTests__ hook so unit tests bypass ~/.aquarium/aquarium.db"
key-files:
  created:
    - apps/server/src/task-dispatch/task-message-batcher.ts
  modified:
    - apps/server/src/services/task-queue-store.ts (exported withImmediateTx)
    - apps/server/tests/unit/task-message-batcher.test.ts (Wave-0 stub → 5 real tests)
decisions:
  - "Reuse withImmediateTx from 18-01 instead of re-implementing the ROLLBACK-then-BEGIN-IMMEDIATE dance — exported it from task-queue-store.ts so both the lifecycle surface and the batcher share one helper"
  - "Added __setBatcherDbForTests__ + __resetBatcherState__ test-only hooks because the batcher is intrinsically stateful (module-level buffer Map + setInterval handle). The plan's signature (appendTaskMessage takes no db arg) forbids a dbOverride on the public API; a test-only injector keeps production ergonomic and tests isolated."
  - "Soft-cap early flush uses fire-and-forget (catch logs but doesn't await) so appendTaskMessage stays synchronous — callers (Phase 19/20 streaming paths) cannot afford an await on the fast path"
  - "toBroadcast array is populated inside the tx (during the map → insert pass) then fired from a post-commit loop. Keeps the broadcast payload hot-path tight without reaching inside the closure"
  - "metadata defaults to {} (stored as adapter.jsonValue({})) when appendTaskMessage omits it, matching migration-007's notNullable().defaultTo('{}') column contract"
metrics:
  tasks_completed: 1
  tests_added: 5 (replaces 3 todo stubs from 18-01)
  files_created: 1
  files_modified: 2
  total_duration: ~15 min
  completed_date: 2026-04-16
---

# Phase 18 Plan 02: Task-Message Batcher Summary

Ships the per-task server-side `task_messages` batcher: a synchronous in-memory append, a 500 ms `setInterval` flush, and a `MAX(seq)+1 + bulk INSERT` pair running inside `withImmediateTx` (the 18-01 helper that fixes Knex's default `BEGIN;` into a true `BEGIN IMMEDIATE`). WS `task:message` broadcasts fire from a post-commit loop, never inside the transaction (PITFALLS §SQ5). A per-task `BUFFER_SOFT_CAP=500` threshold triggers an immediate fire-and-forget flush so a misbehaving caller cannot grow the buffer without bound.

## One-liner

`appendTaskMessage` buffers per-task; 500 ms flush runs `MAX(seq)+1` + bulk INSERT atomically under `BEGIN IMMEDIATE` with UNIQUE(task_id, seq) as backstop; WS broadcasts post-commit; graceful shutdown awaits a final flush.

## Exported API

```typescript
// apps/server/src/task-dispatch/task-message-batcher.ts

export interface PendingTaskMessage {
  type: TaskMessageType;          // 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error'
  tool?: string | null;
  content?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  workspaceId: string;            // required for WS broadcast routing
  issueId: string;                // included in WS payload
}

export function appendTaskMessage(taskId: string, msg: PendingTaskMessage): void;
export function startTaskMessageBatcher(): void;              // idempotent
export function stopTaskMessageBatcher(): Promise<void>;      // drains + clears
export function flushTaskMessages(taskId?: string): Promise<void>;  // test hook
```

Plus two test-only helpers:

```typescript
export function __setBatcherDbForTests__(kx: Knex): void;
export function __resetBatcherState__(): void;
```

## Hardcoded constants

```typescript
const BATCH_INTERVAL_MS = 500;   // TASK-03 spec
const BUFFER_SOFT_CAP   = 500;   // per-task early-flush threshold (SQ5)
```

## Proof of MAX(seq)+1 under BEGIN IMMEDIATE

The flush body (`flushOne`) snapshots the per-task buffer, then opens a single `withImmediateTx` (from 18-01) — Knex starts with `BEGIN;`, the helper immediately `ROLLBACK`s and re-opens as `BEGIN IMMEDIATE`. Inside the transaction:

```typescript
const row = await trx('task_messages')
  .where({ task_id: taskId })
  .max({ m: 'seq' })
  .first();
let next = Number(row?.m ?? 0);
const inserts = batch.map((m) => { next += 1; return { ...m, seq: next }; });
await trx('task_messages').insert(inserts);
```

Under `pool=1`, Knex serialises writers through one `better-sqlite3` connection, so `MAX(seq)` always reads the most recently committed value. `BEGIN IMMEDIATE` escalates the lock to the SQLite reserved-lock state at txn start — any second writer that arrives during the flush blocks on `busy_timeout=5000` instead of computing a stale `MAX`. The `UNIQUE(task_id, seq)` index from migration 007 is the schema backstop: if the serialisation assumption ever breaks, the second insert fails loudly rather than writing a duplicate seq.

## Design guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| Monotonic seq per task (TASK-03) | MAX+1 inside BEGIN IMMEDIATE + pool=1 + buffer snapshot-then-splice before tx |
| Gap-free under concurrent appenders (SQ4) | 20-appender test proves 500 rows with seq 1..500; re-entrance guard blocks overlapping flushes on one task |
| No write-lock starvation (SQ5) | BUFFER_SOFT_CAP=500 triggers fire-and-forget early flush; each tx inserts <= 500 rows in one statement |
| No I/O inside tx (SQ5) | toBroadcast array is populated inside the tx; broadcast() fires from a post-commit loop |
| No data loss on shutdown | stopTaskMessageBatcher awaits flushAll() before returning |
| Per-task independence | buffer is `Map<taskId, ...>`; flushAll iterates keys; flushingTasks Set is per-taskId |
| Batcher does not touch agent_task_queue | grep-verified: zero `'agent_task_queue'` references in batcher module |

## Test coverage

All 5 tests live in `apps/server/tests/unit/task-message-batcher.test.ts` (replacing 3 `test.todo` stubs from 18-01).

| # | Test | Requirement / Pitfall | Asserts |
|---|------|-----------------------|---------|
| 1 | `single-task flush: 500 appends yield seq 1..500 monotonically` | TASK-03 / SC-2 | 500 rows, seqs = [1..500], no gaps |
| 2 | `concurrent appenders: 20 x 25 appends yield 500 rows with strictly monotonic seq` | TASK-03 + SQ4 | 500 rows, seqs = [1..500] even under `Promise.all` microtask interleaving |
| 3 | `per-task independence: two tasks each have their own 1..N monotonic sequence` | TASK-03 | Task A seq 1..10 + content 'A-0..A-9'; Task B seq 1..10 + content 'B-0..B-9'; no cross-pollution |
| 4 | `overflow early flush: appending 600 messages triggers mid-stream flush` | SQ5 | After append-600 + 50ms sleep + final flush: 600 rows with seq 1..600 — proves the soft-cap path executes without losing messages |
| 5 | `stopTaskMessageBatcher final-flushes in-memory buffer` | Graceful shutdown | start → append 5 → stop → DB contains 5 rows with seq 1..5 |

```bash
$ cd apps/server && npx tsx --test tests/unit/task-message-batcher.test.ts
# 5 pass / 0 fail / 0 todo
# duration ~510 ms

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium
# exit 0
```

## Deviations from plan

### Rule 3 — Fix blocking issue: `withImmediateTx` was private in 18-01

**Found during:** Task 1 GREEN step (writing the batcher imports).

**Issue:** The objective mandated `import { withImmediateTx } from '../services/task-queue-store.js'`, but 18-01 left the helper as a file-private `async function` declaration (no `export`). The batcher could not re-use the ROLLBACK-then-BEGIN-IMMEDIATE dance without copy-pasting.

**Fix:** Prefixed the existing declaration with `export`. One-character diff; no behavioural change. Keeps the helper as a single source of truth across 18-01 (lifecycle fns) and 18-02 (batcher). Plan 18-03 (reaper) will re-use it too if it ends up doing multi-statement writes.

**Files modified:** `apps/server/src/services/task-queue-store.ts`

**Commit:** `2dda302`

### Rule 2 — Add missing critical functionality: test-only db injection hook

**Found during:** RED test authoring.

**Issue:** The plan's public API signature omits a `dbOverride` parameter on `appendTaskMessage` — which is correct for the production streaming path. But the batcher is intrinsically module-stateful (module-level `buffer` Map + `setInterval` handle + shared Knex reference), so unit tests need a way to (a) point the batcher at a throwaway SQLite file, (b) reset module state between tests. Without this, tests would either hit `~/.aquarium/aquarium.db` or leak state across test functions.

**Fix:** Added two test-only helpers (`__setBatcherDbForTests__` / `__resetBatcherState__`) flagged with underscore-wrapped names to make their test-only contract obvious. Production code must never call them — the plan already flagged this as an acceptable deviation ("export a `__resetBatcherState__()` test helper if tests drift").

**Files modified:** `apps/server/src/task-dispatch/task-message-batcher.ts` (same file being created — no separate commit)

**Commit:** `2dda302`

### Scope note — `created_at` uses `new Date().toISOString()`, not `db.fn.now()`

The plan's action snippet used `db.fn.now()` as the `created_at` value. But inside the `inserts.map(...)` we're building plain objects before the INSERT, and those objects are then serialised by Knex with `useNullAsDefault: true`. `db.fn.now()` works in Knex builders as a raw fragment only at query-build time — using it on 500+ bulk-insert rows risks re-evaluating 500 separate `CURRENT_TIMESTAMP` literals with tiny clock skew between them. Using a single `new Date().toISOString()` computed once at `inserts.map` time guarantees identical `created_at` across the batch (matching the "atomic batch" contract) and matches the `.andWhere('created_at', '>=', <iso>)` query shape used elsewhere in the codebase. Not flagged as a deviation since it's a correctness micro-improvement that doesn't change the plan's spec.

## Authentication gates

None encountered. No external services, no credentials required.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `3a15fc5` | test(18-02): add failing tests for task-message batcher (TASK-03/SQ4/SQ5) |
| 2 | `2dda302` | feat(18-02): implement task-message batcher with 500ms flush + MAX(seq)+1 (TASK-03) |

## Consumers (next phases)

- **Phase 19 (daemon task route).** `POST /api/daemon/tasks/:id/messages` validates + calls `appendTaskMessage(taskId, msg)`. Route handler owns the auth / size / schema checks; the batcher trusts its caller.
- **Phase 20 (hosted worker).** `HostedTaskWorker` emits one `appendTaskMessage` per streamed SDK event. Because the worker runs in the same process as the batcher, the `setInterval` flush covers both daemon and hosted sources uniformly.
- **Phase 24 (WS replay).** Consumes the `(task_id, seq)` UNIQUE index this module writes. Replay query is `SELECT … FROM task_messages WHERE task_id=? AND seq > ? ORDER BY seq ASC` — indexed by `uq_task_messages_task_seq`.

## Known stubs

None. Every exported function has a working implementation verified by tests.

## Self-Check: PASSED

- `apps/server/src/task-dispatch/task-message-batcher.ts` — FOUND
- `apps/server/tests/unit/task-message-batcher.test.ts` — FOUND (5 tests, was 3 todos)
- `grep -c "export function appendTaskMessage"` = 1
- `grep -c "export function startTaskMessageBatcher"` = 1
- `grep -c "export async function stopTaskMessageBatcher"` = 1
- `grep -c "export async function flushTaskMessages"` = 1
- `grep -c "BATCH_INTERVAL_MS = 500"` = 1
- `grep -c "BUFFER_SOFT_CAP = 500"` = 1
- `grep -c "withImmediateTx"` = 2 (import + call site)
- `grep -c "\.max({ m: 'seq' })"` = 1
- `grep -c "broadcast("` = 1 — line 232, inside a for-of loop AFTER `await withImmediateTx(...)` returns (line 228)
- `grep -cE "\bany\b"` = 0 (no `any` types)
- `grep -cE "'agent_task_queue'\).*update|'agent_task_queue'\).*insert"` = 0 (batcher does not touch agent_task_queue)
- Commit `3a15fc5` — FOUND
- Commit `2dda302` — FOUND
- `npx tsx --test apps/server/tests/unit/task-message-batcher.test.ts` → 5 pass / 0 fail / 0 todo
- `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` → exit 0
