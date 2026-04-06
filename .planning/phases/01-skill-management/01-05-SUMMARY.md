---
phase: 01-skill-management
plan: 05
subsystem: ui
tags: [react, i18n, react-i18next, css-variables, oxide-design-system, extensions, skills]

# Dependency graph
requires:
  - phase: 01-skill-management
    plan: 01
    provides: "InstanceSkill, SkillCatalogEntry, GatewayExtensionInfo, ExtensionStatus shared types"
  - phase: 01-skill-management
    plan: 03
    provides: "REST API routes: GET /skills, GET /skills/catalog, POST /skills/install, PUT /skills/:id, DELETE /skills/:id"
provides:
  - "ExtensionsTab React component with skills/plugins sub-tab toggle"
  - "SkillRow component for installed skills with toggle, gear, and uninstall actions"
  - "CatalogSkillRow component for available skills with Install button"
  - "ExtensionsTab.css: Oxide CSS variable styles with skeleton animation"
  - "Extensions tab integrated in InstancePage (after Chat, before Overview)"
  - "extensions.* i18n namespace in all 6 locale files (en, zh, fr, de, es, it)"
  - "configuringSkillId state hook-point for CredentialConfigPanel (Plan 01-06)"
affects:
  - "01-06 (CredentialConfigPanel reads configuringSkillId state from ExtensionsTab)"
  - "Phase 02 (Plugins sub-tab placeholder ready for plugin management)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sub-tab toggle as pill/segmented control with .sub-tab-toggle CSS class"
    - "Skeleton loading rows via @keyframes skeleton-pulse CSS animation"
    - "Status dot with semantic color classes (status-dot--active/warning/error/disabled)"
    - "Toggle switch via styled checkbox + ::after pseudo-element (no external library)"
    - "Gear icon sets parent state (configuringSkillId) only — no modal or API call"

key-files:
  created:
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/components/extensions/ExtensionsTab.css
    - apps/web/src/components/extensions/SkillRow.tsx
    - apps/web/src/components/extensions/CatalogSkillRow.tsx
  modified:
    - apps/web/src/pages/InstancePage.tsx
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Gear icon in SkillRow sets configuringSkillId state in parent ExtensionsTab only — no modal, no API — CredentialConfigPanel consumes this state in Plan 01-06"
  - "Extensions tab placed after Chat and before Overview in InstancePage main tab bar (not in ADVANCED_TABS dropdown)"
  - "Catalog section hidden (with message) when instance not running; installed skills always shown from DB"
  - "Gateway built-ins rendered as read-only rows with CSS opacity reduction — no action buttons"
  - "Plugins sub-tab shows 'coming in Phase 2' placeholder to avoid dead UI"

patterns-established:
  - "extensions/* i18n namespace pattern for all future extension-related UI strings"
  - "configuringSkillId state pattern for deferred modal wiring between plans"

requirements-completed: [UI-01, UI-05, UI-07, SKILL-01]

# Metrics
duration: 6min
completed: 2026-04-03
---

# Phase 1 Plan 05: Extensions Tab UI Summary

**React Extensions tab with skills/plugins sub-tab toggle, installed skill rows (toggle/gear/uninstall), read-only gateway built-ins section, catalog Install buttons, and full i18n across all 6 locales**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-03T16:46:58Z
- **Completed:** 2026-04-03T16:52:33Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- ExtensionsTab component: sub-tab toggle (Skills/Plugins), data fetching from `/instances/:id/skills` and `/instances/:id/skills/catalog`, installed list, gateway built-ins (read-only), catalog with Install buttons, skeleton loading, mutation disable when stopped
- SkillRow: colored status dot, toggle switch (pure CSS), gear icon that sets `configuringSkillId` state for Plan 01-06's CredentialConfigPanel, uninstall X with confirm dialog
- CatalogSkillRow: source badge (Bundled/ClawHub), credential indicator, Install button with installing state
- ExtensionsTab.css: full Oxide CSS variable-based styles, `@keyframes skeleton-pulse`, responsive stacking at 640px
- InstancePage integration: 'extensions' TabId added, tab button after Chat, content rendering wired
- All 6 locale files updated with `instance.tabs.extensions` and full `extensions.*` namespace (55 translation keys each)

## Task Commits

1. **Task 1: Create ExtensionsTab component with sub-tabs, skill list, and catalog** - `2eb056b` (feat)
2. **Task 2: Integrate ExtensionsTab into InstancePage and add i18n strings** - `1f9707e` (feat)

## Files Created/Modified

- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Main container: sub-tab toggle, data fetching, installed/gateway/catalog sections, action handlers (253 lines)
- `apps/web/src/components/extensions/ExtensionsTab.css` - Full Oxide CSS with skeleton animation, toggle switch, status dots, source badges (466 lines)
- `apps/web/src/components/extensions/SkillRow.tsx` - Installed skill row with status dot, toggle, gear, uninstall (87 lines)
- `apps/web/src/components/extensions/CatalogSkillRow.tsx` - Catalog entry row with badges and Install button (52 lines)
- `apps/web/src/pages/InstancePage.tsx` - Added 'extensions' tab to TabId union, import, tab button, content render
- `apps/web/src/i18n/locales/en.json` - extensions.* namespace + instance.tabs.extensions
- `apps/web/src/i18n/locales/zh.json` - Simplified Chinese translations
- `apps/web/src/i18n/locales/fr.json` - French translations
- `apps/web/src/i18n/locales/de.json` - German translations (Erweiterungen)
- `apps/web/src/i18n/locales/es.json` - Spanish translations (Extensiones)
- `apps/web/src/i18n/locales/it.json` - Italian translations (Estensioni)

## Decisions Made

- Gear icon sets `configuringSkillId` state only (no modal, no `window.prompt()`, no API call) — CredentialConfigPanel will be built in Plan 01-06 and reads this state from a parent/sibling context
- Extensions tab placed directly in main tab bar (not in ADVANCED_TABS More dropdown) per plan spec
- Catalog hidden with "Start instance to browse" message when `instanceStatus !== 'running'`; installed section always shown from DB (works when stopped)
- Gateway built-ins section uses CSS `opacity: 0.9` and `::after` "(read-only)" label to communicate non-interactivity without full disabling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Lint passes with zero errors (14 pre-existing warnings in unrelated files unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-06 (CredentialConfigPanel) can read `configuringSkillId` state from ExtensionsTab; the gear icon wiring is in place
- Extensions tab fully functional for listing and managing skills when instance is running
- Plugins sub-tab shows Phase 2 placeholder, ready for plugin management implementation

## Self-Check: PASSED

All files found:
- FOUND: apps/web/src/components/extensions/ExtensionsTab.tsx
- FOUND: apps/web/src/components/extensions/ExtensionsTab.css
- FOUND: apps/web/src/components/extensions/SkillRow.tsx
- FOUND: apps/web/src/components/extensions/CatalogSkillRow.tsx
- FOUND: apps/web/src/pages/InstancePage.tsx

Commits verified:
- FOUND: 2eb056b (feat(01-05): create ExtensionsTab component)
- FOUND: 1f9707e (feat(01-05): integrate ExtensionsTab into InstancePage)

All 6 locale files contain extensions namespace: confirmed.

---
*Phase: 01-skill-management*
*Completed: 2026-04-03*
