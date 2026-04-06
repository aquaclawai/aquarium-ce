---
phase: 06-offline-resilience
verified: 2026-04-03T07:30:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
human_verification:
  - test: "Install a non-bundled plugin on a running instance, then restart the gateway and verify the instance recovers without network access"
    expected: "Plugin reinstalled from /home/node/.openclaw/plugin-cache/ without contacting the registry"
    why_human: "Requires Docker container runtime, network partitioning, and live gateway restart cycle — cannot verify programmatically"
  - test: "Open the configure panel (gear icon) for an installed non-bundled plugin with a locked version and active status"
    expected: "\"Artifact cached locally\" indicator is displayed in the version info section in green"
    why_human: "UI rendering and visual correctness require browser verification"
---

# Phase 6: Offline Resilience Verification Report

**Phase Goal:** Plugin artifacts are cached locally so gateway restarts and air-gapped deployments can rebuild installed plugins without hitting the external registry
**Verified:** 2026-04-03T07:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a plugin is successfully installed, its artifact tarball is cached under `/home/node/.openclaw/plugin-cache/` inside the container | VERIFIED | `plugin-store.ts` line 362-365: fire-and-forget `cacheArtifact('plugin', pluginId, version, instance.runtimeId, instance.deploymentTarget)` after version pinning, guarded on `version && source.type !== 'bundled' && instance.runtimeId` |
| 2 | After a skill is successfully installed, its artifact is cached under `/home/node/.openclaw/plugin-cache/` inside the container | VERIFIED | `skill-store.ts` line 224-231: lightweight DB query for runtimeId/deploymentTarget then fire-and-forget `cacheArtifact('skill', skillId, rpcResult.version, inst.runtime_id, dt)` |
| 3 | When the gateway rebuilds after a restart, pending extension replay checks the local cache before hitting the registry | VERIFIED | `extension-lifecycle.ts` lines 404-428 (skills) and 442-468 (plugins): `getInstanceRuntimeInfo` + `isArtifactCached` called before each `installSkill`/`installPlugin` in `replayPendingExtensions` |
| 4 | If cache is present for the lockedVersion, install uses the cached tarball instead of fetching from registry | VERIFIED | `extension-lifecycle.ts`: plugin cache hit overrides source to `{ type: 'npm', spec: 'file:{cachePath}' }`; skill cache hit overrides to `{ type: 'url', url: 'file://{cachePath}' }`; overridden source is passed to `installPlugin`/`installSkill` |
| 5 | If cache is missing, install falls back to registry as before (no user-visible difference) | VERIFIED | Cache probe wrapped in `try/catch`; `isArtifactCached` returns `false` on any error; original source used on miss with no logging to user |
| 6 | The configure panel shows a cached/registry source indicator when version info is displayed | VERIFIED | `CredentialConfigPanel.tsx` lines 208-265: `isCachedLocally = !isBundled && lockedVersion != null && ['active', 'installed', 'disabled'].includes(status)`, renders `t('extensions.version.cachedLocally')` in green; `isBundled` prop wired in `ExtensionsTab.tsx` for both plugins and skills |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/artifact-cache.ts` | Cache service: `cacheArtifact`, `getCachedArtifactPath`, `isArtifactCached`, `CACHE_BASE` | VERIFIED | 110 lines; all 4 exports present; `getRuntimeEngine` imported from `../runtime/factory.js`; exec optional guard at lines 44 and 73; errors caught and warn-logged; never re-throws |
| `apps/server/src/services/plugin-store.ts` | Cache-after-install call in `installPlugin` | VERIFIED | `cacheArtifact` imported at line 11; call at lines 362-365, fire-and-forget via `.catch(() => {})` |
| `apps/server/src/services/skill-store.ts` | Cache-after-install call in `installSkill` | VERIFIED | `cacheArtifact` imported at line 10; call at lines 224-231 with lightweight DB query for runtime info |
| `apps/server/src/services/extension-lifecycle.ts` | Cache-preferred resolution in `replayPendingExtensions` | VERIFIED | `isArtifactCached` and `getCachedArtifactPath` imported at line 6; `getInstanceRuntimeInfo` helper at lines 15-25; cache probe in both skill and plugin replay loops |
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | UI cached indicator with `isBundled` prop | VERIFIED | `isBundled` prop at line 28; `isCachedLocally` derived at lines 208-211; indicator rendered at lines 259-265 using `var(--color-success)` design token |
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | `isBundled` prop wired for plugins and skills | VERIFIED | Plugin call at line 618: `isBundled={plugin.source?.type === 'bundled'}`; skill call at line 777: `isBundled={skill.source?.type === 'bundled'}` |
| `apps/web/src/i18n/locales/*.json` (6 files) | `extensions.version.cachedLocally` in all 6 locales | VERIFIED | All 6 files contain key: en (line 1842), zh (line 1841), fr (line 1160), de (line 1160), es (line 1160), it (line 1160) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `plugin-store.ts` | `artifact-cache.ts` | `cacheArtifact(` after successful RPC | WIRED | Import at line 11; call at line 364 post version-pinning |
| `skill-store.ts` | `artifact-cache.ts` | `cacheArtifact(` after successful RPC | WIRED | Import at line 10; call at line 229 post version-pinning |
| `extension-lifecycle.ts` | `artifact-cache.ts` | `isArtifactCached(` / `getCachedArtifactPath(` in replay loop | WIRED | Import at line 6; both functions called in skill loop (lines 410, 412) and plugin loop (lines 451, 453); overridden source passed to install functions |
| `CredentialConfigPanel.tsx` | `ExtensionsTab.tsx` | `isBundled` prop passed from parent | WIRED | `ExtensionsTab.tsx` passes `isBundled={source?.type === 'bundled'}` at lines 618 and 777 for plugin and skill panels respectively |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OFFLINE-01 | 06-01-PLAN.md | System caches plugin artifacts on first successful install to plugin-cache path | SATISFIED | `cacheArtifact` called fire-and-forget in both `installPlugin` and `installSkill` after successful install, for non-bundled extensions with a resolved version |
| OFFLINE-02 | 06-01-PLAN.md | System prefers cached artifacts on restart, falls back to registry | SATISFIED | `replayPendingExtensions` checks `isArtifactCached` before each install; overrides source to local `file:` path on hit; falls through silently to registry on miss |

No orphaned requirements: both OFFLINE-01 and OFFLINE-02 appear in REQUIREMENTS.md as `[x]` completed entries at lines 70-71 and in the completion table at lines 161-162.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `CredentialConfigPanel.tsx` | 424, 440, 455 | `placeholder=` | Info | HTML input placeholder attributes — legitimate UI text, not stub implementations |
| `extension-lifecycle.ts` | 22 | `return null` | Info | Correct early-return for missing runtime info in `getInstanceRuntimeInfo` — not a stub |

No blockers or warnings found. The one pre-existing ESLint error (`apps/web/src/hooks/useInstanceModels.ts` line 21) is in an **untracked file** not modified by this phase, documented in `deferred-items.md`, and confirmed to not affect any phase 06 deliverables.

### Human Verification Required

#### 1. Full Offline Rebuild Cycle

**Test:** Install a non-bundled plugin (e.g., a ClawhHub plugin) on a running instance. Confirm install completes. Disconnect the container from the network (or block registry DNS). Restart the gateway. Check whether the instance's plugin reinitializes successfully.
**Expected:** Gateway startup log shows `[extension-lifecycle] Phase 3: using cached artifact for plugin ...` and the plugin reaches `active` status without contacting the registry.
**Why human:** Requires a live Docker environment, network isolation, and a real gateway restart cycle. Cannot verify by static analysis.

#### 2. "Artifact cached locally" UI Indicator

**Test:** Open an instance detail page, go to the Extensions tab, click the gear icon on a non-bundled plugin that is in `active` or `installed` status with a locked version shown.
**Expected:** The version info section displays "Artifact cached locally" in green (`var(--color-success)`) below the integrity hash row.
**Why human:** Visual rendering, CSS variable resolution, and status conditions require browser verification.

### Gaps Summary

No gaps found. All 6 observable truths are verified against the actual codebase. Both requirement IDs (OFFLINE-01 and OFFLINE-02) are fully satisfied by substantive, wired implementations. TypeScript compiles cleanly with no errors. The only ESLint error is pre-existing in an untracked file unrelated to this phase.

---

_Verified: 2026-04-03T07:30:00Z_
_Verifier: Claude (gsd-verifier)_
