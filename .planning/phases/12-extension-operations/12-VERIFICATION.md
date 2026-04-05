---
phase: 12-extension-operations
verified: 2026-04-05T05:10:00Z
status: human_needed
score: 7/7 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "Multiple plugin operations can be batched into a single config.patch call (EXT-03)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Plugin activation keeps Docker container alive"
    expected: "Install and activate a plugin; verify in Docker stats that the container is NOT stopped/recreated and any active chat session survives"
    why_human: "Container lifecycle behavior cannot be verified from static code; requires running Docker instance"
  - test: "Post-restart dashboard status transitions"
    expected: "After plugin activate, dashboard shows instance as 'restarting' until tools.catalog confirms plugin loaded, then transitions to 'active'"
    why_human: "Requires live gateway + browser; visual state machine behavior"
  - test: "Failed plugin rollback flow"
    expected: "Install a deliberately broken plugin, activate it, verify platform marks it 'failed' in DB and the rollback config.patch fires"
    why_human: "Requires a failing plugin artifact and live gateway to observe actual rollback behavior"
  - test: "Skill enable/disable takes effect without gateway restart"
    expected: "Enable/disable a skill; verify instance status never transitions to 'restarting'; skill effect is immediate"
    why_human: "Requires live gateway to confirm no SIGUSR1 is triggered"
  - test: "Batch activate endpoint — single SIGUSR1 for multiple plugins"
    expected: "POST /instances/:id/plugins/batch-activate with { pluginIds: ['a','b','c'] } triggers exactly one gateway restart (not three)"
    why_human: "Requires live gateway with multiple installed plugins; log inspection needed to count SIGUSR1 signals"
---

# Phase 12: Extension Operations Verification Report

**Phase Goal:** Plugin and skill lifecycle operations use config.patch instead of full container restarts, with batched writes respecting rate limits and verified outcomes replacing optimistic status updates
**Verified:** 2026-04-05T05:10:00Z
**Status:** human_needed
**Re-verification:** Yes — after EXT-03 gap closure (Plan 12-03)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Plugin activation sends config.patch to the gateway instead of restarting the Docker container | VERIFIED | `_activatePluginWithLock` (plugin-store.ts:311): `await patchGatewayConfig(...)`. No `restartInstance` call present. |
| 2 | Plugin deactivation/disable sends config.patch to remove the plugin from gateway config instead of restarting the container | VERIFIED | `disablePlugin` (line 840): `await patchGatewayConfig(...)`. `uninstallPlugin` (line 897): `await patchGatewayConfig(...)` with RFC 7396 null-key removal. No `restartInstance` calls. |
| 3 | Multiple plugin operations can be batched into a single config.patch call | VERIFIED | `buildBatchPluginPatch` exported at line 133. `activatePluginsBatch` exported at line 570. Calls `patchGatewayConfig` exactly once (line 682) and `waitForReconnect` exactly once (line 685) for the multi-plugin path. Single-element batches delegate to `activatePlugin`. `POST /:id/plugins/batch-activate` endpoint at routes/plugins.ts:351. |
| 4 | After a config.patch triggers SIGUSR1 restart, the platform waits for reconnection before confirming success | VERIFIED | `waitForReconnect(instanceId, 60_000)` called after every `patchGatewayConfig` in plugin operations. `notifyReconnectWaiter` fires in both `.then()` and `.catch()` of `syncGatewayState` in PersistentGatewayClient. |
| 5 | If post-restart verification shows a plugin failed to load, the platform marks it failed and attempts a single rollback config.patch | VERIFIED | plugin-store.ts lines 688-714: reads DB status post-reconnect, detects `status === 'failed'`, calls `buildPluginRemovePatch` (single-plugin) or `buildBatchPluginPatch([], rollbackRemovals, [], ...)` (batch), fires one rollback `patchGatewayConfig`, catches rollback errors without retrying. |
| 6 | Plugin uninstall removes the plugin via config.patch instead of container restart | VERIFIED | `uninstallPlugin` (lines 862-899): fetches `currentLoadPaths`, deletes DB row, then calls `patchGatewayConfig` with RFC 7396 null entry + filtered paths, then `waitForReconnect`. |
| 7 | Skill enable/disable uses config.patch to modify gateway config without triggering a container restart | VERIFIED | `enableSkill` and `disableSkill` use `patchGatewayConfig` + advisory `skills.status` RPC verification. No `waitForReconnect` (correct — skills don't trigger SIGUSR1). Route handler passes `req.auth!.userId`. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/plugin-store.ts` | buildBatchPluginPatch and activatePluginsBatch functions (EXT-03) | VERIFIED | `buildBatchPluginPatch` at line 133 (exported, 27 lines, merges additions/removals/toggles into one RFC 7396 object). `activatePluginsBatch` at line 570 (exported, 167 lines, full lock management, single patchGatewayConfig + waitForReconnect, post-reconnect verification, batch rollback). |
| `apps/server/src/routes/plugins.ts` | POST /:id/plugins/batch-activate endpoint | VERIFIED | Route at line 351, placed before `/:pluginId/activate` (line 382). Imports `activatePluginsBatch` at line 9. Input validation, LockConflictError 409, 500 fallback. |
| `apps/server/src/services/extension-lifecycle.ts` | activatePluginsBatch import + JSDoc note | VERIFIED | Import at line 10. JSDoc at lines 388-391 documenting batch activation as available for pre-installed artifact callers. |
| `apps/server/src/services/gateway-event-relay.ts` | waitForReconnect promise mechanism and notifyReconnectWaiter callback | VERIFIED (unchanged from 12-01, regression clean) | `waitForReconnect` exported at line 37. `notifyReconnectWaiter` at line 56. `reconnectWaiters` Map at line 30. |
| `apps/server/src/services/skill-store.ts` | Refactored skill enable/disable using patchGatewayConfig | VERIFIED (unchanged from 12-02, regression clean) | `buildSkillTogglePatch`, `enableSkill`, `disableSkill` all use config.patch. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `plugin-store.ts` | `instance-manager.ts` | `patchGatewayConfig` called once in activatePluginsBatch | WIRED | Line 682: `await patchGatewayConfig(instanceId, userId, patch, 'Batch activate N plugins: ...')`. Loop body (lines 611-663) contains NO patchGatewayConfig calls — only DB reads and artifact reinstall. |
| `plugin-store.ts` | `gateway-event-relay.ts` | `waitForReconnect` called once in activatePluginsBatch | WIRED | Line 685: `await waitForReconnect(instanceId, 60_000)`. Appears once in main batch path; second appearance (line 708) is inside rollback `try` block (conditional on failures). |
| `routes/plugins.ts` | `plugin-store.ts` | `activatePluginsBatch` imported and used | WIRED | Import at line 9. Called at line 366 inside `POST /:id/plugins/batch-activate` handler. |
| `extension-lifecycle.ts` | `plugin-store.ts` | `activatePluginsBatch` import | WIRED | Line 10 import confirmed. JSDoc documents its availability. Import is used for documentation/future wiring — current replay loop unchanged by design (explicitly documented decision). |
| `routes/plugins.ts` | `extension-lock.ts` | `LockConflictError` for 409 response | WIRED | Import at line 16. `instanceof` check at line 370 in batch-activate handler. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXT-01 | 12-01 | Plugin activation uses config.patch instead of container restart | SATISFIED | `_activatePluginWithLock` uses `patchGatewayConfig` + `buildPluginAddPatch`. No `restartInstance` in plugin-store.ts. REQUIREMENTS.md line 38: `[x]`. |
| EXT-02 | 12-01 | Plugin deactivation uses config.patch instead of container restart | SATISFIED | `disablePlugin` uses `buildPluginTogglePatch(enabled:false)` + `patchGatewayConfig`. `uninstallPlugin` uses `buildPluginRemovePatch` + `patchGatewayConfig`. REQUIREMENTS.md line 39: `[x]`. |
| EXT-03 | 12-03 | Multiple plugin operations batched into single config.patch | SATISFIED | `buildBatchPluginPatch` merges additions/removals/toggles. `activatePluginsBatch` calls `patchGatewayConfig` once for all plugins. `POST /:id/plugins/batch-activate` exposes this via API. REQUIREMENTS.md line 40: `[x]`. |
| EXT-04 | 12-01 | Platform waits for reconnection + verifies via tools.catalog after SIGUSR1 restart | SATISFIED | `waitForReconnect` resolves after `syncGatewayState` completes; `syncGatewayState` calls `reconcileExtensions` which uses `tools.catalog` (extension-lifecycle.ts:234). REQUIREMENTS.md line 41: `[x]`. |
| EXT-05 | 12-01 | Post-restart failure marks plugin failed + offers single rollback config.patch | SATISFIED | plugin-store.ts lines 688-714: reads DB after reconnect, detects `status === 'failed'`, fires one rollback `patchGatewayConfig`, catches rollback errors without retrying. REQUIREMENTS.md line 42: `[x]`. |
| EXT-06 | 12-02 | Skill enable/disable uses config.patch without restart | SATISFIED | `enableSkill` and `disableSkill` use `patchGatewayConfig` + advisory `skills.status` RPC verification. No `waitForReconnect` (correct). REQUIREMENTS.md line 43: `[x]`. |

All six requirements show `[x]` in REQUIREMENTS.md and Phase 12 status column shows "Complete" for all (lines 95-100).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| No blocker anti-patterns found in Plan 12-03 modified files | — | — | — | — |

`catch(() => {})` instances in `activatePluginsBatch` at lines 596 and 721 are legitimate best-effort lock release calls — not silenced errors on critical paths. The main error is re-thrown after lock cleanup.

### Human Verification Required

#### 1. Container Survival Under Plugin Activate

**Test:** Install a plugin on a running instance, activate it. Use `docker stats` or `docker ps` to confirm the container ID does not change and is never stopped.
**Expected:** Container stays alive with same ID; only the gateway process restarts internally via SIGUSR1.
**Why human:** Container lifecycle cannot be asserted from TypeScript; requires Docker daemon access.

#### 2. Dashboard Status Transitions (EXT-04)

**Test:** Activate a plugin while watching the Aquarium web UI. Observe the instance status indicator.
**Expected:** Instance transitions to "restarting" immediately (shutdown event received), then back to "active" or "running" after `tools.catalog` confirms plugin loaded.
**Why human:** Requires a running browser + WebSocket connection to observe real-time state transitions.

#### 3. Failed Plugin Rollback (EXT-05)

**Test:** Install a plugin with a deliberately broken entry point (e.g., `exports.register = undefined`). Activate it. Observe that: (a) instance transitions to "restarting", (b) after reconnect the plugin status is "failed" in the UI, (c) a second `config.patch` (the rollback) is logged server-side.
**Expected:** Plugin marked "failed"; rollback removes it from gateway config; no recursive retries.
**Why human:** Requires an intentionally broken plugin artifact and live gateway to trace the rollback.

#### 4. Skill Enable Without Restart (EXT-06)

**Test:** Enable/disable a skill while watching instance status. Confirm instance stays "running" throughout.
**Expected:** No "restarting" transition; skill effective immediately; `skills.status` RPC returns updated state within 15 seconds.
**Why human:** Dynamic skill loading behavior must be observed live; static code only proves config.patch is sent.

#### 5. Batch Activate — Single SIGUSR1 for Multiple Plugins

**Test:** Install 3+ plugins on an instance (leaving them in "installed" state). Call `POST /instances/:id/plugins/batch-activate` with all plugin IDs. Monitor server logs and Docker logs to count SIGUSR1 signals.
**Expected:** Exactly one gateway restart (one SIGUSR1) regardless of how many plugins are in the batch. Rate-limit slot consumed: 1.
**Why human:** Requires live gateway with multiple installed plugins; log inspection needed to count SIGUSR1 signals and verify single rate-limit consumption.

---

## Re-verification Summary

**EXT-03 gap is closed.** Plan 12-03 (commits `879c7f0` and `ef5b7b4`) delivered:

1. `buildBatchPluginPatch` — merges additions, removals, and toggles into one RFC 7396 merge-patch object. Exported from `plugin-store.ts` at line 133. Substantive (27 lines, full path/entry manipulation logic).

2. `activatePluginsBatch` — calls `patchGatewayConfig` exactly once for all plugins and `waitForReconnect` exactly once. Handles lock acquisition failure with full cleanup, post-reconnect per-plugin status verification, batch rollback for failed plugins, and single-element delegation to existing `activatePlugin`. Exported from `plugin-store.ts` at line 570.

3. `POST /:id/plugins/batch-activate` — placed before `/:pluginId/activate` in Express routing (correct), input-validated (`pluginIds` non-empty string array), returns `{ activated, failed }`, handles `LockConflictError` with 409.

4. `extension-lifecycle.ts` — imports `activatePluginsBatch` with JSDoc documenting batch availability. Phase 3 replay loop is intentionally unchanged (documented decision: installPlugin auto-activates, making a two-pass batch refactor invasive for minimal benefit).

All 7 observable truths verified. All 6 EXT requirements satisfied. Typecheck passes with zero errors. No previous truths regressed.

Remaining items require live runtime validation (human verification).

---

_Verified: 2026-04-05T05:10:00Z_
_Verifier: Claude (gsd-verifier)_
