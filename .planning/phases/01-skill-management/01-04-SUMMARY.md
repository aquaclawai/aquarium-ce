---
phase: 01-skill-management
plan: "04"
subsystem: infra
tags: [extension-lifecycle, reconciliation, crash-recovery, boot-sequence, gateway-rpc]

# Dependency graph
requires:
  - phase: 01-skill-management plan 02
    provides: extension-lock (cleanupOrphanedOperations), skill-store (getSkillsForInstance, updateSkillStatus)

provides:
  - extension-lifecycle service: recoverOrphanedOperations, reconcileExtensions, getPendingExtensionsForReplay
  - Server startup cleans up orphaned extension operations before any instance starts
  - Post-boot reconciliation syncs DB skill state with gateway reality on each instance start

affects: [01-skill-management, phase-02, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 2 reconciliation: after gateway boots, compare skills.list RPC vs DB and promote/demote"
    - "Non-blocking post-boot calls: reconciliation wrapped in try/catch so failure never blocks instance"
    - "Orphan detection: startup cleanup uses serverSessionId to identify stale operations from crashed sessions"

key-files:
  created:
    - apps/server/src/services/extension-lifecycle.ts
  modified:
    - apps/server/src/server-core.ts
    - apps/server/src/services/instance-manager.ts

key-decisions:
  - "reconcileExtensions integrated into startInstanceAsync (instance-manager.ts) rather than adapter.ts — adapter has no post-boot hook method; instance-manager owns the boot flow"
  - "reconcileExtensions is non-blocking — failure logs a warning but never prevents instance from reaching running state"
  - "Gateway-only skills (builtins not in DB) are skipped silently — per PRD they appear as gatewayBuiltins in GET /skills"
  - "Pending-in-DB + present-in-gateway case: clear pending_owner and promote to active (install completed before crash)"

patterns-established:
  - "All post-boot side-effects in startInstanceAsync use fire-and-forget with warn-on-error pattern"
  - "Reconciliation returns { promoted, demoted, unchanged } arrays for observability"

requirements-completed: [INFRA-08, SKILL-07]

# Metrics
duration: 15min
completed: 2026-04-03
---

# Phase 01 Plan 04: Boot-time Recovery and Post-boot Reconciliation Summary

**Crash-recovery and gateway sync via recoverOrphanedOperations on startup and skills.list reconciliation on instance boot**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-03T17:00:00Z
- **Completed:** 2026-04-03T17:15:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Created `extension-lifecycle.ts` with three exported functions implementing PRD sections 5.4 and 5.6
- `recoverOrphanedOperations` cleans up stale extension locks from crashed server sessions at startup
- `reconcileExtensions` implements Phase 2 reconciliation: compares gateway `skills.list` vs DB and handles all 5 status cases (promote degraded, fail absent-active, promote pending-present, leave pending-absent, skip others)
- Wired both into the server boot sequence with proper ordering: cleanup before instance reconciliation, extension reconciliation after gateway connect

## Task Commits

Each task was committed atomically:

1. **Task 1: Create extension-lifecycle service** - `1c13db7` (feat)
2. **Task 2: Wire lifecycle into server startup and adapter boot flow** - `9fad152` (feat)

## Files Created/Modified
- `apps/server/src/services/extension-lifecycle.ts` - Extension lifecycle service: recoverOrphanedOperations, reconcileExtensions, getPendingExtensionsForReplay
- `apps/server/src/server-core.ts` - Added recoverOrphanedOperations call after migration, before reconcileInstances
- `apps/server/src/services/instance-manager.ts` - Added reconcileExtensions call in startInstanceAsync after gateway connects

## Decisions Made
- **Integration point**: Plan said `adapter.ts`, but the openclaw adapter is a stateless config object with no post-boot lifecycle hook. The correct integration point is `startInstanceAsync` in `instance-manager.ts` — this is where the instance has a running gateway and valid controlEndpoint/authToken. No structural change needed.
- **Pending-owner clearing on promote**: When a pending skill is found in the gateway (crash recovery case), both status and pending_owner are updated inline rather than via updateSkillStatus, to atomically clear both fields in a single DB update.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Integration point] reconcileExtensions placed in instance-manager.ts instead of adapter.ts**
- **Found during:** Task 2 (adapter integration)
- **Issue:** Plan specified `adapter.ts` as the integration point, but the adapter object (`openclawAdapter`) has no post-boot lifecycle hook and is called only for config generation (seedConfig) and RPC translation. There is no function in adapter.ts that runs after the gateway is ready.
- **Fix:** Placed the `reconcileExtensions` call in `startInstanceAsync` in `instance-manager.ts`, right after `connectGateway`. This is the correct location — it has the instance ID, controlEndpoint, and authToken, and runs immediately after the gateway connection is established.
- **Files modified:** apps/server/src/services/instance-manager.ts
- **Verification:** TypeCheck passes, grep confirms reconcileExtensions at correct call site
- **Committed in:** 9fad152 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — wrong file identified in plan, correct location used)
**Impact on plan:** No scope change. Functionality is identical; integration point is the correct one for the boot sequence.

## Issues Encountered
None — TypeScript compilation passed on first attempt for both tasks.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Boot-time recovery (INFRA-08) and reconciliation (SKILL-07) are complete
- Phase 3 (pending replay) has its input function: `getPendingExtensionsForReplay` returns pending skills for retry
- Phase 3 implementation (actually triggering reinstall of pending skills after boot) can proceed independently

---
*Phase: 01-skill-management*
*Completed: 2026-04-03*
