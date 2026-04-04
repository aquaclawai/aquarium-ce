# Phase 9: RPC Consolidation - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Route all gateway RPC calls through the persistent WebSocket connection, eliminate the ephemeral `GatewayRPCClient` class entirely, add queue-with-retry behavior for calls during connection gaps, and replace all `plugins.list` RPC calls with `tools.catalog` + `config.get` (since `plugins.list` does not exist in the gateway).

</domain>

<decisions>
## Implementation Decisions

### Queue Behavior
- All RPC calls queue when the persistent connection is down (not fail-fast)
- Queued calls have a 30-second timeout — if connection doesn't re-establish in 30s, reject with error
- Queued calls execute in FIFO order after reconnection (not concurrent)
- Queue is per-instance (each PersistentGatewayClient has its own queue)

### Fallback Strategy
- **Remove GatewayRPCClient class entirely** — no ephemeral fallback, no "emergency" path
- All 24 call sites across 10 files migrate to use the persistent client
- GroupChatRPCClient also routes through the persistent client (it already depends on the persistent event relay for waitForChatCompletion)
- During instance startup (before persistent WS connects), skip pre-connection RPCs — seedConfig writes files directly, config.schema validation is deferred, persistent client connects eagerly after container starts

### plugins.list Replacement
- `plugins.list` does not exist in the gateway — 6 call sites must change
- Extension reconciliation (`extension-lifecycle.ts`): replace `plugins.list` with `tools.catalog` for plugin presence detection + `config.get` for plugin config/enabled state
- Plugin routes (`routes/plugins.ts` list + catalog): use `tools.catalog` for bundled plugin discovery, `config.get` for enabled/disabled state
- Response shape mapping needed: `tools.catalog` returns tools grouped by provider, not plugins — extract plugin-sourced tools and map back to plugin IDs
- Graceful degradation: if `tools.catalog` fails, return empty list (same pattern as current `plugins.list` failure handling)

### Client ID
- All persistent connections use `openclaw-control-ui` as client ID (already the case in gateway-event-relay.ts, verify consistency)
- Remove any references to `gateway-client` or other IDs

### Claude's Discretion
- Exact queue data structure (array, Map, etc.)
- Whether to add a max queue depth (to prevent memory issues from runaway queuing)
- Internal event bus for connection state changes (connected/disconnected/reconnecting)
- Error message wording for queue timeout failures

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PersistentGatewayClient.call()` (gateway-event-relay.ts:430-443) — already supports RPC via persistent connection with timeout and pending request tracking
- `getGatewayClient()` (gateway-event-relay.ts:579-582) — returns connected client or null, used as the routing check
- `translateRPC` in adapter.ts — already implements "try persistent first, fall back to ephemeral" pattern; will simplify to persistent-only with queue

### Established Patterns
- Persistent client maintains `pendingRequests` Map for in-flight RPC tracking (resolve/reject on response)
- Reconnect logic exists: 5s delay, max 5 retries, `scheduleReconnect()` method
- `reconcileConnections()` polls every 10s to create/close connections based on DB state

### Integration Points (24 call sites to migrate)
- `services/skill-store.ts` — 4 ephemeral clients (install, uninstall, upgrade, catalog)
- `services/plugin-store.ts` — 3 ephemeral clients (reinstall, ping, install)
- `services/extension-lifecycle.ts` — 2 ephemeral clients (skills.list, plugins.list)
- `services/marketplace-client.ts` — 2 ephemeral clients (searchClawHub, getExtensionInfo)
- `routes/plugins.ts` — 3 ephemeral clients (list, catalog, upgrade)
- `routes/skills.ts` — 3 ephemeral clients (list, catalog, upgrade)
- `routes/oauth-proxy.ts` — 2 ephemeral clients (web.login.start, web.login.wait)
- `routes/extension-credentials.ts` — 1 ephemeral client (config.patch for credential injection)
- `agent-types/openclaw/adapter.ts` — 2 ephemeral clients (translateRPC fallback, force-reconnect)
- `agent-types/openclaw/gateway-rpc.ts` — 2 ephemeral clients (GroupChatRPCClient internals)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the research and discussion decisions provide clear direction.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-rpc-consolidation*
*Context gathered: 2026-04-05*
