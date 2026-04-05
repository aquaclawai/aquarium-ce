---
phase: 10-config-lifecycle
plan: 01
subsystem: api
tags: [gateway-rpc, config-patch, merge-patch, concurrency-control, retry-logic]

# Dependency graph
requires:
  - phase: 09-rpc-consolidation
    provides: gatewayCall facade for all gateway RPC (persistent WebSocket)
provides:
  - Gateway-first patchGatewayConfig with retry, rate-limit, and hash read-back
  - Correct { raw, baseHash } merge-patch format for all config.patch calls
  - Extension credential injection via proper config.patch format
affects: [10-config-lifecycle, 11-restart-cycle, 12-extension-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [gateway-first-config-write, stale-hash-retry, rate-limit-delay, authoritative-hash-readback]

key-files:
  created: []
  modified:
    - apps/server/src/services/instance-manager.ts
    - apps/server/src/routes/extension-credentials.ts

key-decisions:
  - "Gateway-first: running instances always consult gateway before DB update; gateway failure propagates (no swallowing)"
  - "config_hash updated from gateway's authoritative hash after every successful config.patch read-back"
  - "Rate limit retry uses parsed retryAfterMs + 1s buffer; stale hash retries up to 3 times"
  - "Stopped instances write DB only with no gateway call attempt (config takes effect on next boot)"

patterns-established:
  - "Gateway-first config write: config.get -> config.patch -> config.get read-back -> DB persist"
  - "Merge-patch format: { raw: JSON.stringify(patchObj), baseHash, note, restartDelayMs: 2000 }"
  - "buildMergePatchFromPath: converts dot-path to nested merge-patch object for extension credentials"

requirements-completed: [CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-07]

# Metrics
duration: 4min
completed: 2026-04-05
---

# Phase 10 Plan 01: Gateway-First Config Patch Summary

**Gateway-first patchGatewayConfig with stale-hash retry, rate-limit delay, and authoritative hash read-back; fixed extension credential injection to use correct { raw, baseHash } merge-patch format**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-05T02:35:52Z
- **Completed:** 2026-04-05T02:40:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Rewrote `patchGatewayConfig` from DB-first to gateway-first for running instances, eliminating silent state divergence
- Implemented stale-hash retry (3x) and rate-limit delay with parsed retryAfterMs
- Fixed broken `{ path, value }` config.patch format in extension-credentials.ts to use correct `{ raw, baseHash }` merge-patch
- All config.patch calls now use `gatewayCall` facade (no more `adapter.translateRPC` in patchGatewayConfig)
- config_hash always updated from gateway's authoritative hash after successful patch

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite patchGatewayConfig to gateway-first flow** - `47a1717` (feat)
2. **Task 2: Fix extension-credentials.ts config.patch format** - `f568295` (fix)

## Files Created/Modified
- `apps/server/src/services/instance-manager.ts` - Gateway-first patchGatewayConfig with retry/rate-limit/hash-readback; imports gatewayCall
- `apps/server/src/routes/extension-credentials.ts` - Fixed config.patch format with buildMergePatchFromPath helper; config.get for baseHash and read-back

## Decisions Made
- Gateway failure in patchGatewayConfig now propagates (throws) instead of being swallowed -- this is the correct semantic under gateway-first
- Read-back after config.patch wrapped in try/catch with fallback to pre-patch hash (gateway may be restarting from SIGUSR1)
- Extension credential injection uses buildMergePatchFromPath to convert dot-paths to nested objects (clean separation of concerns)
- DB column-sync logic (billing_mode, agentName->name) inlined in patchGatewayConfig's DB persist step to avoid double-write through updateInstanceConfig

## Deviations from Plan

None - plan executed exactly as written.

## Deferred Items

- **updateSecurityProfile** (line 412) still uses old `adapter.translateRPC` + `{ patch: {} }` fallback format with `reseedConfigFiles` call. Noted in 10-CONTEXT.md for cleanup in a future plan (likely 10-02 or later call site migration).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gateway-first config write pattern established and proven for patchGatewayConfig and extension-credentials
- updateSecurityProfile and channels.ts still need migration to the same pattern (deferred)
- Plan 10-02 can proceed with remaining config lifecycle work

---
*Phase: 10-config-lifecycle*
*Completed: 2026-04-05*
