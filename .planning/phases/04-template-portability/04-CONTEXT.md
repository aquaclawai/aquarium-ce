# Phase 4: Template Portability - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Template export/import extended to capture extension lifecycle state from `instance_plugins`/`instance_skills` tables, config scrubbing for all credential fields, workspace file allowlist with secret scanning, trust re-evaluation on import, and 3-phase startup (active/degraded config → boot+reconcile → pending replay). All decisions locked by PRD (§5.4, §5.5, §5.5.1, §12) and 15 rounds of adversarial review.

</domain>

<decisions>
## Implementation Decisions

### Template Export
- Read from `instance_plugins`/`instance_skills` tables (NOT legacy `template_contents.plugin_dependencies`)
- Legacy `plugin_dependencies` used only as fallback for pre-migration instances
- Export includes: active (enabled=true), installed (needsCredentials=true), disabled (enabled=false), degraded (enabled=true)
- Each entry includes `lockedVersion` + `integrityHash` for reproducible instantiation
- Pre-export reconciliation pass via `plugins.list` + `skills.list` RPC to sync DB state
- OpenClaw config exported as base config only — all credential fields in `plugins.entries`, `skills.entries`, `providers` namespaces replaced with `${CREDENTIAL:...}` placeholders
- Workspace files through allowlist: AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, BOOTSTRAP.md, HEARTBEAT.md, MEMORY.md, skills/*/SKILL.md
- SENSITIVE_PATTERNS scanning with redaction (`[REDACTED]` markers) + warnings in response
- Local skills with `scripts/` or `assets/` directories rejected from export with warning
- No arbitrary user-selected file export (dropped from v1)

### Template Import
- Trust re-evaluation: each extension checked against current ClawHub metadata at instantiation time
- Bundled: always pass
- Verified: re-checked against current metadata (download count, age, scan status)
- Community/admin-approved: requires fresh admin override on target instance — returned in `requiresTrustOverride[]`
- Unscanned/scan failed: blocked, cannot instantiate
- Trusted extensions inserted with status `pending` (enabled) or `disabled` (per template)
- Blocked extensions omitted with warning in instantiation response
- Lifecycle rows replace setup commands for plugins/skills — `generateDependencySetupCommands()` handles MCP servers only

### 3-Phase Startup
- Phase 1: `seedConfig()` generates config for `active`/`degraded` extensions only
- Phase 2: Gateway boots + reconciliation — `plugins.list` + `skills.list` RPC, crash-recovered `pending` extensions already present get promoted to `active`
- Phase 3: Replay remaining `pending` extensions — install, promote to `active` (no creds) or `installed` (needs creds)
- `installed` excluded from all phases (credential-pending, awaits activation)

### Claude's Discretion
- Import UX: warning dialog design for blocked/flagged extensions
- How reconciliation hooks into existing `startInstanceAsync` flow (Phase 1 already wired reconciliation into instance-manager.ts — extend for 3-phase model)
- Error handling for partial import failures (some extensions blocked, others succeed)
- Config scrubbing implementation approach (regex replacement vs AST walk)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `template-store.ts` (32KB): existing `exportFromInstance`, `instantiateTemplate` — extend both
- `template-file-format.ts`: `.octemplate` ZIP parsing/generation — extend with extension data
- `reverse-adapter.ts`: existing `SENSITIVE_PATTERNS` for secret detection — reuse for config scrubbing
- `extension-lifecycle.ts`: `reconcileExtensions`, `recoverOrphanedOperations` — already in instance-manager.ts
- `trust-store.ts`: `evaluateTrustPolicy` — use for import trust re-evaluation
- `marketplace-client.ts`: `getClawHubExtensionInfo` — use to fetch current trust metadata on import
- `skill-store.ts` / `plugin-store.ts`: install flows with version pinning — reuse for import

### Established Patterns
- 3-phase startup already partially implemented in Phase 1 (reconciliation in instance-manager.ts) — extend
- Secret scrubbing with `SENSITIVE_PATTERNS` regex from reverse-adapter.ts
- Template export/import with `.octemplate` ZIP format
- Trust re-evaluation follows same `evaluateTrustPolicy` as install-time enforcement

### Integration Points
- `template-store.ts`: Extend `exportFromInstance` to read extension lifecycle tables
- `template-store.ts`: Extend `instantiateTemplate` to insert lifecycle rows + trust re-eval
- `adapter.ts`: Extend `seedConfig` to implement 3-phase model (currently Phase 1 style)
- `instance-manager.ts`: `startInstanceAsync` — ensure reconciliation runs after boot, pending replay after reconciliation
- `template-file-format.ts`: Add extension declarations to template.json manifest

</code_context>

<specifics>
## Specific Ideas

- PRD reference: `docs/prd-plugin-skill-marketplace.md` — §5.4 (3-phase startup), §5.5 (export flow), §5.5.1 (workspace allowlist), §12 (template integration)
- The 3-phase startup is the most complex part — Phase 1 already wired reconciliation into instance-manager.ts but it runs as a single pass. Phase 4 needs to split it into 3 explicit phases with different behavior per phase.
- Config scrubbing should reuse the `SENSITIVE_PATTERNS` from reverse-adapter.ts and extend with plugin/skill namespace awareness

</specifics>

<deferred>
## Deferred Ideas

None — all scope locked by PRD

</deferred>

---

*Phase: 04-template-portability*
*Context gathered: 2026-04-04*
