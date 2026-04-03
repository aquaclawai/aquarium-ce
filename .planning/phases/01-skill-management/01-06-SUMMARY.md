---
phase: 01-skill-management
plan: "06"
subsystem: ui
tags: [react, i18n, extensions, skills, credentials, alerts]

requires:
  - phase: 01-skill-management/01-05
    provides: ExtensionsTab with SkillRow gear icon, configuringSkillId state, SkillRow/CatalogSkillRow components
  - phase: 01-skill-management/01-03
    provides: POST /instances/:id/extension-credentials API endpoint

provides:
  - CredentialConfigPanel component — inline credential entry panel below SkillRow
  - Alert banners for failed/degraded extension states at top of ExtensionsTab
  - All 6 locale files updated with credentials and alerts i18n strings
  - Toggle behavior for gear icon (open/close credential panel)

affects: [future plugin management, extension health monitoring]

tech-stack:
  added: []
  patterns:
    - Inline panel expansion below list row (no modal) for contextual configuration
    - Alert banner pattern using color-mix() CSS for themed error/warning backgrounds

key-files:
  created:
    - apps/web/src/components/extensions/CredentialConfigPanel.tsx
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
  - "Gear icon toggles panel (second click closes) — prevents orphaned open panels when user clicks away"
  - "Alert banners placed before sub-tab toggle so they are visible regardless of active sub-tab"
  - "color-mix() used for alert background tints — theme-aware, no hardcoded colors"
  - "Retry button re-invokes install with source=bundled — simplest recoverable action for failed skills"

patterns-established:
  - "Inline expansion panel: wrap SkillRow in div, conditionally render panel sibling below it"
  - "Alert banner pattern: .extension-alert base + modifier classes for severity"

requirements-completed: [UI-06, SKILL-04]

duration: 3min
completed: "2026-04-03"
---

# Phase 1 Plan 06: Alert Banners and Credential Panel Summary

**Inline CredentialConfigPanel below SkillRow with POST to extension-credentials, plus red/yellow alert banners for failed/degraded skills, all i18n strings in 6 locales**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T16:55:16Z
- **Completed:** 2026-04-03T16:58:00Z
- **Tasks:** 1 of 2 complete (Task 2 is visual checkpoint awaiting human verification)
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments
- Created CredentialConfigPanel with field + password inputs, save to API, success/error feedback, close button
- Wired gear icon in ExtensionsTab to toggle panel inline below each SkillRow (toggle: second click closes)
- Added alert banners at top of ExtensionsTab for failed (red) and degraded (yellow) managed skills
- Updated all 6 locale files with `credentials.*` and `alerts.*` translation keys

## Task Commits

1. **Task 1: Add credential configuration panel and alert banners** - `5e89402` (feat)
2. **Task 2: Visual verification** - awaiting checkpoint

## Files Created/Modified
- `apps/web/src/components/extensions/CredentialConfigPanel.tsx` - Inline credential panel; POSTs to extension-credentials endpoint
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Alert banners, CredentialConfigPanel integration, toggle gear behavior
- `apps/web/src/components/extensions/ExtensionsTab.css` - .credential-panel, .extension-alert, .extension-alert--failed/--degraded styles
- `apps/web/src/i18n/locales/en.json` - credentials and alerts strings (English)
- `apps/web/src/i18n/locales/zh.json` - credentials and alerts strings (Chinese)
- `apps/web/src/i18n/locales/fr.json` - credentials and alerts strings (French)
- `apps/web/src/i18n/locales/de.json` - credentials and alerts strings (German)
- `apps/web/src/i18n/locales/es.json` - credentials and alerts strings (Spanish)
- `apps/web/src/i18n/locales/it.json` - credentials and alerts strings (Italian)

## Decisions Made
- Gear icon second-click closes the panel (toggle behavior) — prevents multiple open panels and follows standard accordion UX
- Alert banners placed above the sub-tab header so they surface regardless of active tab
- `color-mix(in srgb, ...)` used for alert tints — theme-aware without hardcoded RGBA values
- Retry button source is hardcoded to `bundled` — appropriate for the current skill catalog (all bundled), can be extended later

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — lint passes with 0 errors. Shared package builds cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CredentialConfigPanel and alert banners complete the user-visible feedback loop for skill management
- After visual checkpoint confirmation, Phase 1 (Skill Management) is functionally complete
- Phase 2 can proceed: plugin management, ClawHub marketplace, credential vault UI

---
*Phase: 01-skill-management*
*Completed: 2026-04-03*
