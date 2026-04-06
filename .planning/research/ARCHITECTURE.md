# Architecture Patterns: Gateway Communication Overhaul

**Domain:** Platform-gateway communication redesign for Aquarium CE
**Researched:** 2026-04-05
**Confidence:** HIGH (based on Aquarium source code + verified OpenClaw gateway source findings from FEATURES.md)

---

## 1. Current Architecture (As-Is)

### Communication Topology

```
                      +--------------------------+
                      |   Browser Clients (WS)   |
                      +------------+-------------+
                                   ^
                                   | WebSocket broadcast
                      +------------+-------------+
                      |   Express Server          |
                      |                           |
                      |  Routes --> Services ----> |---+
                      |                           |   |
                      |  +---------------------+  |   |
                      |  | PersistentGateway   |<-----+  (event relay)
                      |  | Client (1 per inst) |  |   |
                      |  | gateway-event-      |  |   |
                      |  | relay.ts            |  |   |
                      |  +----------+----------+  |   |
                      |             |              |   |
                      |  +----------+----------+  |   |
                      |  | GatewayRPCClient    |<-----+  (ephemeral fallback)
                      |  | gateway-rpc.ts      |  |
                      |  | (one-shot WS)       |  |
                      |  +----------+----------+  |
                      +-------------|-------------+
                                    |  WebSocket (proto v3)
                      +-------------v-------------+
                      | OpenClaw Gateway Container |
                      | (per instance, :18789)     |
                      +----------------------------+
```

### Two Communication Paths (Current)

| Path | Client | Lifecycle | Used By |
|------|--------|-----------|---------|
| Persistent | `PersistentGatewayClient` in `gateway-event-relay.ts` | Per-instance, auto-reconnect, 5s delay, max 5 retries | Event relay, `translateRPC` (primary), `GroupChatRPCClient` (primary) |
| Ephemeral | `GatewayRPCClient` in `gateway-rpc.ts` | One-shot: open WS -> handshake -> 1 RPC -> close | `translateRPC` (fallback), `extension-lifecycle.ts` (direct), `plugin-store.ts` (direct), `skill-store.ts` (direct) |

### Current Data Flow Patterns

**Pattern A: Config Update (DB-First)** -- `patchGatewayConfig()` in `instance-manager.ts:736-845`
1. Fetch instance from DB
2. Deep-merge configPatch into DB config
3. Persist merged config to DB (line 774)
4. If running: fetch gateway hash, `reseedConfigFiles()`, read back full JSON, `config.patch { raw }` with retry
5. On gateway failure: log and continue (DB already updated -- split-brain)

**Pattern B: Extension Activate (Restart-Heavy)** -- `_activatePluginWithLock()` in `plugin-store.ts:103-250`
1. DB: status -> 'active'
2. `restartInstance()` (stop container + start fresh + reseedConfig)
3. Health check via `platform.ping` (ephemeral RPC)
4. On failure: DB: status -> 'failed', restart again (rollback = double restart)

**Pattern C: Extension Reconcile (Boot-Only)** -- `reconcileExtensions()` in `extension-lifecycle.ts:133-316`
1. Create ephemeral `GatewayRPCClient`
2. Call `skills.list` and `plugins.list` (NOTE: `plugins.list` does not exist in gateway -- see Section 2)
3. Compare gateway state with DB state; promote/demote
4. Close ephemeral client
5. Only runs once per instance boot

**Pattern D: Health Monitor (Docker-Level Polling)** -- `health-monitor.ts`
- Fast loop (5s): `engine.getStatus()` for `starting` instances
- Slow loop (30s): `engine.getStatus()` for `running`/`error` + config integrity + disk + security
- No gateway-level health check (only Docker container status)
- `checkConfigIntegrity()`: SHA-256 hash comparison, triggers `reseedConfigFiles()` on mismatch

---

## 2. Verified Gateway Constraints (from OpenClaw Source)

These findings are from direct OpenClaw gateway source code analysis (see FEATURES.md for full line-number citations). They fundamentally shape the architecture.

### Constraint 1: No Events for Config/Plugin/Skill Changes

The gateway's `GATEWAY_EVENTS` array contains 24 event types. NONE relate to config changes, plugin load/fail, or skill load/fail. The gateway does NOT broadcast:
- `config.changed` -- does not exist
- `plugin.loaded` / `plugin.failed` -- do not exist
- `skill.loaded` / `skill.failed` -- do not exist

**Architectural consequence:** Event-driven DB sync for these state changes is impossible with the current gateway. The sync pattern must be: **shutdown event -> reconnect -> query state after restart**.

### Constraint 2: config.patch Uses Merge-Patch via `raw` String

`config.patch` accepts `{ raw: "<JSON5 string>", baseHash: "<hash>" }`. The `raw` parameter is parsed as JSON5, then applied as an RFC 7396 merge-patch (not full replacement):
- `null` values delete keys
- Object values merge recursively
- Array values merge entries by `id` field
- Non-object values replace directly

**Architectural consequence:** To update config, send a JSON5 string containing only the delta. The gateway merges it into its current config. There is no `{ patch: {...} }` parameter -- the raw string IS the patch.

### Constraint 3: Plugin Changes Trigger Full Gateway Restart

The config-reload-plan classifies `plugins.*` as `kind: "restart"`. When `config.patch` touches any `plugins.*` key, the gateway:
1. Writes the merged config to disk
2. Schedules `SIGUSR1` restart
3. The gateway process restarts

**Architectural consequence:** There is NO hot-reload for plugins. Every plugin activation/deactivation causes a gateway process restart. The platform must handle the reconnect cycle.

### Constraint 4: shutdown Event Signals Clean Restart

The gateway emits `{ type: "event", event: "shutdown", payload: { reason, restartExpectedMs? } }` before clean restarts. This is the signal to expect a reconnect cycle.

### Constraint 5: No `plugins.list` RPC

There is no `plugins.list` method in the gateway. Plugin state is observable through:
- `tools.catalog` with `includePlugins: true` -- lists plugin-contributed tools grouped by pluginId
- `config.get` -- returns full config including `plugins.entries`

**Architectural consequence:** The current `reconcileExtensions()` call to `plugins.list` will fail silently (the code catches the error). Must be replaced with `tools.catalog` + `config.get`.

### Constraint 6: HTTP `/ready` for Health Checks

The gateway exposes:
- `/health` / `/healthz` -- liveness (always 200 if HTTP server up)
- `/ready` / `/readyz` -- readiness (`{ ready: boolean, failing: string[], uptimeMs: number }`)

These are HTTP endpoints, independent of the WebSocket connection.

### Constraint 7: Rate Limit of 3 Writes per 60 Seconds

`config.patch`, `config.apply`, and `update.run` share a rate limit of 3 calls per 60 seconds per device/IP. Enforced at the gateway method handler level.

---

## 3. Recommended Architecture (To-Be)

### Design Principle

```
OPERATE on gateway (via persistent WS RPC) -->
  ON SUCCESS: read back actual state -->
    SYNC DB as cache of gateway state -->
      ON RESTART: detect via shutdown event -> reconnect -> query -> sync
        ON COLD START: seed config from DB -> boot -> reconcile
```

The gateway is authoritative when running. The DB is a persistent cache. Because the gateway emits no events for config/plugin/skill changes, we cannot do push-based sync. Instead: **command-then-readback** for mutations and **reconnect-then-query** for restart detection.

### Target Topology

```
                       +--------------------------+
                       |   Browser Clients (WS)   |
                       +------------+-------------+
                                    ^
                                    | WebSocket broadcast
                       +------------|-------------+
                       |   Express Server          |
                       |                           |
                       |  Routes --> Services       |
                       |               |            |
                       |  +-----------v----------+  |
                       |  | gatewayCall()        |  |  <-- unified RPC routing
                       |  | (gateway-rpc.ts)     |  |
                       |  +----------+-----------+  |
                       |             |               |
                       |  +----------v-----------+  |
                       |  | PersistentGateway    |  |  <-- refactored: sole RPC transport
                       |  | Client (1 per inst)  |  |      + shutdown event handling
                       |  +----------+-----------+  |      + reconnect state query
                       |             |               |
                       |  +----------v-----------+  |
                       |  | GatewayStateSyncer   |  |  <-- NEW: reconnect-then-query sync
                       |  | (gateway-sync.ts)    |  |
                       |  +----------------------+  |
                       |             |               |
                       |  +----------v-----------+  |
                       |  | Health (HTTP /ready)  |  |  <-- NEW: gateway-level health
                       |  +----------------------+  |
                       +-------------|-------------+
                                     |
                       +-------------v-----------+
                       | OpenClaw Gateway         |
                       +-------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| `PersistentGatewayClient` | WS lifecycle, reconnect, RPC send/receive, event relay | Gateway WS | **Refactor** -- add shutdown event handler, reconnect-with-query |
| `gatewayCall()` | Unified RPC routing: persistent-first, ephemeral-only for startup race | PersistentGatewayClient, (GatewayRPCClient fallback) | **New function** in refactored `gateway-rpc.ts` |
| `GatewayStateSyncer` | Query gateway state after reconnect, sync to DB | gatewayCall, DB | **New service** `gateway-sync.ts` |
| `instance-manager.ts` | Instance lifecycle, gateway-first config updates | gatewayCall, DB | **Modify** -- rewrite `patchGatewayConfig` |
| `health-monitor.ts` | Docker health + gateway HTTP `/ready` checks | Runtime engine, HTTP fetch, DB | **Modify** -- add `/ready` polling |
| `extension-lifecycle.ts` | Boot-time + post-restart reconciliation | gatewayCall (for `tools.catalog`, `skills.status`, `config.get`) | **Modify** -- fix RPC methods, route through facade |
| `plugin-store.ts` | Plugin CRUD | gatewayCall, DB | **Modify** -- config.patch instead of restartInstance, handle restart cycle |
| `skill-store.ts` | Skill CRUD | gatewayCall, DB | **Modify** -- route through facade (already uses RPC for enable/disable) |

---

## 4. Detailed Integration Design

### 4.1 PersistentGatewayClient Refactoring

**Current problems:**
- `call()` throws if not connected (line 431-432) -- callers must pre-check
- Ephemeral `GatewayRPCClient` used directly by 4+ services as workaround
- No handling of `shutdown` event (the critical restart signal)
- No reconnect state query after the connection re-establishes

**Changes:**

```typescript
// 1. Handle shutdown event (in the event dispatch branch, ~line 365):
if (msg.event === 'shutdown') {
  const payload = msg.payload as { reason?: string; restartExpectedMs?: number };
  this.expectedRestart = true;
  this.expectedRestartMs = payload.restartExpectedMs ?? 30_000;
  console.log(`[gateway-relay] Shutdown event for ${this.instanceId}: ${payload.reason}`);
  // Connection will close; reconnect logic will fire
  // On successful reconnect, trigger state sync (see step 3)
  return;
}

// 2. Add request queue for calls during reconnect window:
private pendingQueue: Array<{
  method: string; params: Record<string, unknown>;
  timeoutMs: number; resolve: Function; reject: Function;
}> = [];

async call(method, params, timeoutMs): Promise<unknown> {
  if (this.connected && this.ws) {
    return this.sendRPC(method, params, timeoutMs);
  }
  if (this.closed) throw new Error('Connection closed');
  // Queue request -- will be drained after reconnect
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for reconnect')), timeoutMs);
    this.pendingQueue.push({ method, params, timeoutMs, resolve, reject });
  });
}

// 3. After successful reconnect (in the connect response handler, after line 222):
this.connected = true;
this.retryCount = 0;
this.drainQueue(); // send queued RPCs
if (this.expectedRestart) {
  this.expectedRestart = false;
  // Trigger post-restart state sync
  syncGatewayStateAfterRestart(this.instanceId).catch(err =>
    console.warn(`[gateway-relay] Post-restart sync failed for ${this.instanceId}:`, err)
  );
}

// 4. Add ping/pong heartbeat for WS-level liveness:
// In connect(), after auth succeeds:
this.heartbeatInterval = setInterval(() => {
  if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
}, 30_000);
```

**What stays the same:** DLP filtering, chat session routing, exec approval handling, the `connections` Map, `reconcileConnections()` poll.

### 4.2 Unified RPC Facade (`gatewayCall()`)

The current `GatewayRPCClient` class becomes an internal-only ephemeral fallback. The public API:

```typescript
// In gateway-rpc.ts (refactored):

export async function gatewayCall(
  instanceId: string,
  method: string,
  params: Record<string, unknown>,
  opts?: { timeoutMs?: number; requirePersistent?: boolean }
): Promise<unknown> {
  const persistent = getGatewayClient(instanceId);
  if (persistent) {
    return persistent.call(method, params, opts?.timeoutMs ?? 30_000);
  }
  if (opts?.requirePersistent) {
    throw new Error(`No persistent connection for ${instanceId}`);
  }
  // Ephemeral fallback for startup race window only
  const { endpoint, token } = await getInstanceConnection(instanceId);
  const client = new GatewayRPCClient(endpoint, token);
  try {
    const result = await client.call(method, params, opts?.timeoutMs ?? 30_000);
    // Side-effect: if ephemeral worked, force-reconnect persistent
    if (!getGatewayClient(instanceId)) {
      connectGateway(instanceId, endpoint, token);
    }
    return result;
  } finally {
    client.close();
  }
}
```

**Migration table:**

| Current Call Site | Current Pattern | New Pattern |
|-------------------|----------------|-------------|
| `extension-lifecycle.ts:145` | `new GatewayRPCClient(ep, tok); rpc.call('skills.list')` | `gatewayCall(id, 'skills.status', {})` (correct method) |
| `extension-lifecycle.ts:228` | `new GatewayRPCClient(ep, tok); rpc.call('plugins.list')` | `gatewayCall(id, 'tools.catalog', { includePlugins: true })` (plugins.list does not exist) |
| `plugin-store.ts:132` | `new GatewayRPCClient(...)` for `plugins.install` | `gatewayCall(id, 'plugins.install', {...})` |
| `plugin-store.ts:209` | `new GatewayRPCClient(...)` for `platform.ping` | `gatewayCall(id, 'platform.ping', {})` or HTTP `/ready` |
| `skill-store.ts:165` | `new GatewayRPCClient(ep, tok)` for `skills.install` | `gatewayCall(id, 'skills.install', {...})` |
| `skill-store.ts:288-293` | `new GatewayRPCClient(ep, tok)` for `skills.update` | `gatewayCall(id, 'skills.update', {...})` |
| `adapter.ts:825` | `translateRPC` tries persistent then ephemeral | Delegate to `gatewayCall(instanceId, method, params)` |

**Impact:** `adapter.translateRPC` becomes a thin wrapper. The retry-with-delay loop in adapter.ts (lines 843-878) moves into `gatewayCall` or is removed (persistent client handles reconnect).

### 4.3 GatewayStateSyncer (New: `gateway-sync.ts`)

**Why NOT event-driven sync:** The gateway emits zero events for config/plugin/skill state changes. There is nothing to subscribe to.

**The actual pattern: Reconnect-Then-Query**

```typescript
// gateway-sync.ts

import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
import { db } from '../db/index.js';

/**
 * Called after PersistentGatewayClient reconnects following a shutdown event
 * or after any reconnect to a running instance.
 *
 * Queries the gateway for current state and syncs DB.
 */
export async function syncGatewayStateAfterRestart(instanceId: string): Promise<void> {
  // 1. Sync config state
  const configResult = await gatewayCall(instanceId, 'config.get', {}) as {
    config?: Record<string, unknown>;
    hash?: string;
  };
  if (configResult?.config && configResult?.hash) {
    await db('instances').where({ id: instanceId }).update({
      config: JSON.stringify(configResult.config),
      config_hash: configResult.hash,
      updated_at: db.fn.now(),
    });
  }

  // 2. Sync skill state via skills.status
  const skillsResult = await gatewayCall(instanceId, 'skills.status', {}) as {
    skills?: Array<{ name: string; eligible: boolean; disabled: boolean; missing?: { envVars?: string[] } }>;
  };
  if (skillsResult?.skills) {
    await syncSkillsFromGateway(instanceId, skillsResult.skills);
  }

  // 3. Sync plugin state via tools.catalog
  const toolsResult = await gatewayCall(instanceId, 'tools.catalog', { includePlugins: true }) as {
    groups?: Array<{ id: string; source: string; pluginId?: string; tools: unknown[] }>;
  };
  if (toolsResult?.groups) {
    await syncPluginsFromToolsCatalog(instanceId, toolsResult.groups);
  }
}

async function syncSkillsFromGateway(instanceId: string, gatewaySkills: Array<Record<string, unknown>>): Promise<void> {
  const dbSkills = await db('instance_skills').where({ instance_id: instanceId });
  const gatewaySkillNames = new Set(gatewaySkills.map(s => s.name as string));

  for (const dbSkill of dbSkills) {
    const skillId = dbSkill.skill_id as string;
    const gwSkill = gatewaySkills.find(s => s.name === skillId);
    const inGateway = gatewaySkillNames.has(skillId);

    if (dbSkill.status === 'active' && !inGateway) {
      // Was active but gone after restart -- mark failed
      await db('instance_skills').where({ instance_id: instanceId, skill_id: skillId })
        .update({ status: 'failed', error_message: 'Not found after gateway restart', updated_at: db.fn.now() });
    } else if (dbSkill.status === 'pending' && inGateway) {
      // Completed during restart -- promote
      await db('instance_skills').where({ instance_id: instanceId, skill_id: skillId })
        .update({ status: 'active', pending_owner: null, updated_at: db.fn.now() });
    }
    // Other states: leave as-is
  }
}

async function syncPluginsFromToolsCatalog(
  instanceId: string,
  groups: Array<{ id: string; source: string; pluginId?: string; tools: unknown[] }>,
): Promise<void> {
  const pluginGroups = groups.filter(g => g.source === 'plugin' && g.pluginId);
  const activePluginIds = new Set(pluginGroups.map(g => g.pluginId!));

  const dbPlugins = await db('instance_plugins').where({ instance_id: instanceId });

  for (const dbPlugin of dbPlugins) {
    const pluginId = dbPlugin.plugin_id as string;
    const inGateway = activePluginIds.has(pluginId);

    if (dbPlugin.status === 'active' && !inGateway) {
      await db('instance_plugins').where({ instance_id: instanceId, plugin_id: pluginId })
        .update({ status: 'failed', error_message: 'Plugin not loaded after gateway restart', updated_at: db.fn.now() });
    } else if (dbPlugin.status === 'pending' && inGateway) {
      await db('instance_plugins').where({ instance_id: instanceId, plugin_id: pluginId })
        .update({ status: 'active', pending_owner: null, updated_at: db.fn.now() });
    }
  }
}
```

**Integration point:** Called from `PersistentGatewayClient` after reconnect (see Section 4.1, step 3).

**Also called from:** `reconcileExtensions()` at boot time (replaces current ephemeral RPC pattern).

### 4.4 Gateway-First `patchGatewayConfig`

**Current flow (instance-manager.ts:736-845):**
1. Deep-merge configPatch into DB config, persist to DB (line 774)
2. If running: reseedConfigFiles() + config.patch { raw } with retry
3. On gateway fail: log and ignore (DB already dirty)

**New flow:**

```typescript
export async function patchGatewayConfig(
  instanceId: string,
  userId: string,
  configPatch: Record<string, unknown>,
  note?: string,
): Promise<void> {
  const instance = await getInstance(instanceId, userId);
  if (!instance) throw new Error('Instance not found');
  await safeAutoSnapshot(instanceId, userId, 'Gateway config change');

  // NOT RUNNING: DB-only update (correct -- config seeds on next start)
  if (instance.status !== 'running' || !instance.controlEndpoint) {
    const mergedConfig = deepMerge(
      (instance.config || {}) as Record<string, unknown>,
      configPatch,
    );
    await updateInstanceConfig(instanceId, userId, mergedConfig);
    return;
  }

  // RUNNING: Gateway-first via merge-patch
  // 1. Get current gateway config hash for optimistic concurrency
  const cfgResult = await gatewayCall(instanceId, 'config.get', {}) as {
    config?: Record<string, unknown>;
    hash?: string;
  };
  const baseHash = cfgResult?.hash;

  // 2. Send merge-patch via raw string
  //    The gateway applies RFC 7396 merge-patch semantics:
  //    - null values delete keys
  //    - Objects merge recursively
  //    - Arrays merge by id field
  const rawPatch = JSON.stringify(configPatch);
  await gatewayCall(instanceId, 'config.patch', {
    raw: rawPatch,
    baseHash,
    note: note || 'Platform config update',
  });

  // 3. config.patch may trigger gateway restart (for plugins.* changes).
  //    The shutdown event handler + reconnect + syncGatewayStateAfterRestart
  //    will update the DB automatically.
  //
  //    For non-restart changes (models, hooks, cron), read back immediately:
  const isRestartTrigger = configPatch.plugins !== undefined || configPatch.gateway !== undefined;
  if (!isRestartTrigger) {
    const updatedResult = await gatewayCall(instanceId, 'config.get', {}) as {
      config?: Record<string, unknown>;
      hash?: string;
    };
    if (updatedResult?.config) {
      await updateInstanceConfig(instanceId, userId, updatedResult.config);
    }
    if (updatedResult?.hash) {
      await db('instances').where({ id: instanceId }).update({ config_hash: updatedResult.hash });
    }
  }
  // For restart-triggering changes, syncGatewayStateAfterRestart handles DB update
}
```

**Key differences from current:**
- DB is NOT written before gateway confirms (eliminates split-brain)
- Uses `{ raw: JSON.stringify(delta) }` (correct merge-patch format)
- Uses `baseHash` for optimistic concurrency (from config.get)
- No `reseedConfigFiles()` call
- No 3-second `setTimeout` hack
- Restart-triggering changes are handled asynchronously via reconnect sync

### 4.5 `reseedConfigFiles` -- When Still Needed vs. Eliminated

**ELIMINATED for running instances:**
- `patchGatewayConfig` no longer calls reseed
- `checkConfigIntegrity` no longer triggers reseed (DB syncs FROM gateway)
- Plugin enable/disable no longer restarts (uses config.patch)

**STILL NEEDED (rename to `seedInitialConfig`):**
- Instance creation (`startInstanceAsync` line 498-521) -- initial seed before gateway boots
- Error recovery (`checkInstances` line 120) -- pod recovered, gateway may have lost state
- Manual restart (`restartInstance` line 675) -- stop + start triggers full reseed

### 4.6 Health Monitor Changes

**Add gateway-level health via HTTP `/ready`:**

```typescript
import http from 'node:http';

async function checkGatewayReadiness(): Promise<void> {
  const rows = await db('instances')
    .where({ status: 'running' })
    .whereNotNull('control_endpoint');

  for (const row of rows) {
    try {
      // control_endpoint is ws://host:port/ws -- derive HTTP URL
      const wsUrl = new URL(row.control_endpoint as string);
      const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}/ready`;

      const result = await fetchReadiness(httpUrl, 5_000);

      if (!result.ready) {
        broadcast(row.id, {
          type: 'instance:status',
          instanceId: row.id,
          payload: {
            status: 'running',
            statusMessage: `Gateway degraded: ${result.failing.join(', ')}`,
          },
        });
      }
    } catch {
      // HTTP unreachable -- Docker-level check will handle
    }
  }
}
```

**Replace `checkConfigIntegrity` with gateway-authoritative sync:**

```typescript
async function checkConfigIntegrity(): Promise<void> {
  // Instead of: hash on-disk file -> compare -> reseed
  // Now: query gateway -> sync DB if different
  for (const row of runningInstances) {
    try {
      const gwConfig = await gatewayCall(row.id, 'config.get', {}) as {
        config?: Record<string, unknown>;
        hash?: string;
      };
      if (gwConfig?.hash && gwConfig.hash !== row.config_hash) {
        // Gateway has different config -- sync DB FROM gateway
        if (gwConfig.config) {
          await db('instances').where({ id: row.id }).update({
            config: JSON.stringify(gwConfig.config),
            config_hash: gwConfig.hash,
            updated_at: db.fn.now(),
          });
        }
      }
    } catch { /* skip */ }
  }
}
```

### 4.7 Extension Activation via config.patch (Replacing Restart)

**CRITICAL: Plugin changes trigger gateway restart.** This is a gateway constraint (Section 2, Constraint 3). However, the restart is INTERNAL to the gateway process -- the container stays running. The platform does NOT need to call `restartInstance()`.

**New plugin activation flow:**

```typescript
async function _activatePluginWithLock(instanceId, pluginId, userId, fencingToken, operationId): Promise<InstancePlugin> {
  // 1. Build the config delta for this plugin
  const pluginConfig = buildPluginConfigEntry(pluginId, existing.source, existing.config);

  // 2. Get current config hash
  const cfgResult = await gatewayCall(instanceId, 'config.get', {}) as { hash?: string };

  // 3. Send config.patch -- gateway will restart internally (SIGUSR1)
  await gatewayCall(instanceId, 'config.patch', {
    raw: JSON.stringify({ plugins: { entries: [pluginConfig] } }),
    baseHash: cfgResult?.hash,
    note: `Activate plugin: ${pluginId}`,
  });

  // 4. Gateway will:
  //    a. Apply merge-patch (arrays merge by id)
  //    b. Write config to disk
  //    c. Schedule SIGUSR1 restart
  //    d. Emit shutdown event
  //    e. Process restarts
  //    f. Persistent WS reconnects
  //    g. syncGatewayStateAfterRestart() queries tools.catalog
  //    h. DB is updated with actual plugin state

  // 5. Wait for reconnect + state sync to complete
  //    (implement as a Promise that resolves when syncGatewayStateAfterRestart finishes)
  await waitForGatewayRestart(instanceId, { timeoutMs: 60_000 });

  // 6. Verify plugin loaded
  const toolsResult = await gatewayCall(instanceId, 'tools.catalog', { includePlugins: true });
  const pluginLoaded = toolsResult.groups?.some(g => g.pluginId === pluginId);

  if (!pluginLoaded) {
    // Rollback: remove plugin from config
    await gatewayCall(instanceId, 'config.patch', {
      raw: JSON.stringify({ plugins: { entries: [{ id: pluginId, _delete: true }] } }),
      note: `Rollback failed plugin: ${pluginId}`,
    });
    await db('instance_plugins').where({ instance_id: instanceId, plugin_id: pluginId })
      .update({ status: 'failed', error_message: 'Plugin did not load after gateway restart' });
    throw new Error('Plugin activation failed');
  }

  // 7. DB already updated by syncGatewayStateAfterRestart -- just return
  return (await getPluginById(instanceId, pluginId))!;
}
```

**Key differences from current:**
- No `restartInstance()` -- container stays running, only gateway process restarts
- No double-restart for rollback -- send another config.patch to remove the plugin
- `waitForGatewayRestart()` replaces the `platform.ping` health check
- Verification via `tools.catalog` instead of `plugins.list` (which does not exist)

**Rate limit handling:** Since config.patch is limited to 3/min, batch multiple plugin changes:

```typescript
// When activating multiple plugins, merge into one config.patch:
const pluginEntries = pluginIds.map(id => buildPluginConfigEntry(id, ...));
await gatewayCall(instanceId, 'config.patch', {
  raw: JSON.stringify({ plugins: { entries: pluginEntries } }),
  baseHash,
  note: `Activate ${pluginIds.length} plugins`,
});
// One restart instead of N restarts
```

### 4.8 `reconcileExtensions` Changes

**Current issues:**
- Calls `plugins.list` which does not exist in the gateway
- Uses ephemeral `GatewayRPCClient` directly
- Only runs at boot

**New implementation:**

```typescript
export async function reconcileExtensions(instanceId: string): Promise<ReconcileResult> {
  // Skills: use skills.status (verified RPC)
  const skillsResult = await gatewayCall(instanceId, 'skills.status', {}, { timeoutMs: 15_000 });
  // ... reconcile skills against DB ...

  // Plugins: use tools.catalog (plugins.list does not exist)
  const toolsResult = await gatewayCall(instanceId, 'tools.catalog', { includePlugins: true }, { timeoutMs: 15_000 });
  const activePluginIds = new Set(
    toolsResult.groups?.filter(g => g.source === 'plugin').map(g => g.pluginId) ?? []
  );
  // ... reconcile plugins against DB ...

  return { promoted, demoted, unchanged };
}
```

**Signature change:** Remove `controlEndpoint` and `authToken` params (gatewayCall resolves internally).

**Called from:**
- `startInstanceAsync` (boot-time, Phase 2 of startup) -- keep as-is
- `syncGatewayStateAfterRestart` (post-reconnect) -- NEW call site

---

## 5. New Files to Create

| File | Purpose | Depends On | Depended On By |
|------|---------|-----------|----------------|
| `apps/server/src/services/gateway-sync.ts` | Post-restart state query + DB sync | gatewayCall, DB | gateway-event-relay (on reconnect) |

## 6. Files to Modify

| File | What Changes | Risk |
|------|-------------|------|
| `gateway-rpc.ts` | Add `gatewayCall()` facade; keep `GatewayRPCClient` as internal fallback | Low (additive) |
| `gateway-event-relay.ts` | Add shutdown event handler, request queue, reconnect-with-sync, ping/pong | Medium (core transport) |
| `adapter.ts` | Simplify `translateRPC` to delegate to `gatewayCall` | Low (behavior-preserving) |
| `instance-manager.ts` | Rewrite `patchGatewayConfig` to gateway-first; rename `reseedConfigFiles` | Medium (core flow change) |
| `extension-lifecycle.ts` | Fix RPC methods (skills.status, tools.catalog); route through facade | Medium (API correction) |
| `plugin-store.ts` | Replace `restartInstance()` with `config.patch` + restart-wait | High (core behavior change) |
| `skill-store.ts` | Route through facade; minor (already uses RPC correctly) | Low |
| `health-monitor.ts` | Add HTTP `/ready` check; replace integrity reseed with gateway-auth sync | Medium |

---

## 7. Suggested Build Order

### Phase 1: Consolidate RPC Routing (Foundation)

**Files:** `gateway-rpc.ts`, `adapter.ts`
**Risk:** Low -- additive, no behavior change
**Enables:** All subsequent phases

1. Add `gatewayCall()` function to `gateway-rpc.ts`
2. Add `getInstanceConnection()` helper (DB lookup for endpoint/token)
3. Refactor `adapter.translateRPC` to delegate to `gatewayCall()`
4. Keep `GatewayRPCClient` class as internal detail

### Phase 2: Config Lifecycle Management (Gateway-First Config)

**Files:** `instance-manager.ts`
**Risk:** Medium -- changes the config update flow
**Depends on:** Phase 1
**Enables:** Phase 4 (extension ops use config.patch)

1. Rewrite `patchGatewayConfig` to gateway-first flow
2. Use `{ raw: JSON.stringify(delta) }` with `baseHash`
3. Handle restart vs. non-restart config changes
4. Eliminate `reseedConfigFiles()` from config update path
5. Track `baseHash` lifecycle (re-fetch on CONFLICT)

### Phase 3: Restart Cycle + State Sync

**Files:** `gateway-event-relay.ts`, new `gateway-sync.ts`
**Risk:** Medium -- core transport change
**Depends on:** Phase 1
**Enables:** Phase 4 (plugin ops need restart handling)

1. Add `shutdown` event handler in `PersistentGatewayClient`
2. Add request queue for calls during reconnect window
3. Create `gateway-sync.ts` with `syncGatewayStateAfterRestart()`
4. Implement `syncSkillsFromGateway()` using `skills.status` RPC
5. Implement `syncPluginsFromToolsCatalog()` using `tools.catalog` RPC
6. Wire reconnect handler to call sync on every reconnect

### Phase 4: Extension Operations (Migrate Call Sites)

**Files:** `extension-lifecycle.ts`, `plugin-store.ts`, `skill-store.ts`
**Risk:** High for plugins (config.patch + restart cycle), low for skills
**Depends on:** Phases 1, 2, 3

1. Migrate all call sites to `gatewayCall()` facade
2. Fix `reconcileExtensions` to use `skills.status` + `tools.catalog`
3. Replace `restartInstance()` in plugin-store with `config.patch` + restart-wait
4. Implement `waitForGatewayRestart()` Promise
5. Implement plugin activation verification via `tools.catalog`
6. Add rate-limit batching for multi-plugin operations

### Phase 5: Health Integration

**Files:** `health-monitor.ts`
**Risk:** Low -- additive alongside existing checks
**Depends on:** Phase 1
**Can run in parallel with:** Phases 2-4

1. Add `checkGatewayReadiness()` using HTTP `/ready` endpoint
2. Replace `checkConfigIntegrity` reseed with gateway-authoritative sync
3. Keep Docker-level polling as backstop
4. Add periodic `reconcileRunningExtensions()` in slow loop (safety net)

**Phase ordering rationale:**
- Phase 1 is pure infrastructure (zero behavior change)
- Phase 2 before 3: config.patch triggers restart; we need to understand the flow before handling it
- Phase 3 before 4: extension ops cause restarts; the restart handler must be in place first
- Phase 5 is independent (health checks are additive)
- No Phase 6-8 needed: cleanup is integrated into each phase

---

## 8. Patterns to Follow

### Pattern: Command-Then-Readback (for non-restart changes)

```typescript
// For config changes that do NOT trigger restart (models, hooks, cron):
await gatewayCall(instanceId, 'config.patch', { raw, baseHash, note });
const actual = await gatewayCall(instanceId, 'config.get', {});
await updateDB(instanceId, actual.config, actual.hash);
```

### Pattern: Command-Wait-Verify (for restart-triggering changes)

```typescript
// For config changes that DO trigger restart (plugins, gateway):
await gatewayCall(instanceId, 'config.patch', { raw, baseHash, note });
// Gateway emits shutdown event -> WS disconnects -> reconnects
await waitForGatewayRestart(instanceId, { timeoutMs: 60_000 });
// syncGatewayStateAfterRestart already ran on reconnect
const verified = await gatewayCall(instanceId, 'tools.catalog', { includePlugins: true });
// Check if desired plugin loaded
```

### Pattern: Graceful Degradation

```typescript
// When persistent connection is unavailable (startup race):
result = await gatewayCall(instanceId, method, params);
// gatewayCall internally: try persistent -> fall back to ephemeral -> reconnect persistent
```

---

## 9. Anti-Patterns to Avoid

### Anti-Pattern: Polling for Config Changes

**What:** Periodically calling `config.get` to detect if config changed.
**Why bad:** Wastes rate-limit budget (config.get is not rate-limited but creates load). Gateway does not emit config.changed events, so the temptation is to poll.
**Instead:** Use command-then-readback for Aquarium-initiated changes. For external changes (user editing config in Control UI), the reconnect-on-shutdown pattern catches them on the next restart.

### Anti-Pattern: Attempting Plugin Hot-Reload

**What:** Expecting `config.patch` with plugin changes to take effect without restart.
**Why bad:** Gateway WILL restart on any `plugins.*` change. Pretending otherwise creates false UX.
**Instead:** Design UI to show "gateway will restart" warning. Batch all plugin changes into one config.patch call.

### Anti-Pattern: Using `plugins.list` RPC

**What:** Calling `plugins.list` to get plugin state.
**Why bad:** This RPC does not exist in the gateway.
**Where it exists now:** `extension-lifecycle.ts:228`
**Instead:** Use `tools.catalog` (for active plugin tools) and `config.get` (for configured plugins).

### Anti-Pattern: DB-First for Running Instances

**What:** Writing config to DB before confirming gateway accepted it.
**Why bad:** Creates split-brain. Dashboard shows new state, gateway has old state.
**Where it exists now:** `patchGatewayConfig` line 774
**Instead:** Gateway-first, DB-second.

### Anti-Pattern: Ephemeral WebSocket Per Operation

**What:** `new GatewayRPCClient()` for each RPC.
**Why bad:** Full WS + handshake overhead (~100-300ms per call).
**Where it exists now:** `extension-lifecycle.ts:145,228`, `plugin-store.ts:132,209`, `skill-store.ts:165`
**Instead:** `gatewayCall()` routes through persistent client.

---

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| config.patch with plugin changes causes unexpected UX (restart delay) | HIGH | Show "gateway restarting" indicator in UI; batch changes; implement `waitForGatewayRestart` with progress |
| Rate limit (3/min) exhausted during multi-plugin install | HIGH | Batch all plugin changes into single config.patch; implement client-side rate tracking |
| baseHash conflict with concurrent Control UI edits | MEDIUM | Retry pattern: re-fetch hash -> re-apply patch -> max 3 retries |
| Reconnect window: RPCs queued during restart may timeout | MEDIUM | Queue with per-request timeout; expose estimated restart time from shutdown event |
| `tools.catalog` may not include all plugin info needed for reconciliation | MEDIUM | Supplement with `config.get` to read `plugins.entries` from config |
| Circular dependency: `gateway-sync.ts` -> DB -> `instance-manager.ts` -> `gateway-event-relay.ts` | LOW | gateway-sync writes DB directly, does not import instance-manager |

---

## Sources

- Direct source code analysis: `gateway-event-relay.ts`, `gateway-rpc.ts`, `adapter.ts`, `instance-manager.ts`, `health-monitor.ts`, `extension-lifecycle.ts`, `plugin-store.ts`, `skill-store.ts`
- `docs/gateway-communication-analysis.md` -- prior issue analysis
- `.planning/PROJECT.md` -- project context and constraints
- `.planning/research/FEATURES.md` -- verified OpenClaw gateway source findings (24 events, config.patch merge-patch semantics, plugin restart behavior, health endpoints, RPC methods)
- `.planning/research/STACK.md` -- technology decisions (no new deps, typed EventEmitter)
- Confidence: HIGH -- architecture informed by both Aquarium code reading and verified gateway behavior
