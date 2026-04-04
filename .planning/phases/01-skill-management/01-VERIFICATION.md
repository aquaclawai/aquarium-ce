---
phase: 01-skill-management
verified: 2026-04-04T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "INFRA-06 cooperative cancellation — checkCancelRequested now called in uninstallSkill at line 342 of skill-store.ts"
    - "REQUIREMENTS.md documentation lag — all Phase 1 IDs now checked [x] and Traceability table updated to Complete"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Full Extensions tab flow with running instance"
    expected: "Extensions tab appears after Chat in instance nav. Skills sub-tab shows installed section (empty or populated), Gateway Built-ins section (read-only), and Available catalog with Install buttons. Installing a bundled skill transitions status from pending to active if no credentials required. Gear icon expands CredentialConfigPanel inline below the skill row. Toggle and uninstall actions work. Plugins sub-tab shows Phase 2 placeholder."
    why_human: "Requires a running Docker gateway with real skills.list/install RPC endpoints. Cannot be verified with static grep."
  - test: "Visual checkpoint — dark/light mode, responsive layout"
    expected: "All colors use CSS variables (no hardcoded hex). Status dots are green (active), yellow (installed/degraded), red (failed), gray (disabled). Alert banners appear in red/yellow above sub-tab toggle for failed/degraded skills. Layout stacks responsively at 640px."
    why_human: "Visual appearance requires browser rendering."
  - test: "Cancel-requested cooperative cancellation — installSkill and uninstallSkill"
    expected: "Requesting cancel of an in-progress install or uninstall (via PUT /extension-operations/:id/cancel or requestCancel) causes the operation to exit early before the skills.install/uninstall RPC call. Both operations now have cancel checkpoints."
    why_human: "Requires timing-sensitive test with a long-running install/uninstall operation."
  - test: "Instance restart — skill state restoration"
    expected: "After restart, previously active skill should still be active (reconcileExtensions promotes it). If gateway does not report it in skills.list, it should show as failed with an alert banner."
    why_human: "Requires a Docker runtime and actual gateway RPC responses."
---

# Phase 1: Skill Management Verification Report

**Phase Goal**: Users can install, configure, enable/disable, and uninstall skills from the Extensions tab, with the platform reliably persisting state across restarts using fenced concurrency
**Verified**: 2026-04-04T00:00:00Z
**Status**: human_needed
**Re-verification**: Yes — after gap closure (Plans 01-07)

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | User can open an instance and see an Extensions tab with Skills and Plugins sub-tabs | VERIFIED | `ExtensionsTab.tsx` imported and rendered in `InstancePage.tsx` at line 278; `'extensions'` added to `TabId` union; tab button at line 248; sub-tab toggle (Skills/Plugins) in `ExtensionsTab.tsx` |
| 2 | User can browse the bundled skills catalog and install a skill with one click | VERIFIED | `GET /:id/skills/catalog` calls `skills.list` RPC and returns `SkillCatalogEntry[]`; `POST /:id/skills/install` calls `installSkill()` which acquires lock, calls `skills.install` RPC (180s timeout), returns skill + requiredCredentials; `CatalogSkillRow.tsx` renders Install button that calls `api.post` |
| 3 | User can configure extension-scoped credentials for a skill that requires them | VERIFIED | `CredentialConfigPanel.tsx` POSTs to `/instances/:id/extension-credentials`; route in `extension-credentials.ts` acquires lock, stores via `addCredential()` with extensionKind/extensionId metadata, calls `config.patch` RPC, promotes skill status from `installed` to `active` |
| 4 | User can enable, disable, and uninstall an installed skill | VERIFIED | `PUT /:id/skills/:skillId` calls `enableSkill`/`disableSkill` based on body `enabled` boolean; `DELETE /:id/skills/:skillId` calls `uninstallSkill`; all call `GatewayRPCClient.call()` with appropriate timeouts; `SkillRow.tsx` renders toggle + uninstall X |
| 5 | After an instance restart, previously active skills are restored and dashboard alerts surface any failed or degraded extensions; cooperative cancellation honored at worker checkpoints | VERIFIED | `reconcileExtensions` called in `startInstanceAsync` (line 588 of `instance-manager.ts`) after gateway connects; handles all 5 reconciliation cases. Alert banners in `ExtensionsTab.tsx`. `checkCancelRequested` now called in both `installSkill` (line 135) AND `uninstallSkill` (line 342) before their 3-minute RPC calls. INFRA-06 fully satisfied. |

**Score**: 5/5 success criteria verified

### Re-verification Gap Closure

| Gap | Previous Status | Current Status | Evidence |
|-----|----------------|----------------|---------|
| INFRA-06: `checkCancelRequested` in `uninstallSkill` | PARTIAL — missing | CLOSED | `skill-store.ts` line 342: `if (await checkCancelRequested(operationId)) { await releaseLock(operationId, fencingToken, 'cancelled'); return; }` |
| REQUIREMENTS.md documentation lag (INFRA-05, SKILL-02, SKILL-03, SKILL-05, SKILL-06) | FAILED — stale checkboxes | CLOSED | All Phase 1 IDs show `[x]` in REQUIREMENTS.md checkboxes and `Complete` in Traceability table; footer updated: "Last updated: 2026-04-04 after Phase 1 gap closure (Plan 01-07)" |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `packages/shared/src/types.ts` | ExtensionStatus, InstanceSkill, SkillCatalogEntry, GatewayExtensionInfo types | VERIFIED | All 11 extension types exported |
| `apps/server/src/db/migrations/036_extension_tables.ts` | instance_plugins, instance_skills, extension_operations tables | VERIFIED | 77 lines; all 3 tables; `idx_one_active_op` partial unique index |
| `apps/server/src/config.ts` | serverSessionId UUID field | VERIFIED | `randomUUID()` at module load (line 108) |
| `apps/server/src/services/extension-lock.ts` | acquireLock, releaseLock, checkCancelRequested, LockConflictError | VERIFIED | 209 lines; all exports present |
| `apps/server/src/services/skill-store.ts` | installSkill, getSkillsForInstance, enableSkill, disableSkill, uninstallSkill | VERIFIED | 398 lines; all 7 functions exported; `checkCancelRequested` called in both `installSkill` (line 135) and `uninstallSkill` (line 342) |
| `apps/server/src/routes/skills.ts` | GET list, GET catalog, POST install, PUT toggle, DELETE uninstall | VERIFIED | 5 routes; LockConflictError → 409 |
| `apps/server/src/routes/extension-credentials.ts` | POST extension-scoped credential endpoint | VERIFIED | 182 lines; acquires lock, stores credential, calls config.patch RPC (30s), promotes skill to active on success |
| `apps/server/src/services/extension-lifecycle.ts` | recoverOrphanedOperations, reconcileExtensions, getPendingExtensionsForReplay | VERIFIED | 192 lines; all 3 functions exported |
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | Main extensions tab component | VERIFIED | 292 lines; sub-tab toggle; API calls wired; alert banners; CredentialConfigPanel wired |
| `apps/web/src/components/extensions/ExtensionsTab.css` | Oxide CSS variable styles | VERIFIED | 95 uses of `var(--`; no hardcoded hex/rgb |
| `apps/web/src/components/extensions/SkillRow.tsx` | Installed skill row with actions | VERIFIED | 87 lines |
| `apps/web/src/components/extensions/CatalogSkillRow.tsx` | Catalog entry row with Install button | VERIFIED | 52 lines |
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | Credential input panel | VERIFIED | 127 lines |
| `apps/web/src/pages/InstancePage.tsx` | Extensions tab integrated | VERIFIED | `'extensions'` in TabId; tab button; content rendered |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `skill-store.ts` | `extension-lock.ts` | `acquireLock`/`releaseLock` + `checkCancelRequested` | WIRED | `acquireLock` at lines 105, 220, 273, 328; `checkCancelRequested` at lines 135, 342; `releaseLock` in try/finally for all mutations |
| `skill-store.ts` | `gateway-rpc.ts` | `GatewayRPCClient.call` for skills.install/update/uninstall | WIRED | `rpc.call` at lines 155, 239, 294, 350 |
| `routes/skills.ts` | `skill-store.ts` | Service function calls for each route handler | WIRED | imports and calls `installSkill`, `enableSkill`, `disableSkill`, `uninstallSkill` |
| `routes/extension-credentials.ts` | `credential-store.ts` | `addCredential` with extensionKind/extensionId metadata | WIRED | `addCredential` called at line 97 |
| `extension-lifecycle.ts` | `skill-store.ts` | `updateSkillStatus` for status transitions | WIRED | imported at line 4; called at lines 118, 122–127, 131–136 |
| `extension-lifecycle.ts` | `extension-lock.ts` | `cleanupOrphanedOperations` on startup | WIRED | imported at line 3; called at line 39 |
| `extension-lifecycle.ts` | `gateway-rpc.ts` | `skills.list` RPC for reconciliation | WIRED | `rpc.call('skills.list', {}, 15_000)` at line 89 |
| `server-core.ts` | `extension-lifecycle.ts` | `recoverOrphanedOperations` on server startup | WIRED | imported at line 14; called at line 239 |
| `instance-manager.ts` | `extension-lifecycle.ts` | `reconcileExtensions` after gateway connects | WIRED | imported at line 24; called at line 588 |
| `ExtensionsTab.tsx` | `/api/instances/:id/skills` | `api.get`/`api.post`/`api.put`/`api.delete` | WIRED | `api.get` at lines 53, 58; `api.post` at line 78; `api.put` at line 90; `api.delete` at line 100 |
| `ExtensionsTab.tsx` | `CredentialConfigPanel.tsx` | Rendered when `configuringSkillId` matches skill | WIRED | imported at line 7; rendered at lines 211–220 |
| `CredentialConfigPanel.tsx` | `/api/instances/:id/extension-credentials` | `api.post` for saving scoped credentials | WIRED | `api.post` at line 38 |
| `InstancePage.tsx` | `ExtensionsTab.tsx` | Import and render when `activeTab === 'extensions'` | WIRED | imported at line 21; rendered at line 278 |
| `server-core.ts` | `routes/extension-credentials.ts` | Mounted at `/api/instances` | WIRED | imported at line 41; `app.use('/api/instances', extensionCredentialRoutes)` at line 160 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| INFRA-01 | 01-01 | instance_plugins table created | SATISFIED | `036_extension_tables.ts` creates `instance_plugins` |
| INFRA-02 | 01-01 | instance_skills table created | SATISFIED | `036_extension_tables.ts` creates `instance_skills` |
| INFRA-03 | 01-01 | extension_operations table with fencing tokens, cancel support, partial unique index | SATISFIED | `036_extension_tables.ts`; `idx_one_active_op` partial unique index via `knex.raw()` |
| INFRA-04 | 01-01 | serverSessionId UUID generated on each startup | SATISFIED | `config.serverSessionId: randomUUID()` at line 108 of `config.ts` |
| INFRA-05 | 01-02 | Per-instance extension mutation lock with fencing token verification | SATISFIED | `extension-lock.ts` DB-only fenced lock; all mutations in `skill-store.ts` + `extension-credentials.ts` acquire lock. REQUIREMENTS.md now [x]. |
| INFRA-06 | 01-02 | Cooperative cancellation via cancel_requested checked at worker checkpoints | SATISFIED | `checkCancelRequested` called in `installSkill` (line 135) and `uninstallSkill` (line 342) before each 3-min RPC. Gap closed. |
| INFRA-07 | 01-02 | Per-subprocess execution deadlines | SATISFIED (Phase 1 scope) | Skills: 3min (180_000ms); config.patch: 30s (30_000ms). npm and restart are Phase 2. |
| INFRA-08 | 01-04 | Orphaned operations recovered on startup | SATISFIED | `recoverOrphanedOperations()` at server-core.ts line 239 |
| SKILL-01 | 01-03, 01-05 | User can browse bundled skills catalog | SATISFIED | `GET /:id/skills/catalog` returns `SkillCatalogEntry[]`; `CatalogSkillRow.tsx` renders entries |
| SKILL-02 | 01-02, 01-03 | User can install skill | SATISFIED | `installSkill()` acquires lock → INSERT pending → checkCancel → RPC 180s → update status → releaseLock. REQUIREMENTS.md now [x]. |
| SKILL-03 | 01-02 | Skills with no required credentials promote to active after install | SATISFIED | `skill-store.ts` line 173: `requiredCredentials.length === 0 ? 'active' : 'installed'`. REQUIREMENTS.md now [x]. |
| SKILL-04 | 01-03, 01-06 | User can configure extension-scoped credentials | SATISFIED | `extension-credentials.ts` + `CredentialConfigPanel.tsx` + gear icon in `SkillRow.tsx` |
| SKILL-05 | 01-02, 01-03 | User can enable/disable an installed skill | SATISFIED | `enableSkill`/`disableSkill` acquire lock, call `skills.update` RPC (30s), update DB. REQUIREMENTS.md now [x]. |
| SKILL-06 | 01-02, 01-03 | User can uninstall a skill | SATISFIED | `uninstallSkill` acquires lock, checkCancel, calls `skills.uninstall` RPC (180s), DELETEs DB row. REQUIREMENTS.md now [x]. |
| SKILL-07 | 01-04 | System reconciles skill state on boot | SATISFIED | `reconcileExtensions()` called in `startInstanceAsync` after gateway connects; handles all 5 PRD cases |
| UI-01 | 01-05 | Extensions tab with Plugins and Skills sub-tabs | SATISFIED | `InstancePage.tsx` has `'extensions'` TabId; `ExtensionsTab.tsx` has pill-style sub-tab toggle |
| UI-05 | 01-03, 01-05 | Gateway built-ins in separate read-only section | SATISFIED | `GET /:id/skills` returns `{ managed, gatewayBuiltins }` separately; `ExtensionsTab.tsx` renders `gatewayBuiltins` without action buttons |
| UI-06 | 01-06 | Dashboard alerts for failed/degraded extensions | SATISFIED | `ExtensionsTab.tsx` filters for `status === 'failed' || status === 'degraded'` and renders alert banners |
| UI-07 | 01-05, 01-06 | All new UI strings in all 6 locale files | SATISFIED | All 6 locale files (en, zh, fr, de, es, it) have `extensions.*` namespace with 55 keys |

**Orphaned requirements check**: No Phase 1 requirements in REQUIREMENTS.md are unaccounted for. All 19 Phase 1 requirement IDs appear in one or more plans. REQUIREMENTS.md traceability table is now fully accurate.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | 183 | `t('extensions.plugins.comingSoon')` — Plugins sub-tab placeholder | Info | Expected per design — Phase 2 is Plugin Management. Not a blocker. |
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | 88, 103 | HTML `placeholder="OPENAI_API_KEY"`, `placeholder="sk-..."` | Info | Standard HTML input placeholder attributes (UX hints), not code stubs. Not a blocker. |

No blocker anti-patterns. No `TODO`/`FIXME` comments, no empty implementations, no static returns hiding missing DB queries in any server file.

### Human Verification Required

#### 1. Full Extensions Tab Flow with Running Instance

**Test:** Start dev backend (`npm run dev`) and frontend (`npm run dev:web`), navigate to a running instance's Extensions tab.
**Expected:** Skills sub-tab shows Installed (empty or populated), Gateway Built-ins (read-only rows, no action buttons), and Available catalog (Install buttons). Installing a bundled skill that requires no credentials should transition to `active`. Installing one that requires credentials should show status `installed` and the gear icon should expand `CredentialConfigPanel` inline. Toggle (enable/disable) and uninstall (with confirm dialog) should work.
**Why human:** Requires a running Docker gateway with real `skills.list`/`skills.install` RPC endpoints.

#### 2. Visual Checkpoint — Dark/Light Mode

**Test:** Toggle theme in the application and inspect Extensions tab in both modes.
**Expected:** All colors use CSS variables — no white/black flashes on toggle. Status dots are correctly colored (green=active, yellow=installed/degraded, red=failed, gray=disabled). Alert banners use themed red/yellow tints.
**Why human:** Requires browser rendering to verify CSS variable theming.

#### 3. Cancel-Requested Cooperative Cancellation — Install and Uninstall

**Test:** Start a skill install or uninstall operation, then issue a cancel request before the RPC completes.
**Expected:** Both `installSkill` and `uninstallSkill` now check the cancel flag before their 3-minute RPC calls. A cancel request should cause early exit with lock released as `'cancelled'`.
**Why human:** Requires timing-sensitive test with a long-running install/uninstall operation.

#### 4. Instance Restart — Skill State Restoration

**Test:** Install a skill, confirm it is `active`, restart the instance (stop + start). Check Extensions tab.
**Expected:** After restart, previously active skill should still be `active` (reconcileExtensions promotes it). If gateway does not report it in `skills.list`, it should show as `failed` with an alert banner.
**Why human:** Requires a Docker runtime and actual gateway RPC responses.

### Summary

Both gaps from the initial verification are closed:

**Gap 1 (INFRA-06) — CLOSED:** `checkCancelRequested(operationId)` is now called in `uninstallSkill` at line 342 of `skill-store.ts`, immediately before the 3-minute `skills.uninstall` RPC call. The cancel check pattern is consistent with `installSkill` (line 135): if cancelled, it releases the lock with `'cancelled'` outcome and returns early without making the network call. Both long-running operations (install and uninstall) now fully honor cooperative cancellation. The 30-second enable/disable and configure operations still do not check cancel, which is acceptable given their shorter duration.

**Gap 2 (REQUIREMENTS.md documentation lag) — CLOSED:** All 19 Phase 1 requirement IDs (INFRA-01 through INFRA-08, SKILL-01 through SKILL-07, UI-01, UI-05, UI-06, UI-07) now show `[x]` in the checkboxes and `Complete` in the Traceability table. The file footer confirms the update: "Last updated: 2026-04-04 after Phase 1 gap closure (Plan 01-07)."

All 5/5 observable truths are verified. Remaining items are human verification tasks requiring a live Docker runtime.

---

_Verified: 2026-04-04T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — initial gaps closed by Plan 01-07_
