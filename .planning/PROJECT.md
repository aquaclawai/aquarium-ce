# Aquarium CE — Plugin & Skill Marketplace

## What This Is

A self-hosted AI agent management platform (Aquarium CE) that manages OpenClaw gateway instances. This milestone adds the ability for users to browse, install, configure, and authenticate OpenClaw plugins and skills directly from the Aquarium dashboard — replacing manual config editing and CLI access.

## Core Value

Users can discover and activate extensions for their AI agent instances without leaving the dashboard, with credentials encrypted at rest and untrusted code blocked by default.

## Current Milestone: v1.3 Gateway Communication Overhaul

**Goal:** Redesign platform ↔ gateway communication so the gateway is the source of truth when containers are running, replacing the current DB-first pattern with gateway-first operations and event-driven state sync.

**Target features:**
- Route all RPC calls through the persistent WebSocket connection (eliminate ephemeral connections)
- Event-driven DB sync — listen to gateway events to update DB state
- Gateway-first config updates — operate on gateway, sync DB on success
- Hot-reload extensions via config.patch instead of full container restarts
- Eliminate config file rewrites for running instances (only seed on creation)
- Fix config integrity check to stop fighting gateway normalization
- Add gateway-level health checks alongside Docker container status polling

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Extension lifecycle state machine (pending → installed → active → disabled/degraded/failed)
- [ ] Per-instance fenced operation locks with cooperative cancellation
- [ ] Skill install/configure/enable/disable/uninstall via dashboard
- [ ] Plugin install/configure/activate/enable/disable/uninstall via dashboard
- [ ] Bundled + ClawHub catalog browsing with trust signals
- [ ] Deny-by-default trust policy (bundled/verified allow, community/unscanned block)
- [ ] Admin trust override with credential-access consent and audit trail
- [ ] Extension-scoped credential injection via SecretRef (all tiers)
- [ ] Template export with workspace allowlist, config scrubbing, trust re-evaluation on import
- [ ] Version pinning with integrity hash verification
- [ ] 3-phase startup (seedConfig → boot+reconcile → pending replay)
- [ ] OAuth proxy flow for plugins requiring browser-based auth
- [ ] Offline artifact caching for air-gapped deployments

### Out of Scope

- Plugin development within Aquarium — out of scope for management platform
- Chat-based extension management — disabled for managed instances (§5.7)
- Per-plugin process isolation — requires upstream OpenClaw architecture changes
- Arbitrary user-selected file export — dropped from v1 due to unresolvable secret-leakage risk

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

---
*Last updated: 2026-04-05 after v1.3 milestone initialization*
