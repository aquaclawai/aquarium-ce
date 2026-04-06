# Phase 9: RPC Consolidation - Research

**Researched:** 2026-04-05
**Domain:** WebSocket RPC routing refactoring -- eliminating ephemeral gateway connections
**Confidence:** HIGH

## Summary

Phase 9 is a pure refactoring phase. Every library, protocol, and API needed is already present in the codebase. The work is structural: route all 24 ephemeral `GatewayRPCClient` call sites through the existing `PersistentGatewayClient`, add queue-with-retry behavior for connection gaps, replace 6 broken `plugins.list` RPC calls with `tools.catalog` + `config.get`, and remove the `GatewayRPCClient` class entirely.

The `PersistentGatewayClient` in `gateway-event-relay.ts` already supports multiplexed RPC via its `call()` method with UUID-correlated `pendingRequests`. The gap is that `call()` throws immediately if the connection is down (`if (!this.connected || !this.ws) throw`), and 24 call sites across 10 files bypass it entirely by creating ephemeral `GatewayRPCClient` instances. The fix is: (1) make `call()` queue requests when disconnected instead of throwing, (2) provide a `gatewayCall(instanceId, method, params)` facade that all call sites use, (3) remove the ephemeral client class.

**Primary recommendation:** Build the queue + facade first, migrate call sites mechanically, then clean up the dead code. The `plugins.list` replacement requires a response-shape mapping layer since `tools.catalog` returns tools grouped by provider, not a flat plugin list.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- All RPC calls queue when the persistent connection is down (not fail-fast)
- Queued calls have a 30-second timeout -- if connection doesn't re-establish in 30s, reject with error
- Queued calls execute in FIFO order after reconnection (not concurrent)
- Queue is per-instance (each PersistentGatewayClient has its own queue)
- **Remove GatewayRPCClient class entirely** -- no ephemeral fallback, no "emergency" path
- All 24 call sites across 10 files migrate to use the persistent client
- GroupChatRPCClient also routes through the persistent client (it already depends on the persistent event relay for waitForChatCompletion)
- During instance startup (before persistent WS connects), skip pre-connection RPCs -- seedConfig writes files directly, config.schema validation is deferred, persistent client connects eagerly after container starts
- `plugins.list` does not exist in the gateway -- 6 call sites must change
- Extension reconciliation (`extension-lifecycle.ts`): replace `plugins.list` with `tools.catalog` for plugin presence detection + `config.get` for plugin config/enabled state
- Plugin routes (`routes/plugins.ts` list + catalog): use `tools.catalog` for bundled plugin discovery, `config.get` for enabled/disabled state
- Response shape mapping needed: `tools.catalog` returns tools grouped by provider, not plugins -- extract plugin-sourced tools and map back to plugin IDs
- Graceful degradation: if `tools.catalog` fails, return empty list (same pattern as current `plugins.list` failure handling)
- All persistent connections use `openclaw-control-ui` as client ID (already the case in gateway-event-relay.ts, verify consistency)
- Remove any references to `gateway-client` or other IDs

### Claude's Discretion
- Exact queue data structure (array, Map, etc.)
- Whether to add a max queue depth (to prevent memory issues from runaway queuing)
- Internal event bus for connection state changes (connected/disconnected/reconnecting)
- Error message wording for queue timeout failures

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RPC-01 | All gateway RPC calls route through the persistent WebSocket connection instead of opening ephemeral connections | Queue behavior added to `PersistentGatewayClient.call()` + `gatewayCall()` facade replaces all 24 `new GatewayRPCClient()` sites |
| RPC-02 | RPC calls made while the persistent connection is unavailable are queued and retried when the connection re-establishes | FIFO queue with 30s timeout in `PersistentGatewayClient`; drain on reconnect |
| RPC-03 | The `plugins.list` RPC call (which does not exist in the gateway) is replaced with `tools.catalog` and `config.get` in all call sites | 6 call sites identified; response mapping from tool-centric to plugin-centric documented |
| RPC-04 | The persistent client uses the correct gateway client ID (`openclaw-control-ui`) consistently across all connection paths | Verify both `PersistentGatewayClient` and removed `GatewayRPCClient` used same ID; ensure no stale references |
| RPC-05 | Extension lifecycle reconciliation and plugin/skill catalog queries use the persistent client instead of creating ephemeral connections | `extension-lifecycle.ts` (2 sites), `routes/plugins.ts` (3 sites), `routes/skills.ts` (3 sites) all migrate to facade |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | 8.20.0 | WebSocket transport | Already installed; `PersistentGatewayClient` and `GatewayRPCClient` both use it |
| `node:crypto` | built-in | `randomUUID()` for RPC correlation IDs | Already used in both clients |
| `node:events` | built-in | Could be used for connection state events | Optional -- simple callbacks may suffice |

### Supporting
No new dependencies. This phase is purely internal refactoring.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple array queue | `p-queue` or `bottleneck` | Unnecessary dep; the queue is trivial (FIFO array, 30s timeout per item) |
| Internal event emitter for state | Direct callbacks on `PersistentGatewayClient` | Event emitter adds flexibility but also complexity; callbacks are simpler for the 2-3 listeners needed |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Scope of Changes

```
apps/server/src/
  services/
    gateway-event-relay.ts    # MODIFY: Add queue to PersistentGatewayClient.call()
  agent-types/openclaw/
    gateway-rpc.ts            # REWRITE: Remove GatewayRPCClient, add gatewayCall() facade,
                              #          rewrite GroupChatRPCClient to use facade
  services/
    skill-store.ts            # MODIFY: 4 call sites -> gatewayCall()
    plugin-store.ts           # MODIFY: 3 call sites -> gatewayCall()
    extension-lifecycle.ts    # MODIFY: 2 call sites -> gatewayCall() + plugins.list replacement
    marketplace-client.ts     # MODIFY: 2 call sites -> gatewayCall() (signature change)
  routes/
    plugins.ts                # MODIFY: 3 call sites -> gatewayCall() + plugins.list replacement
    skills.ts                 # MODIFY: 3 call sites -> gatewayCall()
    oauth-proxy.ts            # MODIFY: 2 call sites -> gatewayCall()
    extension-credentials.ts  # MODIFY: 1 call site -> gatewayCall()
  agent-types/openclaw/
    adapter.ts                # MODIFY: translateRPC simplification (2 sites)
```

### Pattern 1: Queue-on-Disconnect in PersistentGatewayClient

**What:** When `call()` is invoked but `this.connected` is false (and the client is not closed), push the request onto a FIFO queue with a 30-second timeout timer. When the connection re-establishes (after the `connect` response succeeds), drain the queue in order.

**When to use:** Every RPC call that goes through the persistent client.

**Current code (gateway-event-relay.ts:430-443):**
```typescript
async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  if (!this.connected || !this.ws) {
    throw new Error(`Gateway not connected for instance ${this.instanceId}`);
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Gateway RPC timeout: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    this.pendingRequests.set(id, { resolve, reject, timer });
    this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}
```

**New pattern:**
```typescript
// New interface for queued items
interface QueuedRequest {
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

private requestQueue: QueuedRequest[] = [];

async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  if (this.closed) {
    throw new Error(`Gateway connection closed for instance ${this.instanceId}`);
  }

  // Connected: send immediately
  if (this.connected && this.ws) {
    return this.sendRPC(method, params, timeoutMs);
  }

  // Disconnected: queue with timeout
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove from queue on timeout
      const idx = this.requestQueue.findIndex(q => q.resolve === resolve);
      if (idx !== -1) this.requestQueue.splice(idx, 1);
      reject(new Error(
        `Gateway RPC queued timeout: ${method} -- connection not available within ${timeoutMs}ms`
      ));
    }, timeoutMs);

    this.requestQueue.push({ method, params, timeoutMs, resolve, reject, timer });
  });
}

private sendRPC(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Gateway RPC timeout: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    this.pendingRequests.set(id, { resolve, reject, timer });
    this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

private drainQueue(): void {
  const queue = this.requestQueue.splice(0); // Take all, clear queue
  for (const item of queue) {
    clearTimeout(item.timer);
    // Send each queued request; FIFO order preserved
    this.sendRPC(item.method, item.params, item.timeoutMs)
      .then(item.resolve)
      .catch(item.reject);
  }
}
```

**Integration point:** `drainQueue()` is called right after `this.connected = true` and `this.retryCount = 0` in the connect response handler (currently at line 216-218).

**Max queue depth recommendation:** 50 items. If the queue exceeds this, reject the oldest item with a "queue full" error before pushing the new one. This prevents memory issues if a service hammers RPC while disconnected.

### Pattern 2: gatewayCall() Facade

**What:** A single function that all call sites use instead of `new GatewayRPCClient()`. Looks up the persistent client for the instance, calls through it (which will queue if disconnected), and handles the response.

**Where:** In `gateway-rpc.ts` (replacing the `GatewayRPCClient` class).

```typescript
import { getGatewayClient } from '../../services/gateway-event-relay.js';

export async function gatewayCall(
  instanceId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const client = getGatewayClient(instanceId);
  if (!client) {
    throw new Error(
      `No gateway connection for instance ${instanceId}. ` +
      `Instance may not be running or connection not yet established.`
    );
  }
  return client.call(method, params, timeoutMs);
}
```

**Key design choice:** `getGatewayClient()` currently returns null if the client exists but is not connected (line 581: `client && client.isConnected`). This needs to change -- it should return the client even when disconnected (but not closed), because the queue handles the disconnect case. The check should be: "does a PersistentGatewayClient exist for this instance?" not "is it currently connected?"

**Updated `getGatewayClient`:**
```typescript
export function getGatewayClient(instanceId: string): PersistentGatewayClient | null {
  const client = connections.get(instanceId);
  return (client && !client.isClosed) ? client : null;
}
```

A new `isConnected` check might be needed for callers that want to know connection state (like `exec-approval.ts:31`), so expose a separate `isGatewayConnected(instanceId)` helper.

### Pattern 3: plugins.list Replacement via tools.catalog

**What:** Replace all 6 `plugins.list` RPC calls with `tools.catalog` + `config.get`, mapping the response shape.

**Current `plugins.list` expectations (from code analysis):**

1. **`extension-lifecycle.ts:230`** -- Expects `{ plugins: [{ pluginId, id, status, ... }] }`. Used to check plugin presence/absence after restart.

2. **`routes/plugins.ts:51`** -- Expects a flat array `[{ id, name, description, version, source, enabled, ... }]`. Used for gateway builtin plugin discovery.

3. **`routes/plugins.ts:122`** -- Same flat array. Used for plugin catalog (bundled section).

**`tools.catalog` response shape (from FEATURES.md, verified from gateway source):**
```typescript
{
  agentId: string,
  profiles: [{ id, label }],
  groups: [{
    id: string,           // group ID
    label: string,
    source: "core" | "plugin",
    pluginId?: string,    // present when source === "plugin"
    tools: [{
      id: string,
      label: string,
      description: string,
      source: string,
      pluginId?: string,
      optional?: boolean,
      defaultProfiles: string[]
    }]
  }]
}
```

**`config.get` response shape (from FEATURES.md):**
```typescript
{
  exists: boolean,
  valid: boolean,
  path: string,
  config: {
    plugins?: {
      entries?: Array<{
        id: string,
        // ... plugin config fields
      }>
    },
    // ... rest of OpenClaw config
  },
  hash: string,
  rawLength: number,
  issues: ConfigValidationIssue[]
}
```

**Mapping function:**
```typescript
interface PluginPresenceInfo {
  pluginId: string;
  loaded: boolean;       // true if tools.catalog has tools from this plugin
  toolCount: number;     // number of tools contributed
}

/**
 * Extract plugin presence from tools.catalog response.
 * Returns a Map of pluginId -> info for all plugins that have loaded tools.
 */
function extractPluginPresence(
  toolsCatalogResult: unknown,
): Map<string, PluginPresenceInfo> {
  const map = new Map<string, PluginPresenceInfo>();
  if (typeof toolsCatalogResult !== 'object' || toolsCatalogResult === null) return map;

  const result = toolsCatalogResult as Record<string, unknown>;
  const groups = Array.isArray(result.groups) ? result.groups : [];

  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const g = group as Record<string, unknown>;
    if (g.source === 'plugin' && typeof g.pluginId === 'string') {
      const tools = Array.isArray(g.tools) ? g.tools : [];
      map.set(g.pluginId, {
        pluginId: g.pluginId,
        loaded: true,
        toolCount: tools.length,
      });
    }
  }
  return map;
}
```

**For the `routes/plugins.ts` list endpoint (builtin discovery):**
The current code expects `plugins.list` to return an array of `{ id, name, description, version, source, enabled }` for built-in plugins. With `tools.catalog`, built-in plugins appear as tool groups with `source: "plugin"`. The mapping:
- `id` = `group.pluginId`
- `name` = `group.label`
- `source` = `"bundled"` (inferred from being in tools.catalog but not in DB)
- `enabled` = true (it has loaded tools, so it's enabled)
- `description`, `version` = not available from tools.catalog alone; use `config.get` to read `plugins.entries` for metadata

**For `extension-lifecycle.ts` reconciliation:**
The current code checks if a pluginId exists in the gateway's plugin list. With `tools.catalog`, check if any tool group has `pluginId === targetId && source === "plugin"`. Presence = loaded. Absence = not loaded (failed or not configured).

### Pattern 4: GroupChatRPCClient Migration

**What:** `GroupChatRPCClient.rpcCall()` currently creates ephemeral fallbacks. Simplify to always use the persistent client via `gatewayCall()`.

**Current code (gateway-rpc.ts:166-181):**
```typescript
private async rpcCall(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  if (this.instanceId) {
    const persistent = getGatewayClient(this.instanceId);
    if (persistent) {
      return persistent.call(method, params, timeoutMs);
    }
  }
  // Fallback to ephemeral
  const client = new GatewayRPCClient(this.endpoint, this.token);
  try {
    return await client.call(method, params, timeoutMs);
  } finally {
    client.close();
  }
}
```

**New code:**
```typescript
private async rpcCall(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  if (!this.instanceId) {
    throw new Error('instanceId required for gateway RPC');
  }
  return gatewayCall(this.instanceId, method, params, timeoutMs);
}
```

The constructor no longer needs `endpoint`/`token` since it delegates to the facade. However, `GroupChatRPCClient` still needs `instanceId` for `waitForChatCompletion`. Simplify the constructor to just `(instanceId: string)`.

### Pattern 5: marketplace-client Signature Change

**What:** `searchClawHub()` and `getClawHubExtensionInfo()` currently accept `(controlEndpoint, authToken, ...)`. Change to accept `(instanceId, ...)` and use `gatewayCall` internally.

**Current signature:**
```typescript
export async function searchClawHub(
  controlEndpoint: string,
  authToken: string,
  params: { ... },
): Promise<{ entries: ClawHubCatalogEntry[]; total: number; hasMore: boolean }>
```

**New signature:**
```typescript
export async function searchClawHub(
  instanceId: string,
  params: { ... },
): Promise<{ entries: ClawHubCatalogEntry[]; total: number; hasMore: boolean }>
```

All callers in `routes/plugins.ts` and `routes/skills.ts` have `instance.id` available, so this is a straightforward signature change.

### Pattern 6: extension-credentials.ts config.patch Call

**What:** The current code at `extension-credentials.ts:151` calls `rpc.call('config.patch', { path: configPath, value: secretRef })` which uses non-standard parameters (`path` and `value`). The gateway's actual `config.patch` accepts `{ raw: "<JSON5>", baseHash: "<hash>" }`.

**Analysis:** This call may be relying on a platform-bridge plugin method or may actually be broken. Either way, the migration to `gatewayCall` is straightforward -- change from `new GatewayRPCClient(...)` to `gatewayCall(instanceId, 'config.patch', { path: configPath, value: secretRef })`. The parameter format question is a separate concern (Phase 10: Config Lifecycle will address the correct `config.patch` format).

For this phase, simply route through `gatewayCall` and preserve the existing parameter format. If the platform-bridge plugin handles this, it will continue to work.

### Anti-Patterns to Avoid

- **Do NOT add ephemeral fallback logic to `gatewayCall()`.** The user decision is explicit: no ephemeral fallback. If the persistent client doesn't exist for an instance, throw. The queue handles the "temporarily disconnected" case.

- **Do NOT change `getGatewayClient` to return connected-only clients.** The whole point of the queue is that callers don't need to know connection state. Return the client if it exists and isn't closed.

- **Do NOT migrate `translateRPC` callers in this phase.** The `adapter.translateRPC` pattern is used by `routes/channels.ts`, `routes/rpc-proxy.ts`, `services/instance-manager.ts`, `services/snapshot-store.ts`, and `services/instance-models.ts`. These go through the adapter's persistent-then-ephemeral logic. In this phase, simplify `translateRPC` to use `gatewayCall`, but don't change the route-level callers of `translateRPC` -- they stay the same.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request queuing | Full-featured queue library | Simple array with splice/push + setTimeout | Max 50 items, FIFO only, 30s timeout -- trivial to implement |
| Connection state machine | Formal state machine library | Boolean flags (`connected`, `closed`) + queue drain trigger | Only 3 states: connected, disconnected-and-retrying, closed |
| Response shape mapping | Complex adapter/transformer layer | Single `extractPluginPresence()` function | The mapping is simple: filter groups by `source === 'plugin'`, extract `pluginId` |
| RPC timeout management | External timeout library | `setTimeout` + `clearTimeout` (already used) | Pattern is identical to existing `pendingRequests` implementation |

**Key insight:** This is a routing change, not a capability change. The RPC protocol, message formats, and timeout handling are all already implemented correctly. The only new capability is queueing, which is a ~30-line addition.

## Common Pitfalls

### Pitfall 1: getGatewayClient Returns Null for Disconnected Clients

**What goes wrong:** The current `getGatewayClient()` returns null if the client exists but is not connected (line 581). If this isn't changed, `gatewayCall()` will throw "No gateway connection" instead of queuing, defeating the purpose.

**Why it happens:** The function was designed for the old pattern where callers needed to know if they should use ephemeral fallback.

**How to avoid:** Change `getGatewayClient()` to return the client whenever it exists and isn't closed. Add a separate `isGatewayConnected(instanceId)` for callers that need the connection state check (like `exec-approval.ts` which needs to return 502 immediately if the gateway is down for approval responses).

**Warning signs:** RPC calls failing with "No gateway connection" when they should be queuing.

### Pitfall 2: Queue Items Not Cleaned Up on Client Close

**What goes wrong:** If `PersistentGatewayClient.close()` is called while items are in the queue, those promises hang forever.

**Why it happens:** The existing `close()` method cleans up `pendingRequests` (in-flight RPCs) but doesn't know about the new queue.

**How to avoid:** In `close()`, iterate `requestQueue`, clear each timer, reject each promise with "Gateway connection closed", then clear the array. Same pattern as the existing `pendingRequests` cleanup.

### Pitfall 3: Queue Drain Ordering vs Reconnect Timing

**What goes wrong:** `drainQueue()` sends all queued RPCs immediately after connection. But the connection might drop again during the drain, leaving some items sent and some not.

**Why it happens:** The queue drain races with potential connection instability.

**How to avoid:** Drain sequentially (FIFO). Each item sent via `sendRPC` gets tracked in `pendingRequests` -- if the connection drops, those in-flight requests are rejected by the existing `ws.on('close')` handler. The ones not yet sent remain in the queue (don't splice them all at once -- pop one at a time). Alternatively, accept the simpler "splice all, send all" approach and rely on `pendingRequests` rejection for any that fail mid-drain.

**Recommended approach:** The simpler "splice all, send all" is fine. If connection drops during drain, in-flight requests reject normally. The few milliseconds of drain time make mid-drain disconnection extremely unlikely, and the retry behavior handles it anyway.

### Pitfall 4: plugins.list Response Shape Assumptions in Consumers

**What goes wrong:** The current code in `routes/plugins.ts:52` expects `plugins.list` to return a flat array of plugin objects. After switching to `tools.catalog`, the shape is completely different. If the mapping function is wrong or incomplete, the UI shows no plugins.

**Why it happens:** `tools.catalog` groups tools by provider, not by plugin. A plugin contributes one or more tool groups. The mapping must aggregate correctly.

**How to avoid:** Write the `extractPluginPresence()` mapping function and test it against a real `tools.catalog` response from a running gateway. Verify that every plugin that has loaded tools appears in the result. For built-in plugin metadata (name, description, version), fall back to `config.get` -> `plugins.entries`.

**Warning signs:** Plugin list showing empty in the UI, or showing plugins without names/descriptions.

### Pitfall 5: translateRPC Callers Expect endpoint/token Arguments

**What goes wrong:** `adapter.translateRPC` receives `{ method, params, endpoint, token, instanceId }` from callers. After simplification, if the function signature changes but callers don't update, TypeScript will catch it at build time. But the callers (channels.ts, rpc-proxy.ts, instance-manager.ts, etc.) pass endpoint/token that are no longer needed.

**Why it happens:** The `AgentTypeAdapter` interface in `types.ts:143` defines `translateRPC` with endpoint/token parameters.

**How to avoid:** Keep the interface signature the same for this phase. Internally, `translateRPC` ignores endpoint/token and uses `gatewayCall(instanceId, method, params)`. The interface can be cleaned up in a later phase. This avoids touching the 8+ callers of `translateRPC`.

### Pitfall 6: exec-approval.ts Needs Synchronous Connection Check

**What goes wrong:** `routes/exec-approval.ts:31-33` calls `getGatewayClient(id)` and returns 502 immediately if null. This is correct behavior -- approval responses must be sent synchronously, not queued. If `getGatewayClient` is changed to return disconnected clients, this route would try to queue an approval response (which makes no sense -- approvals are time-sensitive).

**How to avoid:** Add an `isGatewayConnected(instanceId)` helper that returns the old behavior (connected only). Use this in exec-approval.ts. The approval route should NOT use `gatewayCall` facade -- it should check connectivity first and return 502 if down.

Alternatively, `gatewayCall` can accept an option `{ requireConnected: true }` that throws immediately instead of queuing.

## Code Examples

### Complete gatewayCall() Facade (Recommended Implementation)

```typescript
// Source: analysis of gateway-rpc.ts and gateway-event-relay.ts
import { getGatewayClient } from '../../services/gateway-event-relay.js';

/**
 * Unified gateway RPC facade. All gateway calls route through this function.
 * 
 * If the persistent client is connected, sends immediately.
 * If disconnected but client exists, queues the request (with timeout).
 * If no client exists, throws immediately.
 */
export async function gatewayCall(
  instanceId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const client = getGatewayClient(instanceId);
  if (!client) {
    throw new Error(
      `No gateway connection for instance ${instanceId}. ` +
      `Instance may not be running or persistent client not yet created.`
    );
  }
  return client.call(method, params, timeoutMs);
}
```

### Queue Implementation (in PersistentGatewayClient)

```typescript
// Source: analysis of gateway-event-relay.ts:430-443
private static readonly MAX_QUEUE_DEPTH = 50;

private requestQueue: QueuedRequest[] = [];

async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  if (this.closed) {
    throw new Error(`Gateway connection closed for instance ${this.instanceId}`);
  }
  if (this.connected && this.ws) {
    return this.sendRPC(method, params, timeoutMs);
  }
  // Queue with timeout
  if (this.requestQueue.length >= PersistentGatewayClient.MAX_QUEUE_DEPTH) {
    // Reject oldest to make room
    const oldest = this.requestQueue.shift()!;
    clearTimeout(oldest.timer);
    oldest.reject(new Error(`Gateway RPC queue overflow for instance ${this.instanceId}`));
  }
  return new Promise<unknown>((resolve, reject) => {
    const entry: QueuedRequest = {
      method, params, timeoutMs, resolve, reject,
      timer: setTimeout(() => {
        const idx = this.requestQueue.indexOf(entry);
        if (idx !== -1) this.requestQueue.splice(idx, 1);
        reject(new Error(
          `Gateway RPC queued timeout: ${method} -- no connection within ${timeoutMs}ms for instance ${this.instanceId}`
        ));
      }, timeoutMs),
    };
    this.requestQueue.push(entry);
  });
}
```

### plugins.list to tools.catalog Migration (for routes/plugins.ts list endpoint)

```typescript
// Source: analysis of routes/plugins.ts:46-78 and FEATURES.md tools.catalog shape

// Replace:
//   const rawList = await rpc.call('plugins.list', {}, 30_000);
// With:
const rawCatalog = await gatewayCall(instance.id, 'tools.catalog', { includePlugins: true }, 30_000);

// Map tools.catalog groups -> plugin info for builtin discovery
const catalogResult = rawCatalog as { groups?: Array<Record<string, unknown>> } | null;
const groups = catalogResult?.groups ?? [];

for (const group of groups) {
  if (group.source !== 'plugin' || typeof group.pluginId !== 'string') continue;
  const pluginId = group.pluginId as string;
  if (managedIds.has(pluginId)) continue; // skip DB-managed plugins

  // This is a gateway builtin plugin (not in our DB)
  gatewayBuiltins.push({
    id: pluginId,
    name: (group.label as string) ?? pluginId,
    description: '',  // Not available from tools.catalog; could fetch from config.get
    version: '0.0.0', // Not available from tools.catalog
    source: 'bundled',
    enabled: true,     // Has loaded tools = enabled
  });
}
```

### Simplified translateRPC (in adapter.ts)

```typescript
// Source: analysis of adapter.ts:825-879
async translateRPC({ method, params, endpoint, token, instanceId }) {
  const timeoutMs = method === 'web.login.wait' ? 180_000
    : method.startsWith('web.login.') ? 60_000
    : 30_000;

  if (!instanceId) {
    throw new Error('instanceId required for translateRPC');
  }

  return gatewayCall(instanceId, method, params, timeoutMs);
}
```

The entire retry-with-delay loop (adapter.ts:839-878) and ephemeral fallback are eliminated. The queue in `PersistentGatewayClient` handles the reconnect case.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Open ephemeral WS per RPC call | Multiplex over persistent WS | Phase 9 (this phase) | Eliminates ~100-300ms handshake latency per call, reduces connection count |
| `plugins.list` RPC | `tools.catalog` + `config.get` | Phase 9 (this phase) | `plugins.list` never existed in gateway; was always failing silently |
| Throw on disconnect | Queue with 30s timeout | Phase 9 (this phase) | Handles transient disconnects without caller complexity |

## Open Questions

1. **exec-approval.ts behavior after getGatewayClient change**
   - What we know: The approval route needs synchronous "is connected" check, not queue behavior
   - What's unclear: Whether to add a separate `isGatewayConnected()` helper or use a `gatewayCall` option
   - Recommendation: Add `isGatewayConnected(instanceId)` as a separate export. Keep exec-approval.ts using direct `getGatewayClient()` with explicit `isConnected` check. Simple, no ambiguity.

2. **config.patch parameter format in extension-credentials.ts**
   - What we know: The code sends `{ path, value }` which is not the standard `{ raw, baseHash }` format
   - What's unclear: Whether this works via platform-bridge plugin or is silently failing
   - Recommendation: Preserve current behavior in this phase (just change the transport). Phase 10 (Config Lifecycle) will address the correct config.patch format.

3. **Built-in plugin metadata (name, description, version) from tools.catalog**
   - What we know: `tools.catalog` provides `group.label` but not `description` or `version` for plugins
   - What's unclear: Whether consumers need this metadata or can live without it
   - Recommendation: Use `group.label` for name, empty string for description, `'0.0.0'` for version. If full metadata is needed, add a `config.get` call to read `plugins.entries` and cross-reference. The current `plugins.list` call was failing silently anyway, so the builtin section was already empty for many users.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (E2E only, no unit tests) |
| Config file | `playwright.config.ts` |
| Quick run command | `npx playwright test tests/e2e/api.spec.ts` |
| Full suite command | `npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RPC-01 | All RPC routes through persistent WS | manual-only | N/A -- requires running gateway container | N/A |
| RPC-02 | Queue + retry on disconnect | manual-only | N/A -- requires simulating WS disconnect | N/A |
| RPC-03 | plugins.list replaced with tools.catalog | manual-only | N/A -- requires running gateway with plugins | N/A |
| RPC-04 | Correct client ID | manual-only | N/A -- inspect WS handshake in running system | N/A |
| RPC-05 | Extension lifecycle uses persistent client | manual-only | N/A -- requires running instance with extensions | N/A |

**Justification for manual-only:** All RPC requirements require a running OpenClaw gateway container. CI skips Docker-dependent tests (`CI=true`). There is no mock gateway WebSocket server (pitfall P22 from PITFALLS.md). Building a mock gateway is out of scope for this phase.

### Sampling Rate
- **Per task commit:** `npm run typecheck` (verify no type errors from signature changes)
- **Per wave merge:** `npm run typecheck && npm run lint`
- **Phase gate:** Full typecheck + manual test with running instance (smoke test plugin list, skill list, chat send, exec approval)

### Wave 0 Gaps
- None for automated testing (no mock gateway available)
- Manual testing requires: running instance with at least one plugin and one skill installed, verifying that the list/catalog endpoints return correct data after migration

## Sources

### Primary (HIGH confidence)
- Aquarium source: `apps/server/src/services/gateway-event-relay.ts` -- PersistentGatewayClient implementation, connection lifecycle, `call()` method, reconnect logic
- Aquarium source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts` -- GatewayRPCClient class (to be removed), GroupChatRPCClient
- Aquarium source: `apps/server/src/agent-types/openclaw/adapter.ts:825-878` -- translateRPC with persistent-then-ephemeral pattern
- Aquarium source: `apps/server/src/services/extension-lifecycle.ts:133-316` -- reconcileExtensions with `plugins.list` (broken) and `skills.list`
- Aquarium source: `apps/server/src/routes/plugins.ts:49-77,119-132` -- plugins.list call sites
- Aquarium source: `apps/server/src/services/marketplace-client.ts:113-163,170-190` -- searchClawHub, getClawHubExtensionInfo
- Project research: `.planning/research/FEATURES.md` -- tools.catalog response shape, config.get response shape, verified from OpenClaw source
- Project research: `.planning/research/ARCHITECTURE.md` -- gatewayCall facade design, migration table
- Project research: `.planning/research/PITFALLS.md` -- P10 (ephemeral connections), P21 (client ID), P22 (no mock gateway for CI)

### Secondary (MEDIUM confidence)
- Project research: `.planning/research/SUMMARY.md` -- Phase ordering rationale
- CONTEXT.md: User decisions on queue behavior, client ID, plugins.list replacement strategy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new deps, all existing libraries verified
- Architecture: HIGH -- all 24 call sites identified and analyzed from source code; response shapes verified from gateway source
- Pitfalls: HIGH -- pitfalls derived from actual code analysis, not theoretical concerns
- plugins.list replacement: HIGH -- tools.catalog response shape verified from OpenClaw source; current plugins.list calls confirmed to fail silently

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- internal refactoring with no external dependency changes)
