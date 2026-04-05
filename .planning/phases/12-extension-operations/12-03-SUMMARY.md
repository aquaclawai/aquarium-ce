---
phase: 12-extension-operations
plan: 03
subsystem: api
tags: [gateway, config-patch, batch-activation, rate-limit, merge-patch, rfc7396]

# Dependency graph
requires:
  - phase: 12-extension-operations
    provides: "config.patch + waitForReconnect pattern from 12-01, merge-patch builders, plugin lifecycle"
provides:
  - buildBatchPluginPatch utility for merging multiple plugin operations into one config.patch
  - activatePluginsBatch service function for batch activation with single rate-limit slot
  - POST /:id/plugins/batch-activate API endpoint
affects: [13-health-integration, frontend-plugin-management]

# Tech tracking
tech-stack:
  added: []
  patterns: [batch config.patch for multi-plugin operations, single SIGUSR1 restart for batch activation]

key-files:
  created: []
  modified:
    - apps/server/src/services/plugin-store.ts
    - apps/server/src/routes/plugins.ts
    - apps/server/src/services/extension-lifecycle.ts

key-decisions:
  - "Single-element batch delegates to existing activatePlugin rather than duplicating logic"
  - "Post-reconnect batch rollback removes only failed plugins (not the entire batch)"
  - "Phase 3 replay left as-is (sequential install+activate) with JSDoc noting batch activation availability"
  - "Batch locks acquired sequentially; any lock failure releases all already-acquired locks"

patterns-established:
  - "Batch config.patch pattern: build merged patch via buildBatchPluginPatch, single patchGatewayConfig, single waitForReconnect"
  - "Batch lock management: acquire all locks upfront, release all in finally block with per-plugin outcome"

requirements-completed: [EXT-03]

# Metrics
duration: 3min
completed: 2026-04-05
---

# Phase 12 Plan 03: Multi-Plugin Batch Activation Summary

**Batch plugin activation merging multiple config changes into a single config.patch call, consuming one rate-limit slot and triggering one SIGUSR1 restart**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-05T04:42:14Z
- **Completed:** 2026-04-05T04:45:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added buildBatchPluginPatch utility that merges additions, removals, and toggles into one RFC 7396 merge-patch object
- Added activatePluginsBatch service function that calls patchGatewayConfig ONCE and waitForReconnect ONCE for all plugins
- Added POST /:id/plugins/batch-activate endpoint with input validation and LockConflictError handling
- Wired activatePluginsBatch import into extension-lifecycle.ts with JSDoc documenting batch availability

## Task Commits

Each task was committed atomically:

1. **Task 1: Add buildBatchPluginPatch and activatePluginsBatch to plugin-store.ts** - `879c7f0` (feat)
2. **Task 2: Add batch-activate route and wire Phase 3 replay to use batch activation** - `ef5b7b4` (feat)

## Files Created/Modified
- `apps/server/src/services/plugin-store.ts` - Added buildBatchPluginPatch (exported, RFC 7396 merge builder) and activatePluginsBatch (exported, batch activation with single config.patch + waitForReconnect)
- `apps/server/src/routes/plugins.ts` - Added POST /:id/plugins/batch-activate endpoint before /:pluginId/activate to prevent parameter capture
- `apps/server/src/services/extension-lifecycle.ts` - Imported activatePluginsBatch, added JSDoc note to replayPendingExtensions

## Decisions Made
- Single-element batches delegate to existing activatePlugin to avoid duplicating the single-plugin activation logic
- Batch rollback only removes failed plugins from config (not the entire batch), preserving successfully activated ones
- Phase 3 replay left unchanged (sequential install+activate) since installPlugin auto-activates when no credentials needed; batch activation documented as available for callers that pre-install separately
- Locks acquired sequentially per plugin; any lock failure triggers release of all already-acquired locks and throws

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Batch activation capability available for frontend multi-plugin install workflows
- Phase 3 replay can be optimized to use batch activation in a future iteration
- Ready for Phase 13 (Health Integration) which depends on complete extension operations

## Self-Check: PASSED

- [x] apps/server/src/services/plugin-store.ts exists
- [x] apps/server/src/routes/plugins.ts exists
- [x] apps/server/src/services/extension-lifecycle.ts exists
- [x] 12-03-SUMMARY.md exists
- [x] Commit 879c7f0 exists
- [x] Commit ef5b7b4 exists

---
*Phase: 12-extension-operations*
*Completed: 2026-04-05*
