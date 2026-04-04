---
phase: 09-rpc-consolidation
plan: 02
subsystem: api
tags: [websocket, rpc, gateway, ephemeral-removal, plugins-list-replacement, typescript]

# Dependency graph
requires:
  - "09-01: Queue-on-disconnect in PersistentGatewayClient, gatewayCall facade, extractPluginPresence, extractPluginConfigEntries, isGatewayConnected"
provides:
  - "All 24 ephemeral GatewayRPCClient call sites migrated to gatewayCall"
  - "GatewayRPCClient class removed from codebase"
  - "plugins.list replaced with tools.catalog + config.get in all 3 call sites"
  - "GroupChatRPCClient simplified to instanceId-only constructor"
  - "translateRPC simplified to single gatewayCall invocation"
  - "marketplace-client functions use instanceId signature"
  - "exec-approval uses isGatewayConnected for synchronous check"
affects: [config-lifecycle, restart-cycle, extension-operations, health-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [no-ephemeral-websockets, tools-catalog-plus-config-get-for-plugin-state]

key-files:
  created: []
  modified:
    - apps/server/src/agent-types/openclaw/gateway-rpc.ts
    - apps/server/src/agent-types/openclaw/adapter.ts
    - apps/server/src/services/skill-store.ts
    - apps/server/src/services/plugin-store.ts
    - apps/server/src/services/marketplace-client.ts
    - apps/server/src/services/extension-lifecycle.ts
    - apps/server/src/services/group-chat-manager.ts
    - apps/server/src/routes/plugins.ts
    - apps/server/src/routes/skills.ts
    - apps/server/src/routes/oauth-proxy.ts
    - apps/server/src/routes/extension-credentials.ts
    - apps/server/src/routes/exec-approval.ts

key-decisions:
  - "Removed controlEndpoint/authToken params from skill-store functions since gatewayCall only needs instanceId"
  - "Plugin reconciliation uses both pluginPresenceMap and pluginConfigMap for combined gateway presence check"
  - "translateRPC throws if instanceId missing rather than falling back to ephemeral"
  - "exec-approval uses isGatewayConnected guard followed by gatewayCall for consistency"

patterns-established:
  - "All gateway RPC goes through gatewayCall(instanceId, method, params, timeout) -- no direct WebSocket creation"
  - "Plugin state = tools.catalog (presence/loaded) + config.get (enabled/config) via Promise.all"
  - "Service functions accept instanceId, not endpoint+token -- gateway routing is internal"

requirements-completed: [RPC-01, RPC-03, RPC-04, RPC-05]

# Metrics
duration: 12min
completed: 2026-04-04
---

# Phase 9 Plan 02: Ephemeral Client Migration Summary

**All 24 ephemeral GatewayRPCClient call sites migrated to gatewayCall, plugins.list replaced with tools.catalog + config.get, GatewayRPCClient class deleted**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-04T20:41:44Z
- **Completed:** 2026-04-04T20:54:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Eliminated all 24 ephemeral WebSocket connections for gateway RPC, making the persistent WebSocket the sole communication channel
- Replaced the non-existent `plugins.list` RPC in all 3 call sites with `tools.catalog` + `config.get` via `Promise.all`, using `extractPluginPresence` and `extractPluginConfigEntries` utilities
- Removed the entire GatewayRPCClient class (110+ lines of ephemeral WebSocket connection logic) from gateway-rpc.ts
- Simplified GroupChatRPCClient to instanceId-only constructor, translateRPC to a single gatewayCall, and checkReady to a single gatewayCall
- Updated marketplace-client function signatures from (controlEndpoint, authToken, ...) to (instanceId, ...) across all callers

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate services layer call sites to gatewayCall** - `928d696` (feat)
2. **Task 2: Migrate routes + adapter layer, replace plugins.list, simplify GroupChatRPCClient, remove GatewayRPCClient** - `632d338` (feat)

## Files Created/Modified
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts` - Removed GatewayRPCClient class, WebSocket/config imports, PROTOCOL_VERSION; simplified GroupChatRPCClient to instanceId-only constructor
- `apps/server/src/agent-types/openclaw/adapter.ts` - Simplified translateRPC (no retry loop) and checkReady (single gatewayCall); removed GatewayRPCClient/getGatewayClient/connectGateway imports
- `apps/server/src/services/skill-store.ts` - Replaced 4 ephemeral call sites with gatewayCall; removed controlEndpoint/authToken from function signatures
- `apps/server/src/services/plugin-store.ts` - Replaced 3 ephemeral call sites with gatewayCall
- `apps/server/src/services/marketplace-client.ts` - Changed searchClawHub and getClawHubExtensionInfo to accept instanceId; replaced 2 ephemeral call sites
- `apps/server/src/services/extension-lifecycle.ts` - Replaced skills.list ephemeral call with gatewayCall; replaced plugins.list with tools.catalog + config.get via Promise.all
- `apps/server/src/services/group-chat-manager.ts` - Updated GroupChatRPCClient constructor call to (instanceId) only
- `apps/server/src/routes/plugins.ts` - Replaced 2 plugins.list calls with tools.catalog + config.get; replaced 1 upgrade ephemeral call; updated marketplace-client callers
- `apps/server/src/routes/skills.ts` - Replaced 3 ephemeral calls with gatewayCall; updated marketplace-client callers
- `apps/server/src/routes/oauth-proxy.ts` - Replaced 2 ephemeral calls with gatewayCall
- `apps/server/src/routes/extension-credentials.ts` - Replaced 1 ephemeral call with gatewayCall
- `apps/server/src/routes/exec-approval.ts` - Switched from getGatewayClient null-check to isGatewayConnected + gatewayCall

## Decisions Made
- Removed controlEndpoint/authToken from skill-store function signatures since gatewayCall resolves routing internally via instanceId. This is a breaking API change for internal callers but cleaner long-term.
- translateRPC now throws if instanceId is missing rather than attempting ephemeral fallback. The queue-on-disconnect pattern in PersistentGatewayClient handles reconnection.
- Plugin reconciliation considers a plugin "in gateway" if it appears in either tools.catalog OR config.get, providing maximum detection coverage.
- exec-approval uses isGatewayConnected as a synchronous guard before calling gatewayCall, since approval resolution requires the connection to be live right now (not queued).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RPC consolidation complete: all gateway communication uses the persistent WebSocket via gatewayCall
- Phase 10 (Config Lifecycle) can proceed -- config.patch calls already use gatewayCall
- Phase 12 (Extension Operations) can proceed -- all extension RPCs use gatewayCall
- Phase 13 (Health Integration) can proceed -- checkReady uses gatewayCall
- Pre-existing frontend lint warnings (react-hooks/exhaustive-deps) are unrelated to this plan

---
## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 09-rpc-consolidation*
*Completed: 2026-04-04*
