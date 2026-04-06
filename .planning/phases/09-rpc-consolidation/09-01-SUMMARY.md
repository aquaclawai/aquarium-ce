---
phase: 09-rpc-consolidation
plan: 01
subsystem: api
tags: [websocket, rpc, gateway, queue, typescript]

# Dependency graph
requires: []
provides:
  - "Queue-on-disconnect in PersistentGatewayClient (call() queues when disconnected)"
  - "gatewayCall() facade as single entry point for all gateway RPC"
  - "extractPluginPresence() maps tools.catalog to plugin presence info"
  - "extractPluginConfigEntries() maps config.get to plugin config/enabled state"
  - "isGatewayConnected() export for synchronous connection state checks"
  - "getGatewayClient() returns disconnected (not closed) clients for queue-based RPC"
affects: [09-02-rpc-consolidation, extension-operations, config-lifecycle, health-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [queue-on-disconnect-rpc, facade-function-for-rpc, response-mapping-utilities]

key-files:
  created: []
  modified:
    - apps/server/src/services/gateway-event-relay.ts
    - apps/server/src/agent-types/openclaw/gateway-rpc.ts

key-decisions:
  - "Queue max depth set to 50 items with oldest-reject overflow to prevent memory issues"
  - "Queue items retain their own 30s timeout timers independent of connection state"
  - "drainQueue clears item timers and creates fresh sendRPC promises for accurate timeout tracking"
  - "ws.on('close') only rejects queue items when client is fully closed; reconnecting leaves queue intact"

patterns-established:
  - "Queue-on-disconnect: RPC calls queue in FIFO array when persistent WS is down, drain after reconnect"
  - "gatewayCall facade: all call sites use gatewayCall(instanceId, method, params, timeoutMs) instead of creating clients"
  - "Plugin state extraction: tools.catalog for presence, config.get for enabled/config (plugins.list does not exist)"

requirements-completed: [RPC-01, RPC-02, RPC-04]

# Metrics
duration: 3min
completed: 2026-04-04
---

# Phase 9 Plan 01: RPC Queue Infrastructure Summary

**Queue-on-disconnect for PersistentGatewayClient with gatewayCall facade and plugin state extraction utilities**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T20:34:33Z
- **Completed:** 2026-04-04T20:37:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- PersistentGatewayClient.call() now queues requests when disconnected instead of throwing, with 50-item max depth and FIFO drain after reconnection
- gatewayCall() facade provides a single entry point for all gateway RPC, replacing direct GatewayRPCClient instantiation
- extractPluginPresence() and extractPluginConfigEntries() provide the mapping utilities needed to replace the non-existent plugins.list RPC with tools.catalog + config.get
- getGatewayClient() returns disconnected clients (queue handles the gap); isGatewayConnected() preserves old connected-only check for exec-approval

## Task Commits

Each task was committed atomically:

1. **Task 1: Add queue-on-disconnect to PersistentGatewayClient and update getGatewayClient** - `85b4d2c` (feat)
2. **Task 2: Create gatewayCall facade, extractPluginPresence, and extractPluginConfigEntries utilities** - `febd49b` (feat)

## Files Created/Modified
- `apps/server/src/services/gateway-event-relay.ts` - Added QueuedRequest interface, queue state, sendRPC/drainQueue methods, isClosed getter, isGatewayConnected export; refactored call() to queue when disconnected, updated getGatewayClient to return non-closed clients
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts` - Added gatewayCall facade, PluginPresenceInfo/extractPluginPresence, PluginConfigEntry/extractPluginConfigEntries; GatewayRPCClient preserved for Plan 02 migration

## Decisions Made
- Queue max depth of 50 with oldest-reject overflow prevents unbounded memory growth during extended disconnections
- Each queued item retains its own 30s timeout timer, so items time out independently even if the connection stays down longer
- drainQueue() clears queue item timers before calling sendRPC(), which creates fresh timeout promises for accurate tracking
- On ws close during reconnect, queue items are left intact (they will drain after reconnect or timeout on their own timers); only fully closed clients reject queue items

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Queue infrastructure and gatewayCall facade are ready for Plan 02 to migrate all 24 call sites
- extractPluginPresence and extractPluginConfigEntries are ready for Plan 02 to replace plugins.list calls
- GatewayRPCClient class is still present and functional -- Plan 02 removes it after all call sites migrate
- isGatewayConnected export ready for exec-approval.ts to switch from getGatewayClient null-check

---
## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 09-rpc-consolidation*
*Completed: 2026-04-04*
