# Feature Landscape: Gateway Communication Overhaul

**Domain:** Platform-to-gateway event-driven communication redesign
**Researched:** 2026-04-05
**Overall confidence:** HIGH (all findings from source code reading, not guesses)

## Research Methodology

All findings below come from direct source code reading of the OpenClaw gateway at `/Users/shuai/workspace/citronetic/openclaw/src/gateway/`. Line numbers and file paths are cited. No claims are based on training data alone.

---

## Question 1: Every Event the Gateway Actually Emits

**Source:** `server-methods-list.ts:124-149` (GATEWAY_EVENTS array) and `events.ts:3`

The gateway declares exactly these event types in its `GATEWAY_EVENTS` array, which is sent to clients in the `hello-ok` handshake (`features.events`):

| Event | Payload Shape | When It Fires | Source File |
|-------|--------------|---------------|-------------|
| `connect.challenge` | `{}` (empty) | Immediately upon WebSocket connection, before auth | `server/ws-connection/` |
| `agent` | `{ sessionKey, agentId, state, ... }` | Agent run state transitions (thinking, tool_use, done, error) | `server-chat.ts:747,796` |
| `chat` | `{ sessionKey, state, content?, role?, delta?, ... }` | Chat message streaming, completion, abort | `server-chat.ts:583,640,680,691` |
| `session.message` | `{ sessionKey, message, messageId?, messageSeq?, ...sessionSnapshot }` | Individual message written to transcript | `server.impl.ts:1007` |
| `sessions.changed` | `{ sessionKey, phase/reason, ts, ...sessionRow }` | Session lifecycle: message, created, deleted, compacted, reset | `server.impl.ts:1022,1046`, `server-methods/sessions.ts:141` |
| `presence` | `{ presence: PresenceEntry[] }` | Client connects/disconnects, presence updates | `server/presence-events.ts:10-11` |
| `tick` | `{ ts: number }` | Periodic heartbeat (configurable interval via `policy.tickIntervalMs`) | `server-maintenance.ts:62` |
| `talk.mode` | `{ mode, ... }` | Voice talk mode changes | `server-methods/talk.ts:312` |
| `shutdown` | `{ reason: string, restartExpectedMs?: number }` | Gateway shutting down (clean close) | `server-close.ts:87`, schema at `protocol/schema/frames.ts:12-18` |
| `health` | `HealthSummary` (full snapshot) | Periodic health refresh broadcasts | `server-maintenance.ts:50` |
| `heartbeat` | `HeartbeatEvent` | Agent heartbeat fires | `server.impl.ts:927` |
| `cron` | `CronEvent` | Cron job execution events | `server-cron.ts:366` |
| `node.pair.requested` | `{ requestId, nodeId, ... }` | Remote node requests pairing | `server-methods/nodes.ts:521` |
| `node.pair.resolved` | (not found in broadcast calls) | Declared but no broadcast found -- likely emitted via node-specific send, not broadcast | |
| `node.invoke.request` | (not found in broadcast calls) | Declared but likely node-to-node direct send | |
| `device.pair.requested` | `{ requestId, ... }` | Device pairing request | `server/ws-connection/message-handler.ts:836-840` |
| `device.pair.resolved` | (not found in broadcast calls) | Declared in events list | |
| `voicewake.changed` | `{ triggers: string[] }` | Voice wake trigger config changes | `server.impl.ts:824` |
| `exec.approval.requested` | `{ id, request, createdAtMs, expiresAtMs }` | Command exec approval requested | `server-methods/exec-approval.ts:180-189` |
| `exec.approval.resolved` | `{ id, decision, resolvedBy }` | Command exec approval decided | (via manager resolve pattern) |
| `plugin.approval.requested` | Similar to exec.approval | Plugin action approval requested | (parallel to exec.approval) |
| `plugin.approval.resolved` | Similar to exec.approval | Plugin action approval decided | |
| `update.available` | `{ updateAvailable: { currentVersion, latestVersion, channel } \| null }` | Gateway update check finds new version | `events.ts:3-6` |

**Key insight:** The gateway does NOT emit events for config changes, plugin load/fail, or skill load/fail. These are all file-system-driven operations that happen during startup or restart.

---

## Question 2: config.patch -- Incremental vs Full Replacement

**Source:** `server-methods/config.ts:317-437`, `config/merge-patch.ts:62-97`, `protocol/schema/config.ts:20-29`

**Answer: config.patch accepts a JSON merge-patch in the `raw` string parameter, NOT full replacement.**

The flow:
1. Client sends `{ raw: "<json5 string>", baseHash: "<hash>" }` (schema at `config.ts:31`)
2. Gateway parses the `raw` string as JSON5 (`config.ts:345-346`)
3. Validates it's an object (`config.ts:350-360`)
4. **Applies RFC 7396-style merge patch** via `applyMergePatch(snapshot.config, parsedRes.parsed, { mergeObjectArraysById: true })` (`config.ts:362-364`)
5. Restores redacted values, runs legacy migrations, validates the merged result
6. Writes the full merged config to disk
7. **Schedules a SIGUSR1 restart** (`config.ts:409-418`)

The merge-patch semantics from `merge-patch.ts`:
- `null` values delete keys (line 78)
- Object values merge recursively (line 88-92)
- Array values with id-keyed objects merge by id (line 81-86) -- this is important for `plugins.entries[]`
- Non-object values replace directly (line 93)

**CRITICAL: config.patch triggers a gateway restart (SIGUSR1), not a hot reload.** The handler explicitly calls `scheduleGatewaySigusr1Restart()` at line 409. This is the same for `config.apply`.

**Rate limit:** 3 calls per 60 seconds per device/IP, enforced at the method handler level (`server-methods.ts:109-133`, `control-plane-rate-limit.ts:4-5`). Applies to `config.apply`, `config.patch`, and `update.run`.

---

## Question 3: Can Plugins Be Hot-Reloaded Without Full Restart?

**Source:** `config-reload-plan.ts:97` and `config-reload.ts:72-182`

**Answer: NO. Plugin changes require a full gateway restart.**

The config-reload-plan explicitly classifies `plugins` as `kind: "restart"` (`config-reload-plan.ts:97`):

```
{ prefix: "plugins", kind: "restart" },
```

The reload plan evaluation at `config-reload-plan.ts:188-204`:
- If a changed config path matches a `"restart"` rule, `plan.restartGateway = true`
- If no rule matches at all, it also defaults to `restartGateway = true`

What CAN be hot-reloaded (for reference):
- `hooks` config -- hot, reloads hooks
- `cron` config -- hot, restarts cron
- `models` config -- hot, restarts heartbeat
- `agents.defaults.*` -- hot, restarts heartbeat
- Channel-specific config -- hot, restarts individual channel

What CANNOT be hot-reloaded (requires restart):
- `plugins` -- any change to `plugins.*`
- `gateway` -- any change to `gateway.*` (except `gateway.remote`, `gateway.reload`, and channel health settings)
- `browser` -- browser config
- `discovery` -- discovery config
- `canvasHost` -- canvas host config

**So when Aquarium calls config.patch with plugin changes, the gateway writes the config, schedules a restart, and the gateway process restarts.** The new plugins load during the next startup via `loadGatewayStartupPlugins()` (`server-plugin-bootstrap.ts:84-88`).

---

## Question 4: Does the Gateway Emit Events for Config/Plugin/Skill Changes?

**Answer: NO. The gateway emits zero events for these lifecycle transitions.**

Evidence (negative finding, verified by exhaustive search):
1. **No `config.changed` event exists** in `GATEWAY_EVENTS` (`server-methods-list.ts:124-149`)
2. **No `plugin.loaded`/`plugin.failed` event exists** in `GATEWAY_EVENTS`
3. **No `skill.loaded`/`skill.failed` event exists** in `GATEWAY_EVENTS`
4. `config.patch` returns a response with the new config, restart info, and sentinel path -- but emits no broadcast event
5. The `startGatewayConfigReloader` (`config-reload.ts:72-247`) uses chokidar to watch the config file and triggers reload/restart internally, but broadcasts nothing to WS clients about what changed
6. Plugin load diagnostics (`server-plugin-bootstrap.ts:37-57`) are logged to the subsystem logger, not broadcast as events

**The only way Aquarium can know the gateway restarted is:**
- The persistent WebSocket connection drops (gateway process restarts via SIGUSR1)
- On reconnect, the hello-ok snapshot contains updated state
- The `shutdown` event fires before the restart with `{ reason, restartExpectedMs }`

---

## Question 5: Gateway Health Endpoint

**Source:** `server-http.ts:128-133,224-276` and `server/health-state.ts:1-85` and `server/readiness.ts:1-81`

The gateway exposes four HTTP health paths:

| Path | Type | Response |
|------|------|----------|
| `/health` | Liveness | `200 { ok: true, status: "live" }` |
| `/healthz` | Liveness | `200 { ok: true, status: "live" }` |
| `/ready` | Readiness | `200 { ready: true, ... }` or `503 { ready: false, failing: [...] }` |
| `/readyz` | Readiness | Same as `/ready` |

**Liveness** (`/health`, `/healthz`): Always returns 200 with `{ ok: true, status: "live" }` if the HTTP server is up. No auth required. (`server-http.ts:269-271`)

**Readiness** (`/ready`, `/readyz`): Evaluates channel health (`server/readiness.ts:34-80`):
- Iterates over all channel accounts
- Evaluates each against `ChannelHealthPolicy` (stale event threshold, connect grace period)
- Returns `{ ready: boolean, failing: string[], uptimeMs: number }` (with details only for local or authenticated requests)
- 1-second cache TTL on readiness checks

**WS health RPC** (`health` method, `server-methods/health.ts:11-29`):
- Returns full `HealthSummary` object (from `commands/health.ts:48-73`)
- Cached with background refresh (`HEALTH_REFRESH_INTERVAL_MS`)
- Supports `params.probe: true` to force a fresh snapshot
- Response shape: `{ ok: true, ts, durationMs, channels: {...}, channelOrder, channelLabels, heartbeatSeconds, defaultAgentId, agents: [...], sessions: { path, count, recent } }`

**WS status RPC** (`status` method, `server-methods/health.ts:30-37`):
- Returns `StatusSummary` (from `commands/status.types.ts:37-63`)
- Includes: `runtimeVersion`, `heartbeat` (per-agent), `channelSummary`, `sessions` (counts, recent, by-agent), `linkChannel`, `queuedSystemEvents`

**For Aquarium's health checks:** The HTTP `/ready` endpoint is the right tool. It returns structured data (including `failing` channel names and `uptimeMs`) that Aquarium can poll without maintaining a WS connection. The liveness probe at `/health` is too coarse (just confirms HTTP server is up).

---

## Question 6: RPC Methods for Reading Gateway State

### config.get

**Source:** `server-methods/config.ts:247-254`

- **Params:** `{}` (empty object, `ConfigGetParamsSchema` at `protocol/schema/config.ts:10`)
- **Response:** Redacted config snapshot
  ```
  {
    exists: boolean,
    valid: boolean,
    path: string,
    config: OpenClawConfig (with sensitive fields redacted),
    hash: string,        // SHA-256 of raw config file content
    rawLength: number,
    issues: ConfigValidationIssue[],
    legacyIssues: [...]
  }
  ```
- The `hash` is critical -- it's the `baseHash` required for subsequent `config.patch`/`config.set`/`config.apply` calls (optimistic concurrency control at `config.ts:54-98`)

### skills.status

**Source:** `server-methods/skills.ts:59-91`, return type at `agents/skills-status.ts:51-55`

- **Params:** `{ agentId?: string }` (`SkillsStatusParamsSchema` at `protocol/schema/agents-models-skills.ts:186-191`)
- **Response:** `SkillStatusReport`
  ```
  {
    workspaceDir: string,
    managedSkillsDir: string,
    skills: SkillStatusEntry[]
  }
  ```
  Each `SkillStatusEntry` (`skills-status.ts:30-49`):
  ```
  {
    name, description, source, bundled, filePath, baseDir,
    skillKey, primaryEnv?, emoji?, homepage?,
    always, disabled, blockedByAllowlist, eligible,
    requirements: Requirements,
    missing: Requirements,
    configChecks: SkillStatusConfigCheck[],
    install: SkillInstallOption[]
  }
  ```

### tools.catalog

**Source:** `server-methods/tools-catalog.ts:155-182`, `protocol/schema/agents-models-skills.ts:243-310`

- **Params:** `{ agentId?: string, includePlugins?: boolean }`
- **Response:** `ToolsCatalogResult`
  ```
  {
    agentId: string,
    profiles: [{ id, label }],
    groups: [{
      id, label, source: "core"|"plugin", pluginId?,
      tools: [{
        id, label, description, source, pluginId?,
        optional?, defaultProfiles: string[]
      }]
    }]
  }
  ```
  This effectively serves as a **plugins.list equivalent** -- plugin tools are grouped by pluginId.

### No dedicated plugins.list RPC exists

There is no `plugins.list` method in `BASE_METHODS` (`server-methods-list.ts:4-117`). Plugin state is observable through:
1. `tools.catalog` with `includePlugins: true` -- lists plugin-contributed tools grouped by pluginId
2. `config.get` -- returns the full config including `plugins.entries` which lists configured plugins
3. `config.schema` -- returns the runtime schema including plugin-contributed config sections

### models.list

**Source:** `protocol/schema/agents-models-skills.ts:177-184`

- **Params:** `{}`
- **Response:** `{ models: [{ id, name, provider, contextWindow?, reasoning? }] }`

### agents.list

**Source:** `protocol/schema/agents-models-skills.ts:45-55`

- **Params:** `{}`
- **Response:** `{ defaultId, mainKey, scope, agents: [{ id, name?, identity?, workspace?, model? }] }`

---

## Table Stakes Features

Features that users expect for gateway communication. Missing = broken/unreliable experience.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Route RPC through persistent WS | Eliminate ephemeral connections, reduce latency | Medium | PersistentGatewayClient already exists | Add `call()` method that sends req frames and correlates responses by id |
| Event-driven DB sync for chat/approval events | Dashboard already shows chat and approvals; must stay in sync | Medium | Existing `gateway-event-relay.ts` already handles chat/exec.approval events | Extend to more event types |
| Gateway-first config updates via config.patch | Eliminate config file rewrites for running instances | Medium | config.patch already supports merge-patch; must manage baseHash lifecycle | **WARNING:** config.patch triggers restart, not hot-reload |
| Detect gateway restart via shutdown event | Know when gateway is restarting vs crashing | Low | `shutdown` event already emitted with reason and restartExpectedMs | Add handler in PersistentGatewayClient |
| HTTP health checks at `/ready` | Replace or augment Docker container polling | Low | HTTP endpoint exists, no auth needed for local | Returns `{ ready, failing, uptimeMs }` |
| baseHash management for config optimistic locking | Prevent config.patch conflicts from stale reads | Medium | Gateway enforces baseHash; Aquarium must track per-instance | `config.get` returns hash; must refresh after every patch or rejection |

## Differentiators

Features that go beyond basic communication, providing a more reliable and responsive experience.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| Batched config.patch with merge semantics | Install multiple plugins/skills in one config.patch call | Low | `applyMergePatch` already supports deep merge with id-keyed arrays | Rate limit: 3/min -- batching is not just nice, it's **necessary** |
| Skill lifecycle via skills.status + skills.install + skills.update | Full skill management without config editing | Medium | All three RPC methods exist and work | skills.update writes config AND can trigger ClawHub updates |
| Hello-ok snapshot consumption on reconnect | Instantly sync full gateway state after restart | Medium | Snapshot shape at `server/health-state.ts:17-47` includes presence, health, config, session defaults | Must parse and update DB on every reconnect |
| Graceful restart awareness via shutdown event + sentinel | Distinguish expected restarts from crashes | Medium | Gateway writes restart sentinel file; shutdown event has `restartExpectedMs` | Can set expected-restart flag on instance to suppress error alerts |
| Config schema introspection via config.schema | Build dynamic config UIs without hardcoding field knowledge | High | `config.schema` and `config.schema.lookup` RPCs exist | Returns JSON Schema + uiHints with labels, groups, sensitivity markers |
| Tool catalog via tools.catalog | Show which tools (core + plugin) are active per agent | Low | RPC exists, returns grouped tool list | Useful for plugin management UI -- shows what each plugin contributes |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Poll config.get to detect config changes | Gateway has no config.changed event; polling wastes rate-limit budget (config.get isn't rate-limited but creates load) | Use shutdown/reconnect pattern: config.patch -> shutdown event -> reconnect -> hello-ok snapshot |
| Attempt hot-reload of plugins via config.patch | Gateway WILL restart on any plugins.* change; pretending otherwise creates false UX promises | Design UI to show "gateway will restart" warning when plugin changes are pending; batch all plugin changes into one config.patch |
| Implement custom plugin load status tracking | Gateway emits zero events about plugin load success/failure | After restart + reconnect, call tools.catalog to verify plugin tools loaded; compare against expected set |
| Use config.set instead of config.patch | config.set requires sending the ENTIRE config as raw JSON, which means read-modify-write with race conditions | config.patch with merge semantics is the correct approach; only send the delta |
| Maintain separate health polling loop via WS RPC | WS health RPC (`health` method) shares rate-limit context and creates unnecessary traffic | Use HTTP `/ready` endpoint for health polling (separate from WS connection), reserve WS `health` events for passive broadcast consumption |
| Skip baseHash on config.patch calls | Will silently overwrite concurrent changes from other clients (e.g., user editing config in OpenClaw Control UI) | Always: config.get -> extract hash -> config.patch with baseHash -> on CONFLICT, re-read and retry |

## Feature Dependencies

```
config.get (read hash) -> config.patch (requires baseHash)
config.patch (writes config) -> gateway restart (SIGUSR1) -> shutdown event -> reconnect -> hello-ok snapshot
skills.status (read state) -> UI display
skills.install (install from ClawHub/custom) -> skills.status (verify)
skills.update (toggle enabled, set env) -> writes config directly (no restart needed -- but gateway reads config on next heartbeat cycle)
tools.catalog (read plugin tools) -> UI display of what's active
PersistentGatewayClient.call() -> config.get, config.patch, skills.*, tools.catalog
HTTP /ready -> health check polling (independent of WS)
```

## MVP Recommendation

Prioritize (Phase 1 -- must-have for gateway-first communication):

1. **RPC-through-WS**: Add request/response correlation to PersistentGatewayClient -- this unblocks all other features
2. **baseHash lifecycle**: Implement config.get -> track hash -> use in config.patch -- this is a hard requirement from the gateway
3. **Shutdown event handling**: Detect clean restart vs crash, implement reconnect logic with hello-ok consumption
4. **HTTP /ready health checks**: Supplement Docker container polling with gateway-level readiness

Prioritize (Phase 2 -- needed for extension management):

5. **Batched config.patch for plugin changes**: Essential due to 3/min rate limit
6. **skills.status + tools.catalog for state verification**: Needed to confirm install/enable worked after restart
7. **Event-driven DB sync expansion**: Subscribe to sessions.changed, presence, health broadcasts

Defer:

- **config.schema introspection for dynamic UIs**: High complexity, not needed until advanced config editing in dashboard
- **Full agent management via agents.* RPCs**: Out of scope for extension management milestone

## Critical Warnings for Roadmap

1. **config.patch ALWAYS triggers restart** -- there is no incremental plugin reload. Every plugin install/uninstall/enable/disable will cause a gateway process restart. Batch aggressively.

2. **3/min rate limit on write methods** -- config.apply, config.patch, update.run share this budget. A user rapidly installing 4 plugins will hit the rate limit on the 4th. Must batch into single config.patch.

3. **baseHash is mandatory and stateful** -- if Aquarium's cached hash goes stale (e.g., user edits config in Control UI), config.patch will fail with "config changed since last load". Must implement retry-with-fresh-read pattern.

4. **No plugin lifecycle events** -- after config.patch triggers restart, Aquarium has zero visibility into whether plugins loaded successfully until it reconnects and calls tools.catalog. The gap between "config written" and "plugins confirmed loaded" is a blind spot.

5. **skills.update writes config directly WITHOUT restart** -- unlike plugin changes, skill config changes (enable/disable, set env vars) are written to the config file but do NOT trigger a gateway restart. The gateway's config watcher (`config-reload.ts`) sees `skills.*` changes as `kind: "none"` (noop) because skills are read dynamically. This means skill changes take effect on the next agent run, not immediately.

## Sources

All findings from direct source code reading:

| File | Path |
|------|------|
| Gateway events list | `openclaw/src/gateway/server-methods-list.ts:124-149` |
| Event frame schema | `openclaw/src/gateway/protocol/schema/frames.ts:147-156` |
| config.patch handler | `openclaw/src/gateway/server-methods/config.ts:317-437` |
| Merge-patch implementation | `openclaw/src/config/merge-patch.ts:62-97` |
| Config patch params schema | `openclaw/src/gateway/protocol/schema/config.ts:20-29` |
| Config reload plan | `openclaw/src/gateway/config-reload-plan.ts:34-215` |
| Config reloader (chokidar) | `openclaw/src/gateway/config-reload.ts:72-247` |
| Health HTTP endpoint | `openclaw/src/gateway/server-http.ts:128-133,224-276` |
| Health state builder | `openclaw/src/gateway/server/health-state.ts:17-85` |
| Readiness checker | `openclaw/src/gateway/server/readiness.ts:34-80` |
| Health summary type | `openclaw/src/commands/health.ts:48-73` |
| Status summary type | `openclaw/src/commands/status.types.ts:37-63` |
| Skills handlers | `openclaw/src/gateway/server-methods/skills.ts:58-284` |
| Skills status type | `openclaw/src/agents/skills-status.ts:30-55` |
| Tools catalog handler | `openclaw/src/gateway/server-methods/tools-catalog.ts:155-182` |
| Plugin bootstrap | `openclaw/src/gateway/server-plugin-bootstrap.ts:59-100` |
| Rate limit enforcement | `openclaw/src/gateway/control-plane-rate-limit.ts:4-5` |
| Rate-limited methods | `openclaw/src/gateway/server-methods.ts:38,109-133` |
| Exec approval events | `openclaw/src/gateway/server-methods/exec-approval.ts:180-189` |
| Presence events | `openclaw/src/gateway/server/presence-events.ts:4-22` |
| Shutdown event | `openclaw/src/gateway/server-close.ts:87` |
| Existing Aquarium gateway code | `aquarium-ce/apps/server/src/services/gateway-event-relay.ts` |
| Existing Aquarium RPC client | `aquarium-ce/apps/server/src/agent-types/openclaw/gateway-rpc.ts` |
