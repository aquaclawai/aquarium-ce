---
phase: 18-task-queue-dispatch
verified: 2026-04-16T23:30:00Z
status: gaps_found
score: 2/5 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/5
  gaps_closed: []
  gaps_remaining:
    - "SC-3 / TASK-03: task-message-batcher.ts still missing; test file still stub-only"
    - "SC-4 / TASK-04: task-reaper.ts still missing; server-core.ts still unwired; test file still stub-only"
    - "TASK-05: cancelPendingTasksForIssueAgent/cancelAllTasksForIssue still return Promise<number>; no CancelResult; no task:cancelled broadcast paths"
  regressions: []
gaps:
  - truth: "task_messages batched ingest at 500ms produces strictly monotonic seq per task (SC-3 / TASK-03)"
    status: failed
    reason: "apps/server/src/task-dispatch/task-message-batcher.ts does not exist. task-message-batcher.test.ts contains 3 test.todo() stubs and 0 real assertions. Plan 18-02 was not executed."
    artifacts:
      - path: "apps/server/src/task-dispatch/task-message-batcher.ts"
        issue: "File missing — not created. Directory apps/server/src/task-dispatch/ exists but contains only offline-sweeper.ts and runtime-bridge.ts."
      - path: "apps/server/tests/unit/task-message-batcher.test.ts"
        issue: "Contains only 3 test.todo() placeholders (lines 12-14); 0 real assertions."
    missing:
      - "Create apps/server/src/task-dispatch/task-message-batcher.ts with appendTaskMessage, startTaskMessageBatcher, stopTaskMessageBatcher, flushTaskMessages exports"
      - "Implement 500ms setInterval flush, MAX(seq)+1 inside BEGIN IMMEDIATE, per-task BUFFER_SOFT_CAP=500 overflow flush, WS broadcast after commit"
      - "Replace stub tests in task-message-batcher.test.ts with 5+ real passing tests per 18-02 plan acceptance criteria"

  - truth: "Stale-task reaper fails tasks stuck in dispatched > 5 min and running > 2.5h within one sweep tick (SC-4 / TASK-04)"
    status: failed
    reason: "apps/server/src/task-dispatch/task-reaper.ts does not exist. task-reaper.test.ts contains 3 test.todo() stubs. server-core.ts has no startTaskReaper() import or call. Plan 18-03 was not executed."
    artifacts:
      - path: "apps/server/src/task-dispatch/task-reaper.ts"
        issue: "File missing — not created."
      - path: "apps/server/tests/unit/task-reaper.test.ts"
        issue: "Contains only 3 test.todo() placeholders (lines 12-14); 0 real assertions."
      - path: "apps/server/src/server-core.ts"
        issue: "No import or call to startTaskReaper(). Step 9c is absent — server boots with no mechanism to recover stale dispatched/running tasks."
    missing:
      - "Create apps/server/src/task-dispatch/task-reaper.ts with reapOnce, startTaskReaper, stopTaskReaper exports"
      - "Implement DISPATCH_STALE_MS=5min, RUNNING_STALE_MS=2.5h, SWEEP_INTERVAL_MS=30s thresholds with ST6 race guards"
      - "Wire import { startTaskReaper } from './task-dispatch/task-reaper.js' and startTaskReaper() into server-core.ts Step 9c (between 10_000ms runtimeBridgeReconcile loop and startRuntimeOfflineSweeper())"
      - "Replace stub tests in task-reaper.test.ts with 5+ real passing tests"

  - truth: "cancelPendingTasksForIssueAgent and cancelAllTasksForIssue emit task:cancelled WS broadcasts per cancelled row (TASK-05)"
    status: failed
    reason: "Plan 18-04 was not executed. Both Phase-17 cancel helpers still return Promise<number>. No CancelResult interface exists. issue-store.ts does not propagate cancelledRows. routes/issues.ts PATCH handler emits no task:cancelled broadcast."
    artifacts:
      - path: "apps/server/src/services/task-queue-store.ts"
        issue: "cancelPendingTasksForIssueAgent (line 249) and cancelAllTasksForIssue (line 279) still return Promise<number> (Phase 17 shape). No CancelResult interface, no emitBroadcasts flag, no cancelledRows."
      - path: "apps/server/src/services/issue-store.ts"
        issue: "Calls cancelAllTasksForIssue and cancelPendingTasksForIssueAgent but discards return values — no cancelledRows propagation."
      - path: "apps/server/src/routes/issues.ts"
        issue: "PATCH handler emits no task:cancelled broadcast."
    missing:
      - "Add CancelResult interface to task-queue-store.ts"
      - "Rewrite cancelPendingTasksForIssueAgent and cancelAllTasksForIssue to return CancelResult with cancelledRows array"
      - "Add emitBroadcasts optional flag (default true) to both helpers"
      - "Propagate cancelledRows through issue-store.ts applyIssueSideEffects -> updateIssue return shape"
      - "Emit task:cancelled per row in routes/issues.ts PATCH handler after commit"
      - "Add 4+ TASK-05 broadcast tests to task-queue.test.ts"
---

# Phase 18: Task Queue & Dispatch — Verification Report (Re-verification)

**Phase Goal:** Tasks are claimed atomically under SQLite and streamed through a consistent lifecycle with a reaper that handles stale dispatch and orphaned running states, providing the core queue abstraction that daemon and hosted workers share.
**Verified:** 2026-04-16T23:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — second pass after contested initial report. Ground-truth commands executed directly; findings confirm the initial report was correct.

---

## Ground-Truth Command Results

The following commands were executed verbatim to resolve the dispute:

| Command | Expected (by requester) | Actual |
|---------|------------------------|--------|
| `ls -la ...task-message-batcher.ts ...task-reaper.ts` | both files exist, 8758 and 6553 bytes | **EXIT 1 — both files absent** |
| `grep -n "startTaskReaper" apps/server/src/server-core.ts` | import at line 21, call at line 304 | **no output — no match** |
| `grep -c "test.todo" task-message-batcher.test.ts task-reaper.test.ts` | 0:0 | **3:3 — 6 stubs total** |
| `npx tsx --test ...` (all three test files) | 26 pass / 0 fail | **12 pass / 0 fail / 6 todo** (task-queue tests pass; batcher and reaper are all todo stubs) |
| `npm run build && npm run typecheck` | exit 0 | **exit 0** (this one passes) |

The ROADMAP itself records the plan completion state as "Plans: 1/4 plans executed" (Phase 18 section, line ~325).

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | 20 concurrent claim calls never produce two tasks with same (issue_id, agent_id) dispatched | ✓ VERIFIED | 12 task-queue tests pass including the 20-concurrent test (seeds 5 tasks, fires 20 simultaneous claimTask calls, asserts 5 distinct dispatches, 0 duplicates). Output: 12 pass / 0 fail / 0 todo. |
| SC-2 | claimTask returns exactly one task or null; per-(issue, agent) coalescing prevents duplicate dispatch | ✓ VERIFIED | claimTask implemented with withImmediateTx helper, max_concurrent_tasks subquery, AND status='queued' race guard, backed by migration-007 partial UNIQUE index. |
| SC-3 | task_messages batched at 500ms produces strictly monotonic seq per task | ✗ FAILED | task-message-batcher.ts does not exist. task-message-batcher.test.ts has 3 test.todo() stubs, 0 real assertions. Plan 18-02 not executed. |
| SC-4 | Stale-task reaper fails tasks stuck in dispatched > 5 min and running > 2.5h within one sweep tick | ✗ FAILED | task-reaper.ts does not exist. task-reaper.test.ts has 3 test.todo() stubs, 0 real assertions. server-core.ts has no startTaskReaper() import or call. Plan 18-03 not executed. |
| SC-5 | completeTask on already-cancelled returns { discarded: true } with no throw | ✓ VERIFIED | completeTask pre-reads status; if status === 'cancelled' returns {discarded:true, status:'cancelled'} without throwing. Dedicated test passes. |

**Score: 2/5 success criteria verified**

### Deferred Items

None. The failing items (SC-3, SC-4, TASK-05) are not deferred to later phases — they are assigned to Phase 18 sub-plans 18-02, 18-03, and 18-04 respectively in the ROADMAP.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/task-queue-store.ts` | claimTask, startTask, completeTask, failTask, cancelTask, isTaskCancelled | ✓ VERIFIED | All 6 Phase-18 functions exported. withImmediateTx helper present. BEGIN IMMEDIATE discipline confirmed. Broadcasts after commit for task:dispatch, task:completed, task:failed, task:cancelled. |
| `apps/server/tests/unit/test-db.ts` | makeTestDb / setupTestDb fixture with WAL PRAGMAs | ✓ VERIFIED | File exists (213 lines). setupTestDb, teardownTestDb, seedRuntime, seedAgent, seedIssue, seedTask all exported. |
| `apps/server/tests/unit/task-queue.test.ts` | 12 real tests | ✓ VERIFIED | 12 passing tests covering SC-1, TASK-01, TASK-02, TASK-05 DB surface, TASK-06. |
| `apps/server/tests/unit/README.md` | Harness docs | ✓ VERIFIED | File exists. |
| `apps/server/src/task-dispatch/task-message-batcher.ts` | appendTaskMessage, startTaskMessageBatcher, stopTaskMessageBatcher, flushTaskMessages | ✗ MISSING | Not present. apps/server/src/task-dispatch/ contains only offline-sweeper.ts and runtime-bridge.ts. |
| `apps/server/src/task-dispatch/task-reaper.ts` | reapOnce, startTaskReaper, stopTaskReaper | ✗ MISSING | Not present. |
| `apps/server/tests/unit/task-message-batcher.test.ts` | 5+ real tests | ✗ STUB | 3 test.todo() placeholders only. |
| `apps/server/tests/unit/task-reaper.test.ts` | 5+ real tests | ✗ STUB | 3 test.todo() placeholders only. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| task-queue-store.ts#claimTask | ws/index.ts | broadcast(workspaceId, {type:'task:dispatch'}) after withImmediateTx | ✓ WIRED | Broadcast at line 423, outside transaction callback |
| task-queue-store.ts#cancelTask | ws/index.ts | broadcast(workspaceId, {type:'task:cancelled'}) after withImmediateTx | ✓ WIRED | Broadcast at line 618-624, outside transaction |
| task-queue-store.ts#completeTask | ws/index.ts | broadcast task:completed AFTER commit | ✓ WIRED | Broadcast present post-transaction |
| task-queue-store.ts#failTask | ws/index.ts | broadcast task:failed AFTER commit | ✓ WIRED | Broadcast present post-transaction |
| task-message-batcher.ts | task_messages (SQLite) | BEGIN IMMEDIATE + MAX(seq)+1 | ✗ NOT_WIRED | File missing |
| task-reaper.ts | agent_task_queue (SQLite) | UPDATE WHERE status='dispatched' AND dispatched_at < cutoff | ✗ NOT_WIRED | File missing |
| server-core.ts | task-reaper.ts | import { startTaskReaper }; startTaskReaper() at Step 9c | ✗ NOT_WIRED | No import, no call — confirmed by grep returning empty |
| cancelPendingTasksForIssueAgent | ws/index.ts | task:cancelled broadcast per cancelled row | ✗ NOT_WIRED | Function returns Promise<number> (Phase 17 shape); no broadcast path |
| cancelAllTasksForIssue | ws/index.ts | task:cancelled broadcast per cancelled row | ✗ NOT_WIRED | Function returns Promise<number> (Phase 17 shape); no broadcast path |
| routes/issues.ts PATCH | ws/index.ts | task:cancelled fan-out after updateIssue | ✗ NOT_WIRED | No task:cancelled broadcast in routes/issues.ts PATCH handler |

---

## BEGIN IMMEDIATE Discipline

All five Phase-18 write functions (claimTask, startTask, completeTask, failTask, cancelTask) use withImmediateTx(kx, fn) — the helper that issues ROLLBACK + BEGIN IMMEDIATE inside Knex's transaction callback to work around Knex's hard-coded DEFERRED begin. Phase-17 cancel helpers (cancelPendingTasksForIssueAgent, cancelAllTasksForIssue) remain on Knex default DEFERRED, which is acceptable as they are called inside the caller's existing transaction. Plan 18-04's rewrite would upgrade these to withImmediateTx.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 12 task-queue tests pass | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` | 12 pass / 0 fail / 0 todo, ~466ms | ✓ PASS |
| Batcher tests pass | `npx tsx --test apps/server/tests/unit/task-message-batcher.test.ts` | 0 pass / 0 fail / 3 todo (all test.todo stubs) | ✗ FAIL (stubs only) |
| Reaper tests pass | `npx tsx --test apps/server/tests/unit/task-reaper.test.ts` | 0 pass / 0 fail / 3 todo (all test.todo stubs) | ✗ FAIL (stubs only) |
| Typecheck clean | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` | exit 0 | ✓ PASS |
| startTaskReaper wired | `grep -n "startTaskReaper" apps/server/src/server-core.ts` | no output (exit 1) | ✗ FAIL |
| cancelPendingTasksForIssueAgent returns CancelResult | `grep -c "CancelResult" apps/server/src/services/task-queue-store.ts` | 0 | ✗ FAIL |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TASK-01 | 18-01 | Atomic claim via BEGIN IMMEDIATE + per-(agent,issue) coalescing | ✓ SATISFIED | claimTask with withImmediateTx, max_concurrent_tasks subquery, migration-007 partial UNIQUE index. SC-1 unit test passes. |
| TASK-02 | 18-01 | Lifecycle queued→dispatched→running→completed/failed/cancelled per call | ✓ SATISFIED | startTask/completeTask/failTask each guard via .andWhere('status', <expected>). Lifecycle tests pass. |
| TASK-03 | 18-02 | task_messages monotonic seq, 500ms batched ingest | ✗ BLOCKED | task-message-batcher.ts missing. Plan 18-02 not executed. |
| TASK-04 | 18-03 | Stale-task reaper: dispatched > 5 min, running > 2.5h | ✗ BLOCKED | task-reaper.ts missing. Plan 18-03 not executed. server-core.ts not wired. |
| TASK-05 | 18-04 | Cancel propagation: task:cancelled WS broadcasts on all 3 cancel paths | ✗ BLOCKED | Plan 18-04 not executed. cancelPendingTasksForIssueAgent and cancelAllTasksForIssue still return number. No CancelResult, no issue-store propagation, no routes/issues.ts broadcast. |
| TASK-06 | 18-01 | completeTask/failTask on cancelled → { discarded: true } | ✓ SATISFIED | Both functions pre-read status and return {discarded:true, status:'cancelled'} without throwing. Dedicated tests pass. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| task-message-batcher.test.ts | 12-14 | All 3 tests are test.todo() — zero real assertions | Blocker | SC-3 (TASK-03) entirely unverified |
| task-reaper.test.ts | 12-14 | All 3 tests are test.todo() — zero real assertions | Blocker | SC-4 (TASK-04) entirely unverified |
| server-core.ts | ~295-299 | Step 9c gap: no startTaskReaper() call between 10_000ms loop and startRuntimeOfflineSweeper() | Blocker | Reaper never starts; stale dispatched/running tasks persist indefinitely, blocking re-enqueue via partial UNIQUE index |

---

## Human Verification Required

None — all items verified or disproved programmatically.

---

## Gaps Summary

Phase 18 executed 1 of 4 planned sub-plans (Plan 18-01 only). Three success criteria are unmet and three requirements are blocked:

**Gap 1 — SC-3 / TASK-03 (Plan 18-02 not executed): task-message-batcher missing**
`apps/server/src/task-dispatch/task-message-batcher.ts` does not exist. `task-message-batcher.test.ts` contains only `test.todo()` stubs. Phase 19 (daemon route for progress messages) and Phase 20 (hosted worker streaming) both depend on `appendTaskMessage`. Without the batcher, task messages cannot be persisted with monotonic seq ordering.

**Gap 2 — SC-4 / TASK-04 (Plan 18-03 not executed): task-reaper missing and not wired**
`apps/server/src/task-dispatch/task-reaper.ts` does not exist. `task-reaper.test.ts` contains only `test.todo()` stubs. `server-core.ts` has no `startTaskReaper()` call — the server starts with no mechanism to fail tasks stuck in `dispatched` or `running`. Any daemon crash between claim and start permanently blocks re-enqueue for the same (issue, agent) pair via the partial UNIQUE index on `idx_one_pending_task_per_issue_agent`.

**Gap 3 — TASK-05 (Plan 18-04 not executed): cancel broadcast unification missing**
`cancelPendingTasksForIssueAgent` and `cancelAllTasksForIssue` still return `Promise<number>` (Phase 17 shape). `CancelResult` interface was not added. `issue-store.ts` does not propagate cancelled rows. `routes/issues.ts` PATCH handler emits no `task:cancelled` WS event. Issue-level cancellations produce silent DB flips with no client notification.

**What passed:** Plan 18-01 was executed correctly. The core claim/lifecycle/cancel/discarded service surface is implemented, tested (12 passes), and typecheck-clean. The `withImmediateTx` helper correctly solves the Knex DEFERRED-upgrade problem.

---

_Verified: 2026-04-16T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — dispute resolution pass. All ground-truth commands executed directly; findings confirm initial report._
