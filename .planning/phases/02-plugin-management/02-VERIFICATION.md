---
phase: 02-plugin-management
verified: 2026-04-04T02:31:52Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 2: Plugin Management Verification Report

**Phase Goal:** Users can install, activate, configure credentials for, enable/disable, and uninstall plugins from the bundled catalog, with gateway restart handled automatically and rollback on failure
**Verified:** 2026-04-04T02:31:52Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Plugin install stages artifact on disk via npm but does NOT add to gateway config | VERIFIED | `plugin-store.ts` calls `plugins.install` RPC then marks `installed`; no config.patch RPC. DB-first activation pattern used instead. |
| 2 | No-credential plugins auto-activate within same lock hold (PLUG-03) | VERIFIED | `installPlugin` lines 329-348: when `requiredCredentials.length === 0`, calls `_activatePluginWithLock` with existing `fencingToken`/`operationId` before releasing lock. |
| 3 | Plugin activation patches config, restarts gateway, and verifies health | VERIFIED | `_activatePluginWithLock` lines 165-193: updates DB to `active`, calls `restartInstance`, then `platform.ping` health check at 120s timeout. |
| 4 | Failed activation rolls back: removes plugin from config, restarts again, marks failed (PLUG-07) | VERIFIED | Lines 196-219: on `healthCheckError !== null`, marks `failed`, calls `restartInstance` again (seedConfig now excludes failed plugin), calls `releaseLock` with `'rolled-back'`. |
| 5 | Plugin enable/disable toggles DB status and restarts gateway | VERIFIED | `enablePlugin` and `disablePlugin` both update DB (enabled/status) then call `restartInstance`; seedConfig reads DB on restart. |
| 6 | Plugin uninstall removes DB row, restarts, deletes from config | VERIFIED | `uninstallPlugin` deletes row, calls `restartInstance`; seedConfig no longer picks up deleted plugin. |
| 7 | Managed plugins from instance_plugins appear in seedConfig plugins.entries + load.paths | VERIFIED | `adapter.ts` lines 538-564: queries `instance_plugins WHERE status IN ('active','degraded') AND enabled=1`, populates `pluginEntries[pluginId]` and `loadPaths` dynamically. |
| 8 | commands.plugins is set to false in seedConfig for managed instances (PLUG-10) | VERIFIED | `adapter.ts` line 597: `cfg.commands = { ..., plugins: false }`. |
| 9 | Plugin reconciliation on boot compares plugins.list with DB state | VERIFIED | `extension-lifecycle.ts` lines 193-277: calls `plugins.list` RPC, applies 6-rule reconciliation against `getPluginsForInstance` results, soft-logs on RPC failure. |
| 10 | GET /plugins returns managed plugins + gateway built-ins as separate arrays | VERIFIED | `routes/plugins.ts` lines 29-84: returns `{ managed: InstancePlugin[], gatewayBuiltins: GatewayExtensionInfo[] }`. |
| 11 | All mutation routes return 409 on LockConflictError | VERIFIED | 5 `LockConflictError` catches across install, activate, PUT, DELETE routes. GET routes are read-only and need none. |
| 12 | Plugins sub-tab shows installed plugins with full action UI; no "coming soon" | VERIFIED | `ExtensionsTab.tsx`: `comingSoon` count=0. Plugin sub-tab renders `ExtensionRow` components with Activate button, toggle, gear, uninstall. |
| 13 | User sees ConfirmRestartDialog, RestartBanner, and RollbackModal for activation UX | VERIFIED | All 4 components exist and are imported+rendered in `ExtensionsTab.tsx`. `ConfirmRestartDialog` gates activation; `RestartBanner` polls for completion; `RollbackModal` shown on `onComplete(false)`. |

**Score:** 13/13 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/plugin-store.ts` | Plugin lifecycle CRUD with gateway restart and rollback | VERIFIED | 8 exported functions: `getPluginsForInstance`, `getPluginById`, `installPlugin`, `activatePlugin`, `enablePlugin`, `disablePlugin`, `uninstallPlugin`, `updatePluginStatus`. Substantive implementation (618 lines). All mutations use `acquireLock`/`releaseLock` in try/finally. |
| `apps/server/src/routes/plugins.ts` | Plugin CRUD REST API with 7 route handlers | VERIFIED | 7 route handlers (3x GET, 2x POST, 1x PUT, 1x DELETE). Catalog route defined before `:pluginId` to prevent route capture. All mutations catch `LockConflictError` → 409. |
| `apps/server/src/server-core.ts` | Plugin routes mounted at /api/instances | VERIFIED | Line 41: `import pluginRoutes from './routes/plugins.js'`; line 161: `app.use('/api/instances', pluginRoutes)`. |
| `apps/server/src/agent-types/openclaw/adapter.ts` | Managed plugin entries in seedConfig + commands.plugins disabled | VERIFIED | Lines 538-564: queries `instance_plugins`, builds `pluginEntries` and dynamic `loadPaths`. Line 597: `plugins: false` in `cfg.commands`. |
| `apps/server/src/services/extension-lifecycle.ts` | Plugin reconciliation alongside skill reconciliation | VERIFIED | Lines 193-277: full plugin reconciliation block with `plugins.list` RPC, 6-rule logic, soft-log on failure. `recoverOrphanedOperations` counts orphaned pending plugins. |
| `apps/web/src/components/extensions/ExtensionRow.tsx` | Shared row component for plugins and skills | VERIFIED | `extensionKind` prop; shows `Activate` button when `extensionKind==='plugin' && status==='installed'`, toggle otherwise. Both gear and uninstall always present. |
| `apps/web/src/components/extensions/CatalogExtensionRow.tsx` | Shared catalog row for plugins and skills | VERIFIED | `extensionKind` prop; capabilities badges for plugins, `requiredBinaries` for skills; "requires gateway restart" note for plugin installs. |
| `apps/web/src/components/extensions/ConfirmRestartDialog.tsx` | Activation confirmation dialog gating gateway restart | VERIFIED | Renders with restart warning text per CONTEXT.md locked decision; Cancel + Activate buttons. Wired in `ExtensionsTab` via `confirmActivatePluginId` state. |
| `apps/web/src/components/extensions/InstallDialog.tsx` | Shared install confirmation dialog | VERIFIED | Shows source, version, credential list, and plugin restart warning. No vault/scope picker (correctly deferred to Phase 5). |
| `apps/web/src/components/extensions/RestartBanner.tsx` | Gateway restart progress banner with polling | VERIFIED | `setInterval` 2s polling in `useEffect` with cleanup on unmount. Calls `onComplete(true/false)` on status change. |
| `apps/web/src/components/extensions/RollbackModal.tsx` | Activation failure/rollback error modal | VERIFIED | User-friendly summary + expandable `<details>/<summary>` technical details. Retry and Close buttons. |
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | extensionKind support for plugin credentials | VERIFIED | Props renamed to `extensionId`/`extensionName`/`extensionKind`; posts `extensionKind` to extension-credentials route. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `plugin-store.ts` | `extension-lock.ts` | `acquireLock`/`releaseLock` for all mutations | WIRED | Every mutation function (`installPlugin`, `activatePlugin`, `enablePlugin`, `disablePlugin`, `uninstallPlugin`) calls `acquireLock` and releases in try/finally. |
| `plugin-store.ts` | `instance-manager.ts` | `restartInstance` for activation/rollback | WIRED | `_activatePluginWithLock` calls `restartInstance` (success) and again (rollback). `enablePlugin`, `disablePlugin`, `uninstallPlugin` also call `restartInstance`. |
| `adapter.ts` | `instance_plugins` table | DB query for active/degraded plugins in seedConfig | WIRED | `db('instance_plugins').where(...).whereIn('status', ['active','degraded'])` confirmed at lines 541-544. |
| `routes/plugins.ts` | `services/plugin-store.ts` | Import and service calls for all CRUD | WIRED | Line 5-12: `import { getPluginsForInstance, getPluginById, installPlugin, activatePlugin, enablePlugin, disablePlugin, uninstallPlugin }`. All 7 routes call appropriate service functions. |
| `server-core.ts` | `routes/plugins.ts` | `app.use` mount | WIRED | Lines 41+161: import and mount confirmed. |
| `ExtensionsTab.tsx` | `/api/instances/:id/plugins` | `api.get` for plugin list and catalog | WIRED | Lines 129+134: `api.get('/instances/${instanceId}/plugins')` and `api.get('/instances/${instanceId}/plugins/catalog')` in `fetchPluginData`. |
| `ExtensionsTab.tsx` | `ConfirmRestartDialog.tsx` | `confirmActivatePluginId` state triggers dialog | WIRED | Lines 82+439-444: state set, dialog rendered conditionally, `onConfirm` calls `handlePluginActivateConfirm`. |
| `ExtensionsTab.tsx` | `/api/instances/:id/plugins/:pluginId/activate` | `api.post` for activation | WIRED | Line 221: `api.post('/instances/${instanceId}/plugins/${pluginId}/activate')` in `handlePluginActivateConfirm`. |
| `RestartBanner.tsx` | `/api/instances/:id/plugins` | Polling list to detect completion | WIRED | Line 28: `api.get('/instances/${instanceId}/plugins')` every 2s, finds plugin by `pluginId`. Note: uses list endpoint rather than single-plugin endpoint per CONTEXT.md spec (functionally equivalent — see note below). |
| `extension-credentials.ts` | plugin `extensionKind` | Already validates `extensionKind='plugin'` | WIRED | Line 59: `(extensionKind !== 'skill' && extensionKind !== 'plugin')` — plugins accepted without modification. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|---------|
| PLUG-01 | 02-02, 02-03 | User can browse bundled plugins catalog | SATISFIED | `GET /instances/:id/plugins/catalog` with search+category filters; CatalogExtensionRow rendered in Plugins sub-tab. |
| PLUG-02 | 02-01, 02-02 | User can install a plugin artifact (npm, no config.patch, status → installed or active) | SATISFIED | `installPlugin` stages artifact via `plugins.install` RPC (no config.patch); marks `installed` (or auto-activates via PLUG-03). |
| PLUG-03 | 02-01 | Plugins with no required credentials skip to activate within same lock hold | SATISFIED | `installPlugin` calls `_activatePluginWithLock` with existing fencingToken when `requiredCredentials.length === 0`. |
| PLUG-04 | 02-02, 02-03 | User can configure extension-scoped credentials for a plugin | SATISFIED | `extension-credentials` route already accepts `extensionKind='plugin'`; `CredentialConfigPanel` updated to pass `extensionKind`; gear icon wired in `ExtensionRow`. |
| PLUG-05 | 02-01, 02-02, 02-04 | User can activate a plugin triggering gateway restart + health check | SATISFIED | `activatePlugin` → `_activatePluginWithLock` → DB update → `restartInstance` → `platform.ping`. Full UX: ConfirmRestartDialog → API → RestartBanner polling. |
| PLUG-06 | 02-01 | Plugin activation verifies artifact and reinstalls from lockedVersion if missing | SATISFIED | `_activatePluginWithLock` lines 120-149: proactively reinstalls when `lockedVersion` is set and instance has `controlEndpoint`. |
| PLUG-07 | 02-01, 02-04 | System rolls back failed plugin activation | SATISFIED | Health check failure path: marks `failed`, calls `restartInstance` again, releases lock with `'rolled-back'`. RollbackModal shown in UI. |
| PLUG-08 | 02-01, 02-02, 02-03 | User can enable/disable an installed plugin | SATISFIED | `enablePlugin`/`disablePlugin` in service; `PUT /:id/plugins/:pluginId` route; toggle in ExtensionRow. |
| PLUG-09 | 02-01, 02-02, 02-03 | User can uninstall a plugin | SATISFIED | `uninstallPlugin` in service; `DELETE /:id/plugins/:pluginId` route; uninstall button in ExtensionRow. |
| PLUG-10 | 02-01 | System disables `commands.plugins` for managed instances | SATISFIED | `adapter.ts` line 597: `cfg.commands = { ..., plugins: false }`. |
| UI-02 | 02-04 | Catalog browse with search, category filter, and trust signal display | SATISFIED | `searchQuery`/`categoryFilter` state in ExtensionsTab; `filteredCatalog` derived value applied before rendering; catalog search/filter bar renders. Source badges (bundled/clawhub) in CatalogExtensionRow. |
| UI-03 | 02-04 | Install flow dialog with trust summary, credential input — vault/instance scope DEFERRED | PARTIALLY SATISFIED (by design) | InstallDialog shows source, version, credential list, and restart warning. Vault/instance scope picker explicitly deferred to Phase 5 (OAUTH-03) per CONTEXT.md locked decision. REQUIREMENTS.md already marks this as Complete. |
| UI-04 | 02-03 | Credential configuration panel with extension-scoped credential management | SATISFIED | CredentialConfigPanel accepts `extensionKind='plugin'`; gear icon in ExtensionRow opens panel via `onConfigure` → `configuringExtension` state. |

**Orphaned requirements check:** No requirements mapped to Phase 2 in REQUIREMENTS.md outside of the declared plan requirements.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `RestartBanner.tsx` line 28 | Polls `/instances/${instanceId}/plugins` (list) not `/instances/${instanceId}/plugins/${pluginId}` (single) | INFO | Functionally equivalent: list contains the same `status` field. Slightly over-fetches (all managed plugins) when only one is needed. No data integrity issue. The single-plugin endpoint (`GET /:id/plugins/:pluginId`) IS implemented in routes/plugins.ts and ready for a targeted refactor if desired. |
| None | TODO/FIXME/PLACEHOLDER | — | Zero found across all phase 2 files. |
| None | Empty implementations (return null/return []) | — | Zero stub patterns found. |

---

### Human Verification Required

The following items cannot be fully verified without a running instance:

#### 1. Full Plugin Activation Flow (End-to-End)

**Test:** Start server + web, open an instance, navigate to Extensions > Plugins, install a bundled plugin, click Activate.
**Expected:** ConfirmRestartDialog appears with restart warning. After confirming, RestartBanner shows with spinner. After restart completes (~30s), plugin shows as active with toggle enabled. Banner disappears.
**Why human:** Gateway restart timing, banner state transitions, and actual RPC calls to a running OpenClaw gateway cannot be verified statically.

#### 2. Rollback Flow on Activation Failure

**Test:** Activate a plugin that is known to fail health check (e.g., a plugin with a broken config).
**Expected:** RestartBanner disappears, RollbackModal appears with error summary and expandable technical details. Plugin shows as failed (red dot). "Retry Activation" button restarts the two-step flow.
**Why human:** Requires triggering an actual health check failure; cannot mock at static analysis time.

#### 3. Credential Configuration for Plugins

**Test:** Install a plugin requiring credentials. Click gear icon. Verify CredentialConfigPanel opens with extensionKind='plugin' in the POST body.
**Expected:** POST to `/extension-credentials` includes `extensionKind: 'plugin'`. Credentials saved successfully.
**Why human:** Network request body inspection requires a running server.

#### 4. Skills Sub-Tab Regression

**Test:** Switch to Skills sub-tab after adding plugin code. Verify existing skills still list, install, toggle, and configure normally.
**Expected:** SkillRow (thin wrapper → ExtensionRow) renders identically to pre-Phase 2. CatalogSkillRow works.
**Why human:** Visual/behavioral regression requires live UI interaction.

#### 5. Dark Mode for All New UI Elements

**Test:** Toggle dark mode. Check ConfirmRestartDialog, InstallDialog, RestartBanner, and RollbackModal appearance.
**Expected:** All Oxide CSS variables (`var(--color-*)`) adapt correctly. No hardcoded colors visible.
**Why human:** Visual appearance cannot be verified programmatically.

---

### Gaps Summary

No gaps found. All 13 must-haves are verified at all three levels (exists, substantive, wired).

**Notable implementation note (RestartBanner polling endpoint):** The CONTEXT.md specification said to poll `GET /instances/:id/plugins/:pluginId` (single-plugin endpoint). The implementation polls `GET /instances/:id/plugins` (list endpoint) and locates the plugin via `.find()`. The single-plugin endpoint is implemented and ready in `routes/plugins.ts` but unused by RestartBanner. This is a minor deviation with no user-visible impact and no correctness issue. A targeted refactor to use the single endpoint would reduce payload size per poll.

**UI-03 deferral:** The "vault/instance scope choice" portion of UI-03 is deferred to Phase 5 (OAUTH-03) per explicit decision in CONTEXT.md and plan 02-04. REQUIREMENTS.md marks UI-03 as "Complete" — the install dialog is fully implemented, with only the vault scope picker absent. This is a product decision, not an implementation gap.

---

_Verified: 2026-04-04T02:31:52Z_
_Verifier: Claude (gsd-verifier)_
