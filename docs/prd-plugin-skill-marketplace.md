# PRD: Plugin & Skill Marketplace

**Status:** Draft
**Author:** Shuai
**Date:** 2026-04-03
**Target:** Aquarium CE v1.x

---

## 1. Problem Statement

Aquarium CE users currently have no way to browse, install, configure, or authenticate plugins and skills for their OpenClaw instances through the platform. The only paths are:

- **Manual config editing** — Users must know the exact plugin/skill IDs, edit `openclaw.json` fields, and restart the gateway. This requires deep OpenClaw knowledge.
- **Chat commands** — `/plugin install` and `/skill` are available inside the agent chat, but users don't know what's available, can't browse a catalog, and can't manage credentials through chat.
- **Template inheritance** — Templates can declare `pluginDependencies` and `skills`, but there's no UI to modify these after instance creation.

**Community pain points** (from X/Twitter and ecosystem discussions):
- Median OpenClaw setup time is 3.2 hours; 41% of users abandon before completing ([source](https://medium.com/@krupeshraut/how-to-install-openclaw-in-2026-5-different-ways-and-which-one-you-should-actually-pick-40a078819320))
- ClawHub marketplace had a major malware crisis — 12-17% of skills were malicious ([source](https://www.trendingtopics.eu/security-nightmare-how-openclaw-is-fighting-malware-in-its-ai-agent-marketplace/))
- Plugin module resolution regressions break user-installed plugins across versions ([source](https://github.com/openclaw/openclaw/issues/53403))

---

## 2. Goals

1. **Reduce time-to-value** — Users can discover, install, and configure plugins/skills in under 2 minutes from the Aquarium dashboard.
2. **Secure by default** — Credentials are encrypted at rest, never exposed in templates, and follow the existing 3-layer resolution. Community extensions are blocked unless verified or admin-approved.
3. **Survive restarts** — All activated extensions and credentials are restored across restarts. Credential-pending extensions (`installed` state) retain declarations but are not loaded until activated. Plugin binaries are best-effort reinstalled on rebuild (see [Section 5.6](#56-extension-lifecycle--failure-recovery) for failure handling).
4. **Template portability** — Users can export instances with their full plugin/skill setup and recreate them elsewhere, minus secrets.
5. **Single writer** — The Aquarium DB is the sole authoritative source for extension state. All mutations flow through the platform API; out-of-band changes are reconciled back to the DB.

### Non-Goals

- Building our own plugin/skill registry (we use ClawHub + bundled catalog)
- Supporting plugin development within Aquarium (out of scope)
- Allowing unmanaged chat-based plugin/skill installation (chat commands are disabled for managed instances; see [Section 5.7](#57-write-ownership--chat-command-policy))

---

## 3. Terminology

| Term | Definition |
|------|-----------|
| **Plugin** | System-level OpenClaw extension running in-process. Provides channels, model providers, tools, speech, etc. Declared in `openclaw.plugin.json`. |
| **Skill** | Agent-level knowledge package centered on a `SKILL.md` file. Injected into system prompt. Can include scripts, references, assets. |
| **Bundled** | Plugins/skills shipped with the OpenClaw gateway image (~95 plugins, ~53 skills). Always available. |
| **ClawHub** | Public marketplace at clawhub.com for community plugins and skills. |
| **SecretRef** | OpenClaw credential reference with three sources: `env`, `file`, `exec` (vault). |
| **Platform-bridge** | Built-in plugin at `/opt/openclaw-plugins/platform-bridge/` that Aquarium always loads for health checks and workspace init. |

---

## 4. User Stories

### P0 — Must Have

**US-1: Browse available plugins and skills**
> As a user, I can browse a categorized catalog of bundled and ClawHub plugins/skills from my instance's dashboard, so I know what's available without reading docs.

**US-2: Install a plugin or skill**
> As a user, I can install a plugin or skill with one click, so my agent gains new capabilities without editing config files.

**US-3: Configure credentials for a plugin/skill**
> As a user, I can paste an API key or configure env vars for a plugin/skill through the dashboard, so the plugin can authenticate with external services.

**US-4: Persist plugin/skill state across restarts**
> As a user, when my instance restarts, all activated plugins/skills and their credentials are restored automatically. Extensions awaiting credentials (`installed` state) retain their declarations and can be activated once credentials are provided.

**US-5: Enable/disable a plugin or skill**
> As a user, I can toggle plugins and skills on/off without uninstalling them.

### P1 — Should Have

**US-6: Export instance with plugins/skills**
> As a user, when I export my instance as a template, the installed plugins, skills, and their configurations (minus secrets) are captured so I can recreate the setup.

**US-7: Instantiate template with plugins/skills**
> As a user, when I create an instance from a template that declares plugins/skills, they are auto-installed and I'm prompted for any required credentials.

**US-8: Trust signals**
> As a user, I can see download count, age, verified badge, and security scan status for ClawHub plugins/skills before installing.

**US-9: Credential vault**
> As a user, I can store credentials in my user vault once and have them auto-resolve across all my instances.

### P2 — Nice to Have

**US-10: OAuth proxy flow**
> As a user, I can authenticate plugins that require OAuth (GitHub, Slack, etc.) through a browser redirect flow managed by the platform.

**US-11: Chat-based install**
> As a user, I can ask my agent "install the calendar skill" in chat and it handles installation.

**US-12: Curated recommendations**
> As a user, I see a curated list of recommended plugins/skills based on my instance's template category.

---

## 5. Architecture

### 5.1 System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Aquarium Web UI                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Marketplace Tab (per instance)                        │  │
│  │  ├── Browse: Bundled + ClawHub catalog                 │  │
│  │  ├── Install: one-click install via API                │  │
│  │  ├── Configure: API key input, env vars, toggles       │  │
│  │  └── Status: installed, enabled, health, version       │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │ REST API                         │
│  ┌────────────────────────┴───────────────────────────────┐  │
│  │  Express Server                                        │  │
│  │  ├── routes/plugins.ts          (NEW)                  │  │
│  │  ├── routes/skills.ts           (EXTEND)               │  │
│  │  ├── routes/credentials.ts      (existing)             │  │
│  │  ├── routes/user-credentials.ts (existing)             │  │
│  │  │                                                     │  │
│  │  ├── services/plugin-store.ts        (NEW)             │  │
│  │  ├── services/skill-store.ts         (NEW)             │  │
│  │  ├── services/marketplace-client.ts  (NEW)             │  │
│  │  ├── services/credential-store.ts    (existing)        │  │
│  │  └── services/user-credential-store.ts (existing)      │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │ Gateway RPC (WebSocket)          │
│  ┌────────────────────────┴───────────────────────────────┐  │
│  │  OpenClaw Gateway (Docker container)                   │  │
│  │  ├── plugins.list / plugins.enable / plugins.disable   │  │
│  │  ├── skills.list / skills.install / skills.update      │  │
│  │  ├── config.patch (credential injection)               │  │
│  │  └── ~/.openclaw/ (persistent volume)                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴───────────────────────────────┐  │
│  │  SQLite DB                                             │  │
│  │  ├── instance_plugins       (NEW)                      │  │
│  │  ├── instance_skills        (NEW)                      │  │
│  │  ├── instance_credentials   (existing, AES-256-GCM)    │  │
│  │  ├── user_credentials       (existing)                 │  │
│  │  └── templates              (existing, extend)         │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Data Flow: Install a Skill

```
User clicks "Install" on skill card
  → POST /api/instances/:id/skills/install { skillId, source }
    → Acquire per-instance extension mutex (see §5.8)
      → If locked: return 409 Conflict "another extension operation is in progress"
    → skill-store.ts: enforce trust policy (see §10.2)
    → skill-store.ts: INSERT into instance_skills with status = 'pending', pending_owner = server_session_id
    → gateway-rpc.ts: send `skills.install` RPC to gateway (verify fencing token before write)
      → ON SUCCESS:
          if skill has no requiredCredentials → update status → 'active', release mutex
          if skill has requiredCredentials → update status → 'installed', release mutex
      → ON FAILURE: update status → 'failed', set error_message, release mutex, return error
    → credential-store.ts: if skill requires API key, return requiredCredentials
  → UI prompts for missing credentials
  → POST /api/instances/:id/credentials { provider, credentialType, value,
      extensionKind: 'skill', extensionId, targetField }
    → Acquire per-instance extension mutex (see §5.8)
    → credential-store.ts: encrypt + store (bound to extensionKind + extensionId)
    → gateway-rpc.ts: send `config.patch` to inject credential into
      extension-scoped namespace only (verify fencing token)
      → ON SUCCESS: update status → 'active', release mutex
      → ON FAILURE: status stays 'installed', release mutex, return warning
  → UI shows skill status reflecting actual state
```

### 5.3 Data Flow: Install a Plugin

Plugin install is split into discrete lock-bounded operations. The lock is **never held across user interaction** (credential input).

```
OPERATION 1: Install plugin artifact (does NOT touch gateway config)
  User clicks "Install" on plugin card
    → POST /api/instances/:id/plugins/install { pluginId, npmSpec?, source }
      → Acquire per-instance extension mutex (see §5.8)
        → If locked: return 409 Conflict
      → plugin-store.ts: enforce trust policy (see §10.2)
      → plugin-store.ts: INSERT into instance_plugins with status = 'pending', pending_owner = server_session_id
      → gateway-rpc.ts: trigger setup command (npm install) to stage artifact on disk
        → NOTE: do NOT `config.patch` yet — plugin is NOT added to plugins.entries
          or plugins.load.paths. This prevents other gateway restarts from accidentally
          loading a half-configured plugin.
        → ON FAILURE: update status → 'failed', release mutex, return error
      → If plugin has no requiredCredentials:
          → Skip to Operation 3 (activate) immediately within same lock hold
      → If plugin has requiredCredentials:
          → Update status → 'installed'
          → Release mutex
          → Return { plugin, requiredCredentials }
          → UI shows plugin as "installed — credentials needed"

--- User think-time happens here, lock is NOT held (only if credentials needed) ---

OPERATION 2: Configure credentials (if needed, skipped for no-auth plugins)
  User pastes credentials in UI
    → POST /api/instances/:id/credentials { provider, credentialType, value,
        extensionKind: 'plugin', extensionId, targetField }
      → Acquire per-instance extension mutex
      → credential-store.ts: encrypt + store (bound to extensionKind + extensionId)
      → gateway-rpc.ts: send `config.patch` to inject credential into
        extension-scoped namespace only (verify fencing token)
      → Release mutex

OPERATION 3: Activate plugin (gateway restart)
  User clicks "Activate" (or auto-triggered after credentials are provided)
    → POST /api/instances/:id/plugins/:pluginId/activate
      → Acquire per-instance extension mutex
      → Verify artifact exists; if missing (e.g., after rebuild), reinstall from
        lockedVersion + integrityHash before proceeding
        → ON REINSTALL FAILURE: update status → 'failed', release mutex, return error
      → gateway-rpc.ts: send `config.patch` to inject scoped credentials
      → instance-manager.ts: restart gateway via runtime engine
      → Post-restart: health check via `platform.ping` RPC
        → ON SUCCESS: update status → 'active', release mutex
        → ON FAILURE: update status → 'failed', set error_message
          → Rollback: remove ONLY this plugin from config (compare against fencing token),
            restart gateway again, release mutex
    → UI shows plugin status reflecting actual state
```

### 5.4 Data Flow: Instance Restart

```
Instance starting (startInstanceAsync)

  PHASE 1: Generate config for known-good extensions only
    → adapter.ts: seedConfig()
      → Read instance_plugins WHERE status IN ('active', 'degraded') from DB
      → Read instance_skills WHERE status IN ('active', 'degraded') from DB
      → Skip 'pending' (handled in Phase 3), 'installed' (credential-pending),
        'failed', 'disabled'
      → Generate plugins.entries + plugins.load.paths in openclaw.json
      → Generate skills.entries in openclaw.json
      → resolveCredentialPlaceholders() for all MCP + plugin + skill configs
      → Write openclaw.json to container volume

  PHASE 2: Boot gateway + reconcile (BEFORE replaying pending installs)
    → Gateway boots with active/degraded extensions
    → Post-boot reconciliation:
      → RPC `plugins.list` + `skills.list` to gateway
      → Compare gateway state vs DB managed extensions
      → Active/degraded extensions confirmed loaded → stay 'active'
      → Active/degraded extensions absent from gateway → mark 'degraded' or 'failed'
      → 'pending' extensions already present in gateway (crash recovery case)
        → promote directly to 'active', skip reinstall
      → Gateway-only extensions (bundled, not in DB): returned as read-only
        info via API, NOT inserted into DB (see §5.7)
      → Log discrepancies for operator visibility

  PHASE 3: Replay pending installs (only for extensions NOT resolved by reconciliation)
    → For each remaining 'pending' extension (not already promoted in Phase 2):
      → Run install command (npm install / openclaw skills install)
      → ON SUCCESS: promote 'pending' → 'active' (if no credentials required)
                    or 'installed' (if credentials still needed)
      → ON FAILURE: status → 'failed', log warning, continue
    → If any new extensions were activated, regenerate config + restart gateway
    → Instance boot is NOT blocked by individual extension failures
```

### 5.5 Data Flow: Template Export

```
User clicks "Export as Template"
  → GET /api/instances/:id/export
    → Reconciliation: RPC `skills.list` + `plugins.list` to sync DB state first
    → template-store.ts: exportFromInstance()
      → Read instance_plugins WHERE status IN ('active', 'installed', 'disabled', 'degraded')
        → serialize as pluginDependencies[] with lockedVersion + integrityHash + state hints:
          active → enabled=true
          installed → enabled=true, needsCredentials=true
          disabled → enabled=false
          degraded → enabled=true (was working, just needs reinstall)
      → Read instance_skills WHERE status IN ('active', 'installed', 'disabled', 'degraded')
        → same serialization logic (lockedVersion + integrityHash + state hints)
      → Read MCP server configs → scrub secrets with ${CREDENTIAL:...} placeholders
      → Read OpenClaw base config → scrub all credential fields in plugin/skill/provider
        namespaces with ${CREDENTIAL:...} placeholders (see §12)
      → Read workspace files through allowlist + secret scan (see §5.5.1)
      → Bundle into .octemplate ZIP
    → Template preserves full user intent (including credential-pending extensions), no credentials
```

#### 5.5.1 Workspace File Export Policy

Workspace files are exported through a two-layer filter to prevent secret leakage:

**Layer 1 — Allowlist**: Only known-safe workspace files are exported by default:
- `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `MEMORY.md`
- `skills/*/SKILL.md` (skill definitions only, not scripts or data)

**Dropped from v1**: Arbitrary user-selected file export is removed from scope. The allowlist above covers all standard workspace files. Allowing arbitrary files creates an unresolvable secret-leakage risk (regex scanning cannot catch all credential formats). If needed in a future version, it would require a stronger scanner (entropy + structured key/value heuristics) and fail-closed behavior.

Files NOT exported: `.env`, `*.key`, `*.pem`, `auth-profiles.json`, `credentials/`, `secrets.json`, `node_modules/`, any dotfiles not in the allowlist.

**Local skill portability**: Skills from ClawHub/npm are fully portable — they are reinstalled from the registry using `lockedVersion` + `integrityHash` on instantiation, so scripts and assets come back automatically. Local workspace skills that contain `scripts/` or `assets/` directories are **rejected from export** with a warning: "Skill '<name>' contains executable scripts and cannot be exported. Install it from ClawHub or remove scripts to make it portable." This prevents silently producing a partial template that drops executable behavior.

**Layer 2 — Secret scanning**: Even allowlisted files are scanned using the existing `SENSITIVE_PATTERNS` from `reverse-adapter.ts` (detects `sk-*`, `ghp_*`, `xoxb-*`, `hapi-*`, `gsk_*`, `AIza*` etc.). If high-confidence secrets are detected:
- The export **continues** but the detected values are replaced with `[REDACTED]` markers
- Export response includes `warnings[]` listing each redacted file + line
- UI shows a warning dialog before download: "N secrets were redacted from workspace files"
```

### 5.6 Extension Lifecycle & Failure Recovery

Extensions follow a state machine with explicit transitions.

```
State machine:

  pending ──→ installed ──→ active
    │             │            │
    │             │            ├──→ disabled (user toggle, recoverable)
    │             │            │
    │             │            ├──→ degraded (reinstall failed, was previously active)
    │             │            │
    └──→ failed ←─┘────────←──┘
           │
           ├──→ pending (user retries install)
           └──→ (deleted) (user uninstalls)

  degraded ──→ active (successful retry/reinstall)
           ──→ failed (user gives up or max retries)
```

| State | Meaning | Phase 1 (seedConfig)? | Phase 3 (pending replay)? | Included in export? |
|-------|---------|----------------------|--------------------------|---------------------|
| `pending` | Install requested, awaiting first boot | No | Yes (triggers install) | No |
| `installed` | Gateway accepted, credentials not yet configured | No | No (awaits activation) | Yes (needsCredentials=true) |
| `active` | Fully configured and confirmed healthy | Yes | No | Yes (enabled=true) |
| `disabled` | User-toggled off | No | No | Yes (enabled=false) |
| `degraded` | Was `active`, reinstall failed (e.g. registry outage) | Yes | No | Yes (enabled=true) |
| `failed` | Install, config, or health check failed (never was active) | No | No | No |

**`pending` is consumed by Phase 3 of startup (§5.4)**, NOT by Phase 1 `seedConfig()`. Phase 1 generates config for `active`/`degraded` only. Phase 2 boots the gateway and reconciles. Phase 3 then replays remaining `pending` rows — installing artifacts, promoting status, and regenerating config if needed. This is the path that makes template-instantiated and crash-recovered extensions install on first boot.

**`degraded` vs `failed`**: When a previously `active` extension fails to reinstall on restart (e.g., registry outage), it is marked `degraded` — not `failed`. This distinction matters: `degraded` extensions are still included in `seedConfig()` because the gateway may still have cached artifacts from the prior run. The gateway will either load the stale artifact (extension works) or fail to load it (reconciliation catches it). Extensions that were never successfully installed go to `failed` instead.

**Failure recovery:**
- **Install RPC failure**: Status → `failed` with gateway error message. User can retry from the UI (resets to `pending`).
- **Credential injection failure (`config.patch`)**: Status stays `installed`. UI shows "missing credentials" indicator. Extension is functional but unconfigured for services requiring auth.
- **Post-restart health failure for new extensions**: Status → `failed`. Instance continues booting without the broken extension. Dashboard shows alert.
- **Post-restart reinstall failure for previously active extensions**: Status → `degraded` (not `failed`). The gateway may still have cached artifacts from the prior run — reconciliation will determine actual state. Dashboard shows "degraded — reinstall failed, may still be running from cache" alert.
- **Plugin restart rollback**: If a plugin install causes gateway boot failure (detected by `platform.ping` timeout), the platform removes the plugin from config and restarts again. Status → `failed` with "caused gateway boot failure" error.
- **Orphaned `pending` cleanup**: Each `pending` record stores the `pending_owner` (server session UUID) that initiated the install. On server startup (with a fresh session UUID), a cleanup pass marks `pending` records from previous sessions as candidates for reconciliation in Phase 2 (§5.4). This avoids false-failing slow-but-legitimate installs from the current session.

### 5.8 Extension Mutation Lock

**All** extension operations that modify gateway config or lifecycle state — plugin install/uninstall/enable/disable, skill install/uninstall/configure, and credential injection (`config.patch`) — are serialized with a **per-instance operation lock** backed by a durable record.

- **Scope**: One lock per instance ID. CE is single-server, so coordination is in-process.
- **Acquire**: Before any mutation, create a durable operation record in the `extension_operations` table with a unique `fencing_token` (UUID), `operation_type`, `target_extension_id`, and `started_at`. If an active (non-completed) record already exists for this instance, return `409 Conflict` with the in-progress operation details.
- **Release**: After the operation completes (success or failure), update the operation record with `completed_at`, `result` (success/failed/rolled-back), and release the in-memory lock.
- **Subprocess execution deadlines**: Each long-running step within an operation has a bounded timeout. If the subprocess exceeds its deadline, it is killed (`SIGTERM` then `SIGKILL`), the operation is marked `failed`, and the lock is released cleanly. This is NOT a force-release of the lock on a wall clock �� it's terminating the stuck subprocess then releasing normally.
  - `npm install`: 5 minutes
  - `openclaw skills install`: 3 minutes
  - Gateway restart + health check: 2 minutes
  - `config.patch` RPC: 30 seconds
- **Cooperative cancellation**: If a user wants to cancel a running operation before it hits a deadline, they request cancellation from the dashboard (`POST /api/instances/:id/operations/:operationId/cancel`). This sets `cancel_requested = true` on the operation record. The worker checks `cancel_requested` at each checkpoint (after npm install, after config.patch, before gateway restart) and aborts cooperatively — cleaning up partial state before releasing the lock. If the worker is stuck in a subprocess, the deadline above will eventually kill it. The UI shows the stuck operation with a "Cancel" button after 2 minutes, with status "cancellation requested" until the worker acknowledges.
- **Fencing on all writes**: Every DB status update and `config.patch` call verifies the `fencing_token` matches the current active operation for this instance. This applies to both success and failure paths — not just rollback. If a cancelled worker completes after the lock has been released by crash recovery, its writes are rejected because the fencing token no longer matches.
- **Server session identity**: Each server process generates a `server_session_id` (UUID) on startup and stores it in memory. All operation records and `pending_owner` fields use this session UUID instead of raw PID. This eliminates PID-reuse ambiguity in containerized environments.
- **Server crash recovery**: On server startup (with a fresh `server_session_id`), scan `extension_operations` for records with no `completed_at` where `pending_owner != current_session_id` (i.e., from any previous server run). Mark operations as `crashed` and release the lock. Set affected extensions to `pending` (not `failed`) — the operation may have partially completed (artifact installed, config patched) before the crash. The post-boot reconciliation pass (§5.4 Phase 2) then compares gateway state vs DB and determines the actual outcome: if the extension loaded successfully, reconciliation promotes it to `active`; if it's absent, the `pending` row triggers a reinstall attempt in Phase 3. The stale fencing token prevents any zombie worker from writing state.
- **Conflict response**: `409 Conflict` with `{ activeOperation: { id, type, extensionId, startedAt } }`.
- **Read operations** (list, catalog browse) do not acquire the lock.

---

### 5.7 Write Ownership & Chat Command Policy

**The Aquarium DB is the single authoritative source** for extension state on managed instances. To prevent state divergence:

1. **Chat-based plugin/skill commands are disabled** for managed instances. The platform sets `commands.plugins: false` (default) and does not expose `/plugin install` or `/skill install` chat commands. Users manage extensions exclusively through the dashboard.

2. **Reconciliation on boot and export**: Even though chat commands are disabled, the gateway can still load bundled extensions or apply workspace-level changes. On every instance start and before every template export, the platform runs a reconciliation pass:
   - RPC `plugins.list` + `skills.list` to the gateway
   - Compare gateway state vs `instance_plugins` / `instance_skills`
   - **Managed extensions absent from gateway**: mark `failed` in DB with error message
   - **Gateway-only extensions** (bundled plugins the gateway loads automatically, not in DB): these are **not** inserted into the DB. They are returned as a separate read-only list in the `GET /instances/:id/plugins` and `GET /instances/:id/skills` API responses (see §6.1). The UI shows them in a "Gateway Built-in" section, clearly distinct from managed extensions. This avoids polluting the lifecycle tables with entries the platform didn't install and can't control.

3. **Gateway event relay**: The existing `gateway-event-relay.ts` WebSocket connection listens for `config.changed` events. If the gateway config changes outside of platform-initiated mutations, the platform logs a warning and triggers a reconciliation pass.

**Rationale**: The alternative — allowing both chat and dashboard mutations and reconciling bidirectionally — introduces conflict resolution complexity (which write wins?), makes template exports non-deterministic, and undermines the platform's ability to guarantee restart durability. Disabling chat commands is the simpler, safer choice for a managed platform.

---

## 6. API Design

### 6.1 New Routes: `/api/instances/:id/plugins`

```
GET    /api/instances/:id/plugins
       → List managed plugins + gateway built-ins
       Response: ApiResponse<{ managed: InstancePlugin[], gatewayBuiltins: GatewayExtensionInfo[] }>

GET    /api/instances/:id/plugins/catalog
       → Browse available plugins (bundled + ClawHub)
       Query: { search?, category?, page?, limit? }
       Response: ApiResponse<PluginCatalogEntry[]>

POST   /api/instances/:id/plugins/install
       → Install a plugin
       Body: { pluginId: string, source: PluginSource, config?: Record<string, unknown> }
       Response: ApiResponse<{ plugin: InstancePlugin, requiredCredentials: CredentialRequirement[] }>

PUT    /api/instances/:id/plugins/:pluginId
       → Update plugin config or toggle enabled/disabled
       Body: { enabled?: boolean, config?: Record<string, unknown> }
       Response: ApiResponse<InstancePlugin>

DELETE /api/instances/:id/plugins/:pluginId
       → Uninstall a plugin
       Response: ApiResponse<void>
```

### 6.2 Extended Routes: `/api/instances/:id/skills`

```
GET    /api/instances/:id/skills
       → List managed skills + gateway built-ins
       Response: ApiResponse<{ managed: InstanceSkill[], gatewayBuiltins: GatewayExtensionInfo[] }>

GET    /api/instances/:id/skills/catalog
       → Browse available skills (bundled + ClawHub)
       Query: { search?, category?, page?, limit? }
       Response: ApiResponse<SkillCatalogEntry[]>

POST   /api/instances/:id/skills/install        (existing, extend response)
       Body: { skillId: string, source: SkillSource }
       Response: ApiResponse<{ skill: InstanceSkill, requiredCredentials: CredentialRequirement[] }>

PUT    /api/instances/:id/skills/:skillId
       → Update skill config or toggle enabled/disabled
       Body: { enabled?: boolean, apiKey?: SecretRef, env?: Record<string, string> }
       Response: ApiResponse<InstanceSkill>

DELETE /api/instances/:id/skills/:skillId
       → Uninstall a skill
       Response: ApiResponse<void>

PUT    /api/instances/:id/skills/:skillId/trust-override
       → Admin override to allow a community/blocked skill
       Body: { action: 'allow', reason: string }
       Response: ApiResponse<{ skill: InstanceSkill, auditId: string }>
```

### 6.3 New Types (add to `packages/shared/src/types.ts`)

```typescript
// Plugin source for installation
export type PluginSource =
  | { type: 'bundled' }
  | { type: 'clawhub'; spec: string }
  | { type: 'npm'; spec: string };

// Extension lifecycle states (see §5.6 for state machine)
export type ExtensionStatus = 'pending' | 'installed' | 'active' | 'disabled' | 'degraded' | 'failed';

// Read-only info for gateway-managed extensions not tracked in DB
// Returned by list endpoints alongside managed extensions
export interface GatewayExtensionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  source: 'bundled';
  enabled: boolean;
}

// Persisted plugin state per instance
export interface InstancePlugin {
  id: string;
  instanceId: string;
  pluginId: string;
  source: PluginSource;
  version: string | null;
  lockedVersion: string | null;    // Exact version pinned at install (e.g., "1.3.2")
  integrityHash: string | null;    // SHA-512 of installed artifact for reproducibility
  enabled: boolean;
  config: Record<string, unknown>;
  status: ExtensionStatus;
  errorMessage: string | null;
  failedAt: string | null;
  retryCount: number;
  installedAt: string;
  updatedAt: string;
}

// Persisted skill state per instance
export interface InstanceSkill {
  id: string;
  instanceId: string;
  skillId: string;
  source: SkillSource;
  version: string | null;
  lockedVersion: string | null;    // Exact version pinned at install
  integrityHash: string | null;    // SHA-512 of installed artifact
  enabled: boolean;
  config: Record<string, unknown>;
  status: ExtensionStatus;
  errorMessage: string | null;
  failedAt: string | null;
  retryCount: number;
  installedAt: string;
  updatedAt: string;
}

// Catalog entry returned by browse endpoints
export interface PluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  source: 'bundled' | 'clawhub';
  version: string;
  downloadCount: number;
  ageInDays: number;
  verified: boolean;
  securityScanStatus: 'passed' | 'warning' | 'failed' | 'unknown';
  requiredCredentials: CredentialRequirement[];
  capabilities: string[];  // e.g. ['channel', 'model-provider', 'speech']
}

export interface SkillCatalogEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  source: 'bundled' | 'clawhub';
  version: string;
  downloadCount: number;
  ageInDays: number;
  verified: boolean;
  securityScanStatus: 'passed' | 'warning' | 'failed' | 'unknown';
  requiredCredentials: CredentialRequirement[];
  requiredBinaries: string[];
  requiredEnvVars: string[];
}
```

---

## 7. Database Migrations

### 7.1 `instance_plugins` table

```sql
CREATE TABLE instance_plugins (
  id              TEXT PRIMARY KEY,
  instance_id     TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  plugin_id       TEXT NOT NULL,
  source          TEXT NOT NULL,  -- JSON: PluginSource
  version         TEXT,
  locked_version  TEXT,           -- Exact version pinned at install (immutable until explicit upgrade)
  integrity_hash  TEXT,           -- SHA-512 of installed artifact
  enabled         INTEGER NOT NULL DEFAULT 1,
  config          TEXT NOT NULL DEFAULT '{}',  -- JSON
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','installed','active','disabled','degraded','failed')),
  error_message   TEXT,
  failed_at       TEXT,
  pending_owner   TEXT,           -- Server session UUID that initiated install (for orphan cleanup)
  retry_count     INTEGER NOT NULL DEFAULT 0,
  installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(instance_id, plugin_id)
);
```

### 7.2 `instance_skills` table

```sql
CREATE TABLE instance_skills (
  id              TEXT PRIMARY KEY,
  instance_id     TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL,
  source          TEXT NOT NULL,  -- JSON: SkillSource
  version         TEXT,
  locked_version  TEXT,           -- Exact version pinned at install (immutable until explicit upgrade)
  integrity_hash  TEXT,           -- SHA-512 of installed artifact
  enabled         INTEGER NOT NULL DEFAULT 1,
  config          TEXT NOT NULL DEFAULT '{}',  -- JSON
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','installed','active','disabled','degraded','failed')),
  error_message   TEXT,
  failed_at       TEXT,
  pending_owner   TEXT,           -- Server session UUID that initiated install (for orphan cleanup)
  retry_count   INTEGER NOT NULL DEFAULT 0,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(instance_id, skill_id)
);
```

### 7.3 `extension_operations` table

```sql
CREATE TABLE extension_operations (
  id                TEXT PRIMARY KEY,        -- UUID
  instance_id       TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  fencing_token     TEXT NOT NULL UNIQUE,    -- UUID, used by rollback to verify ownership
  operation_type    TEXT NOT NULL,           -- 'install' | 'uninstall' | 'enable' | 'disable' | 'update'
  target_extension  TEXT NOT NULL,           -- plugin_id or skill_id
  extension_kind    TEXT NOT NULL,           -- 'plugin' | 'skill'
  pending_owner     TEXT NOT NULL,           -- Server session UUID
  cancel_requested  INTEGER NOT NULL DEFAULT 0,  -- Set to 1 when user requests cancellation
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at      TEXT,                    -- NULL while in-progress
  result            TEXT,                    -- 'success' | 'failed' | 'rolled-back' | 'cancelled' | 'crashed'
  error_message     TEXT
);

CREATE INDEX idx_ext_ops_instance ON extension_operations(instance_id, completed_at);

-- DB-level backstop: at most one active (incomplete) operation per instance.
-- The in-memory mutex handles the normal path; this catches bugs or race conditions.
CREATE UNIQUE INDEX idx_one_active_op ON extension_operations(instance_id) WHERE completed_at IS NULL;
```

---

## 8. Gateway RPC Integration

New RPC calls needed through the existing `GatewayRPCClient` (WebSocket protocol v3):

| RPC Method | Direction | Purpose |
|-----------|-----------|---------|
| `plugins.list` | Aquarium → Gateway | List discovered plugins with status |
| `plugins.enable` | Aquarium → Gateway | Enable a plugin in gateway config |
| `plugins.disable` | Aquarium → Gateway | Disable a plugin in gateway config |
| `skills.list` | Aquarium → Gateway | List available skills with eligibility |
| `skills.install` | Aquarium → Gateway | Install skill from ClawHub/npm (existing) |
| `skills.update` | Aquarium → Gateway | Update skill config (apiKey, env, enabled) |
| `skills.uninstall` | Aquarium → Gateway | Remove an installed skill |
| `config.patch` | Aquarium → Gateway | Merge partial config (credentials, plugin entries) |

Note: `config.patch` is rate-limited to 3/minute by the gateway. Batch credential updates into a single patch.

---

## 9. Frontend Design

### 9.1 Instance Detail Page — New "Extensions" Tab

Location: `apps/web/src/pages/AssistantChatPage.tsx` (add tab alongside existing Chat, Settings, etc.)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  [Chat] [Settings] [Files] [Extensions]  ← new tab         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐                                │
│  │ Plugins  │  │ Skills   │   ← sub-tabs                   │
│  └──────────┘  └──────────┘                                │
│                                                             │
│  Search: [________________________] [Category ▾]            │
│                                                             │
│  ┌─ Installed ──────────────────────────────────────────┐   │
│  │  📦 anthropic (bundled)          [Enabled ✓] [⚙]    │   │
│  │  📦 memory-core (bundled)        [Enabled ✓] [⚙]    │   │
│  │  📦 voice-call (clawhub)         [Disabled] [⚙] [✕] │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Available ──────────────────────────────────────────┐   │
│  │  📦 matrix           ✓ Verified  12.4k downloads     │   │
│  │     Real-time Matrix chat channel                     │   │
│  │     Requires: Matrix homeserver token                 │   │
│  │                                    [Install]          │   │
│  │                                                       │   │
│  │  📦 microsoft-teams   ✓ Verified  8.1k downloads     │   │
│  │     Microsoft Teams channel integration               │   │
│  │     Requires: MS App ID, App Password                 │   │
│  │                                    [Install]          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Install Flow Dialog

```
┌─── Install "google-calendar" skill ────────────────────────┐
│                                                            │
│  Source: ClawHub (@openclaw/skill-google-calendar@1.2.0)   │
│  Downloads: 34,521    Age: 4 months    ✓ Verified          │
│  Security: VirusTotal scan passed                          │
│                                                            │
│  ── Required Credentials ──────────────────────────        │
│                                                            │
│  Google API Key:                                           │
│  [________________________________]                        │
│  ○ Save to this instance only                              │
│  ● Save to my credential vault (reuse across instances)    │
│                                                            │
│  ⚠ Community plugin — verify publisher before trusting     │
│     with sensitive credentials.                            │
│                                                            │
│                              [Cancel]  [Install & Configure]│
└────────────────────────────────────────────────────────────┘
```

### 9.3 Credential Configuration Panel

Reuse existing credential UI patterns from `credentials.ts` and `user-credentials.ts` routes. The configure gear icon (⚙) on installed items opens a side panel:

```
┌─── Configure "voice-call" plugin ─────────────────────────┐
│                                                            │
│  Status: Enabled ✓                                         │
│  Version: 1.3.2 (clawhub)                                 │
│                                                            │
│  ── Credentials ───────────────────────────────────        │
│  Twilio Account SID:  [ACxxxxxxxxx...] (instance) [Edit]  │
│  Twilio Auth Token:   [••••••••••••••] (vault)    [Edit]  │
│                                                            │
│  ── Plugin Config ─────────────────────────────────        │
│  Provider:  [twilio ▾]                                     │
│  Region:    [us1 ▾]                                        │
│                                                            │
│                               [Disable]  [Save Changes]    │
└────────────────────────────────────────────────────────────┘
```

### 9.4 i18n

All new UI strings must be added to all 6 locale files (`en`, `zh`, `fr`, `de`, `es`, `it`) in `apps/web/src/i18n/locales/`. Key namespace: `extensions`.

---

## 10. Security

### 10.1 Credential Handling

- All credentials encrypted at rest with **AES-256-GCM** (existing `credential-store.ts`)
- Per-record initialization vector — no IV reuse
- 3-layer resolution unchanged: instance → user vault → error
- Template export **never** includes credential values — only `${CREDENTIAL:provider:type}` placeholders
- Credential audit log tracks all access (existing `credential-audit.ts`)

### 10.2 Plugin/Skill Trust Policy

Plugins run **in-process** with the gateway — a malicious plugin has full access to the container, including credentials injected via `config.patch`. Given the [ClawHub malware crisis](https://openclaw.ai/blog/virustotal-partnership) (12-17% of marketplace skills were malicious), the default policy is **deny unless trusted**.

#### Trust tiers

| Tier | Criteria | Default policy | Install flow |
|------|----------|---------------|-------------|
| **Bundled** | Shipped with gateway image | Allow | One-click, no confirmation |
| **Verified** | ClawHub verified publisher + VirusTotal passed + age > 90 days + downloads > 100 | Allow | One-click with trust summary |
| **Community** | On ClawHub but does not meet verified criteria | **Block by default** | Blocked; admin can override per-extension |
| **Unscanned** | No VirusTotal scan result or scan failed | **Block always** | Cannot install; shown as "unavailable" with reason |

#### Admin override for community extensions

Instance admins (or platform admins in single-user CE) can explicitly allowlist specific community plugins or skills:

```
PUT /api/instances/:id/plugins/:pluginId/trust-override
PUT /api/instances/:id/skills/:skillId/trust-override
Body: { action: 'allow', reason: 'Reviewed source code, publisher known to team' }
```

**Authorization**: Both endpoints require authenticated instance owner (CE uses cookie-based JWT auth; the authenticated user must own the instance). Non-owner callers receive `403 Forbidden`. The audit record includes the acting principal (user ID), instance ID, extension ID, reason, and timestamp.

**Explicit credential-access consent**: Before the override is applied, the UI shows a confirmation dialog:

> "This community extension runs in-process with the gateway and will have access to all credentials on this instance, including API keys for other extensions. Only approve if you trust the publisher and have reviewed the source code."

The user must acknowledge this warning. The API requires `{ action: 'allow', reason: '...', credentialAccessAcknowledged: true }` — requests without the acknowledgment flag are rejected with `400 Bad Request`.

Both endpoints create an audit record (including the credential-access acknowledgment) and permit installation. The extension card shows "Admin-approved" instead of a trust badge. The same override is required during template instantiation if a previously-approved extension no longer meets the verified threshold (§12).

#### Trust signal display

| Signal | Display |
|--------|---------|
| Bundled | "Bundled" badge (green) |
| Verified publisher | ✓ Verified badge |
| Download count | Shown if > 100 |
| Age on ClawHub | Shown if > 90 days |
| VirusTotal scan passed | Green shield |
| VirusTotal scan failed | Red shield, install blocked |
| Community (unverified) | Yellow "Unverified" badge, install blocked unless admin-approved |

#### Skills vs plugins risk profile

Skills (SKILL.md + markdown instructions) are lower risk than plugins (in-process code execution). However, skills can include `scripts/` directories with executable code and `install` specs that run arbitrary commands. The same trust tiers apply to both, but the UI can surface a softer warning for skills that contain no scripts or install specs (metadata-only skills).

### 10.3 Gateway Isolation

- Plugins run **in-process** with the gateway (same trust boundary as the container)
- The container runs as non-root user (`node`) with limited capabilities
- Network isolation via `openclaw-net` bridge network
- Platform-bridge plugin is always loaded and cannot be disabled

### 10.4 Scoped Credential Injection

OpenClaw's single-process gateway means true per-plugin isolation requires upstream changes. However, Aquarium controls `seedConfig()` — we apply **scoped credential materialization** to minimize blast radius.

**Approach**: OpenClaw config already namespaces per-extension (`plugins.entries.<id>.config`, `skills.entries.<id>.env`). When `seedConfig()` generates `openclaw.json`:

1. Each credential is injected **only into the declaring extension's namespace** — never into shared/top-level sections.
2. If two extensions need the same provider key, each gets a separate copy in its own namespace.
3. Non-bundled extensions receive credentials via SecretRef (`{ source: "env", id: "AQUARIUM_CRED_<hash>" }`) backed by per-extension env vars, instead of plaintext in the config file.

| Trust Tier | Injection Method |
|-----------|-----------------|
| Bundled | SecretRef (env-backed, unique var name per extension) |
| Verified | SecretRef (env-backed, unique var name per extension) |
| Admin-approved | SecretRef + credential access audit log entry |

All tiers use the same env-backed SecretRef mechanism. No extension receives plaintext credentials in `openclaw.json`. This ensures the config file on disk contains only references (`{ source: "env", id: "AQUARIUM_CRED_<hash>" }`), never raw secrets — regardless of trust tier.

**Limitations**: A determined in-process plugin can still enumerate env vars or read the config file from disk. This raises the cost from trivial to deliberate, but is not true isolation. Combined with the deny-by-default trust policy (§10.2), this provides defense in depth: untrusted code is blocked from installation, and materialized credentials are scoped per-extension.

---

## 11. Persistence & Restart Behavior

### 11.1 Durability guarantees

| Component | Storage | Survives Restart? | Survives Rebuild? |
|-----------|---------|-------------------|-------------------|
| Plugin/skill declarations | `instance_plugins` / `instance_skills` tables | Yes | Yes |
| Extension config & status | Same tables | Yes | Yes |
| Credentials | `instance_credentials` table (encrypted) | Yes | Yes |
| User vault | `user_credentials` table (encrypted) | Yes | Yes |
| OpenClaw config | Generated on each start by `seedConfig()` | Regenerated | Regenerated |
| Auth profiles | `~/.openclaw/auth-profiles.json` (volume) | Yes | Depends on volume |
| **Plugin binaries (npm)** | **Container filesystem** | **Best-effort** | **Best-effort** |
| **Skill files (ClawHub)** | **Container volume `~/.openclaw/skills/`** | **Yes (volume mount)** | **Best-effort** |

### 11.2 Plugin artifact persistence strategy

npm-installed plugin packages live in the container filesystem and are **not guaranteed to survive rebuilds**. This is an intentional tradeoff — volume-mounting `node_modules` introduces version skew and platform-specific binary issues.

**Recovery mechanism:**
1. On every instance start, startup Phase 1 `seedConfig()` generates config for `active`/`degraded` extensions. Phase 3 then replays `pending` extensions — installing artifacts and promoting status. (`installed` is excluded from both phases — it is a credential-pending holding state; the binary was already installed during the original install operation and does not need reinstall. On rebuild where the binary is lost, the user must provide credentials and activate, which triggers a fresh install.)
2. Setup commands are reconstructed from the persisted `source` field + `lockedVersion`. The `source` JSON column IS the canonical install locator:
   - `{ type: 'npm', spec: '@openclaw/voice-call' }` → `npm install @openclaw/voice-call@<lockedVersion>`
   - `{ type: 'clawhub', slug: 'voice-call' }` → `openclaw skills install voice-call --version <lockedVersion>`
   - `{ type: 'bundled' }` → no install needed (shipped with gateway image)
   
   This ensures restarts reinstall the exact artifact the user approved — not a newer version that may have changed behavior or trust status. The `source` + `lockedVersion` + `integrityHash` triple is the complete immutable install descriptor.
3. If an external registry (npm, ClawHub) is unreachable during startup:
   - The setup command fails for that extension.
   - If the extension was previously `active`: status → `degraded` (not `failed`). The gateway may still have cached artifacts from the prior run and could load them successfully.
   - If the extension was `pending` (never installed): status → `failed`.
   - The instance **continues booting** with remaining extensions.
   - The dashboard shows alerts distinguishing degraded (may still work) from failed (definitely broken).
4. Users can retry degraded/failed extensions from the dashboard once connectivity is restored.

**Version pinning:**
- On successful install, the platform records `locked_version` (exact semver, e.g., `1.3.2`) and `integrity_hash` (SHA-512 of the installed package tarball or skill archive) in the DB.
- Restart recovery always replays `locked_version`. If the registry returns a different hash for the same version (supply-chain tampering), the install is rejected and the extension is marked `failed` with "integrity mismatch" error.
- **Upgrades are explicit**: `PUT /api/instances/:id/plugins/:pluginId` with `{ upgrade: true }` fetches the latest version, re-pins, and re-hashes. This is a separate workflow from restart recovery.
- Template export includes `lockedVersion` and `integrityHash` in the serialized declarations, so imported templates reproduce the exact same artifact.

**Key invariant:** The DB tables are the source of truth for *what should be installed*. The gateway runtime is the source of truth for *what is actually running*. The reconciliation pass (§5.4) detects and surfaces any divergence.

### 11.3 Offline resilience (future consideration)

For air-gapped or unreliable-network deployments, a future enhancement could:
- Volume-mount a dedicated plugin artifact cache (`~/.openclaw/plugin-cache/`)
- Cache npm tarballs on first successful install
- Prefer cache on subsequent installs, fall back to registry

This is not in scope for the initial phases but the lifecycle model supports it — the `failed` → retry flow works regardless of whether the retry hits cache or registry.

---

## 12. Template Integration

### Export (existing `exportFromInstance`, extend)

Currently captures:
- ✅ Workspace files (allowlisted + secret-scanned per §5.5.1)
- ✅ MCP server configs (with secret scrubbing)
- ✅ OpenClaw config (**base config only** — see below)
- ✅ Security config

**Change:** The exported OpenClaw config is the **base config** (user preferences, model settings, channel config), NOT the materialized runtime config generated by `seedConfig()`. The materialized config contains resolved credentials (plaintext for bundled extensions, env-backed SecretRefs for others) and must never be exported. Specifically:
- `plugins.entries.<id>.config` — export structure/enable state only, strip any credential fields using the same `SENSITIVE_PATTERNS` + `${CREDENTIAL:...}` placeholder rewrite used for MCP configs
- `skills.entries.<id>.env` / `skills.entries.<id>.apiKey` — replace with `${CREDENTIAL:...}` placeholders
- `providers.*` — strip API keys, replace with placeholders

**Change:** Plugin declarations are now read from `instance_plugins` table (not legacy `template_contents.plugin_dependencies`). Skill declarations from `instance_skills` table. Both include `lockedVersion` and `integrityHash` for reproducible instantiation. The legacy `plugin_dependencies` field is ignored during export if lifecycle table rows exist; it is only used as a fallback for instances created before this feature (pre-migration).

### Instantiation (existing `instantiateTemplate`, extend)

Currently does:
- ✅ Resolve credentials from user-provided + user vault
- ✅ Generate setup commands from `pluginDependencies` + `skills` + `mcpServers`
- ✅ Execute setup commands post-startup

**Change:** For plugins and skills that have lifecycle table support, **lifecycle rows replace setup commands** as the install authority. The old `generateDependencySetupCommands()` path continues to handle MCP servers only (which don't have lifecycle tables). This avoids duplicate execution — there is exactly one install path per extension type:
- Plugins/skills → `instance_plugins`/`instance_skills` rows → `seedConfig()` on first boot
- MCP servers → setup commands (existing behavior, unchanged)

Insert rows into `instance_plugins` and `instance_skills` tables from the template's declarations, **after re-evaluating trust policy** (§10.2) for each extension:

1. **Trust re-evaluation**: Each extension in the template is checked against the current trust policy — not the policy at export time. A template exported when an extension was verified can fail instantiation if that extension has since been revoked, flagged as malware, or fallen below the verified threshold.
   - **Bundled**: Always pass.
   - **Verified**: Re-checked against current ClawHub metadata (download count, age, scan status). If still verified → insert as `pending`.
   - **Community / admin-approved**: Requires a fresh admin override on the target instance. Instantiation returns the blocked extensions in `requiresTrustOverride[]` and the UI prompts the admin to approve or skip each one.
   - **Unscanned / scan failed**: Blocked. Cannot be instantiated regardless of template origin.

2. **Insertion**: Extensions that pass trust → inserted with status `pending` (enabled) or `disabled` (per template). Blocked extensions are omitted with a warning in the instantiation response.

3. **First boot**: Startup Phase 3 (§5.4) replays `pending` rows — installs them and promotes to `active` (no credentials needed) or `installed` (credentials needed) on success.

---

## 13. Phased Delivery

### Phase 1: Skill Management (P0)

- `instance_skills` migration (with lifecycle status column + CHECK constraint) + `skill-store.ts` service
- Extension lifecycle state machine (§5.6): `pending` → `installed` → `active` → `disabled` / `degraded` / `failed`
- Per-instance extension mutation lock (§5.8)
- Extend `routes/skills.ts` with list, catalog, install, configure, uninstall
- Frontend: Extensions tab with Skills sub-tab (browse, install, configure)
- Credential prompt during install flow
- Persist installed skills in DB, restore on restart via `seedConfig()` (skip `failed`, use `degraded` for previously-active reinstall failures)
- Post-boot reconciliation pass: `skills.list` RPC vs DB
- Orphaned `pending` cleanup via `pending_owner` session UUID check (on server startup)
- Bundled skills catalog (static list from gateway image)

### Phase 2: Plugin Management (P0)

- `instance_plugins` migration (same lifecycle model) + `plugin-store.ts` service
- New `routes/plugins.ts` with full CRUD
- Frontend: Plugins sub-tab (browse, install, configure, enable/disable)
- Gateway restart flow after plugin install (with user confirmation)
- Post-restart health check (`platform.ping`) → promote to `active` or rollback to `failed`
- Plugin rollback: if plugin causes boot failure, auto-remove from config and restart
- Disable `commands.plugins` in managed instance config (§5.7)
- Bundled plugins catalog

### Phase 3: ClawHub Integration + Trust Policy (P1)

- `marketplace-client.ts` service — query ClawHub API for catalog
- Trust tier enforcement (§10.2): bundled=allow, verified=allow, community=block, unscanned=block
- Admin trust override endpoint (`PUT /trust-override`) with audit logging
- Trust signal display (verified badge, download count, age, VirusTotal status)
- Search and category filtering
- Version management (update available indicators)

### Phase 4: Template Portability (P1)

- Pre-export reconciliation pass (sync DB with gateway state)
- Workspace file allowlist + secret scanning on export (§5.5.1)
- Export `active`/`degraded` as enabled, `installed` as needsCredentials, `disabled` as disabled
- Trust re-evaluation at instantiation time (§12) — blocked extensions require fresh admin override
- Template instantiation inserts trusted rows as `pending` (enabled) or `disabled` (per template)
- On first boot, startup Phase 3 (§5.4) replays `pending` rows → install → promote to `active` or `installed`
- Setup command generation from persisted plugin/skill state
- Credential requirement prompting during instantiation

### Phase 5: OAuth & Advanced Auth (P2)

- OAuth proxy flow for plugins requiring browser-based auth
- Platform callback URL that relays to container's `127.0.0.1:1455`
- SecretRef configuration UI for vault integration (1Password, HashiCorp Vault)

**OAuth durability scope**: OAuth state (access/refresh tokens) lives in `~/.openclaw/auth-profiles.json` on the container volume — it is NOT stored in the Aquarium DB. This means:
- **Restart**: Survives (volume persists).
- **Rebuild**: Survives only if volume is retained.
- **Template export**: OAuth tokens are **excluded** (security). Extensions requiring OAuth are exported with `requiresReAuth=true` flag. On import, the UI prompts the user to re-authenticate.
- **Durability guarantee**: OAuth-backed extensions have weaker durability than API-key-backed extensions. This is an accepted limitation of Phase 5. DB-backed OAuth token persistence is a potential Phase 7 enhancement if demand warrants.

### Phase 6: Offline Resilience (P2, future)

- Plugin artifact cache volume mount (`~/.openclaw/plugin-cache/`)
- Cache npm tarballs on first successful install
- Prefer cache on restart, fall back to registry
- Dashboard indicator for cached vs registry-fetched extensions

---

## 14. Success Metrics

| Metric | Target |
|--------|--------|
| Time to install first plugin/skill (from dashboard) | < 2 minutes |
| Extension declarations survive instance restart | 100% (DB-backed) |
| Extension runtime recovery on restart (with network) | > 95% (best-effort reinstall) |
| Extension runtime recovery on rebuild (with network) | > 90% (best-effort reinstall) |
| Credential encryption at rest | 100% (AES-256-GCM) |
| Template round-trip preserves active + installed + disabled plugins/skills | 100% (minus credential values) |
| Failed extensions surface dashboard alert | 100% |
| User abandonment during install flow | < 10% |

---

## 15. Resolved Design Decisions

Decisions made in response to adversarial reviews (2026-04-03):

**Round 1** — Architectural issues:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 1 | Chat command coexistence | Disabled for managed instances. Platform is sole writer; reconciliation on boot/export catches drift. | §5.7 |
| 2 | Plugin binary persistence | Best-effort reinstall on restart/rebuild. No volume mount (avoids version skew). Failed installs surface in dashboard. Future: artifact cache (Phase 6). | §11.2, §11.3 |
| 3 | Install rollback/idempotency | Extension lifecycle state machine with explicit `pending` → `active` → `failed` transitions. Failed extensions don't block boot. | §5.6 |
| 4 | Trust policy for community code | Deny by default. Only bundled + verified extensions installable without admin override. Admin can allowlist specific community extensions with audit trail. | §10.2 |

**Round 2** — Internal consistency:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 5 | Template `pending` deadlock | Startup Phase 3 replays `pending` rows — they trigger install on first boot. Template instantiation creates `pending` rows that are promoted on startup. | §5.4, §5.6 |
| 6 | `discovered` not in schema | Gateway-only extensions are NOT stored in DB. Returned as separate `gatewayBuiltins` field in list API responses. | §5.7, §6.1 |
| 7 | Disabled extensions lost on export | Export includes `active`, `installed`, `disabled`, and `degraded` extensions with state hints (`enabled`, `needsCredentials`). | §5.5, §5.6 |

**Round 3** — Operational hardening:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 8 | Export drops `installed` extensions | `installed` (credential-pending) extensions are now exported with `needsCredentials=true` flag. Import recreates them as `pending` + credential prompt. | §5.5, §5.6 |
| 9 | `pending` cleanup races | Replaced wall-clock sweep with `pending_owner` PID tracking. Only orphan cleanup on server startup when the owning process is dead. | §5.6, §7.1 |
| 10 | Registry outage breaks active extensions | New `degraded` state for previously-active extensions that fail reinstall. Included in `seedConfig()` (gateway may still have cached artifacts). Distinct from `failed` (never worked). | §5.4, §5.6, §11.2 |
| 11 | Concurrent mutation corruption | Per-instance in-memory mutex on extension mutations. Serializes restart-causing operations. Rollback compares against specific mutation record. 409 Conflict on contention. | §5.3, §5.8 |

**Round 4** — Edge case hardening:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 12 | Force-release lock races with slow installs | Removed force-release timeout. Lock is held until operation completes or is explicitly cancelled by user. Durable `extension_operations` table with fencing tokens for crash recovery. | §5.8, §7.3 |
| 13 | Per-plugin credential isolation | Scoped credential injection — each credential materialized only into the declaring extension's config namespace via SecretRef. Not true process isolation (OpenClaw limitation), but raises cost from trivial to deliberate. Combined with deny-by-default trust policy. | §10.4 |
| 14 | Restart installs different artifact version | Version pinning with `locked_version` + `integrity_hash` (SHA-512). Restart recovery replays exact pinned version. Hash mismatch = rejected install. Upgrades are a separate explicit workflow. | §11.2, §7.1 |

**Round 5** — Template security & cancellation:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 15 | Template export leaks workspace secrets | Workspace files exported through allowlist (known-safe files only) + secret scanning with `SENSITIVE_PATTERNS`. Detected secrets are redacted, export warns user. | §5.5.1, §12 |
| 16 | Template import bypasses trust policy | Trust re-evaluation at instantiation time. Each extension checked against current ClawHub metadata. Revoked/blocked extensions require fresh admin override or are skipped. | §12 |
| 17 | Cancellation releases lock while worker runs | Cooperative cancellation — `cancel_requested` flag checked at worker checkpoints. Lock not released until worker acknowledges. Fencing token verified on all DB/config writes (not just rollback), preventing zombie workers. | §5.8, §7.3 |

**Round 6** — Consistency & scope:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 18 | Duplicate template install paths | Lifecycle rows replace setup commands for plugins/skills. `generateDependencySetupCommands()` only handles MCP servers. One install authority per extension type. | §12 |
| 19 | Skills bypass mutation lock | All extension mutations (plugins AND skills AND credential injection) go through the same per-instance lock with fencing tokens. | §5.2, §5.8 |
| 20 | OAuth not durable across rebuild/export | OAuth tokens excluded from templates (`requiresReAuth=true`). Rebuild durability depends on volume. Weaker guarantee than API keys — accepted for Phase 5. DB-backed OAuth is potential Phase 7. | Phase 5 |

**Round 7** — Lock deadlock, export leaks, plugin export source:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 21 | Plugin lock held across user think-time | Split plugin install into 3 discrete operations (install binary → configure credentials → activate/restart). Lock released between each. No lock held during user interaction. | §5.3 |
| 22 | Exported openclaw.json leaks plaintext credentials | Export uses base config only, not materialized runtime config. All credential fields in plugin/skill/provider namespaces scrubbed with `${CREDENTIAL:...}` placeholders. | §5.5, §12 |
| 23 | Plugin export reads legacy table, not lifecycle table | Plugin declarations now read from `instance_plugins` (same as skills from `instance_skills`). Legacy `plugin_dependencies` used only as fallback for pre-migration instances. | §5.5, §12 |

**Round 8** — Spec accuracy:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 24 | `installed` extensions loaded on restart break boot | Excluded `installed` from all startup phases. Phase 1 loads `active`/`degraded`. Phase 3 replays `pending`. `installed` waits for credentials + explicit activation. | §5.4, §5.6 |
| 25 | Invalid SQLite in `extension_operations` migration | Moved `INDEX` to separate `CREATE INDEX` statement. | §7.3 |
| 26 | No skill trust-override endpoint | Added `PUT /skills/:skillId/trust-override` symmetric with plugins. Updated §10.2 to reference both. | §6.2, §10.2 |

**Round 9** — API scoping, crash safety, state consistency:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 27 | Credential API not extension-scoped | Added `extensionKind`, `extensionId`, `targetField` to credential write API. Credentials bound to specific extension, `config.patch` targets derived from binding. | §5.2, §5.3 |
| 28 | Crash recovery force-fails in-flight ops | Orphaned operations now recover to `pending` (not `failed`). Post-boot reconciliation determines actual state — promotes if extension loaded, reinstalls if absent. | §5.8 |
| 29 | `installed` state contradicts §11.2 restart behavior | `installed` excluded from both `seedConfig()` and reinstall. Credential-pending holding state only. On rebuild, user must activate to trigger reinstall. | §5.4, §11.2 |

**Round 10** — Tradeoffs & completeness:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 30 | `installed` not restart-durable | No change. Deliberate design: `installed` is credential-pending, loading it would cause boot failures. Exported with `needsCredentials=true` for portability. User activates after providing credentials. | §5.4, §5.6, §11.2 |
| 31 | Skill scripts lost on export | Local skills with `scripts/` or `assets/` are rejected from export with a warning. Registry skills (ClawHub/npm) are fully portable via `lockedVersion` + reinstall. | §5.5.1 |
| 32 | Trust-override lacks authz spec | Added explicit 403 Forbidden for non-owner callers. Audit record includes acting principal, instance ID, extension ID, reason, timestamp. | §10.2 |

**Round 11** — DB enforcement, rebuild recovery, export hardening:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 33 | No DB constraint for one active op per instance | Added `CREATE UNIQUE INDEX ... WHERE completed_at IS NULL` as DB-level backstop for the in-memory mutex. | §7.3 |
| 34 | Plugin activation fails after rebuild (binary gone) | Activation now verifies artifact exists and reinstalls from `lockedVersion` + `integrityHash` if missing before restarting gateway. | §5.3 |
| 35 | User-selected files bypass regex secret scan | User-selected files require per-file "no secrets" confirmation checkbox. Export response always warns that user-selected files were not fully scanned. | §5.5.1 |

**Round 12** — Config sequencing, crash replay, durability wording:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 36 | Plugin added to live config before activation | Operation 1 now installs artifact only — does NOT `config.patch`. Plugin added to `plugins.entries` atomically during Operation 3 (activate). Prevents accidental loading by other restarts. | §5.3 |
| 37 | Crash recovery → `pending` → blind reinstall | Startup reordered into 3 phases: (1) config for active/degraded only, (2) boot + reconcile (promotes crash-recovered extensions already present), (3) replay remaining `pending`. Reconciliation runs BEFORE reinstall. | §5.4 |
| 38 | Durability promise vs `installed` semantics | Clarified user story and goal: "all activated extensions" are restart-durable. `installed` (credential-pending) retains declarations but is not loaded. No semantic change, just wording alignment. | §2, US-4 |

**Round 13** — Install locator, hung process recovery, session identity:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 39 | No install locator persisted for recovery | Clarified that the `source` JSON field IS the canonical install locator. `source` + `lockedVersion` + `integrityHash` = complete immutable install descriptor. No schema change needed. | §11.2 |
| 40 | Hung install/restart deadlocks instance forever | Added per-subprocess execution deadlines (npm: 5min, skills: 3min, restart: 2min, config.patch: 30s). Subprocess killed on deadline, operation marked failed, lock released cleanly. | §5.8 |
| 41 | PID-based ownership unreliable in containers | Replaced `pending_owner` PID with `server_session_id` (UUID generated per server startup). Crash recovery keys off session UUID, not OS PID. Eliminates PID-reuse ambiguity. | §5.6, §5.8, §7.1-7.3 |

**Round 14** — Table consistency, export scope, trust consent:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 42 | §5.6 table says `pending` in seedConfig but §5.4 says Phase 3 | Fixed table: `pending` column now split into Phase 1 (No) and Phase 3 (Yes). Explanation updated to reference Phase 3 explicitly. | §5.6 |
| 43 | User-selected arbitrary file export leaks secrets | Dropped from v1. Allowlist covers standard workspace files. Arbitrary file export deferred to future version with stronger scanning. | §5.5.1 |
| 44 | Admin-approved plugins access all instance credentials | Added explicit credential-access consent dialog + `credentialAccessAcknowledged` flag required in API. Admin makes informed choice. Scoped injection is defense-in-depth, not isolation guarantee. | §10.2 |

**Round 15** — No-auth fast path, uniform SecretRef, stale references:

| # | Question | Decision | Section |
|---|----------|----------|---------|
| 45 | No-credential skills stuck at `installed` forever | Skills/plugins with no `requiredCredentials` promote directly to `active` after install (skip `installed` state entirely). `installed` is reserved for credential-pending only. Plugins with no creds go straight to Operation 3 (activate) within same lock hold. | §5.2, §5.3 |
| 46 | Bundled credentials plaintext in openclaw.json | All tiers now use env-backed SecretRef. No extension receives plaintext credentials in config file, regardless of trust tier. | §10.4 |
| 47 | Stale `seedConfig() consumes pending` references | Fixed 5 stale references in §11.2, §12, Phase 4, and resolved decisions. All now say "Phase 3 replays pending rows" consistently. | §5.4, §5.6, §11.2, §12 |

## 16. Open Questions

1. **ClawHub API access** — Does ClawHub provide a public REST API for catalog queries, or do we need to scrape/cache? Need to verify API availability and rate limits.
2. **Gateway restart UX** — Plugin installs require gateway restart. Should we auto-restart or require user confirmation? Auto-restart risks interrupting active conversations.
3. **Bundled catalog source** — Should we query the gateway via RPC (`plugins.list`, `skills.list`) for the bundled catalog, or maintain a static list synced with the gateway image version?
4. **Multi-agent skills** — OpenClaw supports per-agent skill filtering. Should our UI expose per-agent config, or apply skills globally to the instance?
5. **Reconciliation frequency** — Beyond boot and export, should we run periodic reconciliation (e.g., every 5 minutes) to detect gateway-side drift? Or is event-driven (`config.changed` relay) sufficient?
6. **Admin override scope** — Should trust overrides be per-instance or platform-wide? Per-instance is safer but creates repetitive work for multi-instance users.
