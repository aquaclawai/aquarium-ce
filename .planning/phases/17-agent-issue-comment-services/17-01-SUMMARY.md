---
phase: 17-agent-issue-comment-services
plan: 01
subsystem: agents
tags: [rest-api, crud, soft-archive, workspace-scoped, v1.4]
one_liner: "Agent CRUD service + REST router with soft-archive, MCT 1..16 validation at API boundary, and cross-workspace runtime FK guard."
requirements: [AGENT-01, AGENT-02]
dependency_graph:
  requires:
    - "apps/server/src/db/migrations/005_agents.ts (Phase 15 — agents table + triggers)"
    - "apps/server/src/db/adapter.ts (getAdapter / jsonValue / parseJson)"
    - "apps/server/src/middleware/auth.ts (requireAuth)"
    - "packages/shared/src/v14-types.ts (Agent / AgentStatus / AgentVisibility)"
  provides:
    - "apps/server/src/services/agent-store.ts (createAgent, updateAgent, archiveAgent, restoreAgent, getAgent, listAgents, toAgent)"
    - "apps/server/src/routes/agents.ts (default Router with GET / GET:id / POST / PATCH:id / DELETE:id / POST:id/restore)"
    - "app.use('/api/agents', agentRoutes) in server-core.ts (positioned after /api/runtimes mount)"
  affects:
    - "Phase 17-02 issues service will read agent rows via getAgent / listAgents for assignee validation"
    - "Phase 17-04 comments + task-dispatch will use agent-store for author_agent_id FK reads"
    - "Phase 19 daemon claim path will use agent-store for ClaimedTask.agent projection"
tech_stack:
  added: []
  patterns:
    - "structural twin of services/runtime-registry.ts (toX row converter, workspace-scoped queries, adapter-wrapped JSON columns)"
    - "thin-controller route pattern cloned verbatim from routes/runtimes.ts (requireAuth, DEFAULT_WORKSPACE_ID, satisfies ApiResponse<T>)"
    - "validation-error-to-400 regex check on service error messages (must be|references an unknown|UNIQUE constraint failed)"
key_files:
  created:
    - "apps/server/src/services/agent-store.ts"
    - "apps/server/src/routes/agents.ts"
  modified:
    - "apps/server/src/server-core.ts (import + mount — 2 lines added)"
decisions:
  - "API-boundary validation for max_concurrent_tasks precedes DB trigger — validateMct() throws before INSERT/UPDATE reaches SQLite. Trigger trg_agents_mct_check is the backstop."
  - "DELETE /api/agents/:id is soft-archive (archived_at + archived_by) — preserves FKs from issues.assignee_id and tasks.agent_id per PITFALLS §ST4. Restore via POST /:id/restore."
  - "Cross-workspace runtime_id references rejected with 400 via assertRuntimeExists() — previously an unchecked INSERT would succeed (FK is workspace-agnostic at DB level)."
  - "listAgents orders by created_at DESC and excludes archived by default; ?includeArchived=true flips the filter. No pagination yet (Phase 25 UI scope)."
metrics:
  duration: "~2 minutes"
  completed_date: "2026-04-16"
  tasks: 2
  files_created: 2
  files_modified: 1
  commits: 2
---

# Phase 17 Plan 01: Agent Service + REST Routes Summary

## One-Liner

Shipped first-class agent CRUD (AGENT-01) with soft-archive semantics and API-boundary `max_concurrent_tasks` 1..16 enforcement (AGENT-02), delivered as a structural twin of Phase 16's `runtime-registry` / `routes/runtimes` pair so Phase 17-02/03/04 have a dependable callable surface.

## What Shipped

### `apps/server/src/services/agent-store.ts` (211 LOC)

- **`createAgent(args: CreateAgentArgs): Promise<Agent>`** — validates `max_concurrent_tasks` (`Number.isInteger` + 1..16) and `visibility` enum before INSERT; verifies `runtime_id` exists in the same workspace via `assertRuntimeExists` (rejecting cross-workspace references with a 400-mappable message). Applies defaults: `instructions=''`, `customEnv={}`, `customArgs=[]`, `maxConcurrentTasks=6`, `visibility='workspace'`, `status='idle'`. JSON columns serialised with `adapter.jsonValue(...)`.
- **`updateAgent(id, workspaceId, patch): Promise<Agent | null>`** — PATCH semantics: only keys present in `patch` enter the UPDATE. Re-runs MCT / visibility / runtime_id validations when present. Returns `null` when no row matches (route maps to 404).
- **`archiveAgent(id, workspaceId, archivedByUserId): Promise<Agent | null>`** — sets `archived_at = now()`, `archived_by = userId`. Guarded by `whereNull('archived_at')` so double-archive returns `null`.
- **`restoreAgent(id, workspaceId): Promise<Agent | null>`** — clears `archived_at` + `archived_by`. Guarded by `whereNotNull('archived_at')` so restore-on-active returns `null`.
- **`getAgent(id, workspaceId): Promise<Agent | null>`** — single-row read. Returns archived rows too (caller chooses whether to surface them).
- **`listAgents(workspaceId, { includeArchived? }): Promise<Agent[]>`** — workspace-scoped, default excludes archived, ordered by `created_at DESC`.
- **Private helpers:** `toAgent(row)` row→shared-type converter (mirrors `runtime-registry.ts#toRuntime`), `validateMct`, `validateVisibility`, `assertRuntimeExists`.

All reads/writes are parameterised Knex; no `db.raw` with user input. No `any` type anywhere. Every local import ends `.js` (NodeNext).

### `apps/server/src/routes/agents.ts` (146 LOC)

- `router.use(requireAuth)` gates every route (T-17-01-01, T-17-01-06 mitigations).
- `GET /` — lists non-archived agents; `?includeArchived=true` returns all.
- `GET /:id` — 404 when missing.
- `POST /` — validates `name` is non-empty string at the router boundary; delegates everything else to `createAgent`. Pulls `ownerUserId` from `req.auth.userId`. Validation errors (MCT out-of-range / unknown runtime / visibility enum / UNIQUE name) map to 400 via regex; everything else is 500.
- `PATCH /:id` — partial update; same validation→400 mapping.
- `DELETE /:id` — archive via `archiveAgent`, passing `req.auth.userId` as `archived_by`. 404 if missing or already archived.
- `POST /:id/restore` — 404 if missing or not archived.

Every success + error path returns an `ApiResponse<T>` via `satisfies` (17 occurrences). Zero direct `db(...)` calls — all DB work flows through `agent-store`.

### `apps/server/src/server-core.ts` (+2 lines)

- Import `agentRoutes from './routes/agents.js'` added adjacent to `runtimeRoutes`.
- `app.use('/api/agents', agentRoutes)` mounted immediately after `app.use('/api/runtimes', runtimeRoutes)` so the general `/api/` rate-limiter on line 144 covers it in production.

## Requirements Satisfied

- **AGENT-01 — create / update / archive / restore / list**: all six service functions exported, all six routes mounted behind `requireAuth`. Soft-archive preserves `issues.assignee_id` + `tasks.agent_id` FKs.
- **AGENT-02 — max_concurrent_tasks 1..16 at API boundary**: `validateMct()` fires on create AND update before INSERT/UPDATE reaches SQLite. The migration-005 trigger (`trg_agents_mct_check`) remains as backstop.

## Verification

- `npm run build -w @aquarium/shared` — exit 0
- `npm run typecheck -w @aquaclawai/aquarium` — exit 0
- All 12 acceptance-criteria `grep` counts for Task 1 — pass
- All 12 acceptance-criteria `grep` counts for Task 2 — pass
- `grep -c "db(" apps/server/src/routes/agents.ts` → 0 (no direct DB calls in router — CE1 thin-controller rule enforced)

## Patterns Established (for 17-02 / 17-03 / 17-04)

1. **Service-layer `toX` row converter**: `toAgent(row)` joins the snake_case DB row to the camelCase shared type, parses JSON columns via `adapter.parseJson`, and provides `null` fallbacks for nullable columns. Phase 17-02 (`issue-store.ts`) and 17-04 (`comment-store.ts`) should clone this shape.
2. **Workspace-scoped reads/writes**: `workspaceId` is a required argument on every exported function; the route supplies `DEFAULT_WORKSPACE_ID = 'AQ'`. EE will swap to `req.auth.workspaceId` in Phase 25+; service is EE-ready today.
3. **Validation-error → 400 mapping**: Router catch block uses `/must be|references an unknown|UNIQUE constraint failed/` regex. New services throwing their own validation messages should contribute keywords that match this regex (or the router regex should be extended alongside).
4. **Soft-archive with guarded UPDATE**: `archiveAgent` uses `.whereNull('archived_at')` and `restoreAgent` uses `.whereNotNull('archived_at')` so idempotency is a no-op (returns `null` → 404), not a silent write.

## Deviations from Plan

None — plan executed exactly as written. Interfaces, import order, error-mapping regex, and mount position all match the plan's `<action>` block verbatim.

## Auth Gates

None encountered — all work was local code + typecheck.

## Known Stubs

None. `customEnv` / `customArgs` defaults are intentional (plan §behavior), not UI stubs. Agent list pagination is deferred to Phase 25 per `<objective>` ("Do NOT implement pagination … in this plan").

## Downstream Readiness

- **17-02 issues service**: can call `getAgent(assigneeId, workspaceId)` to validate `issues.assignee_id` on create/update. Returns `null` for missing or out-of-workspace refs — just like `runtime-registry`.
- **17-03 task-dispatch**: `listAgents(workspaceId)` returns only non-archived rows, so the dispatcher won't accidentally hand work to an archived agent.
- **17-04 comments/task-messages**: `getAgent(authorAgentId)` is the FK validator for `comments.author_agent_id`.
- **Phase 19 daemon claim**: The `ClaimedTask.agent` projection in `v14-types.ts` is a subset of `Agent` (id, name, instructions, customEnv, customArgs) — `toAgent(row)` already populates all five.

## Commits

- `86f077a` — `feat(17-01): add agent-store service with CRUD + archive/restore`
- `bc2e4f0` — `feat(17-01): add /api/agents router + mount in server-core`

## Self-Check: PASSED

Files verified present:
- `apps/server/src/services/agent-store.ts` — FOUND
- `apps/server/src/routes/agents.ts` — FOUND
- `apps/server/src/server-core.ts` — modified (import + mount lines 55 + 154 confirmed)

Commits verified in git log:
- `86f077a` — FOUND
- `bc2e4f0` — FOUND

Acceptance-criteria grep counts for both tasks — all pass.
Typecheck + shared build — exit 0.
