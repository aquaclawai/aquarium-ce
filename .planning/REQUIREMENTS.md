# Requirements: Aquarium CE — Gateway Communication Overhaul

**Defined:** 2026-04-05
**Core Value:** Gateway is the source of truth when containers are running; DB is the persistence layer for offline state and container initialization.

## v1.3 Requirements

Requirements for the gateway communication overhaul. Each maps to roadmap phases.

### RPC Consolidation

- [x] **RPC-01**: All gateway RPC calls route through the persistent WebSocket connection instead of opening ephemeral connections
- [x] **RPC-02**: RPC calls made while the persistent connection is unavailable are queued and retried when the connection re-establishes
- [x] **RPC-03**: The `plugins.list` RPC call (which does not exist in the gateway) is replaced with `tools.catalog` and `config.get` in all call sites
- [x] **RPC-04**: The persistent client uses the correct gateway client ID (`openclaw-control-ui`) consistently across all connection paths
- [x] **RPC-05**: Extension lifecycle reconciliation and plugin/skill catalog queries use the persistent client instead of creating ephemeral connections

### Config Lifecycle

- [x] **CFG-01**: Config updates for running instances operate on the gateway first (via `config.patch`), then sync the result back to DB on success
- [x] **CFG-02**: Config updates for stopped instances write to DB only (correct degradation when no gateway is available)
- [x] **CFG-03**: The platform tracks the gateway's `baseHash` from `config.get` and uses it for optimistic concurrency in `config.patch` calls
- [x] **CFG-04**: Config patches use the correct `{ raw: "<json5>" }` merge-patch format (RFC 7396) instead of `{ patch: {...} }` or full file overwrite
- [x] **CFG-05**: The platform enforces the 3-writes-per-60-seconds rate limit by batching multiple config changes into a single `config.patch` call
- [x] **CFG-06**: `reseedConfigFiles` is only used during initial container startup (seed), not for running instances (running instances use `config.patch`)
- [x] **CFG-07**: After a successful `config.patch`, the platform reads back the actual config from the gateway (`config.get`) and persists it to DB as the authoritative state

### Restart Cycle & State Sync

- [x] **SYNC-01**: The platform detects the gateway `shutdown` event and marks the instance as "restarting" (not "stopped" or "error")
- [x] **SYNC-02**: After a WebSocket reconnection, the platform queries gateway state (`config.get`, `tools.catalog`, `skills.status`) and reconciles DB records
- [x] **SYNC-03**: Extension reconciliation runs on every reconnect (not just at boot), promoting/demoting skills and plugins based on actual gateway state
- [x] **SYNC-04**: After a `config.patch`-triggered restart, the platform verifies success by checking `tools.catalog` for expected plugins/skills
- [x] **SYNC-05**: The persistent WebSocket connection auto-reconnects after a gateway restart with full state reconciliation

### Extension Operations

- [x] **EXT-01**: Plugin activation uses `config.patch` to add the plugin to gateway config instead of restarting the entire Docker container
- [x] **EXT-02**: Plugin deactivation uses `config.patch` to remove the plugin from gateway config instead of restarting the container
- [x] **EXT-03**: Multiple plugin operations are batched into a single `config.patch` call to respect the 3/min rate limit
- [x] **EXT-04**: After a plugin operation triggers a gateway restart (via SIGUSR1), the platform waits for reconnection and verifies the operation succeeded via `tools.catalog`
- [x] **EXT-05**: If post-restart verification shows a plugin failed to load, the platform marks it as `failed` in DB and offers rollback
- [x] **EXT-06**: Skill enable/disable/configure uses `config.patch` without triggering a restart (skills are dynamically loaded)

### Health Integration

- [x] **HLTH-01**: The health monitor polls the gateway's HTTP `/ready` endpoint alongside Docker container status checks
- [x] **HLTH-02**: The persistent WebSocket connection uses ping/pong frames for liveness detection (gateway unresponsive vs network down)
- [x] **HLTH-03**: The config integrity check uses the gateway's authoritative config hash (from `config.get`) instead of comparing file hashes on disk
- [x] **HLTH-04**: The config integrity check does not trigger `reseedConfigFiles` for running instances (eliminates the infinite reseed loop)

### Plugin Cleanup

- [x] **CLEAN-01**: ClawHub marketplace search is a direct HTTP call from the platform to the ClawHub API, not routed through the gateway plugin RPC
- [x] **CLEAN-02**: ClawHub extension info is a direct HTTP call from the platform, not routed through the gateway plugin RPC
- [x] **CLEAN-03**: The `skills.list`, `plugins.list`, `agents.workspace.init`, `clawhub.search`, and `clawhub.info` methods are removed from the platform-bridge plugin
- [x] **CLEAN-04**: The platform-bridge plugin only contains `platform.ping` and `platform.runtime` methods

## v1.4 Requirements — Task Delegation Platform

**Defined:** 2026-04-16
**Core Value:** Aquarium is the control plane where users delegate work to AI agents — whether platform-hosted Docker instances or user-managed CLIs (Claude Code, Codex, Hermes) reached through a local daemon.

### Schema & Shared Types

- [x] **SCH-01**: Workspace entity exists (CE single default `'AQ'` workspace); all new v1.4 tables FK to `workspace_id` for EE compatibility
- [x] **SCH-02**: `runtimes` table with three `kind` values (`local_daemon | external_cloud_daemon | hosted_instance`) and CHECK constraint ensuring `daemon_id XOR instance_id`
- [x] **SCH-03**: `agents` table with `instructions`, `custom_env`, `custom_args`, `max_concurrent_tasks DEFAULT 6 CHECK 1..16`, `visibility`, `status`, `archived_at/by`
- [x] **SCH-04**: `issues` table with 6-status machine (`backlog | todo | in_progress | done | blocked | cancelled`), priority, assignee, `position FLOAT` for kanban ordering, monotonic `issue_number` per workspace
- [x] **SCH-05**: `agent_task_queue` table with 6-status machine, `trigger_comment_id`, `session_id`, `work_dir` and partial unique index on `(issue_id, agent_id) WHERE status IN ('queued','dispatched')`
- [x] **SCH-06**: `task_messages` table with `(task_id, seq)` index for streamed agent execution events
- [x] **SCH-07**: `comments` table with `type IN ('comment','status_change','progress_update','system')` and `parent_id` for threading
- [x] **SCH-08**: `daemon_tokens` table with hashed token storage, expires_at, last_used_at, and revoked_at
- [x] **SCH-09**: Mandatory SQLite PRAGMAs applied at boot (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`) and verified
- [x] **SCH-10**: Shared TypeScript types exported from `@aquarium/shared` for Issue / Agent / Runtime / Task / TaskMessage / Comment / daemon REST request-response shapes

### Runtime Registry

- [x] **RT-01**: User can list all runtimes (hosted + daemon) in a single view showing kind, provider, status, device info, last heartbeat
- [x] **RT-02**: System automatically mirrors existing Aquarium instances into the `runtimes` table as `hosted_instance` rows at boot
- [x] **RT-03**: System creates/updates/removes `hosted_instance` runtime rows when instances are created, renamed, archived, or deleted
- [x] **RT-04**: `runtime.status` for `hosted_instance` is derived from the underlying `instance.status` via JOIN (never stored independently)
- [x] **RT-05**: Runtimes inactive beyond the heartbeat window are automatically marked offline by a background sweeper

### Agent, Issue, Comment Services

- [x] **AGENT-01**: User can create, update, archive, and restore agents with instructions, custom env, custom args, and a chosen runtime
- [x] **AGENT-02**: User can set an agent's `max_concurrent_tasks` (1-16) which is enforced at claim time
- [x] **ISSUE-01**: User can create, update, delete issues with title, description, priority, status, assignee, labels-free body
- [x] **ISSUE-02**: Assigning an issue to an agent while status ≠ `backlog` automatically enqueues a task
- [x] **ISSUE-03**: Reassigning an issue cancels any pending/dispatched task for the previous assignee and re-enqueues for the new one
- [x] **ISSUE-04**: Moving an issue to `cancelled` cancels all associated pending/running tasks
- [x] **ISSUE-05**: User can reorder issues on the kanban board via fractional `position` — server recomputes between neighbors
- [x] **COMMENT-01**: User can post comments on an issue; a comment with `trigger_comment_id` linkage triggers agent response
- [x] **COMMENT-02**: Status transitions and task completions emit system comments into the issue timeline
- [x] **COMMENT-03**: User can reply to a specific comment (threaded via `parent_id`)

### Task Queue & Dispatch

- [x] **TASK-01**: Task claim is atomic under SQLite via `BEGIN IMMEDIATE` transaction using `NOT EXISTS` subquery to enforce per-(agent, issue) coalescing
- [x] **TASK-02**: Task lifecycle supports `queued → dispatched → running → completed|failed|cancelled` with one explicit state transition per call
- [x] **TASK-03**: `task_messages` are appended in sequence order (`seq` strictly monotonic per task); ingest is batched at 500 ms
- [x] **TASK-04**: Stale-task reaper fails tasks stuck in `dispatched` > 5 min and `running` > configurable timeout (default 2.5 h)
- [x] **TASK-05**: User can cancel a running task; cancellation propagates to daemon (next poll) or hosted worker (AbortController)
- [x] **TASK-06**: Completing or failing an already-cancelled task is handled as `{ discarded: true }` (no error)

### Daemon REST API

- [x] **DAEMON-01**: `POST /api/daemon/register` returns runtime IDs for each registered provider on the daemon
- [x] **DAEMON-02**: `POST /api/daemon/heartbeat` updates `last_heartbeat_at` and returns any pending ping/update requests
- [x] **DAEMON-03**: `POST /api/daemon/deregister` marks runtimes offline on graceful daemon shutdown
- [x] **DAEMON-04**: `POST /api/daemon/runtimes/:id/tasks/claim` atomically returns the next queued task or `null`
- [x] **DAEMON-05**: `POST /api/daemon/tasks/:id/{start,progress,messages,complete,fail}` implements the task lifecycle with idempotent completion
- [x] **DAEMON-06**: `GET /api/daemon/tasks/:id/status` returns current status so daemons can detect server-side cancellation
- [x] **DAEMON-07**: All `/api/daemon/*` routes authenticate via `requireDaemonAuth` middleware only — cookie JWT is rejected
- [x] **DAEMON-08**: `/api/daemon/*` is exempt from the global 300-req/15-min rate limit but has per-token (~1000/min) quotas
- [x] **DAEMON-09**: Daemon tokens are prefixed `adt_<32 chars>`, stored only as SHA-256, and verified via `crypto.timingSafeEqual`
- [x] **DAEMON-10**: User can issue / list / revoke daemon tokens through the web UI; plaintext is shown once on creation

### Hosted-Instance Driver

- [x] **HOSTED-01**: An in-process `HostedTaskWorker` polls the task queue every 2 s for each online `hosted_instance` runtime
- [x] **HOSTED-02**: Hosted dispatch invokes `gatewayCall(instanceId, 'chat.send', …, 120_000)` reusing the existing persistent-WS gateway client
- [x] **HOSTED-03**: Gateway `text / toolCall / toolResult / thinking` events translate 1:1 into `task_message` rows with correct `type` and `seq`
- [x] **HOSTED-04**: On server restart, all in-process hosted tasks in `dispatched` / `running` are failed during boot (rather than waiting for the reaper)
- [x] **HOSTED-05**: Hosted tasks ignore `session_id`, `work_dir`, `custom_env`, `custom_args` with a logged warning; users needing these features pick a daemon runtime
- [x] **HOSTED-06**: When the gateway is disconnected, the worker silently skips its tick (task stays queued) instead of failing

### Daemon CLI & Agent Backends

- [ ] **CLI-01**: `npx @aquaclawai/aquarium daemon start` auto-detects `claude`, `codex`, `openclaw`, `opencode`, `hermes` on PATH and registers each as a runtime
- [ ] **CLI-02**: `aquarium daemon` subcommands (`start`, `stop`, `status`, `token`) route via commander with `--server`, `--token`, `--device-name` options
- [ ] **CLI-03**: Daemon reads config from `~/.aquarium/daemon.json` (server URL + token + device name); CLI flags override env which overrides file
- [ ] **CLI-04**: Daemon claim loop uses a bounded concurrency semaphore (default 10) to prevent unbounded task launches
- [ ] **CLI-05**: Any unhandled rejection / exception in the daemon marks in-flight tasks failed, writes `~/.aquarium/daemon.crash.log`, and exits cleanly
- [ ] **CLI-06**: Server-side task cancellation is detected within 5 s via a polling cancel loop and propagates via AbortSignal to the child process
- [ ] **BACKEND-01**: `claude-code` backend spawns the CLI with `--output-format stream-json` and parses NDJSON into unified `AgentMessage{text|thinking|tool_use|tool_result|error}` events
- [x] **BACKEND-02**: `codex` backend spawns `codex app-server --listen stdio://` and consumes JSON-RPC events through the same unified `AgentMessage` interface
- [x] **BACKEND-03**: `openclaw`, `opencode`, `hermes` backends each implement the same `Backend` interface with provider-specific stream parsing
- [ ] **BACKEND-04**: Child processes are killed via SIGTERM → SIGKILL escalation (10 s grace) with process-group kill to prevent zombies
- [ ] **BACKEND-05**: The daemon-side spawn prepends its own binary directory to PATH so the child CLI always resolves `aquarium`
- [ ] **BACKEND-06**: Stream-json parsers use `node:readline` (`crlfDelay: Infinity`, `setEncoding('utf8')`) with a 60 s inactivity-kill watchdog
- [ ] **BACKEND-07**: Unit tests under `apps/server/tests/unit/` cover stream-json parsing, kill escalation, and bounded-semaphore behaviour via `node --test`

### Issue Board & Detail UI

- [x] **UI-01**: User sees a kanban Issues page with one column per status, drag-and-drop reordering via @dnd-kit, and keyboard-accessible drag
- [x] **UI-02**: Optimistic local reorder reconciles with WebSocket reorder events from other sessions without corrupting drag state
- [x] **UI-03**: Issue board virtualises when > 100 issues are loaded to keep drag FPS smooth
- [ ] **UI-04**: User sees an Issue Detail page with title, description, comments timeline, active task progress, and action sidebar
- [ ] **UI-05**: Task message stream renders live `tool_use / tool_result / text / thinking` messages from WebSocket `subscribe_task`
- [ ] **UI-06**: WebSocket reconnect replays `task_messages` from `lastSeq` so users never see a gap on reconnect
- [ ] **UI-07**: Agent-authored content is never rendered via `dangerouslySetInnerHTML`; task output is truncated to 16 KB server-side
- [ ] **UI-08**: All new UI strings are translated across 6 locales (en, zh, fr, de, es, it) — enforced in CI before release

### Management UI

- [ ] **MGMT-01**: User can browse / create / edit / archive Agents with a form showing instructions, runtime selector, custom env, custom args, max concurrent tasks
- [ ] **MGMT-02**: User can browse Runtimes in a unified list showing hosted instances + daemon connections with status badges
- [ ] **MGMT-03**: User can issue a new daemon token with a friendly name and an optional expiry, copy the plaintext once, then revoke from a list view

### Chat on Issue (Differentiator)

- [ ] **CHAT-01**: User can chat with an agent directly on an issue — each message creates a task, response streams back as task messages, and chat history threads via `trigger_comment_id`

### Integration & Release

- [ ] **REL-01**: Playwright E2E suite validates: daemon registration, claim-to-complete happy path on hosted runtime, claim-to-complete on daemon runtime (`@integration` smoke), cancel propagation, board drag-and-drop, daemon token issuance
- [ ] **REL-02**: Boot sequence wiring (`server-core.ts`) initializes runtime-bridge, task-queue sweeper, hosted worker, and offline sweeper in the right order without regressing existing v1.3 gateway behaviour
- [ ] **REL-03**: Version bumped to `1.4.0`, tagged, and released via existing GitHub Actions workflow without breaking `npx @aquaclawai/aquarium` startup

## Future Requirements (v1.5+)

- **SKILL-UI**: Skills management UI (tables ship in v1.4 but UI deferred)
- **PROJ-01..**: Projects and labels for issue organisation
- **SESS-01**: Daemon `--resume` session-resume logic (session_id persisted in v1.4 but never read back)
- **DEP-01**: Issue parent/child dependencies with blocks/blocked_by/related
- **AUTOPILOT-01**: Autopilot cron rules that enqueue issues
- **INBOX-01**: Multi-user inbox with @-mentions
- **SEARCH-01**: Full-text search over issues/comments (SQLite FTS5)
- **ATTACH-01**: File attachments on issues and messages
- **UPDATE-01**: Daemon self-update mechanism
- **ENC-01**: Encrypt agent `custom_env` at rest
- **MULTI-WS**: Multi-workspace UI (schema already supports it)

## Out of Scope

| Feature | Reason |
|---------|--------|
| `activity_log` table | Comment table with `type IN ('status_change','system')` drives timeline — multica has the table but never reads it in production |
| Daemon OAuth / QR pairing | Multica dropped this at migration 029 in favour of pre-issued tokens — not worth the UX complexity |
| Issue-scoped git repositories | Multica dropped at migration 007 — out of scope for a management platform |
| `in_review` issue status | No human-review workflow exists in CE single-user mode |
| Pinned items / reactions / subscribers | Not useful in single-user CE |
| pgvector / semantic issue search | SQLite-only; LIKE-based search is sufficient for v1.4 |
| Workspace switcher UI | CE ships with a single default workspace; multi-workspace is EE |
| Gateway-level agent cancel frame | If OpenClaw gateway v3 lacks a cancel frame, hosted-runtime cancel is best-effort in v1.4 |
| `@anthropic-ai/claude-agent-sdk` integration | The SDK bypasses the user's installed `claude` CLI auth — breaks the daemon model |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCH-01..SCH-10 | Phase 15 | Pending |
| RT-01..RT-05 | Phase 16 | Pending |
| AGENT-01..AGENT-02, ISSUE-01..ISSUE-05, COMMENT-01..COMMENT-03 | Phase 17 | Pending |
| TASK-01..TASK-06 | Phase 18 | Pending |
| DAEMON-01..DAEMON-10 | Phase 19 | Pending |
| HOSTED-01..HOSTED-06 | Phase 20 | Pending |
| CLI-01..CLI-06, BACKEND-01, BACKEND-04..BACKEND-07 | Phase 21 | Pending |
| BACKEND-02, BACKEND-03 | Phase 22 | Pending |
| UI-01..UI-03 | Phase 23 | Pending |
| UI-04..UI-08, CHAT-01 | Phase 24 | Pending |
| MGMT-01..MGMT-03 | Phase 25 | Pending |
| REL-01..REL-03 | Phase 26 | Pending |

**Coverage:**
- v1.4 requirements: 56 total
- Mapped to phases: 56 (pending roadmap creation)
- Unmapped: 0

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RPC-01 | Phase 9 | Complete |
| RPC-02 | Phase 9 | Complete |
| RPC-03 | Phase 9 | Complete |
| RPC-04 | Phase 9 | Complete |
| RPC-05 | Phase 9 | Complete |
| CFG-01 | Phase 10 | Complete |
| CFG-02 | Phase 10 | Complete |
| CFG-03 | Phase 10 | Complete |
| CFG-04 | Phase 10 | Complete |
| CFG-05 | Phase 10 | Complete |
| CFG-06 | Phase 10 | Complete |
| CFG-07 | Phase 10 | Complete |
| SYNC-01 | Phase 11 | Complete |
| SYNC-02 | Phase 11 | Complete |
| SYNC-03 | Phase 11 | Complete |
| SYNC-04 | Phase 11 | Complete |
| SYNC-05 | Phase 11 | Complete |
| EXT-01 | Phase 12 | Complete |
| EXT-02 | Phase 12 | Complete |
| EXT-03 | Phase 12 | Complete |
| EXT-04 | Phase 12 | Complete |
| EXT-05 | Phase 12 | Complete |
| EXT-06 | Phase 12 | Complete |
| HLTH-01 | Phase 13 | Complete |
| HLTH-02 | Phase 13 | Complete |
| HLTH-03 | Phase 13 | Complete |
| HLTH-04 | Phase 13 | Complete |
| CLEAN-01 | Phase 14 | Complete |
| CLEAN-02 | Phase 14 | Complete |
| CLEAN-03 | Phase 14 | Complete |
| CLEAN-04 | Phase 14 | Complete |

**Coverage:**
- v1.3 requirements: 31 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation*
