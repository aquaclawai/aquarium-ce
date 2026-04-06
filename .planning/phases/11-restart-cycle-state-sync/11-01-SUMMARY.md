---
phase: 11-restart-cycle-state-sync
plan: 01
subsystem: runtime
tags: [websocket, gateway, reconnect, exponential-backoff, instance-status]

# Dependency graph
requires:
  - phase: 09-rpc-consolidation
    provides: PersistentGatewayClient with queue, gatewayCall facade
  - phase: 10-config-lifecycle
    provides: config.patch triggering SIGUSR1 restart
provides:
  - "'restarting' InstanceStatus across all packages"
  - "Shutdown event detection in PersistentGatewayClient"
  - "Exponential backoff reconnect (1s base, 30s cap)"
  - "60-second restart timeout with error fallback"
  - "Health monitor exclusion for restarting instances"
  - "Frontend restarting badge with spinner and i18n"
affects: [11-02-state-reconciliation, health-monitor, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: ["expectedRestart flag pattern for graceful restart handling", "exponential backoff with cap for WebSocket reconnect"]

key-files:
  created: []
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/services/instance-manager.ts
    - apps/server/src/services/gateway-event-relay.ts
    - apps/server/src/services/health-monitor.ts
    - apps/web/src/index.css
    - apps/web/src/pages/DashboardPage.tsx
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Exported updateStatus from instance-manager.ts for cross-service use (no circular dependency)"
  - "Exponential backoff (1s, 2s, 4s... 30s cap) replaces fixed 5s reconnect delay for all reconnects"
  - "Unlimited retries during expected restart window -- 60s timeout is the hard deadline"
  - "updateStatus passes undefined (not null) for statusMessage to match TypeScript signature"

patterns-established:
  - "expectedRestart flag: set on shutdown event, cleared on reconnect or timeout"
  - "Restart timeout pattern: 60s hard deadline with error fallback"

requirements-completed: [SYNC-01, SYNC-05]

# Metrics
duration: 5min
completed: 2026-04-05
---

# Phase 11 Plan 01: Restart Cycle State Sync Summary

**Gateway shutdown event sets 'restarting' status with exponential backoff reconnect, 60s timeout, health monitor bypass, and localized dashboard spinner**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-05T03:32:35Z
- **Completed:** 2026-04-05T03:37:56Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Added 'restarting' to InstanceStatus union and exported updateStatus for cross-service use
- PersistentGatewayClient detects shutdown event, sets restarting status, reconnects with exponential backoff, and restores running status on success
- 60-second hard timeout transitions to 'error' if gateway fails to come back
- Health monitor skips restarting instances (handled by gateway client timeout)
- reconcileConnections query includes restarting status to preserve WebSocket connections during restart
- Dashboard shows warning-colored spinner badge with localized text in all 6 locales

## Task Commits

Each task was committed atomically:

1. **Task 1: Add "restarting" to InstanceStatus and export updateStatus** - `369c598` (feat)
2. **Task 2: Shutdown event handling, exponential backoff, 60s timeout, health monitor exclusion, and frontend restarting status** - `d66f088` (feat)

## Files Created/Modified
- `packages/shared/src/types.ts` - Added 'restarting' to InstanceStatus union
- `apps/server/src/services/instance-manager.ts` - Exported updateStatus function
- `apps/server/src/services/gateway-event-relay.ts` - Shutdown event detection, expectedRestart flag, exponential backoff, 60s timeout, restart timer cleanup, reconcileConnections query update
- `apps/server/src/services/health-monitor.ts` - Skip restarting instances in checkInstances
- `apps/web/src/index.css` - .status-restarting CSS rule with warning color
- `apps/web/src/pages/DashboardPage.tsx` - Added restarting to spinner condition
- `apps/web/src/i18n/locales/en.json` - common.status.restarting + agents.status.restarting
- `apps/web/src/i18n/locales/zh.json` - common.status.restarting + agents.status.restarting
- `apps/web/src/i18n/locales/fr.json` - common.status.restarting
- `apps/web/src/i18n/locales/de.json` - common.status.restarting
- `apps/web/src/i18n/locales/es.json` - common.status.restarting
- `apps/web/src/i18n/locales/it.json` - common.status.restarting

## Decisions Made
- Exported updateStatus from instance-manager.ts -- safe because gateway-event-relay.ts already imports from instance-manager.ts (no circular dependency)
- Exponential backoff (1s base, 30s cap) replaces the fixed 5s reconnect delay for ALL reconnect scenarios, not just restart
- During expected restart, retries are unlimited -- the 60s timeout acts as the hard deadline instead
- Used `undefined` instead of `null` for statusMessage parameter to match TypeScript `string | undefined` signature

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed null vs undefined for statusMessage parameter**
- **Found during:** Task 2 (connect success handler)
- **Issue:** Plan specified `null` for statusMessage in updateStatus call, but the function signature expects `string | undefined`
- **Fix:** Changed `null` to `undefined` in the updateStatus call
- **Files modified:** apps/server/src/services/gateway-event-relay.ts
- **Verification:** Server typecheck passes clean
- **Committed in:** d66f088 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial type correction. No scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 'restarting' status is fully integrated across backend, frontend, and i18n
- Plan 02 can build on this foundation to add syncGatewayState for full state reconciliation after restart
- The `updateStatus(instanceId, 'running')` call in the connect handler is a placeholder that Plan 02 will replace with syncGatewayState

## Self-Check: PASSED

All 13 files verified present. Both task commits (369c598, d66f088) confirmed in git log.

---
*Phase: 11-restart-cycle-state-sync*
*Completed: 2026-04-05*
