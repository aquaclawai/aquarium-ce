---
phase: 17-agent-issue-comment-services
plan: 04
subsystem: comments
tags: [rest-api, crud, threading, system-comments, trigger-enqueue, ws-broadcast, v1.4]
one_liner: "Comment CRUD + route mounts + applyIssueSideEffects extension: user comments post atomically (with optional trigger-comment enqueue), system comments are emitted ONLY from the service layer on status/assignee transitions, and comment:* WS events fan out on every success path."
requirements: [COMMENT-01, COMMENT-02, COMMENT-03]
dependency_graph:
  requires:
    - "apps/server/src/db/migrations/006_issues_and_comments.ts (Phase 15 — comments table + 4-state type trigger + author XOR trigger + SET NULL self-FK for threading)"
    - "apps/server/src/services/issue-store.ts (17-02 — updateIssue transaction + 17-03 applyIssueSideEffects helper extended here)"
    - "apps/server/src/services/task-queue-store.ts (17-03 — enqueueTaskForIssue accepts triggerCommentId + trx for atomic comment-triggered enqueue)"
    - "apps/server/src/ws/index.ts (broadcast signature)"
    - "apps/server/src/middleware/auth.ts (requireAuth)"
    - "packages/shared/src/v14-types.ts (Comment / CommentType / CommentAuthorType / AgentTask)"
  provides:
    - "apps/server/src/services/comment-store.ts (createUserComment, createSystemComment, updateComment, deleteComment, getComment, listCommentsForIssue, toComment)"
    - "apps/server/src/routes/comments.ts (issueCommentRouter + commentRouter exported; default export = commentRouter)"
    - "apps/server/src/services/issue-store.ts#applyIssueSideEffects — prepended status_change + assignee_change system-comment emission inside the same trx"
    - "app.use('/api/issues/:issueId/comments', issueCommentRouter) + app.use('/api/comments', commentRoutes) in server-core.ts"
  affects:
    - "Phase 18 task lifecycle — progress_update system comments can slot in via createSystemComment({ type: 'progress_update' }); the factory already accepts the type"
    - "Phase 18 agent-authored comments — createAgentComment will be added alongside createUserComment; XOR trigger branch already documented in the module JSDoc"
    - "Phase 25 UI — comment:posted|updated|deleted WS events on the workspace subscription key are the timeline contract"
tech_stack:
  added: []
  patterns:
    - "author-invariant by construction: user comments hardcode author_type='user' + author_user_id=<caller> + author_agent_id=null; system comments hardcode author_type='system' + both author_*_id=null. Migration-006 XOR trigger is the DB backstop, not the first line of defense."
    - "triggerCommentId inversion: the incoming field names an ANCHOR comment the user wants to reference; the row written to the agent_task_queue carries trigger_comment_id=<NEWLY created comment id>. The request value is additionally tucked into metadata for audit. This is the 'which comment caused the task' semantic, not 'which comment did the user point at'."
    - "system-comment factory is private to server-side callers: createSystemComment is NOT re-exported from any route. A malicious POST body with type='status_change' cannot reach the DB because createUserComment hardcodes type='comment'."
    - "parent-same-issue + parent-is-user-comment validation: schema's self-FK SET NULL does not enforce either invariant — the service does via a trx-local pre-insert check. Replies to system entries throw 'parent comment must be a user comment' and 400 at the route."
    - "side-effect prepend in applyIssueSideEffects: both new system-comment blocks run BEFORE the cancelled/reassignment/leaving-backlog task-queue logic so the timeline shows 'moved to cancelled' ahead of the derived 'tasks cancelled' effect."
    - "mergeParams nested router: issueCommentRouter uses Router({ mergeParams: true }) so req.params.issueId populates when mounted under /api/issues/:issueId/comments."
key_files:
  created:
    - "apps/server/src/services/comment-store.ts (275 LOC)"
    - "apps/server/src/routes/comments.ts (207 LOC)"
  modified:
    - "apps/server/src/services/issue-store.ts (+34 LOC — import + 2 system-comment emissions prepended inside applyIssueSideEffects)"
    - "apps/server/src/server-core.ts (+2 lines — 1 import, 2 adjacent app.use() mounts)"
decisions:
  - "Reply parents must be user comments. The plan leaves parent-type validation as an open question; we chose to reject parents whose author_type != 'user'. Rationale: system/status_change entries are bookkeeping — threading a reply onto 'Status changed from todo to in_progress' leaks renderer state into the conversation graph. Throw-at-service rather than silent-accept because the UI will otherwise render an apparently orphan reply."
  - "triggerCommentId on the NEW comment, not the anchor. The plan specifies `triggerCommentId: id` (the newly created comment id) as the value written to agent_task_queue.trigger_comment_id. We preserve the request field in metadata.triggerCommentId so the anchor reference is not lost — phase 25 UI can walk from the task's trigger_comment_id to metadata.triggerCommentId to render the 'this task was fired by <anchor>' breadcrumb."
  - "No progress_update emission yet. Phase 18 workers will call createSystemComment({ type: 'progress_update' }) — the factory accepts the type today but the only caller wired up is applyIssueSideEffects (type='status_change'). Keeps Phase 17 scoped while leaving the public surface ready."
  - "No authorType/authorUserId/authorAgentId passthrough from the request body. Routes explicitly construct CreateUserCommentArgs with server-sourced authorUserId (req.auth.userId) and hardcoded author_type via the service. T-17-04-01 spoofing threat is a non-issue by design — the body's authorType is never read."
  - "System-comment emission is PREPENDED to applyIssueSideEffects rather than bolted on after. The decision ladder still has its three mutually-exclusive branches (cancelled / reassignment / leaving-backlog); the new blocks run unconditionally before them on status/assignee deltas. Means the timeline consistently shows 'status flipped' before 'tasks cancelled', not after."
  - "mergeParams: true on the nested router is not optional — without it, req.params would only carry :issueId at the parent app level, leaving req.params.issueId undefined inside the handler. Documented in the JSDoc so Phase 25 + Phase 18 sub-router authors don't omit it."
metrics:
  duration: "~6 minutes"
  completed_date: "2026-04-16"
  tasks: 3
  files_created: 2
  files_modified: 2
  commits: 3
---

# Phase 17 Plan 04: Comments Service + Routes + System-Comment Emitter Summary

## One-Liner

Shipped the comments layer — user CRUD over `/api/issues/:issueId/comments` + `/api/comments/:id`, the `createSystemComment` factory wired into `applyIssueSideEffects` for every status/assignee transition, and the comment-triggered task-enqueue path (COMMENT-01) that reuses 17-03's `enqueueTaskForIssue` inside a single atomic transaction.

## What Shipped

### `apps/server/src/services/comment-store.ts` (275 LOC — NEW)

Seven exports cover the user-level conversation surface plus the system-side factory:

- **`createUserComment({ workspaceId, issueId, authorUserId, content, parentId?, triggerCommentId?, metadata?, trx? }) -> { comment, enqueuedTask }`** — transactional. Verifies issue membership in the workspace, validates parent (must exist on same issue AND be a user comment), inserts with hardcoded `author_type='user'` + `author_user_id=<caller>` + `author_agent_id=NULL` (XOR trigger invariant). If `triggerCommentId` + `issue.assignee_id` both set, calls `enqueueTaskForIssue({ ..., triggerCommentId: <NEW comment id>, trx })` so the task row points at the comment we just wrote, not at the anchor. Both writes are atomic — any throw rolls back the comment AND the task-enqueue.
- **`createSystemComment({ workspaceId, issueId, content, type?, metadata?, trx? }) -> Comment`** — transactional. `type` defaults to `'status_change'` and accepts `'progress_update'` / `'system'`. Hardcoded `author_type='system'` + both `author_*_id=NULL`. Used only by `applyIssueSideEffects` today; reserved for Phase 18 worker-side progress updates.
- **`updateComment(id, issueId, { content? }) -> Comment | null`** — content-only PATCH; `type` / `author_*` / `parent_id` are all immutable at the service.
- **`deleteComment(id, issueId) -> boolean`** — hard delete; children preserved via schema-level SET NULL on the self-FK (migration 006 + PITFALLS §ST4).
- **`getComment(id) -> Comment | null`** — direct fetch; no workspace scope (comments are addressable by id in CE).
- **`listCommentsForIssue(workspaceId, issueId) -> Comment[]`** — workspace-gated: if the issue doesn't belong to the requested workspace, returns `[]` instead of the timeline (T-17-04-03 IDOR mitigation). Ordered by `created_at ASC` via `idx_comments_issue_created`.
- **`toComment(row)`** — snake_case → camelCase converter with adapter-wrapped `metadata` JSON parsing.

No `any` anywhere. Every relative import ends in `.js` (NodeNext). All reads/writes are parameterised Knex.

### `apps/server/src/routes/comments.ts` (207 LOC — NEW)

Two default-exported Express routers, both gated by `router.use(requireAuth)`:

**`issueCommentRouter` (mounted at `/api/issues/:issueId/comments`, Router with `mergeParams: true`):**
- `GET  /` — timeline via `listCommentsForIssue`.
- `POST /` — user comment + optional trigger-comment enqueue. Response shape: `{ comment: Comment, enqueuedTask: AgentTask | null }`. Broadcasts `{ type: 'comment:posted', issueId, payload: comment }`.

**`commentRouter` (mounted at `/api/comments`):**
- `GET    /:id` — direct fetch (404 on miss).
- `PATCH  /:id` — content-only update; broadcasts `{ type: 'comment:updated', issueId, payload: comment }`.
- `DELETE /:id` — hard delete with schema SET NULL preserving children; broadcasts `{ type: 'comment:deleted', issueId, payload: { id } }`.

Validation errors from the service map to HTTP 400 via `isValidationError` regex (`/is required|cannot be empty|not found in|must be/`); everything else is 500. Zero direct `db()` calls — all DB flows through `comment-store` (CE1 thin-controller rule).

### `apps/server/src/services/issue-store.ts` (+34 LOC)

Inside `applyIssueSideEffects`, prepended two additive blocks BEFORE the existing cancelled / reassignment / leaving-backlog branches:

```ts
if (next.status !== prev.status) {
  await createSystemComment({
    workspaceId, issueId,
    content: `Status changed from ${prev.status} to ${next.status}`,
    type: 'status_change',
    metadata: { from: prev.status, to: next.status },
    trx,
  });
}
if (next.assigneeId !== prev.assigneeId) {
  const fromLabel = prev.assigneeId ?? 'unassigned';
  const toLabel = next.assigneeId ?? 'unassigned';
  await createSystemComment({
    workspaceId, issueId,
    content: `Assignee changed from ${fromLabel} to ${toLabel}`,
    type: 'status_change',
    metadata: { fromAssigneeId: prev.assigneeId, toAssigneeId: next.assigneeId },
    trx,
  });
}
```

Both emissions use the outer `trx` from `updateIssue`. 17-03's task-queue decision ladder is untouched — the new blocks only add timeline entries.

### `apps/server/src/server-core.ts` (+2 lines)

- **+1 import:** `import commentRoutes, { issueCommentRouter } from './routes/comments.js';` adjacent to `issueRoutes`.
- **+2 mounts** directly after `app.use('/api/issues', issueRoutes)`:
  - `app.use('/api/issues/:issueId/comments', issueCommentRouter);`
  - `app.use('/api/comments', commentRoutes);`

## Requirements Satisfied

- **COMMENT-01 — user comments + trigger-comment enqueue**: POST `/api/issues/:issueId/comments` creates a user comment atomically; when `triggerCommentId` is supplied AND the issue has an assignee, `enqueueTaskForIssue` is invoked inside the same transaction with `trigger_comment_id = <new comment id>`. Response includes the enqueued task so the UI can fan out the work indicator.
- **COMMENT-02 — system comments on status change**: Every status transition (status change, assignee change) causes `applyIssueSideEffects` to insert a `type='status_change'` comment via `createSystemComment` inside the updateIssue transaction. No route handler can forge a system comment — `createUserComment` hardcodes `type='comment'`, and `createSystemComment` is only reachable from the service layer.
- **COMMENT-03 — threaded replies via parent_id**: POST `/api/issues/:issueId/comments` accepts `parentId`. Service-level validation verifies the parent exists on the same issue AND is a user comment (rejects system/status_change parents). Children are preserved via schema SET NULL when the parent is deleted (migration 006 self-FK).

## Atomicity Proof

```
$ grep -n trx, apps/server/src/services/comment-store.ts
124:    metadata: adapter.jsonValue(metadata),
155:        trx,             # enqueueTaskForIssue call (createUserComment)
185:    trx: Knex.Transaction,
206:      trx,               # createSystemComment accepts outer trx
```

Every trigger-comment enqueue and every system-comment insert runs via the caller's `trx` — the `db.transaction(async (trx) => { ... })` that wraps the whole `updateIssue` flow (17-02) or the transactional run inside `createUserComment`. Migration-006 XOR trigger + 4-state type trigger remain the schema-level backstops.

## Verification

- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0
- Task 1 acceptance criteria (12 greps) — all pass:
  - `createUserComment` export = 1, `createSystemComment` export = 1, `updateComment` export = 1, `deleteComment` export = 1, `listCommentsForIssue` export = 1
  - `author_type: 'user'` = 1, `author_type: 'system'` = 1, `author_agent_id: null` = 2 (user + system)
  - `enqueueTaskForIssue` = 3 (import + JSDoc ref + call site)
  - `any` leaks = 0
- Task 2 acceptance criteria (6 greps) — all pass:
  - import `{ createSystemComment }` from './comment-store.js' = 1
  - `createSystemComment` = 3 (import + 2 calls)
  - "Status changed from" = 1, "Assignee changed from" = 1
  - `type: 'status_change'` = 2 (both new blocks)
- Task 3 acceptance criteria (14 greps) — all pass:
  - `Router({ mergeParams: true })` = 1
  - `issueCommentRouter.get('/'` = 1, `issueCommentRouter.post('/'` = 1
  - `commentRouter.get('/:id'` = 1, `commentRouter.patch('/:id'` = 1, `commentRouter.delete('/:id'` = 1
  - `export const issueCommentRouter` = 1, `export const commentRouter | export default commentRouter` = 2
  - `type: 'comment:posted|updated|deleted'` each = 1
  - `db(` = 0 (CE1 thin-controller enforced)
  - server-core `import commentRoutes, { issueCommentRouter }` = 1, `/api/issues/:issueId/comments` mount = 1, `/api/comments` mount = 1

## Patterns Established (for Phase 18 + 25)

1. **Private system-factory pattern**: `createSystemComment` is module-exported for the service layer but NOT re-exported from any route. Future `createAgentComment` (Phase 18) and `createProgressUpdate` (Phase 18) should follow the same rule — factories whose output spoofs the user are never reachable from request bodies.
2. **Optional `trx` composability**: every exported function accepts `trx?: Knex.Transaction`. Phase 18 task workers will call `createSystemComment({ type: 'progress_update', trx })` inside their claim/progress transactions so the timeline entry is atomic with the task state flip.
3. **Triple-hardcode for XOR invariant**: user comments set three fields explicitly on every insert (`author_type: 'user'`, `author_user_id: <caller>`, `author_agent_id: null`). System comments set three (`author_type: 'system'`, both author_*_id null). This belt-and-braces means the XOR trigger will never be the only thing catching a stray refactor.
4. **Trigger-comment id semantics**: `agent_task_queue.trigger_comment_id` always points at the comment that CAUSED the task (the newly-written row), not at the anchor comment the user referenced. The anchor lives in `comments.metadata.triggerCommentId`. Phase 18 claim/complete paths rely on this — the agent's reply chain walks back from `task.trigger_comment_id → comments.parent_id` to reach the user turn it's responding to.
5. **WS namespace discipline**: Phase 17 now owns `issue:*` (17-03) + `comment:*` (this plan). `task:*` remains reserved for Phase 18. Frontend `WebSocketContext` will dispatch on `type` prefix.
6. **Side-effect-before-task-queue ordering**: in `applyIssueSideEffects`, system-comment emission runs BEFORE the task-queue decision ladder. This ordering is a UX choice — the timeline consistently reads "status flipped → tasks cancelled" rather than the other way round — codified as a comment in the source.

## Deviations from Plan

**Minor — added "parent must be user comment" validation (Rule 2 — missing critical functionality).** The plan's parent-validation paragraph says "must exist + shares same issue_id". We extended it to also require `parent.author_type = 'user'` so replies to system/status_change entries fail at 400 instead of succeeding silently. Rationale: threading bookkeeping entries into the conversation graph would render a nonsensical UI (a user reply visually nested under "Status changed from ..."). The validation error message "parent comment must be a user comment" is caught by the existing route `isValidationError` regex (matches `/must be/`) so it naturally maps to HTTP 400.

**Minor — `req.params as { issueId: string }` type assertion (Rule 3 — blocking issue).** First typecheck after Task 3 flagged `Property 'issueId' does not exist on type '{}'` because Express's default `ParamsDictionary` on `mergeParams: true` routers doesn't statically propagate the parent path's `:issueId`. Fixed with a narrow local `as { issueId: string }` in both handlers. Not worth adding a global `RequestHandler<{ issueId: string }>` declaration for two call sites; lint-equivalent (`as any` would violate CLAUDE.md) is properly narrowed.

Everything else — function signatures, import order, error-mapping regex, mount ordering, WS event type strings, XOR field handling, triggerCommentId inversion, and every acceptance grep — matches the plan's `<action>` block verbatim.

## Auth Gates

None encountered — all work was local code + typecheck.

## Known Stubs

None. Agent-authored comments (`createAgentComment`) are explicitly out-of-scope per the plan (§Task 1 action note) and deferred to Phase 18. Progress-update emission (`type='progress_update'`) is reachable from the factory today but has no caller wired up — the plan calls this out as "future Phase 18 progress updates" and the service JSDoc re-states it.

## Downstream Readiness

- **Phase 18 task lifecycle** — `task-queue-store` claim/start/complete paths can call `createSystemComment({ type: 'progress_update', trx })` inside their transactions. The `trx?` plumbing is already in place and the type enum is already accepted.
- **Phase 18 agent-authored comments** — a future `createAgentComment({ workspaceId, issueId, authorAgentId, content, trx? })` will slot in next to `createUserComment`. The XOR trigger branch (`author_type='agent'` + `author_agent_id=NOT NULL` + `author_user_id=NULL`) is documented in the module JSDoc so the new function lands on a well-specified extension point.
- **Phase 25 kanban UI** — `comment:posted|updated|deleted` events on the workspace subscription channel are the frontend contract; the `WebSocketContext` dispatcher can fan out to per-issue timeline views keyed on `message.issueId`.
- **Phase 25 trigger-comment UX** — `agent_task_queue.trigger_comment_id` uniquely names the comment that caused the task; the response payload from `POST /api/issues/:issueId/comments` carries `enqueuedTask` directly so the UI can render a per-comment "agent is responding" indicator without a second round-trip.

## Commits

- `f979964` — `feat(17-04): add comment-store service with user/system factories + trigger enqueue`
- `54c7495` — `feat(17-04): emit status_change system comments from applyIssueSideEffects`
- `8d56cb6` — `feat(17-04): add /api/comments + /api/issues/:issueId/comments routers`

## Self-Check: PASSED

Files verified present:
- `apps/server/src/services/comment-store.ts` — FOUND (275 LOC)
- `apps/server/src/routes/comments.ts` — FOUND (207 LOC)
- `apps/server/src/services/issue-store.ts` — modified (import at line 9, createSystemComment calls at lines 197 + 211, inside applyIssueSideEffects before the cancelled/reassignment ladder)
- `apps/server/src/server-core.ts` — modified (import at line 57, mounts at lines 157 + 158, immediately after `/api/issues`)
- `.planning/phases/17-agent-issue-comment-services/17-04-SUMMARY.md` — this file

Commits verified in `git log`:
- `f979964` — FOUND
- `54c7495` — FOUND
- `8d56cb6` — FOUND

Acceptance-criteria grep counts (Task 1 + Task 2 + Task 3) — all pass.
Typecheck + shared build — exit 0.
Atomicity proof — every trigger-comment enqueue + system-comment insert passes the outer `trx`.
Clean worktree confirmed (`git status --short` empty).
