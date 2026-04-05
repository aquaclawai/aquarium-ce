---
phase: 12-extension-operations
plan: 02
subsystem: api
tags: [gateway-rpc, config-patch, skills, patchGatewayConfig]

# Dependency graph
requires:
  - phase: 10-config-lifecycle
    provides: patchGatewayConfig gateway-first config write function
provides:
  - Skill enable/disable using gateway-first config.patch pattern
  - skills.status RPC verification after skill toggle
affects: [13-health-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [gateway-first skill toggle via config.patch, skills.status RPC verification]

key-files:
  created: []
  modified:
    - apps/server/src/services/skill-store.ts
    - apps/server/src/routes/skills.ts

key-decisions:
  - "Skills use config.patch without waitForReconnect -- dynamically loaded, no SIGUSR1 restart"
  - "skills.status verification is non-fatal -- config.patch is authoritative, verification is advisory"

patterns-established:
  - "Skill toggle patch: buildSkillTogglePatch produces skills.entries merge-patch (no load.paths needed unlike plugins)"
  - "Advisory verification: skills.status RPC after config.patch warns on mismatch but does not throw"

requirements-completed: [EXT-06]

# Metrics
duration: 4min
completed: 2026-04-05
---

# Phase 12 Plan 02: Skill Enable/Disable Gateway-First Summary

**Skill enable/disable refactored to use patchGatewayConfig with skills.status RPC verification, maintaining gateway-first authority model across all extension operations**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-05T04:17:31Z
- **Completed:** 2026-04-05T04:21:19Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Replaced direct skills.update RPC with gateway-first config.patch pattern in enableSkill and disableSkill
- Added buildSkillTogglePatch helper for clean skill config merge-patches (skills.entries only, no load.paths)
- Added skills.status RPC verification after each config.patch as advisory check
- Updated function signatures and route handlers to pass userId for patchGatewayConfig
- Confirmed no waitForReconnect needed (skills are dynamically loaded, no SIGUSR1 restart)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor skill enable/disable to use patchGatewayConfig** - `b4ae354` (feat)

## Files Created/Modified
- `apps/server/src/services/skill-store.ts` - Replaced skills.update RPC with patchGatewayConfig + skills.status verification in enableSkill/disableSkill; added buildSkillTogglePatch helper; added userId parameter
- `apps/server/src/routes/skills.ts` - Updated PUT /:id/skills/:skillId handler to pass req.auth!.userId to enableSkill/disableSkill

## Decisions Made
- Skills use config.patch without waitForReconnect because skills are dynamically loaded (reload plan = 'none') and no SIGUSR1 restart occurs. This is different from plugins which always trigger SIGUSR1.
- skills.status verification after config.patch is advisory (non-fatal) -- if the gateway reports unexpected state, a warning is logged but no error is thrown. The config.patch is authoritative.
- Verification timeout is 15 seconds (vs 30 seconds for plugin operations) since no restart/reconnect cycle is involved.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing typecheck errors in plugin-store.ts (from incomplete 12-01 execution) were detected but are out of scope for this plan. The skill-store.ts and routes/skills.ts changes typecheck cleanly with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All extension operations (plugins and skills) now use the gateway-first config.patch pattern consistently
- Ready for Phase 13 (Health Integration) which depends on extension operations being gateway-first
- Pre-existing plugin-store.ts incomplete refactor from 12-01 needs to be resolved separately

## Self-Check: PASSED

- [x] apps/server/src/services/skill-store.ts exists
- [x] apps/server/src/routes/skills.ts exists
- [x] 12-02-SUMMARY.md exists
- [x] Commit b4ae354 exists

---
*Phase: 12-extension-operations*
*Completed: 2026-04-05*
