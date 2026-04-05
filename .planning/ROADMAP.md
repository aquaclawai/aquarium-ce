# Roadmap: Aquarium CE — Plugin & Skill Marketplace

## Milestones

- ✅ **v1.0 Core** - Phases 1-N (shipped -- existing codebase)
- ✅ **v1.1 Plugin & Skill Marketplace** - Phases 1-6 (shipped 2026-04-04)
- ✅ **v1.2 Gateway Simplification & Plugin Fixes** - Phases 7-8 (shipped 2026-04-05)
- 🚧 **v1.3 Gateway Communication Overhaul** - Phases 9-13 (in progress)

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

<details>
<summary>v1.2 Gateway Simplification & Plugin Fixes (Phases 7-8) -- SHIPPED 2026-04-05</summary>

- [x] **Phase 7: Plugin & Extension Fixes** - Fix method conflicts causing empty catalog, config corruption in plugin install, backend graceful degradation, and frontend response/format mismatches (completed 2026-04-05)
- [x] **Phase 8: Gateway Simplification** - Remove TCP proxy injection and simplify Docker entrypoint to use native gateway capabilities (completed 2026-04-05)

### Phase 7: Plugin & Extension Fixes
**Goal**: The Extensions tab works correctly end-to-end -- Available catalog loads after restart, plugin install does not corrupt config, unsupported RPC methods degrade gracefully, and frontend correctly handles response shapes and install parameters
**Depends on**: Phase 6 (v1.1 complete)
**Requirements**: SIMP-02, PLUGFIX-01, PLUGFIX-02, PLUGFIX-03, FRONT-01, FRONT-02, FRONT-03
**Plans:** 2/2 plans complete

Plans:
- [x] 07-01-PLAN.md -- Remove conflicting RPC methods from platform-bridge plugin (root cause fix for empty catalog + config corruption)
- [x] 07-02-PLAN.md -- Backend graceful RPC degradation + frontend response shape and install param fixes

### Phase 8: Gateway Simplification
**Goal**: The platform uses the official OpenClaw gateway's native network binding and entrypoint instead of injecting a TCP proxy and custom startup logic
**Depends on**: Phase 7
**Requirements**: SIMP-01, SIMP-03
**Plans:** 1/1 plans complete

Plans:
- [x] 08-01-PLAN.md -- Remove TCP proxy injection from docker.ts, confirm entrypoint minimality

</details>

### v1.3 Gateway Communication Overhaul (In Progress)

**Milestone Goal:** Redesign platform-to-gateway communication so the gateway is the source of truth when containers are running, replacing the current DB-first pattern with gateway-first operations and reconnect-driven state sync.

- [ ] **Phase 9: RPC Consolidation** - Route all gateway RPC through the persistent WebSocket client, eliminating ephemeral connections
- [x] **Phase 10: Config Lifecycle** - Gateway-first config updates via config.patch with baseHash concurrency, rate limiting, and correct merge-patch format (completed 2026-04-05)
- [x] **Phase 11: Restart Cycle & State Sync** - Shutdown event handling, reconnect-driven state reconciliation, and RPC queueing during disconnect windows (completed 2026-04-05)
- [x] **Phase 12: Extension Operations** - Plugin activate/deactivate and skill configure via config.patch with batching, post-restart verification, and rollback (completed 2026-04-05)
- [ ] **Phase 13: Health Integration** - Gateway HTTP /ready polling, WS ping/pong liveness, and gateway-authoritative config integrity checks

## Phase Details

### Phase 9: RPC Consolidation
**Goal**: All gateway communication flows through a single persistent WebSocket connection per instance, with correct client identity and graceful handling of connection gaps
**Depends on**: Phase 8 (v1.2 complete)
**Requirements**: RPC-01, RPC-02, RPC-03, RPC-04, RPC-05
**Success Criteria** (what must be TRUE):
  1. Every gateway RPC call (config, tools, skills, extensions) goes through the persistent WebSocket connection -- no code path creates an ephemeral `GatewayRPCClient` for a running instance
  2. When the persistent connection drops and reconnects, any RPC calls made during the gap are automatically retried after reconnection (not silently lost)
  3. Extension lifecycle reconciliation and catalog queries at boot time use the persistent client, not a throwaway connection
  4. The gateway sees all platform connections identified as the correct client ID -- no `openclaw-control-ui` or mismatched IDs appear in gateway logs
  5. All call sites that previously used `plugins.list` now use `tools.catalog` and `config.get` to query extension state
**Plans:** 2 plans

Plans:
- [ ] 09-01-PLAN.md -- Queue-on-disconnect infrastructure, gatewayCall facade, extractPluginPresence utility
- [ ] 09-02-PLAN.md -- Migrate all 24 call sites, replace plugins.list with tools.catalog, remove GatewayRPCClient

### Phase 10: Config Lifecycle
**Goal**: Config mutations for running instances operate on the gateway first and sync results back to DB, with correct merge-patch format, optimistic concurrency, and rate-limit enforcement
**Depends on**: Phase 9
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07
**Success Criteria** (what must be TRUE):
  1. When a user changes config on a running instance, the platform sends `config.patch` to the gateway first -- if the gateway rejects or is unreachable, the operation fails visibly (no silent DB-only write)
  2. When a user changes config on a stopped instance, the change writes to DB only and takes effect on next start (no attempt to reach a non-existent gateway)
  3. Config patches use the `{ raw: "<json5>" }` merge-patch format with a valid `baseHash` -- stale-hash conflicts are retried automatically (up to 3 times with re-read)
  4. Multiple config changes within a short window are batched into a single `config.patch` call, never exceeding 3 writes per 60 seconds per instance
  5. After a successful `config.patch`, the platform reads back the actual config from the gateway via `config.get` and persists it to DB -- the DB never contains a config the gateway has not confirmed
**Plans:** 2/2 plans complete

Plans:
- [ ] 10-01-PLAN.md -- Gateway-first patchGatewayConfig with retry/rate-limit/hash-readback, fix extension-credentials config.patch format
- [ ] 10-02-PLAN.md -- Convert updateSecurityProfile and channels.ts reseedAndPatch to use patchGatewayConfig

### Phase 11: Restart Cycle & State Sync
**Goal**: The platform correctly handles gateway restarts triggered by config changes -- detecting shutdown, maintaining connection continuity, and reconciling actual gateway state with DB records after every reconnect
**Depends on**: Phase 10
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05
**Success Criteria** (what must be TRUE):
  1. When a config.patch triggers a gateway SIGUSR1 restart, the instance shows "restarting" status in the dashboard (not "stopped" or "error") and the platform does not raise alerts during the expected restart window
  2. After the gateway reconnects following a restart, the platform queries `config.get`, `tools.catalog`, and `skills.status` and updates DB records to match actual gateway state -- no stale DB entries persist
  3. Extension reconciliation runs on every WebSocket reconnect (not just server boot), promoting or demoting plugin/skill status based on what the gateway actually reports
  4. After a config.patch that adds or removes plugins, the platform verifies the operation succeeded by checking `tools.catalog` post-restart -- it does not assume success based on the patch response alone
  5. The persistent WebSocket auto-reconnects after any gateway restart with exponential backoff, and full state reconciliation completes before the instance is marked "running" again
**Plans:** 2/2 plans complete

Plans:
- [ ] 11-01-PLAN.md -- Restarting status type, shutdown event handling, exponential backoff, health monitor exclusion, frontend status badge
- [ ] 11-02-PLAN.md -- Post-reconnect syncGatewayState orchestrator, workspace sync via gateway RPC, reconciliation wiring

### Phase 12: Extension Operations
**Goal**: Plugin and skill lifecycle operations use config.patch instead of full container restarts, with batched writes respecting rate limits and verified outcomes replacing optimistic status updates
**Depends on**: Phase 10, Phase 11
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06
**Success Criteria** (what must be TRUE):
  1. Activating or deactivating a plugin sends a `config.patch` to modify the gateway config in-place -- the Docker container is NOT stopped/recreated, and active chat sessions survive the operation
  2. When a user installs multiple plugins at once, all plugin config changes are batched into a single `config.patch` call -- the gateway restarts once (not once per plugin) and only one rate-limit slot is consumed
  3. After a plugin operation triggers a gateway restart, the dashboard shows the plugin as "restarting" until `tools.catalog` confirms it loaded, then transitions to "active" -- or marks it "failed" if the plugin is absent from the catalog
  4. When post-restart verification shows a plugin failed to load, the platform marks it as `failed` in DB and provides a rollback option that removes the failed plugin entry via another `config.patch`
  5. Skill enable/disable/configure operations use `config.patch` and take effect without a gateway restart -- the skill status updates immediately based on the patch response
**Plans:** 3/3 plans complete

Plans:
- [x] 12-01-PLAN.md -- waitForReconnect infrastructure, plugin merge-patch builders, refactor plugin-store.ts to use config.patch
- [x] 12-02-PLAN.md -- Refactor skill enable/disable to use patchGatewayConfig with skills.status verification
- [ ] 12-03-PLAN.md -- Multi-plugin batch activation: buildBatchPluginPatch + activatePluginsBatch + batch-activate endpoint (gap closure for EXT-03)

### Phase 13: Health Integration
**Goal**: The health monitor uses gateway-native signals (HTTP readiness and WebSocket liveness) alongside Docker container checks, and config integrity verification uses the gateway's authoritative state instead of fighting its file normalization
**Depends on**: Phase 9
**Requirements**: HLTH-01, HLTH-02, HLTH-03, HLTH-04
**Success Criteria** (what must be TRUE):
  1. The health monitor polls the gateway's HTTP `/ready` endpoint and surfaces degraded gateway subsystems (from the `failing` array) in the dashboard -- even when the Docker container reports "healthy"
  2. The persistent WebSocket uses ping/pong frames to detect gateway unresponsiveness independently of network-level TCP keepalive -- a gateway that stops responding to pings is flagged within 60 seconds
  3. Config integrity checks compare the gateway's authoritative config hash (from `config.get`) against the DB record -- hash mismatches update the DB to match the gateway (not the other way around)
  4. The config integrity check never triggers `reseedConfigFiles` for a running instance -- the infinite reseed loop caused by gateway config normalization is eliminated
**Plans**: TBD

Plans:
- [ ] 13-01: TBD
- [ ] 13-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 9 -> 10 -> 11 -> 12 -> 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Skill Management | v1.1 | 7/7 | Complete | 2026-04-03 |
| 2. Plugin Management | v1.1 | 4/4 | Complete | 2026-04-04 |
| 3. ClawHub & Trust Policy | v1.1 | 5/5 | Complete | 2026-04-04 |
| 4. Template Portability | v1.1 | 3/3 | Complete | 2026-04-04 |
| 5. OAuth & Advanced Auth | v1.1 | 4/4 | Complete | 2026-04-04 |
| 6. Offline Resilience | v1.1 | 1/1 | Complete | 2026-04-04 |
| 7. Plugin & Extension Fixes | v1.2 | 2/2 | Complete | 2026-04-05 |
| 8. Gateway Simplification | v1.2 | 1/1 | Complete | 2026-04-05 |
| 9. RPC Consolidation | v1.3 | 0/2 | Not started | - |
| 10. Config Lifecycle | v1.3 | 2/2 | Complete | 2026-04-05 |
| 11. Restart Cycle & State Sync | v1.3 | 2/2 | Complete | 2026-04-05 |
| 12. Extension Operations | 3/3 | Complete   | 2026-04-05 | - |
| 13. Health Integration | v1.3 | 0/? | Not started | - |
