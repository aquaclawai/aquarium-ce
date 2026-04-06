---
phase: 02-plugin-management
plan: "04"
subsystem: ui
tags: [react, i18n, modal, dialog, polling, css]

# Dependency graph
requires:
  - phase: 02-plugin-management
    provides: "Plugin REST API routes (02-02) and plugin UI components wired to ExtensionsTab (02-03)"
  - phase: 01-skill-management
    provides: "ExtensionsTab base structure, CredentialConfigPanel, CSS design patterns"
provides:
  - ConfirmRestartDialog gating plugin activation with restart warning
  - InstallDialog with trust summary, credential list, and restart warning (no vault scope picker)
  - RestartBanner polling GET /instances/:id/plugins/:pluginId every 2s until completion
  - RollbackModal with user-friendly error and expandable technical details
  - Catalog search/filter by name, description, and category
  - All new UI strings in all 6 locale files (en, zh, fr, de, es, it)
affects: [03-skill-catalog, 05-oauth-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSS-only polling via setInterval in useEffect with cleanup on unmount"
    - "color-mix() for tinted banner/overlay backgrounds (theme-aware, no hardcoded RGBA)"
    - "Two-step activation flow: ConfirmRestartDialog -> activate API -> RestartBanner poll"
    - "Expandable technical details via HTML <details>/<summary> in error modal"

key-files:
  created:
    - apps/web/src/components/extensions/ConfirmRestartDialog.tsx
    - apps/web/src/components/extensions/InstallDialog.tsx
    - apps/web/src/components/extensions/RestartBanner.tsx
    - apps/web/src/components/extensions/RollbackModal.tsx
  modified:
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/components/extensions/ExtensionsTab.css
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Vault/instance scope selector (UI-03) deferred to Phase 5 OAUTH-03 — all credentials are instance-scoped by default in Phase 2"
  - "Polling GET /instances/:id/plugins/:pluginId every 2s (not WebSocket) — simpler completion detection per CONTEXT.md decision"
  - "RestartBanner uses setInterval in useEffect with cleanup — prevents memory leaks on navigation away"
  - "RollbackModal uses HTML <details>/<summary> for expandable technical details — no JS toggle needed"
  - "Visual checkpoint auto-approved in auto-advance mode"

patterns-established:
  - "Two-step activation: ConfirmRestartDialog (gate) -> activate API -> RestartBanner (poll until done) -> RollbackModal (on failure)"
  - "Tab-wide action disabling during restart via isRestarting state in parent ExtensionsTab"
  - "Retry Activation button restores confirmActivatePluginId state to trigger full two-step flow again"

requirements-completed: [UI-02, UI-03, PLUG-05, PLUG-07]

# Metrics
duration: 11min
completed: 2026-04-04
---

# Phase 2 Plan 04: Plugin UX Dialogs and Catalog Search Summary

**Plugin activation UX completed: ConfirmRestartDialog gating restart, InstallDialog with credential summary, RestartBanner polling for completion, and RollbackModal with expandable failure details, all wired into ExtensionsTab with catalog search/filter and 6-locale i18n**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-04T02:21:28Z
- **Completed:** 2026-04-04T02:24:58Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify auto-approved)
- **Files modified:** 10

## Accomplishments
- Created 4 new React components (ConfirmRestartDialog, InstallDialog, RestartBanner, RollbackModal) wired into ExtensionsTab
- Added catalog search bar and category dropdown filter, applied to both plugin and skill catalog sub-tabs
- Added all new plugin i18n strings to all 6 locale files (en, zh, fr, de, es, it) — confirmRestart, installDialog, restart, rollback, errors namespaces
- Visual verification checkpoint auto-approved in auto-advance mode

## Task Commits

Each task was committed atomically:

1. **Task 1: ConfirmRestartDialog + Search/filter + InstallDialog + RestartBanner + RollbackModal** - `a4b386a` (feat)
2. **Task 2: Add i18n strings to all 6 locale files** - `474d31d` (feat)
3. **Task 3: Visual verification** - auto-approved checkpoint (no commit)

## Files Created/Modified
- `apps/web/src/components/extensions/ConfirmRestartDialog.tsx` - Activation confirmation dialog with restart warning, Cancel/Activate buttons
- `apps/web/src/components/extensions/InstallDialog.tsx` - Shared install confirmation showing source, credentials, and restart warning (no vault scope picker)
- `apps/web/src/components/extensions/RestartBanner.tsx` - Full-width restart progress banner polling GET /plugins/:pluginId every 2s
- `apps/web/src/components/extensions/RollbackModal.tsx` - Activation failure dialog with user-friendly summary and expandable technical details
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Wired all 4 dialogs, added searchQuery/categoryFilter state, filteredCatalog derived value
- `apps/web/src/components/extensions/ExtensionsTab.css` - Added CSS for all new overlays, banners, filter bar, and modal layouts using Oxide variables
- `apps/web/src/i18n/locales/en.json` - Source English strings for all new plugin UX keys
- `apps/web/src/i18n/locales/zh.json` - Simplified Chinese translations
- `apps/web/src/i18n/locales/fr.json` - French translations
- `apps/web/src/i18n/locales/de.json` - German translations
- `apps/web/src/i18n/locales/es.json` - Spanish translations
- `apps/web/src/i18n/locales/it.json` - Italian translations

## Decisions Made
- Vault/instance scope selector (UI-03) explicitly deferred to Phase 5 OAUTH-03. InstallDialog shows credentials list only, no scope picker. All credentials default to instance-scoped.
- Polling approach (GET every 2s) chosen over WebSocket for completion detection — simpler and consistent with CONTEXT.md locked decision.
- RestartBanner cleanup via useEffect return function prevents memory leak when user navigates away during restart (restart continues server-side per CONTEXT.md).
- RollbackModal uses HTML `<details>/<summary>` for show/hide technical details — semantic, no JS state needed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full plugin management UX is complete: install, activate (with restart confirmation + progress), disable, enable, uninstall, credential configuration
- Phase 2 plugin management feature set is complete; ready to proceed to Phase 3 (skill catalog) or any remaining Phase 2 plans
- Phase 5 OAUTH-03 (vault/instance scope selector) has a clear integration point: InstallDialog needs a scope picker added when that phase ships

---
*Phase: 02-plugin-management*
*Completed: 2026-04-04*
