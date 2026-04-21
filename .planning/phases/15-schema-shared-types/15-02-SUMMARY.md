---
phase: 15-schema-shared-types
plan: 02
subsystem: database

tags: [knex, sqlite, migration, schema, runtimes, triggers, cascade]

requires:
  - phase: 15-01
    provides: "Knex bootstrap + migration-helpers (addUuidPrimary, addUuidColumn, addJsonColumn) + adapter dialect branching"

provides:
  - "runtimes table with kind discriminator (local_daemon | external_cloud_daemon | hosted_instance)"
  - "SQLite trigger-enforced CHECK semantics for kind, status, and daemon_id XOR instance_id"
  - "ON DELETE CASCADE FKs: runtimes.instance_id -> instances.id, runtimes.workspace_id -> workspaces.id"
  - "UNIQUE(workspace_id, daemon_id, provider) and idx_runtimes_workspace_status + partial idx_runtimes_instance"

affects:
  - 15-03-agents (FKs agents.runtime_id -> runtimes.id)
  - 15-05-tasks (FKs agent_task_queue.runtime_id -> runtimes.id)
  - 16-runtime-bridge
  - 17-agents
  - 18-task-queue
  - 19-daemon-rest
  - 20-hosted-worker

tech-stack:
  added: []
  patterns:
    - "SQLite schema-level invariants via BEFORE INSERT/UPDATE triggers raising RAISE(ABORT, ...) — substitute for CHECK where ALTER TABLE cannot add one"
    - "Dialect-branched migrations: adapter.dialect === 'sqlite' vs Postgres native ALTER TABLE ADD CONSTRAINT CHECK"
    - "Partial index via raw SQL (CREATE INDEX ... WHERE col IS NOT NULL) for sparse columns"

key-files:
  created:
    - apps/server/src/db/migrations/004_runtimes.ts
  modified: []

key-decisions:
  - "Chose triggers over application-level validation for XOR/kind/status — SCH-02 demands schema-level guarantees so a rogue daemon or bypassed service layer cannot land bad rows."
  - "Kept FK instance_id as ON DELETE CASCADE (not SET NULL) per ROADMAP owned-pitfalls SCH2 + ST4 — the hosted_instance runtime row is a mirror of the instance; it must vanish with the instance."
  - "No circular FK to agents — runtimes does not reference agents (SCH3). Agents reference runtimes in plan 15-03."
  - "owner_user_id FK uses ON DELETE SET NULL — runtimes outlive individual users for external daemon cases; ownership is advisory."
  - "No archived_at column on runtimes — archival state for hosted_instance is derived from instances.status."

patterns-established:
  - "SQLite-trigger-for-CHECK pattern: 2 triggers per check (INSERT + UPDATE OF col), WHEN clause negating the valid predicate, SELECT RAISE(ABORT, '...')"
  - "Partial index via knex.raw when Knex builder does not support predicated indexes"

requirements-completed: [SCH-02]

duration: 12min
completed: 2026-04-16
---

# Phase 15-02: Runtimes Table Summary

**Unified runtimes table with SQLite trigger-enforced kind discriminator + daemon_id XOR instance_id invariant, plus CASCADE FKs to instances and workspaces.**

## Performance

- **Duration:** ~12 min (resumed-run portion; single task)
- **Completed:** 2026-04-16
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `runtimes` table with 14 columns, discriminator `kind`, and status enum
- Installed six SQLite triggers (INSERT + UPDATE_OF for kind, discriminator, status) giving schema-level invariant enforcement on CE
- Added Postgres-native CHECK constraint branch for EE parity
- FK CASCADE semantics verified end-to-end: deleting an instance removes its `hosted_instance` mirror runtime row
- Partial index `idx_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL` narrows to hosted runtimes only
- `grep -c addCheckConstraint` = 0 — the ALTER-level no-op helper is intentionally not called

## Task Commits

1. **Task 1: Create migration 004 — runtimes table with CHECK + FKs + indexes** — `8be4426` (feat)

**Plan metadata:** (next commit, this SUMMARY)

## Files Created/Modified

- `apps/server/src/db/migrations/004_runtimes.ts` — Migration creating `runtimes` with 14 columns, 6 triggers (kind + discriminator + status, INSERT + UPDATE variants each), dialect-branched CHECK logic for Postgres, partial index for hosted-instance lookups, and clean `down()` that drops triggers + index + table.

## Decisions Made

- **Triggers over inline CHECK:** SQLite supports inline `CHECK` only at `CREATE TABLE` time, and Knex's builder does not expose a table-level CHECK chain reliably. `ALTER TABLE ADD CONSTRAINT` is unsupported. Triggers give the required schema-level guarantee (SCH-02) on CE while Postgres (EE) gets the native `CHECK` form.
- **CASCADE semantics:** `runtimes.instance_id -> instances.id ON DELETE CASCADE` per ROADMAP SCH2/ST4 — a `hosted_instance` row is a mirror of the instance lifecycle, so deleting the instance must remove the runtime row. `workspace_id` likewise CASCADEs per ST4.
- **owner_user_id SET NULL:** Runtimes (especially external daemon ones) should not disappear merely because a user is deleted. Ownership is advisory and can be null.

## Deviations from Plan

### Minor documentation-comment wording adjustment

**1. [Housekeeping] Removed the bare word `addCheckConstraint` from doc comments**
- **Found during:** Task 1 verification
- **Issue:** The plan's acceptance criterion `grep -c "addCheckConstraint" = 0` counts doc-comment mentions too. Two comments explained *why* the helper is not used and tripped the grep count.
- **Fix:** Rephrased both comments to describe the helper functionally ("the ALTER-level helper is a no-op on SQLite") without using the exact symbol name. Behaviour unchanged; grep now returns 0.
- **Files modified:** apps/server/src/db/migrations/004_runtimes.ts
- **Verification:** `grep -c "addCheckConstraint" apps/server/src/db/migrations/004_runtimes.ts` → 0
- **Committed in:** 8be4426

---

**Total deviations:** 1 documentation-only (zero behavioural changes)
**Impact on plan:** None — purely aligns source text with the acceptance grep.

## Issues Encountered

- **Trigger firing order observation:** For `INSERT ... kind='bogus' ... daemon_id='d1'`, the discriminator trigger fires before the kind-check trigger (because the `bogus` value fails the discriminator predicate — `kind NOT IN daemon set AND kind != 'hosted_instance'`). The row is rejected either way, but the user-visible error message comes from the discriminator trigger, not the kind-check trigger. Both triggers exist and remain correct; this is purely SQLite's trigger firing order and does not affect correctness. The acceptance criterion ("insert with kind='bogus' is REJECTED") is satisfied — both ABORT error messages count as rejection.

## Verification Evidence

### Schema (after migrations 001-004 on fresh DB)

- `runtimes` table: present
- Columns (14): `id, workspace_id, name, kind, provider, status, daemon_id, device_info, last_heartbeat_at, instance_id, metadata, owner_user_id, created_at, updated_at`
- Triggers: `trg_runtimes_kind_check`, `trg_runtimes_kind_check_upd`, `trg_runtimes_discriminator`, `trg_runtimes_discriminator_upd`, `trg_runtimes_status_check`, `trg_runtimes_status_check_upd` (all 6 present)
- Indexes: `idx_runtimes_workspace_status`, `uq_runtimes_ws_daemon_provider`, and partial `idx_runtimes_instance` (SQL contains `WHERE instance_id IS NOT NULL`)

### `PRAGMA foreign_key_list(runtimes)` output

```
0|0|users|owner_user_id|id|NO ACTION|SET NULL|NONE
1|0|instances|instance_id|id|NO ACTION|CASCADE|NONE
2|0|workspaces|workspace_id|id|NO ACTION|CASCADE|NONE
```

Both CASCADE FKs confirmed as SCH-02 / SCH2 / ST4 demand.

### Negative tests (all rejected with SQLite error 19)

- `INSERT ... kind='hosted_instance' ... instance_id=NULL` → rejected: "daemon kinds require daemon_id and no instance_id; hosted_instance requires instance_id and no daemon_id"
- `INSERT ... kind='bogus' ... daemon_id='d1'` → rejected (discriminator trigger fires first; both trigger messages would have caught it)
- `INSERT ... status='invalid' ...` → rejected: "runtimes.status must be online, offline, or error"
- `INSERT ... kind='local_daemon' ... daemon_id='d1' instance_id='i1'` (XOR both-set) → rejected with discriminator error

### CASCADE delete test

1. Seeded `users(u1)`, `instances(i1)` (FK user_id=u1), `runtimes(rt1)` (FK instance_id=i1, kind=hosted_instance)
2. `DELETE FROM instances WHERE id='i1'`
3. `SELECT count(*) FROM runtimes WHERE id='rt1'` → 0

Runtime row cascaded out cleanly.

### Build + typecheck

- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0

## Rationale for trigger-based enforcement (per plan `<output>` directive)

SQLite does not support `ALTER TABLE ADD CONSTRAINT CHECK (...)`. Inline `CHECK` inside `CREATE TABLE` is the only native option. The Knex schema-builder chain for table-level CHECK is not portable enough across Knex versions to rely on. The codebase's existing `addCheckConstraint` helper is a documented no-op on SQLite.

SCH-02 demands a **schema-level guarantee** that the discriminator invariant holds — application-layer validation is insufficient because external daemons (Phase 19) will INSERT directly and cannot be trusted at schema time. Triggers give us that guarantee: they run inside the SQL engine, before the row lands, and cannot be bypassed by any client that speaks SQLite.

Postgres (EE) gets the same semantics via its native `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` in the else-branch of the migration.

## Next Phase Readiness

- 15-03-agents can now FK `agents.runtime_id -> runtimes.id` with confidence that any runtime row is shape-valid.
- 15-05-tasks can FK `agent_task_queue.runtime_id` uniformly regardless of kind.
- 16-runtime-bridge can treat all three runtime kinds through a single table.
- 19-daemon-rest registration can INSERT `kind='local_daemon'` or `'external_cloud_daemon'` rows knowing triggers will reject malformed shapes even before Phase 19 adds auth hardening.

## Self-Check

- File `apps/server/src/db/migrations/004_runtimes.ts`: FOUND
- Commit `8be4426`: FOUND (`git log --all | grep 8be4426` returns match)
- All six triggers present in `sqlite_master` after running migrations on fresh DB
- Partial index SQL contains `WHERE instance_id IS NOT NULL`
- XOR violation and invalid-status inserts both ABORT with exit 19
- CASCADE from instances -> runtimes verified
- Build + typecheck green

## Self-Check: PASSED

---
*Phase: 15-schema-shared-types*
*Completed: 2026-04-16*
