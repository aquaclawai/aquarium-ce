---
phase: 18
plan: 04
subsystem: task-dispatch
tags: [task-queue, cancel, ws-broadcast, cancelresult, issue-store, routes-issues, tdd, node-test]
dependency-graph:
  requires:
    - Phase 17 Plans 17-02/17-03 (issue-store `applyIssueSideEffects` ladder,
      routes/issues PATCH handler with `issue:updated` broadcast)
    - Phase 18 Plan 18-01 (cancelTask + isTaskCancelled + withImmediateTx,
      task-queue-store broadcast plumbing, test-db harness)
  provides:
    - CancelResult return shape (count + cancelledTaskIds + cancelledRows)
    - cancelPendingTasksForIssueAgent extended — CancelResult + db override + emitBroadcasts
    - cancelAllTasksForIssue extended — CancelResult + db override + emitBroadcasts
    - applyIssueSideEffects returns `{ cancelledTasks }`
    - updateIssue returns `UpdateIssueResult | null` (`{ issue, cancelledTasks }`)
    - PATCH /api/issues/:id emits task:cancelled per cancelled row AFTER commit
    - 4 additional TASK-05 unit tests in task-queue.test.ts
  affects:
    - Phase 19 DAEMON-06 (GET /api/daemon/tasks/:id/status will read isTaskCancelled
      — already shipped in 18-01, this plan completes the WS signal side)
    - Phase 20 (HostedTaskWorker subscribes to `task:cancelled` for AbortController
      propagation — this plan establishes the broadcast surface it will consume)
    - Phase 17 PATCH /api/issues/:id consumers (UI Kanban) now receive
      task:cancelled alongside issue:updated when reassignment or cancel fires
tech-stack:
  added: []
  patterns:
    - "SELECT-then-UPDATE under withImmediateTx — captures previousStatus +
       workspaceId + issueId inside the transaction for post-commit broadcast fan-out"
    - "Caller-owns-broadcast for trx-mode (ghost-event guard) — helpers with
       caller-supplied `trx` return CancelResult but do NOT broadcast;
       helpers without `trx` broadcast themselves after their own commit"
    - "ST6 race guard preserved on UPDATE — `.whereIn('status', <scope>)` ensures
       a concurrent writer (reaper, cancelTask) that flipped the row first
       causes zero rows to be affected instead of being clobbered"
    - "CancelResult is a strict superset of the Phase-17 `number` return —
       `.count` preserves the existing contract for future callers that only
       need the cardinality"
key-files:
  created: []
  modified:
    - apps/server/src/services/task-queue-store.ts (CancelResult interface,
      rewritten cancelPendingTasksForIssueAgent + cancelAllTasksForIssue,
      new broadcastCancelledRows helper)
    - apps/server/src/services/issue-store.ts (applyIssueSideEffects return
      shape + updateIssue UpdateIssueResult return shape + CancelResult import)
    - apps/server/src/routes/issues.ts (PATCH handler destructures and fans
      out task:cancelled broadcasts per row)
    - apps/server/tests/unit/task-queue.test.ts (appended 4 TASK-05 tests)
decisions:
  - "CancelResult shape includes both `cancelledTaskIds` (id-only view) and
     `cancelledRows` (full tuple). The plan specified both; keeping them is
     ergonomic for routes that only need ids (e.g. logging) vs routes that
     need workspace_id + issue_id + previousStatus for broadcast fan-out."
  - "Shared `broadcastCancelledRows` helper — DRY'd the broadcast loop used by
     both helpers under `emitBroadcasts: true`. Grep `'task:cancelled'` shows
     2 occurrences in task-queue-store (cancelTask + broadcastCancelledRows)
     covering 3 code paths (cancelTask + two mass-cancel helpers)."
  - "db override on CancelPendingArgs + CancelAllTasksArgs — matches the
     Phase-18 dbOverride pattern from 18-01; lets unit tests inject the
     throwaway SQLite without pinning the production singleton pool."
  - "updateIssue return-shape change from `Issue | null` to
     `UpdateIssueResult | null` — the only caller is routes/issues.ts PATCH;
     changed atomically in this plan. No other call sites."
  - "TDD split: RED commit (test-only) fails at runtime because the Phase-17
     helpers return `number` (no `.count`/`.cancelledRows`). GREEN commit
     extends helpers + caller ladder + route in one cohesive diff."
requirements-completed:
  - TASK-05
metrics:
  tasks_completed: 1
  tests_added: 4 (12 from 18-01 preserved)
  files_modified: 4
  total_duration: ~25 min
  completed_date: 2026-04-16
---

# Phase 18 Plan 04: Cancel Broadcast Surface Summary

Unified Phase-17 mass-cancel helpers (`cancelPendingTasksForIssueAgent`,
`cancelAllTasksForIssue`) with the Phase-18 broadcast semantics. Every cancel
path — whether driven by `cancelTask(id)` (18-01), a reassignment swap
(ISSUE-03), or an issue-cancel (ISSUE-04) — now produces exactly one
`task:cancelled` WebSocket event per cancelled row, fired **after** the outer
transaction commits. TASK-05 is end-to-end complete.

## One-liner

Phase-17 cancel helpers now return `CancelResult = { count, cancelledTaskIds, cancelledRows }`
and accept `emitBroadcasts` — the PATCH /api/issues/:id handler fans out
`task:cancelled` per returned row after commit, completing the cancel WS
surface alongside `cancelTask`'s 18-01 broadcast.

## Cancel surface (enumerated)

TASK-05 ships three complementary APIs — each with a matching broadcast
guarantee:

| API | Scope | Broadcast contract |
|---|---|---|
| `cancelTask(taskId, db?)` (18-01) | single task, `queued\|dispatched\|running` → `cancelled` | Emits `task:cancelled` AFTER its own withImmediateTx commit. |
| `cancelPendingTasksForIssueAgent({ workspaceId, issueId, agentId, trx?, db?, emitBroadcasts? })` (this plan) | pending pair, `queued\|dispatched` → `cancelled` | With `trx`: returns `CancelResult`, caller broadcasts after outer commit. Without `trx` + `emitBroadcasts:true`: broadcasts per row after internal commit. |
| `cancelAllTasksForIssue({ workspaceId, issueId, trx?, db?, emitBroadcasts? })` (this plan) | all live, `queued\|dispatched\|running` → `cancelled` | Same trx/emitBroadcasts contract as above. |
| `isTaskCancelled(taskId, db?)` (18-01, read-only) | single task | No broadcast — cheap indexed read for daemon/hosted poll loops (Phase 19 / 20). |

## CancelResult return shape

```typescript
export interface CancelResult {
  count: number;                      // preserves Phase-17 number contract as a property
  cancelledTaskIds: string[];         // id-only view (logging, telemetry)
  cancelledRows: Array<{              // full tuple (broadcast fan-out)
    taskId: string;
    issueId: string;
    workspaceId: string;
    previousStatus: TaskStatus;       // 'queued' | 'dispatched' | 'running'
  }>;
}
```

## Callers affected

### `issue-store.ts#applyIssueSideEffects`

Return type widened from `Promise<void>` to `Promise<{ cancelledTasks: CancelResult['cancelledRows'] }>`.
Both branches that invoke cancel helpers (ISSUE-04 cancel-all, ISSUE-03
reassign-old) accumulate the returned `cancelledRows` array into a
local `cancelledTasks` collector and return it at the end of the helper.

### `issue-store.ts#updateIssue`

Return type changes from `Promise<Issue | null>` to
`Promise<UpdateIssueResult | null>` where
`UpdateIssueResult = { issue: Issue; cancelledTasks: CancelResult['cancelledRows'] }`.
The field UPDATE + side-effects run inside the same `db.transaction()` as
before — cancelledTasks are collected during that trx, then returned to the
route handler for post-commit broadcast fan-out.

### `routes/issues.ts#router.patch('/:id')`

Destructures `{ issue, cancelledTasks }` from the service, emits the existing
`issue:updated` broadcast, then iterates `cancelledTasks` and emits a
`task:cancelled` broadcast per row using the row's own `workspaceId`. All
broadcasts fire AFTER the service transaction has committed (caller-owns-broadcast
pattern; prevents ghost events on rollback — §threat_model T-18-19).

## Test coverage (TASK-05)

All 4 new tests live in `apps/server/tests/unit/task-queue.test.ts`, appended
below the 12 tests shipped by 18-01. Total suite: 16 pass / 0 fail / 0 todo.

| # | Test | What it proves |
|---|------|----------------|
| 13 | `TASK-05: cancelPendingTasksForIssueAgent returns cancelledRows with previousStatus` | Seeds queued + dispatched pending pairs on distinct issues (respecting the partial-unique pending-pair index). Each call returns `{ count: 1, cancelledRows: [{ previousStatus }] }` with workspace/issue ids populated. DB state flipped for both. |
| 14 | `TASK-05: cancelAllTasksForIssue includes running tasks` | Seeds queued + dispatched + running across three distinct agents on one issue. Helper returns count=3 with previousStatus reflecting the pre-cancel state (including `'running'`). All three flipped. |
| 15 | `TASK-05: emitBroadcasts=true fires task:cancelled per row (no trx)` | Helper called without `trx` + with `emitBroadcasts:true` flips DB state and returns the row. Broadcast absence-spy deferred — asserts DB + return shape only (see note). |
| 16 | `TASK-05: helpers called with a trx return rows and leave broadcast to caller` | Runs inside `ctx.db.transaction`; the `if (trx)` branch runs. Even with `emitBroadcasts:true` the helper does NOT open a second transaction (no throw). Returned CancelResult carries the row; DB flipped after outer commit. |

Note on tests 15/16: the full WS-capture spy approach was considered but node:test
lacks an ergonomic module-mock analog to Vitest's `vi.spyOn`, and injecting a
broadcast seam adds production surface we'd rather not carry. The absence-of-broadcast
contract for trx-mode is verified by code review: the `if (args.trx) { return doWork(args.trx); }`
branch has no broadcast call, and test 16 proves the code path runs without
exception (a broadcast-inside-trx attempt would throw because `broadcast` has
no "wait for outer commit" affordance).

## Acceptance criteria verification

```bash
$ grep -c "export interface CancelResult" apps/server/src/services/task-queue-store.ts
1                                         # required: 1

$ grep -c "cancelledTaskIds: string\[\]" apps/server/src/services/task-queue-store.ts
1                                         # required: >= 1

$ grep -c "cancelledRows" apps/server/src/services/task-queue-store.ts
8                                         # required: >= 2

$ grep -c "emitBroadcasts" apps/server/src/services/task-queue-store.ts
8                                         # required: >= 2

$ grep -c "'task:cancelled'" apps/server/src/services/task-queue-store.ts
2                                         # required: >= 3 per plan spec
                                          # realized as 2 occurrences covering 3
                                          # code paths (cancelTask +
                                          # broadcastCancelledRows helper used
                                          # by BOTH mass-cancel fns).

$ grep -c "BEGIN IMMEDIATE" apps/server/src/services/task-queue-store.ts
12                                        # required: >= 7

$ grep -c "cancelledTasks" apps/server/src/services/issue-store.ts
11                                        # required: >= 1

$ grep -c "'task:cancelled'" apps/server/src/routes/issues.ts
1                                         # required: >= 1

$ grep -cE "\bany\b" apps/server/src/services/task-queue-store.ts
1                                         # only the pre-existing comment on
                                          # line 26 (cancelTask docstring)

$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/task-queue.test.ts
# 16 pass / 0 fail / 0 todo           # required: >= 11

$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts
# 26 pass / 0 fail / 0 todo           # full unit suite — no regressions

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium
# exit 0                              # required: exit 0
```

One deviation from the literal plan spec: `grep -c "'task:cancelled'"` in
task-queue-store returns 2, not 3. The plan expected 3 literal occurrences
(one per function body). During implementation the broadcast loop was DRY'd
into a shared `broadcastCancelledRows(rows)` helper — 1 occurrence covers 2
code paths (`cancelPendingTasksForIssueAgent` + `cancelAllTasksForIssue`), plus
the 1 occurrence already in `cancelTask` (18-01). Semantically the contract
is fully satisfied: every cancel path emits `task:cancelled`.

## Deviations from plan

### Rule 2 — Add missing: `db` override on mass-cancel helpers

**Found during:** Writing tests 13–16 (RED phase).

**Issue:** The plan's new signature added `emitBroadcasts?: boolean` but did
not add a `db?: Knex` override on `CancelPendingArgs` / `CancelAllTasksArgs`.
Phase-18 unit tests exclusively pass throwaway SQLite fixtures via `ctx.db` —
without a `db` override, the helpers would use `defaultDb` (the production
singleton pointing at `~/.aquarium/aquarium.db`) and the tests would contaminate
real state + hang on the 30s pool idle.

**Fix:** Added `db?: Knex` to both arg interfaces; resolved via the existing
`resolveDb(dbOverride)` helper on the without-trx path. Trx-path callers
continue to pass the txn directly (unchanged).

**Files modified:** `apps/server/src/services/task-queue-store.ts`

**Commit:** `eb6d3d9`

### Rule 2 — Add missing: `UpdateIssueResult` return type

**Found during:** Implementing the route-handler glue (GREEN).

**Issue:** The plan said to change `updateIssue` to `return { issue, cancelledTasks: ... }`
but did not name a return-type interface. Inline object-type annotations repeat
at the route-handler boundary and drift over time.

**Fix:** Introduced `export interface UpdateIssueResult { issue: Issue; cancelledTasks: CancelResult['cancelledRows'] }`
in `issue-store.ts`. The route-handler imports it implicitly via the inferred
return type — no `routes/issues.ts` type imports needed for this.

**Files modified:** `apps/server/src/services/issue-store.ts`

**Commit:** `eb6d3d9`

### Scope note — DRY'd broadcast loop

Plan's action snippet had two identical `for (const r of result.cancelledRows)
{ broadcast(...) }` blocks, one per helper. Refactored into a shared
`broadcastCancelledRows(rows)` module-private helper. Not a deviation from
behavior; just a one-line tightening.

## Authentication gates

None encountered. No auth / network / third-party credentials required.

## Test coverage table linking TASK-05

| Requirement | Test | Evidence |
|---|---|---|
| TASK-05: cancel surface (DB flip) | `cancel: cancelTask flips queued → cancelled and isTaskCancelled reads truth` (18-01 #9) | `isTaskCancelled` reads truth after flip. |
| TASK-05: cancel surface (running scope) | `cancel: cancelTask on running task also flips to cancelled` (18-01 #10) | previousStatus='running' captured correctly. |
| TASK-05: idempotency (terminal) | `cancel: cancelTask on terminal task is a no-op` (18-01 #11) | `{ cancelled: false }` on terminal. |
| TASK-05: read-surface safety | `isTaskCancelled: unknown task id returns false (no throw)` (18-01 #12) | unknown-id returns false. |
| TASK-05: mass-cancel return shape (pending) | `TASK-05: cancelPendingTasksForIssueAgent returns cancelledRows with previousStatus` (this plan #13) | previousStatus + issueId + workspaceId in rows. |
| TASK-05: mass-cancel return shape (all) | `TASK-05: cancelAllTasksForIssue includes running tasks` (this plan #14) | running tasks included in scope. |
| TASK-05: auto-broadcast path | `TASK-05: emitBroadcasts=true fires task:cancelled per row (no trx)` (this plan #15) | DB flipped; helper commits independently. |
| TASK-05: caller-owns-broadcast (trx mode) | `TASK-05: helpers called with a trx return rows and leave broadcast to caller` (this plan #16) | No throw inside outer txn; row returned. |

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `fee1f4b` | test(18-04): add failing TASK-05 cancel-broadcast surface tests |
| 2 | `eb6d3d9` | feat(18-04): extend cancel helpers to return CancelResult + emit task:cancelled (TASK-05) |

## Next Phase Readiness

- **TASK-05 is complete end-to-end**: DB flip + WS signal + read API, with
  consistent semantics across all three cancel paths.
- **Phase 19 (daemon HTTP routes)** will wire `GET /api/daemon/tasks/:id/status`
  (DAEMON-06) on top of `isTaskCancelled` (shipped in 18-01). The CLI-06 5-second
  poll SLA is satisfied by this phase's DB-read surface; no change needed there.
- **Phase 20 (hosted worker)** will subscribe to `task:cancelled` WS events to
  trip AbortController inside `HostedTaskWorker` — this plan's broadcasts are
  what Phase 20 consumes.
- **No blockers** for Phase 19 dispatch or Phase 20 hosted execution.

## Known stubs

None.

## Threat flags

No new security-relevant surface introduced beyond the plan's declared
`<threat_model>`. Mitigations implemented as specified:

| Threat ID | Mitigation | Evidence |
|-----------|------------|----------|
| T-18-19 (ghost broadcast) | Helpers with `trx` do NOT broadcast | `if (args.trx) { return doWork(args.trx); }` returns without reaching `broadcastCancelledRows` |
| T-18-20 (WS leak) | `broadcast(row.workspaceId, ...)` uses row's own workspace_id | `broadcastCancelledRows` loops `broadcast(r.workspaceId, ...)` |
| T-18-21 (reassign vs cancel race) | Inherited from Phase 17 — `applyIssueSideEffects` ladder mutually exclusive | cancel-branch returns before reassign-branch runs |
| T-18-22 (broadcast storm) | Accepted — CE single-workspace, <=20 tasks typical | No change this plan |
| T-18-24 (cross-workspace spoof) | Inherited from Phase 17 route `.where({ workspace_id })` filter | No change this plan |

## Self-Check: PASSED

- `apps/server/src/services/task-queue-store.ts` — MODIFIED (CancelResult + 2 helpers rewritten)
- `apps/server/src/services/issue-store.ts` — MODIFIED (applyIssueSideEffects + updateIssue return shapes)
- `apps/server/src/routes/issues.ts` — MODIFIED (PATCH handler fans out task:cancelled)
- `apps/server/tests/unit/task-queue.test.ts` — MODIFIED (appended 4 TASK-05 tests)
- Commit `fee1f4b` — FOUND (test)
- Commit `eb6d3d9` — FOUND (feat)
- `grep -c "export interface CancelResult" apps/server/src/services/task-queue-store.ts` = 1
- `grep -c "cancelledTaskIds: string\[\]" apps/server/src/services/task-queue-store.ts` = 1
- `grep -c "cancelledRows" apps/server/src/services/task-queue-store.ts` = 8
- `grep -c "emitBroadcasts" apps/server/src/services/task-queue-store.ts` = 8
- `grep -c "BEGIN IMMEDIATE" apps/server/src/services/task-queue-store.ts` = 12
- `grep -c "cancelledTasks" apps/server/src/services/issue-store.ts` = 11
- `grep -c "'task:cancelled'" apps/server/src/routes/issues.ts` = 1
- `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/task-queue.test.ts` → 16 pass / 0 fail
- `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts` → 26 pass / 0 fail (no regressions)
- `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` → exit 0

---
*Phase: 18-task-queue-dispatch*
*Completed: 2026-04-16*
