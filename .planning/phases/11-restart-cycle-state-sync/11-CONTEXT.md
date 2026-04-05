# Phase 11: Restart Cycle & State Sync - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Handle gateway SIGUSR1 restarts triggered by config.patch — detect the `shutdown` event, show "restarting" status, auto-reconnect, perform full state reconciliation (extensions + config hash + workspace files) blocking the "running" transition, and reconcile on every reconnect (not just boot).

</domain>

<decisions>
## Implementation Decisions

### Restart Status UX
- When `shutdown` event received, mark instance status as "restarting" (not "stopped" or "error")
- Static "Restarting..." status message — no countdown, no progress hint
- 60-second timeout: if reconnect doesn't happen within 60s, mark as "error"
- Dashboard health monitor should NOT raise alerts during the "restarting" window

### Reconcile Scope
- **Full state sync** after every reconnect:
  1. `tools.catalog` — plugin/skill presence detection
  2. `skills.status` — skill state
  3. `config.get` — authoritative config hash comparison (catches external Control UI edits)
  4. `agents.files.list` + `agents.files.get` — workspace file sync
- Reconciliation **blocks** the "running" status transition — instance stays "restarting" until reconciliation completes
- May add 2-5s delay but guarantees DB consistency before user sees "running"

### Extension Reconciliation Timing
- `reconcileExtensions` runs on **every** WebSocket reconnect, not just server boot
- Same promotion/demotion rules as current boot-time reconciliation:
  - active in DB + present in gateway → unchanged
  - active in DB + absent from gateway → mark failed
  - degraded in DB + present in gateway → promote to active
  - pending in DB + present in gateway → promote to active

### Post-Patch Verification
- **Rely on reconciliation** — no dedicated post-patch verification step
- The full state sync after reconnect naturally detects if a plugin/skill failed to load (absent from tools.catalog)
- Reconciliation's promotion/demotion logic handles marking failed extensions
- Phase 12 (Extension Operations) will use this reconciliation outcome to report success/failure to the user

### Claude's Discretion
- How to detect "shutdown" event vs unexpected connection loss (both trigger ws.on('close'))
- Exponential backoff parameters for reconnection
- Whether to broadcast "restarting" status to browser WebSocket subscribers immediately or after a brief debounce
- How to handle workspace file sync conflicts (container file newer vs DB file newer)
- Error message wording for 60s timeout ("Gateway failed to restart" vs "Gateway restart timed out")

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PersistentGatewayClient` (gateway-event-relay.ts) — already has reconnect logic (5s delay, max 5 retries), ws.on('close') handler, ws.on('message') event routing
- `reconcileExtensions()` (extension-lifecycle.ts:138) — existing boot-time reconciliation for skills + plugins, uses `tools.catalog` + `config.get`
- `syncWorkspaceFromContainer()` (instance-manager.ts:178) — reads workspace files from container, writes to DB
- `broadcast()` (ws/index.ts) — broadcasts status events to browser WebSocket subscribers
- `gatewayCall()` (gateway-rpc.ts) — Phase 9 facade for all RPC, with queue-on-disconnect

### Established Patterns
- PersistentGatewayClient already handles `shutdown` events in the message handler (they arrive as `{ type: "event", event: "shutdown", payload: { reason, restartExpectedMs } }`)
- `updateStatus()` (instance-manager.ts) — writes status to DB + broadcasts to browser
- Health monitor checks instance status every 5s (starting) / 30s (running/error)

### Integration Points
- `gateway-event-relay.ts` — add shutdown event detection, trigger "restarting" status, modify reconnect behavior
- `instance-manager.ts` — add `syncGatewayStateAfterReconnect()` function that calls reconcileExtensions + config hash sync + workspace sync
- `extension-lifecycle.ts` — `reconcileExtensions` needs no changes (already works), just needs to be called on every reconnect
- `health-monitor.ts` — needs to respect "restarting" status (don't mark as "error" during the 60s window)

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

*Phase: 11-restart-cycle-state-sync*
*Context gathered: 2026-04-05*
