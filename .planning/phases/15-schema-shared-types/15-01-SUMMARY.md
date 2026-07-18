---
phase: 15-schema-shared-types
plan: 01
subsystem: db
tags: [schema, sqlite, pragmas, workspace, v1.4-foundation]
dependency_graph:
  requires:
    - apps/server/src/db/migrations/001_initial_schema.ts
    - apps/server/src/db/migrations/002_seed_wizard_configs.ts
    - apps/server/src/db/migration-helpers.ts
    - apps/server/src/db/adapter.ts
    - apps/server/src/db/sqlite-adapter.ts
    - apps/server/src/db/index.ts
    - apps/server/src/server-core.ts
  provides:
    - SqliteAdapter.applyBootPragmas(knex) — WAL/synchronous/busy_timeout/foreign_keys apply+assert
    - workspaces table with TEXT(36) primary key, issue_prefix UNIQUE, issue_counter INTEGER
    - Single CE default workspace row {id:'AQ', issue_prefix:'AQ', issue_counter:0}
  affects:
    - All subsequent Phase 15 plans (15-02..15-06) — tables can now FK to workspaces.id
    - Server boot sequence — PRAGMAs applied after migrate.latest, before reconciliation
tech_stack:
  added: []
  patterns:
    - applyBootPragmas follows apply-then-read-back-and-assert pattern for fail-fast boot
    - Migration uses Knex schema builder (portable) + helpers (addUuidColumn, addJsonColumn)
    - Workspace primary key is TEXT(36) not UUID so CE ('AQ') and EE (uuid) share one column
key_files:
  created:
    - apps/server/src/db/migrations/003_boot_pragmas_and_workspace.ts
  modified:
    - apps/server/src/db/adapter.ts  # added optional applyBootPragmas?() to DbAdapter
    - apps/server/src/db/sqlite-adapter.ts  # implemented applyBootPragmas with PRAGMA read-back
    - apps/server/src/server-core.ts  # invoke applyBootPragmas post-migrate, pre-reconciliation (CE only)
decisions:
  - Migration number chosen: 003 (audit of existing dir showed 001_initial_schema, 002_seed_wizard_configs — next sequential unused)
  - PRAGMAs live in SqliteAdapter not in migration — migrations run once but PRAGMAs must apply per-connection
  - applyBootPragmas optional on DbAdapter so PostgresAdapter can be a no-op (not overridden)
  - Workspace id stored as TEXT(36) to allow both CE literal ('AQ') and EE UUID in the same column
  - owner_user_id is nullable with SET NULL on delete — admin user is created AFTER migrations, so seed row cannot reference it yet
metrics:
  duration: ~8min
  completed: 2026-04-16
  tasks: 2
  files: 4
  commits: 2
---

# Phase 15 Plan 01: Boot PRAGMAs + Workspaces Foundation Summary

**One-liner:** SQLite WAL/busy_timeout/synchronous/foreign_keys applied-and-asserted at server boot, and `workspaces` table with single CE default row ('AQ') seeded — foundation for every other v1.4 table.

## What Was Built

### Task 1 — `applyBootPragmas` on SqliteAdapter
- Added optional `applyBootPragmas?(knex: Knex): Promise<void>` to the `DbAdapter` interface (Postgres can no-op by not implementing it).
- Implemented on `SqliteAdapter`: issues `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`, `foreign_keys = ON`; then reads each back and throws if any did not stick. Logs `[CE] SQLite boot PRAGMAs applied and verified: …` on success.
- Wired into `server-core.ts` immediately after `db.migrate.latest(...)` and before `options.onAfterMigrate?.()` / reconciliation. Gated on `config.isCE` — EE paths are untouched.
- Commit: `42cf028`

### Task 2 — Migration 003: `workspaces` + CE seed
- Created `apps/server/src/db/migrations/003_boot_pragmas_and_workspace.ts`.
- Schema: `id` TEXT(36) PK, `name` TEXT NOT NULL, `issue_prefix` TEXT NOT NULL UNIQUE, `issue_counter` INTEGER NOT NULL DEFAULT 0, `owner_user_id` TEXT(36) FK→users(id) SET NULL NULL, `metadata` JSON DEFAULT '{}', `created_at`/`updated_at` timestamps defaulting to `knex.fn.now()`.
- Seeded one row: `{id:'AQ', name:'Default Workspace', issue_prefix:'AQ', issue_counter:0, metadata:'{}'}`.
- Used Knex schema builder (`knex.schema.createTable`) — no raw `CREATE TABLE` SQL, no Postgres-specific functions.
- Commit: `e994963`

## Requirements Satisfied

| Req | Covered | Evidence |
|-----|---------|----------|
| SCH-09 | yes | `applyBootPragmas` applies + asserts WAL/busy_timeout=5000/synchronous=NORMAL/foreign_keys=ON at boot; throws on any mismatch (boot fails fast). |
| SCH-01 | partial | `workspaces` entity exists with single CE default row `id='AQ'`. Remaining SCH-01 scope (every new v1.4 table FKs to `workspace_id`) is enforced by plans 15-02 through 15-06. |

## Verification Results

Fresh SQLite DB migration run:
```
$ rm -f /tmp/aquarium-15-01-test.db
$ AQUARIUM_DB_PATH=/tmp/aquarium-15-01-test.db npx tsx apps/server/src/db/run-migrations.ts
Batch 1 run: 3 migrations
001_initial_schema.ts
002_seed_wizard_configs.ts
003_boot_pragmas_and_workspace.ts
```

Re-run (idempotency):
```
$ AQUARIUM_DB_PATH=/tmp/aquarium-15-01-test.db npx tsx apps/server/src/db/run-migrations.ts
Already up to date
```

Default workspace row present after migrate:
```
$ sqlite3 /tmp/aquarium-15-01-test.db "SELECT id, issue_prefix, issue_counter FROM workspaces;"
AQ|AQ|0
```

Typecheck:
```
$ npm run typecheck -w @aquaclawai/aquarium
> tsc --noEmit
(exit 0)
```

Note: `PRAGMA journal_mode` read via the `sqlite3` CLI on a freshly-migrated DB returns `delete` (default), not `wal`. This is **expected and correct** — PRAGMAs are per-connection, and the migration runner exits before applying them. The PRAGMAs apply at server boot via `SqliteAdapter.applyBootPragmas()`, which asserts them and throws on mismatch. This is the intentional separation: migrations change schema (run once), PRAGMAs configure the session (run every connection).

## Deviations from Plan

None — plan executed exactly as written. Both tasks passed every acceptance criterion without needing Rule 1/2/3 fixes.

## Decisions Made

- **Migration numbered 003** — audit of `apps/server/src/db/migrations/` confirmed only `001_initial_schema.ts` and `002_seed_wizard_configs.ts` exist, so 003 is next-sequential (pitfall SCH1).
- **PRAGMAs at boot, not in migration** — PRAGMA `journal_mode=WAL` persists on the DB file (mode change is sticky for the file), but `busy_timeout` is per-connection; applying both at boot centralises the responsibility and allows fail-fast assertion.
- **`applyBootPragmas?` optional** — PostgresAdapter leaves it undefined; the caller checks `if (adapter.applyBootPragmas)` before invoking, so EE keeps the exact same behaviour as before.
- **`workspaces.id` is TEXT(36), not UUID** — CE seeds the literal `'AQ'`; EE (future) can insert UUIDs into the same column. Avoids dialect-conditional primary keys.
- **`owner_user_id` nullable with SET NULL** — on a fresh DB the admin user doesn't exist yet (server-core creates it after migrations run), so the seed row cannot reference a user. FK remains for EE correctness.

## Self-Check: PASSED

Files (all present):
- `apps/server/src/db/adapter.ts` — FOUND (modified)
- `apps/server/src/db/sqlite-adapter.ts` — FOUND (modified)
- `apps/server/src/server-core.ts` — FOUND (modified)
- `apps/server/src/db/migrations/003_boot_pragmas_and_workspace.ts` — FOUND (created)

Commits (both in `git log --oneline`):
- `42cf028` feat(15-01): add applyBootPragmas to SqliteAdapter + wire into boot — FOUND
- `e994963` feat(15-01): add migration 003 workspaces table + CE default seed — FOUND

Behavioural checks:
- `grep applyBootPragmas` sqlite-adapter.ts → 2 occurrences
- `grep applyBootPragmas` adapter.ts → 1 occurrence
- `grep applyBootPragmas` server-core.ts → 2 occurrences
- No unextended `./db/adapter` imports in server-core.ts (all use `.js` suffix)
- Fresh DB migration: all 3 migrations apply, `workspaces` has exactly one row with `id='AQ', issue_prefix='AQ', issue_counter=0`
- Re-run migrations: `Already up to date` (idempotent)
- Typecheck: exit 0
