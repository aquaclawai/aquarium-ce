# Phase 12: Extension Operations - Research

**Researched:** 2026-04-05
**Domain:** Plugin/skill lifecycle refactoring from container-restart to config.patch
**Confidence:** HIGH

## Summary

Phase 12 replaces all `restartInstance()` calls in plugin and skill lifecycle operations with `patchGatewayConfig()` calls. This is the final consumer phase -- it relies entirely on infrastructure built in Phases 9-11 (gatewayCall facade, patchGatewayConfig with gateway-first flow, syncGatewayState on reconnect, reconcileExtensions). The work is surgical refactoring of existing service functions, not new infrastructure.

The critical technical challenge is the wait-for-reconnect mechanism. When a config.patch triggers SIGUSR1 restart (all plugin changes do), the PersistentGatewayClient's WebSocket drops, reconnects with exponential backoff, and runs syncGatewayState (which includes reconcileExtensions). Plugin activation must wait for this cycle to complete before confirming success. Currently no such wait mechanism exists -- it must be added to gateway-event-relay.ts.

The second challenge is building correct merge-patches for plugin entries. The gateway config uses `plugins.entries` as `Record<id, {enabled, config}>` and `plugins.load.paths` as `string[]`. Adding a plugin requires patching both; removing requires using RFC 7396 null-deletion for the entry and rebuilding load.paths.

**Primary recommendation:** Implement a `waitForReconnect(instanceId)` promise in gateway-event-relay.ts, then systematically replace every `restartInstance()` call in plugin-store.ts with `patchGatewayConfig()` + `waitForReconnect()` + post-reconnect verification via reconcileExtensions results.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Plugin activate: DB status -> active, then `patchGatewayConfig()` with plugin added to `plugins.entries`
- Gateway does SIGUSR1 restart internally -> reconnect -> `syncGatewayState()` reconciliation detects success/failure
- Docker container stays alive -- chat sessions survive the operation
- The existing `_activatePluginWithLock` flow refactored: replace `restartInstance()` with `patchGatewayConfig()` + wait for reconnect reconciliation
- Plugin deactivate: DB status -> disabled, then `patchGatewayConfig()` with plugin removed from `plugins.entries`
- Same gateway restart -> reconnect -> reconciliation cycle
- Single config.patch rollback: if post-restart reconciliation shows plugin absent from tools.catalog, send one config.patch removing the failed plugin entry
- If the rollback config.patch also fails (rate limit, network error): mark as 'failed' in DB, let user retry manually
- No recursive rollback -- one attempt only
- Single merged config.patch: collect all plugin changes into one merge-patch object, send one config.patch
- One restart, one rate-limit slot consumed
- Gateway merges all plugin entries atomically
- All plugins verified together in the post-reconnect reconciliation
- Skills use `patchGatewayConfig()` for consistency
- Since skills don't trigger SIGUSR1 restart (dynamically loaded), no need to wait for reconnect
- Send config.patch -> read-back hash -> update DB. Immediate effect.
- Verify via `skills.status` RPC after patch (not tools.catalog)

### Claude's Discretion
- How to build the merge-patch for adding/removing plugin entries
- How to detect "plugin failed to load" vs "plugin not yet loaded" in reconciliation timing
- Exact wait-for-reconnect mechanism (Promise that resolves when syncGatewayState completes?)
- Whether enablePlugin/disablePlugin need the full activate/deactivate cycle or can be simpler (just toggle in config.patch)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXT-01 | Plugin activation uses config.patch to add plugin to gateway config instead of restarting container | patchGatewayConfig already built (Phase 10); need merge-patch builder for plugins.entries + load.paths; replace restartInstance in _activatePluginWithLock |
| EXT-02 | Plugin deactivation uses config.patch to remove plugin from gateway config instead of restarting container | Same patchGatewayConfig; need null-deletion merge-patch for entries + rebuild load.paths; replace restartInstance in disablePlugin/uninstallPlugin |
| EXT-03 | Multiple plugin operations batched into single config.patch to respect 3/min rate limit | Need batch merge-patch builder; all plugin entries merged before single patchGatewayConfig call |
| EXT-04 | After config.patch triggers gateway restart (SIGUSR1), platform waits for reconnection and verifies via tools.catalog | Need waitForReconnect promise mechanism; syncGatewayState + reconcileExtensions already handles verification |
| EXT-05 | If post-restart verification shows plugin failed to load, platform marks failed and offers rollback | reconcileExtensions already demotes absent plugins; need single-attempt config.patch rollback (remove entry) |
| EXT-06 | Skill enable/disable/configure uses config.patch without triggering restart | Skills currently use direct skills.update RPC; switch to patchGatewayConfig for consistency; skip reconnect wait |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.20.0 | WebSocket transport (PersistentGatewayClient) | Already in use; all RPC through persistent client |
| knex | 3.1.0 | DB queries for plugin/skill status updates | Already in use; standard DB layer |
| better-sqlite3 | 11.x | SQLite backend | CE standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto | built-in | randomUUID for RPC correlation | Already used in gateway-event-relay.ts |
| node:events | built-in | EventEmitter for reconnect notifications | Potential use for waitForReconnect |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom waitForReconnect | rxjs Observable | Overkill; simple Promise + event listener sufficient |
| Manual merge-patch builder | json-merge-patch npm | Unnecessary dependency; merge-patch is ~10 lines for this use case |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
apps/server/src/
  services/
    plugin-store.ts       # MODIFY: replace restartInstance with patchGatewayConfig + waitForReconnect
    skill-store.ts        # MODIFY: replace skills.update RPC with patchGatewayConfig (optional)
    instance-manager.ts   # EXISTS: patchGatewayConfig, syncGatewayState already built
    gateway-event-relay.ts # MODIFY: add waitForReconnect() export + reconnect event
    extension-lifecycle.ts # EXISTS: reconcileExtensions already handles verification
  agent-types/openclaw/
    gateway-rpc.ts         # EXISTS: extractPluginPresence, extractPluginConfigEntries
```

### Pattern 1: waitForReconnect Promise
**What:** A Promise-based mechanism that resolves when the PersistentGatewayClient reconnects and syncGatewayState completes for a specific instance.
**When to use:** After any patchGatewayConfig that touches plugins.* (triggers SIGUSR1 restart).
**Example:**
```typescript
// In gateway-event-relay.ts:
// Map of instanceId -> { resolve, reject, timer } for pending reconnect waits
const reconnectWaiters = new Map<string, {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function waitForReconnect(instanceId: string, timeoutMs = 60_000): Promise<void> {
  // Clean up existing waiter if any
  const existing = reconnectWaiters.get(instanceId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error('Superseded by new wait'));
    reconnectWaiters.delete(instanceId);
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reconnectWaiters.delete(instanceId);
      reject(new Error(`Reconnect timeout for instance ${instanceId} (${timeoutMs}ms)`));
    }, timeoutMs);

    reconnectWaiters.set(instanceId, { resolve, reject, timer });
  });
}

// Called from within PersistentGatewayClient after syncGatewayState completes:
function notifyReconnectWaiter(instanceId: string): void {
  const waiter = reconnectWaiters.get(instanceId);
  if (waiter) {
    clearTimeout(waiter.timer);
    reconnectWaiters.delete(instanceId);
    waiter.resolve();
  }
}
```

### Pattern 2: Plugin Merge-Patch Builder
**What:** Builds the correct `{ raw: JSON5 }` merge-patch for adding/removing plugin entries.
**When to use:** Plugin activate, deactivate, enable, disable, uninstall.
**Example:**
```typescript
// Adding a plugin to gateway config:
function buildPluginAddPatch(
  pluginId: string,
  pluginConfig: Record<string, unknown>,
  loadPath: string,
  currentLoadPaths: string[],
): Record<string, unknown> {
  return {
    plugins: {
      entries: {
        [pluginId]: { enabled: true, ...pluginConfig },
      },
      load: {
        paths: [...currentLoadPaths, loadPath],
      },
    },
  };
}

// Removing a plugin from gateway config (RFC 7396: null = delete):
function buildPluginRemovePatch(
  pluginId: string,
  currentLoadPaths: string[],
  removePath: string,
): Record<string, unknown> {
  return {
    plugins: {
      entries: {
        [pluginId]: null, // RFC 7396: null deletes the key
      },
      load: {
        paths: currentLoadPaths.filter(p => p !== removePath),
      },
    },
  };
}
```

### Pattern 3: Plugin Activation Flow (New)
**What:** The refactored _activatePluginWithLock flow using config.patch instead of restartInstance.
**When to use:** Replaces current _activatePluginWithLock.
**Example:**
```typescript
// Simplified flow:
// 1. DB status -> 'active'
// 2. Build merge-patch for plugins.entries + load.paths
// 3. patchGatewayConfig(instanceId, userId, patch)
//    - This triggers SIGUSR1 in gateway
//    - Gateway WS drops, reconnects
//    - syncGatewayState runs (includes reconcileExtensions)
// 4. waitForReconnect(instanceId, 60_000)
// 5. Check DB status: reconcileExtensions may have demoted to 'failed'
// 6. If failed: single rollback config.patch (remove entry), mark 'failed'
// 7. If still 'active': success
```

### Pattern 4: Skill Config Patch (No Restart)
**What:** Skills use patchGatewayConfig for consistency but skip reconnect wait.
**When to use:** Skill enable/disable/configure.
**Example:**
```typescript
// Skill operations: config.patch does NOT trigger SIGUSR1 for skills
// (skills are dynamically loaded, reload plan = 'none')
// Flow:
// 1. Build merge-patch for skills section
// 2. patchGatewayConfig(instanceId, userId, patch)
// 3. Verify immediately via gatewayCall(instanceId, 'skills.status', {})
// 4. Update DB based on skills.status response
```

### Anti-Patterns to Avoid
- **Double restart on failure:** Current code does activate -> restartInstance -> health check -> fail -> restartInstance (rollback). The new flow must NOT do this. Instead: config.patch -> reconnect -> reconcile -> if failed, single rollback config.patch.
- **Optimistic status updates without verification:** Never set DB status to 'active' and leave it. Always verify via tools.catalog (plugins) or skills.status (skills) after the operation.
- **Sequential config.patches for multiple plugins:** Never send one config.patch per plugin. Always batch into a single merged patch. The 3/min rate limit makes sequential patches fail on the 4th plugin.
- **Waiting for reconnect on skill operations:** Skills don't trigger SIGUSR1. Waiting for reconnect after a skill config.patch will timeout (the gateway never restarts).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin verification after restart | Custom tools.catalog polling loop | reconcileExtensions (extension-lifecycle.ts) | Already handles promote/demote logic; runs automatically via syncGatewayState on reconnect |
| Gateway config patching | Direct WebSocket RPC + DB write | patchGatewayConfig (instance-manager.ts) | Already handles baseHash, rate limits, retry, read-back, DB persistence |
| Reconnect detection | Polling instance status | waitForReconnect event-based mechanism | Event-driven is more efficient and deterministic than polling |
| Merge-patch format | Manual JSON5 string building | `JSON.stringify(patch)` in `raw` field | patchGatewayConfig already wraps configPatch into `{ raw: JSON.stringify(configPatch) }` |
| RPC routing | Direct WebSocket calls | gatewayCall facade | Already handles persistent-first routing, queuing, retry |

**Key insight:** Phase 12 is a consumer of Phases 9-11 infrastructure. Nearly all the hard problems (gateway-first config writes, reconnect handling, state reconciliation, extension verification) are already solved. The work is plumbing existing functions into plugin-store.ts and skill-store.ts.

## Common Pitfalls

### Pitfall 1: load.paths Array Replacement in Merge-Patch
**What goes wrong:** RFC 7396 merge-patch replaces arrays entirely (no merge-by-id for arrays). If you patch `plugins.load.paths` with just the new plugin path, you lose all existing paths.
**Why it happens:** The gateway's merge-patch implementation uses `mergeObjectArraysById` for objects with `id` fields, but `load.paths` is a simple string array without IDs.
**How to avoid:** Always read current config via `config.get` first, get existing `plugins.load.paths`, append/remove, and send the complete array in the patch.
**Warning signs:** After plugin activation, other plugins stop working (their load paths disappeared).

### Pitfall 2: Reconnect Waiter Not Cleaned Up on Error
**What goes wrong:** If patchGatewayConfig fails (e.g., rate limit), the waitForReconnect promise is never resolved because no SIGUSR1 was triggered.
**Why it happens:** waitForReconnect is set up before patchGatewayConfig is called, or the caller forgets to clean up on error.
**How to avoid:** Set up waitForReconnect AFTER patchGatewayConfig succeeds, not before. The SIGUSR1 is guaranteed only after a successful config.patch response.
**Warning signs:** Operations hanging for 60 seconds then timing out even though no restart was expected.

### Pitfall 3: Race Between Rollback Config.Patch and Rate Limit
**What goes wrong:** Activation config.patch succeeds (1 slot used), gateway restarts, reconciliation shows failure, rollback config.patch hits rate limit (already used slots within the 60s window).
**Why it happens:** 3 writes per 60 seconds. Activation + rollback = 2 writes. If a readback config.get also counted (it doesn't -- only patch/apply count), you'd be closer to the limit.
**How to avoid:** Rollback config.patch is only 1 additional write. With activation being 1 write, you're at 2/3. This is safe. But if batched activation used the 3rd slot (e.g., batch of 3 plugins + readback), the rollback may need to wait. Handle rate limit error in rollback by marking as 'failed' and letting user retry.
**Warning signs:** Rollback fails silently, plugin stuck in 'active' in DB but not actually loaded.

### Pitfall 4: enablePlugin/disablePlugin Conflation with activate/deactivate
**What goes wrong:** enablePlugin currently sets status to 'active' and calls restartInstance. But enable/disable is semantically different from activate/deactivate. Enable means "re-enable a disabled plugin" (it was once active); activate means "first-time activation from installed state."
**Why it happens:** Both currently use the same restartInstance pattern.
**How to avoid:** enablePlugin and disablePlugin can be simpler: just toggle `enabled` in the config.patch plugins.entries[pluginId] object. No need for the full _activatePluginWithLock flow. The plugin artifact is already installed; just tell the gateway to load/unload it.
**Warning signs:** Unnecessary complexity in enable/disable paths, redundant artifact verification.

### Pitfall 5: patchGatewayConfig Read-Back Fails During SIGUSR1
**What goes wrong:** patchGatewayConfig does a config.get read-back after config.patch. But if the patch triggers SIGUSR1, the gateway restarts and the read-back fails.
**Why it happens:** `restartDelayMs: 2000` means the gateway waits 2 seconds before restarting. The read-back might succeed if it completes within 2 seconds, but it's a race.
**How to avoid:** patchGatewayConfig already handles this -- if read-back fails, it falls back to the pre-patch hash. After reconnect, syncGatewayState updates the hash anyway. This is already safe.
**Warning signs:** Stale config_hash in DB (resolved on next syncGatewayState).

### Pitfall 6: Skill patchGatewayConfig vs Direct skills.update RPC
**What goes wrong:** Current skill enable/disable uses `gatewayCall(instanceId, 'skills.update', {skillId, enabled})` -- a direct RPC. The CONTEXT.md says to switch to patchGatewayConfig for consistency. But patchGatewayConfig patches the config file, while skills.update is a direct RPC that modifies skills in-memory AND writes config.
**Why it happens:** Two different paths to achieve the same result.
**How to avoid:** Determine which path is correct for skills. Since the research summary confirms skills changes do NOT trigger SIGUSR1 (reload plan = 'none'), using patchGatewayConfig for skills is safe -- it patches the config, gateway applies it without restart. Both paths should work. The patchGatewayConfig path is preferred because it maintains the gateway-first authority model consistently.
**Warning signs:** Skills stop working after config.patch (unlikely -- gateway reads skills dynamically).

## Code Examples

### Current Plugin Activation (to be replaced)
```typescript
// Current flow in _activatePluginWithLock (plugin-store.ts:189-200):
// 1. DB status -> 'active'
await db('instance_plugins')
  .where({ instance_id: instanceId, plugin_id: pluginId })
  .update({ status: 'active', enabled: 1, pending_owner: null, updated_at: db.fn.now() });

// 2. Full container restart (destroys container + recreates)
await restartInstance(instanceId, userId);

// 3. Health check via platform.ping
await gatewayCall(instanceId, 'platform.ping', {}, 120_000);
```

### New Plugin Activation (target)
```typescript
// New flow in _activatePluginWithLock:
// 1. DB status -> 'active'
await db('instance_plugins')
  .where({ instance_id: instanceId, plugin_id: pluginId })
  .update({ status: 'active', enabled: 1, pending_owner: null, updated_at: db.fn.now() });

// 2. Build merge-patch
const currentConfig = await gatewayCall(instanceId, 'config.get', {}) as { config?: Record<string, unknown> };
const existingPaths = (currentConfig?.config?.plugins as any)?.load?.paths ?? [];
const pluginConfig = existing.config || {};
const patch = {
  plugins: {
    entries: { [pluginId]: { enabled: true, ...pluginConfig } },
    load: { paths: [...existingPaths, `/home/node/.openclaw/plugins/${pluginId}`] },
  },
};

// 3. Apply via gateway-first config.patch (triggers SIGUSR1)
await patchGatewayConfig(instanceId, userId, patch, `Activate plugin: ${pluginId}`);

// 4. Wait for gateway restart + reconnect + syncGatewayState (includes reconcileExtensions)
await waitForReconnect(instanceId, 60_000);

// 5. Verify: re-read DB status (reconcileExtensions may have demoted to 'failed')
const updatedPlugin = await getPluginById(instanceId, pluginId);
if (updatedPlugin?.status === 'failed') {
  // 6. Rollback: single config.patch to remove the failed entry
  const rollbackPatch = {
    plugins: {
      entries: { [pluginId]: null },
      load: { paths: existingPaths }, // restore original paths
    },
  };
  try {
    await patchGatewayConfig(instanceId, userId, rollbackPatch, `Rollback plugin: ${pluginId}`);
    await waitForReconnect(instanceId, 60_000);
  } catch {
    // Rollback failed -- mark failed, user retries manually
  }
  throw new Error(`Plugin activation failed: ${updatedPlugin.errorMessage}`);
}
```

### Plugin Batching Pattern
```typescript
// For multi-plugin batch operations (EXT-03):
function buildBatchPluginPatch(
  additions: Array<{ pluginId: string; config: Record<string, unknown>; loadPath: string }>,
  removals: Array<{ pluginId: string; loadPath: string }>,
  currentLoadPaths: string[],
): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  let paths = [...currentLoadPaths];

  for (const add of additions) {
    entries[add.pluginId] = { enabled: true, ...add.config };
    if (!paths.includes(add.loadPath)) paths.push(add.loadPath);
  }
  for (const rm of removals) {
    entries[rm.pluginId] = null; // RFC 7396 null-deletion
    paths = paths.filter(p => p !== rm.loadPath);
  }

  return { plugins: { entries, load: { paths } } };
}
```

### waitForReconnect Integration Point
```typescript
// In PersistentGatewayClient, after syncGatewayState completes (line ~242):
syncGatewayState(this.instanceId)
  .then(() => {
    // Notify any pending waitForReconnect callers
    notifyReconnectWaiter(this.instanceId);
    if (wasExpectedRestart) {
      updateStatus(this.instanceId, 'running', {}, undefined).catch(/* ... */);
    }
  })
  .catch((err) => {
    // Still notify -- caller should check DB status for verification
    notifyReconnectWaiter(this.instanceId);
    if (wasExpectedRestart) {
      updateStatus(this.instanceId, 'running', {}, undefined).catch(/* ... */);
    }
  });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| restartInstance (full container stop+delete+start) | config.patch (SIGUSR1 in-process restart) | Phase 12 | Chat sessions survive; ~2s restart vs ~30s container restart |
| DB-first then reseedConfigFiles | Gateway-first config.patch then DB persist | Phase 10 | Gateway is authoritative; no state divergence |
| Health check via platform.ping | Verification via tools.catalog + skills.status | Phase 11 | Confirms actual plugin/skill state, not just "gateway alive" |
| Optimistic 'active' status before restart | Verified status after reconcileExtensions | Phase 11 | No false 'active' states |

**Deprecated/outdated:**
- `restartInstance()` for plugin operations: replaced by config.patch + waitForReconnect. restartInstance remains for explicit user-initiated full restarts only.
- `skills.update` direct RPC for skill toggle: replaced by patchGatewayConfig for consistency (gateway-first model).
- DB-first plugin activation: `_activatePluginWithLock` currently writes DB first then calls restartInstance. New flow still writes DB first (so reconcileExtensions can verify), but gateway is the authority for whether the plugin actually loaded.

## Open Questions

1. **Null-deletion in gateway merge-patch**
   - What we know: RFC 7396 says `null` deletes a key. The gateway uses `merge-patch.ts` which implements RFC 7396.
   - What's unclear: Whether the gateway's merge-patch handles `{ plugins: { entries: { "my-plugin": null } } }` correctly for nested key deletion.
   - Recommendation: The merge-patch implementation (cited in research summary) follows RFC 7396 faithfully. HIGH confidence this works. Verify during implementation with a quick manual test.

2. **enablePlugin simplification**
   - What we know: Currently enablePlugin sets DB status + restartInstance. In the new model, it could simply toggle `enabled` in the config.patch.
   - What's unclear: Whether toggling `enabled: false -> true` for a plugin entry is sufficient, or if the plugin needs to be re-added to load.paths too (if it was previously removed).
   - Recommendation: enablePlugin should set `plugins.entries[pluginId].enabled = true` and ensure load.path is present. disablePlugin should set `enabled: false` -- NOT remove the entry (that's uninstall). This is simpler than the activate flow because no artifact verification needed.

3. **Timing between patchGatewayConfig response and SIGUSR1 execution**
   - What we know: `restartDelayMs: 2000` is passed in config.patch call. Gateway waits 2s after patch response before SIGUSR1.
   - What's unclear: Exact timing variance. Could be 2s, could be longer if gateway is busy.
   - Recommendation: waitForReconnect with 60s timeout handles any variance. The 60s timeout is already used for the restart timer in PersistentGatewayClient.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.x (Chromium) |
| Config file | `playwright.config.ts` (root) |
| Quick run command | `npx playwright test tests/e2e/api.spec.ts -g "plugin" --headed` |
| Full suite command | `npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-01 | Plugin activation uses config.patch not container restart | manual-only | Requires running Docker instance with gateway | N/A |
| EXT-02 | Plugin deactivation uses config.patch not container restart | manual-only | Requires running Docker instance with gateway | N/A |
| EXT-03 | Multi-plugin batch into single config.patch | manual-only | Requires running Docker instance with gateway | N/A |
| EXT-04 | Wait for reconnection + verify via tools.catalog | manual-only | Requires running Docker instance with gateway | N/A |
| EXT-05 | Failed plugin detected, marked failed, rollback offered | manual-only | Requires running Docker instance with gateway | N/A |
| EXT-06 | Skill operations use config.patch, no restart | manual-only | Requires running Docker instance with gateway | N/A |

### Sampling Rate
- **Per task commit:** `npm run typecheck` (ensures no type errors in refactored code)
- **Per wave merge:** `npm run typecheck && npm run lint -w @aquarium/web`
- **Phase gate:** Full typecheck green + manual testing with Docker instance

### Wave 0 Gaps
- All EXT-* requirements require a running Docker instance with gateway (no mock gateway for CI -- known blocker from STATE.md)
- Manual testing guide should document: install plugin -> verify no container restart -> verify tools.catalog shows plugin -> verify chat session survived
- No new test files needed -- this is refactoring existing code paths

*(Manual-only justification: Gateway WebSocket protocol cannot be mocked in CI. All config.patch + SIGUSR1 + reconnect behavior requires a live gateway process. This is a known gap documented in STATE.md blockers.)*

## Sources

### Primary (HIGH confidence)
- `apps/server/src/services/plugin-store.ts` -- current plugin lifecycle (restartInstance calls at lines 200, 496, 548, 600)
- `apps/server/src/services/skill-store.ts` -- current skill lifecycle (skills.update RPC at lines 274, 322)
- `apps/server/src/services/instance-manager.ts` -- patchGatewayConfig (line 843), syncGatewayState (line 310), restartInstance (line 782)
- `apps/server/src/services/gateway-event-relay.ts` -- PersistentGatewayClient reconnect/syncGatewayState wiring (line 242)
- `apps/server/src/services/extension-lifecycle.ts` -- reconcileExtensions (line 139), plugin/skill verification logic
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts` -- extractPluginPresence, extractPluginConfigEntries, gatewayCall facade
- `apps/server/src/agent-types/openclaw/adapter.ts` -- seedConfig plugins.entries structure (line 547-581)
- `.planning/research/SUMMARY.md` -- gateway API behavior: merge-patch format, SIGUSR1 triggers, rate limits, skills reload plan
- `.planning/phases/12-extension-operations/12-CONTEXT.md` -- locked decisions

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` -- accumulated decisions from Phases 9-11 (config.patch format, reconcileExtensions behavior, skills.status RPC)
- `.planning/REQUIREMENTS.md` -- EXT-01 through EXT-06 requirement definitions

### Tertiary (LOW confidence)
- None -- all findings verified from source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies; all existing infrastructure
- Architecture: HIGH -- patterns directly follow existing codebase conventions and Phase 10-11 infrastructure
- Pitfalls: HIGH -- all identified from actual code paths and gateway protocol behavior documented in research summary
- Code examples: HIGH -- based on actual file contents, not hypothetical patterns

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- no external dependencies changing)
