# Technology Stack: Gateway Communication Overhaul

**Project:** Aquarium CE v1.3 - Gateway-First Communication
**Researched:** 2026-04-05
**Overall Confidence:** HIGH

---

## Executive Summary

The gateway communication overhaul requires **zero new runtime dependencies**. The existing `ws@8.20.0` library fully supports multiplexed persistent connections -- concurrent request/response correlation via message IDs, ping/pong heartbeats, and backpressure management are all built in. The `PersistentGatewayClient` class already implements the core RPC-over-WebSocket pattern. The work is architectural refactoring, not library shopping.

**Critical finding from gateway source code analysis (FEATURES.md):** The gateway does NOT emit events for config changes, plugin load/fail, or skill load/fail. The original design assumption of "event-driven DB sync" must be replaced with a **reconnect-driven sync pattern**: config.patch triggers a gateway restart (SIGUSR1), the persistent WebSocket drops, and on reconnect the platform reads the hello-ok snapshot + calls `config.get` and `tools.catalog` to verify state. The sync layer is still needed but operates on connection lifecycle events, not gateway-emitted state events.

What IS needed: a typed internal event bus for connection lifecycle and platform-side state transitions (use Node.js built-in `EventEmitter<T>` with `@types/node@22.x` generics -- already installed), and structured patterns for reconnect-driven reconciliation. No `npm install` commands.

---

## Recommended Stack (Changes Only)

### No New Dependencies Required

| Category | Technology | Version | Status | Rationale |
|----------|-----------|---------|--------|-----------|
| WebSocket client | `ws` | `^8.18.0` (installed: 8.20.0) | **Keep as-is** | Supports all needed features: multiplexed req/res, ping/pong, backpressure |
| Typed EventEmitter | `node:events` + `@types/node` | Node 23.6 / `@types/node@22.19.15` | **Already installed** | Generic `EventEmitter<T>` for type-safe internal event bus |
| RPC correlation | Built-in `Map<string, PendingRequest>` | N/A | **Already implemented** | `PersistentGatewayClient.pendingRequests` does exactly this |
| HTTP health checks | `node:http` (built-in) | N/A | **Already available** | Gateway exposes `/ready` HTTP endpoint -- use simple HTTP GET, no library needed |
| JSON-RPC framing | Custom (existing protocol v3) | N/A | **Keep as-is** | Gateway protocol is fixed; we adapt to it |

### Explicitly NOT Adding

| Library | Why Not |
|---------|---------|
| `rpc-websockets` (JSON-RPC 2.0 over WS) | Gateway uses its own protocol v3 with `connect.challenge` handshake, NOT JSON-RPC 2.0. Adding a JSON-RPC library means translating between two protocols for zero benefit. |
| `websocket-multiplex` / `sockjs-multiplex` | These create virtual channels over SockJS. We don't use SockJS, and the gateway protocol already supports concurrent req/res via UUID-correlated message IDs. |
| `eventemitter3` | Slightly faster than Node's built-in EventEmitter, but we emit maybe 10-50 events/second total. The performance difference is meaningless. Adding a dependency for negligible gain violates the project constraint of using existing patterns. |
| `typed-emitter` | `@types/node@22.x` already provides `EventEmitter<T>` generics natively. No external wrapper needed. |
| `rxjs` | Massively overweight. We need "event arrives, handler runs, DB updates." That's `emitter.on()`, not an observable pipeline. |
| `bottleneck` / `p-throttle` | Gateway's 3/min rate limit on config.patch is trivially enforced with a timestamp array. A rate limiter library is overkill for a single endpoint. |
| `got` / `axios` | For the HTTP `/ready` health check, `node:http` GET is sufficient. One endpoint, one request shape, no auth. |

---

## Detailed Analysis

### Q1: Does `ws@8.x` Support Multiplexed Persistent Connections?

**Answer: YES.** Confidence: HIGH (verified against installed library + source code).

`ws` is a raw WebSocket implementation. It provides the transport; multiplexing is an application concern. The existing codebase already implements multiplexing correctly:

```
Current PersistentGatewayClient architecture:
- Single WebSocket per instance (line 163: new WebSocket(this.endpoint))
- UUID-correlated req/res (line 228-237: pendingRequests Map lookup by msg.id)
- Concurrent in-flight RPCs (Map can hold N pending requests simultaneously)
- Event dispatch alongside RPC responses (line 239-377: msg.type === 'event' branch)
```

What `ws@8.20.0` provides that the overhaul needs:

| Feature | Support | How Used |
|---------|---------|----------|
| Concurrent messages on single connection | Yes - full duplex | Multiple `call()` invocations can be in-flight simultaneously |
| Ping/pong heartbeats | Yes - `ws.ping()`, `ws.pong()`, `autoPong: true` (default) | Transport-level liveness detection |
| Backpressure detection | Yes - `ws.bufferedAmount` property | Detect send buffer backup before issuing more RPCs |
| Pause/resume flow control | Yes - `ws.pause()` / `ws.resume()` | Throttle incoming events if processing falls behind |
| Binary frames | Yes - configurable `binaryType` | Not needed currently but available |
| Connection state | Yes - `ws.readyState` (CONNECTING/OPEN/CLOSING/CLOSED) | Already used implicitly via `this.connected` flag |

**No changes to the `ws` dependency are needed.**

### Q2: Event Emitter Patterns for the Sync Layer

**Answer: Use Node.js built-in `EventEmitter<T>` with TypeScript generics, but for connection lifecycle events, NOT gateway state events.** Confidence: HIGH.

**Corrected understanding (from FEATURES.md gateway source analysis):**

The gateway does NOT emit events for config changes, plugin load/fail, or skill load/fail. The sync layer's event bus is for **platform-internal coordination**, not for proxying gateway events:

```typescript
import { EventEmitter } from 'node:events';

// The sync bus coordinates platform-side reactions to connection lifecycle
interface GatewaySyncEvents {
  // Connection lifecycle (fired by PersistentGatewayClient)
  'gateway.connected':    [instanceId: string, snapshot: HelloOkSnapshot];
  'gateway.disconnected': [instanceId: string, reason: string, wasClean: boolean];
  'gateway.shutdown':     [instanceId: string, reason: string, restartExpectedMs?: number];
  'gateway.reconnected':  [instanceId: string, snapshot: HelloOkSnapshot];

  // Reconciliation results (fired by sync handlers after RPC queries)
  'sync.config.updated':  [instanceId: string, config: Record<string, unknown>, hash: string];
  'sync.plugins.verified':[instanceId: string, activePluginIds: string[]];
  'sync.skills.verified': [instanceId: string, skillStatuses: SkillStatusEntry[]];
  'sync.health.checked':  [instanceId: string, ready: boolean, failing: string[]];

  // Existing gateway events (already handled, add to bus for consistency)
  'gateway.chat':         [instanceId: string, payload: Record<string, unknown>];
  'gateway.exec.approval':[instanceId: string, payload: Record<string, unknown>];
  'gateway.health':       [instanceId: string, healthSummary: Record<string, unknown>];
  'gateway.tick':         [instanceId: string, ts: number];
}

const syncBus = new EventEmitter<GatewaySyncEvents>();
```

**Architecture of the reconnect-driven sync layer:**

```
config.patch call (from Aquarium)
    |
    v
Gateway receives patch -> writes config -> schedules SIGUSR1 restart
    |
    v
Gateway emits { type: "event", event: "shutdown", payload: { reason, restartExpectedMs } }
    |
    v
PersistentGatewayClient receives 'shutdown' event
    -> syncBus.emit('gateway.shutdown', instanceId, reason, restartExpectedMs)
    -> Set instance state to "restarting" (suppress error alerts)
    |
    v
WebSocket closes (gateway process restarts)
    -> syncBus.emit('gateway.disconnected', instanceId, reason, wasClean: true)
    |
    v
PersistentGatewayClient reconnects (scheduleReconnect with backoff)
    |
    v
Gateway sends hello-ok snapshot during connect handshake
    -> syncBus.emit('gateway.reconnected', instanceId, snapshot)
    |
    v
Reconnect sync handler:
    1. config.get -> read full config + hash -> update DB
    2. tools.catalog({ includePlugins: true }) -> verify plugin tools loaded
    3. skills.status -> verify skill states
    4. Emit 'sync.config.updated', 'sync.plugins.verified', 'sync.skills.verified'
    |
    v
DB is now synchronized with gateway reality
```

**Why not a separate event bus library:**
- The codebase currently uses zero EventEmitter instances in server services (confirmed via grep)
- The pattern above uses only built-in Node.js APIs
- The sync bus is internal to the server process -- no cross-process concerns

### Q3: Changes to PersistentGatewayClient for RPC Routing

**Answer: The `call()` method already works. Changes are about routing, shutdown handling, and reconnect behavior.** Confidence: HIGH.

Current `PersistentGatewayClient.call()` (line 430-443) is already correct for multiplexed RPC. Multiple concurrent `call()` invocations each get a unique UUID, tracked in `pendingRequests`, resolved independently when matching responses arrive.

**What needs to change in the client itself:**

1. **Handle `shutdown` event** to distinguish clean restart from crash:
```typescript
// In the msg.type === 'event' handler:
if (msg.event === 'shutdown') {
  this.expectedRestart = true;
  const payload = msg.payload as { reason?: string; restartExpectedMs?: number };
  syncBus.emit('gateway.shutdown', this.instanceId, 
    payload.reason ?? 'unknown', payload.restartExpectedMs);
}
```

2. **Add ping/pong heartbeat** for transport-level liveness:
```typescript
// In connect(), after authentication succeeds:
this.heartbeatInterval = setInterval(() => {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.ping();
    this.lastPingSent = Date.now();
  }
}, 30_000);

this.ws.on('pong', () => {
  this.lastPongReceived = Date.now();
});
```

3. **Emit sync bus events on connect/disconnect**:
```typescript
// On successful connect:
syncBus.emit('gateway.connected', this.instanceId, helloOkSnapshot);

// On close:
const wasClean = this.expectedRestart;
syncBus.emit('gateway.disconnected', this.instanceId, closeReason, wasClean);
this.expectedRestart = false;
```

4. **Expose connection health metrics**:
```typescript
get latencyMs(): number | null { /* from ping/pong timing */ }
get isHealthy(): boolean { /* connected + pong received within 60s */ }
get pendingCallCount(): number { return this.pendingRequests.size; }
get sendBufferBytes(): number { return this.ws?.bufferedAmount ?? 0; }
```

5. **Improve reconnection with exponential backoff**:
```typescript
// Replace fixed 5s delay:
private getReconnectDelay(): number {
  return Math.min(1000 * Math.pow(2, this.retryCount), 30_000); // 1s, 2s, 4s, 8s, 16s, 30s cap
}
```

**What needs to change in the callers:**

| Current Call Site | Current Pattern | New Pattern |
|-------------------|----------------|-------------|
| `extension-lifecycle.ts` | Creates `new GatewayRPCClient()` directly | Use `getGatewayClient(instanceId).call()` or throw |
| `plugin-store.ts` | Creates `new GatewayRPCClient()` directly | Use `getGatewayClient(instanceId).call()` or throw |
| `skill-store.ts` | Creates `new GatewayRPCClient()` directly | Use `getGatewayClient(instanceId).call()` or throw |
| `adapter.ts:translateRPC` | Tries persistent, falls back to ephemeral with retry | Persistent-first; ephemeral only during startup race |
| `rpc-proxy.ts` | Routes through `adapter.translateRPC` | No change needed |

### Q4: New Dependencies Assessment

**Answer: None needed.** Confidence: HIGH.

| Capability Needed | Provided By | Already Installed |
|-------------------|-------------|-------------------|
| WebSocket transport | `ws@8.20.0` | Yes |
| UUID generation | `node:crypto` (`randomUUID`) | Yes (built-in) |
| Typed event bus | `node:events` (`EventEmitter<T>`) | Yes (built-in) |
| HTTP health checks | `node:http` / `node:https` | Yes (built-in) |
| JSON serialization | Built-in `JSON.parse`/`JSON.stringify` | Yes (built-in) |
| Timeout management | Built-in `setTimeout`/`clearTimeout` | Yes (built-in) |
| DB operations | `knex@3.1.0` + `better-sqlite3@11.x` | Yes |
| Config hashing | `node:crypto` (`createHash`) | Yes (built-in) |

---

## Specific Technical Decisions

### Decision 1: Keep One WebSocket Per Instance

**Rationale:** Each gateway container is a separate process with its own WebSocket server on port 18789. The 1:1 mapping between `PersistentGatewayClient` instances and gateway containers is architecturally correct.

### Decision 2: Mostly Eliminate GatewayRPCClient (Ephemeral Connections)

**Rationale:** The `GatewayRPCClient` creates a new WebSocket per call with full 3-step handshake (~100-300ms overhead). With persistent client routing all RPCs, ephemeral becomes near-dead code.

**Exception:** Keep a stripped-down ephemeral fallback ONLY for the 1-5 second startup race condition where `connectGateway()` has been called but the persistent connection hasn't completed the handshake yet.

### Decision 3: Reconnect-Driven Sync (Not Event-Driven)

**Rationale:** The gateway does NOT emit config/plugin/skill state change events (verified from gateway source). The sync pattern is:
1. Platform calls `config.patch` -> gateway writes config + restarts
2. WebSocket drops -> platform detects disconnect
3. If `shutdown` event preceded the close -> mark as expected restart
4. Reconnect -> call `config.get` + `tools.catalog` + `skills.status` -> update DB
5. Compare expected state with actual state -> alert on discrepancies

This is fundamentally different from the event-driven push model originally proposed in `gateway-communication-analysis.md` Section 5. The analysis doc's "Phase 1: Event-Driven DB Sync" must be redesigned as "Phase 1: Reconnect-Driven DB Sync."

### Decision 4: Dual Health Check (Ping/Pong + HTTP /ready)

**Rationale:** Two complementary health signals:
- **Ping/pong** (transport-level): Detects if the gateway process is alive. Works even if the event loop is busy. 30-second interval.
- **HTTP `/ready`** (application-level): Detects if the gateway is functioning correctly. Returns `{ ready, failing, uptimeMs }`. Independent of the WebSocket connection. Can be polled even when WS is disconnected.

The existing health monitor's Docker container status polling (`engine.getStatus()`) should remain as a third layer -- it detects container-level crashes that would prevent both WS and HTTP connections.

### Decision 5: config.patch Uses `{ raw: "<json5>" }` With Merge-Patch Semantics

**Rationale (from gateway source):** config.patch accepts a JSON5 string in the `raw` parameter, NOT a `{ patch: {...} }` object. The gateway applies RFC 7396 merge-patch semantics:
- `null` values delete keys
- Object values merge recursively
- Array values with id-keyed objects merge by id (critical for `plugins.entries[]`)
- Non-object values replace directly

The current Aquarium code at `instance-manager.ts:820` already sends `{ raw: rawConfig }` as the primary path. The `{ patch: configPatch }` fallback does NOT work -- the gateway schema only accepts `raw` (string), not `patch` (object). The fallback code is dead/broken.

### Decision 6: Batch Plugin Changes Into Single config.patch

**Rationale:** 
- config.patch triggers a gateway restart (SIGUSR1) every time
- Rate limit: 3 calls per 60 seconds
- Installing 4 plugins sequentially = 4 restarts + rate limit hit on the 4th

Strategy: Accumulate all plugin config changes, merge into one patch, send once. One restart. One rate-limit slot consumed.

```typescript
// Batch pattern:
const pluginEntries = plugins.map(p => ({ id: p.id, package: p.package }));
const raw = JSON.stringify({ plugins: { entries: pluginEntries } });
await client.call('config.patch', { raw, baseHash, note: 'Batch plugin install' });
// ONE restart, ONE rate-limit slot
```

### Decision 7: Single Sync Bus Singleton

**Rationale:** A single `syncBus` EventEmitter with `instanceId` as first argument is simpler than per-instance emitters that need lifecycle cleanup. The event rate is low (maybe 1-5/second per instance).

### Decision 8: No Rate Limit Library

**Rationale:** The 3/minute rate limit on config.patch is trivially enforced:
```typescript
private configPatchTimestamps: number[] = [];

private checkRateLimit(): void {
  const now = Date.now();
  this.configPatchTimestamps = this.configPatchTimestamps.filter(t => now - t < 60_000);
  if (this.configPatchTimestamps.length >= 3) {
    const waitMs = 60_000 - (now - this.configPatchTimestamps[0]);
    throw new Error(`config.patch rate limited. Retry in ${Math.ceil(waitMs / 1000)}s`);
  }
  this.configPatchTimestamps.push(now);
}
```

---

## Integration Points

### Where New Code Hooks Into Existing Code

| Integration Point | File | What Changes |
|-------------------|------|-------------|
| Shutdown event handling | `gateway-event-relay.ts:239-377` | Add handler for `shutdown` event to set expectedRestart flag |
| Reconnect sync | `gateway-event-relay.ts:159-230` (connect method) | After re-auth, call config.get + tools.catalog + skills.status |
| Sync bus emission | `gateway-event-relay.ts:379-403` (close handler) | Emit `gateway.disconnected` and `gateway.reconnected` events |
| RPC routing | `adapter.ts:825-880` (`translateRPC`) | Remove ephemeral retry loop; persistent-first |
| Config updates | `instance-manager.ts:736-845` (`patchGatewayConfig`) | Gateway-first: call config.patch, update DB on success, don't reseed config files |
| Health monitoring | `health-monitor.ts:75-166` | Add HTTP `/ready` polling + ping/pong latency check |
| Extension lifecycle | `extension-lifecycle.ts` | Replace `new GatewayRPCClient()` with `getGatewayClient()` |
| Plugin/skill stores | `plugin-store.ts`, `skill-store.ts` | Replace `new GatewayRPCClient()` with `getGatewayClient()` |

### New Files to Create

| File | Purpose |
|------|---------|
| `apps/server/src/services/gateway-sync-bus.ts` | Typed `EventEmitter<GatewaySyncEvents>` singleton + event type definitions |
| `apps/server/src/services/gateway-sync-handlers.ts` | Reconnect handlers: config.get read-back, tools.catalog verification, skills.status check |

### Files to Modify

| File | Modification |
|------|-------------|
| `gateway-event-relay.ts` | Shutdown event handling, sync bus emissions, ping/pong, health metrics, reconnect sync trigger |
| `instance-manager.ts` | Reverse `patchGatewayConfig` to gateway-first; remove `reseedConfigFiles` calls for running instances |
| `health-monitor.ts` | Add HTTP `/ready` health check, ping/pong latency check |
| `adapter.ts` | Simplify `translateRPC` to remove ephemeral retry loop |
| `extension-lifecycle.ts` | Route through persistent client |
| `plugin-store.ts` | Route through persistent client; batch plugin config changes |
| `skill-store.ts` | Route through persistent client |

---

## Verified Gateway Capabilities

All findings verified from gateway source code (see FEATURES.md for full details with file paths and line numbers).

| Capability | Status | Evidence |
|------------|--------|----------|
| Gateway emits `shutdown` event before restart | **VERIFIED** | `server-close.ts:87` -- `{ reason, restartExpectedMs }` |
| Gateway emits `health` broadcast events | **VERIFIED** | `server-maintenance.ts:50` -- periodic HealthSummary |
| Gateway emits `tick` heartbeat events | **VERIFIED** | `server-maintenance.ts:62` -- configurable interval |
| config.patch uses `{ raw: "<json5>" }` | **VERIFIED** | `config.ts:345-346` -- parses as JSON5, applies merge-patch |
| config.patch triggers SIGUSR1 restart | **VERIFIED** | `config.ts:409-418` -- scheduleGatewaySigusr1Restart |
| Plugins changes require restart (not hot-reload) | **VERIFIED** | `config-reload-plan.ts:97` -- `{ prefix: "plugins", kind: "restart" }` |
| HTTP `/ready` endpoint exists | **VERIFIED** | `server-http.ts:128-133,224-276` -- returns `{ ready, failing, uptimeMs }` |
| HTTP `/health` endpoint exists | **VERIFIED** | `server-http.ts:269-271` -- always `{ ok: true, status: "live" }` |
| config.get returns full config + hash | **VERIFIED** | `config.ts:247-254` -- `{ exists, valid, path, config, hash, rawLength, issues }` |
| tools.catalog shows plugin tools | **VERIFIED** | `tools-catalog.ts:155-182` -- groups tools by pluginId |
| skills.status returns full skill state | **VERIFIED** | `skills.ts:59-91` -- returns `SkillStatusReport` |
| No `config.changed` event exists | **VERIFIED NEGATIVE** | Not in `GATEWAY_EVENTS` array |
| No `plugin.loaded`/`plugin.failed` events | **VERIFIED NEGATIVE** | Not in `GATEWAY_EVENTS` array |
| No `skill.loaded`/`skill.failed` events | **VERIFIED NEGATIVE** | Not in `GATEWAY_EVENTS` array |
| No `plugins.list` RPC method exists | **VERIFIED NEGATIVE** | Not in `BASE_METHODS` |
| Rate limit: 3/60s on config.patch | **VERIFIED** | `control-plane-rate-limit.ts:4-5` |
| baseHash required for config writes | **VERIFIED** | `config.ts:54-98` -- optimistic concurrency control |

---

## Sources

- ws npm library: https://www.npmjs.com/package/ws (version 8.20.0 confirmed installed)
- ws GitHub: https://github.com/websockets/ws
- Node.js EventEmitter: https://nodejs.org/api/events.html
- @types/node generic EventEmitter: https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/55298
- Gateway source analysis: `.planning/research/FEATURES.md` (verified from OpenClaw gateway source code)
- Gateway communication analysis: `docs/gateway-communication-analysis.md`
- Existing source: `apps/server/src/services/gateway-event-relay.ts`
- Existing source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts`
- Existing source: `apps/server/src/agent-types/openclaw/adapter.ts`
- Existing source: `apps/server/src/services/health-monitor.ts`
