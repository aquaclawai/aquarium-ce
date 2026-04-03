---
phase: 01-skill-management
plan: "01"
subsystem: extension-lifecycle
tags: [types, migration, config, sqlite, shared]
dependency_graph:
  requires: []
  provides: [extension-types, extension-tables, server-session-id]
  affects: [all-subsequent-plans]
tech_stack:
  added: []
  patterns: [knex-partial-index-raw, uuid-on-module-load]
key_files:
  created:
    - apps/server/src/db/migrations/036_extension_tables.ts
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/config.ts
decisions:
  - "Named new SkillSource as ExtensionSkillSource to avoid conflict with existing SkillSource (used for template declarations)"
  - "Named new CredentialRequirement as ExtensionCredentialRequirement to avoid conflict with existing CredentialRequirement (different field shape)"
  - "Used timestamp() with knex.fn.now() instead of text+datetime('now') raw default to match CE migration pattern and avoid SQLite syntax errors"
  - "Partial unique index idx_one_active_op created via knex.raw() since Knex schema builder does not support partial indexes"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-04-03"
  tasks_completed: 2
  files_changed: 3
---

# Phase 1 Plan 01: Extension Lifecycle Foundation Summary

**One-liner:** Extension lifecycle foundation with 13 shared types, three SQLite tables (instance_plugins, instance_skills, extension_operations), and server session UUID for orphan detection.

## What Was Built

This plan establishes the foundation layer for the plugin and skill extension lifecycle system. All subsequent plans in Phase 1 depend on these types, tables, and the session identity.

### Shared Types (packages/shared/src/types.ts)

Added 13 new types to the shared package:

| Type | Kind | Purpose |
|------|------|---------|
| `ExtensionStatus` | union type | 6-state lifecycle: pending, installed, active, disabled, degraded, failed |
| `ExtensionKind` | union type | 'plugin' or 'skill' discriminator |
| `PluginSource` | union type | Plugin origin: bundled, clawhub, or npm |
| `ExtensionSkillSource` | union type | Skill origin: bundled, clawhub, or url |
| `ExtensionCredentialRequirement` | interface | Credential field declaration for extension catalogs |
| `GatewayExtensionInfo` | interface | Bundled extension info from gateway |
| `InstancePlugin` | interface | Plugin installation record (mirrors instance_plugins table) |
| `InstanceSkill` | interface | Skill installation record (mirrors instance_skills table) |
| `SkillCatalogEntry` | interface | Skill discovery catalog item |
| `PluginCatalogEntry` | interface | Plugin discovery catalog item |
| `ExtensionOperation` | interface | DB-lock operation record (mirrors extension_operations table) |

### Database Migration (036_extension_tables.ts)

Three new tables:

**instance_plugins** — Tracks plugin installation state per instance:
- UUID PK, instance_id FK (CASCADE), plugin_id, source (JSON), version/locked_version, integrity_hash
- enabled flag, config (JSON), status, error_message, failed_at, pending_owner, retry_count
- Timestamps: installed_at, updated_at
- UNIQUE(instance_id, plugin_id)

**instance_skills** — Identical schema with skill_id instead of plugin_id:
- UNIQUE(instance_id, skill_id)

**extension_operations** — Operation log with distributed locking:
- fencing_token (UNIQUE), operation_type, target_extension, extension_kind, pending_owner
- cancel_requested flag, started_at, completed_at, result, error_message
- Composite index `idx_ext_ops_instance` on (instance_id, completed_at)
- **Partial unique index** `idx_one_active_op` on (instance_id) WHERE completed_at IS NULL — enforces one active operation per instance

### Config (apps/server/src/config.ts)

Added `serverSessionId: randomUUID()` — a fresh UUID generated at module load time. Used for orphan detection: when a server starts, it can identify locks claimed by a previous session (PID-based detection is unreliable in containers).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type naming conflicts with existing shared types**
- **Found during:** Task 1
- **Issue:** The plan specified adding `SkillSource` and `CredentialRequirement` interfaces, but both already exist in types.ts with different field shapes (existing ones are for template declarations, new ones are for extension lifecycle)
- **Fix:** Renamed new types to `ExtensionSkillSource` and `ExtensionCredentialRequirement` to avoid duplicate identifier compilation errors
- **Files modified:** packages/shared/src/types.ts
- **Commit:** 84133ba

**2. [Rule 1 - Bug] SQLite datetime default syntax error**
- **Found during:** Task 2 (migration verification)
- **Issue:** `defaultTo(knex.raw("datetime('now')"))` caused SQLite syntax error "near '(': syntax error" because Knex wraps raw SQL in the DEFAULT clause differently than expected
- **Fix:** Used `timestamp()` columns with `knex.fn.now()` — consistent with all existing CE migrations (001_initial.ts through 035)
- **Files modified:** apps/server/src/db/migrations/036_extension_tables.ts
- **Commit:** f9244a8

## Verification

- [x] `npm run build -w @aquarium/shared` passes — all 13 types compile and export
- [x] `npm run typecheck -w @aquaclawai/aquarium` passes — migration + config compile cleanly
- [x] `ExtensionStatus` confirmed in packages/shared/dist/types.d.ts
- [x] `serverSessionId` confirmed in apps/server/src/config.ts
- [x] Migration ran successfully: instance_plugins, instance_skills, extension_operations tables created in SQLite
- [x] Partial unique index `idx_one_active_op` verified via sqlite_master query

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 84133ba | feat(01-01): add extension lifecycle types to shared package |
| 2 | f9244a8 | feat(01-01): add extension tables migration and serverSessionId to config |

## Self-Check: PASSED
