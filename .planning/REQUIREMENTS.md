# Requirements: Aquarium CE — Plugin & Skill Marketplace

**Defined:** 2026-04-03
**Core Value:** Users can discover and activate extensions without leaving the dashboard, with credentials encrypted and untrusted code blocked by default.

## v1.1 Requirements

Requirements for Plugin & Skill Marketplace. Each maps to roadmap phases.

### Lifecycle & Infrastructure

- [x] **INFRA-01**: System creates `instance_plugins` table with lifecycle status, version pinning, and session ownership columns
- [x] **INFRA-02**: System creates `instance_skills` table with same schema as plugins
- [x] **INFRA-03**: System creates `extension_operations` table with fencing tokens, cancel support, and partial unique index for one-active-per-instance
- [x] **INFRA-04**: System generates `server_session_id` (UUID) on each startup for orphan detection
- [x] **INFRA-05**: System enforces per-instance extension mutation lock with fencing token verification on all DB/config writes
- [x] **INFRA-06**: System supports cooperative cancellation via `cancel_requested` flag checked at worker checkpoints
- [x] **INFRA-07**: System enforces per-subprocess execution deadlines (npm: 5min, skills: 3min, restart: 2min, config.patch: 30s)
- [x] **INFRA-08**: System recovers orphaned operations on startup by marking stale-session ops as crashed and extensions as `pending`

### Skill Management

- [x] **SKILL-01**: User can browse bundled skills catalog from the Extensions tab
- [x] **SKILL-02**: User can install a skill with one click (acquires lock, sends `skills.install` RPC, releases lock)
- [x] **SKILL-03**: Skills with no required credentials promote directly to `active` after install
- [x] **SKILL-04**: User can configure extension-scoped credentials for a skill (extensionKind + extensionId binding)
- [x] **SKILL-05**: User can enable/disable an installed skill
- [x] **SKILL-06**: User can uninstall a skill
- [x] **SKILL-07**: System reconciles skill state on boot (Phase 2) -- promotes crash-recovered skills already present in gateway

### Plugin Management

- [x] **PLUG-01**: User can browse bundled plugins catalog from the Extensions tab
- [x] **PLUG-02**: User can install a plugin artifact (Operation 1: npm install, no config.patch, status -> installed or active)
- [x] **PLUG-03**: Plugins with no required credentials skip to Operation 3 (activate) within same lock hold
- [x] **PLUG-04**: User can configure extension-scoped credentials for a plugin (Operation 2)
- [x] **PLUG-05**: User can activate a plugin triggering gateway restart + health check (Operation 3)
- [x] **PLUG-06**: Plugin activation verifies artifact exists and reinstalls from lockedVersion if missing (rebuild recovery)
- [x] **PLUG-07**: System rolls back failed plugin activation (remove from config, restart, mark failed)
- [x] **PLUG-08**: User can enable/disable an installed plugin
- [x] **PLUG-09**: User can uninstall a plugin
- [x] **PLUG-10**: System disables `commands.plugins` for managed instances (chat commands off)

### ClawHub Marketplace & Trust

- [x] **TRUST-01**: User can search ClawHub catalog for plugins and skills with category filtering
- [x] **TRUST-02**: System displays trust signals (verified badge, download count, age, VirusTotal status) on catalog entries
- [x] **TRUST-03**: System enforces deny-by-default: bundled/verified allow, community block, unscanned block always
- [x] **TRUST-04**: Admin can override trust for community extensions with credential-access consent dialog and audit trail
- [x] **TRUST-05**: System pins exact version + SHA-512 integrity hash on install
- [x] **TRUST-06**: System rejects reinstall if registry returns different hash for same version (integrity mismatch)
- [x] **TRUST-07**: User can explicitly upgrade an extension (fetches latest, re-pins, re-hashes)

### Template Portability

- [x] **TMPL-01**: Template export reads from `instance_plugins`/`instance_skills` tables (not legacy `plugin_dependencies`)
- [x] **TMPL-02**: Export includes active, installed (needsCredentials), disabled, and degraded extensions with state hints
- [x] **TMPL-03**: Export scrubs OpenClaw base config -- all credential fields replaced with `${CREDENTIAL:...}` placeholders
- [x] **TMPL-04**: Export uses workspace file allowlist + SENSITIVE_PATTERNS secret scanning with redaction
- [x] **TMPL-05**: Export rejects local skills with `scripts/` or `assets/` directories
- [x] **TMPL-06**: Template import re-evaluates trust policy for each extension against current ClawHub metadata
- [x] **TMPL-07**: Blocked extensions on import require fresh admin override or are skipped with warning
- [x] **TMPL-08**: System uses 3-phase startup: Phase 1 (active/degraded config) -> Phase 2 (boot+reconcile) -> Phase 3 (pending replay)

### OAuth & Offline

- [x] **OAUTH-01**: User can authenticate plugins requiring OAuth via browser redirect flow proxied by the platform
- [x] **OAUTH-02**: OAuth tokens excluded from template export with `requiresReAuth` flag
- [x] **OAUTH-03**: User can configure SecretRef vault integration (1Password, HashiCorp Vault)
- [x] **OFFLINE-01**: System caches plugin artifacts on first successful install to `~/.openclaw/plugin-cache/`
- [x] **OFFLINE-02**: System prefers cached artifacts on restart, falls back to registry

### Frontend

- [x] **UI-01**: Extensions tab with Plugins and Skills sub-tabs on instance detail page
- [x] **UI-02**: Catalog browse with search, category filter, and trust signal display
- [x] **UI-03**: Install flow dialog with trust summary, credential input, and vault/instance scope choice
- [x] **UI-04**: Credential configuration panel (gear icon) with extension-scoped credential management
- [x] **UI-05**: Gateway built-ins shown in separate read-only section (not mixed with managed extensions)
- [x] **UI-06**: Dashboard alerts for failed/degraded extensions
- [x] **UI-07**: All new UI strings added to 6 locale files (en, zh, fr, de, es, it)

## v1.2 Requirements

Requirements for v1.2 Gateway Simplification & Plugin Fixes.

### Gateway Simplification

- [ ] **SIMP-01**: Remove TCP proxy injection from Docker runtime -- use native `gateway.bind: lan`
- [x] **SIMP-02**: Remove conflicting RPC methods from platform-bridge plugin (`skills.install`, `skills.uninstall`) that duplicate native gateway handlers
- [ ] **SIMP-03**: Simplify custom Docker entrypoint to only inject platform-bridge plugin path, deferring directory/permission/config logic to official entrypoint

### Plugin Bug Fixes

- [x] **PLUGFIX-01**: Fix empty Available catalog after gateway restart -- resolve plugin loading failure caused by method name conflicts with native handlers
- [x] **PLUGFIX-02**: Fix `plugins.install` handler causing gateway config corruption (adding non-existent plugin paths)
- [x] **PLUGFIX-03**: Backend graceful degradation for `skills.list` and `plugins.list` RPC when gateway doesn't support them (return empty instead of 500)

### Frontend Fixes

- [x] **FRONT-01**: Fix Extensions tab response shape mismatch -- catalog endpoints return `{ catalog: [], hasMore }` but frontend expected flat array
- [x] **FRONT-02**: Fix install handlers sending `source: "clawhub"` (string) instead of `source: { type: "clawhub", spec: "..." }` (object)
- [x] **FRONT-03**: Fix skill install RPC params to match gateway's native schema (`{ source: "clawhub", slug }`)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features

- **ADV-01**: DB-backed OAuth token persistence (currently volume-dependent)
- **ADV-02**: Per-plugin process isolation (requires upstream OpenClaw changes)
- **ADV-03**: User-selected arbitrary file export with entropy-based secret scanning
- **ADV-04**: Multi-agent per-skill filtering UI
- **ADV-05**: Periodic reconciliation beyond boot/export (event-driven vs polling)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Plugin development within Aquarium | Management platform, not IDE |
| Chat-based extension management | Disabled for managed instances to enforce single-writer |
| Per-plugin process isolation | Requires upstream OpenClaw architecture changes |
| Arbitrary user-selected file export | Unresolvable secret-leakage risk with regex scanning |
| Building our own plugin/skill registry | Use ClawHub + bundled catalog |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| INFRA-06 | Phase 1 | Complete |
| INFRA-07 | Phase 1 | Complete |
| INFRA-08 | Phase 1 | Complete |
| SKILL-01 | Phase 1 | Complete |
| SKILL-02 | Phase 1 | Complete |
| SKILL-03 | Phase 1 | Complete |
| SKILL-04 | Phase 1 | Complete |
| SKILL-05 | Phase 1 | Complete |
| SKILL-06 | Phase 1 | Complete |
| SKILL-07 | Phase 1 | Complete |
| UI-01 | Phase 1 | Complete |
| UI-05 | Phase 1 | Complete |
| UI-06 | Phase 1 | Complete |
| UI-07 | Phase 1 | Complete |
| PLUG-01 | Phase 2 | Complete |
| PLUG-02 | Phase 2 | Complete |
| PLUG-03 | Phase 2 | Complete |
| PLUG-04 | Phase 2 | Complete |
| PLUG-05 | Phase 2 | Complete |
| PLUG-06 | Phase 2 | Complete |
| PLUG-07 | Phase 2 | Complete |
| PLUG-08 | Phase 2 | Complete |
| PLUG-09 | Phase 2 | Complete |
| PLUG-10 | Phase 2 | Complete |
| UI-02 | Phase 2 | Complete |
| UI-03 | Phase 2 | Complete |
| UI-04 | Phase 2 | Complete |
| TRUST-01 | Phase 3 | Complete |
| TRUST-02 | Phase 3 | Complete |
| TRUST-03 | Phase 3 | Complete |
| TRUST-04 | Phase 3 | Complete |
| TRUST-05 | Phase 3 | Complete |
| TRUST-06 | Phase 3 | Complete |
| TRUST-07 | Phase 3 | Complete |
| TMPL-01 | Phase 4 | Complete |
| TMPL-02 | Phase 4 | Complete |
| TMPL-03 | Phase 4 | Complete |
| TMPL-04 | Phase 4 | Complete |
| TMPL-05 | Phase 4 | Complete |
| TMPL-06 | Phase 4 | Complete |
| TMPL-07 | Phase 4 | Complete |
| TMPL-08 | Phase 4 | Complete |
| OAUTH-01 | Phase 5 | Complete |
| OAUTH-02 | Phase 5 | Complete |
| OAUTH-03 | Phase 5 | Complete |
| OFFLINE-01 | Phase 6 | Complete |
| OFFLINE-02 | Phase 6 | Complete |
| SIMP-02 | Phase 7 | Complete |
| PLUGFIX-01 | Phase 7 | Complete |
| PLUGFIX-02 | Phase 7 | Complete |
| PLUGFIX-03 | Phase 7 | Complete |
| FRONT-01 | Phase 7 | Complete |
| FRONT-02 | Phase 7 | Complete |
| FRONT-03 | Phase 7 | Complete |
| SIMP-01 | Phase 8 | Pending |
| SIMP-03 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 52 total, 52 mapped (Complete)
- v1.2 requirements: 9 total, 9 mapped
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-04 after v1.2 roadmap creation*
