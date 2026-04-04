---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Plugin & Skill Marketplace
status: planning
stopped_at: Completed 05-oauth-advanced-auth-03-PLAN.md
last_updated: "2026-04-04T06:44:47.984Z"
last_activity: 2026-04-03 — Roadmap created, 52 requirements mapped across 6 phases
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 23
  completed_plans: 23
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Users can discover and activate extensions without leaving the dashboard, with credentials encrypted and untrusted code blocked by default
**Current focus:** Phase 1 — Skill Management

## Current Position

Phase: 1 of 6 (Skill Management)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-04-03 — Roadmap created, 52 requirements mapped across 6 phases

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-skill-management P01 | 20 | 2 tasks | 3 files |
| Phase 01-skill-management P03 | 160 | 2 tasks | 3 files |
| Phase 01-skill-management P04 | 15 | 2 tasks | 3 files |
| Phase 01-skill-management P05 | 6 | 2 tasks | 11 files |
| Phase 01-skill-management P06 | 3 | 1 tasks | 9 files |
| Phase 01-skill-management P07 | 2 | 2 tasks | 2 files |
| Phase 02-plugin-management P01 | 250 | 2 tasks | 3 files |
| Phase 02-plugin-management P02 | 2 | 1 tasks | 2 files |
| Phase 02-plugin-management P03 | 6 | 2 tasks | 12 files |
| Phase 02-plugin-management P04 | 11 | 3 tasks | 10 files |
| Phase 03-clawhub-trust-policy P02 | 3 | 2 tasks | 4 files |
| Phase 03-clawhub-trust-policy P01 | 5 | 2 tasks | 3 files |
| Phase 03-clawhub-trust-policy P03 | 15 | 2 tasks | 5 files |
| Phase 03-clawhub-trust-policy P04 | 15 | 2 tasks | 11 files |
| Phase 03-clawhub-trust-policy P05 | 5 | 2 tasks | 9 files |
| Phase 03-clawhub-trust-policy P06 | 3 | 1 tasks | 2 files |
| Phase 04-template-portability P02 | 10 | 2 tasks | 3 files |
| Phase 04-template-portability P01 | 15 | 2 tasks | 4 files |
| Phase 04-template-portability P03 | 4 | 2 tasks | 2 files |
| Phase 05-oauth-advanced-auth P02 | 181 | 2 tasks | 3 files |
| Phase 05-oauth-advanced-auth P01 | 231 | 2 tasks | 5 files |
| Phase 05-oauth-advanced-auth P03 | 174 | 3 tasks | 11 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- DB as single writer, chat commands disabled — prevents state divergence between dashboard and gateway
- Deny-by-default trust for community code — ClawHub malware crisis (12-17% malicious)
- Per-subprocess execution deadlines (not lock timeouts) — kill stuck process, then release lock cleanly
- Server session UUID instead of PID — PID reuse unreliable in containers
- All tiers use env-backed SecretRef (no plaintext) — config file never contains raw secrets
- [Phase 01-skill-management]: ExtensionSkillSource and ExtensionCredentialRequirement named to avoid conflicts with existing template declaration types
- [Phase 01-skill-management]: Partial unique index idx_one_active_op created via knex.raw() for one-active-op-per-instance enforcement
- [Phase 01-skill-management]: serverSessionId uses randomUUID() at module load for container-safe orphan detection (PID reuse unreliable)
- [Phase 01-skill-management]: GET /skills returns empty gatewayBuiltins when instance not running — avoids 400 for list-only callers
- [Phase 01-skill-management]: SecretRef env var ID uses 16-char SHA-256 hex truncation of kind_id_field — unique without being unwieldy
- [Phase 01-skill-management]: config.patch failure is partial success (credential stored, configPatched: false) — lock still released
- [Phase 01-skill-management]: reconcileExtensions integrated into startInstanceAsync (instance-manager.ts) — adapter.ts has no post-boot hook, instance-manager owns the boot flow
- [Phase 01-skill-management]: reconcileExtensions is non-blocking — failure logs warning but never prevents instance reaching running state
- [Phase 01-skill-management]: Gear icon in SkillRow sets configuringSkillId state in parent ExtensionsTab only — no modal, no API — CredentialConfigPanel consumes this state in Plan 01-06
- [Phase 01-skill-management]: Extensions tab placed after Chat in main tab bar (not in ADVANCED_TABS dropdown); catalog hidden when instance not running
- [Phase 01-skill-management]: Gear icon toggles credential panel (second click closes) — prevents orphaned open panels
- [Phase 01-skill-management]: Alert banners placed above sub-tab header — visible regardless of active sub-tab
- [Phase 01-skill-management]: color-mix() for alert tints — theme-aware, no hardcoded RGBA
- [Phase 01-skill-management]: uninstallSkill cancel: return early without DB row cleanup — skill row stays as-is, no intermediate state to clean up (simpler than installSkill)
- [Phase 01-skill-management]: INFRA-07 marked complete for Phase 1 scope: skills (3min) and config.patch (30s) enforced; npm and restart are Phase 2 concerns
- [Phase 02-plugin-management]: DB-first activation: update status to active before restartInstance so seedConfig picks it up without config.patch RPC
- [Phase 02-plugin-management]: commands.plugins=false enforced in seedConfig for all managed instances (PLUG-10 single-writer)
- [Phase 02-plugin-management]: plugins.list RPC failure is soft-logged — older gateway versions may not support the method
- [Phase 02-plugin-management]: PLUG-04 confirmed: extension-credentials route already handles extensionKind='plugin' at line 59 — no modification needed
- [Phase 02-plugin-management]: Plugin route ordering: catalog route defined before :pluginId route to prevent route capture by Express
- [Phase 02-plugin-management]: plugins.list RPC failure in GET /plugins is soft-logged (warn) — older gateway versions may not support the method
- [Phase 02-plugin-management]: extensionKind discriminator prop on ExtensionRow and CatalogExtensionRow used to conditionally render Activate button vs toggle for plugins
- [Phase 02-plugin-management]: CredentialConfigPanel props renamed from skillId/skillName to extensionId/extensionName with extensionKind prop — posts correct kind for both skills and plugins
- [Phase 02-plugin-management]: confirmActivatePluginId state and handlePluginActivateConfirm defined in 02-03 ExtensionsTab for wiring in 02-04 ConfirmRestartDialog
- [Phase 02-plugin-management]: Vault/instance scope selector (UI-03) deferred to Phase 5 OAUTH-03 — all credentials are instance-scoped by default in Phase 2
- [Phase 02-plugin-management]: Polling GET /instances/:id/plugins/:pluginId every 2s (not WebSocket) for restart completion detection — simpler per CONTEXT.md decision
- [Phase 02-plugin-management]: Visual checkpoint auto-approved in auto-advance mode for Plan 02-04
- [Phase 03-clawhub-trust-policy]: marketplace-client soft-fails on RPC errors: returns empty result instead of throwing (ClawHub unavailable = graceful degradation)
- [Phase 03-clawhub-trust-policy]: TRUST-05/06 integrity check: only verifies on same-version reinstall when stored integrity_hash is non-null (legacy installs without hash skip verification)
- [Phase 03-clawhub-trust-policy]: unscanned tier blocks without override possibility — virusTotalPassed false/null treated identically
- [Phase 03-clawhub-trust-policy]: createTrustOverride uses dialect-aware ON CONFLICT DO UPDATE (EXCLUDED vs excluded keyword)
- [Phase 03-clawhub-trust-policy]: trustDecision and blockReason added to PluginCatalogEntry and SkillCatalogEntry — required for frontend trust UI
- [Phase 03-clawhub-trust-policy]: Plugin upgrade triggers re-activation (restart) when status was active; skill upgrade does not
- [Phase 03-clawhub-trust-policy]: blockReason stored as undefined (not null) in catalog entries to match optional field type in shared types
- [Phase 03-clawhub-trust-policy]: trustDecision/blockReason added as optional fields to catalog entry types — UI uses server-provided values when plan 03-03 populates them, no blocked state otherwise
- [Phase 03-clawhub-trust-policy]: CatalogSkillRow not extended with trust display — deferred pending 03-03 server integration that adds trust data to skill catalog entries
- [Phase 03-clawhub-trust-policy]: Visual checkpoint auto-approved in auto-advance mode for Plan 03-05
- [Phase 03-clawhub-trust-policy]: Truncated hash shown as sha512-{first16}...{last8} for compact readability in configure panel
- [Phase 03-clawhub-trust-policy]: Two-step upgrade dryRun flow: Check for Updates queries version without side effects, Upgrade button commits
- [Phase 03-clawhub-trust-policy]: No new handler needed for skill override: handleRequestOverride already supports kind='skill' and searches availableCatalog
- [Phase 04-template-portability]: getPendingExtensionsForReplay kept as deprecated backward-compat wrapper delegating to getPendingExtensions
- [Phase 04-template-portability]: Phase 3 replay in startInstanceAsync uses non-blocking try/catch per extension — individual failures never propagate to instance startup error
- [Phase 04-template-portability]: SecurityWarning type extended with 'redacted_secret' variant — workspace secrets use different type than hardcoded key warnings
- [Phase 04-template-portability]: scrubOpenclawConfigCredentials() extracted as standalone helper in reverse-adapter.ts — reusable and separate from main export flow
- [Phase 04-template-portability]: SENSITIVE_PATTERNS exported from reverse-adapter.ts but template-store.ts keeps local copies — avoids circular imports between service-layer files
- [Phase 04-template-portability]: plugin_dependencies ContentRow column reused for TemplateExtensionDeclaration[] — discriminated by 'kind' field, no schema migration needed
- [Phase 04-template-portability]: Trust re-evaluation uses null signals at import time — no gateway running during instantiation, non-bundled extensions default to unscanned and are blocked
- [Phase 04-template-portability]: Community tier split at import: without override -> requiresTrustOverride[] (resolvable); unscanned/scan-failed -> blockedExtensions[] (permanent block)
- [Phase 05-oauth-advanced-auth]: Vault config stored in instances.config JSON column under vaultConfig key — no schema migration needed
- [Phase 05-oauth-advanced-auth]: exec SecretRef gated on supportsSecretRef(imageTag) — older gateways fall back gracefully without vault
- [Phase 05-oauth-advanced-auth]: VAULT_ADDR/VAULT_NAMESPACE injected via resolveEnv; vault-backed credentials skip AQUARIUM_CRED_xxx env injection
- [Phase 05-oauth-advanced-auth]: OAuth callback writes oauth_token sentinel row with value='GATEWAY_MANAGED' for template export OAuth detection without leaking actual tokens
- [Phase 05-oauth-advanced-auth]: requiresReAuth=true forces initial status='installed' on template import, ensuring OAuth extensions await user re-auth before seedConfig loads them
- [Phase 05-oauth-advanced-auth]: source/vaultPath vault metadata persisted in extension-credentials route so adapter.ts seedConfig can resolve vault credential references
- [Phase 05-oauth-advanced-auth]: Visual checkpoint auto-approved in auto-advance mode for Plan 05-03

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-04-04T06:44:47.982Z
Stopped at: Completed 05-oauth-advanced-auth-03-PLAN.md
Resume file: None
