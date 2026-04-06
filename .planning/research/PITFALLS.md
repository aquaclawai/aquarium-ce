# Domain Pitfalls: Gateway Communication Overhaul

**Domain:** DB-first to gateway-first migration in a platform managing containerized gateway instances
**Researched:** 2026-04-05
**Overall confidence:** HIGH (gateway source analysis + Aquarium codebase analysis + distributed systems patterns)

This document covers pitfalls at two levels:
1. **Platform-side migration pitfalls** -- what goes wrong in the Aquarium codebase during the DB-first to gateway-first transition
2. **Gateway protocol pitfalls** -- behaviors of the OpenClaw gateway that the platform must account for

---

## Critical Pitfalls

Mistakes that cause data loss, split-brain, or require architectural rewrites.

---

### P1: The Transitional Dual-Write Window

**What goes wrong:** During incremental migration, some operations go gateway-first while others remain DB-first. A gateway-first operation (e.g., `config.patch`) can conflict with a still-DB-first operation (e.g., plugin activate via `restartInstance`). The restart reseeds config from DB, overwriting the gateway-first change that hasn't been event-synced back yet.

**Why it happens:** Incremental migration creates a zone where neither system is authoritative for all operations. The current `patchGatewayConfig` (instance-manager.ts:736-845) writes DB first then pushes to gateway, while the proposed flow inverts this. During transition, `reseedConfigFiles` (instance-manager.ts:239-328) regenerates the full `openclaw.json` from DB state, which can overwrite gateway-first changes.

**Consequences:**
- Config regression: user changes via gateway-first `config.patch` silently lost on next `reseedConfigFiles` call
- Extension state regression: plugin activated via hot-reload but DB-driven restart excludes it
- Debugging nightmare: intermittent failures that depend on operation ordering

**Prevention:**
1. Establish a migration compatibility matrix before writing code. For every operation pair, document which pattern each uses and whether they can conflict.
2. Add a `config_source` field to track which system last wrote config. When `reseedConfigFiles` runs, skip it for instances whose last config write was gateway-first.
3. Gate migration per-instance: once an instance opts into gateway-first for config, ALL config operations for that instance must use gateway-first. No mixing.
4. Write an integration test: gateway-first config.patch followed by a DB-first restart, assert the gateway-first change survives.

**Detection:** Add a `config_source_epoch` counter that increments on every write from either side. Log warnings when reseedConfigFiles encounters a gateway-originated config with a higher epoch than DB's.

**Specific code sites to audit:** `reseedConfigFiles` is called from:
- `updateSecurityProfile` (instance-manager.ts:386)
- Health monitor auto-recovery (health-monitor.ts:120)
- Config integrity check violation (health-monitor.ts:276)
- `patchGatewayConfig` retry loop (instance-manager.ts:803)

---

### P2: Race Between Gateway Event Arrival and DB Write Completion

**What goes wrong:** Gateway-first operation sends `config.patch` to gateway, gateway applies it and emits an event. The platform's event handler tries to update DB, but the original HTTP handler is also updating DB with the read-back config from `config.get`. Two DB writes race; the loser's version overwrites the winner's.

**Why it happens:** Gateway events arrive asynchronously via WebSocket on `PersistentGatewayClient` (gateway-event-relay.ts:174), while the RPC response arrives on the same or different code path. Without coordination, both the event handler and the RPC response handler independently update `instances.config`.

**Consequences:**
- DB stores stale config version
- Config integrity check triggers false-positive reseed
- Subsequent operations read stale DB state

**Prevention:**
1. **Write-once per operation:** The RPC caller that initiated the gateway-first operation is responsible for the DB write. Event handlers only update DB for changes they did NOT initiate.
2. Add a `correlationId` to `config.patch` RPC calls. When the event handler sees a config.changed event with a matching correlationId, skip the event-driven DB update.
3. Use optimistic locking: `UPDATE instances SET config = ? WHERE id = ? AND config_version = ?`. If 0 rows affected, re-read and retry.

**Detection:** Log every DB config write with the source (rpc-callback, event-handler, reseed, direct-update) and config hash. Alert if two writes for the same instance happen within 1 second from different sources.

---

### P3: Reconnection State Gap -- Lost Events During Disconnect

**What goes wrong:** The persistent WebSocket drops. During the 5-25 second reconnection window (RECONNECT_DELAY_MS=5s, MAX_RECONNECT_RETRIES=5 in gateway-event-relay.ts:15-16), the gateway continues operating. Events emitted during this window never reach the platform. After reconnection, DB state is stale with no catch-up mechanism.

**Why it happens:** `PersistentGatewayClient` has no "catch-up" or "replay missed events" logic. On reconnect, it re-authenticates and starts receiving new events only. There is no sequence number, no event log, no reconciliation-on-reconnect.

**Consequences:**
- Plugin failure undetected: gateway failed a plugin load during disconnect, DB still shows `active`
- Config drift: gateway auto-normalized config during reconnection window
- Dashboard shows stale state until next health monitor cycle (30 seconds)

**Prevention:**
1. **Reconcile-on-reconnect:** After WebSocket handshake succeeds, immediately call `config.get`, `plugins.list`, `skills.list`, and `health` RPCs. Diff against DB and apply updates.
2. The reconciliation code path must reuse `reconcileExtensions` (extension-lifecycle.ts:133-316), which currently only runs at boot. Extract into a reusable function called on both boot and reconnect.
3. Reduce reconnection delay: use exponential backoff starting at 1s instead of fixed 5s.
4. Track `lastEventTimestamp` per instance. If reconnection succeeds and the next event's timestamp is >10 seconds after `lastEventTimestamp`, trigger full reconciliation.

---

### P4: Config Integrity Check Creates Infinite Reseed Loop

**What goes wrong:** Health monitor's `checkConfigIntegrity` (health-monitor.ts:236-286) runs every 30 seconds, hashes on-disk `openclaw.json`, compares to `instances.config_hash`. In gateway-first, the gateway legitimately modifies its own config (injecting `plugins.load.paths`, normalizing fields). The hash always drifts, triggering `reseedConfigFiles`, which the gateway re-normalizes, changing the hash again.

**Why it happens:** The integrity check assumes the platform is the only writer. In gateway-first, the gateway writes too.

**Consequences:**
- CPU/IO waste from 30-second reseed cycles
- Race conditions between reseed and in-flight gateway operations
- Config changes lost when reseed overwrites gateway's state
- The 3-second `setTimeout` in `reseedConfigFiles` (instance-manager.ts:300) makes timing flaky

**Prevention:**
1. **Replace the file-hash integrity check** with a gateway-level health check (`health` RPC) that verifies the gateway process is healthy.
2. If integrity checking must remain, compare the gateway's own config hash (from `config.get`) against DB's stored hash. This tests "does DB match gateway?" rather than "does disk match DB?" -- and if they differ, update the DB (not the disk).
3. Skip the integrity check for instances using gateway-first (using `config_source` from P1).

**Detection:** Count reseed operations per instance per hour. If it exceeds 3, something is fighting the gateway.

---

### P5: Fallback-to-DB-First on Gateway Failure Creates Silent State Divergence

**What goes wrong:** Gateway-first operation fails because gateway is temporarily unreachable. Code falls back to DB-first: writes config to DB. But "later" push never happens -- the error handler in `patchGatewayConfig` (instance-manager.ts:840-844) logs the error and moves on. DB has new config, gateway has old config, user thinks the change worked.

**Why it happens:** Current code explicitly says: "Gateway push failure is non-critical -- DB is already updated." This philosophy is incompatible with gateway-first.

**Consequences:**
- Dashboard shows config change succeeded (200 OK, DB updated)
- Gateway runs with old config indefinitely
- Only a manual restart fixes the drift

**Prevention:**
1. **Do not fall back to DB-first for running instances.** If gateway is unreachable, return error to user. DB stays unchanged.
2. Explicitly branch: `if (instance.status === 'running') { gateway-first, fail on error } else { db-only }`.
3. Queue failed operations for retry on next successful health check rather than silently succeeding.
4. Show "pending sync" indicator in UI when a change is queued but not yet applied.

---

### P6: Full Container Restart for Plugin Activation Destroys Gateway State

**What goes wrong:** Plugin activation in `_activatePluginWithLock` (plugin-store.ts:103-250) calls `restartInstance()`, which stops the container, deletes it, and starts fresh. This destroys: active chat sessions, in-memory caches, loaded plugin state, pending exec approvals, and any gateway-first config changes not yet synced to DB.

**Why it happens:** The platform uses the "nuclear option" of restart instead of `config.patch` for plugin activation.

**Consequences:**
- Active chat sessions terminated (user sees connection dropped)
- All pending exec approvals lost (in-memory `pendingApprovals` map cleared on disconnect)
- Gateway-first config changes not synced to DB are lost
- Two full restarts on failure path: activate restart + rollback restart = ~2 minutes downtime per plugin

**Prevention:**
1. Use `config.patch` to add the plugin to `plugins.load.modules`. This triggers a SIGUSR1 restart within the gateway process (not a container restart), which is much faster and preserves container state.
2. Only fall back to full container restart if gateway explicitly signals it's needed.
3. Before any restart, snapshot gateway state: `config.get` + sync to DB, flush approvals to persistent store, warn connected sessions.

---

## High Pitfalls

Mistakes that cause significant bugs or degraded functionality but are recoverable.

---

### P7: config.patch Hot-Reload Is Not Instant -- Don't Show "Active" Prematurely

**What goes wrong:** UI shows "plugin activated" after config.patch succeeds, when the gateway has only written config and scheduled a SIGUSR1 restart. The actual plugin load hasn't happened yet.

**Why it happens:** config.patch returns `{ ok: true, restart: { delayMs, coalesced } }`. The `ok: true` means config was written and validated, NOT that plugins are loaded. The gateway process must restart via SIGUSR1.

**Consequences:** Users see "activated" but plugin isn't running. If restart fails, UI shows "active" but plugin is broken.

**Prevention:** After config.patch succeeds:
1. Set state to "restarting" (not "active")
2. Wait for the `shutdown` event from gateway
3. Wait for reconnect and the hello-ok snapshot
4. Call `tools.catalog` or `plugins.list` to verify the plugin's tools are present
5. Only then transition to "active" (or "failed" if tools missing)

**Source:** OpenClaw `config-reload-plan.ts:97` (`plugins` prefix is `kind: "restart"`)

---

### P8: Exhausting the config.patch Rate Limit (3/minute)

**What goes wrong:** Installing and activating multiple plugins in quick succession. The gateway enforces a hard limit of 3 writes per 60 seconds per client for `config.apply`, `config.patch`, and `update.run` (shared budget). The 4th call is rejected.

**Why it happens:** Moving from restart-per-plugin to hot-reload-per-plugin naturally increases config.patch frequency. The rate limit was designed for human-initiated changes.

**Consequences:** 4th operation fails. If UI retries without backoff, it blocks all config writes for up to 60 seconds.

**Prevention:**
- Batch all plugin changes into a single config.patch using merge-patch semantics
- Implement a server-side write queue per instance that coalesces pending changes within a 2-second window
- Parse `retryAfterMs` from the error response and show a countdown timer
- For bulk operations (template import with 5 plugins), aggregate into one patch

**Source:** OpenClaw `control-plane-rate-limit.ts:4-5`

---

### P9: Stale baseHash Causing config.patch Rejections

**What goes wrong:** Platform reads `config.get`, caches the hash, but before sending `config.patch`, another operation patches first. The cached hash is stale, and config.patch fails with "config changed since last load."

**Why it happens:** Optimistic concurrency control via SHA-256 hash. Any writer that changes config invalidates all readers' cached hashes.

**Consequences:** Config.patch fails. Without proper retry logic, the operation appears to fail (or worse, succeeds on platform side but gateway rejects it). The current retry loop (instance-manager.ts:789-838) handles this for the old flow but must be preserved in the new flow.

**Prevention:**
- Implement read-patch-retry loop: `config.get` -> build patch -> `config.patch` -> if CONFLICT, re-read, re-apply changes to NEW config, retry
- Never cache baseHash longer than the current operation
- Limit retries to 2-3 to avoid infinite loops if another client is racing

**Source:** OpenClaw `server-methods/config.ts:54-98`

---

### P10: Ephemeral RPC Client Creates Redundant Connections

**What goes wrong:** The codebase has two RPC clients. During migration, new code routes through `PersistentGatewayClient`, but existing code (`extension-lifecycle.ts:143`, `plugin-store.ts:131-132`) still creates ephemeral `GatewayRPCClient` instances directly. A single plugin install can open 3-4 simultaneous WebSocket connections.

**Consequences:**
- Gateway connection limit pressure
- Race conditions: persistent client receives events from ephemeral client's operations but can't correlate them
- Each ephemeral connection wastes ~100-200ms on handshake

**Prevention:**
1. Route ALL RPC through the persistent client as a migration prerequisite.
2. Add a `gatewayRPC(instanceId, method, params)` facade function. Only this function should create ephemeral clients as fallback.
3. After migration, make `GatewayRPCClient` constructor package-private to prevent accidental direct usage.

---

### P11: Session Key Stripping Regex Will Break on Format Changes

**What goes wrong:** Gateway prepends `agent:{agentId}:` to session keys. Platform strips it with `rawSessionKey.replace(/^agent:[^:]+:/, '')` (gateway-event-relay.ts:295). If the gateway changes format, all chat routing breaks silently -- no error thrown, sessions just stop receiving events.

**Prevention:**
1. Negotiate session key format during connect handshake, or check gateway version to determine format.
2. If gateway provides `originalSessionKey` in chat events, use that instead of regex stripping.
3. Add defensive check: if stripped key doesn't match any active subscription, log warning with raw key.

---

### P12: Protocol Version Hardcoding Prevents Graceful Upgrade

**What goes wrong:** Both clients hardcode `PROTOCOL_VERSION = 3` with `minProtocol: 3, maxProtocol: 3`. When gateway upgrades to protocol 4, ALL instance connections fail simultaneously.

**Consequences:** Gateway upgrade to protocol 4 causes all connections to fail. No partial rollout possible. Platform requires coordinated release with gateway upgrade.

**Prevention:**
1. Use `minProtocol: 3, maxProtocol: 4` when adding new protocol features.
2. Store negotiated version per connection. Conditionally enable new event types or methods.
3. Log negotiated version on connect.
4. Add a clear error message with upgrade instructions when version mismatch is detected.

---

### P13: No Idempotency Keys on Mutating Gateway Operations

**What goes wrong:** Gateway-first `config.patch` is sent, response times out (30s), but gateway actually applied the patch. Platform retries, applying the patch again. For `plugins.install`, double-invocation causes confusing "already installed" errors.

**Prevention:**
1. Send an `idempotencyKey` (UUID) with every mutating RPC call.
2. The `baseHash` on config.patch already provides idempotency (second attempt sees updated hash). Extend this pattern to other operations.
3. Before retrying `plugins.install`, call `plugins.list` to check if already installed.

---

### P14: Event Handler Crash Drops All Subsequent Events Silently

**What goes wrong:** The message handler in `PersistentGatewayClient` (gateway-event-relay.ts:174-377) has a single try/catch. If a new event handler (e.g., `config.changed` DB updater) throws, the catch block on line 374 swallows it. In gateway-first, events drive DB updates, so dropped events mean DB drift.

**Prevention:**
1. Add per-event-type try/catch. Critical events (config.changed, plugin.loaded) should trigger reconciliation on error. Non-critical events (chat streaming) remain fire-and-forget.
2. Log dropped events at `warn` level with event type and error message.
3. Implement dead-letter tracking: events that fail processing 3 times stored for manual inspection.
4. Add counter metric: `gateway_events_dropped_total{instance_id, event_type}`.

---

## Moderate Pitfalls

---

### P15: Misunderstanding config.patch Merge Semantics for Arrays

**What goes wrong:** Sending config.patch with a `plugins.entries` array containing only the new entry, expecting append. Instead, behavior depends on whether array entries have `id` fields. Without `id` fields, the patch array REPLACES the base array entirely.

**Why it happens:** The gateway's `applyMergePatch` has `mergeObjectArraysById: true`. If entries have `id`, it merges by ID. Without `id`, it replaces.

**Prevention:**
- Always include `id` field when patching array entries
- When adding a new plugin entry, include its `id` so it gets appended
- Test merge behavior against actual config structure before building the flow
- For removal, send the full array without the removed item (or use a different approach)

**Source:** OpenClaw `config/merge-patch.ts:25-60`

---

### P16: Health Monitor Polls Docker Runtime Instead of Gateway

**What goes wrong:** Health monitor (health-monitor.ts:75-166) checks `engine.getStatus()` which inspects Docker container state. A container can be "running" while the gateway process inside has crashed or is deadlocked.

**Prevention:**
1. Add gateway-level health check: `health` RPC via persistent client every 30 seconds. If fails twice consecutively, mark instance `degraded`.
2. Use WebSocket connection state as secondary signal: persistent client disconnected >60 seconds = health problem.
3. Keep Docker-level checks as fallback for startup before WebSocket connects.

---

### P17: Config Validation Skipped for Patches Allows Invalid DB State

**What goes wrong:** `validateConfigPatch` always receives `skipFullSchemaValidation: true` (instance-manager.ts:769). During transition, DB-first writes still skip validation, allowing invalid configs.

**Prevention:**
1. For gateway-first operations: validation handled by gateway. Store whatever gateway accepted.
2. For DB-only operations (stopped instances): enable full schema validation against cached schema.
3. Remove `skipFullSchemaValidation` flag once all running-instance operations are gateway-first.

---

### P18: Duplicate `deepMerge` Implementations Will Diverge

**What goes wrong:** Two identical `deepMerge` functions in `instance-manager.ts:721-734` and `adapter.ts:9-22`. If one is modified for new merge semantics but the other isn't, config merges produce different results depending on code path.

**Prevention:**
1. Extract `deepMerge` into `packages/shared/src/utils.ts` as the first commit.
2. Consider whether `deepMerge` is even needed in gateway-first: if gateway handles merging, platform sends patches and receives merged results.

---

### P19: Pending Exec Approvals Stored Only In Memory

**What goes wrong:** The `pendingApprovals` map (gateway-event-relay.ts:82) is in-memory only. If Aquarium server restarts, all pending approvals lost. Gateway still waits for response, times out, denies the approval. User has no indication.

**Prevention:**
1. Persist pending approvals to SQLite with TTL column. On restart, re-emit to browser clients.
2. On reconnect, query gateway for active pending approvals and re-populate.

---

### P20: The `coalesced` Flag in config.patch Response

**What goes wrong:** Sending two config.patch calls rapidly. The second gets `restart.coalesced: true`, meaning the gateway merged the restart into the already-pending one. If code expects two separate restarts/confirmations, the second "restart" never fires.

**Prevention:** Check `restart.coalesced` in response. If true, the restart from the first patch covers this change -- don't wait for a second restart event.

**Source:** OpenClaw `server-methods/config.ts:419-423`

---

### P21: Using Wrong Client ID Conflicts with Browser Control UI

**What goes wrong:** `PersistentGatewayClient` uses `id: 'openclaw-control-ui'` (gateway-event-relay.ts:198). This is the same ID the browser Control UI uses. If the gateway deduplicates or routes by client ID, Aquarium's events interfere with real Control UI sessions.

**Prevention:** Use a distinct client ID like `'aquarium-platform'` to differentiate from browser UI.

---

## Testing-Specific Pitfalls

---

### P22: No Mock Gateway for CI -- All Gateway-First Code Untested

**What goes wrong:** CI skips Docker-dependent tests (`CI=true`). Gateway-first operations require a running gateway. All gateway-first code paths are untested in CI.

**Prevention:**
1. Build a mock gateway WebSocket server for integration tests. Must support:
   - connect.challenge/connect handshake
   - `config.patch`, `config.get`, `plugins.list`, `skills.list` RPCs with configurable responses
   - Configurable delays and failures for timeout/retry testing
   - Event emission on command for testing event-driven DB sync
2. Test these scenarios:
   - Happy path: config.patch succeeds, event received, DB updated
   - Gateway timeout: config.patch times out, verify DB unchanged
   - Reconnection: drop WebSocket, verify reconciliation runs
   - Race condition: two config.patch calls simultaneously, verify correct final state
   - Rate limit: 4 patches in 1 second, verify batching/queueing
3. Add contract tests for RPC message format compatibility.

---

### P23: No Observability for Event-Driven Flows

**What goes wrong:** DB-first operations: HTTP request in, DB write, HTTP response out -- easy trace. Gateway-first operations span HTTP request, WebSocket RPC, async event, DB write -- no unified trace. Debugging is impossible.

**Prevention:**
1. Add `correlationId` to every gateway-first operation. Include in HTTP log, RPC params, event handler log, DB update log.
2. Use structured logging: `{ correlationId, instanceId, operation, phase }`.
3. Store operation traces in `operation_log` table.
4. Frontend shows operation status (pending/applied/failed) rather than optimistic updates.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| RPC Consolidation | P10: Call sites using ephemeral client directly | Grep for `new GatewayRPCClient` and migrate each. Add lint rule. |
| RPC Consolidation | P21: Wrong client ID | Change to `'aquarium-platform'` in the same PR. |
| Event-driven DB sync | P2: Race between event handler and RPC callback | Use correlation IDs. Event handler skips if RPC callback already wrote. |
| Event-driven DB sync | P3: Missed events during disconnect | Reconcile-on-reconnect. Reuse `reconcileExtensions` logic. |
| Event-driven DB sync | P14: Event handler errors drop events silently | Per-event-type error handling with retry for critical events. |
| Gateway-first config | P1: Transitional dual-write window | Gate per-instance. All config ops must use same pattern. |
| Gateway-first config | P5: Fallback to DB-first creates silent divergence | Return error if gateway unreachable. Do not silently fall back. |
| Gateway-first config | P9: Stale baseHash | Implement read-patch-retry loop with 2-3 max retries. |
| Gateway-first config | P13: No idempotency keys | Add idempotencyKey to all mutating RPCs. |
| Hot-reload extensions | P6: Full restart destroys gateway state | Use config.patch. Only restart if gateway says so. |
| Hot-reload extensions | P7: config.patch is not instant activation | Show "restarting" until tools.catalog confirms. |
| Hot-reload extensions | P8, P15: Rate limit + array merge semantics | Batch patches. Always include `id` in array entries. |
| Eliminate config rewrites | P4: Integrity check infinite loop | Replace with gateway-level health check. |
| Gateway health checks | P16: Docker-only checks miss gateway crashes | Add `health` RPC alongside Docker status check. |
| Protocol handling | P12: Hardcoded version | Implement version range negotiation. |
| Testing | P22: No mock gateway for CI | Build mock WS server BEFORE implementing features. |
| Observability | P23: No unified tracing | Add correlationId before going to production. |

---

## Migration Ordering to Minimize Risk

Based on pitfall dependencies, the safest order:

1. **Unify RPC routing** (P10, P21) -- prerequisite for everything. All calls through persistent client.
2. **Build mock gateway for tests** (P22) -- enables CI testing for all subsequent changes.
3. **Add event-driven DB sync** (P2, P3, P14) -- additive, coexists with polling.
4. **Implement reconcile-on-reconnect** (P3) -- critical safety net before gateway-first.
5. **Flip config updates to gateway-first** (P1, P5, P9, P13) -- biggest behavioral change, needs above in place.
6. **Hot-reload extensions** (P6, P7, P8, P15) -- depends on gateway-first config being stable.
7. **Disable integrity check / add gateway health** (P4, P16) -- cleanup after gateway-first stable.
8. **Protocol version negotiation** (P12) -- can happen in parallel.

---

## Sources

### Codebase Analysis (PRIMARY -- HIGH confidence)
- `apps/server/src/services/gateway-event-relay.ts` -- PersistentGatewayClient, event relay, reconnection
- `apps/server/src/services/instance-manager.ts` -- patchGatewayConfig, reseedConfigFiles, startInstanceAsync
- `apps/server/src/services/health-monitor.ts` -- checkConfigIntegrity, checkInstances
- `apps/server/src/services/extension-lifecycle.ts` -- reconcileExtensions, replayPendingExtensions
- `apps/server/src/services/plugin-store.ts` -- _activatePluginWithLock, installPlugin
- `apps/server/src/services/config-validator.ts` -- validateConfigPatch
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts` -- GatewayRPCClient, GroupChatRPCClient
- `apps/server/src/routes/rpc-proxy.ts` -- ALLOWED_RPC_METHODS whitelist
- `docs/gateway-communication-analysis.md` -- Full architecture and issue analysis

### OpenClaw Gateway Source Analysis (PRIMARY -- HIGH confidence)
- Rate limit: `control-plane-rate-limit.ts:4-5` (3/60s per client)
- config.patch handler: `server-methods/config.ts:317-437`
- Restart scheduling: `server-methods/config.ts:409-418` (SIGUSR1)
- Merge-patch: `config/merge-patch.ts:25-97` (mergeObjectArraysById)
- Reload plan: `config-reload-plan.ts:34-102` (plugins=restart, skills=none)
- baseHash enforcement: `server-methods/config.ts:54-98`

### External Research (MEDIUM confidence -- patterns verified across multiple sources)
- [Event-Driven Architecture: The Hard Parts](https://threedots.tech/episode/event-driven-architecture/) -- Race conditions, ordering, idempotency
- [Dealing with Race Conditions in Event-Driven Architecture](https://www.architecture-weekly.com/p/dealing-with-race-conditions-in-event) -- Phantom records, event ordering
- [WebSocket Reconnection: State Sync and Recovery Guide](https://websocket.org/guides/reconnection/) -- Reconnection strategies, state reconciliation
- [WebSocket Architecture Best Practices](https://ably.com/topic/websocket-architecture-best-practices) -- Per-connection buffers, stateless recovery
- [Split-Brain in Distributed Systems](https://dzone.com/articles/split-brain-in-distributed-systems) -- Dual-authority prevention
- [Split-Brain Problem: Prevention and Resolution](https://systemdr.substack.com/p/split-brain-problem-prevention-and) -- Quorum and consensus
- [Testing Event-Driven Systems](https://medium.com/dan-on-coding/testing-event-driven-systems-63c6b0c57517) -- Service-level testing patterns
- [How to Implement Reconnection Logic for WebSockets](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view) -- Exponential backoff, state recovery
