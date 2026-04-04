# Roadmap: Aquarium CE — Plugin & Skill Marketplace

## Milestones

- ✅ **v1.0 Core** - Phases 1-N (shipped -- existing codebase)
- ✅ **v1.1 Plugin & Skill Marketplace** - Phases 1-6 (shipped 2026-04-04)
- 🚧 **v1.2 Gateway Simplification & Plugin Fixes** - Phases 7-8 (in progress)

## Phases

<details>
<summary>v1.1 Plugin & Skill Marketplace (Phases 1-6) -- SHIPPED 2026-04-04</summary>

- [x] **Phase 1: Skill Management** - DB schema, state machine, fenced locking, skill install/configure/enable/disable/uninstall, and Extensions tab UI (completed 2026-04-03)
- [x] **Phase 2: Plugin Management** - Plugin install/activate/enable/disable/uninstall with gateway restart flow and credential configuration UI (completed 2026-04-04)
- [x] **Phase 3: ClawHub & Trust Policy** - ClawHub catalog search, trust signals, deny-by-default enforcement, admin overrides, version pinning (completed 2026-04-04)
- [x] **Phase 4: Template Portability** - Export/import with new extension tables, config scrubbing, trust re-evaluation, 3-phase startup (completed 2026-04-04)
- [x] **Phase 5: OAuth & Advanced Auth** - OAuth proxy flow, token export exclusion, SecretRef vault integration (completed 2026-04-04)
- [x] **Phase 6: Offline Resilience** - Plugin artifact caching for air-gapped and restart rebuild recovery (completed 2026-04-04)

### Phase 1: Skill Management
**Goal**: Users can install, configure, enable/disable, and uninstall skills from the Extensions tab, with the platform reliably persisting state across restarts using fenced concurrency
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, SKILL-06, SKILL-07, UI-01, UI-05, UI-06, UI-07
**Plans:** 7/7 plans complete

Plans:
- [x] 01-01-PLAN.md -- Shared types, DB migration (3 tables), serverSessionId
- [x] 01-02-PLAN.md -- Extension lock service, skill store service (lifecycle CRUD)
- [x] 01-03-PLAN.md -- Skills REST API routes, extension credentials route
- [x] 01-04-PLAN.md -- Boot reconciliation, orphan recovery, adapter integration
- [x] 01-05-PLAN.md -- Extensions tab UI, sub-tabs, skill list/catalog, i18n
- [x] 01-06-PLAN.md -- Credential config panel, alert banners, visual checkpoint

### Phase 2: Plugin Management
**Goal**: Users can install, activate, configure credentials for, enable/disable, and uninstall plugins from the bundled catalog, with gateway restart handled automatically and rollback on failure
**Depends on**: Phase 1
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07, PLUG-08, PLUG-09, PLUG-10, UI-02, UI-03, UI-04
**Plans:** 4/4 plans complete

Plans:
- [x] 02-01-PLAN.md -- Plugin store service (install/activate/rollback/enable/disable/uninstall), seedConfig extension, reconciliation, PLUG-10
- [x] 02-02-PLAN.md -- Plugin REST API routes (list, catalog, install, activate, toggle, uninstall)
- [x] 02-03-PLAN.md -- Shared ExtensionRow/CatalogExtensionRow refactor, plugin list + catalog UI in Plugins sub-tab
- [x] 02-04-PLAN.md -- Search/filter, install dialog, restart banner, rollback modal, i18n, visual checkpoint

### Phase 3: ClawHub & Trust Policy
**Goal**: Users can search the live ClawHub marketplace with trust signals visible, with community extensions blocked by default and admins able to grant verified overrides
**Depends on**: Phase 2
**Requirements**: TRUST-01, TRUST-02, TRUST-03, TRUST-04, TRUST-05, TRUST-06, TRUST-07
**Plans:** 5/5 plans complete

Plans:
- [x] 03-01-PLAN.md -- Shared trust types, DB migration (trust_overrides table), trust-store service
- [x] 03-02-PLAN.md -- Marketplace client service, version pinning + integrity hash in install flows
- [x] 03-03-PLAN.md -- Trust-override API routes, catalog ClawHub merging, upgrade endpoints
- [x] 03-04-PLAN.md -- Trust badges UI, blocked extension display, override dialog, catalog merging, i18n
- [x] 03-05-PLAN.md -- Version info + upgrade in config panel, integrity mismatch alerts, visual checkpoint

### Phase 4: Template Portability
**Goal**: Template export captures the full plugin/skill setup from the new extension tables with secrets scrubbed, and template import re-evaluates trust for each extension against current ClawHub metadata
**Depends on**: Phase 3
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05, TMPL-06, TMPL-07, TMPL-08
**Plans:** 3/3 plans complete

Plans:
- [x] 04-01-PLAN.md -- Template export: extension lifecycle table reads, config scrubbing, workspace allowlist + secret scanning, local skill rejection
- [x] 04-02-PLAN.md -- 3-phase startup: seedConfig skills support, Phase 3 pending replay in startInstanceAsync
- [x] 04-03-PLAN.md -- Template import: trust re-evaluation, lifecycle row insertion, blocked extension handling

### Phase 5: OAuth & Advanced Auth
**Goal**: Users can authenticate plugins requiring OAuth via the platform's browser proxy flow, and OAuth tokens are excluded from template exports
**Depends on**: Phase 4
**Requirements**: OAUTH-01, OAUTH-02, OAUTH-03
**Plans:** 4/4 plans complete

Plans:
- [x] 05-01-PLAN.md -- OAuth proxy route (initiate/callback/status), requiresReAuth type + export/import logic
- [x] 05-02-PLAN.md -- Vault config API (CRUD endpoints), exec SecretRef resolution in seedConfig
- [x] 05-03-PLAN.md -- OAuth connect button, vault source toggle, VaultConfigSection, i18n, visual checkpoint

### Phase 6: Offline Resilience
**Goal**: Plugin artifacts are cached locally so gateway restarts and air-gapped deployments can rebuild installed plugins without hitting the external registry
**Depends on**: Phase 5
**Requirements**: OFFLINE-01, OFFLINE-02
**Plans:** 1/1 plans complete

Plans:
- [x] 06-01-PLAN.md -- Artifact cache service, cache-after-install in plugin/skill stores, cache-preferred replay, UI cached indicator, i18n

</details>

### 🚧 v1.2 Gateway Simplification & Plugin Fixes (In Progress)

**Milestone Goal:** Remove redundant CE-specific workarounds now that the official OpenClaw gateway supports them natively, and fix plugin/extension bugs found during v1.1 testing.

- [ ] **Phase 7: Plugin & Extension Fixes** - Fix method conflicts causing empty catalog, config corruption in plugin install, backend graceful degradation, and frontend response/format mismatches
- [ ] **Phase 8: Gateway Simplification** - Remove TCP proxy injection and simplify Docker entrypoint to use native gateway capabilities

## Phase Details

### Phase 7: Plugin & Extension Fixes
**Goal**: The Extensions tab works correctly end-to-end -- Available catalog loads after restart, plugin install does not corrupt config, unsupported RPC methods degrade gracefully, and frontend correctly handles response shapes and install parameters
**Depends on**: Phase 6 (v1.1 complete)
**Requirements**: SIMP-02, PLUGFIX-01, PLUGFIX-02, PLUGFIX-03, FRONT-01, FRONT-02, FRONT-03
**Success Criteria** (what must be TRUE):
  1. After a gateway restart, the Available catalog in the Extensions tab shows the full list of bundled skills and plugins (not empty)
  2. Installing a plugin via the dashboard does not add non-existent paths to the gateway config or corrupt the config file
  3. When the gateway does not support `skills.list` or `plugins.list` RPC methods, the Extensions tab shows an empty list with no error instead of a 500 response
  4. The Extensions tab catalog endpoints return data that the frontend correctly renders without shape or format errors (no console errors about unexpected response types)
  5. Installing a skill or plugin from ClawHub sends the correct source format that the gateway's native handlers accept
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Gateway Simplification
**Goal**: The platform uses the official OpenClaw gateway's native network binding and entrypoint instead of injecting a TCP proxy and custom startup logic
**Depends on**: Phase 7
**Requirements**: SIMP-01, SIMP-03
**Success Criteria** (what must be TRUE):
  1. New instances start with `gateway.bind: lan` in their config and are accessible from the Aquarium server without any TCP proxy process
  2. The custom Docker entrypoint only injects the platform-bridge plugin path, delegating all directory setup, permission management, and config initialization to the official OpenClaw entrypoint
  3. Existing running instances continue to work after upgrade (no breaking change to instance configs already deployed)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Skill Management | v1.1 | 7/7 | Complete | 2026-04-03 |
| 2. Plugin Management | v1.1 | 4/4 | Complete | 2026-04-04 |
| 3. ClawHub & Trust Policy | v1.1 | 5/5 | Complete | 2026-04-04 |
| 4. Template Portability | v1.1 | 3/3 | Complete | 2026-04-04 |
| 5. OAuth & Advanced Auth | v1.1 | 4/4 | Complete | 2026-04-04 |
| 6. Offline Resilience | v1.1 | 1/1 | Complete | 2026-04-04 |
| 7. Plugin & Extension Fixes | v1.2 | 0/? | Not started | - |
| 8. Gateway Simplification | v1.2 | 0/? | Not started | - |
