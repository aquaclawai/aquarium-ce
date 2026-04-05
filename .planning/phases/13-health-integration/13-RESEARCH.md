# Phase 13: Health Integration - Research

**Researched:** 2026-04-05
**Domain:** Gateway health monitoring, WebSocket liveness detection, config integrity verification
**Confidence:** HIGH

## Summary

Phase 13 adds gateway-native health signals to the existing health monitor, replacing file-based heuristics with gateway-authoritative data. The work touches two files primarily: `health-monitor.ts` (HTTP `/ready` polling and config integrity refactor) and `gateway-event-relay.ts` (WS ping/pong liveness). All four requirements are well-defined, non-overlapping, and can be implemented with zero new dependencies. The `ws@8.20.0` library already provides `ws.ping()` and the `'pong'` event. Node.js 22+ global `fetch()` with `AbortSignal.timeout()` is the established pattern for HTTP calls in this codebase (see `openrouter-models.ts`). The `gatewayCall()` facade from Phase 9 handles all RPC routing to the persistent client.

The most consequential change is HLTH-03/HLTH-04: replacing the file-hash `checkConfigIntegrity` (which reads files from the container via Docker exec and triggers `reseedConfigFiles` on mismatch) with a gateway-authoritative approach that calls `config.get` via RPC and compares the gateway's hash against the DB's `config_hash`. This eliminates the infinite reseed loop documented as Pitfall P4 in the milestone research. The `reseedConfigFiles` import can be removed from `health-monitor.ts` entirely since both call sites (auto-recovery at line 123 and integrity violation at line 279) will be eliminated.

**Primary recommendation:** Implement in two plans -- Plan 01 covers HLTH-01 + HLTH-02 (additive health signals: HTTP polling and WS ping/pong), Plan 02 covers HLTH-03 + HLTH-04 (destructive refactor: replace file-hash integrity with gateway-authoritative hash, eliminate reseedConfigFiles from health monitor).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all decisions are at Claude's discretion.

### Claude's Discretion
**HTTP /ready polling (HLTH-01):**
- Poll gateway HTTP `/ready` endpoint every 30s (same interval as current slow health loop)
- `/ready` returns `{ ready: boolean, failing: string[], uptimeMs: number }` -- no auth needed for localhost
- Surface `failing` array items as degraded subsystem warnings in dashboard status
- Gateway-level health check runs alongside (not replacing) Docker container status check

**WS ping/pong liveness (HLTH-02):**
- PersistentGatewayClient sends WS ping frames every 30s
- If no pong received within 30s, mark connection as unresponsive
- After 60s without pong -> trigger reconnect cycle (same as connection loss)
- Independent of TCP keepalive -- catches frozen gateway process

**Gateway-authoritative config hash (HLTH-03):**
- `checkConfigIntegrity` calls `gatewayCall(instanceId, 'config.get', {})` instead of reading files from container
- Compares gateway's hash with DB `config_hash`
- If mismatch -> update DB hash to match gateway (gateway wins, not the other way around)
- No more `engine.readFile` for config integrity checks on running instances

**Eliminate reseedConfigFiles for running instances (HLTH-04):**
- Remove `reseedConfigFiles` call from `checkConfigIntegrity` (health-monitor.ts:279)
- Remove `reseedConfigFiles` call from auto-recovery path (health-monitor.ts:123) -- keep for actual crash recovery where gateway state is unknown
- After this phase, `reseedConfigFiles` is only called from `startInstanceAsync` (initial boot)

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HLTH-01 | Health monitor polls gateway's HTTP `/ready` endpoint alongside Docker container status checks | HTTP `/ready` returns `{ ready, failing[], uptimeMs }` -- no auth for localhost. Use `fetch()` with `AbortSignal.timeout()`. Derive HTTP URL from `control_endpoint` (stored as `ws://localhost:PORT`) by replacing protocol and appending `/ready`. |
| HLTH-02 | Persistent WebSocket connection uses ping/pong frames for liveness detection | `ws@8.20.0` provides `ws.ping()` method and `'pong'` event. 30s interval, 30s timeout. PersistentGatewayClient already holds `this.ws` reference. |
| HLTH-03 | Config integrity check uses gateway's authoritative config hash from `config.get` instead of file hashes on disk | `gatewayCall(instanceId, 'config.get', {})` returns `{ hash: string, ... }`. Compare against DB `config_hash`. On mismatch, update DB (not disk). Eliminates Pitfall P4 (infinite reseed loop). |
| HLTH-04 | Config integrity check does not trigger `reseedConfigFiles` for running instances | Remove both `reseedConfigFiles` calls from health-monitor.ts (lines 123 and 279). After this phase, `reseedConfigFiles` only called from `startInstanceAsync`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.20.0 | WebSocket ping/pong frames | Already installed; provides `ws.ping()` and `'pong'` event natively |
| node:http (fetch) | Node 22+ | HTTP `/ready` polling | Global `fetch()` is the established pattern in this codebase (see `openrouter-models.ts`) |
| node:crypto | Node 22+ | Not needed (gateway provides hash) | Config hash now comes from `config.get` response, not local computation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| gatewayCall facade | Phase 9 | RPC routing to persistent WS client | For HLTH-03 -- calling `config.get` from health monitor |
| AbortSignal.timeout() | Node 22+ | HTTP request timeouts | For `/ready` fetch with 5s timeout |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Global `fetch()` | `node:http.get()` | `fetch()` is simpler, already used in project, has `AbortSignal.timeout()` |
| WS ping/pong frames | Application-level heartbeat messages | Protocol-level pings are lighter, handled by ws library, don't require gateway cooperation |
| `gatewayCall` for config hash | `engine.readFile` for file hash | `gatewayCall` eliminates Docker exec, avoids P4 reseed loop, uses gateway as authority |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended File Changes
```
apps/server/src/
├── services/
│   ├── health-monitor.ts      # Add checkGatewayHealth(), refactor checkConfigIntegrity()
│   └── gateway-event-relay.ts  # Add ping/pong heartbeat to PersistentGatewayClient
```

### Pattern 1: HTTP Health Polling (HLTH-01)

**What:** New `checkGatewayHealth()` function in health-monitor.ts, called from the slow loop (30s interval) alongside existing checks.

**When to use:** Every slow health loop iteration, for all running instances with a `control_endpoint`.

**URL derivation from control_endpoint:**
```typescript
// control_endpoint is stored as "ws://localhost:19001"
// HTTP health URL: "http://localhost:19001/ready"
function deriveHealthUrl(controlEndpoint: string): string {
  const url = new URL(controlEndpoint);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/ready';
  return url.toString();
}
```

**Fetch pattern (matches openrouter-models.ts):**
```typescript
// Source: established project pattern from openrouter-models.ts
const res = await fetch(healthUrl, {
  signal: AbortSignal.timeout(5_000),
});
if (res.ok) {
  const body = await res.json() as {
    ready: boolean;
    failing: string[];
    uptimeMs: number;
  };
  // Process readiness state
}
```

**Gateway response shape (from FEATURES.md, verified from OpenClaw source):**
```typescript
// HTTP 200: { ready: true, failing: [], uptimeMs: 12345 }
// HTTP 503: { ready: false, failing: ["channel-slack", "channel-discord"], uptimeMs: 12345 }
// Details only included for localhost or authenticated requests
```

### Pattern 2: WS Ping/Pong Liveness (HLTH-02)

**What:** PersistentGatewayClient sends periodic ping frames and monitors pong responses.

**When to use:** Whenever the WS connection is established (`this.connected === true`).

**Implementation approach:**
```typescript
// Source: ws@8.20.0 API docs (github.com/websockets/ws)
// In PersistentGatewayClient class:

private pingTimer: ReturnType<typeof setInterval> | null = null;
private lastPongAt: number = 0;

// After connection established (in connect response handler):
this.lastPongAt = Date.now();
ws.on('pong', () => { this.lastPongAt = Date.now(); });
this.startPingLoop();

private startPingLoop(): void {
  this.stopPingLoop();
  this.pingTimer = setInterval(() => {
    if (!this.ws || !this.connected) return;
    const elapsed = Date.now() - this.lastPongAt;
    if (elapsed > 60_000) {
      // No pong for 60s -- force reconnect
      console.warn(`[gateway-relay] No pong from ${this.instanceId} for ${elapsed}ms, forcing reconnect`);
      this.ws.terminate(); // triggers 'close' -> scheduleReconnect
      return;
    }
    this.ws.ping();
  }, 30_000);
}

private stopPingLoop(): void {
  if (this.pingTimer) {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
```

**Key detail:** Use `ws.terminate()` (not `ws.close()`) for unresponsive connections. `close()` sends a close frame and waits; `terminate()` destroys the socket immediately. This is the correct choice when the peer may be frozen.

### Pattern 3: Gateway-Authoritative Config Hash (HLTH-03)

**What:** Replace file-hash `checkConfigIntegrity` with gateway RPC-based hash comparison.

**When to use:** Every slow health loop for running instances with `config_hash` set.

```typescript
// Source: gatewayCall facade from Phase 9, config.get response from FEATURES.md
async function checkConfigIntegrity(): Promise<void> {
  const rows = await db('instances')
    .where({ status: 'running' })
    .whereNotNull('config_hash')
    .whereNotNull('control_endpoint');

  for (const row of rows) {
    try {
      const result = await gatewayCall(row.id, 'config.get', {}, 10_000) as {
        hash?: string;
      };
      if (!result?.hash) continue;

      const gatewayHash = result.hash;
      const dbHash = row.config_hash as string;

      if (gatewayHash === dbHash) continue;

      // Gateway's hash is authoritative -- update DB to match
      await db('instances').where({ id: row.id }).update({
        config_hash: gatewayHash,
        updated_at: db.fn.now(),
      });
      // Log the sync (not a violation -- expected drift)
      console.log(`[health-monitor] config hash synced for ${row.id}: DB ${dbHash.slice(0, 8)}... -> gateway ${gatewayHash.slice(0, 8)}...`);
    } catch {
      // Gateway unreachable -- skip (Docker status check handles container health)
    }
  }
}
```

### Pattern 4: Eliminate reseedConfigFiles (HLTH-04)

**What:** Remove `reseedConfigFiles` calls from health-monitor.ts.

**Current call sites in health-monitor.ts:**
1. Line 123: Auto-recovery path (error -> running transition) -- calls `reseedConfigFiles(row.id)`
2. Line 279: Config integrity violation handler -- calls `reseedConfigFiles(row.id)`

**After this phase:**
- Line 123 (auto-recovery): Replace with `syncGatewayState(row.id)` -- since the pod stabilized and is running, a full gateway state sync is the correct action (reconcile extensions, sync config hash, sync workspace).
- Line 279: Eliminated entirely -- the new `checkConfigIntegrity` above never triggers a reseed; it syncs the DB hash to match gateway.

**Remaining call sites for reseedConfigFiles after this phase:**
- `startInstanceAsync` in `instance-manager.ts` (initial boot) -- **keep this**

### Anti-Patterns to Avoid

- **Do not replace Docker status checks with gateway health:** Docker checks catch container-level failures (OOM kill, crash loops). Gateway checks catch process-level problems (frozen, unresponsive). Both are needed.
- **Do not use the WS `health` RPC for health polling:** It shares rate-limit context with `config.patch` and creates unnecessary WS traffic. HTTP `/ready` is independent and lightweight.
- **Do not reseed config on hash mismatch:** Gateway is authoritative. If hashes differ, update DB, not the disk/gateway.
- **Do not set ws ping interval below 20s:** Too frequent pings waste bandwidth and may trigger rate limiting on some gateway versions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL protocol conversion | String replace `ws://` -> `http://` | `new URL()` + protocol assignment | Handles edge cases (wss://, paths, query strings) |
| HTTP request with timeout | Manual `setTimeout` + abort | `fetch()` with `AbortSignal.timeout()` | Built-in, clean error handling, established pattern |
| WebSocket liveness detection | Application-level heartbeat messages | ws library ping/pong frames | Protocol-level, lighter, no gateway-side implementation needed |
| Config hash computation | `createHash('sha256').update(content)` | Read `hash` from `config.get` response | Gateway already computes it; avoids file reading, avoids normalization mismatch |
| Gateway RPC call | Direct `ws.send()` from health monitor | `gatewayCall()` facade | Handles queuing, reconnection, timeout -- already proven in Phases 9-12 |

**Key insight:** Every piece of infrastructure needed for this phase already exists. The work is wiring existing capabilities (fetch, ws.ping, gatewayCall) into the health monitor loop, and deleting the file-based approaches they replace.

## Common Pitfalls

### Pitfall 1: P4 -- Infinite Reseed Loop (already documented in milestone research)
**What goes wrong:** `checkConfigIntegrity` hashes on-disk `openclaw.json`, compares to DB `config_hash`. Gateway normalizes config, hash drifts, reseed triggered every 30s.
**Why it happens:** File-hash approach assumes platform is the only config writer.
**How to avoid:** Replace with gateway-authoritative hash from `config.get`. This is the primary goal of HLTH-03.
**Warning signs:** High CPU from `engine.readFile`/`engine.writeFiles` in health monitor; reseed log messages every 30s.

### Pitfall 2: Ping/Pong Timer Leak on Close
**What goes wrong:** If the ping interval timer is not cleared when the client is closed or the connection drops, it will fire on a null/closed WebSocket, causing errors or preventing garbage collection.
**Why it happens:** `PersistentGatewayClient.close()` and the `ws.on('close')` handler must both stop the ping timer.
**How to avoid:** Call `stopPingLoop()` in both `close()` and the `ws.on('close')` handler. Also stop it at the start of `connect()` to handle reconnect cycles.
**Warning signs:** "Cannot read properties of null" errors in logs after instance shutdown.

### Pitfall 3: Fetch to Container Network from Host
**What goes wrong:** The health URL derived from `control_endpoint` uses `localhost:PORT` which works for Docker port-mapped containers on the host. For Kubernetes, the endpoint may use internal DNS names not reachable from the platform pod.
**Why it happens:** Docker runtime returns `ws://localhost:{hostPort}` (port-mapped). Kubernetes returns `ws://{service}.{namespace}.svc.cluster.local:{port}`.
**How to avoid:** HTTP fetch will work for both -- the URL is already resolvable from the platform's network context. The same host that connects WebSocket can connect HTTP. No special handling needed.
**Warning signs:** `fetch()` ECONNREFUSED errors for Kubernetes instances.

### Pitfall 4: Gateway Not Yet Ready During Starting Phase
**What goes wrong:** `checkGatewayHealth()` attempts to fetch `/ready` for instances that are in `starting` status. The gateway HTTP server may not be up yet, causing errors that flood logs.
**Why it happens:** Health monitor's slow loop checks `running` and `error` instances, but the instance may have just transitioned.
**How to avoid:** Only check `/ready` for instances with status `running` (not `starting`, not `error`). The fast loop (5s) handles `starting` instances via Docker status checks.
**Warning signs:** ECONNREFUSED errors for starting instances in health monitor logs.

### Pitfall 5: gatewayCall Timeout in Config Integrity Check
**What goes wrong:** `gatewayCall` has a 30s default timeout. If the gateway is slow to respond (e.g., under heavy load), the config integrity check blocks the slow loop for other instances.
**Why it happens:** Sequential processing of instances in `checkConfigIntegrity`.
**How to avoid:** Use a shorter timeout (10s) for `config.get` calls in the health check. Wrap in try/catch and skip on timeout. The existing pattern already handles this with empty catch blocks.
**Warning signs:** Health monitor slow loop taking >30s per cycle, visible as gaps in status broadcasts.

### Pitfall 6: Notification Spam from Config Hash Sync
**What goes wrong:** The current `checkConfigIntegrity` creates a notification on every mismatch. In gateway-first, hash drift is expected (gateway normalizes config). If the new implementation still creates notifications on every sync, users get spammed.
**Why it happens:** Old implementation treated mismatch as a violation. New implementation should treat it as routine sync.
**How to avoid:** Remove the `createNotification` call for config hash syncs. Only log it. A hash sync is not a violation -- it is expected behavior in gateway-first architecture.
**Warning signs:** Users seeing "Config integrity mismatch detected" notifications repeatedly.

## Code Examples

### URL Derivation from Control Endpoint
```typescript
// Source: Docker runtime returns "ws://localhost:19001", K8s returns "ws://svc.ns.svc.cluster.local:PORT"
function deriveHttpUrl(controlEndpoint: string, path: string): string {
  const url = new URL(controlEndpoint);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path;
  return url.toString();
}

// Usage:
const readyUrl = deriveHttpUrl(row.control_endpoint, '/ready');
// "ws://localhost:19001" -> "http://localhost:19001/ready"
```

### Gateway /ready Response Handling
```typescript
// Source: OpenClaw gateway source server-http.ts:224-276, server/readiness.ts:34-80
interface GatewayReadyResponse {
  ready: boolean;
  failing: string[];
  uptimeMs: number;
}

// HTTP 200 -> ready: true
// HTTP 503 -> ready: false, failing array contains channel names
// Details (failing array, uptimeMs) only included for localhost or authenticated requests
// Since Aquarium connects via localhost (Docker port mapping), details are always available
```

### PersistentGatewayClient Ping/Pong Integration Points
```typescript
// Source: ws@8.20.0 API (github.com/websockets/ws/blob/master/doc/ws.md)
// ws.ping([data[, mask]][, callback]) -- sends a ping frame
// ws.on('pong', (data: Buffer) => {}) -- emitted when pong received
// ws.terminate() -- immediately destroys the socket (no close handshake)

// Key integration points in PersistentGatewayClient:
// 1. After "hello-ok" (connect response accepted): start ping loop, set lastPongAt
// 2. ws.on('pong'): update lastPongAt timestamp
// 3. Ping interval callback: check elapsed since lastPongAt, terminate if >60s
// 4. ws.on('close'): stop ping loop
// 5. close(): stop ping loop
// 6. connect(): stop any existing ping loop (reconnect case)
```

### Import Changes for health-monitor.ts
```typescript
// BEFORE (current):
import { syncWorkspaceFromContainer, reseedConfigFiles, stopInstance } from './instance-manager.js';

// AFTER (HLTH-04):
import { syncWorkspaceFromContainer, syncGatewayState, stopInstance } from './instance-manager.js';
import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File-hash config integrity via Docker exec | Gateway-authoritative hash via `config.get` RPC | Phase 13 (this phase) | Eliminates P4 reseed loop, removes Docker exec dependency |
| Docker container status only | Docker status + HTTP `/ready` + WS ping/pong | Phase 13 (this phase) | Catches frozen gateway process (P16) |
| `reseedConfigFiles` on hash mismatch | DB hash update to match gateway | Phase 13 (this phase) | Gateway wins, DB is cache |
| `reseedConfigFiles` on auto-recovery | `syncGatewayState` on auto-recovery | Phase 13 (this phase) | Full state reconciliation instead of config-only reseed |

**Deprecated/outdated after this phase:**
- `reseedConfigFiles` import in health-monitor.ts -- no longer called from health monitoring
- `engine.readFile` for config integrity checks -- replaced by RPC
- `createHash('sha256')` import in health-monitor.ts -- no longer computing hashes locally
- Config integrity violation notifications -- hash drift is expected, not a violation

## Open Questions

1. **Should `/ready` failures create notifications?**
   - What we know: `/ready` returns `failing` channel names when `ready: false`
   - What's unclear: Is a failing channel actionable for the user? (e.g., Slack channel connectivity issue)
   - Recommendation: Broadcast gateway health status via WS for real-time dashboard display; create a notification only on the first transition from ready to not-ready (debounced). Do not notify on every 30s check.

2. **Should auto-recovery (error -> running) call syncGatewayState or just let the existing reconnect handler do it?**
   - What we know: Auto-recovery fires when Docker says the pod stabilized. The PersistentGatewayClient may have already reconnected and run syncGatewayState.
   - What's unclear: Timing -- does the health monitor detect stabilization before or after the WS reconnect?
   - Recommendation: Call `syncGatewayState` from auto-recovery. It is idempotent (double-sync is harmless) and ensures state is current even if the WS reconnect handler failed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (Chromium only) |
| Config file | `playwright.config.ts` |
| Quick run command | `npx playwright test tests/e2e/instance-lifecycle.spec.ts` |
| Full suite command | `npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HLTH-01 | Health monitor polls `/ready` alongside Docker checks | manual-only | N/A -- requires running Docker instance with gateway | N/A |
| HLTH-02 | WS ping/pong liveness detection | manual-only | N/A -- requires running gateway WebSocket | N/A |
| HLTH-03 | Config integrity uses gateway hash not file hash | manual-only | N/A -- requires running gateway with config.get RPC | N/A |
| HLTH-04 | No reseedConfigFiles from health monitor for running instances | code review | Verify via grep: `grep -r "reseedConfigFiles" apps/server/src/services/health-monitor.ts` should return 0 results | N/A |

### Sampling Rate
- **Per task commit:** `npm run typecheck` (verifies no type errors from import/signature changes)
- **Per wave merge:** `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium`
- **Phase gate:** Full typecheck green + manual verification with running instance

### Wave 0 Gaps
None -- no unit test infrastructure exists in this project (Playwright E2E only). All HLTH requirements involve runtime gateway interaction that cannot be tested in CI (no mock gateway WebSocket server -- documented blocker in STATE.md).

HLTH-04 can be verified statically: the `reseedConfigFiles` import and calls must not appear in `health-monitor.ts` after implementation.

## Sources

### Primary (HIGH confidence)
- OpenClaw gateway source: `server-http.ts:224-276` -- HTTP `/ready` endpoint, response shape, auth behavior (from FEATURES.md research)
- OpenClaw gateway source: `server/readiness.ts:34-80` -- readiness evaluation logic (from FEATURES.md research)
- OpenClaw gateway source: `server-methods/config.ts:247-254` -- `config.get` response shape including `hash` field (from FEATURES.md research)
- `ws@8.20.0` library: `ws.ping()` method, `'pong'` event, `ws.terminate()` -- verified from [ws API docs](https://github.com/websockets/ws/blob/master/doc/ws.md)
- Aquarium source: `apps/server/src/services/health-monitor.ts` -- current implementation, all line references verified
- Aquarium source: `apps/server/src/services/gateway-event-relay.ts` -- PersistentGatewayClient class, `this.ws` reference
- Aquarium source: `apps/server/src/agent-types/openclaw/gateway-rpc.ts` -- `gatewayCall()` facade
- Aquarium source: `apps/server/src/runtime/docker.ts:248` -- control endpoint format `ws://localhost:{port}`
- Aquarium source: `apps/server/src/services/openrouter-models.ts:32` -- established `fetch()` + `AbortSignal.timeout()` pattern

### Secondary (MEDIUM confidence)
- [ws npm library ping/pong documentation](https://github.com/websockets/ws)
- [WebSocket heartbeat best practices 2026](https://oneuptime.com/blog/post/2026-01-24-websocket-heartbeat-ping-pong/view)
- Milestone research: `.planning/research/SUMMARY.md`, `FEATURES.md`, `PITFALLS.md` -- Pitfalls P4 and P16

### Tertiary (LOW confidence)
- None -- all findings verified from source code or official library documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies; all capabilities verified from installed library versions and existing codebase patterns
- Architecture: HIGH -- all four requirements have clear implementation paths; two files changed; gateway API shapes verified from source
- Pitfalls: HIGH -- primary pitfalls (P4, P16) documented in milestone research with root cause analysis; timer cleanup and notification spam are standard software engineering concerns

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- no fast-moving dependencies)
