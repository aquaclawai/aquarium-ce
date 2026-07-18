---
phase: 17-agent-issue-comment-services
plan: 03
subsystem: task-queue-hooks
tags: [task-queue, side-effects, transactional, ws-broadcast, v1.4]
one_liner: "Status-transition side-effects: updateIssue now atomically enqueues/cancels tasks on assign/reassign/cancel, and issue:* WS events are broadcast after commit."
requirements: [ISSUE-02, ISSUE-03, ISSUE-04]
dependency_graph:
  requires:
    - "apps/server/src/services/issue-store.ts (17-02 — updateIssue transaction entry point)"
    - "apps/server/src/services/agent-store.ts (17-01 — agent row shape incl. runtime_id + archived_at)"
    - "apps/server/src/routes/issues.ts (17-02 — PATCH/POST/DELETE/reorder handlers)"
    - "apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts (agent_task_queue schema + partial-unique idx_one_pending_task_per_issue_agent)"
    - "apps/server/src/ws/index.ts (broadcast signature)"
    - "packages/shared/src/v14-types.ts (AgentTask, TaskStatus)"
  provides:
    - "apps/server/src/services/task-queue-store.ts (enqueueTaskForIssue, cancelPendingTasksForIssueAgent, cancelAllTasksForIssue, getPendingTaskForIssueAgent — all accept optional trx)"
    - "apps/server/src/services/issue-store.ts#applyIssueSideEffects (private — dispatches based on prev→next status/assignee delta)"
    - "apps/server/src/routes/issues.ts — issue:created|updated|deleted|reordered WS broadcasts"
  affects:
    - "Phase 17-04 comments + triggerCommentId flow — enqueueTaskForIssue already accepts triggerCommentId"
    - "Phase 18 task lifecycle — this plan reserves claim/reaper/complete/fail space at top of task-queue-store.ts"
    - "Phase 25 UI — issue:* WS event channels on the workspace subscription key are the frontend contract"
tech_stack:
  added: []
  patterns:
    - "runner(trx) helper: returns trx ?? db so every exported helper composes cleanly inside an outer db.transaction"
    - "idempotency-by-pre-check inside trx: getPendingTaskForIssueAgent runs before INSERT (partial UNIQUE is a safety net, not the first defence)"
    - "mutually-exclusive decision ladder in applyIssueSideEffects: cancelled-transition first (highest priority, stops everything), then reassignment, then leaving-backlog"
    - "WS broadcasts emitted OUTSIDE the transaction (after res.json success path) so we never publish state for a write that later rolls back"
    - "Soft-fail on null runtime_id (console.warn + return null) — issue-store needs reassign-to-unassigned to cancel old and silently skip enqueue"
key_files:
  created:
    - "apps/server/src/services/task-queue-store.ts (225 LOC)"
  modified:
    - "apps/server/src/services/issue-store.ts (+89 LOC — applyIssueSideEffects helper + updateIssue integration)"
    - "apps/server/src/routes/issues.ts (+20 LOC — broadcast import + 4 event emissions)"
decisions:
  - "Phase 17 ships ONLY enqueue + cancel for task-queue-store. claimTask / startTask / completeTask / failTask / reapStaleTasks are explicitly deferred to Phase 18 and are called out in a top-of-file JSDoc as the extension surface — prevents any half-baked task lifecycle surface leaking now."
  - "applyIssueSideEffects is a private helper inside issue-store.ts, not exported. Callers update issues only via updateIssue; the side-effect hook fires automatically inside the same db.transaction. Removes any possibility of a route or future service bypassing the hook."
  - "`cancelAllTasksForIssue` cancels running tasks too (not just queued/dispatched) because ISSUE-04 intent is 'issue is dead, kill all work for it'. Phase 18 will add runtime-side abort propagation around the same call site; the DB-state flip is correct as shipped today."
  - "WS namespace `issue:*` is owned by Phase 17; `task:*` events are reserved for Phase 18. Broadcasting a half-specced task:queued now would lock a channel shape before the claim/progress/completion contract exists."
  - "Enqueue soft-fails on archived or runtime-less agents. The reassignment path then still cancels the old pending task cleanly. Throwing on the new-assignee side would leave the old task stuck on the previous agent — worse UX and a harder partial-state to reason about."
  - "WS broadcasts run AFTER the transaction commits (in the route handler, not the service). If the DB write rolls back we never publish a ghost event."
metrics:
  duration: "~4 minutes"
  completed_date: "2026-04-16"
  tasks: 2
  files_created: 1
  files_modified: 2
  commits: 2
---

# Phase 17 Plan 03: Issue Status Side-Effects + Task-Queue Hooks Summary

## One-Liner

Shipped the issue-status-driven task lifecycle: `PATCH /api/issues/:id` now atomically enqueues a task on assign, swaps pending tasks on reassign, and cancels all live tasks on issue-cancellation — with `issue:*` WS events fanned out to workspace subscribers after commit.

## What Shipped

### `apps/server/src/services/task-queue-store.ts` (225 LOC — NEW)

A minimum enqueue + cancel surface for the `agent_task_queue` table. Four exports, every one accepting an optional `trx?: Knex.Transaction` for composability inside the caller's transaction:

- **`enqueueTaskForIssue({ workspaceId, issueId, agentId, triggerCommentId?, priority?, trx? })`** — reads the agent's `runtime_id` + `archived_at` in-trx (respects 17-01 soft-archive), returns `null` for archived or unassigned agents (soft-fail with `console.warn`), idempotency-checks via `getPendingTaskForIssueAgent`, then INSERTs a `status='queued'` row. Throws only on missing-agent-in-workspace (cross-workspace guard — T-17-03-03).
- **`cancelPendingTasksForIssueAgent({ workspaceId, issueId, agentId, trx? })`** — UPDATE status='cancelled' + cancelled_at=now WHERE (issue, agent) status IN (queued, dispatched). Returns rows-affected.
- **`cancelAllTasksForIssue({ workspaceId, issueId, trx? })`** — UPDATE status='cancelled' + cancelled_at=now WHERE issue_id=? status IN (queued, dispatched, running). Used by ISSUE-04.
- **`getPendingTaskForIssueAgent(workspaceId, issueId, agentId, trx?)`** — SELECT matching the partial-unique predicate. Used for idempotency pre-check; Phase 18 tests will reuse it.

The module's top-level JSDoc explicitly names the Phase 18 extension surface (`claimTask`, `startTask`, `progressTask`, `completeTask`, `failTask`, `reapStaleTasks`, `cancelTask`) so the next phase lands on a file that already documents its open surface.

### `apps/server/src/services/issue-store.ts` (+89 LOC)

- **New private helper `applyIssueSideEffects(trx, workspaceId, prev, next, issueId)`**: mutually-exclusive decision ladder —
  - `next.status='cancelled' && prev.status!='cancelled'` → `cancelAllTasksForIssue` (ISSUE-04) and `return` (stops ladder).
  - `reassignment = next.assigneeId !== prev.assigneeId` →
    - if `prev.assigneeId` set → `cancelPendingTasksForIssueAgent` for OLD agent.
    - if `next.assigneeId` set AND `next.status !== 'backlog'` → `enqueueTaskForIssue` for NEW agent.
    - `return` (stops ladder).
  - `leavingBacklog = prev.status='backlog' && next.status!='backlog'` AND `next.assigneeId` set → `enqueueTaskForIssue`.
- **`updateIssue` modification**: after the field UPDATE and before the read-back, `applyIssueSideEffects` is invoked with `trx` (the existing transaction handle). `nextStatus` / `nextAssigneeId` are computed with the patch-or-existing fallback so the hook sees the effective final state. Any throw rolls back the whole transaction.

No new exports — `applyIssueSideEffects` stays private. `createIssue` deliberately does NOT run the hook: a new issue starts at `status='backlog'`, has no prev-state to diff, and thus no side-effect is owed.

### `apps/server/src/routes/issues.ts` (+20 LOC)

- Added `import { broadcast } from '../ws/index.js';`
- 4 new WS emissions, each on `DEFAULT_WORKSPACE_ID`, positioned AFTER the DB commit:
  - POST `/` → `{ type: 'issue:created', issueId, payload: issue }`
  - PATCH `/:id` → `{ type: 'issue:updated', issueId, payload: issue }`
  - DELETE `/:id` → `{ type: 'issue:deleted', issueId }`
  - POST `/:id/reorder` → `{ type: 'issue:reordered', issueId, payload: { position } }`
- Zero `task:*` events. Phase 18 owns that channel suite.

## Requirements Satisfied

- **ISSUE-02 — assign → enqueue when non-backlog**: `applyIssueSideEffects` enqueues on reassignment-to-a-new-agent when `next.status !== 'backlog'`, and on leaving-backlog when the assignee is already set. Enqueue on a backlog issue is suppressed.
- **ISSUE-03 — reassignment cancels + re-enqueues atomically**: both helper calls receive the outer `trx` — cancel + enqueue are a single transactional unit. Any throw between them rolls back both the cancel and the field UPDATE. Clearing assignee (new = null) cancels old and enqueues none. Reassigning to the same agent is not a reassignment (the ladder falls through; `task-queue-store`'s idempotency would no-op it anyway).
- **ISSUE-04 — status='cancelled' cancels all live tasks**: top-priority branch; runs `cancelAllTasksForIssue` over queued/dispatched/running and returns before the reassignment/leaving-backlog logic can fire.

## Atomicity Proof

```
$ grep -n trx, apps/server/src/services/issue-store.ts
207:        trx,        # cancelAllTasksForIssue call passes outer trx
216:        trx,        # cancelPendingTasksForIssueAgent call passes outer trx
228:        trx,        # enqueueTaskForIssue call passes outer trx (reassignment branch)
283:      trx,          # applyIssueSideEffects call from updateIssue passes outer trx
```

Every task-queue helper call from `applyIssueSideEffects` passes the same `trx` — the `db.transaction(async (trx) => { ... })` that wraps the whole `updateIssue` flow. The partial-unique index `idx_one_pending_task_per_issue_agent` (migration 007) remains the schema-level backstop.

## Verification

- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0
- Task 1 acceptance criteria (8 greps) — all pass
- Task 2 acceptance criteria (11 greps) — all pass:
  - `applyIssueSideEffects` = 2 (definition + call)
  - `cancelAllTasksForIssue` = 3 (import + JSDoc + call; spec required ≥1)
  - `cancelPendingTasksForIssueAgent` = 3 (import + JSDoc + call; spec required ≥1)
  - `enqueueTaskForIssue` = 5 (import + 2 JSDoc refs + 2 call sites; spec required ≥2)
  - `from './task-queue-store.js'` = 1
  - `import { broadcast } from '../ws/index.js'` = 1
  - each of `issue:created|updated|deleted|reordered` = 1
  - `task:*` occurrences = 0 (correctly deferred)

## Patterns Established (for 17-04 / Phase 18)

1. **Optional `trx` everywhere**: every new task-queue helper signature has `trx?: Knex.Transaction`. A `runner(trx)` convenience resolves to `trx ?? db` so the query body is identical between "I'm the transaction" and "I'm inside one". Phase 18's claim/start/complete/fail path must keep this shape.
2. **Side-effect hook attached to service, not route**: `updateIssue` owns the side-effect dispatch. Routes cannot accidentally bypass the hook. Phase 17-04 should follow suit — `addComment` will own the comment-triggered-enqueue hook inside its transaction.
3. **WS emission after commit**: broadcasts live in the route, not the service, and fire only on the success path. No ghost events if the DB rolls back.
4. **WS namespace discipline**: Phase 16 owns `runtime:*`, Phase 17 owns `issue:*` + (17-04) `comment:*`, Phase 18 owns `task:*`. Anything else is out-of-band.

## Deviations from Plan

None — plan executed exactly as written. The mutually-exclusive branch ordering (cancelled → reassignment → leaving-backlog), the read-before-UPDATE existing-row snapshot for the prev state, the `computed nextStatus/nextAssigneeId` fallback-to-existing, the soft-fail-on-null-runtime behaviour, the 4-event WS broadcast set, and every acceptance grep match the plan verbatim.

## Auth Gates

None encountered — all work was local code + typecheck.

## Known Stubs

None. The deferred Phase 18 lifecycle surface (claim/reaper/complete/fail) is intentionally absent per the plan's explicit wave scoping, not a UI or data stub. The top-of-file JSDoc in `task-queue-store.ts` names each deferred function so Phase 18 knows exactly where to hook in.

## Downstream Readiness

- **17-04 comments + task-messages**: `enqueueTaskForIssue` already accepts `triggerCommentId` — the comment-triggered enqueue path in plan 17-04 plugs straight in.
- **Phase 18 task lifecycle**: the top-of-file JSDoc in `task-queue-store.ts` names every deferred function. The `runner(trx)` helper pattern and the trx-first signature shape are reusable for `claimTask`'s BEGIN IMMEDIATE path.
- **Phase 25 kanban UI**: `issue:created|updated|deleted|reordered` events on the workspace channel are the subscription contract; frontend `WebSocketContext` will dispatch on `type`.

## Commits

- `cf1d30e` — `feat(17-03): add task-queue-store Phase-17 slice (enqueue + cancel)`
- `cb07f2d` — `feat(17-03): wire issue status side-effects + issue:* WS broadcasts`

## Self-Check: PASSED

Files verified present:
- `apps/server/src/services/task-queue-store.ts` — FOUND
- `apps/server/src/services/issue-store.ts` — modified (applyIssueSideEffects defined at line ~163, called at line ~283)
- `apps/server/src/routes/issues.ts` — modified (broadcast import at line 16, 4 broadcasts added)
- `.planning/phases/17-agent-issue-comment-services/17-03-SUMMARY.md` — this file

Commits verified in `git log`:
- `cf1d30e` — FOUND
- `cb07f2d` — FOUND

Acceptance-criteria grep counts (Task 1 + Task 2) — all pass.
Typecheck + shared build — exit 0.
Atomicity proof — every task-queue call from `applyIssueSideEffects` passes `trx`.
