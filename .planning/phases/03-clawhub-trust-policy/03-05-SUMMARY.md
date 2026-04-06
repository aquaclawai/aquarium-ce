---
phase: 03-clawhub-trust-policy
plan: 05
subsystem: ui
tags: [react, i18n, trust, version-pinning, integrity, upgrade-workflow]

# Dependency graph
requires:
  - phase: 03-clawhub-trust-policy
    provides: trust-override API routes, upgrade endpoints with dryRun, ClawHub catalog merging, trust UI components
  - phase: 02-plugin-management
    provides: CredentialConfigPanel, ExtensionsTab, ExtensionRow, plugin/skill management UI
provides:
  - Version info section in CredentialConfigPanel showing pinned version and truncated SHA-512 integrity hash
  - Two-step upgrade workflow (Check for Updates dryRun=true, then Upgrade dryRun=false)
  - Trust override audit trail display in CredentialConfigPanel
  - Integrity mismatch alert rendering in ExtensionsTab with distinctive red border + shield icon
  - All new i18n keys in 6 locales (en, zh, fr, de, es, it)
affects: [04-oauth-vault, 05-credential-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-step dryRun upgrade flow: check first (dryRun=true), then commit (dryRun=false) with spinner
    - Truncated hash display: sha512-{first16}...{last8} for compact readability
    - Integrity mismatch as distinctive CSS class (.extension-alert--integrity) with shield icon

key-files:
  created: []
  modified:
    - apps/web/src/components/extensions/CredentialConfigPanel.tsx
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/components/extensions/ExtensionsTab.css
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Visual checkpoint auto-approved in auto-advance mode for Plan 03-05"
  - "Truncated hash shown as sha512-{first16}...{last8} — compact but identifiable in configure panel"
  - "Two-step upgrade dryRun flow implemented: Check for Updates queries version without side effects, Upgrade button commits"

patterns-established:
  - "dryRun=true for version check, dryRun=false for actual upgrade — same PUT endpoint, body discriminates"
  - "Integrity mismatch gets .extension-alert--integrity CSS class + shield icon vs standard X icon for failed alerts"
  - "Trust audit trail rendered as .credential-panel__audit info box below credential form"

requirements-completed: [TRUST-05, TRUST-06, TRUST-07]

# Metrics
duration: ~5min
completed: 2026-04-04
---

# Phase 03 Plan 05: Trust UX — Version Info, Upgrade Workflow, Integrity Alerts, and Audit Trail Summary

**CredentialConfigPanel extended with pinned version display, two-step dryRun upgrade flow, and trust override audit trail; ExtensionsTab gains integrity mismatch alert rendering with shield icon; all in 6 locales**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-04T04:11:37Z
- **Completed:** 2026-04-04T04:16:00Z
- **Tasks:** 2 (1 auto + 1 checkpoint auto-approved)
- **Files modified:** 9

## Accomplishments
- Added version info section to CredentialConfigPanel: pinned version label and truncated SHA-512 hash (sha512-{first16}...{last8})
- Implemented two-step upgrade workflow: "Check for Updates" sends dryRun=true, shows current vs latest version diff, "Upgrade" button sends dryRun=false with restart note for plugins
- Trust override audit trail section renders below credential form when trustOverride is set ("Admin-approved by X on Y: Z")
- ExtensionsTab detects integrity mismatch errorMessage and renders with .extension-alert--integrity CSS class and shield icon
- All new strings added in all 6 locale files (en, zh, fr, de, es, it)

## Task Commits

Each task was committed atomically:

1. **Task 1: Version info, upgrade workflow, audit trail, and i18n updates** - `65535c5` (feat)
2. **Task 2: Visual verification of Phase 3 trust UX** - Auto-approved (checkpoint:human-verify)

## Files Created/Modified
- `apps/web/src/components/extensions/CredentialConfigPanel.tsx` - Version info section, two-step upgrade workflow, trust audit trail
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Passes lockedVersion/integrityHash/trustOverride props to CredentialConfigPanel; integrity mismatch alert with shield icon
- `apps/web/src/components/extensions/ExtensionsTab.css` - New CSS classes: .credential-panel__version, .credential-panel__version-row, .credential-panel__audit, .extension-alert--integrity, etc.
- `apps/web/src/i18n/locales/en.json` - extensions.version.*, extensions.trust.auditTrail, extensions.alerts.integrityMismatch
- `apps/web/src/i18n/locales/zh.json` - Translated all new keys
- `apps/web/src/i18n/locales/fr.json` - Translated all new keys
- `apps/web/src/i18n/locales/de.json` - Translated all new keys
- `apps/web/src/i18n/locales/es.json` - Translated all new keys
- `apps/web/src/i18n/locales/it.json` - Translated all new keys

## Decisions Made
- Visual checkpoint auto-approved in auto-advance mode — human verification deferred to manual QA
- Truncated hash display as `sha512-{first16}...{last8}` for compact readability in configure panel
- Two-step upgrade dryRun flow: same PUT endpoint, body `{ dryRun }` discriminates behavior

## Deviations from Plan

None - plan executed exactly as written. Task 2 (checkpoint:human-verify) was auto-approved per auto-advance mode.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 03 (ClawHub Trust Policy) is complete: all 5 plans executed
- Trust types, DB migrations, trust-store service, marketplace client, version pinning, trust-override API, catalog endpoints, trust badge UI, blocked extension display, admin override dialog, version info/upgrade flow, and integrity mismatch alerts are all shipped
- Ready for Phase 04 (OAuth Vault) or Phase 05 (Credential Store)

---
*Phase: 03-clawhub-trust-policy*
*Completed: 2026-04-04*
