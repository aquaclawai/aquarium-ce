# Research Summary: Gateway Communication Overhaul

**Project:** Aquarium CE v1.3 — Gateway-First Communication
**Domain:** Platform-to-agent WebSocket communication architecture
**Researched:** 2026-04-05
**Confidence:** HIGH (all gateway API behavior verified from OpenClaw source code; no assumptions)

## Executive Summary

The gateway communication overhaul is fundamentally an architectural refactoring, not a technology adoption project. Every library and runtime capability needed is already present in the codebase: `ws@8.20.0` supports multiplexed RPC over persistent connections, `node:events` provides typed `EventEmitter<T>`, and `node:http` handles the gateway health endpoint. Zero new npm dependencies are required. The work is entirely structural: route all RPC through the `PersistentGatewayClient` instead of creating ephemeral connections, invert config update direction from DB-first to gateway-first, and implement a shutdown/reconnect/query pattern for state synchronization.

The most consequential research finding — confirmed from direct OpenClaw gateway source code — is that the gateway emits zero events for config changes, plugin load/fail, or skill load/fail. The original "event-driven DB sync" design described in `docs/gateway-communication-analysis.md` Section 5 cannot be implemented as written. Instead, the sync layer must use a **shutdown-event -> reconnect -> query** pattern: `config.patch` triggers a SIGUSR1 restart; the persistent WebSocket drops; on reconnect, the platform calls `config.get`, `tools.catalog`, and `skills.status` to read actual state and update the DB. The DB becomes a persistent cache of gateway reality, not an authority that pushes to the gateway.

The critical operational constraint is the rate limit of 3 config writes per 60 seconds (shared across `config.patch`, `config.apply`, and `update.run`), combined with the fact that every `plugins.*` change triggers a full gateway process restart. These two facts together make batching of plugin operations mandatory, not optional. Installing 4 plugins sequentially would exhaust the rate limit and cause 4 separate gateway restarts; the correct pattern is to accumulate all plugin config changes and send a single merged `config.patch`, consuming one rate-limit slot and causing one restart.

---

## Key Findings

### Recommended Stack

The stack requires no additions. All required capabilities are already installed and functional:

**Core technologies (keep as-is):**
- `ws@8.20.0` — WebSocket transport — already supports multiplexed concurrent RPC via UUID-correlated `pendingRequests` Map; `PersistentGatewayClient` already implements this pattern correctly
- `node:events` (`EventEmitter<T>`) — typed internal event bus — `@types/node@22.x` provides generic `EventEmitter<T>` natively; no external typed-emitter package needed
- `node:http` — HTTP health checks — gateway exposes `/ready` endpoint; a simple HTTP GET is sufficient; no `got` or `axios` needed
- `knex@3.1.0` + `better-sqlite3@11.x` — DB persistence — already installed; used for all DB sync writes after gateway state reads
- `node:crypto` (`randomUUID`, `createHash`) — RPC correlation IDs and config hash verification — already installed as built-in

**Explicitly NOT adding:** `rpc-websockets`, `websocket-multiplex`, `eventemitter3`, `typed-emitter`, `rxjs`, `bottleneck`, `p-throttle`, `got`, `axios`. All are either wrong protocol, unnecessary abstraction, or trivially replaced by built-ins.

See `STACK.md` for detailed analysis of each decision.

### Expected Features

**Must have (table stakes) — Phase 1 foundation:**
- Route all RPC through persistent WS client — eliminates ephemeral connection overhead (~100-300ms per call); `PersistentGatewayClient.call()` already implements multiplexed RPC correctly
- `baseHash` lifecycle management — `config.get` returns the SHA-256 hash required as `baseHash` for all `config.patch`/`config.apply` calls; stale hash causes rejection; must implement read-then-patch with retry
- Shutdown event handling — gateway emits `{ event: "shutdown", payload: { reason, restartExpectedMs } }` before clean restarts; this is the only signal to distinguish restart from crash
- HTTP `/ready` health checks — gateway exposes `{ ready: boolean, failing: string[], uptimeMs: number }` at `http://host:port/ready`; independent of WebSocket connection; correct supplement to Docker container polling

**Should have (needed for reliable extension management) — Phases 2-4:**
- Batched `config.patch` for plugin changes — mandatory given 3/min rate limit and restart-per-change; send one patch for multiple plugin installs
- Post-restart verification via `tools.catalog` — only way to confirm plugins loaded after SIGUSR1 restart; `plugins.list` RPC does NOT exist; use `tools.catalog({ includePlugins: true })` instead
- Reconnect-driven state sync — after any reconnect, call `config.get` + `tools.catalog` + `skills.status` to reconcile DB with gateway reality
- Gateway-first `patchGatewayConfig` — invert current DB-first flow; only write DB after gateway confirms the change

**Defer (v2+):**
- `config.schema` introspection for dynamic config UIs — high complexity, not needed until advanced config editing in dashboard
- Full `agents.*` RPC management — out of scope for extension management milestone
- Protocol version range negotiation — `minProtocol: 3, maxProtocol: N` — low urgency, address before next gateway protocol bump

See `FEATURES.md` for full RPC method signatures, payload shapes, and source file citations.

### Architecture Approach

The target architecture establishes the gateway as authoritative for all running-instance state, with the DB functioning as a persistent cache. Communication flows in one direction: the platform operates on the gateway via persistent WebSocket RPC, then reads back actual state after mutations. For config changes that trigger restarts (all `plugins.*` changes), the state read-back happens asynchronously after reconnect. For non-restart config changes (models, hooks, cron), the read-back happens immediately after the `config.patch` response.

**Major components:**

1. **`PersistentGatewayClient` (refactored)** — WS lifecycle, reconnect with exponential backoff, RPC send/receive, event relay, shutdown event detection, post-reconnect state sync trigger; one per running instance
2. **`gatewayCall()` facade (new)** — unified RPC routing: persistent-first, ephemeral-only during startup race window; eliminates direct `new GatewayRPCClient()` calls from 6+ services
3. **`GatewayStateSyncer` / `gateway-sync.ts` (new)** — reconnect-then-query sync handler; calls `config.get`, `tools.catalog`, `skills.status` after reconnect; diffs against DB and applies updates; also replaces boot-time `reconcileExtensions` ephemeral RPC pattern
4. **`instance-manager.ts` (modified)** — `patchGatewayConfig` inverted to gateway-first; no `reseedConfigFiles` for running instances; DB written only after gateway confirms
5. **`health-monitor.ts` (modified)** — adds HTTP `/ready` polling alongside Docker container status; replaces file-hash `checkConfigIntegrity` with gateway-authoritative hash comparison
6. **`extension-lifecycle.ts`, `plugin-store.ts`, `skill-store.ts` (modified)** — all RPC calls routed through `gatewayCall()` facade; `plugins.list` replaced with `tools.catalog`; plugin activation uses `config.patch` instead of `restartInstance`

See `ARCHITECTURE.md` for full component diagrams, code patterns, and migration tables.

### Critical Pitfalls

23 pitfalls identified. Top 5:

1. **P1 — Transitional dual-write window** — During incremental migration, a gateway-first `config.patch` can be overwritten by a still-DB-first `reseedConfigFiles` call, silently reverting the change. Prevention: gate migration per-instance; once an instance uses gateway-first config, ALL config operations for that instance must be gateway-first. Add `config_source` tracking. Four `reseedConfigFiles` call sites must be audited: `updateSecurityProfile`, health monitor auto-recovery, config integrity violation handler, and `patchGatewayConfig` retry loop.

2. **P4 — Config integrity check creates infinite reseed loop** — `checkConfigIntegrity` hashes the on-disk `openclaw.json` and compares to DB hash. In gateway-first, the gateway legitimately modifies its own config (plugin path injection, normalization). Hash always drifts, triggering reseed every 30 seconds, creating a CPU/IO loop and overwriting gateway state. Prevention: replace file-hash check with gateway-level readiness (`config.get` hash comparison: "does DB match gateway?" rather than "does disk match DB?").

3. **P5 — Fallback-to-DB-first creates silent state divergence** — Current `patchGatewayConfig` explicitly says gateway push failure is non-critical (DB already updated). This philosophy is incompatible with gateway-first. If the gateway is unreachable and code falls back to DB-first, the user sees success but the gateway runs with old config indefinitely. Prevention: for running instances, return error on gateway failure; do not fall back silently; do not write DB before gateway confirms.

4. **P6 — Full container restart for plugin activation destroys gateway state** — Current `_activatePluginWithLock` calls `restartInstance()`, which stops and deletes the container. This destroys active chat sessions, in-memory pending approvals, and causes ~2 minutes downtime on failure path (activate restart + rollback restart). Prevention: use `config.patch` to add plugin to `plugins.load.modules`; this triggers SIGUSR1 (process-level restart, much faster) rather than container destruction.

5. **P3 — Reconnection state gap loses events during disconnect** — Events emitted during the 5-25 second reconnection window are permanently lost. After reconnect, DB state may be stale with no catch-up. Prevention: reconcile-on-reconnect (call `config.get`, `tools.catalog`, `skills.status` immediately after handshake); extract `reconcileExtensions` into a reusable function called on both boot and reconnect; use exponential backoff starting at 1s instead of fixed 5s delay.

**Additional critical findings covered in PITFALLS.md:** P7 (config.patch is not instant activation — show "restarting" state, not "active"), P8 (rate limit exhaustion from sequential plugin installs), P9 (stale baseHash causing rejections), P22 (no mock gateway for CI — all gateway-first code untested in current setup).

---

## Implications for Roadmap

### Phase Ordering Rationale

The dependency chain is linear: Phase 1 enables Phase 2 (config lifecycle uses the persistent RPC client); Phase 2 enables Phase 3 (restart cycle triggers from config.patch); Phase 3 enables Phase 4 (extension ops need restart verification to confirm success). Phase 5 (health integration) is independent and can run concurrently with Phases 3-4.

The most important ordering constraint: **the dual-write window (P1) only exists during the transition period between Phase 2 and Phase 4 completion.** Phases 2-4 must be executed as a coherent unit, not piecemeal across releases, to minimize the duration of mixed DB-first/gateway-first operation.

---

### Phase 1: Consolidate RPC Routing

**Rationale:** All subsequent phases depend on reliable persistent-first RPC. This phase is low-risk and purely additive. It does not change data flow direction.

**Delivers:**
- `gatewayCall(instanceId, method, params)` unified facade in `gateway-rpc.ts`
- All 6+ direct `new GatewayRPCClient()` call sites migrated to `gatewayCall()`
- `plugins.list` calls replaced with `tools.catalog({ includePlugins: true })` (verified: `plugins.list` does not exist in the gateway)
- Client ID changed from `'openclaw-control-ui'` to `'aquarium-platform'` (prevents conflict with browser Control UI — P21)
- Exponential backoff on reconnect (1s, 2s, 4s, 8s, 16s, 30s cap — replaces fixed 5s delay)

**Addresses:** P10 (ephemeral connections from 6+ call sites), P21 (wrong client ID)

**Avoids:** P2 (race conditions from parallel persistent + ephemeral connections)

**Research flag:** Standard patterns; no additional research needed.

---

### Phase 2: Config Lifecycle Management

**Rationale:** The `baseHash` requirement from the gateway is a hard constraint on all config write operations. This phase must be solid before any extension operation can use `config.patch`. It also establishes the correct direction of authority (gateway-first for running instances).

**Delivers:**
- `patchGatewayConfig` inverted to gateway-first: `config.get` -> build `{ raw: JSON.stringify(delta) }` patch -> `config.patch` with `baseHash` -> read back on success
- `baseHash` tracked per-instance in DB (`config_hash` column); refreshed on every successful config operation
- Read-patch-retry loop for stale hash conflicts (max 3 retries)
- Rate limit enforcement: timestamp array tracking 3 config writes per 60s per instance; batching of multi-plugin operations into single `config.patch`
- `reseedConfigFiles` eliminated for running instances; renamed `seedInitialConfig` for cold-start-only use

**Key protocol facts this phase must respect:**
- `config.patch` uses `{ raw: "<JSON5 string>", baseHash: "<hash>" }` — NOT `{ patch: {...} }`; the `raw` string is parsed as JSON5 then applied as RFC 7396 merge-patch
- Array entries must include `id` field for merge-by-id behavior; without `id`, arrays are replaced
- `config.patch` ALWAYS triggers SIGUSR1 restart for any `plugins.*` change (no hot-reload path exists)
- The `{ patch: configPatch }` fallback in current `instance-manager.ts:820` is broken — gateway schema only accepts `raw`

**Addresses:** P5 (silent divergence from DB-first fallback), P9 (stale baseHash rejections), P17 (config validation skipped), P18 (duplicate deepMerge implementations)

**Avoids:** P1 onset — establishes clear authority boundary before Phase 4

**Research flag:** Live testing needed for config.patch conflict resolution when Aquarium and Control UI edit concurrently; default `restartDelayMs` timing needs measurement.

---

### Phase 3: Restart Cycle and State Sync

**Rationale:** Plugin operations trigger SIGUSR1 restarts; this phase handles the full restart lifecycle. Must be in place before Phase 4 so extension operations have verified confirmation of success/failure.

**Delivers:**
- Shutdown event handling in `PersistentGatewayClient`: detect `{ event: "shutdown" }` payload, set `expectedRestart` flag, suppress error alerts during reconnect window
- `syncGatewayStateAfterRestart(instanceId)` function (`gateway-sync.ts`): calls `config.get` + `tools.catalog` + `skills.status` after every reconnect; diffs against DB; marks plugins/skills as `active` or `failed` based on gateway reality
- Boot-time `reconcileExtensions` refactored to use same `gateway-sync.ts` logic (replaces current `plugins.list` call that fails silently)
- `pendingQueue` in `PersistentGatewayClient` for RPCs received during reconnect window (drain after reconnect completes)
- WS ping/pong heartbeat (30s interval) for transport-level liveness detection

**Key protocol facts this phase must respect:**
- Gateway emits ZERO events for config change, plugin load/fail, or skill load/fail — there is no `config.changed`, `plugin.loaded`, or `skill.loaded` event in `GATEWAY_EVENTS`
- The only state visibility after a restart is: `shutdown` event (before restart), then `hello-ok` snapshot (on reconnect handshake), then explicit RPC queries (`config.get`, `tools.catalog`, `skills.status`)
- HTTP `/ready` endpoint returns `{ ready: boolean, failing: string[], uptimeMs: number }` and is available independently of the WebSocket connection

**Addresses:** P3 (reconnection state gap), P4 (integrity check reseed loop — replace with gateway-authoritative sync), P7 (premature "active" state before tools confirmed), P14 (event handler crash drops events)

**Research flag:** Exact timing between config.patch response and SIGUSR1 execution needs live measurement to set appropriate reconnect wait behavior.

---

### Phase 4: Extension Operations via Gateway-First

**Rationale:** Depends on Phases 2 (config.patch is reliable) and 3 (restart cycle is handled). Converting plugin activation from full container restart to config.patch eliminates session disruption and dramatically reduces operation time.

**Delivers:**
- Plugin activate/deactivate via `config.patch` with `plugins.entries` array (using id-keyed merge): one gateway restart per batch, not per plugin
- Full batch pattern: accumulate all plugin changes, merge into single `config.patch`, one rate-limit slot consumed, one restart, `syncGatewayStateAfterRestart` confirms outcome
- Rollback via config.patch (remove plugin entry) instead of double container restart
- "Gateway restarting" UI state during plugin apply window (not "activating", not "active" — only "active" after `tools.catalog` confirms)
- `reseedConfigFiles`/container restart path for plugin ops formally deprecated

**Key protocol facts this phase must respect:**
- `plugins.list` RPC does NOT exist — verification of loaded plugins must use `tools.catalog({ includePlugins: true })`; plugin tool groups have `source: "plugin"` and `pluginId` field
- Each `config.patch` touching `plugins.*` triggers a SIGUSR1 restart — there is no hot-reload path
- Rate limit: 3 config writes per 60 seconds — if user installs 4+ plugins, all must be batched into one patch
- `config.patch` response includes `restart.coalesced: true` when a restart was merged into a pending one — do not wait for a second restart event

**Addresses:** P6 (container restart destroys gateway state), P7 (premature "active" state), P8 (rate limit from sequential plugin patches), P15 (array merge semantics for plugin entries)

**Research flag:** UX for "pending restart" state in the plugin management UI needs design review; the coalesced restart response handling needs testing with rapid sequential patches.

---

### Phase 5: Health Integration

**Rationale:** Independent of Phases 1-4. Additive alongside existing Docker health checks. Can proceed in parallel once Phase 1 (persistent client improvements) is complete.

**Delivers:**
- HTTP `/ready` polling added to health monitor (30s interval): derives HTTP URL from `control_endpoint`, fetches `{ ready, failing, uptimeMs }`, broadcasts degraded status to browser clients when `ready: false`
- `/health` liveness check as lightweight probe (gateway process alive) vs. `/ready` readiness (channels healthy)
- WS ping/pong latency tracking: `latencyMs`, `isHealthy` metrics from `PersistentGatewayClient`
- `checkConfigIntegrity` replaced: instead of comparing disk hash to DB hash (causes reseed loop), compare gateway's `config.get` hash to DB `config_hash` — on mismatch, update DB (not disk)
- Docker container status checks remain as fallback for pre-WebSocket startup window

**Addresses:** P4 (config integrity reseed loop), P16 (Docker-only checks miss gateway crashes)

**Research flag:** Standard patterns; HTTP health probing is well-documented. No additional research needed.

---

### Research Flags Summary

| Phase | Needs Research | Reason |
|-------|---------------|--------|
| Phase 1 | No | Standard persistent-client refactoring; patterns already in codebase |
| Phase 2 | Yes (limited) | Live testing needed for concurrent edit conflict resolution; `restartDelayMs` timing |
| Phase 3 | Yes (limited) | SIGUSR1 timing relative to config.patch response needs measurement |
| Phase 4 | Yes (limited) | Coalesced restart response behavior; UX for "pending restart" state |
| Phase 5 | No | HTTP health probing is well-documented standard pattern |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new deps; all capabilities verified against installed library versions |
| Features | HIGH | Every RPC method, event type, and payload shape verified from OpenClaw source with line-number citations |
| Architecture | HIGH | Protocol behavior (merge-patch format, restart triggers, rate limits) confirmed from gateway source; component boundaries well-defined |
| Pitfalls | HIGH | 23 pitfalls with source-verified root causes; rate limits, array merge semantics, baseHash requirement all confirmed from source code |
| Gateway event coverage | HIGH | VERIFIED NEGATIVE: `GATEWAY_EVENTS` array exhaustively checked; no config/plugin/skill events exist |
| config.patch format | HIGH | VERIFIED: `{ raw: "<JSON5 string>" }` only; `{ patch: {...} }` parameter does not exist in schema |

**Overall confidence:** HIGH

### Gaps to Address

- **SIGUSR1 timing:** The exact delay between `config.patch` response and gateway SIGUSR1 execution is configurable via `restartDelayMs`. Default behavior needs live testing to set appropriate reconnect wait logic and avoid premature reconnect attempts.
- **Plugin load diagnostics:** Plugin load errors during SIGUSR1 restart are written to the subsystem logger but not queryable via any RPC. `tools.catalog` is the only verification method. If a plugin fails to load, no error message is surfaced — the plugin simply won't appear in `tools.catalog` groups. UX must handle this blind spot (e.g., show "verification failed — plugin not found in tools catalog" rather than a specific error).
- **Concurrent edit conflict UX:** When Aquarium's `config.patch` races with a user editing config in OpenClaw Control UI, both will receive `baseHash` conflict errors. The retry-with-reread loop handles the technical case, but the UX for "your change was applied after a conflict" needs design.
- **skills.update timing:** `skills.update` (enable/disable, set env vars) writes the config file directly WITHOUT triggering a SIGUSR1 restart. Skills are read dynamically. The exact timing of when changes take effect in the agent process needs verification.

---

## Sources

### Primary (HIGH confidence — direct source code)
- OpenClaw gateway source: `openclaw/src/gateway/server-methods-list.ts:124-149` — `GATEWAY_EVENTS` array (24 event types; no config/plugin/skill events)
- OpenClaw gateway source: `openclaw/src/gateway/server-methods/config.ts:317-437` — `config.patch` handler; merge-patch semantics; SIGUSR1 scheduling
- OpenClaw gateway source: `openclaw/src/config/merge-patch.ts:62-97` — RFC 7396 merge-patch with `mergeObjectArraysById`
- OpenClaw gateway source: `openclaw/src/gateway/config-reload-plan.ts:34-215` — `plugins=restart`, `skills=none` reload plan
- OpenClaw gateway source: `openclaw/src/gateway/control-plane-rate-limit.ts:4-5` — 3/60s rate limit
- OpenClaw gateway source: `openclaw/src/gateway/server-http.ts:128-133,224-276` — HTTP `/ready` and `/health` endpoints
- OpenClaw gateway source: `openclaw/src/gateway/server-close.ts:87` — `shutdown` event emission
- OpenClaw gateway source: `openclaw/src/gateway/server-methods/tools-catalog.ts:155-182` — `tools.catalog` response shape
- OpenClaw gateway source: `openclaw/src/gateway/server-methods/skills.ts:59-91` — `skills.status` response shape
- Aquarium source: `apps/server/src/services/gateway-event-relay.ts` — `PersistentGatewayClient` implementation
- Aquarium source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts` — `GatewayRPCClient`, `GroupChatRPCClient`
- Aquarium source: `apps/server/src/services/instance-manager.ts:736-845` — `patchGatewayConfig` (current DB-first flow)
- Aquarium source: `apps/server/src/services/health-monitor.ts` — `checkConfigIntegrity`, Docker polling loops
- Aquarium source: `apps/server/src/services/extension-lifecycle.ts` — `reconcileExtensions`, `plugins.list` call (broken)

### Secondary (MEDIUM confidence — referenced in PITFALLS.md)
- Distributed systems patterns: split-brain prevention, dual-authority systems
- WebSocket reconnection patterns: exponential backoff, state reconciliation on reconnect
- Event-driven architecture: race conditions, idempotency, correlation IDs

---

*Research completed: 2026-04-05*
*Ready for roadmap: yes*
