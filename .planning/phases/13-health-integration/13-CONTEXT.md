# Phase 13: Health Integration - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Add gateway-native health signals (HTTP `/ready` polling + WS ping/pong liveness) alongside existing Docker container checks. Replace file-hash config integrity with gateway-authoritative hash comparison. Eliminate `reseedConfigFiles` triggers for running instances.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (all areas)

User deferred all decisions to Claude. The following are Claude's planned approaches based on research:

**HTTP /ready polling (HLTH-01):**
- Poll gateway HTTP `/ready` endpoint every 30s (same interval as current slow health loop)
- `/ready` returns `{ ready: boolean, failing: string[], uptimeMs: number }` — no auth needed for localhost
- Surface `failing` array items as degraded subsystem warnings in dashboard status
- Gateway-level health check runs alongside (not replacing) Docker container status check

**WS ping/pong liveness (HLTH-02):**
- PersistentGatewayClient sends WS ping frames every 30s
- If no pong received within 30s, mark connection as unresponsive
- After 60s without pong → trigger reconnect cycle (same as connection loss)
- Independent of TCP keepalive — catches frozen gateway process

**Gateway-authoritative config hash (HLTH-03):**
- `checkConfigIntegrity` calls `gatewayCall(instanceId, 'config.get', {})` instead of reading files from container
- Compares gateway's hash with DB `config_hash`
- If mismatch → update DB hash to match gateway (gateway wins, not the other way around)
- No more `engine.readFile` for config integrity checks on running instances

**Eliminate reseedConfigFiles for running instances (HLTH-04):**
- Remove `reseedConfigFiles` call from `checkConfigIntegrity` (health-monitor.ts:276)
- Remove `reseedConfigFiles` call from auto-recovery path (health-monitor.ts:120) — keep for actual crash recovery where gateway state is unknown
- After this phase, `reseedConfigFiles` is only called from `startInstanceAsync` (initial boot)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gatewayCall(instanceId, method, params)` (gateway-rpc.ts) — Phase 9 facade for all RPC
- `checkConfigIntegrity()` (health-monitor.ts:236-286) — current file-hash implementation to refactor
- `checkInstances()` (health-monitor.ts:75-166) — existing health polling loop
- PersistentGatewayClient (gateway-event-relay.ts) — already has ws reference for ping/pong

### Established Patterns
- Health monitor runs two loops: fast (5s, starting instances) and slow (30s, running/error)
- `broadcast()` sends status events to browser WebSocket subscribers
- `createNotification()` for persistent alerts

### Integration Points
- `health-monitor.ts` — add `/ready` polling to slow loop, refactor `checkConfigIntegrity`
- `gateway-event-relay.ts` — add ping/pong to PersistentGatewayClient
- Control endpoint URLs: stored as `ws://` — need to derive HTTP URL for `/ready` (replace `ws://` with `http://`, strip path)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-health-integration*
*Context gathered: 2026-04-05*
