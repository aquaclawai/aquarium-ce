# Phase 2: Plugin Management - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Plugin install/activate/enable/disable/uninstall with gateway restart flow, credential configuration UI (install dialog + credential panel), catalog browse with search + category filter, and disabling chat commands for managed instances. Builds on Phase 1 infrastructure (extension-lock, extension-lifecycle, ExtensionsTab, extension-credentials route).

</domain>

<decisions>
## Implementation Decisions

### Gateway Restart UX
- Confirm before restart: click "Activate" → confirmation dialog: "This will restart the gateway. Active conversations may be interrupted. Continue?"
- Progress display: full-width banner at top of Extensions tab: "Gateway restarting for plugin X..." with spinner. All plugin actions disabled tab-wide during restart.
- Navigation away: restart completes server-side regardless of UI. On tab re-open, check for active operation (extension_operations with completed_at IS NULL) and restore the banner if restart is still in progress.
- Completion detection: poll GET /instances/:id/plugins/:pluginId every 2s until status changes. No WebSocket event — simpler.

### Plugin Row Design
- Shared ExtensionRow component: refactor SkillRow into a shared component that handles both skills and plugins. Conditional rendering for plugin-specific bits (Activate button, restart indicator).
- "Installed but not activated" state: show an "Activate" button where the enable/disable toggle normally is. Gear icon still available for credentials. Once activated, button becomes the normal toggle.
- Status dots: same colored-dot + text pattern as skills (green=active, yellow=installed/degraded, red=failed, gray=disabled)
- Shared catalog with search: refactor the existing catalog section to support both plugins and skills. Add search bar + category dropdown that filters both types.

### Install Dialog
- Claude's Discretion: design based on PRD §9.2 wireframe. Shared component for plugins and skills. Plugin-specific note: "This will require a gateway restart."

### Rollback Experience
- Communication: modal error dialog when activation fails. "The gateway failed to start with this plugin. It has been rolled back."
- Error detail: user-friendly summary + expandable "Show technical details" section with health check output
- Post-rollback state: Failed (red dot) with error message visible on row. "Retry Activation" button. User can also uninstall. Artifact remains on disk.

### Carrying Forward from Phase 1
- DB-only lock via INSERT conflict (extension-lock.ts) — reused for plugin operations
- Extension-credentials route — reused for plugin credential injection
- Extension-lifecycle service — reused for plugin boot reconciliation
- Compact row design, always-visible tab, skeleton loading, no caching — all carry forward
- server_session_id in config.ts — shared

### Claude's Discretion
- Install dialog layout and copy
- Shared ExtensionRow refactoring approach (rename SkillRow or create new)
- Category dropdown options for catalog filter
- Polling interval tuning (2s default, may adjust)
- Disabling commands.plugins in gateway config generation (PLUG-10) — implementation detail

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `extension-lock.ts`: DB-only fenced mutation lock — reuse for all plugin operations
- `skill-store.ts`: Pattern for plugin-store.ts — same structure (install/enable/disable/uninstall with RPC)
- `extension-lifecycle.ts`: Boot reconciliation — extend for plugins
- `extension-credentials.ts` route: Extension-scoped credential injection — reuse as-is
- `ExtensionsTab.tsx`: Already has Plugins sub-tab placeholder — wire plugin list here
- `SkillRow.tsx`: Refactor into shared ExtensionRow
- `CatalogSkillRow.tsx`: Refactor into shared CatalogExtensionRow
- `CredentialConfigPanel.tsx`: Reuse for plugin credentials — already extension-agnostic

### Established Patterns
- 3-operation plugin flow (PRD §5.3): install artifact → configure credentials → activate (restart)
- No config.patch during install (artifact staging only) — config changes happen at activation
- Gateway health check via `platform.ping` RPC after restart
- Rollback: remove plugin from config + restart again on activation failure

### Integration Points
- `plugin-store.ts` (new): Follows skill-store.ts pattern with plugin-specific additions (restart, rollback)
- `routes/plugins.ts` (new): Full CRUD + activate endpoint
- `instance-manager.ts`: Gateway restart via runtime engine — existing `restartInstance` or similar
- `server-core.ts`: Mount new plugins route
- Gateway config: Add `commands.plugins: false` in seedConfig for managed instances

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — §5.3 (3-op plugin flow), §5.8 (mutation lock), §6.1 (plugin API routes), §9.2 (install dialog wireframe)
- The refactoring of SkillRow → ExtensionRow is a Phase 2 concern since plugins share the same row pattern. Phase 1's SkillRow.tsx should be renamed/refactored.
- Plugin-store.ts should follow skill-store.ts exactly for the shared operations (install, enable, disable, uninstall) and add plugin-specific methods (activate, rollback)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-plugin-management*
*Context gathered: 2026-04-04*
