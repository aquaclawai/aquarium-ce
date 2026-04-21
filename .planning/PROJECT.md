# Aquarium CE — Plugin & Skill Marketplace

## What This Is

A self-hosted AI agent management platform (Aquarium CE) that manages OpenClaw gateway instances. This milestone adds the ability for users to browse, install, configure, and authenticate OpenClaw plugins and skills directly from the Aquarium dashboard — replacing manual config editing and CLI access.

## Core Value

Users can discover and activate extensions for their AI agent instances without leaving the dashboard, with credentials encrypted at rest and untrusted code blocked by default.

## Current Milestone: v1.4 Task Delegation Platform

**Goal:** Transform Aquarium CE into a multica-style task-delegation platform where users assign structured Issues to Agents, which execute as Tasks on Runtimes — unifying platform-hosted instances and external CLI agents (Claude Code, Codex, Hermes, etc.) installed on user machines via a local daemon.

**Target features:**
- Workspace / Agent / Runtime / Issue / Task data model (multica-aligned)
- Daemon REST API: register / heartbeat / claim / task lifecycle endpoints with daemon-token auth
- Node.js daemon CLI (`aquarium daemon start`) — auto-detects local CLIs on PATH and registers each as a Runtime
- TS agent backends: spawn + stream-json parsing for Claude Code, Codex, OpenClaw, OpenCode, Hermes
- Hosted runtime driver: existing Aquarium Docker instances exposed as a third Runtime mode, executing tasks via gateway RPC
- Web UI: Issue kanban board, Issue detail with live task message streaming, Agents + Runtimes management, Daemon token issuance
- Issue-centric chat with task event streaming (replaces ad-hoc extension sessions for task-oriented flows)

## Requirements

### Validated

- [x] Schema: workspace / runtimes / agents / issues / comments / agent_task_queue / task_messages / daemon_tokens tables with SQLite WAL + busy_timeout PRAGMAs and v1.4 shared types (validated in Phase 15)
- [x] Runtime registry + bridge: unified `GET /api/runtimes` listing hosted + daemon runtimes, automatic mirroring of existing Aquarium instances into `runtimes` table via InstanceManager hooks, derived-via-JOIN status for hosted rows, and 30s offline sweeper for daemon heartbeats — all without modifying InstanceManager's write path (validated in Phase 16)
- [x] Agents / Issues / Comments REST services: `/api/agents` with soft-archive preserving FKs + MCT validation, `/api/issues` with atomic `issue_number` allocation + fractional kanban reorder, `/api/comments` with threaded replies, and the Phase-17 slice of `task-queue-store` (enqueue + cancel only) wired into `applyIssueSideEffects` so assignment/reassignment/cancellation drive the task lifecycle atomically, plus auto-emitted `status_change` system comments (validated in Phase 17)
- [x] Task Queue & Dispatch service surface: atomic `claimTask` under `BEGIN IMMEDIATE` + partial-unique coalescing, lifecycle transitions (`startTask` / `completeTask` / `failTask` / `cancelTask` / `isTaskCancelled`) with `.andWhere('status', <expected>)` race guards, `{ discarded: true }` semantics on complete/fail of already-cancelled tasks, 500ms `task-message-batcher` with `MAX(seq)+1` + `UNIQUE(task_id, seq)` backstop, and 30s `task-reaper` (5min `dispatched` / 2.5h `running` thresholds, `julianday()` timestamp compare) wired at `server-core.ts` Step 9c; every cancel path now fans out `task:cancelled` WS broadcasts (validated in Phase 18)
- [x] Daemon REST API + Auth: `requireDaemonAuth` middleware (SHA-256 + `crypto.timingSafeEqual` + no-cache DB lookup), AUTH1 guard on user `requireAuth` that rejects `adt_*` bearer tokens, `/api/daemon/*` router with 10 endpoints (register/heartbeat/deregister + claim + start/progress/messages/complete/fail/status) wrapping Phase 16/17/18 services, rate-limit topology (skip predicates exempting `/api/daemon/*` from global limiters + per-token `daemonBucket` at 1000/60s), and user-facing `/api/daemon-tokens` CRUD (plaintext shown exactly once on POST; GETs return hashed projection only); Playwright E2E spec covers SC-1..SC-5 (validated in Phase 19)
- [x] Hosted-Instance Driver: `registerChatStreamListener` multi-shot hook on gateway-event-relay, `HostedTaskWorker` (2s tick, claim loop, `gatewayCall('chat.send')` with 30s RPC-accept + 120s completion-wait split, event→row mapper via Phase-18 batcher, REACTIVE cancel watcher at `CANCEL_POLL_MS=2000` firing `chat.abort` independent of stream events, ignored-fields WARN for `custom_env`/`custom_args`/`session_id`/`work_dir`, `isGatewayConnected` skip guard, ST5 invariant enforced by DB-snapshot test), and `failOrphanedHostedTasks` one-shot boot sweep wired as Step 9b before the Phase-18 reaper (validated in Phase 20)

### Active


- [ ] Node daemon CLI: `aquarium daemon start` auto-detecting claude / codex / openclaw / opencode / hermes on PATH
- [ ] TS agent backends with stream-json parsing for at least claude-code, codex, openclaw, opencode
- [ ] Issue board + Issue detail page with live task message streaming (tool_use / tool_result / text)
- [ ] Agent/Runtime management UI and daemon token issuance UI
- [ ] Chat-on-issue experience with WebSocket streaming of task lifecycle events

### Out of Scope

- Plugin development within Aquarium — unchanged from prior milestones
- Chat-based extension management — unchanged
- Per-plugin process isolation — requires upstream OpenClaw architecture changes
- Multi-workspace switching in CE (schema keeps workspace_id but CE uses a single default workspace; EE is free to enable)
- Multica-style Skills / Projects / Labels / Autopilots / Inbox richness / Attachments / Session resume — deferred to v1.5+
- pgvector-style semantic search over issues — SQLite CE keeps simple LIKE-based search

## Context

- **Existing codebase:** Express backend + React frontend + SQLite + Docker runtime
- **PRD:** `docs/prd-plugin-skill-marketplace.md` — 1120 lines, 47 resolved design decisions from 15 rounds of adversarial review
- **OpenClaw gateway:** Plugins run in-process (single trust boundary), skills are prompt-injected via SKILL.md
- **Credential system:** Existing 3-layer resolution (instance → user vault → error) with AES-256-GCM encryption
- **Template system:** Existing export/import with .octemplate ZIP format, secret scrubbing for MCP configs
- **Gateway RPC:** Existing WebSocket protocol v3 with 3-step auth handshake
- **Community pain points:** 3.2hr median setup time, ClawHub malware crisis (12-17% of skills malicious), plugin module resolution regressions

## Constraints

- **Tech stack**: Must use existing patterns — Express routes → services → DB/runtime, SQLite via better-sqlite3, React 19, CSS variables (no Tailwind)
- **Gateway architecture**: Cannot modify OpenClaw's in-process plugin model — scoped credential injection is defense-in-depth, not true isolation
- **config.patch rate limit**: 3/minute by gateway — batch credential updates
- **i18n**: All UI strings in 6 locale files (en, zh, fr, de, es, it)
- **ESM imports**: Server `.ts` imports MUST use `.js` extension

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| DB as single writer, chat commands disabled | Prevents state divergence between dashboard and gateway | — Pending |
| Deny-by-default trust for community code | ClawHub malware crisis (12-17% malicious) | — Pending |
| Extension lifecycle state machine with 6 states | Explicit failure recovery, no silent state loss | — Pending |
| Per-subprocess execution deadlines (not lock timeouts) | Kill stuck process, then release lock cleanly | — Pending |
| Server session UUID instead of PID | PID reuse unreliable in containers | — Pending |
| All tiers use env-backed SecretRef (no plaintext) | Config file never contains raw secrets | — Pending |
| Plugin install defers config.patch to activation | Prevents accidental loading by other restarts | — Pending |
| 3-phase startup with reconcile-before-replay | Crash-recovered extensions checked before blind reinstall | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-17 after Phase 24 (Issue Detail UI + Task Message Streaming) completion — users now see per-issue detail at `/issues/:id` with threaded comments, live task-message streaming via WS `subscribe_task` (tool_use / tool_result / text / thinking kinds), 16 KB server-side truncation + overflow-row persistence (UX6 mitigation), React 19 `useTransition` + virtualization for 500+ messages (ST3 mitigation), buffered-replay + pause/resume reconnect ordering (ST2 invariant), CHAT-01 chat-on-issue loop (user → task with `trigger_comment_id` → streamed response → threaded agent comment), zero `dangerouslySetInnerHTML` in detail components (CI-enforced), and native translations for `issues.detail.*` + `chat.*` across all 6 locales. UI-04..08 + CHAT-01 SHIPPED.*

*Last updated: 2026-04-17 after Phase 25 (Management UIs) completion — users now manage agents, runtimes, and daemon tokens at `/agents`, `/runtimes`, and `/daemon-tokens`. Closes MGMT-01 (agents CRUD with soft-archive / restore, Active + Archived tabs, per-agent Status column, custom env + custom args editors, 1–16 max-concurrent validation), MGMT-02 (unified runtimes list merging hosted-instance + local-daemon + cloud-daemon kinds behind kind-filter chips with live count badges, read-only detail sheet surfacing device_info JSON + metadata), and MGMT-03 (daemon tokens with copy-once plaintext — HARD security invariant: plaintext never enters React state outside the CopyOnce dialog, never stored in localStorage / sessionStorage, never announced via `{{plaintext}}` interpolation in any locale's a11y key; grep-guarded in CI). Every new string localized across all 6 locales (en + zh + fr + de + es + it); i18n parity gate green (2231 keys). Phase 25 wave summaries: [25-00-SUMMARY.md](phases/25-management-uis/25-00-SUMMARY.md) (foundation routes + sidebar entries + en-complete copywriting), [25-01-SUMMARY.md](phases/25-management-uis/25-01-SUMMARY.md) (Agents page + form + archive/restore), [25-02-SUMMARY.md](phases/25-management-uis/25-02-SUMMARY.md) (unified runtimes list + detail sheet), [25-03-SUMMARY.md](phases/25-management-uis/25-03-SUMMARY.md) (daemon tokens with copy-once plaintext), [25-04-SUMMARY.md](phases/25-management-uis/25-04-SUMMARY.md) (zh/fr/de/es/it translations). Ready for Phase 26 (integration, boot wiring, E2E, release).*
