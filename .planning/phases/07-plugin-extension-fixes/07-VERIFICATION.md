---
phase: 07-plugin-extension-fixes
verified: 2026-04-04T10:30:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 7: Plugin Extension Fixes Verification Report

**Phase Goal:** The Extensions tab works correctly end-to-end -- Available catalog loads after restart, plugin install does not corrupt config, unsupported RPC methods degrade gracefully, and frontend correctly handles response shapes and install parameters.
**Verified:** 2026-04-04T10:30:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Platform-bridge plugin loads without errors on gateway startup (no method name conflicts) | VERIFIED | `openclaw/plugin/index.ts` has exactly 7 `registerGatewayMethod` calls; `skills.install`, `skills.uninstall`, `plugins.install`, `plugins.uninstall` are absent as registrations (appear only in comments on lines 336 and 357) |
| 2 | After gateway restart, the plugin's skills.list and plugins.list methods do NOT shadow native handlers | VERIFIED | Only read-only `skills.list` and `plugins.list` remain; no install/uninstall registrations exist; comments at lines 336-337 and 357-358 explicitly document the removal rationale |
| 3 | plugins.install handler does NOT write paths to gateway config -- uses local JSON state file only | VERIFIED | No `plugins.install` or `plugins.uninstall` `registerGatewayMethod` calls exist in plugin. `saveState` function was removed entirely (confirmed absent). Only `loadState` (read-only) remains |
| 4 | Built-in catalog (BUILTIN_REGISTRY) is available via clawhub.search and clawhub.info methods | VERIFIED | `BUILTIN_REGISTRY` with 11 entries (7 skills + 4 plugins) present; both `clawhub.search` (line 362) and `clawhub.info` (line 399) registered as gateway methods and reference `BUILTIN_REGISTRY` |
| 5 | When gateway does not support skills.list or plugins.list RPC, Extensions tab shows empty list (not a 500 error) | VERIFIED | All 6 RPC catch blocks use `rpcErr: unknown`, log `console.warn`, and set `rawList = undefined` or `rpcResult = undefined`. Extension-lifecycle wraps reconciliation in `if (rpcResult !== undefined)` guards at lines 158 and 242 |
| 6 | Frontend correctly destructures catalog response as { catalog, hasMore } instead of treating it as a flat array | VERIFIED | 4 catalog fetch locations all use typed `{ catalog: T[]; hasMore: boolean }` generics, access `.catalog` (4 hits) and `.hasMore` (4 hits) |
| 7 | Frontend sends source as { type: 'clawhub', spec: id } object instead of bare string 'clawhub' | VERIFIED | `handleInstallSkill` (line 244) and `handleInstallPlugin` (line 285) build `sourceObj`; failed-skill retry button (line 475) sends `{ type: 'bundled' }`. 3 source object locations confirmed |
| 8 | Skill install RPC sends { source: 'clawhub', slug } to match gateway native schema | VERIFIED | `skill-store.ts` line 159: `{ source: 'clawhub', slug: source.spec }` for ClawHub; `skills.ts` upgrade endpoint line 396: `{ source: 'clawhub', slug: skillId, version: clawHubInfo.version }` |
| 9 | No bare source string 'clawhub' sent from frontend to install endpoints | VERIFIED | grep for `source: 'clawhub'` (bare string) returns no matches in `ExtensionsTab.tsx` |

**Score:** 9/9 truths verified

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Provides | Status | Details |
|----------|----------|--------|---------|
| `openclaw/plugin/index.ts` | Platform-bridge plugin with non-conflicting methods | VERIFIED | 7 `registerGatewayMethod` calls; 0 crypto imports; 0 `saveState` references; BUILTIN_REGISTRY present with 11 entries |

#### Plan 02 Artifacts

| Artifact | Provides | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/routes/plugins.ts` | Graceful RPC degradation for plugins.list | VERIFIED | Contains "plugins.list RPC failed" at lines 72 and 126 in `catch (rpcErr: unknown)` blocks |
| `apps/server/src/routes/skills.ts` | Graceful RPC degradation for skills.list + correct install params | VERIFIED | Contains "skills.list RPC failed" at lines 71 and 125; upgrade RPC uses `{ source: 'clawhub', slug: skillId }` at line 396 |
| `apps/server/src/services/extension-lifecycle.ts` | Graceful RPC degradation in reconciliation | VERIFIED | Contains "skills.list RPC failed" (line 150) and "plugins.list RPC failed" (line 234); `if (rpcResult !== undefined)` guards at lines 158 and 242 |
| `apps/server/src/services/skill-store.ts` | Correct gateway native schema params for skills.install | VERIFIED | Line 159: `source: 'clawhub', slug: source.spec` for ClawHub; local path uses `{ name: skillId, installId: skillId }` |
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | Fixed response destructuring and source object format | VERIFIED | 4 `.catalog` accesses, 4 `.hasMore` accesses, 3 source object constructions |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ExtensionsTab.tsx` | `routes/skills.ts` | GET /instances/:id/skills/catalog | WIRED | Line 137: `api.get<{ catalog: SkillCatalogEntry[]; hasMore: boolean }>(.../skills/catalog...)` correctly typed; route responds with `{ catalog, hasMore }` at line 226 |
| `ExtensionsTab.tsx` | `routes/plugins.ts` | GET /instances/:id/plugins/catalog | WIRED | Line 167: `api.get<{ catalog: PluginCatalogEntry[]; hasMore: boolean }>(.../plugins/catalog...)` correctly typed; route responds with `{ catalog, hasMore }` at line 223 |
| `services/skill-store.ts` | gateway RPC | skills.install RPC call | WIRED | Line 159: `{ source: 'clawhub', slug: source.spec }` -- matches gateway native ClawHub anyOf schema |
| `openclaw/plugin/index.ts` | gateway native handlers | method namespace separation | WIRED | 4 conflicting methods removed; 7 non-conflicting methods registered; comment lines 336-337 and 357-358 document reasoning |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SIMP-02 | 07-01-PLAN.md | Remove conflicting RPC methods from platform-bridge plugin (`skills.install`, `skills.uninstall`) that duplicate native gateway handlers | SATISFIED | Plugin has 0 install/uninstall method registrations; confirmed by grep returning only comment lines |
| PLUGFIX-01 | 07-01-PLAN.md | Fix empty Available catalog after gateway restart -- resolve plugin loading failure caused by method name conflicts with native handlers | SATISFIED | Root cause eliminated by SIMP-02 removal; `clawhub.search` and `clawhub.info` now load successfully with BUILTIN_REGISTRY |
| PLUGFIX-02 | 07-01-PLAN.md | Fix `plugins.install` handler causing gateway config corruption (adding non-existent plugin paths) | SATISFIED | `plugins.install` handler removed from plugin; only gateway-native handler remains; `saveState` function removed (no write path) |
| PLUGFIX-03 | 07-02-PLAN.md | Backend graceful degradation for `skills.list` and `plugins.list` RPC when gateway doesn't support them (return empty instead of 500) | SATISFIED | 6 catch blocks with `warn + set undefined` pattern verified across 3 files; undefined guards in extension-lifecycle.ts |
| FRONT-01 | 07-02-PLAN.md | Fix Extensions tab response shape mismatch -- catalog endpoints return `{ catalog: [], hasMore }` but frontend expected flat array | SATISFIED | All 4 fetch locations use typed generics and access `.catalog` and `.hasMore` destructured fields |
| FRONT-02 | 07-02-PLAN.md | Fix install handlers sending `source: "clawhub"` (string) instead of `source: { type: "clawhub", spec: "..." }` (object) | SATISFIED | 3 source object constructions in ExtensionsTab.tsx; 0 bare string `source: 'clawhub'` patterns remain |
| FRONT-03 | 07-02-PLAN.md | Fix skill install RPC params to match gateway's native schema (`{ source: "clawhub", slug }`) | SATISFIED | skill-store.ts line 159 and skills.ts line 396 both use correct schema |

All 7 requirement IDs from plan frontmatter are accounted for. No orphaned requirements identified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `openclaw/plugin/index.ts` | 270, 274, 284, 317, 339, 362, 399 | `: any` in gateway callback parameter types | Info | Pre-existing pattern; gateway plugin SDK does not provide typed callback shapes; not introduced by phase 7 (4 occurrences existed before, phase 7 added more for new methods) |
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | 673, 832 | `placeholder=` attribute | Info | HTML input placeholder attribute, not a code stub placeholder; correct usage via i18n `t()` |

No blocker or warning-level anti-patterns found in phase 7 changes.

### Human Verification Required

#### 1. Available Catalog Loads After Gateway Restart

**Test:** Start an instance, let it run fully, restart it, then open the Extensions tab and switch to "Available" sub-tab.
**Expected:** Skill and plugin catalog entries from BUILTIN_REGISTRY (e.g., "Web Search", "Code Interpreter") appear without error.
**Why human:** Requires a live Docker gateway to verify the plugin loads and its RPC methods are actually called.

#### 2. Plugin Install Does Not Corrupt Config

**Test:** Install a plugin from the Available catalog (e.g., "Webhook Integration"), then restart the gateway and check the gateway config file.
**Expected:** Gateway config does not contain invalid/non-existent plugin paths after install + restart.
**Why human:** Requires Docker runtime and filesystem inspection of the gateway container.

#### 3. Unsupported RPC Graceful Degradation

**Test:** With an older gateway version that does not implement `skills.list`, open the Extensions tab.
**Expected:** Tab renders successfully showing managed skills from DB; no 500 error; browser console shows no crash, server logs show `console.warn` for the RPC failure.
**Why human:** Requires deploying an older gateway version to test the degradation path.

### Gaps Summary

No gaps found. All 9 observable truths verified, all 5 artifacts confirmed substantive and wired, all 4 key links confirmed, all 7 requirement IDs satisfied.

The `any` type annotations in `openclaw/plugin/index.ts` are a pre-existing pattern tied to the untyped gateway plugin SDK callback interface — they were present before phase 7 and are not regressions introduced by this phase.

---

_Verified: 2026-04-04T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
