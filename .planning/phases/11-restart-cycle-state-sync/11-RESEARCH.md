# Phase 11: Restart Cycle & State Sync - Research

**Researched:** 2026-04-05
**Domain:** Gateway shutdown detection, WebSocket reconnection, post-restart state reconciliation
**Confidence:** HIGH

## Summary

Phase 11 implements the full gateway restart lifecycle: detecting shutdown events, maintaining a "restarting" status during the reconnect window, and performing comprehensive state reconciliation after every WebSocket reconnect. The work is entirely within `apps/server/` and `packages/shared/`, with minor CSS/i18n additions in `apps/web/` for the new "restarting" status badge.

The foundational infrastructure already exists. `PersistentGatewayClient` (gateway-event-relay.ts) already has reconnect logic, RPC queueing, and event routing. `reconcileExtensions()` (extension-lifecycle.ts) already implements the correct promotion/demotion rules for skills and plugins using `tools.catalog` + `config.get`. `syncWorkspaceFromContainer()` already syncs workspace files. The work is: (1) adding shutdown event handling to PersistentGatewayClient, (2) adding a "restarting" status to the InstanceStatus union, (3) creating a `syncGatewayState()` function that calls the four RPC methods after reconnect, (4) making health monitor respect the "restarting" status, and (5) wiring reconcileExtensions to run on every reconnect not just boot.

The most important architectural decision is that reconciliation **blocks** the "running" transition. After reconnect, the instance stays in "restarting" status while four RPC queries execute (`config.get`, `tools.catalog`, `skills.status`, `agents.files.list`/`agents.files.get`), the DB is updated, and only then does status transition to "running". This adds 2-5 seconds but guarantees DB consistency before the user sees "running".

**Primary recommendation:** Add "restarting" to InstanceStatus, handle shutdown event in PersistentGatewayClient, create syncGatewayState() post-reconnect orchestrator, modify health monitor to skip "restarting" instances, and call reconcileExtensions on every reconnect.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- When `shutdown` event received, mark instance status as "restarting" (not "stopped" or "error")
- Static "Restarting..." status message -- no countdown, no progress hint
- 60-second timeout: if reconnect doesn't happen within 60s, mark as "error"
- Dashboard health monitor should NOT raise alerts during the "restarting" window
- **Full state sync** after every reconnect:
  1. `tools.catalog` -- plugin/skill presence detection
  2. `skills.status` -- skill state
  3. `config.get` -- authoritative config hash comparison (catches external Control UI edits)
  4. `agents.files.list` + `agents.files.get` -- workspace file sync
- Reconciliation **blocks** the "running" status transition -- instance stays "restarting" until reconciliation completes
- May add 2-5s delay but guarantees DB consistency before user sees "running"
- `reconcileExtensions` runs on **every** WebSocket reconnect, not just server boot
- Same promotion/demotion rules as current boot-time reconciliation
- **Rely on reconciliation** -- no dedicated post-patch verification step
- The full state sync after reconnect naturally detects if a plugin/skill failed to load

### Claude's Discretion
- How to detect "shutdown" event vs unexpected connection loss (both trigger ws.on('close'))
- Exponential backoff parameters for reconnection
- Whether to broadcast "restarting" status to browser WebSocket subscribers immediately or after a brief debounce
- How to handle workspace file sync conflicts (container file newer vs DB file newer)
- Error message wording for 60s timeout ("Gateway failed to restart" vs "Gateway restart timed out")

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SYNC-01 | Platform detects gateway `shutdown` event and marks instance as "restarting" | PersistentGatewayClient already receives all events; shutdown event payload is `{ reason, restartExpectedMs }` (FEATURES.md). Need to add `'restarting'` to InstanceStatus union, handle shutdown event in message handler, call updateStatus |
| SYNC-02 | After WebSocket reconnection, platform queries gateway state and reconciles DB records | Four RPC methods confirmed available: `config.get`, `tools.catalog`, `skills.status`, `agents.files.list`/`agents.files.get`. New syncGatewayState() function orchestrates these calls post-reconnect |
| SYNC-03 | Extension reconciliation runs on every reconnect, promoting/demoting based on actual gateway state | `reconcileExtensions()` already implements correct rules. Just needs to be called from PersistentGatewayClient on-reconnect path instead of only from startInstanceAsync() |
| SYNC-04 | After config.patch-triggered restart, platform verifies success via tools.catalog | Covered by SYNC-02 -- the full state sync after reconnect includes tools.catalog, which naturally detects absent plugins. No separate post-patch verification step needed (per CONTEXT.md decision) |
| SYNC-05 | Persistent WebSocket auto-reconnects after gateway restart with full state reconciliation | PersistentGatewayClient already has reconnect logic (5s delay, max 5 retries). Needs modification: exponential backoff, unlimited retries during "restarting" window, state sync trigger after successful reconnect |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.20.0 | WebSocket transport | Already installed; PersistentGatewayClient uses it |
| better-sqlite3 | 11.x | SQLite DB for status/state persistence | Already installed; all DB writes via Knex |
| node:crypto | built-in | randomUUID for RPC correlation | Already used in gateway-event-relay.ts |
| node:timers | built-in | setTimeout for 60s restart timeout | Standard Node.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| knex | 3.1.0 | DB query builder | All DB reads/writes in reconciliation |
| @aquarium/shared | workspace | Shared types (InstanceStatus) | Adding 'restarting' to union type |

### Alternatives Considered
None. This phase requires zero new dependencies. All capabilities exist in the current stack.

## Architecture Patterns

### Recommended Project Structure
```
apps/server/src/
  services/
    gateway-event-relay.ts     # MODIFY: shutdown event, reconnect sync trigger, 60s timeout
    instance-manager.ts        # MODIFY: export updateStatus (or add helper), workspace sync via RPC
    extension-lifecycle.ts     # NO CHANGE: reconcileExtensions already correct
    health-monitor.ts          # MODIFY: skip "restarting" instances in checkInstances
  agent-types/openclaw/
    gateway-rpc.ts             # NO CHANGE: gatewayCall already works
packages/shared/src/
  types.ts                     # MODIFY: add 'restarting' to InstanceStatus union
apps/web/src/
  index.css                    # MODIFY: add .status-restarting CSS rule
  i18n/locales/*.json          # MODIFY: add common.status.restarting to all 6 locales
  pages/DashboardPage.tsx      # MODIFY: show spinner for 'restarting' status (like 'starting')
```

### Pattern 1: Shutdown Event Detection
**What:** Distinguish expected shutdown (shutdown event received before ws.close) from unexpected connection loss (ws.close without prior shutdown event).
**When to use:** Every time PersistentGatewayClient receives a shutdown event or its WebSocket closes.
**Implementation:**
```typescript
// In PersistentGatewayClient message handler, before the generic event broadcast:
if (msg.event === 'shutdown') {
  const payload = msg.payload as { reason?: string; restartExpectedMs?: number };
  this.expectedRestart = true;
  this.restartTimeoutMs = payload.restartExpectedMs ?? 30_000;
  
  // Mark instance as "restarting" immediately
  updateInstanceStatus(this.instanceId, 'restarting', 'Restarting...');
  
  // Set 60s hard timeout -- if reconnect doesn't happen, mark error
  this.restartTimer = setTimeout(() => {
    this.expectedRestart = false;
    updateInstanceStatus(this.instanceId, 'error', 'Gateway restart timed out');
  }, 60_000);
  
  return; // Don't broadcast shutdown event to browser (handled via status change)
}
```
**Key insight:** The `expectedRestart` flag is the differentiator. When ws.on('close') fires: if `expectedRestart === true`, the reconnect logic knows this is an expected restart and can skip error alerts. If `expectedRestart === false`, it is an unexpected disconnect.

### Pattern 2: Post-Reconnect State Sync (Blocking)
**What:** After PersistentGatewayClient successfully reconnects (connect response received), run full state reconciliation before transitioning to "running".
**When to use:** Every reconnect, regardless of whether it was expected (shutdown event) or unexpected.
**Implementation:**
```typescript
// After successful connect response in PersistentGatewayClient:
this.connected = true;
this.retryCount = 0;
this.drainQueue();

// Clear restart timeout if set
if (this.restartTimer) {
  clearTimeout(this.restartTimer);
  this.restartTimer = null;
}

// Trigger state sync (blocks "running" transition)
syncGatewayState(this.instanceId)
  .then(() => {
    this.expectedRestart = false;
    updateInstanceStatus(this.instanceId, 'running', null);
  })
  .catch((err) => {
    console.warn(`[gateway-relay] State sync failed for ${this.instanceId}:`, err);
    // Still transition to running -- stale DB is better than stuck "restarting"
    this.expectedRestart = false;
    updateInstanceStatus(this.instanceId, 'running', null);
  });
```

### Pattern 3: syncGatewayState Orchestrator
**What:** Coordinates the four RPC queries and DB updates after reconnect.
**When to use:** Called from PersistentGatewayClient after every successful reconnect.
**Implementation:**
```typescript
async function syncGatewayState(instanceId: string): Promise<void> {
  // 1. Extension reconciliation (tools.catalog + config.get + skills.status)
  const reconcileResult = await reconcileExtensions(instanceId, '', '');
  // Note: reconcileExtensions already calls tools.catalog, config.get internally
  // and skills.list (which should be skills.status -- already uses gatewayCall)

  // 2. Config hash sync (from config.get, may already be done in reconcileExtensions)
  const configResult = await gatewayCall(instanceId, 'config.get', {}) as { hash?: string };
  if (configResult?.hash) {
    await db('instances').where({ id: instanceId }).update({
      config_hash: configResult.hash,
      updated_at: db.fn.now(),
    });
  }

  // 3. Workspace file sync via gateway RPC (instead of Docker exec)
  await syncWorkspaceViaGateway(instanceId);
}
```

### Pattern 4: Reconnect Behavior During "restarting" Window
**What:** Modified reconnect logic for expected restarts.
**When to use:** When `expectedRestart` is true.
**Implementation:**
```typescript
// Current: fixed 5s delay, max 5 retries
// New: exponential backoff, unlimited retries during "restarting" window

private scheduleReconnect(): void {
  if (this.closed) return;

  this.retryCount++;
  
  // During expected restart: no retry limit (60s timeout handles the deadline)
  if (!this.expectedRestart && this.retryCount > MAX_RECONNECT_RETRIES) {
    console.log(`[gateway-relay] Max retries for ${this.instanceId}, giving up`);
    return;
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
  const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30_000);
  
  this.retryTimeout = setTimeout(() => {
    this.retryTimeout = null;
    this.connect();
  }, delay);
}
```

### Anti-Patterns to Avoid
- **Polling for restart completion:** Do NOT poll `config.get` or HTTP `/ready` to detect when the gateway has restarted. The WebSocket reconnect is the signal. Polling wastes rate-limit budget.
- **Broadcasting shutdown event to browser:** The browser should see a status change to "restarting", not the raw shutdown event. The shutdown event is an internal signal.
- **Transitioning to "running" before sync completes:** The DB must be consistent before "running" status. Otherwise the user sees "running" but extension status/config is stale.
- **Treating unexpected disconnect same as expected restart:** If ws closes without a prior shutdown event, it could be a crash. Do NOT immediately mark as "restarting" -- keep existing behavior (retry then give up).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Extension promotion/demotion | Custom reconcile logic | `reconcileExtensions()` in extension-lifecycle.ts | Already implements the exact rules from CONTEXT.md; tested at boot time |
| RPC routing to gateway | Direct WebSocket calls | `gatewayCall()` facade | Phase 9 established this pattern; handles queue-on-disconnect |
| Workspace file sync | Docker exec file reads | `agents.files.list` + `agents.files.get` via gatewayCall | Gateway RPCs are the correct abstraction for running instances; Docker exec is for startup only |
| Status broadcasting | Custom WS broadcast | `updateStatus()` / `broadcast()` | Existing pattern in instance-manager.ts; writes DB + broadcasts in one call |
| Config hash tracking | Manual hash computation | `config.get` response `.hash` field | Gateway computes authoritative SHA-256; use it directly |

**Key insight:** Nearly every piece of this phase already exists as a callable function. The work is wiring them together in the correct sequence at the correct trigger point (ws reconnect).

## Common Pitfalls

### Pitfall 1: InstanceStatus Union Missing "restarting"
**What goes wrong:** Adding "restarting" to the DB `status` column without adding it to the TypeScript union causes type errors everywhere.
**Why it happens:** `InstanceStatus` is used in 12+ files across server, shared, and web packages.
**How to avoid:** Add `'restarting'` to `InstanceStatus` in `packages/shared/src/types.ts`. Build shared first (`npm run build -w @aquarium/shared`). Then fix any type-narrowing code that assumes the exhaustive list of statuses.
**Warning signs:** TypeScript `switch` statements on `InstanceStatus` without a `restarting` case will fail at runtime even if they compile (if using `default`).

### Pitfall 2: Health Monitor Marks "restarting" as Error
**What goes wrong:** `checkInstances()` in health-monitor.ts queries instances with status `['running', 'error']` and checks Docker container status. If a "restarting" instance has a running Docker container (gateway process restarted, container still running), the health monitor might try to transition it.
**Why it happens:** Health monitor doesn't know about "restarting" status and would either skip it (if not in the filter) or mishandle it.
**How to avoid:** Explicitly skip instances with status "restarting" in `checkInstances()`. The 60s timeout in PersistentGatewayClient handles the failure case.
**Warning signs:** An instance flipping between "restarting" and "running" rapidly.

### Pitfall 3: reconcileConnections Closes "restarting" Connections
**What goes wrong:** The `reconcileConnections()` poll in gateway-event-relay.ts queries `db('instances').where({ status: 'running' })` to find instances that should have connections. A "restarting" instance won't match this query, so the poll will close the connection.
**Why it happens:** The status filter doesn't include "restarting".
**How to avoid:** Change the query to `whereIn('status', ['running', 'restarting'])` so connections are maintained during the restart window.
**Warning signs:** Connection closes during restart, then the reconnect loop can't reestablish because the connection object was removed from the `connections` Map.

### Pitfall 4: Workspace Sync via RPC vs Docker Exec
**What goes wrong:** `syncWorkspaceFromContainer()` uses Docker exec (`engine.readFile`) which reads files directly from the container filesystem. During gateway restart (SIGUSR1), the container is still running (only the gateway process restarts). Docker exec still works, but the gateway RPC methods (`agents.files.list`) will fail during the restart.
**Why it happens:** SIGUSR1 restarts the gateway process, not the container. Docker-level operations work fine, but gateway RPCs are unavailable until reconnect.
**How to avoid:** The workspace sync via gateway RPC should happen AFTER reconnect succeeds, as part of `syncGatewayState()`. If `agents.files.list` fails, fall back to the existing Docker exec approach (graceful degradation).
**Warning signs:** `agents.files.list` timeout errors during workspace sync.

### Pitfall 5: Race Between 60s Timeout and Reconnect
**What goes wrong:** The 60s timeout fires and marks the instance as "error" at the exact same time the reconnect succeeds.
**Why it happens:** Timer-based timeout races with async reconnect.
**How to avoid:** Clear the restart timer immediately when reconnect succeeds (before starting state sync). Use a flag to prevent the timeout callback from firing if reconnect already happened.
**Warning signs:** Instance briefly showing "error" then flipping to "running".

### Pitfall 6: updateStatus is Private to instance-manager.ts
**What goes wrong:** `updateStatus()` is a private function inside instance-manager.ts. PersistentGatewayClient (in gateway-event-relay.ts) cannot call it directly to set "restarting" status.
**Why it happens:** The function was designed for internal use within instance-manager.ts only.
**How to avoid:** Either: (a) export `updateStatus` from instance-manager.ts, (b) create a new exported function `setInstanceRestarting(instanceId)` that wraps updateStatus, or (c) have PersistentGatewayClient emit an event that instance-manager listens to. Option (b) is cleanest -- keeps the status transition logic in instance-manager where it belongs.
**Warning signs:** Circular imports if gateway-event-relay imports from instance-manager (already has `syncWorkspaceFromContainer` and `addOutputFilterEvent` imports from there, so this is safe).

### Pitfall 7: Boot-Time Reconciliation Still Needed
**What goes wrong:** If reconcileExtensions is moved to only run on reconnect, the initial boot path (startInstanceAsync) loses its reconciliation.
**Why it happens:** Misunderstanding "every reconnect" as "only on reconnect".
**How to avoid:** Keep the existing call in startInstanceAsync (line 582). The reconnect path is ADDITIONAL, not a replacement.
**Warning signs:** Pending extensions from template instantiation not promoted on first boot.

## Code Examples

### Adding "restarting" to InstanceStatus
```typescript
// packages/shared/src/types.ts (line 3)
// BEFORE:
export type InstanceStatus = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
// AFTER:
export type InstanceStatus = 'created' | 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'error';
```

### CSS for "restarting" Status Badge
```css
/* apps/web/src/index.css -- add alongside existing status-starting rule (line 1187) */
.status-restarting { color: var(--color-warning); background: rgba(217, 119, 6, 0.1); }
```

### Dashboard Spinner for "restarting"
```typescript
// apps/web/src/pages/DashboardPage.tsx (line 150)
// BEFORE:
{(inst.status === 'starting' || inst.status === 'stopping') && <span className="spinner" />}
// AFTER:
{(inst.status === 'starting' || inst.status === 'stopping' || inst.status === 'restarting') && <span className="spinner" />}
```

### Health Monitor Exclusion
```typescript
// apps/server/src/services/health-monitor.ts -- checkInstances
// Add 'restarting' to status filter awareness
async function checkInstances(statusFilter: InstanceStatus[]): Promise<void> {
  try {
    const rows = await db('instances').whereIn('status', statusFilter);
    for (const row of rows) {
      // ... existing logic ...
      // Skip "restarting" instances -- they have their own timeout
      if (row.status === 'restarting') continue;
      // ...
    }
  }
}
```

### reconcileConnections Including "restarting"
```typescript
// apps/server/src/services/gateway-event-relay.ts -- reconcileConnections
const runningInstances = await db('instances')
  .whereIn('status', ['running', 'restarting'])
  .whereNotNull('control_endpoint')
  .select('id', 'control_endpoint', 'auth_token');
```

### Workspace Sync via Gateway RPC
```typescript
// New function in instance-manager.ts (or a new gateway-sync.ts)
async function syncWorkspaceViaGateway(instanceId: string): Promise<void> {
  try {
    const listResult = await gatewayCall(instanceId, 'agents.files.list', { agentId: 'main' }) as {
      files: Array<{ name: string; path: string; missing: boolean }>;
    };

    const row = await db('instances').where({ id: instanceId }).first();
    if (!row) return;
    
    const currentConfig = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
    let changed = false;

    for (const file of listResult.files ?? []) {
      if (file.missing) continue;
      // Map gateway file names to DB config keys
      const configKey = WORKSPACE_FILE_GATEWAY_MAP[file.name];
      if (!configKey) continue;

      const fileResult = await gatewayCall(instanceId, 'agents.files.get', {
        agentId: 'main',
        name: file.name,
      }) as { file: { content?: string } };

      if (fileResult?.file?.content !== undefined && fileResult.file.content !== currentConfig[configKey]) {
        currentConfig[configKey] = fileResult.file.content;
        changed = true;
      }
    }

    if (changed) {
      await db('instances').where({ id: instanceId }).update({
        config: JSON.stringify(currentConfig),
        updated_at: db.fn.now(),
      });
    }
  } catch (err) {
    console.warn(`[syncWorkspaceViaGateway] Failed for ${instanceId}, falling back to container sync:`, err);
    // Graceful degradation: fall back to Docker exec approach
    await syncWorkspaceFromContainer(instanceId);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed 5s reconnect delay, max 5 retries | Exponential backoff (1-30s), unlimited during restart | Phase 11 | Faster initial reconnect (1s vs 5s), no artificial retry limit during expected restart |
| Boot-only reconcileExtensions | Every-reconnect reconcileExtensions | Phase 11 | Catches plugin/skill failures after config.patch-triggered restarts |
| Docker exec workspace sync | Gateway RPC workspace sync (with Docker exec fallback) | Phase 11 | Consistent with gateway-first architecture; Docker exec only for cold start |
| No "restarting" status (instance goes to "error" on disconnect) | "restarting" status with 60s timeout | Phase 11 | Clean UX during expected gateway restarts |
| `reconcileConnections` queries only `status = 'running'` | Also includes `status = 'restarting'` | Phase 11 | Connections maintained during restart window |

## Open Questions

1. **`skills.list` vs `skills.status` RPC method name**
   - What we know: CONTEXT.md says to use `skills.status`. Current code in extension-lifecycle.ts calls `skills.list`. FEATURES.md documents `skills.status` as the verified RPC method with correct response shape.
   - What's unclear: Whether the current `skills.list` call in reconcileExtensions actually works (it catches errors and continues). The response shape handling assumes `skills.list` returns `{ skills: SkillInfo[] }`.
   - Recommendation: Verify at implementation time. If `skills.list` fails silently (as the code suggests), the skill reconciliation portion is currently a no-op. Phase 11 should fix this to use `skills.status` with the correct response shape from FEATURES.md.

2. **Workspace file key mapping**
   - What we know: `syncWorkspaceFromContainer` uses `WORKSPACE_FILE_KEYS` mapping filenames to config keys (e.g., `workspace/AGENTS.md` -> `agentsmd`). The gateway's `agents.files.list` returns file names like `AGENTS.md` (relative to workspace dir).
   - What's unclear: Exact mapping between gateway file names and the WORKSPACE_FILE_KEYS filenames.
   - Recommendation: Log the `agents.files.list` response during implementation to verify the name format, then build the mapping.

3. **Workspace file conflict resolution (Claude's Discretion)**
   - What we know: Both DB and container can have newer versions of workspace files. After restart, the gateway's files are authoritative (they were actively used during the session).
   - Recommendation: Gateway wins. After restart, always overwrite DB config with gateway file content. This is consistent with the "gateway is source of truth for running instances" principle.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (Chromium only) |
| Config file | `playwright.config.ts` |
| Quick run command | `npx playwright test tests/e2e/api.spec.ts -x` |
| Full suite command | `npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | Shutdown event marks instance "restarting" | manual-only | N/A -- requires live gateway SIGUSR1 | N/A |
| SYNC-02 | Post-reconnect state sync queries gateway | manual-only | N/A -- requires live gateway | N/A |
| SYNC-03 | reconcileExtensions runs on every reconnect | manual-only | N/A -- requires live gateway restart cycle | N/A |
| SYNC-04 | Post-config.patch verification via tools.catalog | manual-only | N/A -- covered by SYNC-02 reconciliation | N/A |
| SYNC-05 | Auto-reconnect with full state reconciliation | manual-only | N/A -- requires live gateway | N/A |

**Justification for manual-only:** All SYNC requirements involve live gateway WebSocket interactions (shutdown events, SIGUSR1 restarts, reconnect cycles). There is no mock gateway WebSocket server in the test infrastructure (noted as a blocker in STATE.md). Automated testing would require building a mock gateway, which is out of scope for this phase. However, TypeScript typecheck (`npm run typecheck`) validates the InstanceStatus union changes compile correctly.

### Sampling Rate
- **Per task commit:** `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium`
- **Per wave merge:** `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web`
- **Phase gate:** Full typecheck + lint green; manual restart cycle test with live gateway

### Wave 0 Gaps
None -- existing test infrastructure is adequate for typecheck validation. Manual testing guide should document the live gateway restart test procedure.

## Sources

### Primary (HIGH confidence)
- OpenClaw gateway source: `server-close.ts:87` -- shutdown event payload `{ reason, restartExpectedMs }` (via FEATURES.md)
- OpenClaw gateway source: `server-methods-list.ts:124-149` -- GATEWAY_EVENTS array confirms shutdown is emitted
- OpenClaw gateway source: `server-methods/config.ts:409-418` -- SIGUSR1 scheduling after config.patch
- Aquarium source: `apps/server/src/services/gateway-event-relay.ts` -- PersistentGatewayClient full implementation
- Aquarium source: `apps/server/src/services/extension-lifecycle.ts:138-308` -- reconcileExtensions implementation
- Aquarium source: `apps/server/src/services/health-monitor.ts:75-166` -- checkInstances status filters
- Aquarium source: `apps/server/src/services/instance-manager.ts:69-72` -- updateStatus private function
- Aquarium source: `apps/server/src/services/instance-manager.ts:180-238` -- syncWorkspaceFromContainer
- Aquarium source: `apps/server/src/services/instance-manager.ts:729-837` -- patchGatewayConfig with read-back
- Aquarium source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts` -- gatewayCall facade, extractPluginPresence
- Aquarium source: `apps/server/src/routes/rpc-proxy.ts:20-22` -- agents.files.list/get/set confirmed as valid RPCs
- Aquarium source: `apps/web/src/components/files/FilesTab.tsx:20-30` -- agents.files.list/get response shapes
- Aquarium source: `packages/shared/src/types.ts:3` -- current InstanceStatus union (no "restarting")
- Aquarium source: `apps/web/src/index.css:1184-1188` -- status badge CSS patterns
- Aquarium source: `apps/web/src/i18n/locales/en.json:55-67` -- common.status i18n keys
- Aquarium source: `apps/web/src/pages/DashboardPage.tsx:149-151` -- status badge rendering with spinner

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES.md` -- Full gateway RPC method signatures and event shapes
- `.planning/research/ARCHITECTURE.md` -- Target architecture patterns and component boundaries
- `.planning/research/SUMMARY.md` -- Pitfall analysis (P3: reconnection state gap, P7: premature active state)
- `.planning/ROADMAP.md:165-179` -- Phase 11 success criteria

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new dependencies, all capabilities verified in source
- Architecture: HIGH - all four RPC methods confirmed available; reconcileExtensions logic verified; PersistentGatewayClient code fully read
- Pitfalls: HIGH - identified 7 specific pitfalls from direct code reading (status union, health monitor, reconcileConnections query, workspace sync timing, timeout race, updateStatus visibility, boot-time reconciliation)
- Implementation patterns: HIGH - code examples reference exact line numbers in existing source

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- no external dependency changes expected)
