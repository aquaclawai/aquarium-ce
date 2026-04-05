# Phase 12: Extension Operations - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace `restartInstance()` calls in plugin/skill lifecycle with `patchGatewayConfig()` so the Docker container stays alive, chat sessions survive, and the gateway handles restart internally. Batch multi-plugin operations into single config.patch. Skill operations use config.patch without restart wait.

</domain>

<decisions>
## Implementation Decisions

### Plugin Activation Flow (replaces restartInstance)
- Plugin activate: DB status → active, then `patchGatewayConfig()` with plugin added to `plugins.entries`
- Gateway does SIGUSR1 restart internally → reconnect → `syncGatewayState()` reconciliation detects success/failure
- Docker container stays alive — chat sessions survive the operation
- The existing `_activatePluginWithLock` flow refactored: replace `restartInstance()` with `patchGatewayConfig()` + wait for reconnect reconciliation

### Plugin Deactivation Flow
- Plugin deactivate: DB status → disabled, then `patchGatewayConfig()` with plugin removed from `plugins.entries`
- Same gateway restart → reconnect → reconciliation cycle

### Rollback Strategy
- **Single config.patch rollback**: if post-restart reconciliation shows plugin absent from tools.catalog, send one config.patch removing the failed plugin entry
- If the rollback config.patch also fails (rate limit, network error): mark as 'failed' in DB, let user retry manually
- No recursive rollback — one attempt only

### Multi-Plugin Batching (EXT-03)
- **Single merged config.patch**: collect all plugin changes into one merge-patch object, send one config.patch
- One restart, one rate-limit slot consumed
- Gateway merges all plugin entries atomically
- All plugins verified together in the post-reconnect reconciliation

### Skill Operations (EXT-06)
- **Same config.patch, skip restart wait**: skills use `patchGatewayConfig()` for consistency
- Since skills don't trigger SIGUSR1 restart (dynamically loaded), no need to wait for reconnect
- Send config.patch → read-back hash → update DB. Immediate effect.
- Verify via `skills.status` RPC after patch (not tools.catalog)

### Claude's Discretion
- How to build the merge-patch for adding/removing plugin entries
- How to detect "plugin failed to load" vs "plugin not yet loaded" in reconciliation timing
- Exact wait-for-reconnect mechanism (Promise that resolves when syncGatewayState completes?)
- Whether enablePlugin/disablePlugin need the full activate/deactivate cycle or can be simpler (just toggle in config.patch)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `patchGatewayConfig()` (instance-manager.ts) — gateway-first with retry, rate-limit delay, hash read-back (Phase 10)
- `syncGatewayState()` (instance-manager.ts) — full state sync on reconnect (Phase 11)
- `reconcileExtensions()` (extension-lifecycle.ts) — catches failed plugins post-restart (Phase 11)
- `_activatePluginWithLock()` (plugin-store.ts) — current flow using restartInstance, needs refactoring
- `gatewayCall()` (gateway-rpc.ts) — persistent RPC facade (Phase 9)

### Established Patterns
- Plugin store uses fenced locks (acquireLock/releaseLock) for concurrent operation safety
- Skill store uses similar locking pattern
- Both stores have install → activate → verify → rollback flow

### Integration Points (files to modify)
- `plugin-store.ts` — `_activatePluginWithLock`, `enablePlugin`, `disablePlugin`, `uninstallPlugin` (all call restartInstance)
- `skill-store.ts` — skill enable/disable/configure (if they also use restartInstance)
- May need a `waitForReconnect(instanceId)` utility in gateway-event-relay.ts

</code_context>

<specifics>
## Specific Ideas

No specific requirements — research and discussion decisions provide clear direction.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-extension-operations*
*Context gathered: 2026-04-05*
