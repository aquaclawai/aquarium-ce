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

### Active


- [ ] Daemon REST API: register / heartbeat / deregister / claim / start / progress / messages / complete / fail / status endpoints with daemon-token middleware
- [ ] Node daemon CLI: `aquarium daemon start` auto-detecting claude / codex / openclaw / opencode / hermes on PATH
- [ ] TS agent backends with stream-json parsing for at least claude-code, codex, openclaw, opencode
- [ ] Hosted runtime mode: existing Aquarium instances dispatched via gateway RPC as a built-in server-side task driver
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
*Last updated: 2026-04-16 after Phase 18 (Task Queue & Dispatch) completion*
