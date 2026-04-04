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

**Status:** In Progress
**Started:** 2026-04-05
**Phases:** 9-13

Redesign platform-to-gateway communication so the gateway is the source of truth when containers are running. Route all RPC through the persistent WebSocket, implement gateway-first config updates, reconnect-driven state sync, batched extension operations via config.patch, and gateway-level health checks.
