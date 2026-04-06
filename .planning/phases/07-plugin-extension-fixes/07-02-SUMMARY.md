---
phase: 07-plugin-extension-fixes
plan: 02
subsystem: api, ui
tags: [express, react, rpc, graceful-degradation, gateway]

# Dependency graph
requires:
  - phase: 02-plugin-management
    provides: Plugin and skill install/catalog routes and services
provides:
  - Graceful RPC degradation for skills.list and plugins.list
  - Correct catalog response destructuring in frontend
  - Correct source object format for install handlers
  - Correct gateway native schema params for skills.install
affects: [08-gateway-simplification]

# Tech tracking
tech-stack:
  added: []
  patterns: [graceful-rpc-degradation, structured-source-objects]

key-files:
  created: []
  modified:
    - apps/server/src/routes/plugins.ts
    - apps/server/src/routes/skills.ts
    - apps/server/src/services/extension-lifecycle.ts
    - apps/server/src/services/skill-store.ts
    - apps/web/src/components/extensions/ExtensionsTab.tsx

key-decisions:
  - "Log RPC failures as warnings and return empty lists rather than throwing 500 errors"
  - "Use gateway native schema { source: 'clawhub', slug } for skills.install RPC instead of platform-specific { skillId, source }"

patterns-established:
  - "Graceful RPC degradation: catch unknown, console.warn with context, set result=undefined, guard with if(result !== undefined)"
  - "Source object format: always send { type, spec? } object to install endpoints, never bare string"

requirements-completed: [PLUGFIX-03, FRONT-01, FRONT-02, FRONT-03]

# Metrics
duration: 3min
completed: 2026-04-04
---

# Phase 7 Plan 02: Plugin & Extension Bug Fixes Summary

**Graceful RPC degradation for skills.list/plugins.list, correct catalog response destructuring, and gateway-native install params**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T10:05:23Z
- **Completed:** 2026-04-04T10:08:56Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Backend routes and reconciliation now gracefully handle RPC failures (empty list + console.warn instead of 500 errors)
- Frontend correctly destructures `{ catalog, hasMore }` response shape at all 4 catalog fetch locations
- Frontend install handlers send source as `{ type, spec }` object at all 3 install locations
- Backend skills.install RPC uses gateway native schema `{ source: 'clawhub', slug }` instead of platform-specific params

## Task Commits

Each task was committed atomically:

1. **Task 1: Review and verify backend graceful degradation fixes** - `2496637` (fix)
2. **Task 2: Review and verify frontend response shape and source format fixes** - `07b194c` (fix)
3. **Task 3: Run typecheck and lint** - verification only, no commit

## Files Created/Modified
- `apps/server/src/routes/plugins.ts` - Added catch block for plugins.list RPC in catalog endpoint
- `apps/server/src/routes/skills.ts` - Added catch blocks for skills.list RPC in list and catalog endpoints; fixed upgrade install params
- `apps/server/src/services/extension-lifecycle.ts` - Added catch block for skills.list/plugins.list in reconciliation; guarded with undefined check
- `apps/server/src/services/skill-store.ts` - Fixed installSkill RPC params to use gateway native schema
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Fixed catalog response destructuring and source object format

## Decisions Made
- Log RPC failures as warnings and return empty lists rather than throwing 500 errors -- enables backward compatibility with older gateway versions
- Use gateway native schema `{ source: 'clawhub', slug }` for skills.install RPC instead of platform-specific `{ skillId, source }` -- matches the gateway's anyOf schema definition

## Deviations from Plan

None - plan executed exactly as written. All changes were pre-existing in the working tree and committed after verification.

## Issues Encountered
- Pre-existing lint error in `apps/web/src/hooks/useInstanceModels.ts` (line 21: setState in effect) -- unrelated to this plan's changes, logged to deferred-items.md

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All PLUGFIX-03, FRONT-01, FRONT-02, FRONT-03 requirements completed
- Phase 7 plugin/extension fixes complete, ready for Phase 8 (Gateway Simplification)

## Self-Check: PASSED

- All 5 modified files exist on disk
- Both task commits (2496637, 07b194c) found in git log
- SUMMARY.md created at expected path

---
*Phase: 07-plugin-extension-fixes*
*Completed: 2026-04-04*
