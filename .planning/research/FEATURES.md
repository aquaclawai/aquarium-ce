# Feature Landscape: v1.4 Task Delegation Platform

**Domain:** Task delegation for AI coding agents (multica-style)
**Researched:** 2026-04-16
**Overall confidence:** HIGH — all findings from direct source reading of `/tmp/multica` (init schema, 46 migrations, handler/service layer) and Aquarium CE gateway RPC at `apps/server/src/agent-types/openclaw/gateway-rpc.ts`. Claims are cited to file:line.

## Research Approach

The v1.4 scope is explicit: **port multica's task-delegation model to Aquarium CE**, adding `hosted-instance` as a third runtime kind. Rather than do open-ended ecosystem research, this document:

1. Enumerates multica's actual feature set by reading its init schema (`001_init.up.sql`), all 46 migrations, and task/issue/daemon handlers.
2. Categorises each feature for CE v1.4 based on (a) whether multica actually uses it, (b) whether it works at all in a single-user CE deployment, and (c) whether it blocks the minimum useful flow: "create issue → assign to agent → agent runs on some runtime → result appears in issue".
3. Specifies the hosted-instance driver flow concretely, reusing Aquarium's existing `gatewayCall` facade.

Multica's schema evolved significantly — several entities in `001_init.up.sql` were later **removed or replaced**. I've cross-referenced migrations to call out the current (post-46 migrations) shape.

---

## Table Stakes (v1.4 must-have)

Without these, the product is not a task-delegation platform. Complexity ratings: S (small, ≤300 LOC), M (medium, 300–1000 LOC), L (large, >1000 LOC).

### 1. Workspace (single-default for CE)

**Multica schema:** `workspace` (`001:15`) — `id`, `name`, `slug`, `issue_prefix`, `issue_counter` (`020_issue_number.up.sql`).

**CE shape:** Seed exactly one workspace `default` at server startup (migration). All new tables keep `workspace_id` FK for EE forward-compat, but the CE UI hides workspace switching. The default workspace owns `issue_prefix = 'AQ'` and a monotonically-increasing `issue_counter`.

**Why table stakes:** Multi-tenancy boundary for issues, agents, runtimes, tokens. Even in single-user mode, the `workspace_id` column discriminates "real" CE data from potential imported templates.

**Complexity:** S. One seed migration + `workspace_id` FK on every new table.

### 2. Agent entity

**Multica schema:** `agent` (`001:36`) + additions — `instructions` (`021`), `custom_env` (`040`), `custom_args` (`041`), `archived_at/archived_by` (`031`), `runtime_id` FK (`004`).

**CE shape:** Table with: `id`, `workspace_id`, `name`, `description`, `instructions` (system prompt), `avatar_url`, `runtime_id` (FK), `custom_env` (JSON), `custom_args` (JSON), `max_concurrent_tasks` (INTEGER DEFAULT 6 — see §10), `visibility` ('workspace' | 'private', CE default 'workspace' since single user), `status` ('idle' | 'working' | 'blocked' | 'error' | 'offline'), `owner_id` FK, `archived_at`, `archived_by`. Drop `runtime_mode` — it's redundant once you have `runtime_id` pointing at a runtime row that already carries a kind (see §3).

**Why table stakes:** The assignable unit. Issues assign to agents, agents point to a runtime, runtime kind determines dispatch path. Without this entity the whole model collapses.

**Multica gotcha:** Original schema had `runtime_mode TEXT CHECK IN ('local', 'cloud')` on `agent`. Migration 004 added a normalised `agent_runtime` table and made `runtime_mode` redundant (kept for migration compat). For a greenfield CE port: put the kind on the runtime row, not the agent row.

**Complexity:** M. ~500 LOC for CRUD routes + service + React management UI.

### 3. Runtime entity (3 kinds)

**Multica schema:** `agent_runtime` (`004:1`) — `id`, `workspace_id`, `daemon_id`, `name`, `runtime_mode` ('local' | 'cloud'), `provider` (claude/codex/openclaw/…), `status` ('online' | 'offline'), `device_info`, `metadata` (JSON), `last_seen_at`. Unique `(workspace_id, daemon_id, provider)`.

**CE shape:** Same columns, but replace `runtime_mode` with `kind TEXT CHECK IN ('local_daemon', 'external_cloud_daemon', 'hosted_instance')`:

- **`local_daemon`** — user's machine. `daemon_id` = hostname-based stable ID. Heartbeats via daemon token.
- **`external_cloud_daemon`** — same protocol, but user tells the daemon to connect to a remote Aquarium (e.g., team-hosted server). Identical shape; the label exists for UI clarity and future billing.
- **`hosted_instance`** — an Aquarium instance row (Docker container) in this same DB. `metadata.instance_id` points to the `instances.id`. No heartbeat row needed — the existing instance-manager already tracks health via the gateway client. A one-off seed migration creates a `hosted_instance` runtime for every existing running instance.

**Why table stakes:** Without runtimes, agents have nowhere to execute. The 3-kind split is the whole point of the milestone.

**Multica gotcha:** The original `agent` table had `runtime_config` JSONB for provider-specific config. After migration 004, this lives on the runtime row (via `provider` + `metadata`). For CE, keep `provider` on the runtime and keep per-agent runtime overrides (`custom_env`, `custom_args`) on the agent — that's what multica settled on.

**Complexity:** M for local-daemon + external-cloud-daemon; S to wire hosted-instance (reuses existing instance-manager). Total ~800 LOC.

### 4. Issue entity with 6 statuses (NOT 7)

**Multica schema:** `issue` (`001:52`) — 7 statuses: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. Plus `number` (`020_issue_number`) producing identifier `AQ-123`.

**CE decision: drop `in_review`.** Justification: `in_review` is a human-workflow status for "another teammate needs to approve". In CE (single user, no team review), this collapses to `done` or a manual move back to `todo`. Keep the 6 canonical statuses: `backlog`, `todo`, `in_progress`, `done`, `blocked`, `cancelled`. An agent that wants a human check can transition `in_progress → blocked` with a comment explaining what it needs.

**Agent auto-transition rules** (copying multica's `issue.go:1116–1139`):
- **Create** with `assignee_type='agent'` and `status != 'backlog'` → auto-enqueue task. `backlog` is the parking-lot convention.
- **Assignee change to agent** while status is non-terminal → cancel pending tasks for the issue, enqueue new task for new assignee.
- **Status change `backlog → todo`** by a user (not the agent) while an agent is assigned → enqueue task.
- **Status change to `cancelled`** → cancel all active tasks for the issue.
- The agent itself controls `in_progress → done` / `in_progress → blocked` via the same API (via daemon, or gateway RPC for hosted). The server does **not** auto-transition on task completion (multica pattern: `task.go:248` "Issue status is NOT changed here — the agent manages it via the CLI").

**CE shape:** `issue` table with `id`, `workspace_id`, `number` (auto-increment per workspace), `title`, `description`, `status` (CHECK constraint 6 values), `priority` (`urgent | high | medium | low | none`), `assignee_type` (`member | agent` nullable), `assignee_id` (nullable), `creator_type/creator_id`, `position` FLOAT for kanban ordering, `due_date`, `created_at/updated_at`. Skip `parent_issue_id`, `acceptance_criteria`, `context_refs` — deferred (see below).

**Why table stakes:** The delegation target. No issue → no task.

**Complexity:** M. ~700 LOC (CRUD + status-change side effects + kanban position handling).

### 5. Task queue (single attempt model, coalesced)

**Multica schema:** `agent_task_queue` (`001:127`) + refinements (`022` lifecycle guards, `028` trigger_comment, `037` per-(issue,agent) pending unique index, `020_task_session` session_id/work_dir).

**CE shape:** `task` table — `id`, `workspace_id`, `agent_id`, `runtime_id`, `issue_id` (nullable for chat tasks, see §7), `chat_session_id` (nullable), `trigger_comment_id` (nullable, see §6), `status` ('queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled'), `priority` INT, `dispatched_at`, `started_at`, `completed_at`, `result` JSON, `error` TEXT, `session_id` TEXT (for CLI resume), `work_dir` TEXT, `created_at`.

**Critical unique index** (`037`): `CREATE UNIQUE INDEX ... ON task(issue_id, agent_id) WHERE status IN ('queued', 'dispatched')`. This is multica's coalescing primitive: rapid-fire comments don't stack tasks; the already-pending task will pick up fresh context when it starts.

**Retry model:** Multica does **not auto-retry** on task failure. Failed tasks remain failed; the user re-triggers by re-assigning, commenting, or moving status. CE adopts the same: no retry count column, no exponential backoff. A failed task appends a `type='system'` comment with the error (multica `task.go:363`) and leaves the issue for user action.

**Why table stakes:** Durable execution record, enables Timeline/history, enables streaming UI to re-render after reload.

**Complexity:** M. ~800 LOC (claim/start/progress/complete/fail endpoints + coalesced enqueue + agent status reconciliation).

### 6. Trigger-comment pattern

**Multica schema:** `agent_task_queue.trigger_comment_id` (`028`) — the comment that caused this task to run.

**CE decision: keep it.** It costs one nullable UUID column and unlocks two essential behaviours:

1. **Thread-aware replies** — when the task completes, the agent's auto-posted reply uses `trigger_comment_id` as parent so it lands in the right thread (multica `task.go:596`, uses parent resolution to find thread root).
2. **Duplicate-suppression** — on task completion, multica checks whether the agent posted a comment during execution before auto-posting the result (`task.go:283`). Without `trigger_comment_id`, you can't tell comment-triggered tasks (where the agent replied via CLI) from assignment-triggered tasks (where the server posts the result).

The alternative — triggering solely on `assignee_changed` events — can't distinguish "user just dropped a new comment asking for a change" from "task completed and wrote back". You get either duplicate comments or silent completions.

**Why table stakes:** Thread coherence is the single most visible UX quality marker. Users will notice fractured reply chains immediately.

**Complexity:** S. One column + 3 branches in task-complete handler.

### 7. Comments with agent-authored type

**Multica schema:** `comment` (`001:97`) — `issue_id`, `author_type` (`member | agent`), `author_id`, `content`, `type` (`comment | status_change | progress_update | system`), `parent_id` (from migration `017`).

**CE shape:** Same table. Three uses:
- User/agent narrative comments (`type='comment'`)
- System-generated on-status-change entries (`type='status_change'`) so the timeline shows "moved to in_progress by Claude Agent"
- Error records (`type='system'`) written when a task fails

Threaded replies via `parent_id` (self-FK) are needed because trigger-comment reply threading depends on it.

**Why table stakes:** This is the primary audit trail — replaces `activity_log` (see deferred §2). Every status change and agent action shows up as a comment, and the issue-detail page reads just this one stream.

**Complexity:** M. ~500 LOC (CRUD + thread resolution + mention parsing for later).

### 8. Task message streaming

**Multica schema:** `task_message` (`026_task_messages.up.sql`) — `task_id`, `seq` INT, `type` (text/tool_use/tool_result/thinking/…), `tool`, `content`, `input` JSON, `output` TEXT, `created_at`. Index on `(task_id, seq)`.

**CE shape:** Same. Two ingestion paths:
- **Daemon runtimes** — daemon POSTs `/api/daemon/tasks/:id/messages` with stream-json parsed output from the CLI.
- **Hosted-instance runtime** — server-side driver subscribes to the gateway `chat` event stream (see existing `gateway-event-relay.ts:425–500`) and translates each Gateway `message` payload into a `task_message` row. The Gateway already emits per-part content (`type='text' | 'toolCall' | 'toolResult'` in `gateway-rpc.ts:141`), so translation is a direct field mapping.

**Broadcast:** Every insert triggers a WS event on the existing `instance:gateway_event` pipe (CE) / workspace room (future). Frontend subscribes, appends to an in-memory log, renders the Issue Detail live view.

**Why table stakes:** "Live task message streaming" is one of the three explicit target features in PROJECT.md. Without it the product looks identical to a Jira with webhooks.

**Complexity:** M. ~600 LOC total (ingest endpoint + hosted-instance translator + WS event + React viewer component).

### 9. Daemon REST API + daemon-token auth

**Multica schema:** `daemon_token` (`029_daemon_token.up.sql`) — `token_hash` (SHA-256), `workspace_id`, `daemon_id`, `expires_at`. The older `daemon_pairing_session` from migration 005 was **dropped** in migration 029's companion (`029_drop_daemon_pairing`) in favour of pre-issued tokens. Do not copy the pairing flow.

**Endpoints** (minimum viable subset, from `daemon.go`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/daemon/register` | daemon advertises its runtimes (array of `{name, type, version, status}`) at startup |
| POST | `/api/daemon/deregister` | marks runtimes offline on graceful shutdown |
| POST | `/api/daemon/heartbeat` | `{runtime_id}` every 15s, updates `last_seen_at` |
| GET | `/api/daemon/runtimes/:runtimeId/claim` | atomically claim next queued task for this runtime (respects per-agent `max_concurrent_tasks`) |
| POST | `/api/daemon/tasks/:id/start` | dispatched → running |
| POST | `/api/daemon/tasks/:id/messages` | append `task_message` row(s) |
| POST | `/api/daemon/tasks/:id/progress` | short summary broadcast (multica `task.go:376`) — fire-and-forget, not persisted |
| POST | `/api/daemon/tasks/:id/complete` | running → completed, write `result`, `session_id`, `work_dir` |
| POST | `/api/daemon/tasks/:id/fail` | running/dispatched → failed, write `error` |

All endpoints use `Authorization: Bearer mdt_<token>` (multica's prefix convention). Middleware verifies `token_hash`, populates `daemonWorkspaceID` on context, and every handler re-checks workspace membership on the target resource.

**Token issuance UI:** Settings → Daemon Tokens → "Generate" → shows `mdt_...` once, persists only the hash. User pastes into `aquarium daemon start --token`.

**Why table stakes:** Without this, local daemons have no way to authenticate or pull work. It's the bridge.

**Complexity:** L. ~1500 LOC (9 routes + middleware + generator + React token-issuance UI).

### 10. Per-agent max_concurrent_tasks (default 6)

**Multica schema:** `agent.max_concurrent_tasks INT DEFAULT 1` (`001:45`), bumped to **`DEFAULT 6`** in migration `023_agent_concurrency_default.up.sql` which also backfilled existing `1` values to `6`.

**CE decision: default 6, CHECK between 1 and 16.**

Rationale from migration 023's companion diff notes: a single concurrent task per agent is too restrictive for comment-driven workflows where users fire rapid follow-ups. 6 matches multica's production experience. The upper bound 16 is a sanity cap — beyond that, claude-code-class tools thrash on the same work_dir and context quality drops.

**Enforcement:** In `ClaimTask` (multica `task.go:180`), count `status IN ('dispatched', 'running')` for the agent; if `>= max`, return "no capacity" to the daemon's claim request. The daemon polls again on next heartbeat.

**Why table stakes:** Without a limit, a looping comment thread can spawn dozens of concurrent executions of the same CLI on one machine.

**Complexity:** S. One column + one count query in claim path.

### 11. Runtime heartbeat window (15 s / 45 s / 7 d)

**Multica constants** (`server/cmd/server/runtime_sweeper.go:15–30` and `daemon/config.go:16`):

| Value | Purpose |
|-------|---------|
| 15 s | Daemon heartbeat interval (`DefaultHeartbeatInterval`) |
| 45 s | Mark runtime offline threshold (3 missed heartbeats — `staleThresholdSeconds`) |
| 30 s | Sweeper tick interval |
| 5 min | Dispatch-timeout (`dispatched` → `failed`) |
| 2.5 h | Running-timeout (`running` → `failed`) |
| 7 d | Offline-runtime TTL before GC deletes the row |

**CE decision: use these verbatim.** They are battle-tested defaults from multica's production deployment. The 45 s window is long enough to survive a laptop closing its lid during a metro ride, short enough that the UI feels live. The 5 min dispatch timeout catches StartTask API call failures. The 2.5 h running timeout exists because Claude Code's default agent deadline is 2 h — anything longer is a hung daemon.

**Sweeper also performs:** `FailTasksForOfflineRuntimes` (cascade: any `dispatched`/`running` task on a newly-offline runtime → failed with reason "runtime offline"), and `reset stuck in_progress → todo` when an orphaned task fails (lets the next claim pick it up again).

**For hosted-instance runtimes:** Do not apply heartbeat sweeping. The runtime's `status` is derived from the existing `instances.status` column (running → online, else offline). Write a small mapper; skip the sweeper code path.

**Why table stakes:** Without offline detection, failed machines leave tasks orphaned and UI claims "running" forever.

**Complexity:** S. ~150 LOC (sweeper + 2 SQL queries + mapper for hosted instances).

### 12. Hosted-instance runtime driver

This is the novel piece relative to multica — Aquarium-specific. See full flow in §"Hosted-Instance Driver" below. Table-stakes because it's the milestone's differentiator vs a straight multica clone.

**Complexity:** M. ~600 LOC (driver + stream translator + adapter to existing `gatewayCall` RPC + agent-type config mapping).

---

## Differentiators (v1.4 nice-to-have, defer if schedule slips)

### D1. Chat-on-issue (issue-scoped chat sessions)

**Multica schema:** `chat_session` + `chat_message` (`033_chat.up.sql`). Separate from `issue_comment`: multica keeps chat as its own conversational surface where context is maintained across turns without cluttering the issue's comment timeline.

**CE recommendation:** Do it, but **make it optional per issue** and reuse the task-message streaming pipe. In multica, chat_session was added late because comments alone proved insufficient for "tight conversational refinement with the agent". CE users with code-review flows will hit the same pain.

**Shape:** `chat_session(id, issue_id, agent_id, session_id, work_dir, status, unread_since)` + `chat_message(session_id, role, content, task_id)`. Create chat sessions from a "Chat with {agent}" button on the issue page. The chat view subscribes to the same `task_message` stream used by the issue detail.

**Why differentiator (not table-stakes):** The issue-comment + trigger-comment pattern already handles the main flow. Chat is for iterative prompt-engineering. Users will survive without it in a first release; they will not survive without the core issue flow.

**Complexity:** M. ~500 LOC.

### D2. Skills (reusable instruction blocks attached to agents)

**Multica schema:** `skill` + `skill_file` + `agent_skill` (`008_structured_skills.up.sql`). Skills carry `name`, `description`, `content` (markdown prompt), plus arbitrary file attachments the agent receives at task claim time.

**CE recommendation:** Defer the creation/editing UI to v1.5, but add the schema tables in v1.4 so template export/import doesn't need a schema bump later. No skill-attachment UI; the claim response just returns an empty skills array.

**Why differentiator:** Skills compound value over time, but v1.4 is already shipping an entire new data model. Adding skill authoring doubles the UI surface.

**Complexity:** S for schema-only; M for full implementation.

### D3. Custom env / custom args per agent

**Multica schema:** `agent.custom_env JSONB` (`040`), `agent.custom_args JSONB` (`041`). Per-agent overrides injected into the CLI subprocess at launch.

**CE recommendation:** Ship it in v1.4. Users will immediately need `ANTHROPIC_BASE_URL` / `OPENAI_API_KEY` / proxy endpoints per-agent. Without these, you can't have two agents using different API tiers. Storage is one JSONB column each, read in the daemon-claim response, merged into the subprocess env by the daemon.

**Security:** Multica redacts `custom_env` values in API responses unless caller is owner/admin (`agent.go:358–375`). CE single-user mode doesn't need redaction, but keep the redaction code path so EE can use it.

**Complexity:** S. ~150 LOC.

### D4. Agent archival (soft delete)

**Multica schema:** `agent.archived_at + archived_by` (`031`). Archived agents are excluded from claim candidates (`task.go:47`) but keep history intact.

**CE recommendation:** Ship archival. Hard delete of an agent with historical tasks creates FK cascade headaches. Archival is a 2-column addition.

**Complexity:** S. ~100 LOC.

### D5. Issue labels

**Multica schema:** `issue_label` + `issue_to_label` (`001:75`). Workspace-scoped label library, many-to-many with issues.

**CE recommendation:** Defer to v1.5. It's a kanban polish feature. Users can filter by priority, assignee, and status in v1.4 — labels are an optimisation, not a requirement.

**Complexity if done:** S. ~250 LOC.

### D6. Issue priority ordering / kanban DnD position

**Multica schema:** `issue.position FLOAT` (`001:68`). Fractional indexing for drag-and-drop reordering without reflowing all rows.

**CE recommendation:** Include the column in v1.4 and wire the kanban list to sort by `(status, position)`. Frontend can keep it simple (single-click prioritise up/down) — full HTML5 drag-and-drop can land incrementally. Without the column, retrofitting ordering later requires a data migration.

**Complexity:** S. Column + one sort clause.

---

## Deferred (v1.5+, reasons specific to CE single-user)

### Def1. Multi-workspace switching
CE is single-user; workspaces are overhead. **Keep the column everywhere** so EE can enable it. The CE UI has no workspace switcher.

### Def2. activity_log table
Multica has the schema (`001:156`) and a `CreateActivity` SQL query — but grep shows zero production callers, only test helpers (`activity_test.go:37,121`). Multica effectively dropped this feature and drives the issue timeline from the `comment` table with `type='status_change' | 'system'`. CE should skip the table entirely. The Timeline UI reads comments.

### Def3. Inbox items / notifications
Multica `inbox_item` (`001:110`) is a notification aggregator for multi-user workflows ("@ mentioned you", "assigned to you"). In single-user CE there's nobody to notify except the one logged-in user. Use WS push for live updates; skip the persisted inbox.

### Def4. Issue dependencies / parent_issue_id
Multica `issue_dependency` (`001:89`) and `issue.parent_issue_id` support epic/story hierarchies. Single-user CE users can achieve the same with labels or manual cross-references in descriptions. Add later if users complain.

### Def5. Session resume (session_id per task)
Multica `agent_task_queue.session_id` (`020_task_session`) enables `claude --resume <session_id>` across tasks on the same issue. This is a real workflow improvement but **the daemon backend owns the logic** — the server just persists the string. CE v1.4 should write the column but punt on the daemon-side resume logic. Store it; don't teach the daemon to use it until v1.5.

### Def6. Autopilots (scheduled/triggered automations)
Multica `autopilot` + `autopilot_trigger` + `autopilot_run` (`042`). Rich feature — cron-scheduled task creation, webhook triggers, three concurrency policies. Too much surface for v1.4.

### Def7. Projects (issue grouping above label-level)
Multica `project` (`034`). Users can organise with labels or custom workspaces later. Not blocking.

### Def8. Attachments on issues / comments
Multica `attachment` (`029_attachment`). File upload + S3 integration. CE has no blob store today. Add when there's demand.

### Def9. Comment reactions / issue reactions
Multica `comment_reactions` (`026`), `issue_reactions` (`027`). Team social features; pointless for single user.

### Def10. Workspace invitations / members / roles
Multica `member` (`001:26`) with owner/admin/member roles. CE already has single-user auth. EE's job.

### Def11. Mentions (@agent, @user)
Multica mention parsing (`enqueueMentionedAgentTasks` etc.) triggers tasks on non-assignee agents. In single-user CE, there's no second human to @-mention. An `@agent` mention that triggers a task on a non-assignee agent is a genuinely useful feature (ping a specialist agent into the thread), but we can land it in v1.5 once the basic issue→agent flow is proven.

### Def12. Issue search across workspaces / pgvector semantic search
PROJECT.md explicitly scopes search to "simple LIKE" for SQLite. Defer pgvector; future EE.

### Def13. Personal Access Tokens (PATs)
Multica `011_personal_access_tokens`. Distinct from daemon tokens — PATs are for users driving the API (e.g., their own scripts). CE v1.4 already has cookie JWT auth; add PATs when users ask.

### Def14. Comment search index, issue search index
Multica `032_issue_search_index`, `033_comment_search_index` use `pg_bigm`. SQLite CE uses `LIKE` — no extension needed. Revisit if the LIKE queries become slow at 10k+ issues.

### Def15. Structured skills / skill files
See §D2 above. Ship schema in v1.4, defer UI.

---

## Anti-features (out of scope for CE, with reason)

### A1. Multi-tenant cloud billing / usage tracking
Multica `runtime_usage` (`013`) was added then **dropped in `046_drop_runtime_usage`**. Even multica decided this was premature. CE has no billing surface.

### A2. Daemon OAuth pairing flow with pending-approval UI
Multica's migration `005` introduced a daemon pairing session (token, QR-code, human-approve). Migration `029` dropped it and replaced with pre-generated daemon tokens. CE should copy the final state, not the abandoned intermediate. Anti-feature because it duplicates pairing with no UX benefit in single-user mode.

### A3. Workspace invitations / email verification codes
Migrations `009`, `010`, `041_workspace_invitation`. All multi-user team ops. CE has one user, no email flow.

### A4. Issue repositories (per-issue git repo)
Multica `001` had `issue_repository` which was **dropped in `007_drop_issue_repository`**. Issue-scoped repo linking was replaced by workspace-level `workspace_repos` (migration `014`). Copy the current model.

### A5. Pinned items / attachments dashboard
Multica `038_pinned_items`, UI polish. Not in CE v1.4 scope.

### A6. Workspace context / workspace repos / workspace metadata feature
Multica `006_workspace_context`, `014_workspace_repos`. Relevant for teams mapping multiple repos to one workspace. CE is single-project initially; defer.

### A7. Verification codes / email login
Multica `009`, `010`. CE uses cookie JWT; no email loop required.

### A8. Agent custom_env value encryption at rest
Multica stores `custom_env` in plaintext JSONB. Aquarium already has a credential vault with AES-256-GCM (per CLAUDE.md). **Tempting to encrypt**, but the value lives in the agent config for injection into subprocesses; adding encryption to a new subsystem in the same milestone risks scope creep. Redaction at API boundary is sufficient for v1.4. Flag for v1.5 hardening.

### A9. "In-review" issue status
See §4. Human-review workflows don't exist in single-user CE. Drop the status entirely rather than leaving it unused.

---

## Feature Dependency Graph

```
Workspace (1)
   ├── Runtime (3) ──┬── hosted-instance ← existing Aquarium instances (reuse gatewayCall)
   │                 ├── local-daemon ── Daemon REST API (9)
   │                 │                    └── Daemon token auth (9)
   │                 └── external-cloud-daemon ── Daemon REST API (same)
   │
   └── Agent (2) ── points to Runtime
         ├── Custom env / args (D3)   ← needed for per-agent API tiers
         ├── max_concurrent_tasks (10)
         └── Skills (D2, schema only)
                  ↓
              Issue (4) ──┬── status state-machine (6 values, no in_review)
                          ├── position (D6, for kanban)
                          ├── labels (D5, deferred)
                          │
                          ├── Comments (7) ←── trigger_comment_id (6)
                          │                      ↑
                          │                      │ cited by
                          │                      │
                          └── Task (5) ── issue_id + trigger_comment_id
                                  ├── task_messages (8) ← hosted driver streams here
                                  ├── session_id / work_dir (Def5: persist only)
                                  ├── claim respects max_concurrent_tasks (10)
                                  └── sweeper cancels on runtime offline (11)

      Chat-on-issue (D1) ── parallel to Issue comments, reuses task_messages (8)
```

**Critical ordering for phase sequencing:**

1. **Schema + Workspace seed** must land before anything else.
2. **Runtime** before Agent (FK dependency).
3. **Agent + Issue + Task schema** together (same migration batch — they're mutually referential).
4. **Daemon API + daemon-token auth** before daemon CLI (duh).
5. **task_message streaming** depends on task CRUD being complete.
6. **Hosted-instance driver** depends on task_message and the runtime type being persisted.
7. **UI (kanban + detail)** depends on all server APIs being in place.
8. **Chat-on-issue** last — optional, depends on task_message streaming working.

---

## Hosted-Instance Driver — Feature Flow

This is the Aquarium-specific piece. The driver is a **server-side module** (not a separate process). When a task's runtime is `kind='hosted_instance'`, no daemon claim/poll happens — the server orchestrates end-to-end using Aquarium's existing gateway-RPC infrastructure.

### Driver lifecycle

**Trigger:** `TaskService.EnqueueTaskForIssue` writes a `task` row with `status='queued'`. For hosted-instance runtimes, the server **immediately dispatches** (no daemon claim roundtrip).

```
┌──────────────────────────────────────────────────────────────┐
│ Enqueue task (runtime.kind='hosted_instance')                │
│    ↓                                                         │
│ HostedInstanceDriver.dispatch(task)                          │
│    ↓                                                         │
│ 1. Resolve instance_id from runtime.metadata.instance_id     │
│ 2. Verify instance.status === 'running'                      │
│    (if not, fail task with "instance offline")               │
│ 3. Load agent.instructions + custom_env + custom_args        │
│ 4. Compose prompt:                                           │
│      - System: agent.instructions                            │
│      - User: "[Issue AQ-123] {issue.title}\n\n{description}" │
│      - Trailing: trigger comment content (if any)            │
│ 5. sessionKey = `task-${task.id}` (stable for this task)    │
│ 6. Subscribe to gateway chat events for this sessionKey      │
│    (reuse sendToChatSession subscription path)               │
│ 7. Update task status: queued → dispatched → running         │
│ 8. Call: gatewayCall(instanceId, 'chat.send', {              │
│           sessionKey, message: composedPrompt,               │
│           idempotencyKey: task.id                            │
│         }, timeoutMs = 120_000)                              │
│    ↓                                                         │
│ Gateway streams back 'chat' events                           │
│ (already routed through gateway-event-relay.ts:425)          │
│    ↓                                                         │
│ 9. For each chat event payload:                              │
│      - Translate content parts to task_message rows:         │
│          {type:'text', text} → task_message(type='text')     │
│          {type:'toolCall', name, arguments}                  │
│                                    → task_message(           │
│                                      type='tool_use',        │
│                                      tool=name,              │
│                                      input=arguments)        │
│          {type:'toolResult', output}                         │
│                                    → task_message(           │
│                                      type='tool_result',     │
│                                      output=output)          │
│      - Emit WS event on issue room                           │
│    ↓                                                         │
│ 10. On state='final':                                        │
│       - Call TaskService.completeTask(task.id, result,       │
│                                        sessionId='', workDir='')│
│       - Post final text as agent comment (trigger_comment_id │
│         controls thread placement)                           │
│    ↓                                                         │
│ 11. On state='error' or subscription timeout:                │
│       - Call TaskService.failTask(task.id, errorMessage)     │
└──────────────────────────────────────────────────────────────┘
```

### Reuse points from existing Aquarium code

| What | Where | Notes |
|------|-------|-------|
| Send RPC | `gatewayCall(instanceId, 'chat.send', params)` at `apps/server/src/agent-types/openclaw/gateway-rpc.ts:12` | Already handles queued-when-disconnected with 30 s timeout |
| Event subscription | `gateway-event-relay.ts:425–500` — chat events are already routed by `sessionKey` | Just register as a subscriber with `sendToChatSession` |
| Content parts translator | `extractTextFromContent` at `gateway-rpc.ts:130` shows the content-part shape | Extend to branch on type: text / toolCall / toolResult |
| Instance health | `apps/server/src/services/instance-manager.ts` — `instances.status = 'running'` | Driver checks before dispatch |
| Completion promise | `waitForChatCompletion(instanceId, sessionKey, timeoutMs)` at `gateway-event-relay.ts:808` | Can reuse directly; its resolved payload gives the final content |

### Auth path

Gateway RPC already authenticates via the instance's `authToken` (stored in `instances.auth_token` and embedded in the WS protocol v3 handshake). **No additional auth is required** for hosted-instance dispatch — the server is already authenticated with the gateway via the persistent client that `gatewayCall` uses. This is a significant simplification vs daemon runtimes (which need `mdt_` bearer tokens).

### Stream-json equivalence

Gateway `chat` events are already structured as parts (`text`, `toolCall`, `toolResult`). This is functionally equivalent to Claude Code's `stream-json` output. The driver just renames types:

| Gateway part type | task_message.type | Fields |
|-------------------|-------------------|--------|
| `text` | `text` | `content = part.text` |
| `toolCall` | `tool_use` | `tool = part.name`, `input = part.arguments` |
| `toolResult` | `tool_result` | `output = part.output`, `tool = part.toolName` |
| `thinking` (if emitted) | `thinking` | `content = part.text` |

**Not supported by Gateway today:** `system_message` (e.g., "Initializing Claude Code agent…"). OK — those are cosmetic CLI banners that don't need to render in the issue timeline.

### Failure modes and their handlers

| Failure | Detected by | Handler |
|---------|-------------|---------|
| Instance not running at dispatch | Driver's pre-flight status check | Fail task immediately with reason="instance offline" |
| Instance crashes mid-task | `getGatewayClient` returns null on next send / subscription fires `state='error'` | `waitForChatCompletion` rejects → driver calls `failTask` |
| Chat response timeout | `waitForChatCompletion` timer | Reject promise → failTask with "timeout" |
| Malformed chat part | Translator's `extractTextFromContent` fallback (`JSON.stringify(part)`) | Still stored as `task_message` with `type='text'` so nothing silently drops |

### What hosted-instance does NOT support (yet)

- **Session resume across tasks** — Gateway doesn't expose a `session_id` concept. Persist empty string in `task.session_id` for hosted-instance tasks. If `--resume` semantics matter, user can add `skill:memory` or similar on the gateway side.
- **Custom work_dir** — Hosted instances have a fixed container filesystem. Persist empty string. User repos are exposed via plugins/mounts at instance creation, not per-task.
- **Custom CLI args** — There's no CLI to pass args to. Agent `custom_args` is ignored (log a warning if non-empty).
- **Custom env** — Gateway env is set at container launch. Agent `custom_env` is ignored (log a warning if non-empty). Document this limitation; users needing per-agent env should pick a daemon runtime instead.

---

## Open Questions for Architecture / Pitfalls

These surfaced during feature analysis and should be resolved during architecture research or flagged as pitfalls.

1. **UUIDs in SQLite** — multica uses Postgres `gen_random_uuid()`. SQLite has no native UUID type. Recommended: store as `TEXT` with `uuid v4` generated in Node (`crypto.randomUUID()`), matching existing Aquarium `instances.id` pattern. Existing Aquarium migrations already use this approach (verify in a spot-check).

2. **JSONB substitute** — SQLite has no JSONB type. Use `TEXT` with JSON content and `JSON()` SQLite functions if ever querying inside. For `custom_env`, `runtime_config`, etc., treat as opaque strings serialised in app code (multica uses this pattern too — see `agent.go:49–67` which always `json.Unmarshal`s).

3. **Per-(issue, agent) unique pending-task index on SQLite** — multica's `037` uses PostgreSQL partial unique indexes (`WHERE status IN (…)`). SQLite supports partial unique indexes since 3.8.0 so this works directly — but confirm the better-sqlite3 / knex version in use handles the `WHERE` clause. If not, fall back to a trigger.

4. **Concurrent task claims race** — multica uses `FOR UPDATE SKIP LOCKED` (implicit via `ClaimAgentTask`) to atomically claim one task. SQLite is single-writer so this is naturally safe, but the count-then-claim pattern still has a read-then-write gap. Wrap claim in `BEGIN IMMEDIATE` transaction on SQLite to serialise.

5. **Hosted-instance dispatch back-pressure** — nothing stops enqueuing 100 hosted-instance tasks in parallel against one gateway. The gateway's own concurrency limits will thrash. Architecture research should determine whether to (a) enforce `max_concurrent_tasks` on hosted runtimes as a server-side semaphore, or (b) let the gateway reject and the server handle the rejection. Recommendation: enforce server-side, matching daemon runtime behaviour.

6. **Daemon token workspace vs user scoping** — multica scopes daemon tokens to workspaces, but CE has one workspace and one user. Does the token carry user identity for audit purposes? Recommendation: daemon tokens in CE still carry `created_by_user_id` so activity trail attributes "agent XYZ assigned by {daemon_token:foo}" correctly.

7. **Issue identifier (AQ-123) collision with template import** — importing a template with embedded issue references from another deployment risks identifier collision. Templates today are agent-scoped, not issue-scoped, so probably fine for v1.4. Flag for pitfalls doc.

8. **Tasks on archived agents** — multica's `EnqueueTaskForIssue` rejects if agent is archived (`task.go:47`). What about tasks already queued when the agent is archived? Multica cancels via `CancelAgentTasksByAgent`. CE should match. Flag the race window (enqueue → archive in same tick) as a pitfall.

9. **Hosted-instance instance deletion while task running** — if user deletes an Aquarium instance mid-task, the driver needs to notice and fail the task. Hook into existing instance lifecycle events (`instance:stopping`) and cancel all in-flight hosted-instance tasks targeting that instance.

10. **Multi-runtime-per-agent migration path** — multica originally had agents carrying `runtime_mode` + `runtime_config`; migration 004 normalised this into `agent_runtime`. CE can skip the pain and design the schema post-normalised, but confirm with the template-import system whether existing templates carry `runtime_mode` that needs transparent migration.

---

## Sources

All findings above cite either:
- **Multica source** at `/tmp/multica` (init schema, 46 migrations, Go handler/service files) — directly inspected, confidence HIGH.
- **Aquarium source** at `apps/server/src/agent-types/openclaw/gateway-rpc.ts`, `apps/server/src/services/gateway-event-relay.ts`, `apps/server/src/services/instance-manager.ts` — directly inspected, confidence HIGH.
- **PROJECT.md** at `.planning/PROJECT.md` — milestone scope explicitly defines "Out of Scope" items; some Deferred categories above are direct lifts from that list with elaborated reasoning.

No claims rely on training data alone. No WebSearch was performed because the question is "what does multica do and how do we port it", and multica's source code is the authoritative answer.
