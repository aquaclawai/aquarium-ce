---
phase: 17-agent-issue-comment-services
plan: 02
subsystem: issues
tags: [rest-api, crud, kanban, fractional-order, workspace-scoped, v1.4]
one_liner: "Issue CRUD + fractional-position reorder with atomic issue_number allocation from workspaces.issue_counter and transactional renumber sweep on precision collapse."
requirements: [ISSUE-01, ISSUE-05]
dependency_graph:
  requires:
    - "apps/server/src/db/migrations/006_issues_and_comments.ts (Phase 15 — issues table + triggers + UNIQUE(workspace_id, issue_number))"
    - "apps/server/src/db/migrations/003_boot_pragmas_and_workspace.ts (SQLite busy_timeout=5000 + WAL for writer serialisation)"
    - "workspaces.issue_counter column (Phase 15-04 — atomic allocation source)"
    - "apps/server/src/db/adapter.ts (getAdapter / jsonValue / parseJson)"
    - "apps/server/src/middleware/auth.ts (requireAuth)"
    - "packages/shared/src/v14-types.ts (Issue / IssueStatus / IssuePriority)"
  provides:
    - "apps/server/src/services/issue-store.ts (createIssue, updateIssue, deleteIssue, getIssue, listIssues, reorderIssue, toIssue + type exports)"
    - "apps/server/src/routes/issues.ts (default Router: GET / GET:id / POST / PATCH:id / DELETE:id / POST:id/reorder)"
    - "app.use('/api/issues', issueRoutes) in server-core.ts (mounted adjacent to /api/agents from 17-01)"
  affects:
    - "Phase 17-03 task-dispatch attaches status-transition side-effects around updateIssue (task enqueue on → in_progress, task cancel on → cancelled/blocked)"
    - "Phase 17-04 comments will FK issue_id onto this plan's issue rows (FK CASCADE on delete)"
    - "Phase 18 agent-task-queue will FK issue_id → issues.id"
    - "Phase 23+ kanban UI will drive POST /:id/reorder from drag-and-drop"
tech_stack:
  added: []
  patterns:
    - "atomic counter allocation inside db.transaction() via increment('issue_counter', 1) + read-back (per 15-04 SUMMARY §'Reminder for Phase 17')"
    - "fractional position with midpoint bisection + collapse-detection (epsilon=1e-6) + renumber sweep (step=1000) inside the same transaction"
    - "orderByRaw with literal constant CASE WHEN idiom for NULLS-LAST ordering (SQLi-safe — no user input concatenation)"
    - "structural twin of services/runtime-registry.ts + services/agent-store.ts (17-01) — toIssue row converter, workspace-scoped queries, adapter-wrapped JSON metadata column"
    - "thin-controller route pattern cloned verbatim from routes/agents.ts — DEFAULT_WORKSPACE_ID='AQ', satisfies ApiResponse<T>, validation-error-to-400 regex"
key_files:
  created:
    - "apps/server/src/services/issue-store.ts (348 LOC)"
    - "apps/server/src/routes/issues.ts (175 LOC)"
  modified:
    - "apps/server/src/server-core.ts (2 lines added — import at 56, mount at 156; 17-01's /api/agents lines at 55 + 155 left intact)"
decisions:
  - "Atomic issue_number allocation runs inside db.transaction() with increment() + read-back. SQLite's BEGIN IMMEDIATE (via busy_timeout=5000 + WAL from migration 003) serialises concurrent writers; UNIQUE(workspace_id, issue_number) is the DB backstop."
  - "Renumber sweep uses RENUMBER_STEP=1000 with COLLAPSE_EPSILON=1e-6. step=1000 gives ~2^20 (≈10^6) headroom for successive midpoint divisions before the next sweep fires — safely beyond any realistic user-driven drag session."
  - "Kanban ordering is 'position NULLS LAST, created_at DESC' implemented as a literal constant orderByRaw string + Knex .orderBy chain. Constant-only ensures CLAUDE.md §'never string-concat SQL' holds."
  - "Status transitions in updateIssue are pure field updates (including completed_at / cancelled_at timestamp bookkeeping). Task enqueue/cancel side-effects explicitly deferred to plan 17-03 so that plan can depend on Phase 18 task services without bleeding into basic CRUD — clean layering per wave decomposition."
  - "DELETE /api/issues/:id is a hard delete (unlike DELETE /api/agents/:id which is soft-archive). Issues are the parent of the comments + agent_task_queue FK cascades — a true delete is the intended child-cleanup semantic."
  - "readPosition throws on missing neighbour ids (400 via isValidationError). Silently treating an unknown id as NULL would mask client bugs; an explicit 400 with 'neighbour issue X not found in workspace' is what the UI actually wants."
metrics:
  duration: "~3 minutes"
  completed_date: "2026-04-16"
  tasks: 2
  files_created: 2
  files_modified: 1
  commits: 2
---

# Phase 17 Plan 02: Issue Service + REST Routes Summary

## One-Liner

Shipped first-class issue CRUD (ISSUE-01) with atomic `issue_number` allocation from `workspaces.issue_counter` and fractional kanban reorder (ISSUE-05) with renumber-sweep safety net, as a structural twin of 17-01's agent service pair, establishing the persistence surface that plans 17-03 / 17-04 / Phase 18 will layer task-dispatch and comments onto.

## What Shipped

### `apps/server/src/services/issue-store.ts` (348 LOC)

- **`createIssue(args: CreateIssueArgs): Promise<Issue>`** — runs the entire allocation + INSERT inside `db.transaction()`:
  1. `trx('workspaces').where({ id }).increment('issue_counter', 1)`
  2. Read-back `issue_counter` from the same row in the same transaction
  3. INSERT the `issues` row with that value as `issue_number`
  4. Re-read the row and convert via `toIssue`
  API-boundary validates `status` / `priority` against whitelists + non-empty `title` guard before any DB write. `position` defaults to NULL (first drag sets it per plan §ISSUE-05).
- **`updateIssue(id, workspaceId, patch): Promise<Issue | null>`** — PATCH semantics: only keys present in `patch` enter the UPDATE. Status / priority re-validated when present. When `status` transitions TO `done` (and `completed_at` was NULL), `completed_at = now()`. Same bookkeeping for `cancelled`. No task enqueue / cancel — those attach in plan 17-03.
- **`deleteIssue(id, workspaceId): Promise<boolean>`** — hard delete; FK CASCADE from migration 006 removes child comments and (future) agent_task_queue rows.
- **`getIssue` / `listIssues`** — workspace-scoped reads. `listIssues` supports optional `status` + `assigneeId` filters and orders by `position` NULLS LAST then `created_at DESC` via a literal constant `orderByRaw` CASE-WHEN idiom (SQLi-safe).
- **`reorderIssue(id, workspaceId, { beforeId?, afterId? }): Promise<Issue | null>`** — the ISSUE-05 hot path. Reads neighbour positions inside the transaction, computes midpoint (or `±RENUMBER_STEP` when one side is open), and — if `|beforePos - afterPos| < COLLAPSE_EPSILON` — runs `renumberWorkspacePositions` inside the same transaction before retrying.
- **Private helpers:** `toIssue(row)` row→shared-type converter, `validateStatus` / `validatePriority`, `readPosition` (throws on missing neighbour), `renumberWorkspacePositions`, `computeMidpoint`.
- **Exports:** `createIssue`, `updateIssue`, `deleteIssue`, `getIssue`, `listIssues`, `reorderIssue`, `toIssue`, plus type exports `CreateIssueArgs`, `UpdateIssuePatch`, `ListIssuesOpts`, `ReorderIssueArgs` (11 total exports).
- No `any` anywhere. Every relative import ends in `.js` (NodeNext). All reads/writes parameterised Knex.

### `apps/server/src/routes/issues.ts` (175 LOC)

- `router.use(requireAuth)` — T-17-02-01 / T-17-02-09 mitigation.
- `GET /` — list with optional `?status=` / `?assigneeId=` filters.
- `GET /:id` — 404 when missing.
- `POST /` — 201 on success; 400 when `title` absent, when service throws a validation error (bad status/priority), or on UNIQUE backstop; 500 on unexpected. Pulls `creatorUserId` from `req.auth?.userId`.
- `PATCH /:id` — partial update; same 400/404/500 mapping.
- `DELETE /:id` — hard-delete; 404 when missing.
- `POST /:id/reorder` — body `{ beforeId?, afterId? }`; reads neighbour positions + computes new position + handles collapse. 400 when a neighbour id does not exist (`readPosition` throws with a validation-keyword message).
- Every response returns `satisfies ApiResponse<T>`. Zero direct `db(...)` calls — all DB flows through `issue-store` (CE1 thin-controller rule).

### `apps/server/src/server-core.ts` (+2 lines)

- **Line 56:** `import issueRoutes from './routes/issues.js';` (adjacent to 17-01's `agentRoutes` at 55 — 17-01's line was left untouched).
- **Line 156:** `app.use('/api/issues', issueRoutes);` (adjacent to 17-01's `/api/agents` mount at 155). Mount position puts `/api/issues` under the general `/api/` dynamic rate-limiter in production (server-core line 145).

## Requirements Satisfied

- **ISSUE-01 — create / update / delete / get / list**: all five service functions exported, all five routes mounted behind `requireAuth`. `issue_number` is atomically allocated from `workspaces.issue_counter` inside `db.transaction()` — contract frozen for Phase 17-03 / Phase 18 to reuse.
- **ISSUE-05 — fractional position + renumber sweep**: `reorderIssue` computes `(before + after) / 2`; on collapse (`|a - b| < 1e-6`) runs `renumberWorkspacePositions` inside the same transaction to rewrite every non-null position to `1000, 2000, 3000, …`, then retries the midpoint.

## Verification

- `npm run build -w @aquarium/shared` — exit 0
- `npm run typecheck -w @aquaclawai/aquarium` — exit 0
- All 10 acceptance-criteria grep counts for Task 1 — pass:
  - `^export ` count = 11 (≥ 6 required)
  - `createIssue` = 1, `reorderIssue` = 1
  - `db.transaction` = 6 (createIssue + updateIssue + reorderIssue all covered; internal helper calls from within `reorderIssue` also match)
  - `increment('issue_counter'` = 1
  - `COLLAPSE_EPSILON|1e-6` = 3 (constant + usage + JSDoc)
  - `renumberWorkspacePositions` = 2 (defined + called)
  - `: any[\s;)<,]` = 0
- All 11 acceptance-criteria grep counts for Task 2 — pass:
  - `router.use(requireAuth)` = 1
  - `router.post('/:id/reorder'` = 1, `router.post('/'` = 1, `router.patch('/:id'` = 1, `router.delete('/:id'` = 1
  - `db(` = 0 (thin-controller rule enforced — CE1)
  - `from '../services/issue-store.js'` = 1
  - `isValidationError` = 4 (definition + 3 catch-block uses: POST, PATCH, reorder)
  - `import issueRoutes` = 1, `app.use('/api/issues', issueRoutes)` = 1

## Patterns Established (for 17-03 / 17-04 / Phase 18)

1. **Atomic counter allocation recipe** (re-use in Phase 18 for task_number if that requirement surfaces):
   ```ts
   await db.transaction(async (trx) => {
     await trx('workspaces').where({ id: wsId }).increment('counter_column', 1);
     const { counter_column } = await trx('workspaces').where({ id: wsId }).first('counter_column');
     await trx('target_table').insert({ ..., some_number: Number(counter_column) });
   });
   ```
   Under SQLite, BEGIN IMMEDIATE (triggered by the first write) + `busy_timeout=5000` + WAL (migration 003) serialises concurrent writers.
2. **Fractional ordering with safety net** (re-usable for any drag-and-drop ordering: `tasks.position`, `comments.thread_order`):
   - constants: `RENUMBER_STEP = 1000`, `COLLAPSE_EPSILON = 1e-6`
   - `computeMidpoint(before, after)` handles all four cases (both-null / one-open / both-given)
   - `renumberWorkspacePositions` is the sweep; it only touches non-null-positioned rows so initial `NULL`s stay `NULL`.
3. **Status/priority API-boundary validation + DB backstop**: `validateStatus` / `validatePriority` throw `must be …` errors pre-INSERT; routes map the regex to 400. Migration-006 triggers remain the DB backstop if the API is ever bypassed.
4. **Plan 17-03 extension point**: `updateIssue` is the wrapping target. Plan 17-03 can wrap it with a pre/post hook (or intercept at the route layer) to emit task enqueue/cancel on transitions WITHOUT modifying this function's signature.

## Deviations from Plan

None — plan executed exactly as written. File paths, function signatures, import order, error-mapping regex, mount position, JSDoc block, constants (`RENUMBER_STEP` / `COLLAPSE_EPSILON`), and every acceptance grep all match the plan verbatim. The only micro-judgement was using `import type { Knex } from 'knex'` at the top of the file instead of the inline `import('knex').Knex.Transaction` shown in the plan snippet — identical type result, cleaner top-level import declaration per CLAUDE.md §"Import Order". This is a style-level rewrite, not a behavioural deviation.

## Auth Gates

None encountered — all work was local code + typecheck.

## Known Stubs

None. `position` defaulting to NULL on create is the documented `ISSUE-05` decision (the first drag sets it), not a stub. The plan explicitly defers task-dispatch side-effects + WS broadcasting to plan 17-03, so their absence here is intentional wave scoping, not a TODO.

## Downstream Readiness

- **17-03 task-dispatch**: can wrap this plan's `updateIssue` to fire task enqueue on `status → in_progress` and task cancel on `status → cancelled | blocked`. Terminal-status timestamp bookkeeping (`completed_at` / `cancelled_at`) is already in place — 17-03 only needs to add the side-effect hooks.
- **17-04 comments**: `comments.issue_id` FK will target `issues.id`. `deleteIssue` here already exercises the CASCADE path.
- **Phase 18 agent-task-queue**: same CASCADE story for `tasks.issue_id`. The atomic-counter recipe is documented above for re-use.
- **Phase 23+ kanban UI**: `GET /api/issues` is ordered for kanban hot path; `POST /api/issues/:id/reorder` takes the exact `{ beforeId, afterId }` body shape the UI will send.

## Commits

- `b8af51b` — `feat(17-02): add issue-store service with CRUD + fractional reorder`
- `80e7fc7` — `feat(17-02): add /api/issues router + mount in server-core`

## Self-Check: PASSED

Files verified present:
- `apps/server/src/services/issue-store.ts` — FOUND
- `apps/server/src/routes/issues.ts` — FOUND
- `apps/server/src/server-core.ts` — modified (import at line 56, mount at line 156; 17-01's lines at 55 + 155 unchanged)
- `.planning/phases/17-agent-issue-comment-services/17-02-SUMMARY.md` — this file, FOUND

Commits verified in `git log` on branch `worktree-agent-a85fecb0`:
- `b8af51b` — FOUND
- `80e7fc7` — FOUND

Acceptance-criteria grep counts for both tasks — all pass.
Typecheck + shared build — exit 0.
