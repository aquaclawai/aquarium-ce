---
phase: 15-schema-shared-types
verified: 2026-04-16T00:00:00Z
status: passed
score: 4/4 roadmap success criteria + 10/10 requirement IDs verified
re_verification: false
---

# Phase 15: Schema + Shared Types Verification Report

**Phase Goal:** Ship the v1.4 DB foundation — workspace, runtimes, agents, issues, tasks, task_messages, comments, daemon_tokens tables with SQLite concurrency PRAGMAs — so every downstream phase can read/write persistent state without further schema work.

**Verified:** 2026-04-16
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### ROADMAP Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `npm run migrate` runs migrations 003-008 cleanly against a fresh SQLite DB, schema intact across restart | VERIFIED | `Batch 1 run: 8 migrations` (001..008), re-run reports `Already up to date`. Tables confirmed via `.tables`. |
| 2 | `PRAGMA journal_mode` returns `wal` and `PRAGMA busy_timeout` returns `5000` after boot; asserted in boot-time integrity check | VERIFIED | `applyBootPragmas` in `sqlite-adapter.ts` applies + reads-back + throws on mismatch. Executed live against `/tmp/aq-verify.db`: output `journal_mode=wal, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON`. After invocation, file-level `PRAGMA journal_mode` persists as `wal`. Wired in `server-core.ts` lines 223-228 (post-migrate, pre-reconciliation, gated on `config.isCE`). |
| 3 | Shared types exported from `@aquarium/shared` typecheck in both server and web workspaces | VERIFIED | `npm run build -w @aquarium/shared` → exit 0. `npm run typecheck -w @aquaclawai/aquarium` → exit 0. `npm run lint -w @aquarium/web` → exit 0 (0 errors, 15 pre-existing warnings out of scope). `index.ts` contains `export * from './v14-types.js';`. |
| 4 | Partial unique index on `agent_task_queue(issue_id, agent_id) WHERE status IN ('queued','dispatched')` rejects a second pending task via direct SQL | VERIFIED | Index SQL: `CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent ON agent_task_queue (issue_id, agent_id) WHERE status IN ('queued','dispatched')`. Duplicate-insert test (same issue_id=i1, agent_id=a1, status='queued') returns SQLite error 19: `UNIQUE constraint failed: agent_task_queue.issue_id, agent_task_queue.agent_id`. |

**ROADMAP Success Criteria Score:** 4/4 VERIFIED

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/db/migrations/003_boot_pragmas_and_workspace.ts` | workspaces table + AQ seed | VERIFIED | Creates `workspaces` via Knex schema builder; seeds `{id:'AQ', issue_prefix:'AQ', issue_counter:0}`. Knex schema ONLY — no Postgres-specific SQL. |
| `apps/server/src/db/migrations/004_runtimes.ts` | runtimes table with kind CHECK + XOR | VERIFIED | 14-column table + 6 triggers (kind, discriminator XOR, status × INSERT/UPDATE). FKs: `instance_id CASCADE`, `workspace_id CASCADE`, `owner_user_id SET NULL`. Partial index `idx_runtimes_instance WHERE instance_id IS NOT NULL` present. |
| `apps/server/src/db/migrations/005_agents.ts` | agents table with mct 1..16 CHECK + archival | VERIFIED | 17-column table + 6 triggers (mct range, visibility, status × INSERT/UPDATE). FKs: `workspace_id CASCADE`, `runtime_id SET NULL`, `owner_user_id SET NULL`, `archived_by SET NULL`. Default mct=6. `archived_at`/`archived_by` nullable. |
| `apps/server/src/db/migrations/006_issues_and_comments.ts` | issues + comments with enum triggers | VERIFIED | 16-col issues + 11-col comments; 8 triggers (status 6-state, priority 5-state, comment type 4-state, XOR author × INSERT/UPDATE). `in_review` absent from enum. `position` is `FLOAT`. `issue_number` UNIQUE per workspace. |
| `apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts` | task queue + messages + partial unique index | VERIFIED | 19-col agent_task_queue + 10-col task_messages. Partial unique index `idx_one_pending_task_per_issue_agent` with WHERE clause verified in sqlite_master. `UNIQUE(task_id, seq)` on task_messages. FKs: `runtime_id CASCADE` (ROADMAP ST4), `agent_id CASCADE`, `issue_id CASCADE`, `workspace_id CASCADE`, `trigger_comment_id SET NULL`. |
| `apps/server/src/db/migrations/008_daemon_tokens.ts` | daemon_tokens with hashed storage | VERIFIED | 11-col table, `token_hash VARCHAR(64) NOT NULL UNIQUE`, NO plaintext column. FKs: `workspace_id CASCADE`, `created_by_user_id SET NULL`. Indexes: `idx_daemon_tokens_workspace`, `idx_daemon_tokens_revoked`, unique `daemon_tokens_token_hash_unique`. |
| `apps/server/src/db/sqlite-adapter.ts` | applyBootPragmas applies + asserts PRAGMAs | VERIFIED | `applyBootPragmas` sets WAL/NORMAL/5000/ON, reads-back each via normalized helper, throws on mismatch. Logs `[CE] SQLite boot PRAGMAs applied and verified: ...`. |
| `apps/server/src/db/adapter.ts` | DbAdapter.applyBootPragmas? added | VERIFIED | Interface declares `applyBootPragmas?(knex: Knex): Promise<void>` as optional (Postgres no-op). Line 37. |
| `apps/server/src/server-core.ts` | boot-time PRAGMA assertion wired | VERIFIED | Lines 223-228: after `db.migrate.latest`, before `onAfterMigrate`, gated on `config.isCE`, imports adapter via `.js` extension, calls `adapter.applyBootPragmas(db)` if defined. |
| `packages/shared/src/v14-types.ts` | 26 domain + wire type exports | VERIFIED | grep count = 26 for the required names. No `any` (regex `:\s*any[\s;)<,]` returns 0). No `in_review`. |
| `packages/shared/src/index.ts` | re-export of v14-types | VERIFIED | Line 3: `export * from './v14-types.js';` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server-core.ts` | `sqlite-adapter.ts` | applyBootPragmas call post-migrate | WIRED | `adapter.applyBootPragmas(db)` invoked at lines 226-227. Live test confirmed `journal_mode=wal, busy_timeout=5000` after call. |
| `007_agent_task_queue_and_messages.ts` | `004/005/006` | FKs + partial unique index | WIRED | `PRAGMA foreign_key_list(agent_task_queue)` shows all 5 FKs with correct cascade semantics (4 CASCADE, 1 SET NULL). |
| `packages/shared/src/index.ts` | `packages/shared/src/v14-types.ts` | barrel re-export | WIRED | Barrel import works — `npm run typecheck -w @aquaclawai/aquarium` exits 0, `npm run lint -w @aquarium/web` exits 0. |
| `004/005/006/007_*.ts` | `003_boot_pragmas_and_workspace.ts` | `inTable('workspaces')` FKs | WIRED | Every v1.4 table FKs to `workspaces.id` (verified via `PRAGMA foreign_key_list` on each table). |

---

### Requirements Coverage

| Req ID | Source Plan | Description | Status | Evidence |
|--------|-------------|-------------|--------|----------|
| SCH-01 | 15-01 | Workspace entity (AQ default) + workspace_id FK enforcement | SATISFIED | `workspaces` table present; `AQ|AQ|0` seeded; every v1.4 table FKs to `workspaces.id` (CASCADE) |
| SCH-02 | 15-02 | runtimes table with kind CHECK + daemon_id XOR instance_id | SATISFIED | 3-kind enum enforced by `trg_runtimes_kind_check[_upd]`; XOR enforced by `trg_runtimes_discriminator[_upd]`; XOR violation test returns SQLite error 19 |
| SCH-03 | 15-03 | agents table with instructions, custom_env, custom_args, mct DEFAULT 6 CHECK 1..16, visibility, status, archived_at/by | SATISFIED | All columns present; default mct=6; `trg_agents_mct_check[_upd]` rejects 17 (live test: error 19); visibility + status enums enforced; archival columns nullable |
| SCH-04 | 15-04 | issues table: 6-status (no in_review), priority, assignee, position FLOAT, monotonic issue_number per workspace | SATISFIED | 6-status trigger rejects `in_review` (live test: error 19); `position FLOAT`; `UNIQUE(workspace_id, issue_number)` via `uq_issues_ws_number` |
| SCH-05 | 15-05 | agent_task_queue: 6-status, trigger_comment_id, session_id, work_dir, partial unique index | SATISFIED | All columns present; partial unique index SQL in `sqlite_master` contains `WHERE status IN ('queued','dispatched')`; duplicate-pending test rejected (error 19) |
| SCH-06 | 15-05 | task_messages table with (task_id, seq) index | SATISFIED | `uq_task_messages_task_seq` UNIQUE index present; enforces replay-on-reconnect contract |
| SCH-07 | 15-04 | comments table: 4-type enum + parent_id threading | SATISFIED | 4-type enum enforced by `trg_comments_type_check[_upd]`; XOR author via `trg_comments_author_check[_upd]`; parent_id self-FK with SET NULL |
| SCH-08 | 15-06 | daemon_tokens with hashed token_hash UNIQUE, expires_at, last_used_at, revoked_at | SATISFIED | `token_hash VARCHAR(64) NOT NULL UNIQUE`, no plaintext column, `expires_at`, `last_used_at`, `revoked_at` all present and nullable |
| SCH-09 | 15-01 | Mandatory SQLite PRAGMAs applied at boot and verified (WAL + synchronous=NORMAL + busy_timeout=5000) | SATISFIED | `applyBootPragmas` applies 4 PRAGMAs + reads-back + throws on mismatch. Live invocation verified: WAL engaged on file, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON |
| SCH-10 | 15-06 | Shared TS types exported from `@aquarium/shared` for Issue/Agent/Runtime/Task/TaskMessage/Comment/daemon REST shapes | SATISFIED | 26 exports verified via grep (Workspace, Runtime[Kind/Status/Provider/DeviceInfo], Agent[Status/Visibility], Issue[Status/Priority], Comment[Type/AuthorType], AgentTask, TaskStatus, TaskMessage[Type], DaemonToken[CreatedResponse], DaemonRegisterRequest/Response, ClaimedTask, TaskEventType, TaskEventPayload) |

**Requirements Coverage Score:** 10/10 SATISFIED

No orphaned requirements — REQUIREMENTS.md §"Phase 15" maps SCH-01..SCH-10 and all are claimed by plans 15-01 through 15-06.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | All migrations use Knex schema builder (no raw `CREATE TABLE`); no `any`; no `@ts-ignore`; no `process.env` outside config; all server imports use `.js` extension. |

Scanned for: TODO/FIXME/placeholder, empty returns, `as any`, `:any`, hardcoded empty props, console.log-only handlers. Zero blockers. Zero warnings.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Fresh DB migration runs cleanly | `rm -f /tmp/aq-verify.db && AQUARIUM_DB_PATH=/tmp/aq-verify.db node --import tsx apps/server/src/db/run-migrations.ts` | Output: `Batch 1 run: 8 migrations` listing 001..008 | PASS |
| Migration idempotent on restart | Re-run same command | Output: `Already up to date` | PASS |
| All 8 v1.4 tables present | `sqlite3 /tmp/aq-verify.db '.tables'` | Listed: workspaces, runtimes, agents, issues, comments, agent_task_queue, task_messages, daemon_tokens (+ v1.0-v1.3 tables) | PASS |
| AQ workspace seeded | `SELECT id, issue_prefix, issue_counter FROM workspaces` | `AQ\|AQ\|0` | PASS |
| Partial unique index SQL contains WHERE clause | `SELECT sql FROM sqlite_master WHERE name='idx_one_pending_task_per_issue_agent'` | Contains `WHERE status IN ('queued','dispatched')` | PASS |
| All 24 v1.4 triggers present | `SELECT name FROM sqlite_master WHERE type='trigger'` | 24 rows (6 runtimes + 6 agents + 8 issues/comments + 4 atq/task_messages) | PASS |
| Duplicate pending task rejected | `INSERT INTO agent_task_queue (... i1, a1, 'queued' ...)` twice | 2nd insert → `Error: stepping, UNIQUE constraint failed: agent_task_queue.issue_id, agent_task_queue.agent_id (19)` | PASS |
| issues status `in_review` rejected | `INSERT INTO issues (... status='in_review' ...)` | `Error: stepping, issues.status must be backlog, todo, in_progress, done, blocked, or cancelled (19)` | PASS |
| agents mct=17 rejected | `INSERT INTO agents (... max_concurrent_tasks=17 ...)` | `Error: stepping, agents.max_concurrent_tasks must be between 1 and 16 (19)` | PASS |
| runtime XOR violation rejected | `INSERT INTO runtimes (kind='hosted_instance', instance_id=NULL ...)` | `Error: stepping, runtimes: daemon kinds require daemon_id and no instance_id; hosted_instance requires instance_id and no daemon_id (19)` | PASS |
| applyBootPragmas applies + asserts | Live adapter invocation against `/tmp/aq-verify.db` | Output: `[CE] SQLite boot PRAGMAs applied and verified: journal_mode=wal, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON` and read-back `journal_mode=wal, busy_timeout=5000` | PASS |
| WAL persists on file after applyBootPragmas | `sqlite3 /tmp/aq-verify.db 'PRAGMA journal_mode'` post-invocation | `wal` | PASS |
| Shared types build | `npm run build -w @aquarium/shared` | Exit 0, emits `dist/v14-types.js` + `.d.ts` | PASS |
| Server typecheck | `npm run typecheck -w @aquaclawai/aquarium` | Exit 0 | PASS |
| Web workspace lint/typecheck | `npm run lint -w @aquarium/web` | Exit 0 (0 errors, 15 pre-existing warnings out of scope) | PASS |
| 26 required shared type exports present | `grep -c "^export (interface|type) (Workspace|...|TaskEventPayload)\b"` | `26` | PASS |
| No `any` in v14-types.ts | `grep -c ":\s*any[\s;)<,]"` | `0` | PASS |

**Spot-Check Score:** 15/15 PASS

---

### Data-Flow Trace (Level 4)

Not applicable — Phase 15 produces schema + type definitions only. No dynamic-data rendering artifacts. Downstream phases (17, 18, 24) implement the data flows.

---

### Human Verification Required

None. All success criteria and requirements are observable via SQL queries, grep, build/typecheck/lint invocations, and schema introspection. The phase's goal is schema + types — both are automatically verifiable.

---

### Gaps Summary

**No gaps.** Every must-have across 6 plans is satisfied:

- 8 migrations run cleanly on fresh DB and are idempotent on restart
- 8 v1.4 tables created with correct columns, defaults, enums, FKs, and CASCADE/SET NULL semantics
- 24 schema-level triggers installed (enum + XOR + range enforcement); negative tests confirm SQLite rejects bad inputs with error 19
- Partial unique index rejects duplicate pending tasks at SQLite layer (coalescing guarantee for Phase 18's BEGIN IMMEDIATE claim)
- `applyBootPragmas` applies + reads-back + asserts WAL/NORMAL/5000/ON with fail-fast error on any mismatch; live-tested and confirmed
- `server-core.ts` wires the call post-migrate, pre-reconciliation, gated on `config.isCE`
- 26 shared types exported from `@aquarium/shared` via `v14-types.ts` + barrel re-export; types build, typecheck, and lint green in both workspaces
- All string-literal unions in `v14-types.ts` match migration trigger enum strings 1:1 (verified by file read)
- No anti-patterns: no `any`, no `as any`, no `@ts-ignore`, no raw `CREATE TABLE`, no Postgres-specific SQL in CE paths, no plaintext token column, no `in_review` in status enum
- ROADMAP owned pitfalls addressed: SQ1 (WAL), SQ3 (partial unique index), SQ5 (busy_timeout), SCH1 (sequential numbering 003-008), SCH2/SCH3/ST4 (cascade semantics), CE1 (workspace_id enforcement), CE2 (no Postgres-only SQL), ST2 (task_messages replay-on-reconnect UNIQUE), AUTH3-5 (daemon token audit trail)

Phase 15 delivers the complete v1.4 DB foundation exactly as specified in ROADMAP + REQUIREMENTS. Phase 16 (runtime-bridge), Phase 17 (services), Phase 18 (task queue), Phase 19 (daemon REST), and Phase 24 (web kanban) are all unblocked for schema and types.

---

*Verified: 2026-04-16*
*Verifier: Claude (gsd-verifier)*
