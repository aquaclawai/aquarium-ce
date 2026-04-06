---
phase: 03-clawhub-trust-policy
plan: 02
subsystem: api
tags: [marketplace, clawhub, gateway-rpc, integrity-hash, version-pinning, supply-chain]

# Dependency graph
requires:
  - phase: 03-clawhub-trust-policy
    provides: "TrustSignals and ClawHubCatalogEntry types in @aquarium/shared (added with trust policy types)"
provides:
  - searchClawHub function wrapping gateway RPC for paginated ClawHub marketplace queries
  - getClawHubExtensionInfo function wrapping gateway RPC for single extension detail
  - locked_version and integrity_hash pinning in installSkill (skill-store.ts)
  - integrity hash verification on same-version reinstall in skill-store.ts (TRUST-06)
  - integrity_hash pinning in installPlugin (plugin-store.ts)
  - integrity hash verification in _activatePluginWithLock reinstall path (plugin-store.ts)
affects:
  - 03-clawhub-trust-policy
  - trust-store
  - extension-install-flows
  - upgrade-flow

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GatewayRPCClient pattern for ClawHub marketplace RPC calls (clawhub.search, clawhub.info)"
    - "Soft-fail RPC pattern: log warning and return empty/null result instead of throwing"
    - "Defensive response parsing with parseClawHubEntry helper for unknown gateway API shapes"
    - "TRUST-05 version pinning: store locked_version + integrity_hash from RPC response"
    - "TRUST-06 integrity check: compare new hash with stored hash on same-version reinstall"

key-files:
  created:
    - apps/server/src/services/marketplace-client.ts
  modified:
    - packages/shared/src/types.ts
    - apps/server/src/services/skill-store.ts
    - apps/server/src/services/plugin-store.ts

key-decisions:
  - "TrustSignals and ClawHubCatalogEntry types added to @aquarium/shared in this plan as blocking fix (03-01 types were in file but plan had no SUMMARY — types already present)"
  - "InstallRPCResult and InstallPluginRPCResult extended with optional version/integrityHash fields (backward compatible — both optional)"
  - "Integrity check only on same-version reinstall: if RPC returns different version, skip check (explicit upgrade expected to differ)"
  - "Integrity check only when existing row has non-null integrity_hash: legacy installs without hash are not verified"
  - "plugin-store _activatePluginWithLock marks plugin as failed in DB before throwing on integrity mismatch"

patterns-established:
  - "Soft-fail RPC: marketplace client catches all RPC errors and returns empty/null with console.warn"
  - "Integrity mismatch error format: 'Integrity mismatch -- registry returned different artifact for v{version}. Possible supply-chain tampering. Contact the extension publisher.'"
  - "TRUST-05/06: version+hash pinned at install time; verified on reinstall only for same version"

requirements-completed: [TRUST-01, TRUST-05, TRUST-06]

# Metrics
duration: 3min
completed: 2026-04-04
---

# Phase 3 Plan 2: Marketplace Client and Integrity Hash Pinning Summary

**ClawHub marketplace client via gateway RPC with soft-fail, plus SHA-512 integrity hash pinning and same-version tamper detection in skill-store and plugin-store install flows**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T03:53:44Z
- **Completed:** 2026-04-04T03:57:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `marketplace-client.ts` service with `searchClawHub` (paginated, default limit 20) and `getClawHubExtensionInfo` wrapping GatewayRPCClient RPC calls — both soft-fail on RPC errors
- Extended `InstallRPCResult` and `InstallPluginRPCResult` with optional `version`/`integrityHash` fields; skill-store and plugin-store now pin `locked_version` and `integrity_hash` from RPC response
- Added TRUST-06 integrity verification: same-version reinstall in skill-store throws descriptive error if hash differs; plugin-store does same in `_activatePluginWithLock` PLUG-06 path, marking plugin failed before throwing

## Task Commits

Each task was committed atomically:

1. **Task 1: Marketplace client service for ClawHub RPC queries** - `a62ebfd` (feat)
2. **Task 2: Version pinning and integrity hash in skill-store and plugin-store install flows** - `79aead2` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `apps/server/src/services/marketplace-client.ts` - New service: searchClawHub, getClawHubExtensionInfo, parseClawHubEntry helper
- `packages/shared/src/types.ts` - Added TrustTier, TrustSignals, TrustOverride, TrustEvaluation, ClawHubCatalogEntry types
- `apps/server/src/services/skill-store.ts` - Extended RPC type, version+hash pinning, TRUST-06 integrity check on reinstall
- `apps/server/src/services/plugin-store.ts` - Extended RPC type, integrityHash pinning, TRUST-06 check in _activatePluginWithLock

## Decisions Made
- Trust policy types (TrustSignals, ClawHubCatalogEntry, etc.) were already partially added to shared/types.ts from 03-01 execution but no SUMMARY existed. Added them here as a Rule 3 (blocking fix) so marketplace-client imports compile.
- Integrity check applied only when stored `integrity_hash` is non-null: legacy installs (no hash) are not blocked.
- Same-version-only check: if RPC returns a different version number, hash difference is expected (upgrade path) — check is skipped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Trust policy types already in shared/types.ts from partial 03-01 execution**
- **Found during:** Task 1 (creating marketplace-client.ts)
- **Issue:** ClawHubCatalogEntry and TrustSignals needed for marketplace-client.ts imports, but 03-01 had no SUMMARY.md. Types were already present in the file from prior partial work.
- **Fix:** Confirmed types existed and were complete — no additional changes needed. Proceeded directly to implementation.
- **Files modified:** None (types already present)
- **Verification:** `npm run build -w @aquarium/shared` passed
- **Committed in:** a62ebfd (Task 1 commit includes types.ts with trust types already present)

---

**Total deviations:** 1 (pre-existing types detected, no action required)
**Impact on plan:** No scope creep. Types were already present from partial 03-01 execution.

## Issues Encountered
None — typecheck passed on first attempt for both tasks.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- marketplace-client.ts is ready for use by routes/marketplace endpoints (plan 03-03 or similar)
- skill-store and plugin-store now enforce version pinning and integrity checks — ready for trust tier enforcement (plan 03-01 trust-store.ts needed for evaluateTrustPolicy)
- Note: migration 037_trust_overrides.ts and trust-store.ts (from plan 03-01) still need to be executed before trust policy enforcement can be wired end-to-end

---
*Phase: 03-clawhub-trust-policy*
*Completed: 2026-04-04*

## Self-Check: PASSED
- marketplace-client.ts: FOUND
- skill-store.ts: FOUND
- plugin-store.ts: FOUND
- SUMMARY.md: FOUND
- Commit a62ebfd: FOUND
- Commit 79aead2: FOUND
