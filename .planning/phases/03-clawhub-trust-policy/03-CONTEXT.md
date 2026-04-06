# Phase 3: ClawHub & Trust Policy - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

ClawHub marketplace catalog search via gateway RPC, trust signal display, deny-by-default enforcement (bundled/verified=allow, community/unscanned=block), admin trust override with credential-access consent + audit trail, version pinning (lockedVersion + integrityHash SHA-512) on install, integrity verification on reinstall, and explicit upgrade workflow.

</domain>

<decisions>
## Implementation Decisions

### ClawHub API Integration
- Access via gateway RPC proxy (e.g., `clawhub.search`, `clawhub.info`) — NOT direct HTTP from Aquarium server
- When instance is stopped: ClawHub catalog unavailable, same as bundled catalog ("Start instance to browse marketplace")
- Merged catalog: bundled + ClawHub results combined in one list, sorted by relevance. Bundled items have "Bundled" badge, ClawHub items have trust badges. Search and category filter apply to both.
- Pagination: load first 20 results, "Load more" button fetches next page via RPC

### Trust Enforcement UX
- Blocked extensions (community/unscanned): visible in catalog but grayed out with lock icon. Status text: "Blocked — community extension" or "Blocked — security scan failed." No Install button. Admin sees "Override" link.
- Admin trust override: inline on the blocked row. Click "Request Override" → credential-access consent dialog (PRD §10.2) → reason text field → "Approve" button. Row becomes installable.
- Audit trail: visible in the extension's configure panel (gear icon). Shows "Admin-approved by [user] on [date]: [reason]" alongside credentials.
- Trust signal badges: icon + text badges inline on catalog rows, aligned right after description. Badges: ✓ Verified (green), Bundled (blue), shield icon + "Scanned" (green/red), download count, age.

### Version Pinning UX
- Version + hash display: in the configure panel (gear icon). Shows: "Version: 1.3.2 (pinned)", "Integrity: sha512-abc...def (truncated)". Plus "Check for Updates" button.
- Upgrade flow: "Check for Updates" in configure panel → queries ClawHub via RPC for latest version → if newer: shows diff (current v1.3.2 → latest v1.4.0) with "Upgrade" button. Upgrade re-pins + re-hashes. Plugin requires restart after upgrade.
- Integrity mismatch error: extension goes to "failed" state with specific error: "Integrity mismatch — registry returned different artifact for v1.3.2. Possible supply-chain tampering. Contact the extension publisher." Red alert banner.

### Carrying Forward from Prior Phases
- Shared catalog search + category filter (Phase 2) — extend to include ClawHub results
- InstallDialog (Phase 2) — extend with trust summary section
- ExtensionRow/CatalogExtensionRow (Phase 2) — extend with trust badges + blocked state
- CredentialConfigPanel (Phase 1/2) — extend with version info + audit trail
- DB-only fenced mutation lock — reused for all trust-related mutations
- Plugin-store/skill-store install flows — extend to pin version + hash after successful install

### Claude's Discretion
- ClawHub RPC method names and response shapes (depend on actual gateway API)
- Trust badge icon choices and exact colors within Oxide CSS variables
- "Load more" pagination implementation (offset-based vs cursor)
- Integrity hash computation timing (on install vs async after install)
- Upgrade flow details for skills vs plugins (plugins need restart, skills don't)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gateway-rpc.ts`: GatewayRPCClient.call() — use for `clawhub.search`, `clawhub.info` RPC
- `skill-store.ts` / `plugin-store.ts`: Install flows — extend with version pinning + hash computation
- `CatalogExtensionRow.tsx`: Catalog row — extend with trust badges, blocked state, override link
- `CredentialConfigPanel.tsx`: Configure panel — extend with version info, audit trail, upgrade button
- `InstallDialog.tsx`: Install dialog — extend with trust summary section
- `ExtensionsTab.tsx`: Catalog search/filter — extend to merge ClawHub results with bundled

### Established Patterns
- Gateway RPC for all gateway-side operations (Phase 1/2 pattern)
- Combined catalog list with search + category filter (Phase 2)
- Inline actions on compact rows (toggle, gear, uninstall — Phase 1)
- Modal dialogs for confirmations (ConfirmRestartDialog, RollbackModal — Phase 2)
- Alert banners for failed/degraded extensions (Phase 1)

### Integration Points
- `marketplace-client.ts` (new service): Wraps gateway RPC for ClawHub queries, adds pagination, caching
- `trust-store.ts` (new service): Trust override CRUD + audit log
- `routes/trust-overrides.ts` (new route): PUT endpoints for plugin + skill trust overrides
- `instance_plugins` / `instance_skills` tables: Add `locked_version` + `integrity_hash` columns (migration 037)
- ExtensionsTab: Merge ClawHub catalog data source alongside bundled RPC data

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — §10.2 (trust tiers + admin override), §11.2 (version pinning), §6.1/6.2 (trust-override API routes)
- The credential-access consent dialog text must match PRD §10.2 verbatim: "This community extension runs in-process with the gateway and will have access to all credentials on this instance, including API keys for other extensions. Only approve if you trust the publisher and have reviewed the source code."
- Trust override API requires `credentialAccessAcknowledged: true` flag per PRD — rejected without it

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-clawhub-trust-policy*
*Context gathered: 2026-04-04*
