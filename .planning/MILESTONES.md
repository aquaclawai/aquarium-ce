# Milestones

## v1.0 — Aquarium CE Core

**Status:** Shipped
**Phases:** 1-N (existing codebase)

Core platform: instance management, Docker runtime, credential storage, template system, WebSocket relay, chat proxy, MCP server configuration, user authentication.

---

## v1.1 — Plugin & Skill Marketplace

**Status:** Shipped
**Started:** 2026-04-03
**Completed:** 2026-04-04
**Phases:** 1-6

Full plugin/skill lifecycle management with deny-by-default security, fenced concurrency, version-pinned durability, and template portability.

---

## v1.2 — Gateway Simplification & Plugin Fixes

**Status:** Shipped
**Started:** 2026-04-04
**Completed:** 2026-04-05
**Phases:** 7-8

Remove redundant CE-specific workarounds (TCP proxy, custom entrypoint logic) now that the official OpenClaw gateway supports them natively, and fix plugin/extension bugs found during v1.1 testing.

---

## v1.3 — Gateway Communication Overhaul

**Status:** Shipped
**Started:** 2026-04-05
**Completed:** 2026-04-05
**Phases:** 9-14

Redesigned platform-to-gateway communication so the gateway is the source of truth when containers are running. Routed all RPC through the persistent WebSocket, implemented gateway-first config updates, reconnect-driven state sync, batched extension operations via config.patch, gateway-level health checks, and a platform-bridge cleanup that moved ClawHub catalog fallback into the platform itself.

---

## v1.4 — Task Delegation Platform

**Status:** In Progress
**Started:** 2026-04-16
**Phases:** 15+

Transform Aquarium CE into a multica-style task-delegation platform: users assign structured Issues to Agents that execute as Tasks on Runtimes, where a Runtime is either a platform-hosted Docker instance (existing) or an external CLI (Claude Code, Codex, Hermes, OpenClaw, OpenCode) registered via a Node.js daemon installed on a user machine. Introduces Workspace/Agent/Runtime/Issue/Task/Comment schema, daemon REST API with token auth, a unified Issue board and task-streaming UI, and a server-side hosted-runtime driver that bridges task execution to the existing gateway RPC layer.
