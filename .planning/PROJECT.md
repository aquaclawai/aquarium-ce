# Aquarium CE — Plugin & Skill Marketplace

## What This Is

A self-hosted AI agent management platform (Aquarium CE) that manages OpenClaw gateway instances. This milestone adds the ability for users to browse, install, configure, and authenticate OpenClaw plugins and skills directly from the Aquarium dashboard — replacing manual config editing and CLI access.

## Core Value

Users can discover and activate extensions for their AI agent instances without leaving the dashboard, with credentials encrypted at rest and untrusted code blocked by default.

## Current Milestone: v1.2 Gateway Simplification & Plugin Fixes

**Goal:** Remove redundant CE-specific workarounds now that the official OpenClaw gateway supports them natively, and fix plugin/extension bugs found during v1.1 testing.

**Target features:**
- Remove TCP proxy injection — use native `gateway.bind: lan`
- Remove conflicting RPC methods from platform-bridge plugin (skills.install/uninstall conflict with native)
- Fix empty Available catalog after gateway restart (plugin loading failure)
- Fix plugins.install handler causing gateway config corruption
- Backend graceful degradation for unsupported RPC methods
- Frontend response shape and source format fixes for Extensions tab
- Simplify custom Docker entrypoint

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
*Last updated: 2026-04-04 after v1.2 milestone initialization*
