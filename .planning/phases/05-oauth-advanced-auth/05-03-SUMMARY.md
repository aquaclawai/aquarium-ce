---
phase: 05-oauth-advanced-auth
plan: "03"
subsystem: ui
tags: [oauth, vault, react, i18n, credentials, extensions, popup-flow, postmessage]

# Dependency graph
requires:
  - phase: 05-oauth-advanced-auth/05-01
    provides: oauth-proxy route, requiresReAuth shared type
  - phase: 05-oauth-advanced-auth/05-02
    provides: vault-config CRUD endpoints, exec SecretRef resolution
provides:
  - oauth-connect-button-ui
  - vault-config-section-component
  - credential-source-toggle-ui
  - requiresReauth-banner
  - i18n-oauth-vault-keys-6-locales
affects: [extensions-tab, instance-page, credential-config-panel]

# Tech tracking
tech-stack:
  added: []
  patterns: [popup-oauth-flow-postmessage, credential-source-toggle, vault-form-conditional-fields]

key-files:
  created:
    - apps/web/src/components/extensions/VaultConfigSection.tsx
  modified:
    - apps/web/src/components/extensions/CredentialConfigPanel.tsx
    - apps/web/src/components/extensions/ExtensionsTab.tsx
    - apps/web/src/components/extensions/ExtensionsTab.css
    - apps/web/src/components/InstancePage.tsx
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Visual checkpoint auto-approved in auto-advance mode for Plan 05-03"
  - "credentialSource toggle only visible when vaultConfigured=true — no vault = no toggle shown"
  - "OAuth postMessage listener keyed on extensionId — prevents cross-extension callback collisions"

patterns-established:
  - "Popup OAuth flow: api.post initiate -> window.open -> postMessage callback -> setOauthConnected"
  - "Vault form conditional rendering: HashiCorp shows address/namespace/authMethod/mountPath, 1Password shows op CLI note only"

requirements-completed: [OAUTH-01, OAUTH-02, OAUTH-03]

# Metrics
duration_seconds: 174
completed_date: "2026-04-04"
tasks_completed: 3
files_modified: 11
---

# Phase 5 Plan 03: OAuth and Vault UI Summary

**OAuth connect button with popup/postMessage flow in CredentialConfigPanel, VaultConfigSection with 1Password/HashiCorp form, and credential source toggle across all 6 locale files**

## Performance

- **Duration:** ~3 min (174s)
- **Started:** 2026-04-04T06:34:46Z
- **Completed:** 2026-04-04T06:39:25Z
- **Tasks:** 3 (2 auto + 1 checkpoint auto-approved)
- **Files modified:** 11

## Accomplishments

- CredentialConfigPanel extended with OAuth connect button (popup-based flow), requiresReAuth warning banner, and vault source toggle (direct vs vault path) gated on vault presence
- VaultConfigSection component created with full form for both 1Password CLI and HashiCorp Vault types, integrated into InstancePage
- All 6 locale files (en/zh/fr/de/es/it) updated with matching `extensions.oauth`, `extensions.vault`, and `extensions.credentials` key namespaces

## Task Commits

Each task was committed atomically:

1. **Task 1: OAuth connect button and vault source in CredentialConfigPanel** - `06cffa3` (feat)
2. **Task 2: VaultConfigSection component, instance page integration, and i18n** - `8f12869` (feat)
3. **Task 3: Visual verification of OAuth and vault UI** - checkpoint auto-approved (no code changes)

## Files Created/Modified

- `apps/web/src/components/extensions/CredentialConfigPanel.tsx` - Added OAuth connect section, requiresReAuth banner, credential source toggle, vault path input
- `apps/web/src/components/extensions/VaultConfigSection.tsx` - New component: vault type selector, conditional HashiCorp fields, save/remove actions
- `apps/web/src/components/extensions/ExtensionsTab.tsx` - Passes supportsOAuth/requiresReAuth/vaultConfigured props, fetches vault-config on mount
- `apps/web/src/components/extensions/ExtensionsTab.css` - OAuth button, reauth banner, vault config section styles using CSS variables
- `apps/web/src/components/InstancePage.tsx` - Integrates VaultConfigSection in instance settings area
- `apps/web/src/i18n/locales/en.json` - English keys for oauth, vault, credentials namespaces
- `apps/web/src/i18n/locales/zh.json` - Chinese translations
- `apps/web/src/i18n/locales/fr.json` - French translations
- `apps/web/src/i18n/locales/de.json` - German translations
- `apps/web/src/i18n/locales/es.json` - Spanish translations
- `apps/web/src/i18n/locales/it.json` - Italian translations

## Decisions Made

- Visual checkpoint auto-approved in auto-advance mode — both tasks completed cleanly and lint passed
- Credential source toggle only shown when `vaultConfigured=true` — avoids confusing users without vault configured
- OAuth postMessage listener keyed on `extensionId` to prevent callback collisions when multiple panels are open

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `apps/web/src/components/extensions/VaultConfigSection.tsx` — FOUND (created in task 2)
- `apps/web/src/components/extensions/CredentialConfigPanel.tsx` — FOUND (modified in task 1)
- `apps/web/src/components/InstancePage.tsx` — FOUND (modified in task 2)
- `apps/web/src/i18n/locales/en.json` — FOUND (modified in task 2)
- Commits `06cffa3` and `8f12869` — verified via git log

## Next Phase Readiness

Phase 5 (OAuth Advanced Auth) is now complete. All three plans delivered:
- Plan 01: OAuth proxy route + requiresReAuth types
- Plan 02: Vault config API + exec SecretRef resolution
- Plan 03: Frontend UI for OAuth connect, vault config, and credential source toggle

The full OAuth proxy and vault integration is ready for end-to-end testing. Phase 6 (or whichever follows) can depend on `oauth-proxy/initiate`, `vault-config` endpoints, and the credential panel UI.

---
*Phase: 05-oauth-advanced-auth*
*Completed: 2026-04-04*
