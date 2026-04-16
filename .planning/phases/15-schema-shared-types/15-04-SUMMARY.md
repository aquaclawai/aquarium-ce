---
phase: 15-schema-shared-types
plan: 04
subsystem: database

tags: [knex, sqlite, migration, schema, issues, comments, triggers, check, xor, kanban, threaded]

requires:
  - phase: 15-01
    provides: "migration-helpers (addUuidPrimary, addUuidColumn, addJsonColumn) + workspaces table (issue_counter) + CE 'AQ' seed"
  - phase: 15-03
    provides: "agents table (target for issues.assignee_id and comments.author_agent_id FKs, both SET NULL)"

provides:
  - "issues table: 6-status kanban (backlog/todo/in_progress/done/blocked/cancelled — no in_review), 5-priority enum (urgent/high/medium/low/none), REAL fractional position, per-workspace monotonic issue_number"
  - "comments table: 4-type timeline (comment/status_change/progress_update/system), self-FK parent_id with SET NULL (orphan preservation), XOR author via twin nullable FKs + trigger"
  - "UNIQUE(workspace_id, issue_number) via uq_issues_ws_number"
  - "idx_issues_kanban (workspace_id, status, position) for kanban ordering"
  - "8 SQLite triggers enforcing all enums + XOR author on INSERT and UPDATE"
  - "Postgres branch with native CHECK constraints for EE parity"

affects:
  - 15-05-tasks (FKs agent_task_queue.issue_id -> issues.id, trigger_comment_id -> comments.id)
  - 17-issues-service (reads uq_issues_ws_number + workspaces.issue_counter for atomic issue_number)
  - 17-comments-service (writes threaded comments via parent_id, emits system comments on status transitions)
  - 18-task-queue (issue -> task enqueue path; trigger_comment_id is the comment that caused enqueue)
  - 24-web (kanban board consumes idx_issues_kanban-sorted lists)

tech-stack:
  added: []
  patterns:
    - "Twin nullable FK + XOR trigger for polymorphic author (SQLite can't FK to two tables)"
    - "Self-referencing FK with SET NULL for thread preservation over CASCADE loop"
    - "REAL / FLOAT for fractional kanban position (service computes midpoint on insert)"
    - "Per-workspace monotonic counter in a separate row (workspaces.issue_counter), UNIQUE(workspace_id, issue_number) on the dependent table"

key-files:
  created:
    - apps/server/src/db/migrations/006_issues_and_comments.ts
  modified: []

key-decisions:
  - "CASCADE on comments.issue_id (child-of-issue semantics) vs SET NULL on comments.parent_id (orphan preservation): deleting an issue deletes its conversation (comments have no standalone meaning without their issue), but deleting a parent comment in a thread preserves children with parent_id=NULL so the audit trail and downstream replies survive. Matches PITFALLS §ST4 'archive over delete' for audit data at the intra-thread boundary while honouring the parent-child relationship at the inter-table boundary."
  - "Twin nullable FKs (author_user_id, author_agent_id) + XOR trigger over a polymorphic author_id: SQLite has no polymorphic FK and a single nullable UUID with separate author_type would silently allow dangling ids. Twin FKs give referential integrity to each target table; the trigger enforces exactly-one-non-null per author_type ('user' -> user id only, 'agent' -> agent id only, 'system' -> neither). Spoofing a system comment with a real user id now raises SQLITE_CONSTRAINT error 19 at the DB boundary."
  - "`in_review` explicitly absent from status enum (research Resolved Decision #3): five action statuses + backlog keeps the kanban board under the 6-column cognitive limit. Done/cancelled/blocked are terminal or holding; in_progress covers the review+iteration loop. Trigger rejects an in_review insert with the exact error message the API layer surfaces to clients."
  - "issue_number is an INTEGER column with UNIQUE(workspace_id, issue_number), NOT an AUTOINCREMENT: Phase 17 service runs an atomic `UPDATE workspaces SET issue_counter = issue_counter + 1 WHERE id=? RETURNING issue_counter` inside the same transaction as the INSERT, then writes the returned value into issue_number. This keeps counters per-workspace rather than per-table and avoids a global sequence. The schema's job is to guarantee no duplicates slip through; atomicity is the service's job."
  - "issues.position is REAL nullable, not initialised: Phase 17 computes a midpoint between two neighbours on kanban insert. A NULL position is valid for newly-created backlog items that have never been dragged; ordering falls back to created_at DESC via the application layer. Nullable float avoids default-0 causing new issues to stack under existing drag-ordered rows."
  - "Eight triggers, not four: every enum and the XOR rule needs BEFORE INSERT + BEFORE UPDATE. SQLite only fires `BEFORE UPDATE OF <col>` triggers when the named column is in the SET clause, so enum triggers use `UPDATE OF` (status, priority, type). The XOR author trigger uses bare `BEFORE UPDATE` because a bypass could come via changing either author_type, author_user_id, or author_agent_id."

patterns-established:
  - "Polymorphic author via twin FKs + XOR trigger (reusable for v1.5 activity log, notifications, reactions)"
  - "Self-FK with SET NULL for threaded hierarchies (reusable for replies, sub-tasks, nested comments)"
  - "REAL/FLOAT fractional position column + service-computed midpoint (reusable for any drag-reorderable list)"

requirements-completed: [SCH-04, SCH-07]

duration: ~6min
completed: 2026-04-16
---

# Phase 15-04: Issues + Comments Summary

**Issues + comments tables wired in a single migration: 6-status kanban (no in_review), 5 priorities, REAL fractional position, per-workspace monotonic issue_number, threaded polymorphic-author comments with DB-level XOR enforcement.**

## Performance

- **Duration:** ~6 min (single migration, two related tables)
- **Completed:** 2026-04-16
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `issues` table with 16 columns covering identity, workspace scoping, ordering, assignment, authorship, lifecycle timestamps, and metadata
- Created `comments` table with 11 columns supporting polymorphic authorship (user/agent/system), threading, and 4-type timeline taxonomy
- Installed 8 SQLite triggers giving DB-level enforcement on both INSERT and UPDATE paths:
  - `trg_issues_status_check[_upd]` — 6-state status enum
  - `trg_issues_priority_check[_upd]` — 5-state priority enum
  - `trg_comments_type_check[_upd]` — 4-state type enum
  - `trg_comments_author_check[_upd]` — XOR enforcement matching `author_type` to exactly-one-of `author_user_id` / `author_agent_id` (or neither for system)
- `UNIQUE(workspace_id, issue_number)` via `uq_issues_ws_number` guarantees no duplicate issue numbers inside a workspace (Phase 17 supplies atomicity via `workspaces.issue_counter`)
- Kanban hot path: `idx_issues_kanban (workspace_id, status, position)` for O(log n) board rendering
- Assignment lookup: `idx_issues_assignee (assignee_id)` for per-agent workload reads
- Comment threading: `idx_comments_parent (parent_id)` for thread descent
- Comment timeline: `idx_comments_issue_created (issue_id, created_at)` for ordered issue transcripts
- Postgres-native CHECK constraint branch retained for EE parity
- Migration reversible: `down()` drops all 8 triggers then both tables; verified against a fresh migrate+rollback round-trip

## Task Commits

1. **Task 1: Create migration 006 — issues + comments tables with full enum triggers** — `1e8e659` (feat)

## Files Created/Modified

- `apps/server/src/db/migrations/006_issues_and_comments.ts` — new migration creating `issues` (16 cols, 4 indexes, 3 FKs) and `comments` (11 cols, 2 indexes, 4 FKs), plus 8 enum/XOR triggers on SQLite with a Postgres-native CHECK branch for EE parity.

## Decisions Made

- **CASCADE on `comments.issue_id` vs SET NULL on `comments.parent_id`**: the two deletions target different semantic layers. An issue is the root of its conversation — deleting it without its comments leaves dangling context. A parent comment is an intermediate node in a thread — deleting it while preserving descendants keeps the audit trail intact. PITFALLS §ST4 ("archive over delete") prescribes SET NULL for intra-thread links; the inter-table parent-child link uses CASCADE because comments have no standalone meaning.
- **Twin nullable FKs + XOR trigger for polymorphic author**: SQLite can't FK a single `author_id` column to two target tables. Twin nullable FKs (`author_user_id` → users, `author_agent_id` → agents) give real referential integrity on each path, and the `trg_comments_author_check[_upd]` trigger rejects any insert/update where `author_type` doesn't match exactly-one-or-neither nullness. A user trying to spoof a system comment now fails with error 19 at the DB layer, not at a later API-boundary check.
- **`in_review` dropped from status enum** (research Resolved Decision #3): confirmed absent in both the migration source and the runtime trigger. An `INSERT INTO issues ... status='in_review'` is rejected with `issues.status must be backlog, todo, in_progress, done, blocked, or cancelled` — the exact message the API layer can surface verbatim.
- **`issue_number` is a plain INTEGER with UNIQUE(workspace_id, issue_number)**: Phase 17 is responsible for atomically bumping `workspaces.issue_counter` inside the same transaction as the issue insert. The schema only guarantees uniqueness, not monotonic allocation. This keeps counters per-workspace without requiring a global sequence (which SQLite wouldn't support per-column anyway).
- **`issues.position` is REAL nullable**: Phase 17 service computes midpoint positions on kanban reorder. NULL is a valid "never dragged" state that sorts via `created_at` fallback at the application layer. Using a default of 0 would cause new issues to stack underneath every drag-ordered row, breaking the intended ordering.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria satisfied on first migration run. No auto-fixes, no architectural decisions, no auth gates.

## Verification Evidence

### Migration run (fresh DB, migrations 001-006)

```
Batch 1 run: 6 migrations
001_initial_schema.ts
002_seed_wizard_configs.ts
003_boot_pragmas_and_workspace.ts
004_runtimes.ts
005_agents.ts
006_issues_and_comments.ts
```

### Tables created

```
issues
comments
```

### Triggers present (all 8 new ones for plan 15-04)

```
trg_issues_status_check
trg_issues_status_check_upd
trg_issues_priority_check
trg_issues_priority_check_upd
trg_comments_type_check
trg_comments_type_check_upd
trg_comments_author_check
trg_comments_author_check_upd
```

### Issue column set (16 columns)

`id, workspace_id, issue_number, title, description, status, priority, assignee_id, creator_user_id, position, due_date, completed_at, cancelled_at, metadata, created_at, updated_at` — all types and defaults match plan spec (`status='backlog'`, `priority='medium'`, `position=NULL`, `metadata='{}'`).

### Comment column set (11 columns)

`id, issue_id, author_type, author_user_id, author_agent_id, content, type, parent_id, metadata, created_at, updated_at` — `type` defaults to `'comment'`; author FKs are nullable but XOR trigger enforces consistency.

### FK graph verified against `.schema` output

- `issues.workspace_id` → `workspaces.id` **CASCADE**
- `issues.assignee_id` → `agents.id` **SET NULL** (agents outlive issues — ST4)
- `issues.creator_user_id` → `users.id` **SET NULL**
- `comments.issue_id` → `issues.id` **CASCADE** (child-of-issue)
- `comments.author_user_id` → `users.id` **SET NULL**
- `comments.author_agent_id` → `agents.id` **SET NULL**
- `comments.parent_id` → `comments.id` **SET NULL** (thread preservation)

### Negative tests (all rejected with SQLITE_CONSTRAINT error 19)

| Attempted operation | Trigger that rejected | Error message excerpt |
|-----|-----|-----|
| `INSERT issues ... status='in_review'` | `trg_issues_status_check` | `issues.status must be backlog, todo, in_progress, done, blocked, or cancelled` |
| `INSERT issues ... priority='critical'` | `trg_issues_priority_check` | `issues.priority must be urgent, high, medium, low, or none` |
| `UPDATE issues SET status='in_review'` | `trg_issues_status_check_upd` | same status message |
| `INSERT issues (...issue_number=1...)` twice in same workspace | `uq_issues_ws_number` | `UNIQUE constraint failed: issues.workspace_id, issues.issue_number` |
| `INSERT comments ... author_type='user', author_user_id=NULL` | `trg_comments_author_check` | `comments: author_type=user requires author_user_id; agent requires author_agent_id; system requires neither` |
| `INSERT comments ... author_type='system', author_user_id='u1'` | `trg_comments_author_check` | same XOR message |
| `INSERT comments ... type='hotness'` | `trg_comments_type_check` | `comments.type must be comment, status_change, progress_update, or system` |

### Positive tests (all accepted)

- `INSERT` issue with defaults (status=backlog, priority=medium, position=NULL) → accepted
- `INSERT` comment `author_type='user'` with `author_user_id='u1'` → accepted
- `INSERT` comment `author_type='system'` with both author ids NULL → accepted
- `INSERT` threaded child comment with `parent_id='c-usr'` → accepted

### Cascade / SET NULL semantics

- After `DELETE FROM comments WHERE id='c-usr'`: child comment `c-child` survived with `parent_id=NULL` (thread preservation confirmed)
- After `DELETE FROM issues WHERE id='i-ok'`: all remaining comments on that issue removed (`count(*) = 0`), confirming CASCADE on `comments.issue_id`

### Rollback round-trip

`npm run migrate` followed by `db.migrate.rollback()` → `issues` and `comments` tables removed, all 8 `trg_issues_*` / `trg_comments_*` triggers removed. Zero residual DDL from plan 15-04.

### Build + typecheck

- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0

## Reminder for Phase 17 (Issues Service)

The schema enforces uniqueness on `(workspace_id, issue_number)` but **does NOT** provide atomic allocation. The Phase 17 issue-create service must:

1. Begin a transaction
2. `UPDATE workspaces SET issue_counter = issue_counter + 1 WHERE id = ? RETURNING issue_counter` (atomic read-modify-write on the counter row)
3. Use the returned counter value as the new issue's `issue_number`
4. INSERT the issue row
5. Commit

Skipping step 2 and using `MAX(issue_number)+1` would race under concurrent create requests; the UNIQUE constraint would catch the collision but the service needs retry logic. The atomic counter is cheaper than MAX and race-free.

## Next Phase Readiness

- **15-05 (tasks)** can now FK `agent_task_queue.issue_id → issues.id` (CASCADE — orphan tasks are meaningless) and `agent_task_queue.trigger_comment_id → comments.id` (SET NULL — preserve task audit if comment is later deleted).
- **17 (issues service)** has the UNIQUE constraint, the indexes, and the enum enforcement it needs; service layer only owns atomicity and position-midpoint computation.
- **17 (comments service)** can emit system comments during issue status transitions without author-id book-keeping — the XOR trigger accepts `author_type='system'` with both author FKs NULL.
- **18 (task-queue)** can treat issue → task enqueue atomically by inserting the comment (with `type='progress_update'` or `type='system'`) and the task row inside one transaction, using the comment id as `trigger_comment_id`.
- **24 (web kanban)** can SELECT with `ORDER BY position NULLS LAST, created_at DESC` against `idx_issues_kanban` for efficient board rendering.

## Self-Check

- File `apps/server/src/db/migrations/006_issues_and_comments.ts`: FOUND
- Commit `1e8e659`: FOUND (git log contains it)
- All 8 triggers present in `sqlite_master` after fresh migration run
- `in_review` grep returns empty — confirmed absent from migration source and runtime schema
- XOR trigger rejects both "user with no id" and "system with id" cases with the exact plan-specified message
- FK graph matches plan spec on all 7 FKs (3 on issues, 4 on comments)
- Build + typecheck green
- Rollback round-trip clean (no residual tables or triggers)

## Self-Check: PASSED

---
*Phase: 15-schema-shared-types*
*Completed: 2026-04-16*
