---
phase: 02-plugin-management
plan: "01"
subsystem: backend-services
tags: [plugin-lifecycle, extension-management, seed-config, reconciliation]
dependency_graph:
  requires:
    - "01-skill-management (extension-lock.ts, skill-store.ts patterns)"
    - "036_extension_tables migration (instance_plugins table)"
  provides:
    - "apps/server/src/services/plugin-store.ts — Plugin lifecycle CRUD with restart and rollback"
    - "Managed plugins in seedConfig (adapter.ts)"
    - "Plugin reconciliation in extension-lifecycle.ts"
  affects:
    - "apps/server/src/agent-types/openclaw/adapter.ts — seedConfig now queries instance_plugins"
    - "apps/server/src/services/extension-lifecycle.ts — reconciles both skills and plugins"
tech_stack:
  added: []
  patterns:
    - "DB-first activation: update status to active in DB, then restartInstance (seedConfig reads from DB)"
    - "Rollback on health failure: mark failed, restart again (seedConfig now excludes the plugin)"
    - "acquireLock/releaseLock in try/finally for all mutations (fenced lock pattern)"
    - "checkCancelRequested before restart operations (long-running)"
key_files:
  created:
    - apps/server/src/services/plugin-store.ts
  modified:
    - apps/server/src/agent-types/openclaw/adapter.ts
    - apps/server/src/services/extension-lifecycle.ts
decisions:
  - "DB-first activation pattern: update status to active before restartInstance so seedConfig picks it up without config.patch RPC — avoids dual write surface"
  - "loadPaths built dynamically: platform-bridge always included, npm-installed plugins append /home/node/.openclaw/plugins/<pluginId>"
  - "plugins.list RPC failure is soft (logged warning) — older gateway versions may not support it"
  - "PLUG-06 artifact verify: proactively reinstall from lockedVersion when lockedVersion is set and instance has a controlEndpoint"
  - "InstancePlugin type imported from @aquarium/shared (not redeclared) — parallel to InstanceSkill pattern"
metrics:
  duration_seconds: 250
  completed_date: "2026-04-03"
  tasks_completed: 2
  files_modified: 3
---

# Phase 02 Plan 01: Plugin Backend Service Layer Summary

Plugin lifecycle CRUD (install via npm RPC, activate with restart+rollback, enable/disable/uninstall via DB+restart), managed plugins in seedConfig from DB, and plugin reconciliation alongside skills on gateway boot.

## Tasks Completed

### Task 1: Create plugin-store.ts service with full plugin lifecycle

Created `apps/server/src/services/plugin-store.ts` with 8 exported functions following the exact pattern of `skill-store.ts`.

Key implementation decisions:
- **DB-first activation**: Status updated to `active` in DB before `restartInstance` so `seedConfig` reads the change and includes the plugin without needing a `config.patch` RPC. This avoids a dual write surface.
- **PLUG-07 rollback**: On `platform.ping` health check failure after restart, marks plugin `failed` and calls `restartInstance` again so the gateway boots without the broken plugin.
- **PLUG-06 artifact verify**: When `lockedVersion` is set, proactively calls `plugins.install` with the locked version before activation to ensure the artifact is present (handles container rebuilds).
- **PLUG-03 auto-activate**: When `plugins.install` RPC returns no `requiredCredentials`, calls `_activatePluginWithLock` within the same lock hold to transition directly to `active` without a second lock acquisition.
- Lock is always released in `finally` blocks; `releaseLock` on the rollback path is handled inside `_activatePluginWithLock`, so the outer `activatePlugin` does a best-effort release that no-ops if already released.

### Task 2: Extend seedConfig for managed plugins + reconciliation + PLUG-10

**adapter.ts changes:**
- Added `db` and `getAdapter` imports (from `../../db/index.js` and `../../db/adapter.js`)
- Added `PluginSource` type import from `@aquarium/shared`
- Queries `instance_plugins` WHERE `status IN ('active', 'degraded')` AND `enabled=1` after channel-based `pluginEntries` population
- Builds `loadPaths` dynamically: always includes `platform-bridge`, appends `/home/node/.openclaw/plugins/<pluginId>` for non-bundled managed plugins
- PLUG-10: Adds `plugins: false` to `cfg.commands` after plugins section, preventing chat-based plugin management (single-writer pattern per PRD section 5.7)
- Updated fallback `load.paths` restoration after security deep-merge to use dynamic `loadPaths` (preserves managed plugin paths)

**extension-lifecycle.ts changes:**
- Added imports: `getPluginsForInstance`, `updatePluginStatus` from `plugin-store.js`; `InstancePlugin` from `@aquarium/shared`
- Added `GatewayPluginInfo` and `PluginsListResult` RPC response types with `isPluginsListResult` type guard
- Extended `reconcileExtensions` to call `plugins.list` RPC and apply same 6-rule reconciliation logic as skills:
  - `active` in DB + present in gateway: confirmed healthy (unchanged)
  - `degraded` + present: promote to `active`
  - `active` + absent: mark `failed`
  - `degraded` + absent: mark `failed`
  - `pending` + present: promote to `active`, clear `pending_owner`
  - `pending` + absent: leave for Phase 3 replay
  - `installed/disabled/failed`: no change
- `plugins.list` failures are soft-logged (gateway versions pre-Phase 2 may not implement this RPC)
- Extended `recoverOrphanedOperations` to count orphaned pending plugins alongside skills

## Verification

```
TypeScript: PASS (0 errors)
Exported functions: 8 (getPluginsForInstance, getPluginById, installPlugin, activatePlugin,
  enablePlugin, disablePlugin, uninstallPlugin, updatePluginStatus)
instance_plugins in adapter.ts: YES (1+ references)
commands.plugins=false: YES
plugins.list in extension-lifecycle.ts: YES
```

## Deviations from Plan

### Auto-fixed Issues

None.

### Clarifications

**1. installPlugin RPC when no controlEndpoint**: If the instance has no `controlEndpoint` (not yet running), `plugins.install` RPC is skipped. The plugin row is still inserted as `pending`. This handles the edge case where install is called before the instance is up — the artifact won't be staged but the DB row tracks intent for reconciliation.

**2. PLUG-06 proactive reinstall**: The plan specifies "if artifact is missing, reinstall". Since we cannot directly check artifact presence without an RPC, we reinstall proactively whenever `lockedVersion` is set. This is conservative but correct — `plugins.install` with the same version is idempotent.

**3. `InstancePlugin` import unused warning**: `InstancePlugin` was imported in `extension-lifecycle.ts` but TypeScript compiled cleanly (it is used implicitly via `getPluginsForInstance` return type). No action needed.

## Self-Check: PASSED

All created files verified on disk. Both task commits verified in git log (a35eec5, 3c17a75). TypeScript compiles with zero errors.
