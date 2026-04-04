---
phase: 03-clawhub-trust-policy
plan: 03
subsystem: api
tags: [express, trust-policy, clawhub, marketplace, typescript]

# Dependency graph
requires:
  - phase: 03-clawhub-trust-policy plan 01
    provides: trust-store service with evaluateTrustPolicy, createTrustOverride, computeTrustTier
  - phase: 03-clawhub-trust-policy plan 02
    provides: marketplace-client service with searchClawHub, getClawHubExtensionInfo

provides:
  - PUT /:id/plugins/:pluginId/trust-override and PUT /:id/skills/:skillId/trust-override endpoints
  - Server-side trust enforcement on POST /plugins/install and /skills/install (403 on block)
  - Catalog endpoints (GET /catalog) merging bundled + ClawHub results with per-entry trust evaluation
  - Upgrade endpoints (PUT /plugins/:id/upgrade and /skills/:id/upgrade) with dryRun support

affects: [frontend trust UI, catalog browsing, install flow, upgrade workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Trust enforcement at route layer: evaluate before calling service install"
    - "Catalog merging: bundled wins on id conflict, ClawHub results appended"
    - "dryRun pattern: return version comparison object without mutating state"
    - "Upgrade acquires extension-lock, calls RPC, updates DB, releases lock"

key-files:
  created:
    - apps/server/src/routes/trust-overrides.ts
  modified:
    - apps/server/src/server-core.ts
    - apps/server/src/routes/plugins.ts
    - apps/server/src/routes/skills.ts
    - packages/shared/src/types.ts

key-decisions:
  - "trustDecision and blockReason added to PluginCatalogEntry and SkillCatalogEntry shared types — required for frontend trust UI"
  - "Plugin upgrade triggers re-activation (restart) when status was active; skill upgrade does not (no restart needed)"
  - "releaseLock uses 'success' result for upgrade completion"
  - "Catalog filter logic: ClawHub entries already filtered by query params; bundled entries filtered locally"
  - "blockReason undefined (not null) in catalog entries to match optional field type in shared types"

patterns-established:
  - "Trust gate pattern: if source.type !== bundled, fetch ClawHub info -> evaluateTrustPolicy -> 403 on block"
  - "Upgrade dryRun: check dryRun === true before acquiring lock, return version diff only"

requirements-completed: [TRUST-01, TRUST-02, TRUST-03, TRUST-04, TRUST-07]

# Metrics
duration: 15min
completed: 2026-04-04
---

# Phase 03 Plan 03: Trust API Routes Summary

**Trust-override endpoints, install guards (403 on block), ClawHub catalog merging with per-entry trust evaluation, and upgrade endpoints with dryRun support**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-04T03:52:00Z
- **Completed:** 2026-04-04T04:07:06Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created trust-override route (PUT) for plugins and skills with mandatory credentialAccessAcknowledged=true check
- Extended install endpoints with server-side trust guard: non-bundled installs blocked (403) if trust policy evaluates to 'block'
- Extended catalog endpoints to merge bundled gateway results + ClawHub results, each ClawHub entry annotated with trustTier, trustDecision, blockReason via evaluateTrustPolicy
- Added upgrade endpoints for plugins and skills with dryRun support — dryRun=true returns version comparison, dryRun=false performs RPC install + DB update

## Task Commits

1. **Task 1: Trust-override routes and server-core mounting** - `6d0c43f` (feat)
2. **Task 2: Trust enforcement, catalog merging, upgrade endpoints** - `ba177d5` (feat)

**Plan metadata:** (final docs commit — pending)

## Files Created/Modified
- `apps/server/src/routes/trust-overrides.ts` - PUT /:id/plugins/:pluginId/trust-override and PUT /:id/skills/:skillId/trust-override
- `apps/server/src/server-core.ts` - Mounts trustOverrideRoutes after extensionCredentialRoutes
- `apps/server/src/routes/plugins.ts` - Trust enforcement on install, ClawHub catalog merging, upgrade with dryRun
- `apps/server/src/routes/skills.ts` - Trust enforcement on install, ClawHub catalog merging, upgrade with dryRun
- `packages/shared/src/types.ts` - Added trustDecision and blockReason optional fields to PluginCatalogEntry and SkillCatalogEntry

## Decisions Made
- `trustDecision` and `blockReason` added as optional fields to shared catalog entry types — required to surface trust status to frontend without breaking existing callers
- Plugin upgrade triggers re-activation (restart) when the plugin was active; skill upgrade does not require restart
- `releaseLock` called with `'success'` result for successful upgrade completion
- `blockReason` typed as `string | undefined` (not null) to match the optional field definition in shared types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added trustDecision and blockReason to shared catalog entry types**
- **Found during:** Task 2 (catalog merging with evaluateTrustPolicy)
- **Issue:** PluginCatalogEntry and SkillCatalogEntry lacked trustDecision and blockReason fields, which the plan required on catalog entries
- **Fix:** Added `trustDecision?: TrustDecision` and `blockReason?: string` to both types in packages/shared/src/types.ts
- **Files modified:** packages/shared/src/types.ts
- **Verification:** Typecheck passes
- **Committed in:** ba177d5 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed releaseLock result value from 'completed' to 'success'**
- **Found during:** Task 2 (upgrade endpoints)
- **Issue:** TypeScript type for releaseLock result is `'success' | 'failed' | 'rolled-back' | 'cancelled' | 'crashed'` — 'completed' is not valid
- **Fix:** Changed to 'success' for both plugin and skill upgrade completion
- **Files modified:** apps/server/src/routes/plugins.ts, apps/server/src/routes/skills.ts
- **Verification:** Typecheck passes
- **Committed in:** ba177d5 (Task 2 commit)

**3. [Rule 1 - Bug] Fixed blockReason type: null vs undefined**
- **Found during:** Task 2 (catalog bundled entry creation)
- **Issue:** Shared type defines blockReason as `string | undefined` (optional field) but code set it to null
- **Fix:** Changed `blockReason: null` to `blockReason: undefined` for bundled entries
- **Files modified:** apps/server/src/routes/plugins.ts, apps/server/src/routes/skills.ts
- **Verification:** Typecheck passes
- **Committed in:** ba177d5 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical field in shared types, 2 type bugs found during typecheck)
**Impact on plan:** All fixes necessary for type correctness. No scope creep.

## Issues Encountered
None beyond the type errors resolved as deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Trust API backend layer complete (TRUST-01 through TRUST-04, TRUST-07)
- Frontend trust UI can now consume: PUT trust-override, GET catalog with trust fields, POST install (403 enforcement), PUT upgrade with dryRun
- Ready for Phase 03-04 (frontend trust enforcement and upgrade UI)

---
*Phase: 03-clawhub-trust-policy*
*Completed: 2026-04-04*
