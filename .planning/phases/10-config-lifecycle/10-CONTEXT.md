# Phase 10: Config Lifecycle - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Flip config updates from DB-first to gateway-first for running instances. The platform sends `config.patch` to the gateway with the correct merge-patch format and baseHash concurrency, then reads back the actual config and syncs to DB. Stopped instances write DB only. `reseedConfigFiles` is eliminated from normal operations (kept for boot and recovery only).

</domain>

<decisions>
## Implementation Decisions

### Failure Behavior
- Gateway-first: if `config.patch` fails, the operation fails visibly — DB is NOT updated
- Auto-retry stale hash conflicts: re-read hash via `config.get`, re-send, up to 3 retries (matches current behavior)
- Rate limit hits (429): queue with delay — hold the request, wait until rate limit window resets (~20s), send. User sees a "pending" state.
- Invalid config rejection: return error to user immediately, no retry
- After successful `config.patch` + read-back: DB update is **synchronous** (blocks the API response) — guarantees dashboard shows correct state

### Batch Semantics
- No batching needed for normal config changes — they are rare in practice (user clicks save)
- Each change sent individually with retry-on-429 (queue with delay)
- Batching is only needed for multi-plugin operations (Phase 12, not this phase)

### reseedConfigFiles Scope
- **Keep for:** (1) initial boot (`startInstanceAsync`), (2) auto-recovery in health-monitor (error → running), (3) config integrity fix in health-monitor
- **Eliminate from:** (4) `patchGatewayConfig` normal flow, (5) `updateSecurityProfile` for running instances, (6) `channels.ts` channel configure
- Call sites 4-6 switch to `config.patch` directly

### Merge-Patch Flow
- **Direct merge-patch**: build the merge-patch object from the config change, JSON.stringify it, send as `{ raw: "<json5>", baseHash: "<hash>" }`
- No file writing to container volume for running instances
- No `reseedConfigFiles` + read-back-from-disk pattern
- Gateway handles the merge internally (RFC 7396 semantics, id-keyed array merging)

### Config Read-Back Pattern
- After successful `config.patch`, call `config.get` to read the gateway's actual merged config
- Store the full config + hash in DB as the authoritative state
- This replaces the current pattern of storing the platform's intended config

### Stopped Instance Degradation
- If instance is not running (`status !== 'running'` or no `controlEndpoint`), write to DB only
- Config takes effect on next start via `reseedConfigFiles` (boot path stays unchanged)

### Claude's Discretion
- How to build the merge-patch object from the various config change sources (principles, identity, agentName, mcpServers, etc.)
- Whether to store the baseHash in memory or fetch fresh from `config.get` each time
- Error message formatting for rate limit delays
- How to handle the `updateSecurityProfile` path (currently calls reseedConfigFiles + config.patch)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gatewayCall(instanceId, method, params)` (gateway-rpc.ts) — Phase 9 facade, ready to use for config.get/config.patch
- `patchGatewayConfig()` (instance-manager.ts:736-845) — current DB-first implementation, will be refactored
- `deepMerge()` (instance-manager.ts:721-734) — recursive merge, may be useful for building merge-patches
- `validateConfigPatch()` (config-validator.ts) — currently skips validation, may remain as-is

### Established Patterns
- `config.get` via `adapter.translateRPC` → now uses `gatewayCall` (Phase 9)
- `config.patch` already uses `{ raw, baseHash }` format in some paths
- The adapter's `translateRPC` already tries persistent client (Phase 9)

### Integration Points (files to modify)
- `instance-manager.ts` — `patchGatewayConfig()` (main refactor target), `updateSecurityProfile()`, `reseedConfigFiles()` (scope reduction)
- `health-monitor.ts` — `checkConfigIntegrity()` (keep reseed for recovery), auto-recovery (keep reseed)
- `routes/channels.ts` — channel configure (switch to config.patch)
- `routes/instances.ts` — PATCH /config endpoint (calls patchGatewayConfig)
- `routes/extension-credentials.ts` — credential injection (already uses config.patch pattern)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — research and discussion decisions provide clear direction.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-config-lifecycle*
*Context gathered: 2026-04-05*
