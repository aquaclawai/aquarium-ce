---
phase: 14-plugin-cleanup
plan: 01
subsystem: api
tags: [fetch, http, marketplace, clawhub, catalog]

# Dependency graph
requires:
  - phase: 12-extension-operations
    provides: marketplace-client.ts gateway RPC calls (searchClawHub, getClawHubExtensionInfo)
provides:
  - Direct HTTP marketplace client with BUILTIN_REGISTRY fallback
  - clawHubApiUrl config field
  - Gateway-independent catalog browsing
affects: [14-plugin-cleanup plan 02 (clawhub RPC method removal from plugin)]

# Tech tracking
tech-stack:
  added: []
  patterns: [direct-http-with-builtin-fallback for marketplace catalog]

key-files:
  created: []
  modified:
    - apps/server/src/services/marketplace-client.ts
    - apps/server/src/config.ts
    - apps/server/src/routes/plugins.ts
    - apps/server/src/routes/skills.ts

key-decisions:
  - "BUILTIN_REGISTRY moved from openclaw plugin into marketplace-client.ts (platform owns fallback catalog)"
  - "fetchClawHub uses config.clawHubApiUrl (not process.env directly) per project conventions"
  - "Removed controlEndpoint guard from plugin install trust check -- direct HTTP needs no running gateway"

patterns-established:
  - "Direct HTTP + in-memory fallback: try remote API first, fall back to built-in registry on any failure"

requirements-completed: [CLEAN-01, CLEAN-02]

# Metrics
duration: 3min
completed: 2026-04-05
---

# Phase 14 Plan 01: Direct HTTP Marketplace Client Summary

**Replaced gateway RPC transport in marketplace-client.ts with direct HTTP fetch to ClawHub API, with BUILTIN_REGISTRY fallback for offline/unreachable scenarios**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-05T05:40:14Z
- **Completed:** 2026-04-05T05:43:14Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Eliminated all gateway-rpc imports from marketplace-client.ts -- zero dependency on gateway for catalog browsing
- Moved BUILTIN_REGISTRY (11 entries) from openclaw plugin into platform service for direct fallback
- Updated all 6 route call sites (3 plugins, 3 skills) to new signatures without instanceId parameter
- Added clawHubApiUrl config field with AbortSignal.timeout(15s) for resilient HTTP calls

## Task Commits

Each task was committed atomically:

1. **Task 1: Add clawHubApiUrl config and rewrite marketplace-client.ts** - `08e6a0f` (feat)
2. **Task 2: Update route call sites to new marketplace-client signatures** - `0823fe4` (feat)

## Files Created/Modified
- `apps/server/src/config.ts` - Added clawHubApiUrl field
- `apps/server/src/services/marketplace-client.ts` - Complete rewrite: removed gateway-rpc, added fetchClawHub helper, BUILTIN_REGISTRY, new function signatures
- `apps/server/src/routes/plugins.ts` - Removed instanceId from 3 call sites, removed controlEndpoint guard
- `apps/server/src/routes/skills.ts` - Removed instanceId from 3 call sites

## Decisions Made
- BUILTIN_REGISTRY moved from openclaw plugin into marketplace-client.ts so the platform owns the fallback catalog directly
- fetchClawHub uses `config.clawHubApiUrl` (not `process.env` directly) per project conventions
- Removed the `if (instance.controlEndpoint)` guard around the plugin install trust check since ClawHub info is now a direct HTTP call that does not require a running gateway
- Kept parseClawHubEntry unchanged -- validates remote API responses defensively (T-14-01 mitigation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. The `CLAWHUB_API_URL` env var is optional (empty default triggers fallback to built-in registry).

## Next Phase Readiness
- marketplace-client.ts has zero gateway-rpc dependencies, enabling Plan 02 to safely remove `clawhub.search` and `clawhub.info` from the openclaw plugin
- All typecheck and verification criteria pass

## Self-Check: PASSED

- All 4 modified files exist on disk
- Both task commits verified: 08e6a0f, 0823fe4

---
*Phase: 14-plugin-cleanup*
*Completed: 2026-04-05*
