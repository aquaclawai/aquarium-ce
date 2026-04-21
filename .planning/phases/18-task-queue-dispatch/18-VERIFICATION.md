---
phase: 18-task-queue-dispatch
verified: 2026-04-16T23:55:00Z
status: human_needed
score: 5/5 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/5
  gaps_closed:
    - "SC-3 / TASK-03: task-message-batcher.ts fully implemented with MAX(seq)+1 under withImmediateTx, 5 real tests pass"
    - "SC-4 / TASK-04: task-reaper.ts implemented with julianday() normalisation + ST6 race guard; server-core.ts Step 9c wired at line 304; 5 real tests pass"
    - "TASK-05: cancelPendingTasksForIssueAgent + cancelAllTasksForIssue extended to CancelResult + broadcastCancelledRows; issue-store propagates cancelledTasks; routes/issues.ts PATCH fans out task:cancelled after commit; 4 new tests (total 16) pass"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Start the server with npm run dev. Seed a runtime and 3-5 queued tasks. Use a test script or REST client to call the claim endpoint once it is wired in Phase 19 (or call claimTask() directly via a node -e script against the live DB). Observe the server log for '[task-reaper] started'. After seeding a task with dispatched_at = now - 6 minutes, verify the reaper log emits and the row flips to failed in DB."
    expected: "Server starts cleanly with '[task-reaper] started' in the log. Claim calls return distinct tasks, no duplicate (issue_id, agent_id) pairs in dispatched status. WS clients subscribed to the workspace channel receive task:dispatch events. A task stuck in dispatched > 5 min is automatically failed with error='Reaper: dispatched > 5 min without start'."
    why_human: "Phase 18 ships no HTTP routes — the claim/complete/fail endpoints are Phase 19. The unit tests exercise service functions with an injected throwaway Knex instance pointing at isolated tmp SQLite files. A live-server run is the only way to confirm the production singleton pool, the real WS broadcast fan-out to browser clients, and the server-core boot sequence timing under the actual Node.js process."
---

# Phase 18: Task Queue & Dispatch Verification Report

**Phase Goal:** Tasks are claimed atomically under SQLite and streamed through a consistent lifecycle with a reaper that handles stale dispatch and orphaned running states, providing the core queue abstraction that daemon and hosted workers share.
**Verified:** 2026-04-16T23:55:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass. All 4 sub-plans (18-01..18-04) are confirmed merged into main. Previous `gaps_found` verdict was caused by worktree drift on the verifying machine; the code was never missing from main.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| SC-1 | 20 concurrent claims never produce duplicate (issue_id, agent_id) in dispatched | VERIFIED | task-queue.test.ts test #2: 20 pollers against 5 queued tasks → exactly 5 distinct dispatches, 0 duplicates; 26/26 tests pass |
| SC-2 | claimTask returns exactly one task or null; per-(issue_id,agent_id) coalescing prevents duplicate dispatch | VERIFIED | `withImmediateTx` ROLLBACK+BEGIN IMMEDIATE + `.andWhere('status','queued')` UPDATE race guard in `claimTask`; `idx_one_pending_task_per_issue_agent` partial-unique index is schema backstop; `enqueueTaskForIssue` idempotency guard prevents duplicate queuing |
| SC-3 | task_messages batched ingest at 500ms produces strictly monotonic seq per task | VERIFIED | task-message-batcher.ts: `MAX(seq)+1` inside `withImmediateTx`; `BUFFER_SOFT_CAP=500` early flush; `BATCH_INTERVAL_MS=500`; flushingTasks re-entrance guard; 5/5 batcher tests pass including 20×25 concurrent-appender proof |
| SC-4 | Stale-task reaper fails tasks stuck in dispatched>5min and running>2.5h within one sweep tick | VERIFIED | task-reaper.ts: `DISPATCH_STALE_MS=5*60_000`, `RUNNING_STALE_MS=2.5*60*60_000`, `SWEEP_INTERVAL_MS=30_000`; `julianday()` comparison normalises ISO-8601 vs CURRENT_TIMESTAMP formats; `.andWhere('status','dispatched')` and `.andWhere('status','running')` ST6 race guards; `startTaskReaper()` at server-core line 304 (between Step 9a loop line 296 and Step 9e line 308); 5/5 reaper tests pass |
| SC-5 | completeTask on already-cancelled returns {discarded:true} with no throw | VERIFIED | `completeTask` pre-reads current status; `if (current.status === 'cancelled') return {discarded:true, status:'cancelled'}` without throwing; task-queue.test.ts test #6; `failTask` mirrors same pattern (test #7, PM5) |

**Score: 5/5 success criteria verified**

### Deferred Items

None. All roadmap success criteria are satisfied by code on main. No items are deferred to later phases.

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/task-queue-store.ts` | 6 Phase-18 exports + Phase-17 exports + CancelResult + withImmediateTx | VERIFIED | All 6 lifecycle exports (`claimTask`/`startTask`/`completeTask`/`failTask`/`cancelTask`/`isTaskCancelled`) confirmed; `withImmediateTx` exported; `CancelResult` interface present; `broadcastCancelledRows` helper; 12× BEGIN IMMEDIATE discipline |
| `apps/server/src/task-dispatch/task-message-batcher.ts` | appendTaskMessage / startTaskMessageBatcher / stopTaskMessageBatcher / flushTaskMessages | VERIFIED | File exists (8758 bytes); all 4 exports present; `BATCH_INTERVAL_MS=500`, `BUFFER_SOFT_CAP=500`; `withImmediateTx` imported from task-queue-store.ts; `broadcast()` at line 232 outside/after `await withImmediateTx(...)` (never inside transaction) |
| `apps/server/src/task-dispatch/task-reaper.ts` | reapOnce / startTaskReaper / stopTaskReaper | VERIFIED | File exists (6553 bytes); all 3 exports present; `DISPATCH_STALE_MS=5*60_000`, `RUNNING_STALE_MS=2.5*60*60_000`, `SWEEP_INTERVAL_MS=30_000`; `julianday()` normalisation on both timestamp WHERE clauses; both `.andWhere('status',...)` ST6 guards confirmed |
| `apps/server/src/server-core.ts` | import startTaskReaper + call at Step 9c | VERIFIED | `import { startTaskReaper } from './task-dispatch/task-reaper.js'` at line 21; `startTaskReaper()` at line 304; `startRuntimeOfflineSweeper()` at line 308 — 9c (304) precedes 9e (308) |
| `apps/server/src/services/issue-store.ts` | cancelledTasks propagation through applyIssueSideEffects + updateIssue | VERIFIED | `grep -c cancelledTasks issue-store.ts` = 11 |
| `apps/server/src/routes/issues.ts` | PATCH handler fans out task:cancelled per cancelledTasks row after commit | VERIFIED | `task:cancelled` at line 140 inside `for (const row of cancelledTasks)` loop, after `updateIssue` returns |
| `apps/server/tests/unit/test-db.ts` | makeTestDb + seed helpers | VERIFIED | Created in 18-01; exports `makeTestDb`, `seedRuntime`, `seedAgent`, `seedIssue`, `seedTask`; reused by all three test suites |
| `apps/server/tests/unit/task-queue.test.ts` | 16 tests: 12 (18-01) + 4 TASK-05 (18-04) | VERIFIED | 16 passing; 0 todos; 0 stubs |
| `apps/server/tests/unit/task-message-batcher.test.ts` | 5 real tests replacing 3 stubs | VERIFIED | 5 passing; 0 todos |
| `apps/server/tests/unit/task-reaper.test.ts` | 5 real tests replacing 3 stubs | VERIFIED | 5 passing; 0 todos |
| `apps/server/tests/unit/README.md` | Harness documentation | VERIFIED | Present |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| task-queue-store.ts#claimTask | agent_task_queue (SQLite) | withImmediateTx (ROLLBACK+BEGIN IMMEDIATE) + `.andWhere('status','queued')` UPDATE guard | WIRED | SELECT candidate + UPDATE guarded by status='queued'; partial-unique index is schema backstop |
| task-queue-store.ts#claimTask | ws/index.ts | `broadcast(claimed.workspaceId, {type:'task:dispatch',...})` after withImmediateTx returns | WIRED | Broadcast outside transaction callback; never inside |
| task-queue-store.ts#cancelTask | ws/index.ts | `broadcast(result.workspaceId, {type:'task:cancelled',...})` after withImmediateTx | WIRED | Line 760; conditional on `result.cancelled === true` |
| task-queue-store.ts#cancelPendingTasksForIssueAgent | ws/index.ts | `broadcastCancelledRows(result.cancelledRows)` after withImmediateTx, only when no caller-supplied trx and emitBroadcasts=true | WIRED | Ghost-event guard: if `args.trx` provided, caller owns broadcast (T-18-19 mitigation) |
| task-queue-store.ts#cancelAllTasksForIssue | ws/index.ts | same broadcastCancelledRows pattern | WIRED | Same ghost-event guard |
| routes/issues.ts PATCH | ws/index.ts | `for (const row of cancelledTasks) { broadcast(row.workspaceId, {type:'task:cancelled',...}) }` | WIRED | After `updateIssue` service call returns (transaction committed); before HTTP response |
| task-message-batcher.ts#flushOne | task_messages (SQLite) | `withImmediateTx` + `.max({m:'seq'})` + bulk INSERT | WIRED | MAX(seq)+1 and INSERT run inside same BEGIN IMMEDIATE transaction; `UNIQUE(task_id, seq)` index from migration 007 is schema backstop |
| task-message-batcher.ts#flushOne | ws/index.ts | `broadcast()` in post-commit for-loop outside `await withImmediateTx(...)` | WIRED | `toBroadcast` array populated inside tx; loop at line 232 fires after tx resolves |
| task-reaper.ts#reapOnce | agent_task_queue (SQLite) | `.whereNotNull('dispatched_at').andWhereRaw('julianday(dispatched_at) < julianday(?)')` + `.andWhere('status','dispatched')` UPDATE guard | WIRED | Both stale-state buckets (dispatched, running) have julianday() WHERE + status ST6 guard on UPDATE |
| task-reaper.ts#reapOnce | ws/index.ts | `broadcast(r.workspace_id, {type:'task:failed',...})` in post-UPDATE for-loop | WIRED | Single-statement UPDATEs autocommit; broadcast loop runs after write is durable |
| server-core.ts | task-reaper.ts | `import { startTaskReaper }` line 21; `startTaskReaper()` line 304 | WIRED | Line 304 is between Step 9a closing `}, 10_000)` at line 296 and Step 9e `startRuntimeOfflineSweeper()` at line 308 |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| task-queue-store.ts#claimTask | `candidate` (ClaimedTask) | `agent_task_queue` SELECT joined with `agents` + `issues` via `hydrateClaimedTask` | Yes — real DB rows; no hardcoded fallback | FLOWING |
| task-queue-store.ts#completeTask | `current.status` → `TerminalResult.discarded` | Pre-read of `agent_task_queue.status` before UPDATE | Yes — live DB status governs discard path | FLOWING |
| task-message-batcher.ts#flushOne | `next` (seq counter) | `MAX(seq)` from `task_messages` inside withImmediateTx | Yes — real DB max, incremented per message; not seeded or hardcoded | FLOWING |
| task-reaper.ts#reapOnce | `stuckDispatched` / `stuckRunning` | SELECT WHERE julianday(ts) < julianday(cutoff) on live agent_task_queue | Yes — real DB rows with real timestamps; julianday() normalises both timestamp formats | FLOWING |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 26 unit tests pass | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test task-queue.test.ts task-message-batcher.test.ts task-reaper.test.ts` | tests 26, pass 26, fail 0, todo 0, duration 3367ms | PASS |
| Shared build exits 0 | `npm run build -w @aquarium/shared` | exit 0 | PASS |
| Typecheck exits 0 | `npm run typecheck -w @aquaclawai/aquarium` | exit 0 | PASS |
| BEGIN IMMEDIATE discipline | `grep -c "BEGIN IMMEDIATE" task-queue-store.ts` | 12 (requirement: >= 5) | PASS |
| withImmediateTx used in batcher | `grep -c withImmediateTx task-message-batcher.ts` | 2 (import + call) | PASS |
| Broadcast outside batcher tx | Read task-message-batcher.ts lines 195-247 | `broadcast()` at line 232; `await withImmediateTx(...)` closes at line 228 | PASS |
| startTaskReaper wired before startRuntimeOfflineSweeper | `grep -n startTaskReaper\|startRuntimeOfflineSweeper server-core.ts` | 304 < 308 | PASS |
| task:cancelled in routes/issues.ts | `grep -c 'task:cancelled' routes/issues.ts` | 1 | PASS |
| No new `any` tokens | `grep -cE '\bany\b' task-queue-store.ts` | 1 (pre-existing docstring comment, line 26) | PASS |
| No test stubs in test files | `grep -c "test.todo" task-message-batcher.test.ts task-reaper.test.ts` | 0:0 | PASS |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| TASK-01 | 18-01 | Atomic claim under BEGIN IMMEDIATE with per-(agent,issue) coalescing | SATISFIED | `claimTask` with `withImmediateTx`; max_concurrent_tasks subquery; `andWhere('status','queued')` race guard; migration-007 partial-unique index; 20-concurrent SC-1 test passes |
| TASK-02 | 18-01 | Lifecycle: one state transition per call, status-guarded | SATISFIED | `startTask`/`completeTask`/`failTask` each use `.andWhere('status',<expected>)` guards; lifecycle happy-path test passes |
| TASK-03 | 18-02 | task_messages monotonic seq, 500ms batched ingest | SATISFIED | `task-message-batcher.ts`; MAX(seq)+1 inside withImmediateTx; BUFFER_SOFT_CAP=500; 5/5 batcher tests pass including 500-appends and 20-concurrent-appenders proofs |
| TASK-04 | 18-03 | Stale-task reaper fails dispatched>5min and running>2.5h | SATISFIED | `task-reaper.ts`; julianday() normalisation; ST6 race guards; server-core Step 9c wiring; 5/5 reaper tests pass including ST6 race-safety proof |
| TASK-05 | 18-01 + 18-04 | Cancel surface: DB flip + task:cancelled WS broadcast on all 3 paths | SATISFIED | `cancelTask` (single-task, 18-01); `cancelPendingTasksForIssueAgent` + `cancelAllTasksForIssue` extended (18-04); `broadcastCancelledRows` helper; `routes/issues.ts` PATCH fan-out; 4 TASK-05 tests pass (total 16) |
| TASK-06 | 18-01 | completeTask/failTask on cancelled → {discarded:true} | SATISFIED | Both functions pre-read status; return `{discarded:true, status:'cancelled'}` without throwing; test #6 (complete) and test #7 (fail) pass |

## Anti-Patterns Found

No blockers or warnings. No `test.todo`, `TODO`, `FIXME`, or placeholder patterns found in any Phase-18 production file or test file. No empty handlers, no hardcoded empty data arrays in rendering paths, no `return null` stubs.

## Human Verification Required

### 1. Live-server E2E smoke test

**Test:** Start the server (`npm run dev`) against a real SQLite DB. Observe the startup log for `[task-reaper] started`. Seed 3-5 queued tasks for a runtime (directly via sqlite3 CLI or a seed script). Call `claimTask(runtimeId)` directly via a node -e script against the live DB to simulate claim activity and confirm `task:dispatch` WS events appear in connected browser clients. Optionally, seed a task with `dispatched_at = datetime('now', '-6 minutes')` and wait up to 30 seconds for the reaper to fail it.

**Expected:**
- Server starts cleanly with `[task-reaper] started` in the log.
- `claimTask` calls against the live DB transition tasks to `dispatched` with non-null `dispatched_at`.
- WS clients subscribed to the workspace channel receive `task:dispatch` events per claim.
- A task with `dispatched_at` older than 5 minutes transitions to `failed` within one 30-second reaper tick with `error='Reaper: dispatched > 5 min without start'`.

**Why human:** Phase 18 ships no HTTP routes (Phase 19). Unit tests inject isolated Knex instances pointing at tmp SQLite files; they do not test the production singleton pool, real WS broadcast delivery to connected browser clients, or the server-core boot timing. A one-time live-server smoke check closes this gap before Phase 19 wires the HTTP surface on top.

## Gaps Summary

No gaps. All five ROADMAP success criteria are verified by code on main. The `human_needed` status reflects a single live-server smoke test that cannot be automated in the absence of Phase-19 HTTP routes — it is not a correctness gap in Phase-18 artifacts.

**What changed since previous verification:**
- Plan 18-02 (task-message-batcher): file created, 5 real tests replace 3 stubs, MAX(seq)+1 inside withImmediateTx confirmed.
- Plan 18-03 (task-reaper): file created, 5 real tests replace 3 stubs, julianday() normalisation fixes ST6 false-positive, server-core wired at Step 9c.
- Plan 18-04 (cancel broadcast): CancelResult interface added, two Phase-17 helpers extended, broadcastCancelledRows DRY helper, issue-store propagation, routes/issues.ts fan-out, 4 new TASK-05 tests; total unit suite 26 pass.
- Full test suite: 26/26 pass, 0 fail, 0 todo.
- Typecheck: exit 0.

---

_Verified: 2026-04-16T23:55:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — third pass resolving worktree-drift false-negative from previous runs._
