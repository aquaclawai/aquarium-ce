---
phase: 04-template-portability
verified: 2026-04-03T00:00:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 4: Template Portability Verification Report

**Phase Goal:** Template export captures the full plugin/skill setup from the new extension tables with secrets scrubbed, and template import re-evaluates trust for each extension against current ClawHub metadata
**Verified:** 2026-04-03
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Export reads instance_plugins/instance_skills for active, installed, disabled, degraded extensions with lockedVersion, integrityHash, state hints | VERIFIED | `template-store.ts:607-641` (DB path) and `reverse-adapter.ts:633-676` (live path) both query with `whereIn('status', EXPORTABLE_STATUSES)` and map all four status values |
| 2 | Legacy plugin_dependencies used only as fallback when lifecycle tables return zero rows | VERIFIED | `template-store.ts:644-667`: `if (pluginRows.length > 0 \|\| skillRows.length > 0)` guard with explicit legacy path for pre-migration instances |
| 3 | OpenClaw config credential fields replaced with ${CREDENTIAL:...} placeholders | VERIFIED | `scrubOpenclawConfigCredentials()` at `reverse-adapter.ts:724-834` covers `plugins.entries.*.config`, `skills.entries.*`, `providers.*`; DB path has equivalent scrubbing at `template-store.ts:687-769` |
| 4 | Workspace files exported through allowlist only (standard files + skills/*/SKILL.md) | VERIFIED | `WORKSPACE_ALLOWLIST` at `reverse-adapter.ts:86-89` includes AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, BOOTSTRAP.md, HEARTBEAT.md, MEMORY.md; skills/*/SKILL.md enumerated separately at line 546-550 |
| 5 | Workspace files with detected secrets have values replaced with [REDACTED] and warnings added | VERIFIED | `reverse-adapter.ts:606-618`: replaces match in scanned content with `'[REDACTED]'` and pushes `type: 'redacted_secret'` warning |
| 6 | Export rejects local skills with scripts/ or assets/ directories with clear error | VERIFIED | `reverse-adapter.ts:510-531`: fail-fast check before workspace reads; throws `"Skill '<name>' contains executable scripts and cannot be exported..."` |
| 7 | seedConfig Phase 1 includes active/degraded skills from instance_skills (not only plugins) | VERIFIED | `adapter.ts:595-615`: query with `whereIn('status', ['active', 'degraded'])` merged into `cfg.skills.entries`; comment documents Phase 1 intent |
| 8 | After reconciliation (Phase 2), pending extensions replayed in Phase 3 | VERIFIED | `instance-manager.ts:597-608`: Phase 3 block after Phase 2 block; calls `replayPendingExtensions` non-fatally |
| 9 | Phase 3 replay handles failures non-fatally, one by one | VERIFIED | `extension-lifecycle.ts:380-420`: try/catch per skill, try/catch per plugin; failures logged and added to `failed[]` array, loop continues |
| 10 | Template import calls evaluateTrustPolicy synchronously per extension at instantiation time | VERIFIED | `template-store.ts:1031-1057`: for-loop over `templateExtensions` calling `await evaluateTrustPolicy(instance.id, ext.id, ext.kind, ext.source, null)` |
| 11 | Bundled pass, unscanned/scan-failed hard-blocked, community without override returned as requiresTrustOverride | VERIFIED | `template-store.ts:1034-1057`: decision routing — `community` tier goes to `requiresTrustOverride[]`, other block tiers go to `blockedExtensions[]`; blocked extensions `continue` without lifecycle row insert |
| 12 | generateDependencySetupCommands skips plugins/skills when extensions array present (MCP only) | VERIFIED | `template-store.ts:947-955`: `templateExtensions.length > 0` guard passes empty arrays for skills/plugins to `generateDependencySetupCommands` |
| 13 | TemplateExtensionDeclaration type, ExportTemplateResponse.content.extensions, InstantiateTemplateResponse trust fields, SecurityWarning.redacted_secret all exist in shared types | VERIFIED | `packages/shared/src/types.ts`: `TemplateExtensionDeclaration` at line 645; `extensions?` in ExportTemplateResponse at line 665; `blockedExtensions`, `requiresTrustOverride`, `extensionsImported` in InstantiateTemplateResponse at lines 629-642; `'redacted_secret'` in SecurityWarning.type at line 671 |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/types.ts` | TemplateExtensionDeclaration type for export/import | VERIFIED | Interface at line 645; extensions field on ExportTemplateResponse.content at line 665 |
| `apps/server/src/services/template-store.ts` | Extended exportFromInstance + instantiateTemplate with lifecycle reads, config scrubbing, trust evaluation | VERIFIED | DB export path reads instance_plugins/instance_skills at lines 607-641; trust loop at lines 1021-1091; evaluateTrustPolicy imported at line 6 |
| `apps/server/src/agent-types/openclaw/reverse-adapter.ts` | Extended reverseAdaptFromContainer with allowlist, redaction, local skill rejection, lifecycle table reads, config scrubbing | VERIFIED | WORKSPACE_ALLOWLIST line 86; skill rejection line 510; [REDACTED] replacement line 610; lifecycle reads lines 633-676; scrubOpenclawConfigCredentials call line 601 |
| `apps/server/src/services/template-file-format.ts` | Extensions field in template.json schema, read and written | VERIFIED | TemplateJsonSchema.extensions at line 68; written in generateOctemplate at line 104; read in parseOctemplate at line 206 |
| `apps/server/src/agent-types/openclaw/adapter.ts` | seedConfig with active/degraded skills from instance_skills (Phase 1) | VERIFIED | instance_skills query at line 598; merged into cfg.skills.entries at lines 603-615 |
| `apps/server/src/services/instance-manager.ts` | Phase 3 pending replay wired after reconciliation | VERIFIED | replayPendingExtensions called at line 602; Phase 1/2/3 comments at lines 495, 586, 597 |
| `apps/server/src/services/extension-lifecycle.ts` | getPendingExtensions covering both skills and plugins; replayPendingExtensions function | VERIFIED | getPendingExtensions at line 290 queries both tables; replayPendingExtensions at line 364 iterates both; deprecated wrapper kept at line 349 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `template-store.ts` | `instance_plugins`/`instance_skills` DB tables | `db('instance_plugins')` query in exportFromInstance | WIRED | Lines 607-614: `db('instance_plugins').where({instance_id: instanceId}).whereIn('status', EXPORTABLE_STATUSES)` |
| `template-store.ts` | `instance_plugins`/`instance_skills` DB tables | `db('instance_plugins').insert()` for trusted extensions | WIRED | Lines 1062-1090: conditional insert for plugin vs skill with full row |
| `template-store.ts` | `trust-store.ts` | `evaluateTrustPolicy` call during import | WIRED | Import at line 6; call at line 1031 with null signals |
| `reverse-adapter.ts` | `SENSITIVE_PATTERNS` | regex scan + [REDACTED] replacement | WIRED | `SENSITIVE_PATTERNS` exported at line 34; scan+replace loop at lines 606-618 |
| `template-file-format.ts` | `TemplateExtensionDeclaration` | template.json extensions field | WIRED | Written at generateOctemplate line 104; read at parseOctemplate line 206 |
| `instance-manager.ts` | `extension-lifecycle.ts` | `replayPendingExtensions` call after reconcileExtensions | WIRED | Both imported at line 24; Phase 2 block lines 586-595; Phase 3 block lines 597-608 |
| `adapter.ts` | `instance_skills` DB table | `db('instance_skills')` query in seedConfig | WIRED | Line 598: `db('instance_skills').where({instance_id: instance.id}).whereIn('status', ['active','degraded'])` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TMPL-01 | 04-01 | Template export reads from instance_plugins/instance_skills tables (not legacy plugin_dependencies) | SATISFIED | Both export paths query lifecycle tables; legacy path only activates when tables return zero rows |
| TMPL-02 | 04-01 | Export includes active, installed (needsCredentials), disabled, degraded extensions with state hints | SATISFIED | status→enabled/needsCredentials mapping in both export paths: `active=enabled/false`, `installed=enabled/true`, `disabled=false/false`, `degraded=enabled/false` |
| TMPL-03 | 04-01 | Export scrubs OpenClaw base config — all credential fields replaced with ${CREDENTIAL:...} placeholders | SATISFIED | `scrubOpenclawConfigCredentials()` in reverse-adapter.ts covers plugins.entries, skills.entries, providers; equivalent scrubbing in template-store.ts DB path |
| TMPL-04 | 04-01 | Export uses workspace file allowlist + SENSITIVE_PATTERNS secret scanning with redaction | SATISFIED | WORKSPACE_ALLOWLIST enforced; secret match replaced with `[REDACTED]`; `redacted_secret` warning type added to SecurityWarning |
| TMPL-05 | 04-01 | Export rejects local skills with scripts/ or assets/ directories | SATISFIED | Fail-fast check at reverse-adapter.ts:510-531 throws before any workspace file is read |
| TMPL-06 | 04-03 | Template import re-evaluates trust policy for each extension against current ClawHub metadata | SATISFIED | `evaluateTrustPolicy` called synchronously per extension in instantiateTemplate trust loop |
| TMPL-07 | 04-03 | Blocked extensions on import require fresh admin override or are skipped with warning | SATISFIED | community tier → requiresTrustOverride[]; unscanned/scan-failed → blockedExtensions[]; neither gets a lifecycle row; InstantiateTemplateResponse includes both arrays |
| TMPL-08 | 04-02 | System uses 3-phase startup: Phase 1 (active/degraded config) → Phase 2 (boot+reconcile) → Phase 3 (pending replay) | SATISFIED | Phase 1 comment + seedConfig at instance-manager.ts:495-500; Phase 2 comment + reconcileExtensions at line 586; Phase 3 comment + replayPendingExtensions at line 597 |

### Anti-Patterns Found

None identified. All implementations are substantive — no stubs, placeholders, or empty handlers found in modified files.

### Human Verification Required

The following behaviors are correct in code but cannot be verified without a running instance:

#### 1. Export end-to-end with live container

**Test:** Export a running OpenClaw instance that has an active plugin with an API key in its config and a workspace SOUL.md containing a test secret pattern
**Expected:** Returned export has ${CREDENTIAL:...} in plugin config and [REDACTED] in workspace file; securityWarnings contains a `redacted_secret` entry
**Why human:** Requires Docker runtime, running gateway, and live container with real config

#### 2. Local skill rejection during live export

**Test:** Export a running instance with a local skill that has a `scripts/` subdirectory in its workspace
**Expected:** Export fails immediately with error message containing "contains executable scripts and cannot be exported"
**Why human:** Requires a live container with the specific workspace layout

#### 3. Phase 3 replay on template instantiation

**Test:** Instantiate a template that contains a bundled extension; start the resulting instance; observe logs
**Expected:** Phase 3 log line appears: `[extensions] Phase 3 replay for <id>: installed=1, failed=0, needsCredentials=0`
**Why human:** Requires Docker runtime, live gateway boot, and log observation

#### 4. Trust block at import time

**Test:** Instantiate a template containing a non-bundled extension (source type other than bundled) with no existing trust override on the target instance
**Expected:** instantiateTemplate response includes `blockedExtensions` or `requiresTrustOverride` array; no lifecycle row inserted for that extension
**Why human:** Requires setting up a template with specific extension sources and verifying DB state post-import

---

## Build Verification

- `npm run build -w @aquarium/shared`: PASSED (clean exit)
- `npm run typecheck -w @aquaclawai/aquarium`: PASSED (clean exit, no errors)

---

_Verified: 2026-04-03_
_Verifier: Claude (gsd-verifier)_
