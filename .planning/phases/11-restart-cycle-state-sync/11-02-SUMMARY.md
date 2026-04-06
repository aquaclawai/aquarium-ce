---
phase: 11-restart-cycle-state-sync
plan: 02
subsystem: runtime
tags: [websocket, gateway, state-sync, reconciliation, workspace-files, rpc]

# Dependency graph
requires:
  - phase: 11-restart-cycle-state-sync
    provides: "'restarting' InstanceStatus, PersistentGatewayClient shutdown event detection, expectedRestart flag, exponential backoff"
  - phase: 09-rpc-consolidation
    provides: gatewayCall facade, PersistentGatewayClient with queue
  - phase: 10-config-lifecycle
    provides: config.patch triggering SIGUSR1 restart, config_hash tracking
provides:
  - "syncGatewayState() full post-reconnect reconciliation orchestrator"
  - "syncWorkspaceViaGateway() RPC-based workspace file sync with Docker exec fallback"
  - "Fixed skills.status RPC call in extension-lifecycle.ts (was skills.list, which is not in gateway whitelist)"
  - "Fixed skill field mapping: name instead of skillId for skills.status response"
  - "Post-reconnect state sync blocks 'running' transition until complete"
affects: [12-extension-operations, 13-health-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["gateway-first workspace sync via agents.files.list/get RPC", "non-fatal multi-step sync orchestrator with per-step error isolation"]

key-files:
  created: []
  modified:
    - apps/server/src/services/instance-manager.ts
    - apps/server/src/services/extension-lifecycle.ts
    - apps/server/src/services/gateway-event-relay.ts

key-decisions:
  - "syncGatewayState runs on EVERY reconnect (expected or unexpected) because any reconnect means gateway state may have diverged"
  - "updateStatus('running') only fires when wasExpectedRestart is true -- unexpected disconnects where instance is already 'running' skip the status update"
  - "Each sync step (extensions, config hash, workspace) is individually wrapped in try/catch -- failure of one does not block the others"
  - "syncWorkspaceViaGateway falls back to Docker exec (syncWorkspaceFromContainer) on RPC failure -- graceful degradation"
  - "Used undefined instead of null for statusMessage in updateStatus call to match TypeScript signature (carried from Plan 01)"

patterns-established:
  - "Gateway-first workspace sync: agents.files.list + agents.files.get RPC, Docker exec fallback"
  - "Post-reconnect orchestrator: reconcileExtensions + config.get hash + workspace sync"

requirements-completed: [SYNC-02, SYNC-03, SYNC-04, SYNC-05]

# Metrics
duration: 4min
completed: 2026-04-05
---

# Phase 11 Plan 02: Post-Reconnect State Reconciliation Summary

**syncGatewayState orchestrator runs reconcileExtensions + config hash sync + workspace file sync after every WebSocket reconnect, with fixed skills.status RPC call enabling actual skill reconciliation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-05T03:41:19Z
- **Completed:** 2026-04-05T03:45:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed critical skills.list -> skills.status RPC bug that made skill reconciliation a complete no-op (skills.list is not in gateway RPC whitelist)
- Fixed skill field mapping from skillId to name, matching actual skills.status response shape (consistent with routes/skills.ts)
- Added syncGatewayState() orchestrator that runs full state reconciliation (extensions + config hash + workspace) after every reconnect
- Added syncWorkspaceViaGateway() that reads workspace files via gateway RPC with Docker exec fallback
- Wired syncGatewayState into PersistentGatewayClient connect response handler, blocking "running" transition until sync completes

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix skills.list RPC bug, create syncGatewayState and syncWorkspaceViaGateway** - `007c43a` (feat)
2. **Task 2: Wire syncGatewayState into PersistentGatewayClient reconnect path** - `0b9f132` (feat)

## Files Created/Modified
- `apps/server/src/services/extension-lifecycle.ts` - Fixed skills.list -> skills.status RPC call, fixed skillId -> name field mapping in GatewaySkillInfo interface and skill map loop
- `apps/server/src/services/instance-manager.ts` - Added syncWorkspaceViaGateway() and syncGatewayState() exported functions
- `apps/server/src/services/gateway-event-relay.ts` - Replaced direct updateStatus('running') with syncGatewayState -> updateStatus('running') chain after reconnect

## Decisions Made
- syncGatewayState runs on every reconnect (expected or not) because any reconnect means gateway state may have diverged from DB
- updateStatus('running') only fires when wasExpectedRestart is true, avoiding redundant status updates for unexpected disconnects
- Each sync step has independent error handling -- one failure does not block others
- syncWorkspaceViaGateway gracefully degrades to Docker exec on RPC failure
- Boot-time reconcileExtensions in startInstanceAsync preserved unchanged -- reconnect path is additional, not replacement

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing ESLint error in apps/web/src/hooks/useInstanceModels.ts (setState in effect) -- unrelated to this plan, not fixed (out of scope)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full post-reconnect state sync pipeline is operational
- Phase 11 complete: restart cycle handles shutdown -> restarting -> reconnect -> state sync -> running
- Phase 12 (Extension Operations) can build on reconcileExtensions with confidence that skills.status actually works
- Phase 13 (Health Integration) can leverage syncGatewayState for periodic health-check-driven sync

## Self-Check: PASSED

All 3 modified files verified present. Both task commits (007c43a, 0b9f132) confirmed in git log.

---
*Phase: 11-restart-cycle-state-sync*
*Completed: 2026-04-05*
