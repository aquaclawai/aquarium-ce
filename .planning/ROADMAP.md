# Roadmap: Aquarium CE — Plugin & Skill Marketplace

## Milestones

- ✅ **v1.0 Core** - Phases 1-N (shipped — existing codebase)
- 🚧 **v1.1 Plugin & Skill Marketplace** - Phases 1-6 (in progress)

## Phases

### 🚧 v1.1 Plugin & Skill Marketplace (In Progress)

**Milestone Goal:** Full plugin/skill lifecycle management — browsing catalogs, installing with fenced concurrency, deny-by-default trust, template portability, OAuth proxy auth, and offline resilience.

- [x] **Phase 1: Skill Management** - DB schema, state machine, fenced locking, skill install/configure/enable/disable/uninstall, and Extensions tab UI (completed 2026-04-03)
- [ ] **Phase 2: Plugin Management** - Plugin install/activate/enable/disable/uninstall with gateway restart flow and credential configuration UI
- [ ] **Phase 3: ClawHub & Trust Policy** - ClawHub catalog search, trust signals, deny-by-default enforcement, admin overrides, version pinning
- [ ] **Phase 4: Template Portability** - Export/import with new extension tables, config scrubbing, trust re-evaluation, 3-phase startup
- [ ] **Phase 5: OAuth & Advanced Auth** - OAuth proxy flow, token export exclusion, SecretRef vault integration
- [ ] **Phase 6: Offline Resilience** - Plugin artifact caching for air-gapped and restart rebuild recovery

## Phase Details

### Phase 1: Skill Management
**Goal**: Users can install, configure, enable/disable, and uninstall skills from the Extensions tab, with the platform reliably persisting state across restarts using fenced concurrency
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, SKILL-06, SKILL-07, UI-01, UI-05, UI-06, UI-07
**Success Criteria** (what must be TRUE):
  1. User can open an instance and see an Extensions tab with Skills and Plugins sub-tabs
  2. User can browse the bundled skills catalog and install a skill with one click
  3. User can configure extension-scoped credentials for a skill that requires them
  4. User can enable, disable, and uninstall an installed skill
  5. After an instance restart, previously active skills are restored and dashboard alerts surface any failed or degraded extensions
**Plans:** 7/7 plans complete

Plans:
- [x] 01-01-PLAN.md — Shared types, DB migration (3 tables), serverSessionId
- [x] 01-02-PLAN.md — Extension lock service, skill store service (lifecycle CRUD)
- [x] 01-03-PLAN.md — Skills REST API routes, extension credentials route
- [x] 01-04-PLAN.md — Boot reconciliation, orphan recovery, adapter integration
- [x] 01-05-PLAN.md — Extensions tab UI, sub-tabs, skill list/catalog, i18n
- [x] 01-06-PLAN.md — Credential config panel, alert banners, visual checkpoint

### Phase 2: Plugin Management
**Goal**: Users can install, activate, configure credentials for, enable/disable, and uninstall plugins from the bundled catalog, with gateway restart handled automatically and rollback on failure
**Depends on**: Phase 1
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07, PLUG-08, PLUG-09, PLUG-10, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. User can browse the bundled plugins catalog and install a plugin artifact
  2. User can configure extension-scoped credentials via the gear icon panel before activating
  3. User can activate a plugin and the gateway restarts automatically with a health check
  4. When plugin activation fails, the gateway rolls back and the extension is marked failed rather than leaving the gateway broken
  5. User can enable, disable, and uninstall an installed plugin
**Plans:** 4 plans

Plans:
- [ ] 02-01-PLAN.md — Plugin store service (install/activate/rollback/enable/disable/uninstall), seedConfig extension, reconciliation, PLUG-10
- [ ] 02-02-PLAN.md — Plugin REST API routes (list, catalog, install, activate, toggle, uninstall)
- [ ] 02-03-PLAN.md — Shared ExtensionRow/CatalogExtensionRow refactor, plugin list + catalog UI in Plugins sub-tab
- [ ] 02-04-PLAN.md — Search/filter, install dialog, restart banner, rollback modal, i18n, visual checkpoint

### Phase 3: ClawHub & Trust Policy
**Goal**: Users can search the live ClawHub marketplace with trust signals visible, with community extensions blocked by default and admins able to grant verified overrides
**Depends on**: Phase 2
**Requirements**: TRUST-01, TRUST-02, TRUST-03, TRUST-04, TRUST-05, TRUST-06, TRUST-07
**Success Criteria** (what must be TRUE):
  1. User can search ClawHub for plugins and skills by name or category and see results with trust signals (verified badge, download count, age, VirusTotal status)
  2. Attempting to install a community or unscanned extension is blocked at the UI level with an explanation
  3. An admin can override a community extension after reviewing the credential-access consent dialog, and the override is recorded in the audit trail
  4. An installed extension's version and SHA-512 hash are pinned in the DB, and a reinstall attempt that returns a different hash for the same version is rejected
  5. User can explicitly upgrade an extension to the latest version with re-pinning and re-hashing
**Plans:** 5 plans

Plans:
- [ ] 03-01-PLAN.md — Shared trust types, DB migration (trust_overrides table), trust-store service
- [ ] 03-02-PLAN.md — Marketplace client service, version pinning + integrity hash in install flows
- [ ] 03-03-PLAN.md — Trust-override API routes, catalog ClawHub merging, upgrade endpoints
- [ ] 03-04-PLAN.md — Trust badges UI, blocked extension display, override dialog, catalog merging, i18n
- [ ] 03-05-PLAN.md — Version info + upgrade in config panel, integrity mismatch alerts, visual checkpoint

### Phase 4: Template Portability
**Goal**: Template export captures the full plugin/skill setup from the new extension tables with secrets scrubbed, and template import re-evaluates trust for each extension against current ClawHub metadata
**Depends on**: Phase 3
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05, TMPL-06, TMPL-07, TMPL-08
**Success Criteria** (what must be TRUE):
  1. Exporting an instance template includes all active, installed, disabled, and degraded extensions with credential placeholders replacing any secrets
  2. A template export with local skills that contain scripts/ or assets/ directories is rejected with a clear error
  3. Importing a template re-evaluates each extension's trust against ClawHub — blocked extensions are skipped with a warning rather than silently imported
  4. The platform uses 3-phase startup: loads active config first, then reconciles boot state, then replays pending installs
**Plans**: TBD

### Phase 5: OAuth & Advanced Auth
**Goal**: Users can authenticate plugins requiring OAuth via the platform's browser proxy flow, and OAuth tokens are excluded from template exports
**Depends on**: Phase 4
**Requirements**: OAUTH-01, OAUTH-02, OAUTH-03
**Success Criteria** (what must be TRUE):
  1. User can authenticate an OAuth-requiring plugin by clicking a link in the dashboard that opens a browser redirect flow and returns the token to the platform
  2. Exported templates do not contain OAuth tokens — those extensions are flagged with requiresReAuth so the importer knows re-authentication is needed
  3. User can configure a SecretRef vault integration (1Password or HashiCorp Vault) and have credentials resolve from the vault at activation time
**Plans**: TBD

### Phase 6: Offline Resilience
**Goal**: Plugin artifacts are cached locally so gateway restarts and air-gapped deployments can rebuild installed plugins without hitting the external registry
**Depends on**: Phase 5
**Requirements**: OFFLINE-01, OFFLINE-02
**Success Criteria** (what must be TRUE):
  1. After a plugin is successfully installed, its artifact is cached under ~/.openclaw/plugin-cache/
  2. When the gateway rebuilds after a restart, the platform prefers the cached artifact over the registry and only falls back to the registry if the cache is missing
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Skill Management | 7/7 | Complete   | 2026-04-04 | - |
| 2. Plugin Management | v1.1 | 0/4 | Planning complete | - |
| 3. ClawHub & Trust Policy | v1.1 | 0/5 | Planning complete | - |
| 4. Template Portability | v1.1 | 0/TBD | Not started | - |
| 5. OAuth & Advanced Auth | v1.1 | 0/TBD | Not started | - |
| 6. Offline Resilience | v1.1 | 0/TBD | Not started | - |
