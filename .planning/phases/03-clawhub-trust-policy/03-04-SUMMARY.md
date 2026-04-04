---
phase: 03-clawhub-trust-policy
plan: "04"
subsystem: web-ui-extensions
tags: [trust-policy, extensions, ui, i18n, catalog]
dependency_graph:
  requires: ["03-01"]
  provides: ["TrustBadgeRow", "TrustOverrideDialog", "CatalogExtensionRow trust display", "InstallDialog trust summary", "ExtensionsTab ClawHub pagination"]
  affects: ["apps/web/src/components/extensions/", "packages/shared/src/types.ts"]
tech_stack:
  added: []
  patterns: ["color-mix() CSS for theme-aware trust badge colors", "ClawHub paginated catalog with server-side search params", "Trust tier badge display from shared TrustTier type"]
key_files:
  created:
    - apps/web/src/components/extensions/TrustBadges.tsx
    - apps/web/src/components/extensions/TrustOverrideDialog.tsx
  modified:
    - apps/web/src/components/extensions/CatalogExtensionRow.tsx
    - apps/web/src/components/extensions/InstallDialog.tsx
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/components/extensions/ExtensionsTab.css
    - packages/shared/src/types.ts
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json
decisions:
  - "trustDecision/blockReason added as optional fields to SkillCatalogEntry and PluginCatalogEntry in shared types — UI uses them when server (plan 03-03) provides them, gracefully renders no blocked state otherwise"
  - "CatalogSkillRow (skill-specific) left unchanged — CatalogExtensionRow handles plugin trust display; skill catalog continues to use CatalogSkillRow without trust UI until 03-03 server integration is complete"
  - "Load more page detection uses response.length === PAGE_LIMIT heuristic — matches server pagination convention"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-04"
  tasks_completed: 2
  files_modified: 11
---

# Phase 03 Plan 04: Trust UI — Badges, Override Dialog, ClawHub Pagination Summary

Trust signals visible in catalog UI: tier badges (bundled/verified/community/unscanned), blocked-state display with override flow for admins, ClawHub pagination with Load more, and trust summary in InstallDialog — across all 6 i18n locales.

## What Was Built

### Task 1: TrustBadges and TrustOverrideDialog components

**TrustBadges.tsx** — `TrustBadgeRow` component:
- Source `bundled` → single blue "Bundled" badge, returns early
- ClawHub tiers: verified (green checkmark), community (yellow), unscanned (red)
- Signal badges: VirusTotal pass (green shield), VirusTotal fail (red shield), download count when >100, age when >90 days

**TrustOverrideDialog.tsx** — Admin consent dialog:
- Verbatim PRD section 10.2 credential-access warning text
- Acknowledgment checkbox (required before Approve is enabled)
- Reason textarea (required, non-empty)
- PUT `/instances/{id}/{kind}s/{extensionId}/trust-override` with `{ action: 'allow', reason, credentialAccessAcknowledged: true }`

**ExtensionsTab.css** — New styles:
- `.trust-badge*` classes using `color-mix(in srgb, var(--color-*) 15%, transparent)` — theme-aware
- `.catalog-skill-row--blocked` opacity + hidden Install button
- `.blocked-label`, `.blocked-label__icon`, `.override-link`
- `.trust-override-dialog__*` dialog styles
- `.load-more-btn` for ClawHub pagination

### Task 2: CatalogExtensionRow, InstallDialog, ExtensionsTab, i18n

**CatalogExtensionRow.tsx**:
- New optional props: `trustTier`, `trustSignals`, `blocked`, `blockReason`, `onRequestOverride`
- Meta section now renders `TrustBadgeRow` instead of old source-badge logic
- Blocked state: lock icon + blockReason text; Override link only shown for `community` tier (NOT `unscanned`) when `onRequestOverride` provided

**InstallDialog.tsx**:
- New optional props: `trustTier`, `trustSignals`
- Trust summary row (label "Trust" + `TrustBadgeRow`) inserted between version and credentials sections, only when `trustTier` is defined

**ExtensionsTab.tsx**:
- ClawHub pagination state: `clawHubPluginPage`, `clawHubSkillPage`, `clawHubPluginHasMore`, `clawHubSkillHasMore`
- `fetchPluginData` / `fetchSkillData` now pass `search`, `category`, `page=0`, `limit=20` query params to catalog endpoints
- `handleLoadMorePlugins` / `handleLoadMoreSkills` — append results to existing catalog arrays
- Load more button rendered when `hasMore` is true
- `overrideTarget` state + `handleRequestOverride` / `handleOverrideComplete` callbacks
- `TrustOverrideDialog` rendered when `overrideTarget` is set; on complete re-fetches catalog
- Trust props (`trustTier`, `trustSignals`, `blocked`, `blockReason`) passed to `CatalogExtensionRow` from catalog entry fields
- `installDialogEntry.trustTier` and `trustSignals` forwarded to `InstallDialog`

**shared/types.ts**:
- `SkillCatalogEntry` and `PluginCatalogEntry` both gain `trustDecision?: TrustDecision` and `blockReason?: string` — consumed by UI when server (plan 03-03) populates them

**i18n — extensions.trust namespace added to all 6 locales (en, zh, fr, de, es, it)**:
- Keys: `bundled`, `verified`, `unverified`, `scanned`, `scanFailed`, `downloads`, `age`, `blockedCommunity`, `blockedUnscanned`, `override`, `credentialAccessWarning`, `acknowledgeCheckbox`, `reasonPlaceholder`, `approveOverride`, `overrideSuccess`, `trustSummary`
- Extensions.catalog: `loadMore`, `clawhubUnavailable` added to all 6 locales

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing fields] Added trustDecision/blockReason to shared catalog entry types**
- **Found during:** Task 2 — UI needs `trustDecision` and `blockReason` fields the plan references but they weren't in `SkillCatalogEntry`/`PluginCatalogEntry`
- **Fix:** Added optional `trustDecision?: TrustDecision` and `blockReason?: string` to both interfaces in `packages/shared/src/types.ts`
- **Files modified:** `packages/shared/src/types.ts`
- **Commit:** 9209def

**2. [Rule 1 - Note] CatalogSkillRow not extended with trust display**
- **Found during:** Task 2 — `CatalogSkillRow` is a separate component from `CatalogExtensionRow`; it handles skills in the skill sub-tab. The plan's trust UI targets `CatalogExtensionRow` (plugin catalog). Skill catalog items use `CatalogSkillRow` which was not in scope.
- **Impact:** Skills in the catalog sub-tab don't show trust badges yet — this requires either extending `CatalogSkillRow` or switching the skill catalog to use `CatalogExtensionRow`. Deferred pending 03-03 which adds trust data to skill catalog entries.
- **Tracking:** Deferred to post-03-03 integration

## Self-Check: PASSED

| Item | Status |
|------|--------|
| TrustBadges.tsx | FOUND |
| TrustOverrideDialog.tsx | FOUND |
| CatalogExtensionRow.tsx | FOUND |
| InstallDialog.tsx | FOUND |
| ExtensionsTab.tsx | FOUND |
| commit 9209def (Task 1) | FOUND |
| commit 73f6863 (Task 2) | FOUND |
