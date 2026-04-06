# Phase 1: Skill Management - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

DB schema (instance_plugins, instance_skills, extension_operations), extension lifecycle state machine, fenced mutation lock, skill install/configure/enable/disable/uninstall, and Extensions tab UI with skills sub-tab. Bundled skills catalog only (ClawHub integration is Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Extensions Tab Layout
- Tab position: After Chat, before Agent Management — in the main tabs (not ADVANCED_TABS)
- Tab ID: `'extensions'` added to InstancePage.tsx TabId type
- Sub-tabs: Toggle buttons (pill/segmented control) at top of tab content — Plugins | Skills
- Content layout: Single page with two sections — Installed at top, Available catalog below
- Visibility: Always visible even when instance is stopped — installed list shows from DB, catalog shows "Start instance to browse available extensions" message, all mutation actions are disabled
- Loading: Skeleton loading cards while fetching + manual refresh icon button
- No client-side caching — always fresh RPC fetch on tab open

### Bundled Catalog Source
- Fetch via `skills.list` RPC to gateway each time the Extensions tab opens (when instance is running)
- When instance is stopped: show installed extensions from DB only, hide catalog with a message
- Claude's Discretion: Exact behavior for stopped-state catalog section (message vs hiding)

### Skill Card Design
- Visual style: Compact rows (not card tiles) — one row per skill
- Installed row: icon | name | description (truncated) | colored dot + status text | toggle switch | gear icon | uninstall X
- Status display: Small colored dot (green=active, yellow=installed/degraded, red=failed, gray=disabled) + status text
- Catalog row: icon | name | description | "Bundled" source badge | key icon with "Requires API key" if skill needs credentials | Install button
- Actions inline on row: enable/disable toggle, gear icon (opens credential config panel), uninstall X icon

### Service Layer Structure
- Separate files: `skill-store.ts` (skill CRUD), `extension-lock.ts` (mutation lock + fencing), `extension-lifecycle.ts` (state machine transitions)
- Lock shared between skills and plugins (Phase 2 reuses extension-lock.ts)
- `server_session_id` (UUID) generated in `config.ts` on startup, available via `config.serverSessionId`
- Extension credentials: new `routes/extension-credentials.ts` route (separate from existing credentials.ts)
- Mutation lock: DB-only via INSERT conflict on `extension_operations` partial unique index — no in-memory mutex. INSERT attempt with `completed_at IS NULL` on same `instance_id` → unique constraint violation → 409 Conflict. Simpler than PRD's in-memory + DB approach, survives server restarts, and the partial unique index handles the concurrency guarantee.

### Claude's Discretion
- Exact skeleton loading card dimensions and animation
- Stopped-state catalog section (message text, visual treatment)
- Error state handling for failed RPC calls
- Exact spacing and typography within CSS variable system

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `credential-store.ts`: AES-256-GCM encrypt/decrypt — reuse for extension credential storage
- `gateway-rpc.ts`: GatewayRPCClient with `call(method, params, timeout)` — use for `skills.list`, `skills.install`, `skills.enable`, `config.patch`
- `template-store.ts`: JSONB helpers `parseJsonb<T>()`, `stringifyJsonb()` — reuse for JSON columns
- Existing `routes/skills.ts`: Already has `POST /:id/skills/install` calling `adapter.translateRPC()` — extend this
- `api.ts` (frontend): `api.get<T>()`, `api.post<T>()`, `api.delete<T>()` with `{ ok: true, data }` envelope

### Established Patterns
- Route pattern: `app.use('/api/instances', router)` with `/:id/` prefix
- Service pattern: Export async functions, return typed rows
- Migration pattern: `export async function up(knex)` / `down(knex)`, use `addUuidPrimary()`, `addJsonColumn()`
- Latest migration: 035 — next is 036
- Frontend tabs: `TabId` type union, tab components as separate files with `{ instanceId }` props
- i18n: Nested keys in en.json under namespace (e.g., `instance.tabs.extensions`)
- WebSocket: `subscribe(instanceId)`, `addHandler(type, handler)` for real-time updates
- Status display: Existing instance status uses colored dots + text (e.g., created, running, stopped, error)

### Integration Points
- `InstancePage.tsx`: Add `'extensions'` to TabId union, render ExtensionsTab component
- `server-core.ts` line 157: Already mounts skill routes — extend or add adjacent route for extension-credentials
- `config.ts`: Add `serverSessionId` field, generate UUID on module load
- DB adapter: Use `db.raw()` for partial unique index if Knex schema builder doesn't support it
- `apps/web/src/i18n/locales/`: Add `extensions.*` keys to all 6 locale files

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — §5.2 (skill install flow), §5.4 (3-phase startup), §5.6 (lifecycle state machine), §5.8 (mutation lock), §6.2 (skill API routes), §7.1-7.3 (DB migrations), §10.4 (scoped credential injection)
- DB-only lock (user decision) differs from PRD's in-memory + DB approach — this is simpler and the user explicitly chose it. Implementation should follow the DB-only pattern.
- The existing `routes/skills.ts` already does RPC passthrough for `skills.install` — Phase 1 should extend this file with the full lifecycle API while maintaining the existing install endpoint's behavior

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-skill-management*
*Context gathered: 2026-04-04*
