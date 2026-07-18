---
phase: 15-schema-shared-types
plan: 03
subsystem: database

tags: [knex, sqlite, migration, schema, agents, triggers, soft-delete, set-null]

requires:
  - phase: 15-01
    provides: "Knex bootstrap + migration-helpers (addUuidPrimary, addUuidColumn, addJsonColumn) + workspaces table + CE 'AQ' seed"
  - phase: 15-02
    provides: "runtimes table (target for agents.runtime_id FK with SET NULL)"

provides:
  - "agents table (17 columns) as first-class entity referenced by issues, tasks, and comments"
  - "SQLite trigger-enforced CHECKs for max_concurrent_tasks (1..16), visibility enum, status enum"
  - "ON DELETE SET NULL on agents.runtime_id (ST4 pitfall prevention — agents outlive runtimes)"
  - "ON DELETE CASCADE on agents.workspace_id"
  - "Soft-delete via archived_at + archived_by columns"
  - "UNIQUE(workspace_id, name) + idx_agents_workspace_status + idx_agents_runtime"

affects:
  - 15-04-issues-comments (FKs issues.assignee_id -> agents.id, comments.author_id when agent-authored)
  - 15-05-tasks (FKs agent_task_queue.agent_id -> agents.id)
  - 16-runtime-bridge
  - 17-agents (CRUD service layer)
  - 18-task-queue (reads max_concurrent_tasks at claim time)

tech-stack:
  added: []
  patterns:
    - "SQLite trigger-enforced range CHECK (BETWEEN 1 AND 16) via dual BEFORE INSERT / BEFORE UPDATE OF triggers"
    - "Dialect-branched migrations preserving Postgres native CHECK constraints (EE parity)"
    - "SET NULL FK semantics for audit-grade rows that outlive their parent (runtime churn)"

key-files:
  created:
    - apps/server/src/db/migrations/005_agents.ts
  modified: []

key-decisions:
  - "runtime_id FK uses ON DELETE SET NULL (not CASCADE): agents are audit data; deleting/archiving a runtime must not destroy the agent's history. Tasks simply can't dispatch until a new runtime is set. Matches PITFALLS §ST4 prevention text verbatim."
  - "custom_env stored as JSON plain text (via addJsonColumn): encryption at rest deferred to v1.5 per research Resolved Decision #18; Phase 17/19 will handle API-boundary redaction. Schema is a plain text JSON column and intentionally avoids assuming encryption."
  - "custom_args stored as JSON plain text for the same portability reason — CE SQLite lacks a native JSON type distinct from text, and structured array storage would prevent JSON.parse round-tripping in the shared adapter."
  - "Triggers over inline CHECK (same reasoning as plan 15-02): ALTER TABLE ADD CONSTRAINT CHECK is unsupported on SQLite, Knex's table-level CHECK chain is not portable, and the existing ALTER-level helper is a no-op on SQLite. Triggers give SCH-03 its required schema-level guarantee."
  - "Six triggers, not three: each CHECK needs BEFORE INSERT and BEFORE UPDATE OF <col> so constraint enforcement is symmetric on both code paths."
  - "No archived_at CHECK constraint on archived_by: the pair can each be NULL (not archived) or both non-NULL (archived) — application layer owns this simple consistency rule because it requires cross-column logic that does not gain materially from a schema-level trigger."

patterns-established:
  - "Range CHECK trigger: WHEN NEW.<col> < min OR NEW.<col> > max BEGIN SELECT RAISE(ABORT, '...') END — duplicates the enum-trigger pattern from 15-02 for numeric invariants."
  - "Archival column pair: archived_at (timestamp) + archived_by (UUID FK SET NULL) — reusable for future soft-deletable entities in the v1.4 schema."

requirements-completed: [SCH-03]

duration: ~2min
completed: 2026-04-16
---

# Phase 15-03: Agents Table Summary

**First-class agents table with trigger-enforced max_concurrent_tasks 1..16, visibility + status enums, archival columns, and SET NULL FK to runtimes so agents outlive the runtime churn that powers them.**

## Performance

- **Duration:** ~2 min
- **Completed:** 2026-04-16
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `agents` table with 17 columns covering identity, configuration, concurrency, visibility, status, ownership, archival, and timestamps
- Installed six SQLite triggers (3 checks × INSERT + UPDATE_OF) giving schema-level invariants on CE
- Verified FK graph: `workspace_id` CASCADE, `runtime_id` SET NULL, `owner_user_id` SET NULL, `archived_by` SET NULL
- `UNIQUE(workspace_id, name)` via `uq_agents_ws_name` prevents ambiguous workspace-scoped lookups
- Two secondary indexes: `idx_agents_workspace_status` (list-view hot path) and `idx_agents_runtime` (runtime fan-out lookup)
- Postgres-native CHECK constraint branch retained for EE parity
- Migration is idempotent via `dropTableIfExists` and trigger `DROP TRIGGER IF EXISTS` in `down()`

## Task Commits

1. **Task 1: Create migration 005 — agents table with CHECK + archival + FK semantics** — `e4a1a1e` (feat)

**Plan metadata:** (next commit, this SUMMARY)

## Files Created/Modified

- `apps/server/src/db/migrations/005_agents.ts` — Migration creating `agents` with 17 columns, 6 CHECK-equivalent triggers (`trg_agents_mct_check` + `_upd`, `trg_agents_visibility_check` + `_upd`, `trg_agents_status_check` + `_upd`), dialect-branched CHECK logic for Postgres, 3 indexes plus auto-index for PK, and a clean `down()` that drops triggers and the table.

## Decisions Made

- **SET NULL over CASCADE for runtime_id (critical):** The plan's §"Critical Design Notes" #1 calls this out explicitly. Agents are audit data; a runtime disappearing (daemon offline, instance archived) must not delete the agent row. Phase 17/18 will surface "unassigned" agents in the UI and block task dispatch until a new runtime is attached. ROADMAP owned-pitfall ST4 prescribes CASCADE for *runtime → TASK*, but ST4's prevention text explicitly calls for SET NULL on `agents.runtime_id` — those two paths disagree intentionally.
- **Plain-text JSON for custom_env + custom_args:** v1.5 will add at-rest encryption; v1.4 schema must not lock in an encryption format. The cross-dialect `addJsonColumn` returns `text` on SQLite and `jsonb` on Postgres, giving the right storage shape on each dialect without encoding assumptions. The API boundary (Phase 17/19) will redact secrets before logs/responses, which is where the threat-model disposition lives.
- **Six triggers for three checks:** SQLite fires `BEFORE UPDATE OF <col>` triggers only when the named column is in the SET clause, so omitting the UPDATE variant would let a rogue `UPDATE agents SET status='running' WHERE ...` bypass the enum check. Every plan 15-02 enum check used the same pair; plan 15-03 follows the pattern.
- **Default `max_concurrent_tasks=6`:** Per SCH-03 requirement. The range 1..16 is the invariant; 6 is a sensible production default that satisfies AGENT-02 without encouraging the boundary.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes, no architectural decisions, no auth gates. Verification and acceptance criteria passed on the first migration run.

## Issues Encountered

- **None.** The 15-02 plan had established the trigger pattern so precisely that 15-03 was a direct structural clone with different column names.

## Verification Evidence

### Schema (after migrations 001-005 on fresh DB)

- `agents` table: present
- Columns (17): `id, workspace_id, runtime_id, name, avatar_url, description, instructions, custom_env, custom_args, max_concurrent_tasks, visibility, status, owner_user_id, archived_at, archived_by, created_at, updated_at`
- Defaults: `instructions=''`, `custom_env='{}'`, `custom_args='[]'`, `max_concurrent_tasks=6`, `visibility='workspace'`, `status='idle'`
- Triggers (6): `trg_agents_mct_check`, `trg_agents_mct_check_upd`, `trg_agents_visibility_check`, `trg_agents_visibility_check_upd`, `trg_agents_status_check`, `trg_agents_status_check_upd`
- Indexes: `uq_agents_ws_name` (UNIQUE), `idx_agents_workspace_status`, `idx_agents_runtime`, plus SQLite auto-index on the PK

### `PRAGMA foreign_key_list(agents)` output

```
0|0|users|archived_by|id|NO ACTION|SET NULL|NONE
1|0|users|owner_user_id|id|NO ACTION|SET NULL|NONE
2|0|runtimes|runtime_id|id|NO ACTION|SET NULL|NONE
3|0|workspaces|workspace_id|id|NO ACTION|CASCADE|NONE
```

Exactly the CASCADE / SET NULL mix the plan requires:
- `workspace_id → workspaces.id` **CASCADE** (tenant cleanup)
- `runtime_id → runtimes.id` **SET NULL** (ST4 prevention — the critical one)
- `owner_user_id → users.id` **SET NULL** (ownership is advisory)
- `archived_by → users.id` **SET NULL** (preserve archival audit when user vanishes)

### Negative tests (trigger-based CHECK enforcement, all rejected with SQLite error 19)

- `INSERT ... max_concurrent_tasks=17` → rejected: "agents.max_concurrent_tasks must be between 1 and 16"
- `INSERT ... max_concurrent_tasks=0` → rejected: same message (range trigger catches both ends)
- `INSERT ... visibility='bogus'` → rejected: "agents.visibility must be private, workspace, or public"
- `INSERT ... status='queued'` → rejected: "agents.status must be idle, working, blocked, error, or offline" (queued is a task status, not an agent status)
- `INSERT ... status='running'` → rejected: same message (running is also task terminology)
- `UPDATE agents SET max_concurrent_tasks=17` → rejected by `trg_agents_mct_check_upd`
- `UPDATE agents SET status='queued'` → rejected by `trg_agents_status_check_upd`
- `UPDATE agents SET visibility='bogus'` → rejected by `trg_agents_visibility_check_upd`
- `INSERT (workspace_id='AQ', name='good-agent')` twice → second rejected by `uq_agents_ws_name`

### Positive tests (boundary values accepted)

- `INSERT ... max_concurrent_tasks=1` → accepted (lower bound)
- `INSERT ... max_concurrent_tasks=16` → accepted (upper bound)
- `INSERT` with no explicit values → accepted with all defaults applied (mct=6, visibility='workspace', status='idle')

### SET NULL semantics test (ST4 prevention verified)

1. Seeded `users(u1)`, `instances(i1)`, `runtimes(rt1, kind=hosted_instance, instance_id=i1)`
2. `INSERT INTO agents (id='ag-rt', workspace_id='AQ', runtime_id='rt1', ...)`
3. `SELECT runtime_id FROM agents WHERE id='ag-rt'` → `rt1` (before)
4. `DELETE FROM runtimes WHERE id='rt1'`
5. `SELECT runtime_id FROM agents WHERE id='ag-rt'` → `NULL` (after)
6. `SELECT count(*) FROM agents WHERE id='ag-rt'` → `1` — **agent row survived**

Runtime churn does not destroy agent audit rows, exactly as PITFALLS §ST4 requires.

### CASCADE semantics test (workspace delete removes agents)

1. Seeded `workspaces(WS2)`
2. `INSERT INTO agents (id='ag-ws', workspace_id='WS2', ...)`
3. `SELECT count(*) FROM agents WHERE workspace_id='WS2'` → `1` (before)
4. `DELETE FROM workspaces WHERE id='WS2'`
5. `SELECT count(*) FROM agents WHERE workspace_id='WS2'` → `0` (after) — **CASCADE intact**

### Build + typecheck

- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0 (strict, `tsc --noEmit`)

## Column-type rationale (per plan `<output>` directive)

### `custom_env` and `custom_args` — both plain-text JSON

Both use `addJsonColumn`, which returns `text` on SQLite and `jsonb` on Postgres. For CE SQLite this means a single `text` column storing JSON.

Chosen over structured types because:

1. **Cross-dialect portability.** The shared adapter serializes via `JSON.stringify` / `JSON.parse` at the read/write boundary regardless of dialect. A structured column type on one dialect would force branching in the service layer.
2. **Round-trip determinism.** `text` stores exactly what `JSON.stringify` produced, preserving key order and whitespace. `jsonb` on Postgres re-normalizes; the shared layer copes because reads go through a normalization function anyway.
3. **No encryption lock-in.** Research Resolved Decision #18 defers at-rest encryption to v1.5. A plaintext `text` column lets v1.5 migrate to an encrypted blob (or to a separate `credentials` table) without touching schema validators or JSON parsing logic.
4. **Defaults usable as-is.** SQLite stores the default `'{}'` / `'[]'` as a literal string that is also valid JSON — no string-to-JSON coercion required at read time.

Plan 17 (agents service) will redact key-value entries in API responses and logs before `custom_env` crosses a trust boundary; the schema remains intentionally permissive.

## Next Phase Readiness

- 15-04-issues-comments can now FK `issues.assignee_id → agents.id` and conditionally `comments.author_id → agents.id` when the comment is agent-authored.
- 15-05-tasks can FK `agent_task_queue.agent_id → agents.id` with confidence the row is enum-valid.
- Phase 17 (agents service) can read `max_concurrent_tasks` at claim time, count in-flight tasks via `agent_task_queue`, and dispatch or defer. The 1..16 invariant is already enforced at the DB boundary, so service-layer validation is a UX concern rather than a correctness one.

## Self-Check

- File `apps/server/src/db/migrations/005_agents.ts`: FOUND
- Commit `e4a1a1e`: FOUND (git log --all contains it)
- All six triggers present in `sqlite_master` after fresh migration run
- `PRAGMA foreign_key_list(agents)` returns the expected 4 FKs with correct on_delete values
- All negative test inserts return SQLite error 19 with the expected messages
- Build + typecheck green

## Self-Check: PASSED

---
*Phase: 15-schema-shared-types*
*Completed: 2026-04-16*
