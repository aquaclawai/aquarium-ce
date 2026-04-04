---
phase: 03-clawhub-trust-policy
verified: 2026-04-04T05:30:00Z
status: human_needed
score: 5/5 success criteria verified
re_verification: true
  previous_status: gaps_found
  previous_score: 3/5 (2 partial)
  gaps_closed:
    - "CatalogSkillRow now accepts and forwards trustTier, trustSignals, blocked, blockReason, onRequestOverride to CatalogExtensionRow"
    - "ExtensionsTab passes all 5 trust props from SkillCatalogEntry into skill catalog loop (lines 846-851)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Search ClawHub for a skill and verify trust tier badge, download count, and VirusTotal status are visible on the result row"
    expected: "Skill catalog rows show the same trust badges as plugin catalog rows (Bundled/Verified/Unverified/Scan-failed + download count and age signals)"
    why_human: "Trust prop forwarding is now wired — visual confirmation needed that TrustBadgeRow renders correctly in skill rows"
  - test: "Attempt to install a community skill as a non-admin"
    expected: "Skill row is grayed out, lock icon shown with block reason text, Override link visible, no Install button"
    why_human: "Skill blocking UI requires running instance with live ClawHub data returning a community skill"
  - test: "Click Override on a community plugin, check the dialog shows the verbatim PRD warning and requires acknowledgment + reason before enabling Approve"
    expected: "Dialog shows: 'This community extension runs in-process with the gateway and will have access to all credentials on this instance, including API keys for other extensions. Only approve if you trust the publisher and have reviewed the source code.' Approve button stays disabled until checkbox is ticked and reason is non-empty."
    why_human: "Visual/interactive; verbatim text confirmed in i18n file but dialog behavior needs human confirmation"
  - test: "In the configure panel for an installed ClawHub plugin, click Check for Updates"
    expected: "Shows 'Up to date' or displays current vs latest version with an Upgrade button; upgrade re-pins version and hash"
    why_human: "Requires a running instance with a live ClawHub plugin installed that has an available update"
  - test: "Locate a plugin or skill in 'failed' status whose error contains 'Integrity mismatch'"
    expected: "Alert renders with shield icon and .extension-alert--integrity CSS class (red border, distinctive from standard failed alerts)"
    why_human: "Cannot trigger integrity mismatch without a tampered registry response in a test environment"
---

# Phase 3: ClawHub & Trust Policy Verification Report

**Phase Goal:** Users can search the live ClawHub marketplace with trust signals visible, with community extensions blocked by default and admins able to grant verified overrides
**Verified:** 2026-04-04T05:30:00Z
**Status:** human_needed — all automated checks pass; 5 items need live-instance confirmation
**Re-verification:** Yes — after gap closure (plan 03-06, commit 61acc88)

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can search ClawHub for plugins AND skills by name or category and see results with trust signals | VERIFIED | Plugin catalog: trust badges fully wired via CatalogExtensionRow. Skill catalog: CatalogSkillRow now forwards all 5 trust props (trustTier, trustSignals, blocked, blockReason, onRequestOverride) to CatalogExtensionRow — commit 61acc88 |
| 2 | Attempting to install a community or unscanned extension is blocked at the UI level with an explanation | VERIFIED | Server-side 403 enforced for both plugins and skills. Plugin UI: blocked row with lock icon wired. Skill UI: blocked state now wired (CatalogSkillRow passes blocked={entry.trustDecision === 'block'} and blockReason) |
| 3 | Admin can override a community extension after reviewing credential-access consent dialog, with override recorded in audit trail | VERIFIED | TrustOverrideDialog PUT to trust-override endpoint with credentialAccessAcknowledged=true; trust-overrides.ts creates DB record; audit trail rendered in CredentialConfigPanel |
| 4 | Installed extension's version and SHA-512 hash pinned in DB; reinstall with different hash for same version rejected | VERIFIED | skill-store.ts and plugin-store.ts both pin locked_version and integrity_hash; same-version reinstall raises "Integrity mismatch" error |
| 5 | User can explicitly upgrade an extension to the latest version with re-pinning and re-hashing | VERIFIED | PUT /:id/plugins/:pluginId/upgrade and PUT /:id/skills/:skillId/upgrade implemented with dryRun support; CredentialConfigPanel wires Check for Updates and Upgrade buttons |

**Score:** 5/5 truths verified

### Required Artifacts

#### Plan 03-01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/shared/src/types.ts` | VERIFIED | TrustTier, TrustSignals, TrustOverride, TrustDecision, TrustEvaluation, ClawHubCatalogEntry all present at lines 1491-1535; optional trustOverride on InstancePlugin/InstanceSkill; trustSignals/trustTier/trustDecision on catalog entry types |
| `apps/server/src/db/migrations/037_trust_overrides.ts` | VERIFIED | Substantive: creates trust_overrides table with all required columns, CASCADE FK, unique constraint; exports up/down |
| `apps/server/src/services/trust-store.ts` | VERIFIED | All 5 functions exported: computeTrustTier (correct 4-tier logic), evaluateTrustPolicy (deny-by-default, community override lookup), createTrustOverride (upsert with acknowledgment guard), getTrustOverride, getTrustOverridesForInstance |

#### Plan 03-02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `apps/server/src/services/marketplace-client.ts` | VERIFIED | searchClawHub (paginated, 30s timeout, soft-fail) and getClawHubExtensionInfo (15s timeout, soft-fail) exported; parseClawHubEntry validates shapes defensively |
| `apps/server/src/services/skill-store.ts` | VERIFIED | integrity_hash pinned at install; TRUST-06 integrity check on same-version reinstall throws descriptive error |
| `apps/server/src/services/plugin-store.ts` | VERIFIED | integrity_hash pinned at install; _activatePluginWithLock verifies hash on reinstall, marks plugin failed before throwing |

#### Plan 03-03 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `apps/server/src/routes/trust-overrides.ts` | VERIFIED | PUT /:id/plugins/:pluginId/trust-override and PUT /:id/skills/:skillId/trust-override; credentialAccessAcknowledged !== true returns 400; createTrustOverride called; returns {override, auditId} |
| `apps/server/src/routes/plugins.ts` | VERIFIED | evaluateTrustPolicy imported and called in catalog merging (ClawHub entries annotated with trustTier/trustDecision/blockReason) and in install guard (403 on block); upgrade endpoint with dryRun |
| `apps/server/src/routes/skills.ts` | VERIFIED | Same pattern as plugins: catalog merging with trust evaluation, 403 install guard, upgrade with dryRun |
| `apps/server/src/server-core.ts` | VERIFIED | trustOverrideRoutes imported and mounted at /api/instances (lines 43, 164) |

#### Plan 03-04 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `apps/web/src/components/extensions/TrustBadges.tsx` | VERIFIED | TrustBadgeRow exported; renders bundled/verified/community/unscanned badges; signal badges for VirusTotal, download count >100, age >90d |
| `apps/web/src/components/extensions/TrustOverrideDialog.tsx` | VERIFIED | Exports TrustOverrideDialog; verbatim PRD 10.2 credential-access warning via i18n key; acknowledgment checkbox; reason textarea; PUT to /trust-override with credentialAccessAcknowledged: true |
| `apps/web/src/components/extensions/CatalogExtensionRow.tsx` | VERIFIED | Accepts trustTier, trustSignals, blocked, blockReason, onRequestOverride props; renders TrustBadgeRow; blocked row with lock icon; Override link only for community tier |
| `apps/web/src/components/extensions/InstallDialog.tsx` | VERIFIED | trustTier/trustSignals props accepted; TrustBadgeRow rendered in trust summary row when trustTier is defined |
| `apps/web/src/components/extensions/CatalogSkillRow.tsx` | VERIFIED | All 5 trust props in interface (lines 9-13), destructured (lines 21-25), forwarded to CatalogExtensionRow (lines 39-43); TrustTier and TrustSignals imported from @aquarium/shared |
| `apps/web/src/components/extensions/ExtensionsTab.tsx` | VERIFIED | Plugin catalog wires all trust props to CatalogExtensionRow (lines 696-701). Skill catalog wires all trust props to CatalogSkillRow (lines 846-851) — both patterns now identical |

#### Plan 03-05 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `apps/web/src/components/extensions/CredentialConfigPanel.tsx` | VERIFIED | lockedVersion, integrityHash, trustOverride props accepted; version info section with truncated hash display; two-step dryRun upgrade flow (Check for Updates -> Upgrade); trust override audit trail; extensionKind === 'plugin' restart note |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| trust-store.ts | @aquarium/shared | import TrustTier, TrustSignals, TrustOverride... | WIRED | Lines 3-12 |
| trust-store.ts | trust_overrides table | db('trust_overrides') queries | WIRED | getTrustOverride, getTrustOverridesForInstance, createTrustOverride all use db('trust_overrides') |
| marketplace-client.ts | gateway-rpc.ts | GatewayRPCClient for clawhub.search and clawhub.info | WIRED | Line 132, 176 |
| skill-store.ts | DB integrity_hash | UPDATE after install, verify on reinstall | WIRED | Lines 200-211, 180-193 |
| plugin-store.ts | DB integrity_hash | UPDATE after install, verify in _activatePluginWithLock | WIRED | Lines 343-353, 154-162 |
| trust-overrides.ts | trust-store.ts | createTrustOverride service call | WIRED | Line 4, 50-57, 108-115 |
| plugins.ts | marketplace-client.ts | searchClawHub for catalog merging | WIRED | Line 16, 156 |
| plugins.ts | trust-store.ts | evaluateTrustPolicy for install guard and catalog enrichment | WIRED | Line 15, 167, 300 |
| skills.ts | trust-store.ts | evaluateTrustPolicy for install guard and catalog enrichment | WIRED | Line 14, 162, 270 |
| server-core.ts | trust-overrides.ts | trustOverrideRoutes mounted | WIRED | Lines 43, 164 |
| ExtensionsTab.tsx | /api/instances/:id/plugins/catalog | api.get with search/category/page params | WIRED | fetchPluginData builds URLSearchParams |
| ExtensionsTab.tsx | /api/instances/:id/skills/catalog | api.get with search/category/page params | WIRED | fetchSkillData line 134 |
| TrustOverrideDialog.tsx | /api/instances/:id/{plugins/skills}/:id/trust-override | api.put with credentialAccessAcknowledged=true | WIRED | Lines 36-38 |
| CatalogExtensionRow.tsx | TrustBadges.tsx | TrustBadgeRow component | WIRED | Line 69 in CatalogExtensionRow |
| CredentialConfigPanel.tsx | /api/instances/:id/{kind}/:id/upgrade | api.put with dryRun | WIRED | Lines 104-128 |
| CatalogSkillRow.tsx | CatalogExtensionRow.tsx | trustTier, trustSignals, blocked, blockReason, onRequestOverride props forwarded | WIRED | Lines 39-43 in CatalogSkillRow; commit 61acc88 |
| ExtensionsTab.tsx | CatalogSkillRow.tsx | trustTier={entry.trustTier}, trustSignals={entry.trustSignals}, blocked={entry.trustDecision === 'block'}, blockReason={entry.blockReason}, onRequestOverride={(id) => handleRequestOverride(id, 'skill')} | WIRED | Lines 846-851 in ExtensionsTab; commit 61acc88 |

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| TRUST-01 | 03-02, 03-03, 03-04, 03-06 | User can search ClawHub catalog for plugins and skills with category filtering | SATISFIED | Search works; plugin trust signals displayed; skill trust signals now displayed via CatalogSkillRow fix |
| TRUST-02 | 03-03, 03-04, 03-06 | System displays trust signals on catalog entries | SATISFIED | Plugin catalog: trust badges displayed. Skill catalog: trust signals now displayed (CatalogSkillRow forwards all trust props) |
| TRUST-03 | 03-01, 03-03, 03-06 | Deny-by-default: bundled/verified allow, community block, unscanned block always | SATISFIED | Server-side enforcement: VERIFIED (evaluateTrustPolicy 403 for both plugins and skills). UI-level enforcement: VERIFIED for both plugins and skills |
| TRUST-04 | 03-01, 03-03, 03-04 | Admin can override trust for community extensions with credential-access consent dialog and audit trail | SATISFIED | trust-overrides.ts endpoints; TrustOverrideDialog with verbatim PRD text; CredentialConfigPanel audit trail |
| TRUST-05 | 03-02 | System pins exact version + SHA-512 integrity hash on install | SATISFIED | skill-store and plugin-store both pin locked_version + integrity_hash from RPC response |
| TRUST-06 | 03-02 | System rejects reinstall if registry returns different hash for same version | SATISFIED | Integrity mismatch check in skill-store installSkill and plugin-store _activatePluginWithLock |
| TRUST-07 | 03-03, 03-05 | User can explicitly upgrade an extension with re-pinning and re-hashing | SATISFIED | Upgrade endpoints with dryRun; CredentialConfigPanel two-step upgrade flow |

All 7 TRUST-01 through TRUST-07 requirements are satisfied. No orphaned requirements.

### Anti-Patterns Found

None. No TODO/FIXME comments, placeholder implementations, empty handlers, or stub returns found in any verified files. The previously identified blocker (CatalogSkillRow not forwarding trust props) is resolved in commit 61acc88.

### Human Verification Required

#### 1. Skill Catalog Trust Signals

**Test:** With a running instance, open the Skills catalog tab and observe a ClawHub skill entry
**Expected:** Trust badges (Verified/Unverified/Scan-failed), download count, and VirusTotal status are visible on skill rows — same as plugin rows
**Why human:** Trust prop forwarding is now wired; visual confirmation needed that TrustBadgeRow renders in the correct position within the skill row layout

#### 2. Community Skill Blocked Display

**Test:** With a running instance, open the Skills catalog. Find a community (unverified) skill
**Expected:** Row is grayed out, lock icon shown with block reason text, Override link visible, no Install button
**Why human:** Requires live ClawHub data with a community skill in the response

#### 3. Override Dialog Verbatim Text and Interaction

**Test:** Click Override on a blocked community plugin entry
**Expected:** Dialog opens showing the exact PRD warning text. Approve button remains disabled until checkbox is checked AND reason has non-empty text
**Why human:** Visual interaction flow with live dialog; verbatim text confirmed in i18n file but UX behavior requires human confirmation

#### 4. Check for Updates and Upgrade Workflow

**Test:** Open configure panel for an installed ClawHub plugin. Click "Check for Updates"
**Expected:** Either "Up to date" appears, or a version diff ("v1.0 -> v1.1") appears with an Upgrade button. Clicking Upgrade re-installs and shows "Upgraded to v1.1" with a restart-required note for plugins
**Why human:** Requires running instance, live ClawHub, and an installed plugin that has an available update

#### 5. Integrity Mismatch Alert Rendering

**Test:** Locate a plugin or skill in 'failed' status whose error contains "Integrity mismatch"
**Expected:** The alert renders with a shield icon and .extension-alert--integrity CSS class (red border, distinctive from standard failed alerts)
**Why human:** Cannot trigger integrity mismatch without a tampered registry response in a test environment

### Gaps Summary

All automated gaps are resolved. The single blocker from the initial verification — `CatalogSkillRow` not forwarding trust props to `CatalogExtensionRow` — was fixed in plan 03-06 (commit 61acc88). `CatalogSkillRow` now accepts all 5 trust props in its interface, destructures them, and passes them through identically to how `CatalogExtensionRow` is used in the plugin catalog. `ExtensionsTab` now passes `entry.trustTier`, `entry.trustSignals`, `blocked={entry.trustDecision === 'block'}`, `entry.blockReason`, and `onRequestOverride={(id) => handleRequestOverride(id, 'skill')}` on every skill catalog row.

TRUST-01, TRUST-02, and TRUST-03 are fully satisfied. All 7 requirements are satisfied. 5 items remain for human verification with a running instance.

---

_Verified: 2026-04-04T05:30:00Z_
_Verifier: Claude (gsd-verifier)_
