# Requirements: Aquarium CE — Plugin & Skill Marketplace

**Defined:** 2026-04-03
**Core Value:** Users can discover and activate extensions without leaving the dashboard, with credentials encrypted and untrusted code blocked by default.

## v1.1 Requirements

Requirements for Plugin & Skill Marketplace. Each maps to roadmap phases.

### Lifecycle & Infrastructure

- [ ] **INFRA-01**: System creates `instance_plugins` table with lifecycle status, version pinning, and session ownership columns
- [ ] **INFRA-02**: System creates `instance_skills` table with same schema as plugins
- [ ] **INFRA-03**: System creates `extension_operations` table with fencing tokens, cancel support, and partial unique index for one-active-per-instance
- [ ] **INFRA-04**: System generates `server_session_id` (UUID) on each startup for orphan detection
- [ ] **INFRA-05**: System enforces per-instance extension mutation lock with fencing token verification on all DB/config writes
- [ ] **INFRA-06**: System supports cooperative cancellation via `cancel_requested` flag checked at worker checkpoints
- [ ] **INFRA-07**: System enforces per-subprocess execution deadlines (npm: 5min, skills: 3min, restart: 2min, config.patch: 30s)
- [ ] **INFRA-08**: System recovers orphaned operations on startup by marking stale-session ops as crashed and extensions as `pending`

### Skill Management

- [ ] **SKILL-01**: User can browse bundled skills catalog from the Extensions tab
- [ ] **SKILL-02**: User can install a skill with one click (acquires lock, sends `skills.install` RPC, releases lock)
- [ ] **SKILL-03**: Skills with no required credentials promote directly to `active` after install
- [ ] **SKILL-04**: User can configure extension-scoped credentials for a skill (extensionKind + extensionId binding)
- [ ] **SKILL-05**: User can enable/disable an installed skill
- [ ] **SKILL-06**: User can uninstall a skill
- [ ] **SKILL-07**: System reconciles skill state on boot (Phase 2) — promotes crash-recovered skills already present in gateway

### Plugin Management

- [ ] **PLUG-01**: User can browse bundled plugins catalog from the Extensions tab
- [ ] **PLUG-02**: User can install a plugin artifact (Operation 1: npm install, no config.patch, status → installed or active)
- [ ] **PLUG-03**: Plugins with no required credentials skip to Operation 3 (activate) within same lock hold
- [ ] **PLUG-04**: User can configure extension-scoped credentials for a plugin (Operation 2)
- [ ] **PLUG-05**: User can activate a plugin triggering gateway restart + health check (Operation 3)
- [ ] **PLUG-06**: Plugin activation verifies artifact exists and reinstalls from lockedVersion if missing (rebuild recovery)
- [ ] **PLUG-07**: System rolls back failed plugin activation (remove from config, restart, mark failed)
- [ ] **PLUG-08**: User can enable/disable an installed plugin
- [ ] **PLUG-09**: User can uninstall a plugin
- [ ] **PLUG-10**: System disables `commands.plugins` for managed instances (chat commands off)

### ClawHub Marketplace & Trust

- [ ] **TRUST-01**: User can search ClawHub catalog for plugins and skills with category filtering
- [ ] **TRUST-02**: System displays trust signals (verified badge, download count, age, VirusTotal status) on catalog entries
- [ ] **TRUST-03**: System enforces deny-by-default: bundled/verified allow, community block, unscanned block always
- [ ] **TRUST-04**: Admin can override trust for community extensions with credential-access consent dialog and audit trail
- [ ] **TRUST-05**: System pins exact version + SHA-512 integrity hash on install
- [ ] **TRUST-06**: System rejects reinstall if registry returns different hash for same version (integrity mismatch)
- [ ] **TRUST-07**: User can explicitly upgrade an extension (fetches latest, re-pins, re-hashes)

### Template Portability

- [ ] **TMPL-01**: Template export reads from `instance_plugins`/`instance_skills` tables (not legacy `plugin_dependencies`)
- [ ] **TMPL-02**: Export includes active, installed (needsCredentials), disabled, and degraded extensions with state hints
- [ ] **TMPL-03**: Export scrubs OpenClaw base config — all credential fields replaced with `${CREDENTIAL:...}` placeholders
- [ ] **TMPL-04**: Export uses workspace file allowlist + SENSITIVE_PATTERNS secret scanning with redaction
- [ ] **TMPL-05**: Export rejects local skills with `scripts/` or `assets/` directories
- [ ] **TMPL-06**: Template import re-evaluates trust policy for each extension against current ClawHub metadata
- [ ] **TMPL-07**: Blocked extensions on import require fresh admin override or are skipped with warning
- [ ] **TMPL-08**: System uses 3-phase startup: Phase 1 (active/degraded config) → Phase 2 (boot+reconcile) → Phase 3 (pending replay)

### OAuth & Offline

- [ ] **OAUTH-01**: User can authenticate plugins requiring OAuth via browser redirect flow proxied by the platform
- [ ] **OAUTH-02**: OAuth tokens excluded from template export with `requiresReAuth` flag
- [ ] **OAUTH-03**: User can configure SecretRef vault integration (1Password, HashiCorp Vault)
- [ ] **OFFLINE-01**: System caches plugin artifacts on first successful install to `~/.openclaw/plugin-cache/`
- [ ] **OFFLINE-02**: System prefers cached artifacts on restart, falls back to registry

### Frontend

- [ ] **UI-01**: Extensions tab with Plugins and Skills sub-tabs on instance detail page
- [ ] **UI-02**: Catalog browse with search, category filter, and trust signal display
- [ ] **UI-03**: Install flow dialog with trust summary, credential input, and vault/instance scope choice
- [ ] **UI-04**: Credential configuration panel (gear icon) with extension-scoped credential management
- [ ] **UI-05**: Gateway built-ins shown in separate read-only section (not mixed with managed extensions)
- [ ] **UI-06**: Dashboard alerts for failed/degraded extensions
- [ ] **UI-07**: All new UI strings added to 6 locale files (en, zh, fr, de, es, it)

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
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 1 | Pending |
| INFRA-06 | Phase 1 | Pending |
| INFRA-07 | Phase 1 | Pending |
| INFRA-08 | Phase 1 | Pending |
| SKILL-01 | Phase 1 | Pending |
| SKILL-02 | Phase 1 | Pending |
| SKILL-03 | Phase 1 | Pending |
| SKILL-04 | Phase 1 | Pending |
| SKILL-05 | Phase 1 | Pending |
| SKILL-06 | Phase 1 | Pending |
| SKILL-07 | Phase 1 | Pending |
| UI-01 | Phase 1 | Pending |
| UI-05 | Phase 1 | Pending |
| UI-06 | Phase 1 | Pending |
| UI-07 | Phase 1 | Pending |
| PLUG-01 | Phase 2 | Pending |
| PLUG-02 | Phase 2 | Pending |
| PLUG-03 | Phase 2 | Pending |
| PLUG-04 | Phase 2 | Pending |
| PLUG-05 | Phase 2 | Pending |
| PLUG-06 | Phase 2 | Pending |
| PLUG-07 | Phase 2 | Pending |
| PLUG-08 | Phase 2 | Pending |
| PLUG-09 | Phase 2 | Pending |
| PLUG-10 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |
| UI-03 | Phase 2 | Pending |
| UI-04 | Phase 2 | Pending |
| TRUST-01 | Phase 3 | Pending |
| TRUST-02 | Phase 3 | Pending |
| TRUST-03 | Phase 3 | Pending |
| TRUST-04 | Phase 3 | Pending |
| TRUST-05 | Phase 3 | Pending |
| TRUST-06 | Phase 3 | Pending |
| TRUST-07 | Phase 3 | Pending |
| TMPL-01 | Phase 4 | Pending |
| TMPL-02 | Phase 4 | Pending |
| TMPL-03 | Phase 4 | Pending |
| TMPL-04 | Phase 4 | Pending |
| TMPL-05 | Phase 4 | Pending |
| TMPL-06 | Phase 4 | Pending |
| TMPL-07 | Phase 4 | Pending |
| TMPL-08 | Phase 4 | Pending |
| OAUTH-01 | Phase 5 | Pending |
| OAUTH-02 | Phase 5 | Pending |
| OAUTH-03 | Phase 5 | Pending |
| OFFLINE-01 | Phase 6 | Pending |
| OFFLINE-02 | Phase 6 | Pending |

**Coverage:**
- v1.1 requirements: 52 total
- Mapped to phases: 52
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 after roadmap creation*
