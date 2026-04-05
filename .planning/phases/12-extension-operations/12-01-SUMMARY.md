---
phase: 12-extension-operations
plan: 01
subsystem: api
tags: [gateway, config-patch, plugin-lifecycle, websocket, merge-patch, rfc7396]

# Dependency graph
requires:
  - phase: 10-config-lifecycle
    provides: patchGatewayConfig function for gateway-first config writes
  - phase: 11-restart-cycle
    provides: syncGatewayState with reconcileExtensions on every reconnect
provides:
  - waitForReconnect mechanism in gateway-event-relay for coordinating with gateway restart cycles
  - Plugin lifecycle via config.patch instead of restartInstance (container stays alive)
  - Merge-patch builders for plugin add/remove/toggle operations
  - Single-attempt rollback on activation failure via config.patch
affects: [13-health-integration, extension-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [config.patch-then-waitForReconnect for plugin lifecycle, RFC 7396 null-key deletion for plugin removal]

key-files:
  created: []
  modified:
    - apps/server/src/services/gateway-event-relay.ts
    - apps/server/src/services/plugin-store.ts

key-decisions:
  - "waitForReconnect resolves after syncGatewayState completes (both success and error paths) to ensure reconcileExtensions has updated DB status"
  - "notifyReconnectWaiter is module-internal (not exported) -- only PersistentGatewayClient calls it"
  - "Plugin toggle (enable/disable) keeps load.paths unchanged -- enabled flag controls loading, artifact stays on disk"
  - "Single rollback attempt on activation failure -- no recursive retry to avoid rate limit exhaustion"

patterns-established:
  - "config.patch + waitForReconnect pattern: send config.patch, await reconnect cycle, verify DB status post-reconciliation"
  - "Merge-patch builders co-located with consumer (plugin-store.ts) -- not shared utilities"

requirements-completed: [EXT-01, EXT-02, EXT-03, EXT-04, EXT-05]

# Metrics
duration: 5min
completed: 2026-04-05
---

# Phase 12 Plan 01: Extension Operations Summary

**Plugin lifecycle via config.patch + waitForReconnect -- container stays alive, chat sessions survive plugin operations**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-05T04:17:19Z
- **Completed:** 2026-04-05T04:21:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added waitForReconnect infrastructure to gateway-event-relay.ts for coordinating with gateway SIGUSR1 restart cycles
- Replaced all 4 restartInstance calls in plugin-store.ts with patchGatewayConfig + waitForReconnect
- Added merge-patch builders (add/remove/toggle) with RFC 7396 semantics for plugin config operations
- Activation failure triggers single rollback config.patch instead of full container restart

## Task Commits

Each task was committed atomically:

1. **Task 1: Add waitForReconnect infrastructure and plugin merge-patch builders** - `5f528f7` (feat)
2. **Task 2: Refactor plugin-store.ts to use config.patch instead of restartInstance** - `bfae368` (feat)

## Files Created/Modified
- `apps/server/src/services/gateway-event-relay.ts` - Added waitForReconnect export, notifyReconnectWaiter internal function, wired into PersistentGatewayClient reconnect handler, cleanup in close()
- `apps/server/src/services/plugin-store.ts` - Replaced restartInstance with patchGatewayConfig + waitForReconnect in all 4 plugin lifecycle functions, added merge-patch builders and getCurrentLoadPaths helper

## Decisions Made
- waitForReconnect resolves after syncGatewayState completes (including reconcileExtensions) so callers can verify DB status post-reconciliation
- notifyReconnectWaiter kept module-internal -- only PersistentGatewayClient reconnect handler calls it
- Plugin toggle keeps load.paths array unchanged -- enabled flag controls loading while artifact stays on disk
- Single rollback attempt on activation failure to avoid rate limit exhaustion (3 writes per 60s)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- waitForReconnect mechanism available for any future service needing to coordinate with gateway restart cycles
- Plugin lifecycle fully gateway-first -- ready for Phase 12 Plan 02 (skill operations) and Phase 13 (health integration)
- Rate limit awareness built into the pattern (single rollback attempt, not recursive)

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 12-extension-operations*
*Completed: 2026-04-05*
