---
phase: 03-clawhub-trust-policy
plan: "06"
subsystem: ui
tags: [react, trust, extensions, skills, catalog]

# Dependency graph
requires:
  - phase: 03-clawhub-trust-policy
    provides: trustTier, trustSignals, trustDecision, blockReason fields on SkillCatalogEntry from server

provides:
  - CatalogSkillRow forwards all 5 trust props (trustTier, trustSignals, blocked, blockReason, onRequestOverride) to CatalogExtensionRow
  - ExtensionsTab passes trust props from SkillCatalogEntry into skill catalog loop

affects:
  - 03-clawhub-trust-policy
  - extensions-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Trust prop forwarding: SkillCatalogEntry -> CatalogSkillRow -> CatalogExtensionRow matches plugin catalog pattern"

key-files:
  created: []
  modified:
    - apps/web/src/components/extensions/CatalogSkillRow.tsx
    - apps/web/src/components/extensions/ExtensionsTab.tsx

key-decisions:
  - "No new handler needed for skill override: handleRequestOverride already supports kind='skill' and searches availableCatalog"

patterns-established:
  - "CatalogSkillRow is a thin forwarding wrapper — all trust display logic lives in CatalogExtensionRow"

requirements-completed: [TRUST-01, TRUST-02, TRUST-03]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 03 Plan 06: CatalogSkillRow Trust Prop Forwarding Summary

**Trust badges, blocked state, and override link now wired from SkillCatalogEntry through CatalogSkillRow into CatalogExtensionRow — skill catalog rows render identically to plugin catalog rows**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-03T04:20:00Z
- **Completed:** 2026-04-03T04:23:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added TrustTier, TrustSignals, blocked, blockReason, onRequestOverride to CatalogSkillRowProps interface
- Destructured and forwarded all 5 trust props to the inner CatalogExtensionRow
- ExtensionsTab now passes entry.trustTier, trustSignals, blocked (derived from trustDecision === 'block'), blockReason, and onRequestOverride to every skill catalog row

## Task Commits

Each task was committed atomically:

1. **Task 1: Forward trust props through CatalogSkillRow and ExtensionsTab** - `61acc88` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `apps/web/src/components/extensions/CatalogSkillRow.tsx` - Added 5 trust props to interface and forwarded them to CatalogExtensionRow
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Passed trust props from SkillCatalogEntry in skill catalog render loop

## Decisions Made
No new handler needed — handleRequestOverride already supports kind='skill' by searching availableCatalog for the skill name.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The NOT WIRED key link from VERIFICATION.md (CatalogSkillRow -> CatalogExtensionRow trust props) is now resolved
- All phase 03 trust policy plans complete; skill and plugin catalog rows display trust badges, blocked state, and override links identically

---
*Phase: 03-clawhub-trust-policy*
*Completed: 2026-04-03*
