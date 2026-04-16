---
phase: 15-schema-shared-types
plan: 05
subsystem: database

tags: [knex, sqlite, migration, schema, task-queue, task-messages, partial-unique-index, triggers, cascade, coalescing]

requires:
  - phase: 15-01
    provides: "migration-helpers (addUuidPrimary, addUuidColumn, addJsonColumn) + workspaces 'AQ' seed"
  - phase: 15-02
    provides: "runtimes table (target for agent_task_queue.runtime_id CASCADE FK)"
  - phase: 15-03
    provides: "agents table (target for agent_task_queue.agent_id CASCADE FK)"
  - phase: 15-04
    provides: "issues + comments tables (targets for agent_task_queue.issue_id CASCADE and trigger_comment_id SET NULL)"

provides:
  - "agent_task_queue table: 6-state machine (queued/dispatched/running/completed/failed/cancelled) with INSERT+UPDATE triggers"
  - "idx_one_pending_task_per_issue_agent partial unique index — SQLite schema-level coalescing for Phase 18 BEGIN IMMEDIATE claim"
  - "task_messages table: 5-type taxonomy (text/thinking/tool_use/tool_result/error) with UNIQUE(task_id, seq) for replay-on-reconnect"
  - "Three claim-path indexes on agent_task_queue: idx_atq_claim (runtime_id, status, priority, created_at), idx_atq_issue_status, idx_atq_agent_status"
  - "Postgres branch with native CHECK + partial unique index for EE parity"

affects:
  - 18-task-queue (BEGIN IMMEDIATE claim path depends on partial unique index as ultimate correctness guarantee)
  - 19-daemon-rest (task_messages is the streaming sink for daemon-reported agent events)
  - 24-web-kanban (task_messages replay-on-reconnect uses (task_id, seq) for strict-order WS resume)

tech-stack:
  added: []
  patterns:
    - "Partial unique index as schema-level coalescing (WHERE status IN (...) — SQLite 3.8+ and Postgres both support)"
    - "Raw-SQL partial index emission because Knex .unique() does not emit WHERE clauses"
    - "FK CASCADE mix: parent rows (workspace/issue/agent/runtime) CASCADE; sibling audit refs (trigger_comment_id) SET NULL"
    - "Task-messages UNIQUE(task_id, seq) as the reconnection contract"

key-files:
  created:
    - apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts
  modified: []

key-decisions:
  - "runtime_id ON DELETE CASCADE (not SET NULL): ROADMAP owned-pitfall ST4 explicitly prescribes CASCADE for the runtime -> task relationship. PITFALLS.md prose suggested SET NULL in passing, but ROADMAP is authoritative on owned pitfalls. Rationale: a task without a live runtime has nowhere to dispatch; reaping it on runtime delete matches the lifecycle invariant Phase 18's claim transaction relies on. The PITFALLS prose applies to the runtime-agent relationship (agents outlive runtimes for audit), not to runtime-task (tasks die with their runtime)."
  - "Partial unique index emitted via knex.raw(), not knex schema builder: Knex's .unique() accepts an indexName option but does not emit a WHERE clause. The partial index IS the schema-level coalescing guarantee — it must have WHERE status IN ('queued','dispatched'). Raw SQL is the only way. Runs at migration time, outside any application transaction. Pattern matches 001_initial_schema.ts line 357-359 (idx_one_active_op on extension_operations)."
  - "Triggers on both INSERT and UPDATE OF status for 6-state enforcement: SQLite's BEFORE UPDATE OF <col> only fires when <col> appears in the SET clause, which is efficient for UPDATE_OF but means a bare UPDATE trigger would fire on every row mutation. Two triggers per table (atq_status_check, atq_status_check_upd) catches both paths with minimum overhead and zero gap. Rollback drops them by exact name in down()."
  - "session_id and work_dir present in the schema but unread by v1.4: Phase 21's daemon writes them when resuming a Claude/Codex session. Phase 22 (v1.5) is where resume-on-reconnect lands (Resolved Decision #9). Including them now avoids a migration in v1.5 for columns that are trivial to add but expensive to backfill. Defaults to NULL."
  - "FK trigger_comment_id ON DELETE SET NULL: a task can outlive the comment that spawned it. Preserving the task with trigger_comment_id=NULL keeps the audit trail intact — you still know the task ran, just not which comment caused it. Matches the existing SET NULL pattern on comments.parent_id for thread preservation (plan 15-04)."
  - "task_messages UNIQUE constraint is the reconnection protocol: Phase 24's WS replay logic does `SELECT * FROM task_messages WHERE task_id=? AND seq>? ORDER BY seq`. Rejecting duplicate (task_id, seq) at INSERT time means the daemon can retry without risking duplicate events in the replay stream. Application enforces monotonic allocation; schema enforces no-dup."

patterns-established:
  - "Partial unique index for state-scoped coalescing (reusable wherever only 'active' rows need uniqueness — e.g., one-at-a-time workflows, drafts, reservations)"
  - "Trigger-pair (INSERT + UPDATE_OF) for SQLite enum enforcement (already established by 004-006; this plan keeps the cadence)"
  - "Atomic claim-table pattern: hot-path index (runtime_id, status, priority, created_at) on the column set the claim SELECT filters/orders by"

requirements-completed: [SCH-05, SCH-06]

duration: ~12min
completed: 2026-04-16
---

# Phase 15-05: Agent Task Queue + Task Messages Summary

**Two tables that are the schema backbone of Phase 18's task dispatch: a 6-state task queue with a partial unique index that rejects a second pending task for the same (issue, agent) at the SQLite layer, and a task_messages log with UNIQUE(task_id, seq) for WS replay-on-reconnect.**

## Performance

- **Duration:** ~12 min (single migration, two tables, partial unique index, 4 triggers)
- **Completed:** 2026-04-16
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `agent_task_queue` table with 19 columns covering identity, workspace scoping, FK graph (issue/agent/runtime/comment/workspace), 6-state machine, priority, session continuity (session_id/work_dir for Phase 21), audit timestamps (dispatched/started/completed/cancelled/created/updated), and application metadata
- Created `task_messages` table with 10 columns supporting the 5-type streaming taxonomy (text/thinking/tool_use/tool_result/error), optional tool name, nullable content/input/output for type-specific shapes, and monotonic seq numbering
- Installed the partial unique index `idx_one_pending_task_per_issue_agent ON agent_task_queue (issue_id, agent_id) WHERE status IN ('queued','dispatched')` via raw SQL — the schema-level coalescing guarantee that Phase 18's BEGIN IMMEDIATE claim transaction relies on as the ultimate-correctness fallback
- Installed 4 SQLite triggers giving DB-level enum enforcement on both INSERT and UPDATE paths:
  - `trg_atq_status_check[_upd]` — 6-state status enum on `agent_task_queue`
  - `trg_task_messages_type_check[_upd]` — 5-state type enum on `task_messages`
- Installed 3 hot-path indexes on `agent_task_queue`:
  - `idx_atq_claim (runtime_id, status, priority, created_at)` — Phase 18 claim SELECT
  - `idx_atq_issue_status (issue_id, status)` — reaper + per-issue list
  - `idx_atq_agent_status (agent_id, status)` — per-agent concurrency count
- Installed UNIQUE + supporting index on `task_messages`:
  - `uq_task_messages_task_seq (task_id, seq)` — reconnection/replay unique
  - `idx_task_messages_task_created (task_id, created_at)` — timeline scans
- Postgres-native CHECK + partial unique index branch retained for EE parity
- Migration reversible: `down()` drops all 4 triggers, the partial unique index, then both tables. Full migrate -> rollback -> migrate round-trip verified: 8 migration-007 artifacts -> 0 -> 8.

## Task Commits

1. **Task 1: Create migration 007 — agent_task_queue + task_messages with partial unique index** — `f452390` (feat)

## Files Created/Modified

- `apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts` — new migration creating `agent_task_queue` (19 cols, 3 indexes + 1 partial unique index, 5 FKs) and `task_messages` (10 cols, 1 unique + 1 plain index, 1 FK), plus 4 enum triggers on SQLite and a Postgres-native CHECK branch for EE parity.

## Decisions Made

- **`runtime_id` ON DELETE CASCADE per ROADMAP ST4 (authoritative over PITFALLS prose)**: the ROADMAP explicitly owns the runtime -> task cascade decision as a Phase 15 owned-pitfall. Tasks have no meaning without a live runtime to dispatch to; reaping them matches the lifecycle invariant that Phase 18's claim transaction assumes. The PITFALLS.md §ST4 prose discussing SET NULL applies to the runtime -> agent edge (agents outlive runtimes for audit), not to runtime -> task.
- **Partial unique index via `knex.raw`**: Knex's `.unique()` builder supports an indexName option but does not emit a WHERE clause. The entire point of the index is the WHERE clause (`status IN ('queued','dispatched')`) — without it every task row would be unique-indexed forever and the same (issue,agent) pair could never run twice. Raw SQL is the only path. Pattern matches `idx_one_active_op` from the pre-existing `extension_operations` table (migration 001).
- **Triggers on both INSERT and UPDATE OF <col>, not a single UPDATE trigger**: SQLite `BEFORE UPDATE OF <col>` fires only when `<col>` appears in the SET clause. This is the desired efficiency tradeoff — mutations that don't touch status don't pay the trigger cost, while status mutations cannot bypass enforcement. Two triggers per table (status + status_upd) is the pattern established by 004/005/006.
- **`session_id` and `work_dir` nullable, written in Phase 21, read in v1.5**: per research Resolved Decision #9, session resume is a v1.5 feature. The columns exist now because adding them later would require a migration on existing data. Phase 21's daemon writes them opportunistically; nothing in v1.4 reads them back.
- **`trigger_comment_id` ON DELETE SET NULL**: preserves task audit trail if the spawning comment is later deleted. The task still records that it ran; it just loses the pointer to the originating conversation event. Matches `comments.parent_id` SET NULL for intra-thread preservation (plan 15-04).

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria satisfied on first migration run. No auto-fixes, no architectural decisions, no auth gates.

## Verification Evidence

### Migration run (fresh DB, migrations 001-007)

```
Batch 1 run: 7 migrations
001_initial_schema.ts
002_seed_wizard_configs.ts
003_boot_pragmas_and_workspace.ts
004_runtimes.ts
005_agents.ts
006_issues_and_comments.ts
007_agent_task_queue_and_messages.ts
```

### Tables present

```
agent_task_queue
task_messages
```

### Partial unique index SQL (from `sqlite_master`)

```sql
CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent
        ON agent_task_queue (issue_id, agent_id)
        WHERE status IN ('queued','dispatched')
```

### task_messages unique index

```sql
CREATE UNIQUE INDEX `uq_task_messages_task_seq` on `task_messages` (`task_id`, `seq`)
```

### FK graph verified via `PRAGMA foreign_key_list`

**agent_task_queue:**
| seq | to table | from col | to col | on_update | on_delete |
|-----|----------|----------|--------|-----------|-----------|
| 0 | comments | trigger_comment_id | id | NO ACTION | **SET NULL** |
| 1 | runtimes | runtime_id | id | NO ACTION | **CASCADE** (ROADMAP ST4) |
| 2 | agents | agent_id | id | NO ACTION | **CASCADE** |
| 3 | issues | issue_id | id | NO ACTION | **CASCADE** |
| 4 | workspaces | workspace_id | id | NO ACTION | **CASCADE** |

**task_messages:**
| seq | to table | from col | to col | on_update | on_delete |
|-----|----------|----------|--------|-----------|-----------|
| 0 | agent_task_queue | task_id | id | NO ACTION | **CASCADE** |

### Triggers present (all 4 for plan 15-05)

```
trg_atq_status_check
trg_atq_status_check_upd
trg_task_messages_type_check
trg_task_messages_type_check_upd
```

### Partial unique index — coalescing proof

The same (issue_id=i1, agent_id=a1) pair:

```
-- First queued task -> accepted
INSERT INTO agent_task_queue (id='t1', issue_id='i1', agent_id='a1', status='queued', ...);
OK

-- Second queued task for same pair -> REJECTED
INSERT INTO agent_task_queue (id='t2', issue_id='i1', agent_id='a1', status='queued', ...);
Error: stepping, UNIQUE constraint failed: agent_task_queue.issue_id, agent_task_queue.agent_id (19)

-- Transition t1 to 'dispatched' (still a pending state) — duplicate still blocked
UPDATE agent_task_queue SET status='dispatched' WHERE id='t1';  -- OK
INSERT INTO agent_task_queue (id='t2b', issue_id='i1', agent_id='a1', status='queued', ...);
Error: stepping, UNIQUE constraint failed: agent_task_queue.issue_id, agent_task_queue.agent_id (19)

-- Complete t1 — lock released, new pending task accepted
UPDATE agent_task_queue SET status='completed' WHERE id='t1';  -- OK
INSERT INTO agent_task_queue (id='t3', issue_id='i1', agent_id='a1', status='queued', ...);
OK
```

### Enum trigger rejection (status + type)

```
INSERT INTO agent_task_queue (..., status='bogus');
Error: stepping, agent_task_queue.status must be queued, dispatched, running, completed, failed, or cancelled (19)

UPDATE agent_task_queue SET status='bogus' WHERE id='t3';
Error: stepping, agent_task_queue.status must be queued, dispatched, running, completed, failed, or cancelled (19)

INSERT INTO task_messages (..., type='bogus');
Error: stepping, task_messages.type must be text, thinking, tool_use, tool_result, or error (19)

UPDATE task_messages SET type='bogus' WHERE id='m1';
Error: stepping, task_messages.type must be text, thinking, tool_use, tool_result, or error (19)
```

### task_messages (task_id, seq) UNIQUE proof

```
INSERT INTO task_messages (id='m1', task_id='t3', seq=5, type='text', ...);  -- OK
INSERT INTO task_messages (id='m2', task_id='t3', seq=5, type='text', ...);
Error: stepping, UNIQUE constraint failed: task_messages.task_id, task_messages.seq (19)
```

### FK cascade semantics (with `PRAGMA foreign_keys=ON`, as applied by SqliteAdapter.applyBootPragmas at boot)

```
-- trigger_comment_id SET NULL
DELETE FROM comments WHERE id='c1';  -- OK
SELECT id, trigger_comment_id FROM agent_task_queue WHERE id='t1';
t1|<NULL>     -- task survives, pointer nulled

-- runtime_id CASCADE -> task CASCADE -> message CASCADE
INSERT INTO agent_task_queue (id='tX', ..., runtime_id='r2');      -- OK
INSERT INTO task_messages (id='mX', task_id='tX', seq=1, ...);     -- OK
-- Before: 1 task, 1 message
DELETE FROM runtimes WHERE id='r2';                                -- OK
-- After: 0 tasks, 0 messages   ✓ CASCADE chain propagated
```

### Rollback round-trip

```
-- Forward: 8 migration-007 artifacts present (table×2, partial index×1, unique index×1, triggers×4)
-- Rollback: knex migrate.rollback executed
-- After rollback: 0 artifacts in sqlite_master
-- Re-forward: 8 artifacts restored
```

### Build + typecheck

- `npm run build -w @aquarium/shared` -> exit 0
- `npm run typecheck -w @aquaclawai/aquarium` -> exit 0

## Reminder for Phase 18 (Task Queue Service)

**This plan provides the schema substrate only.** Phase 18 owns the atomic claim transaction:

1. `BEGIN IMMEDIATE` — acquires the SQLite write lock so concurrent claim attempts serialize
2. `SELECT id FROM agent_task_queue WHERE runtime_id=? AND status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1` — uses `idx_atq_claim`
3. Verify per-agent concurrency: `SELECT COUNT(*) FROM agent_task_queue WHERE agent_id=? AND status IN ('dispatched','running')` < `agents.max_concurrent_tasks`
4. `UPDATE agent_task_queue SET status='dispatched', dispatched_at=? WHERE id=? AND status='queued'` — returns 1 if claimed, 0 if lost the race
5. `COMMIT` / `ROLLBACK`

The partial unique index is the **fallback guarantee** if split-brain or bugged code paths bypass the BEGIN IMMEDIATE transaction — the DB itself will reject a duplicate pending row. Don't remove that belt from the suspenders.

Phase 24 (WS replay) uses `SELECT * FROM task_messages WHERE task_id=? AND seq>? ORDER BY seq` against the `uq_task_messages_task_seq` index for strict-order replay-on-reconnect.

## Next Phase Readiness

- **15-06 (remaining phase 15 tables — observability, audit, etc.)** can FK onto `agent_task_queue.id` for task-scoped audit records.
- **17 (issues/comments service)** has all FKs it will need when creating a task: the `trigger_comment_id` column accepts comment IDs and SET-NULLs cleanly on deletion.
- **18 (task-queue service)** has every piece of schema it needs: partial unique index for coalescing, claim-hot-path index, per-agent concurrency index, 6-state machine enforced by trigger. BEGIN IMMEDIATE is the only application-side primitive left.
- **19 (daemon REST)** can POST task_messages freely; UNIQUE(task_id, seq) rejects daemon retries that accidentally reuse a seq.
- **24 (web kanban / task streaming)** can build replay-on-reconnect against (task_id, seq) without additional schema work.

## Self-Check

- File `apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts`: FOUND
- Commit `f452390`: FOUND (git log contains it)
- All 2 tables + 4 triggers + 1 partial unique index + 1 task-seq unique present in sqlite_master after fresh migration run
- Partial index sql contains `WHERE status IN` — confirmed via `SELECT sql FROM sqlite_master`
- FK graph matches plan spec on all 6 FKs (5 on agent_task_queue, 1 on task_messages)
- 6 positive tests + 6 negative tests + cascade tests + rollback round-trip all pass
- Build + typecheck green
- No stray files committed (only the migration TS file)

## Self-Check: PASSED

---
*Phase: 15-schema-shared-types*
*Completed: 2026-04-16*
