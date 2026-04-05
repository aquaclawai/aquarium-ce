---
phase: 10-config-lifecycle
plan: 02
subsystem: api
tags: [gateway-first, config-patch, merge-patch, security-profile, channel-config, seedConfig]

# Dependency graph
requires:
  - phase: 10-config-lifecycle
    plan: 01
    provides: Gateway-first patchGatewayConfig with retry, rate-limit, and hash read-back
provides:
  - updateSecurityProfile delegates to patchGatewayConfig for running instances
  - Channel configure/disconnect routes use gateway-first patchGatewayConfig flow
  - reseedConfigFiles eliminated from all normal config update paths (boot and recovery only)
affects: [11-restart-cycle, 12-extension-operations, 13-health-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [seedConfig-delta-extraction, channel-config-merge-patch, security-profile-gateway-push]

key-files:
  created: []
  modified:
    - apps/server/src/services/instance-manager.ts
    - apps/server/src/routes/channels.ts

key-decisions:
  - "seedConfig used to extract security-profile-dependent config delta (hooks, cron, models, approval) rather than sending empty merge-patch"
  - "pushChannelConfigToGateway extracts channel + plugin entries from seedConfig output as targeted merge-patch"
  - "seedConfig failures fall back to empty delta (still triggers SIGUSR1 restart via patchGatewayConfig)"
  - "Gateway push errors are logged but do not block DB credential/profile updates"

patterns-established:
  - "seedConfig delta extraction: call seedConfig, parse openclaw.json, extract relevant sections, send as merge-patch"
  - "Channel config gateway-first: pushChannelConfigToGateway(instance, channel, userId) replaces reseedAndPatch"

requirements-completed: [CFG-01, CFG-06]

# Metrics
duration: 3min
completed: 2026-04-05
---

# Phase 10 Plan 02: Remaining Call-Site Migration Summary

**Migrated updateSecurityProfile and channel configure/disconnect routes from reseedConfigFiles to gateway-first patchGatewayConfig with seedConfig delta extraction**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-05T02:43:50Z
- **Completed:** 2026-04-05T02:47:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Converted `updateSecurityProfile` to extract security-profile-dependent config delta (hooks, cron, models, approval) via `seedConfig` and push through `patchGatewayConfig`
- Replaced `reseedAndPatch` function and all 4 call sites in channels.ts with `pushChannelConfigToGateway` using seedConfig-based channel delta extraction
- Eliminated `reseedConfigFiles` from all normal config update paths -- now only used for boot and health-monitor recovery
- Removed all broken `{ patch: {} }` format usage and direct `adapter.translateRPC` calls from config update paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert updateSecurityProfile to use patchGatewayConfig** - `d8d31d0` (feat)
2. **Task 2: Replace reseedAndPatch in channels.ts with patchGatewayConfig** - `1bed0ce` (feat)

## Files Created/Modified
- `apps/server/src/services/instance-manager.ts` - updateSecurityProfile now uses seedConfig delta + patchGatewayConfig instead of reseedConfigFiles + adapter.translateRPC
- `apps/server/src/routes/channels.ts` - Deleted reseedAndPatch, added pushChannelConfigToGateway, replaced all 4 call sites

## Decisions Made
- Used seedConfig to extract security-profile-dependent keys rather than sending an empty merge-patch (avoids wasting a rate-limit slot for nothing)
- Channel delta extraction includes both `channels.[id]` and `plugins.entries.[id]` to ensure both config sections are updated atomically
- seedConfig failures fall back to empty delta rather than throwing -- credentials/profile are already persisted in DB, gateway will pick them up on next restart
- Gateway push errors are non-blocking -- DB changes succeed even if gateway is temporarily unavailable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All config update paths now use gateway-first flow via patchGatewayConfig
- reseedConfigFiles is exclusively used for boot (startInstanceAsync) and recovery (health-monitor)
- No broken config.patch formats remain in the codebase
- Phase 10 (Config Lifecycle) is complete -- ready for Phase 11 (Restart Cycle & State Sync)

## Self-Check: PASSED

- [x] 10-02-SUMMARY.md exists
- [x] Commit d8d31d0 (Task 1) exists
- [x] Commit 1bed0ce (Task 2) exists
- [x] instance-manager.ts exists
- [x] channels.ts exists

---
*Phase: 10-config-lifecycle*
*Completed: 2026-04-05*
