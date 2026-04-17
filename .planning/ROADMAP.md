# Roadmap: Aquarium CE — Plugin & Skill Marketplace

## Milestones

- ✅ **v1.0 Core** - Phases 1-N (shipped -- existing codebase)
- ✅ **v1.1 Plugin & Skill Marketplace** - Phases 1-6 (shipped 2026-04-04)
- ✅ **v1.2 Gateway Simplification & Plugin Fixes** - Phases 7-8 (shipped 2026-04-05)
- ✅ **v1.3 Gateway Communication Overhaul** - Phases 9-14 (shipped 2026-04-05)
- 🚧 **v1.4 Task Delegation Platform** - Phases 15-26 (in progress, started 2026-04-16)

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
- [x] **Phase 13: Health Integration** - Gateway HTTP /ready polling, WS ping/pong liveness, and gateway-authoritative config integrity checks (completed 2026-04-05)

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
**Plans:** 2/2 plans complete

Plans:
- [x] 13-01-PLAN.md -- WS ping/pong liveness detection in PersistentGatewayClient (HLTH-02)
- [x] 13-02-PLAN.md -- HTTP /ready polling, gateway-authoritative config integrity, eliminate reseedConfigFiles (HLTH-01, HLTH-03, HLTH-04)

### Phase 14: Plugin Cleanup
**Goal**: Remove dead RPC methods from the platform-bridge plugin and replace ClawHub marketplace calls with direct HTTP from the platform, leaving only `platform.ping` and `platform.runtime` in the plugin
**Depends on**: Phase 9
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04
**Success Criteria** (what must be TRUE):
  1. The platform's marketplace-client.ts calls the ClawHub API directly via HTTP (not through gateway RPC) for both search and extension info
  2. The platform-bridge plugin source contains only `platform.ping` and `platform.runtime` method registrations — all other methods (`skills.list`, `plugins.list`, `agents.workspace.init`, `clawhub.search`, `clawhub.info`) are deleted
  3. The gateway loads the plugin without errors after the method removal
  4. ClawHub catalog browsing works end-to-end (search + trust signals + install) with direct HTTP calls
**Plans:** 2/2 plans complete

Plans:
- [x] 14-01-PLAN.md -- Direct HTTP for ClawHub search/info, BUILTIN_REGISTRY fallback, config.ts clawHubApiUrl, route call site updates (CLEAN-01, CLEAN-02)
- [x] 14-02-PLAN.md -- Strip platform-bridge plugin to platform.ping + platform.runtime only (CLEAN-03, CLEAN-04)

## Progress

## v1.4 Task Delegation Platform (Phases 15-26) -- IN PROGRESS 2026-04-16

**Milestone goal:** Transform Aquarium CE into a multica-style task-delegation platform where users assign structured Issues to Agents that execute as Tasks on Runtimes. Runtimes unify platform-hosted Docker instances and user-managed external CLIs (Claude Code, Codex, OpenClaw, OpenCode, Hermes) reached through a local Node.js daemon.

**Phase graph:**
```
15 ──┬──► 16 ──┐
     │         ├──► 18 ──┬──► 19 ──► 21 ──► 22
     └──► 17 ──┘         └──► 20 ────────────┐
                                              │
                       18 ──► 23 ──► 24       │
                       │            │         │
                       └──► 25 ◄────┘         │
                                              │
                     all ──► 26 ◄─────────────┘
```

### Phase 15: Schema & Shared Types
**Goal:** Ship the v1.4 DB foundation — workspace, runtimes, agents, issues, tasks, task_messages, comments, daemon_tokens tables with SQLite concurrency PRAGMAs — so every downstream phase can read/write persistent state without further schema work.
**Depends on:** Nothing (foundation)
**Requirements:** SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07, SCH-08, SCH-09, SCH-10
**Research gate:** SKIP
**Owned pitfalls:** SQ1 (partial), SQ3, SCH1-4, CE1, CE2, ST4
**Success criteria:**
1. `npm run migrate` runs migrations 003 through 007 cleanly against a fresh SQLite DB and leaves schema intact across a restart
2. `PRAGMA journal_mode` returns `wal` and `PRAGMA busy_timeout` returns `5000` after boot; both asserted in a boot-time integrity check
3. Shared types exported from `@aquarium/shared` (Issue/Agent/Runtime/AgentTask/TaskMessage/Comment/DaemonRegisterRequest etc.) typecheck in both server and web workspaces
4. Partial unique index on `agent_task_queue(issue_id, agent_id) WHERE status IN ('queued','dispatched')` rejects a second pending task for the same pair via a direct SQL test

**Plans:** 6/6 plans complete

Plans:
- [x] 15-01-PLAN.md — Boot PRAGMAs (WAL/synchronous/busy_timeout/foreign_keys) + workspaces table + default AQ workspace seed (SCH-01, SCH-09)
- [x] 15-02-PLAN.md — runtimes table with kind discriminator CHECK + daemon_id XOR instance_id trigger + CASCADE FKs + partial index on instance_id (SCH-02)
- [x] 15-03-PLAN.md — agents table with max_concurrent_tasks 1..16 CHECK + custom_env/custom_args + archival + SET NULL on runtime_id (SCH-03)
- [x] 15-04-PLAN.md — issues (6-status, 5-priority, fractional REAL position, monotonic issue_number) + comments (4-type, threaded, XOR author) tables with triggers (SCH-04, SCH-07)
- [x] 15-05-PLAN.md — agent_task_queue (6-status, partial unique index for coalescing queued/dispatched) + task_messages ((task_id,seq) UNIQUE for replay) tables (SCH-05, SCH-06)
- [x] 15-06-PLAN.md — daemon_tokens table (SHA-256 hash storage) + @aquarium/shared v14-types.ts re-exported from index.ts (SCH-08, SCH-10)

### Phase 16: Runtime Registry + Runtime-Bridge
**Goal:** Users can list all runtimes (hosted + daemon) in a single unified view, and the platform automatically mirrors existing Aquarium instances into the new `runtimes` table as `hosted_instance` rows without modifying `InstanceManager`.
**Depends on:** Phase 15
**Requirements:** RT-01, RT-02, RT-03, RT-04, RT-05
**Research gate:** LIGHT — audit InstanceManager event hooks + boot-order race with gateway-event-relay's 10s reconcile cadence
**Owned pitfalls:** ST1, ST4
**Success criteria:**
1. `GET /api/runtimes` returns both existing hosted instances and any registered daemon runtimes with kind / provider / status / device_info / last_heartbeat_at
2. Creating, renaming, archiving, or deleting an Aquarium instance produces a matching insert/update/cascade-delete on its mirror `runtimes` row within 2 seconds
3. `runtime.status` for `kind='hosted_instance'` rows always matches `instances.status` in any READ query (derived via JOIN, never stored)
4. The offline sweeper transitions daemon runtimes missing heartbeats > 90s to `status='offline'` within one sweep tick

**Plans:** 4/4 plans complete

Plans:
- [x] 16-01-PLAN.md — Migration 009 partial-UNIQUE index + services/runtime-registry.ts (listAll derived-status JOIN + UPSERT + heartbeat + offline) (RT-01, RT-04)
- [x] 16-02-PLAN.md — task-dispatch/runtime-bridge.ts hooks + 4 wiring sites in instance-manager.ts (RT-02, RT-03)
- [x] 16-03-PLAN.md — routes/runtimes.ts + task-dispatch/offline-sweeper.ts + server-core.ts boot steps 9a + 9e (RT-01, RT-05)
- [x] 16-04-PLAN.md — tests/e2e/runtimes.spec.ts covering RT-01..RT-05 + ST1 invariant proof

### Phase 17: Agent, Issue & Comment Services
**Goal:** Users can create agents, issues, and comments through REST APIs, with issue status transitions automatically enqueueing/cancelling tasks so assignment acts as the primary trigger for agent work.
**Depends on:** Phase 15 (parallel with Phase 16)
**Requirements:** AGENT-01, AGENT-02, ISSUE-01, ISSUE-02, ISSUE-03, ISSUE-04, ISSUE-05, COMMENT-01, COMMENT-02, COMMENT-03
**Research gate:** SKIP
**Owned pitfalls:** CE1 (pattern enforcement), CE4
**Success criteria:**
1. `POST /api/agents` creates an agent with instructions/custom_env/custom_args/max_concurrent_tasks; `DELETE` archives by setting `archived_at` without breaking FKs
2. Assigning an issue to an agent with `status != 'backlog'` creates exactly one queued task visible in `GET /api/issues/:id`
3. Reassigning an issue cancels the previous pending task and creates a new one for the new assignee without leaving duplicates
4. Moving an issue to `cancelled` transitions all its queued/dispatched/running tasks to `cancelled` in a single transaction
5. Posting a comment with `trigger_comment_id` set enqueues a task with that comment as context; posting a status-change comment appears in the timeline as `type='status_change'`

**Plans:** 5/5 plans complete

Plans:
- [x] 17-01-PLAN.md — Agents service + REST routes (AGENT-01, AGENT-02)
- [x] 17-02-PLAN.md — Issues service + REST routes with fractional reorder (ISSUE-01, ISSUE-05)
- [x] 17-03-PLAN.md — Issue status transitions + task-queue-store enqueue/cancel hooks (ISSUE-02, ISSUE-03, ISSUE-04)
- [x] 17-04-PLAN.md — Comments service + routes + system comments + trigger-comment enqueue (COMMENT-01, COMMENT-02, COMMENT-03)
- [x] 17-05-PLAN.md — Playwright E2E covering AGENT/ISSUE/COMMENT + partial-unique invariant

### Phase 18: Task Queue & Dispatch
**Goal:** Tasks are claimed atomically under SQLite and streamed through a consistent lifecycle with a reaper that handles stale dispatch and orphaned running states, providing the core queue abstraction that daemon and hosted workers share.
**Depends on:** Phase 16, Phase 17
**Requirements:** TASK-01, TASK-02, TASK-03, TASK-04, TASK-05, TASK-06
**Research gate:** NEEDS RESEARCH — confirm knex+better-sqlite3 transaction pool serializes through one writer; measure real claim latency under concurrent daemon-mocked pollers
**Owned pitfalls:** SQ1, SQ2, SQ4, SQ5, ST6, PM5, T4
**Success criteria:**
1. Concurrent claim requests from 20 simulated daemons never produce two tasks with the same (issue_id, agent_id) in `dispatched` status (verified by unit test)
2. `claimTask(runtimeId)` returns exactly one task row or null; per-(issue_id, agent_id) coalescing prevents duplicate dispatch even if enqueued twice
3. `task_messages` batched ingest at 500ms produces strictly monotonic `seq` per task regardless of write interleaving
4. Stale-task reaper fails tasks stuck in `dispatched` > 5 min and `running` > 2.5h within one sweep tick
5. `completeTask` on a task already cancelled returns `{ discarded: true }` with HTTP 200 (not 400) — verified by race-condition test

**Plans:** 4/4 plans complete

Plans:
- [x] 18-01-PLAN.md — Wave 0 test harness + claim + lifecycle + discarded-complete (TASK-01, TASK-02, TASK-06)
- [x] 18-02-PLAN.md — Task-message batcher (500ms flush, MAX(seq)+1 under BEGIN IMMEDIATE) (TASK-03)
- [x] 18-03-PLAN.md — Stale-task reaper + server-core.ts Step 9c boot wiring (TASK-04)
- [x] 18-04-PLAN.md — Cancel surface: task:cancelled broadcasts + CancelResult + issue-store propagation (TASK-05)


### Phase 19: Daemon REST API & Auth
**Goal:** External daemons can register, heartbeat, claim tasks, and report lifecycle events through 9 authenticated REST endpoints; users can issue/revoke daemon tokens through a UI-facing API.
**Depends on:** Phase 18 (parallel with Phase 20)
**Requirements:** DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, DAEMON-07, DAEMON-08, DAEMON-09, DAEMON-10
**Research gate:** LIGHT — verify Express rate-limiter stack supports per-route exemption with per-token bucket
**Owned pitfalls:** AUTH1, AUTH2, AUTH3, AUTH4, AUTH5, CE3
**Success criteria:**
1. Hitting `/api/daemon/register` with a valid `adt_` bearer token returns workspace-scoped runtime IDs; cookie JWT on the same endpoint returns 401
2. Cookie-authenticated user hitting `/api/agents` with an `adt_` bearer token instead of a cookie is rejected with 401 (no privilege confusion)
3. Daemon polling at 1 req/sec for 5 minutes against `/api/daemon/runtimes/:id/tasks/claim` is never blocked by the global 300-req/15-min rate limiter
4. Revoked daemon tokens return 401 on the next request within 1 second (no caching leak)
5. Daemon token creation returns the plaintext token exactly once; subsequent list endpoints show only the last-used timestamp and hashed prefix
**Plans:** 4/4 plans complete

Plans:
- [x] 19-01-PLAN.md — requireDaemonAuth middleware + daemon-token-store service + AUTH1 patch in requireAuth (DAEMON-07, DAEMON-09)
- [x] 19-02-PLAN.md — 9 daemon REST endpoints + rate-limit topology (skip + per-token bucket) (DAEMON-01..06, DAEMON-08)
- [x] 19-03-PLAN.md — 3 user-facing token-management endpoints (plaintext-once contract) (DAEMON-10)
- [x] 19-04-PLAN.md — Playwright E2E spec covering SC-1..SC-5 + full-story happy path


### Phase 20: Hosted-Instance Driver
**Goal:** Tasks assigned to agents whose runtime is a hosted Aquarium instance are automatically dispatched through the existing gateway RPC, with live `chat.send` events translated into `task_message` rows so the UI sees the same streaming shape regardless of runtime kind.
**Depends on:** Phase 18 (parallel with Phase 19)
**Requirements:** HOSTED-01, HOSTED-02, HOSTED-03, HOSTED-04, HOSTED-05, HOSTED-06
**Research gate:** NEEDS RESEARCH — audit OpenClaw gateway WS protocol v3 for existing cancel/abort frame; document hosted-cancel semantics if absent
**Owned pitfalls:** PM6, ST5, X5, X6
**Success criteria:**
1. Assigning an issue to a hosted-instance agent produces `task_message` rows with `type` matching gateway parts (text → text, toolCall → tool_use, toolResult → tool_result, thinking → thinking)
2. With the gateway disconnected, the hosted worker tick leaves the task queued (does not transition to `failed`) and resumes dispatch within 2 seconds of reconnection
3. Killing the server mid-task and restarting fails all in-flight hosted tasks during boot (rather than letting them wait 5 min for the reaper)
4. Hosted task with agent `custom_env` set completes successfully with a WARN log citing `custom_env ignored for hosted_instance runtime`
5. Hosted task dispatch never modifies `instances.status` — verified by spying on `instance-manager.updateStatus` during a full task run

**Plans:** 3/3 plans complete

Plans:
- [x] 20-01-PLAN.md — Gateway-event-relay `registerChatStreamListener` multi-shot hook (infra for HOSTED-03)
- [x] 20-02-PLAN.md — HostedTaskWorker: tick + chat.send + streaming + cancel + ignored-fields WARN (HOSTED-01, HOSTED-02, HOSTED-03, HOSTED-05, HOSTED-06)
- [x] 20-03-PLAN.md — Boot orphan sweep + server-core.ts Step 9b/9d wiring (HOSTED-04)

### Phase 21: Daemon CLI + Claude-Code Backend + Unit Harness
**Goal:** `npx @aquaclawai/aquarium daemon start` runs on macOS/Linux, auto-detects installed `claude` CLI, registers as a runtime, claims tasks, and streams Claude Code stream-json output back to the server with bounded concurrency and clean SIGTERM handling. Establishes the concurrency + testing primitives that Phase 22 extends.
**Depends on:** Phase 19
**Requirements:** CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, BACKEND-01, BACKEND-04, BACKEND-05, BACKEND-06, BACKEND-07
**Research gate:** NEEDS RESEARCH — (a) Windows daemon background-process strategy (accept foreground-only for v1.4 if no clean story); (b) Claude Code `control_request` / `control_response` protocol auto-approval posture
**Owned pitfalls:** PG1, PG2, PG3, PG4, PG5, PG6, PG7, PG8, PG9, PG10, PM1, PM2, PM3, PM4, T1, T2
**Success criteria:**
1. Starting the daemon on a machine with `claude` on PATH produces one `local_daemon` runtime row with `provider='claude'`, version, and `status='online'`
2. A task assigned to that agent is claimed within one poll cycle, executed by spawning `claude --output-format stream-json`, streamed as `task_message` rows at 500 ms batches, and completed within the configured timeout
3. Cancelling a running task propagates SIGTERM → SIGKILL (10 s grace) and leaves no zombie child processes (verified by `pgrep` after cancel)
4. Unhandled promise rejection in the daemon marks the in-flight task as failed, writes `~/.aquarium/daemon.crash.log`, and exits cleanly (not a process crash that leaves state in limbo)
5. Unit tests under `apps/server/tests/unit/` using `node --test` cover: NDJSON parsing of a sample Claude stream transcript, kill-escalation timing, bounded semaphore acquire/release, token hashing + timing-safe equality

**Plans:** 4 plans

Plans:
- [ ] 21-01-PLAN.md — Shared types + primitives (Semaphore + kill-escalation + parseNdjson) + Wave 0 scaffolding (fixtures, test:unit script, e2e stub)
- [ ] 21-02-PLAN.md — CLI commander dispatch + daemon config (0o600 enforcement) + detectClaude + DaemonHttpClient (execa + commander deps added)
- [ ] 21-03-PLAN.md — Claude backend (spawn + control_request + audit) + StreamBatcher + cancel-poller + poll-loop + heartbeat + crash-handler + main.ts orchestrator
- [ ] 21-04-PLAN.md — Integration spec: full claim→stream→complete + cancel-zombie-free + crash-log via spawned daemon + fake-claude stub (CI-skipped, autonomous:false)

### Phase 22: Remaining Agent Backends
**Goal:** Codex, OpenClaw, OpenCode, and Hermes backends implement the same stream interface as Phase 21's Claude backend so users with any of these CLIs installed get the same task-delegation experience with no code-path divergence.
**Depends on:** Phase 21
**Requirements:** BACKEND-02, BACKEND-03
**Research gate:** LIGHT — read each CLI's `--output-format stream-json` (or equivalent) dialect; codex uses JSON-RPC over stdio; openclaw may have its own variant
**Owned pitfalls:** PG7, PG8 (per-backend), PM5, PM6, PM7 (cancel races)
**Success criteria:**
1. Codex backend spawns `codex app-server --listen stdio://`, routes JSON-RPC events through the same `AgentMessage` union as Claude, and completes a sample task
2. OpenClaw, OpenCode, Hermes backends pass the same unit-test harness for stream parsing with backend-specific transcript fixtures
3. Switching an agent's runtime from a Claude daemon to a Codex daemon produces no changes to `task_message` schema or UI rendering (verified by manual E2E)
4. All backends honour the cancel contract: SIGTERM triggers `state='cancelled'` within 10 s or escalates to SIGKILL

### Phase 23: Issue Board UI (Kanban)
**Goal:** Users see all issues in a kanban board with one column per status, smooth drag-and-drop reordering via @dnd-kit, keyboard accessibility, and WebSocket reconciliation with concurrent edits from other sessions.
**Depends on:** Phase 18
**Requirements:** UI-01, UI-02, UI-03
**Research gate:** LIGHT — find a React 19-compatible virtualized-DnD reference pattern
**Owned pitfalls:** UX1, UX2, UX3, UX4, UX5
**Success criteria:**
1. Dragging an issue between columns updates `status` and recomputes `position` server-side via `POST /api/issues/:id/reorder`; the UI reflects the server-authoritative position after drop
2. A second browser session receiving a WS reorder event during an in-progress drag defers the remote update until drop, then reconciles without corrupting the dragged card
3. Board with 200+ issues maintains 60 FPS during drag (virtualization kicks in above 100 issues)
4. Keyboard users can move cards between columns using arrow keys (demonstrated via Playwright keyboard E2E)
5. All board UI strings are translated across en/zh/fr/de/es/it

### Phase 24: Issue Detail UI + Task Message Streaming
**Goal:** Users open an issue, see its full timeline (description + comments + system events) and watch any running task stream live tool-use / tool-result / text / thinking messages over WebSocket, with automatic replay on reconnect.
**Depends on:** Phase 18, Phase 23
**Requirements:** UI-04, UI-05, UI-06, UI-07, UI-08, CHAT-01
**Research gate:** SKIP
**Owned pitfalls:** ST2, ST3, UX6
**Success criteria:**
1. Issue detail page shows description, threaded comments by `parent_id`, and a live task panel that auto-subscribes via WS `subscribe_task`
2. Reconnecting mid-stream replays missed messages from the server's `task_messages` table using `lastSeq`, with no gaps or duplicates
3. Switching to a background tab during an active task and returning shows all accumulated messages without blocking the main thread (uses React 19 `useTransition`)
4. Agent-authored output never executes as HTML (no `dangerouslySetInnerHTML`); task output is truncated to 16 KB server-side with an explicit "truncated" marker
5. Chat-on-issue flow: user types message → task enqueued with `trigger_comment_id` → response streams as task_messages → completes as a threaded agent comment

### Phase 25: Management UIs
**Goal:** Users manage agents, runtimes, and daemon tokens through dedicated pages with i18n coverage across all 6 locales.
**Depends on:** Phase 16, Phase 17, Phase 19
**Requirements:** MGMT-01, MGMT-02, MGMT-03
**Research gate:** SKIP
**Owned pitfalls:** (UI-level only, no HARD constraints)
**Success criteria:**
1. Agents page lists agents with runtime badge, status, max_concurrent_tasks; edit form includes custom_env and custom_args editors
2. Runtimes page shows all three kinds in one list with device_info, last_heartbeat_at, and a "kind" filter chip
3. Daemon Tokens page lets users create a new token with friendly name + optional expiry, copy plaintext once, list existing tokens, and revoke with confirmation
4. All new strings ship in all 6 locales and pass the i18n CI check

### Phase 26: Integration, Boot Wiring, E2E & Release
**Goal:** All v1.4 components are wired into the CE boot sequence in the correct order, Playwright E2E coverage validates the golden paths end-to-end on both hosted and daemon runtimes, and v1.4.0 is released via the existing GitHub Actions pipeline.
**Depends on:** Phases 15-25 (all prior v1.4 phases)
**Requirements:** REL-01, REL-02, REL-03
**Research gate:** SKIP
**Owned pitfalls:** Cross-cutting boot-order and integration risks
**Success criteria:**
1. Cold server start runs boot steps 1-9 unchanged, then adds 9a runtime-bridge reconcile → 9b in-flight hosted-task fail → 9c task-queue sweeper → 9d hosted worker → 9e offline sweeper before HTTP listens
2. Playwright suite passes with: (a) daemon-token issuance and revocation, (b) assign-to-daemon-agent happy path via @integration test with a real `claude` stub, (c) assign-to-hosted-agent happy path through the existing openclaw gateway, (d) kanban drag-and-drop, (e) cancel propagation on both runtime kinds
3. Version bumped to `1.4.0` in `apps/server/package.json`, tagged `v1.4.0`, pushed; release workflow publishes npm + GHCR image successfully; `npx @aquaclawai/aquarium@1.4.0` starts the server and reports v1.4.0 in CLI `--version`



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
| 12. Extension Operations | v1.3 | 3/3 | Complete | 2026-04-05 |
| 13. Health Integration | v1.3 | 2/2 | Complete    | 2026-04-05 |
| 14. Plugin Cleanup | v1.3 | 2/2 | Complete    | 2026-04-05 |
| 15. Schema & Shared Types | v1.4 | 6/6 | Complete    | 2026-04-16 |
| 16. Runtime Registry + Bridge | v1.4 | 4/4 | Complete    | 2026-04-16 |
| 17. Agent/Issue/Comment Services | v1.4 | 5/5 | Complete    | 2026-04-16 |
| 18. Task Queue & Dispatch | v1.4 | 4/4 | Complete    | 2026-04-16 |
| 19. Daemon REST API & Auth | v1.4 | 4/4 | Complete   | 2026-04-17 |
| 20. Hosted-Instance Driver | v1.4 | 3/3 | Complete    | 2026-04-17 |
| 21. Daemon CLI + claude-code | v1.4 | 0/4 | Not started | - |
| 22. Remaining Agent Backends | v1.4 | 0/? | Not started | - |
| 23. Issue Board UI (Kanban) | v1.4 | 0/? | Not started | - |
| 24. Issue Detail + Streaming | v1.4 | 0/? | Not started | - |
| 25. Management UIs | v1.4 | 0/? | Not started | - |
| 26. Integration, E2E, Release | v1.4 | 0/? | Not started | - |

**Execution Order:** v1.1–v1.3 executed strictly numerically. v1.4 supports parallelism per the phase graph — 15 → {16, 17} → 18 → {19, 20}; 18 → {23, 24}; {16,17,19} → 25; all → 26. Longest critical path: 15 → 18 → 19 → 21 → 22 → 26.
