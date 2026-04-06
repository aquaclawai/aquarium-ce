---
phase: 07-plugin-extension-fixes
plan: 01
subsystem: gateway
tags: [openclaw, gateway, rpc, plugin, method-conflict]

# Dependency graph
requires: []
provides:
  - "Clean platform-bridge plugin with no method name conflicts"
  - "Built-in catalog (BUILTIN_REGISTRY) accessible via clawhub.search and clawhub.info"
  - "7 non-conflicting RPC methods (platform.ping, platform.runtime, agents.workspace.init, skills.list, plugins.list, clawhub.search, clawhub.info)"
affects: [08-gateway-simplification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Plugin methods must not duplicate gateway native RPC handlers"]

key-files:
  created: []
  modified: ["openclaw/plugin/index.ts"]

key-decisions:
  - "Removed 4 conflicting methods (skills.install, skills.uninstall, plugins.install, plugins.uninstall) that duplicated gateway native handlers"
  - "Kept skills.list and plugins.list as supplementary read-only methods (no conflict with gateway for list operations)"
  - "Removed saveState and crypto import as dead code after install/uninstall method removal"

patterns-established:
  - "Plugin namespace separation: platform-bridge only registers methods the gateway does not already handle natively"

requirements-completed: [SIMP-02, PLUGFIX-01, PLUGFIX-02]

# Metrics
duration: 3min
completed: 2026-04-04
---

# Phase 7 Plan 1: Plugin Method Conflict Fix Summary

**Removed 4 conflicting RPC methods from platform-bridge plugin that shadowed gateway native handlers, fixing empty catalog and config corruption bugs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T10:05:22Z
- **Completed:** 2026-04-04T10:08:24Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Removed `skills.install`, `skills.uninstall`, `plugins.install`, `plugins.uninstall` method registrations that conflicted with gateway native handlers
- Eliminated root cause of PLUGFIX-01 (empty catalog after restart -- plugin failed to load due to method name conflicts)
- Eliminated root cause of PLUGFIX-02 (gateway config corruption from plugin's `plugins.install` writing bad paths)
- Preserved all 7 non-conflicting methods and the 11-entry BUILTIN_REGISTRY catalog
- Cleaned up dead code: removed `crypto` import and `saveState` function that were only used by the removed methods

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove conflicting RPC methods from platform-bridge plugin** - `5ce676b` (fix)
2. **Task 2: Verify plugin builds and has no dead code** - verification-only task (no file changes)

## Files Created/Modified
- `openclaw/plugin/index.ts` - Removed 4 conflicting method registrations, crypto import, and saveState function; kept 7 non-conflicting methods and built-in registry

## Decisions Made
- Removed only the 4 mutating methods (install/uninstall) that conflict with gateway native handlers -- list methods kept as read-only supplements
- Removed `saveState()` and `crypto` import as dead code since no remaining methods write to state
- Kept `InstalledExtension` interface, `ExtensionState`, `getStatePath()`, and `loadState()` since `skills.list` and `plugins.list` still read from local state file

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plugin file is clean and ready for gateway Docker image rebuild
- Plan 07-02 can proceed with backend graceful degradation and frontend fixes
- Phase 08 (Gateway Simplification) can safely build on this foundation

## Self-Check: PASSED

- FOUND: 07-01-SUMMARY.md
- FOUND: commit 5ce676b (Task 1)
- FOUND: openclaw/plugin/index.ts

---
*Phase: 07-plugin-extension-fixes*
*Completed: 2026-04-04*
