# Phase 16: Runtime Registry + Runtime-Bridge — Research

**Researched:** 2026-04-16
**Domain:** Service-layer integration + boot-sequence wiring on top of existing `instances` table + new `runtimes` table (from Phase 15-02)
**Confidence:** HIGH
**Gate:** LIGHT

## Summary

- **InstanceManager has NO event-emitter.** The only observable signal today is `broadcast(id, { type: 'instance:status', ... })` fired from `updateStatus()` at `apps/server/src/services/instance-manager.ts:71`. All other write paths (`createInstance`, `cloneInstance`, `deleteInstance`, `updateInstanceConfig` agentName rename) are silent. The runtime-bridge MUST add explicit hook calls at these sites OR poll `instances` on a 10s cadence — we recommend a **hybrid**: explicit synchronous upserts at the 4 write sites for low-latency mirror, plus a 10s reconcile loop inside `runtime-bridge` (matching `startGatewayEventRelay`'s poll) as a safety net against missed hooks.
- **Derived status via SQL JOIN (not a VIEW).** `runtime.status` for `kind='hosted_instance'` is computed inside the `runtime-registry.listRuntimes()` SELECT using `LEFT JOIN instances ON runtimes.instance_id = instances.id` and a `CASE WHEN i.status='running' THEN 'online' WHEN i.status IN ('stopped','error','created') THEN 'offline' ELSE 'offline' END`. This works identically on SQLite and Postgres (EE) through knex's query builder — no VIEW migration needed, no dialect branching. The stored `runtimes.status` column is populated with `'offline'` at INSERT and left alone; reads always project the JOIN-derived value.
- **Boot position: 9a and 9e slot in around the existing `startGatewayEventRelay()` at `server-core.ts:265`.** Insert `await runtimeBridge.reconcileFromInstances()` immediately AFTER `startGatewayEventRelay()` (line 265, before the daily-snapshot setInterval at line 267) and start the offline sweeper `runtimeRegistryOfflineSweeper.start()` right after reconcile. Phase 16 owns only 9a + 9e; 9b, 9c, 9d slots are owned by later phases (Phase 18/20).
- **RT-05 offline sweeper: standalone 30s setInterval, NOT a health-monitor hook.** `health-monitor.ts` is tightly scoped to Docker/gateway health; embedding runtime heartbeat logic there couples two unrelated concerns. A dedicated `apps/server/src/task-dispatch/offline-sweeper.ts` with a single `setInterval(() => sweepDaemonRuntimes(90_000), 30_000)` is ~40 LOC and trivial to test. It only touches `runtimes` rows WHERE `kind IN ('local_daemon','external_cloud_daemon') AND last_heartbeat_at < now() - 90s` — no intersection with hosted_instance rows or instance state.
- **`GET /api/runtimes` follows the `routes/instances.ts` convention exactly.** Thin controller: `requireAuth` middleware → single service call → `ApiResponse<Runtime[]>` wrapper. No new conventions. CE resolves to the default `'AQ'` workspace implicitly (Phase 15-01 seeded that row). For WebSocket: emit `runtime:updated` / `runtime:deleted` events at every bridge mutation — the Phase 25 UI consumes them later, but the emit cost is zero and avoids a breaking-change round in Phase 25.

**Primary recommendation:** Build the bridge as an explicit hook-at-write-sites module + a 10s polling safety net + a separate 30s offline sweeper. Derived status is a `LEFT JOIN` in the query builder, not a stored column and not a DB view.

## User Constraints

### Locked (HARD)

- **RT-01..RT-05 scope:** `GET /api/runtimes`, hosted mirror on boot, hosted mirror on instance lifecycle, derived status via JOIN, offline sweeper on 90s heartbeat window.
- **InstanceManager is the ONLY writer of `instances.status`.** `runtime-bridge` is read-only against `instances` table.
- **`runtime.status` for `hosted_instance` is DERIVED, not stored.**
- **ESM `.js` imports mandatory** on server (project CLAUDE.md).
- **kebab-case files** for server TS; no `any`.

### Claude's Discretion

- How to observe InstanceManager lifecycle (poll vs hook vs broadcast-listener) → **recommend hybrid**.
- SQL vs VIEW for derived status → **recommend LEFT JOIN in query**.
- Sweeper ownership (health-monitor extension vs standalone) → **recommend standalone**.
- WS broadcast of runtime events (now vs Phase 25) → **recommend emit now, UI consumes later**.

### Deferred

- WebSocket `subscribe_runtime` / `subscribe_workspace` subscription types — Phase 25 UI concern.
- Agent-runtime FK cascades on hosted deletion — Phase 17 (agents service) owns this.
- Hosted task cancellation on instance stop — Phase 20 (hosted-worker) owns this.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RT-01 | List all runtimes (hosted + daemon) in single view | `routes/runtimes.ts` — thin `requireAuth` controller returning `runtime-registry.listAll(workspaceId)` with JOIN-derived status |
| RT-02 | Auto-mirror existing instances at boot | `runtime-bridge.reconcileFromInstances()` at step 9a — idempotent UPSERT into `runtimes` for every `instances` row |
| RT-03 | Mirror create/rename/archive/delete in <2s | Hook at 4 InstanceManager write sites + 10s reconcile safety net |
| RT-04 | `runtime.status` for hosted derived via JOIN | `runtime-registry.listAll` uses `LEFT JOIN instances ... CASE WHEN i.status='running' THEN 'online' ELSE 'offline' END` |
| RT-05 | Daemon runtimes offline after 90s missed heartbeat | Standalone 30s sweeper in `task-dispatch/offline-sweeper.ts` |

## Project Constraints (from CLAUDE.md)

- **ESM `.js` imports:** Every relative import in `apps/server/src/**` must end `.js` — `import { foo } from './runtime-bridge.js'`.
- **No `any`:** use `unknown` + type guards. Shared types already exist in `@aquarium/shared` (v14-types.ts) — import `Runtime`, `RuntimeKind`, `RuntimeStatus`, `RuntimeProvider`.
- **Request flow:** routes → services → DB. Routes must not touch knex directly. `runtime-registry.ts` is the service boundary.
- **API shape:** `ApiResponse<T>` = `{ ok: boolean, data?: T, error?: string }` — pattern in `routes/instances.ts:47`.
- **Naming:** kebab-case file names (`runtime-registry.ts`, `runtime-bridge.ts`, `offline-sweeper.ts`). snake_case DB columns (already in place from migration 004). camelCase TS fields.
- **DB writes:** knex query builder via DbAdapter — never string-concat SQL.
- **Instance lifecycle:** only through `InstanceManager` — **never update `instances.status` directly** (this is THE hard constraint for Phase 16; the bridge must remain read-only against the instances table).

## InstanceManager Integration Map

### Write-site audit (all in `apps/server/src/services/instance-manager.ts`)

| Call site | Line | What happens to `instances` row | Hook needed? | Why |
|-----------|------|--------------------------------|--------------|-----|
| `createInstance(userId, req)` | 142–167 | INSERT new row with `status='created'` | **YES** — add `runtimeBridge.onInstanceCreated(instance)` before return | No status broadcast fires for `created` state; bridge wouldn't see it |
| `cloneInstance(sourceId, userId)` | 446–476 | INSERT new row with `status='created'` (clone) | **YES** — same hook as create (`onInstanceCreated`) | Same reason as createInstance |
| `updateStatus(id, status, extra, msg)` | 69–72 | UPDATE status + broadcast | **NO hook needed** — but bridge can listen via polling | Status changes are covered by the 10s reconcile loop |
| `startInstance` → `startInstanceAsync` | 537–736 | Calls `updateStatus` multiple times (starting → running) | NO direct hook | Covered by polling or by updateStatus itself |
| `stopInstance` / `stopInstanceAsync` | 738–780 | Calls `updateStatus` to stopped | NO direct hook | Covered above |
| `restartInstance` | 782–802 | Delegates to stop + start (via updateStatus) | NO direct hook | Covered above |
| `updateInstanceConfig` | 804–824 | UPDATE on config — **ALSO updates `instances.name` at line 820** when `config.agentName` is set | **YES — this is the rename path** | Mirror runtime `name` column via `runtimeBridge.onInstanceRenamed(id, newName)` |
| `patchGatewayConfig` (rename path) | 947–952 | UPDATE `instances.name = configPatch.agentName` | **YES — second rename site** | Same rename hook; both sites call into bridge |
| `deleteInstance(id, userId, purge)` | 982–1007 | DELETE row | **NO hook required** — FK CASCADE in migration 004 handles it | Migration 004 sets `runtimes.instance_id → instances.id ON DELETE CASCADE` (verified in 15-02 summary PRAGMA foreign_key_list). Delete is automatic. |

### Recommended hook surface (minimal)

Expose **three** functions from `task-dispatch/runtime-bridge.ts`:

```typescript
// apps/server/src/task-dispatch/runtime-bridge.ts
export async function onInstanceCreated(instance: Instance): Promise<void>
export async function onInstanceRenamed(instanceId: string, newName: string): Promise<void>
export async function reconcileFromInstances(): Promise<void>  // called at boot (9a) + 10s interval
```

`reconcileFromInstances()` is idempotent — INSERT ... ON CONFLICT (workspace_id, instance_id) DO UPDATE (via knex `.onConflict().merge()` on SQLite `INSERT OR REPLACE`) — so the polling path is safe even if the hook already ran.

### Callsite wiring (explicit)

- `instance-manager.ts:167` (after createInstance INSERT, before return): `await runtimeBridge.onInstanceCreated(instance);`
- `instance-manager.ts:475` (inside cloneInstance, after INSERT): `await runtimeBridge.onInstanceCreated(cloned);`
- `instance-manager.ts:820` (inside updateInstanceConfig, when `patch.name` is set): `await runtimeBridge.onInstanceRenamed(id, config.agentName);`
- `instance-manager.ts:951` (inside patchGatewayConfig, when `mergedConfig.agentName` is set): `await runtimeBridge.onInstanceRenamed(instanceId, mergedConfig.agentName as string);`

Deletion needs NO hook — the FK CASCADE (migration 004 line 36: `.references('id').inTable('instances').onDelete('CASCADE')`) removes the mirror row automatically. Verified in `.planning/phases/15-schema-shared-types/15-02-SUMMARY.md` §"CASCADE delete test".

### Why hybrid (hook + poll) over pure polling

- **Latency:** ROADMAP SCS #2 demands mirror row "within 2 seconds" of create/rename. Pure 10s polling misses this SLA 80% of the time. Explicit hook fires in <50ms.
- **Safety net:** if a future refactor adds a new instance write site and forgets to call the hook, the 10s poll still reconciles within one tick. The reconcile query costs ~1 SELECT + ≤N UPSERTs (N = hosted instances; typically 1–10 in CE).
- **No double-write hazard:** `reconcileFromInstances` uses `INSERT ... ON CONFLICT DO UPDATE` with the same columns the hook writes. Running both = same end state.

### Why hybrid (hook + poll) over pure hook

- **Robustness:** if the hook throws (e.g., DB busy during `BEGIN IMMEDIATE` from a task-queue writer), the poll cleans up within 10s. Without the poll, a missed hook = permanent drift.
- **Testability:** the poll path is the E2E-test anchor; Playwright doesn't have to coordinate timing with the hook.

## Boot Order Recommendation

### Current `server-core.ts:202–281` (verified)

```
202  export async function startServer(server, options = {}) {
...
215    await db.migrate.latest({ ... });
...
231    await options.onAfterMigrate?.();
...
252    await reloadDynamicMiddleware();
254    await recoverOrphanedOperations();
257    await reconcileInstances();          // step 6 — instance state reconcile
259    const engine = getRuntimeEngine(...);
260    if (engine.cleanupOrphanNetworks) {
261      await engine.cleanupOrphanNetworks();
262    }
264    startHealthMonitor();                  // step 8
265    startGatewayEventRelay();              // step 9  — 10s reconcile loop kicks off
                                              // ─── INSERT 9a + 9e HERE ───
267    setInterval(async () => {              // step (daily snapshots)
...
273    await options.onBeforeListen?.();
275    server.listen(...);
```

### Phase 16 inserts (exact positions)

**Insert two lines between `server-core.ts:265` and `server-core.ts:267`:**

```typescript
// Line 265: existing
startGatewayEventRelay();

// NEW: Line 266a — await so initial reconcile completes before any HTTP traffic
await runtimeBridge.reconcileFromInstances();

// NEW: Line 266b — fire-and-forget; internally uses setInterval
startRuntimeOfflineSweeper();

// Line 267: existing setInterval(daily snapshots)
```

### Also add an import at the top (around line 17):

```typescript
// existing:
import { startGatewayEventRelay } from './services/gateway-event-relay.js';

// NEW:
import { reconcileFromInstances as runtimeBridgeReconcile } from './task-dispatch/runtime-bridge.js';
import { startRuntimeOfflineSweeper } from './task-dispatch/offline-sweeper.js';
```

### Why this position, not earlier

- **After `reconcileInstances()` (line 257):** the bridge needs instance statuses to be correct. If we mirror `status='starting'` rows that are actually crashed, the hosted runtime row carries a stale status until the next poll.
- **After `startGatewayEventRelay()` (line 265):** the relay's 10s loop triggers per-instance gateway reconnection. A hosted worker (later, Phase 20) tick that runs before reconnect would skip correctly (via `isGatewayConnected` check), but we avoid the unnecessary churn by letting the relay start first.
- **Before `onBeforeListen()` + `server.listen` (lines 273–275):** users hitting `GET /api/runtimes` before reconcile would see zero hosted rows. Awaiting reconcile guarantees the first HTTP request sees the full mirror.

### Race-condition note (ROADMAP already flagged)

From ARCHITECTURE.md §"Critical path gotchas" #2: the bridge may create a `hosted_instance` runtime before its gateway is connected. **This is fine for Phase 16** — we only populate name / kind / provider / instance_id. The bridge does NOT derive `status='online'` — JOIN-read status always reflects `instances.status`, which `reconcileInstances()` already set correctly. Hosted-worker (Phase 20) handles the `isGatewayConnected` gate separately.

### Internal interval inside `runtime-bridge.ts`

Inside `runtime-bridge.ts`, after the exported `reconcileFromInstances()` function definition, start a safety-net interval:

```typescript
let reconcileInterval: ReturnType<typeof setInterval> | null = null;

export function startReconcileLoop(intervalMs = 10_000): void {
  if (reconcileInterval) return;
  reconcileInterval = setInterval(() => {
    reconcileFromInstances().catch(err =>
      console.warn('[runtime-bridge] reconcile failed:', err));
  }, intervalMs);
}
```

Call `startReconcileLoop()` inside `reconcileFromInstances()` on first invocation, or explicitly from server-core. Either pattern works; recommend explicit call in server-core for clarity.

## Derived-Status Pattern

### Decision: `LEFT JOIN instances` at read time — NOT a SQL VIEW, NOT a trigger

### Concrete SELECT (in `services/runtime-registry.ts`)

```typescript
// services/runtime-registry.ts — listAll()
export async function listAll(workspaceId: string): Promise<Runtime[]> {
  const rows = await db('runtimes as r')
    .leftJoin('instances as i', 'r.instance_id', 'i.id')
    .where('r.workspace_id', workspaceId)
    .select(
      'r.id', 'r.workspace_id', 'r.name', 'r.kind', 'r.provider',
      'r.daemon_id', 'r.device_info', 'r.last_heartbeat_at',
      'r.instance_id', 'r.metadata', 'r.owner_user_id',
      'r.created_at', 'r.updated_at',
      // Derived status: hosted kind reads from instance; others use stored column
      db.raw(`
        CASE
          WHEN r.kind = 'hosted_instance' THEN
            CASE
              WHEN i.status = 'running' THEN 'online'
              WHEN i.status IN ('starting', 'restarting') THEN 'offline'
              WHEN i.status IN ('stopped', 'stopping', 'created') THEN 'offline'
              WHEN i.status = 'error' THEN 'error'
              ELSE 'offline'
            END
          ELSE r.status
        END as status
      `)
    )
    .orderBy('r.created_at', 'desc');
  return rows.map(toRuntime);
}
```

### Why LEFT JOIN in the query (not a VIEW)

| Option | Pro | Con | Verdict |
|--------|-----|-----|---------|
| **LEFT JOIN in query** (recommended) | Portable across SQLite + Postgres (knex handles it); no migration churn; trivially testable; service-layer decision, not schema; adjusting the CASE for new instance states is a code change | Query is slightly more verbose than `SELECT * FROM v_runtimes` | **Chosen** |
| DB VIEW (`CREATE VIEW v_runtimes AS ...`) | Nicer syntax in application code | Migration must land the VIEW; altering the CASE means a new migration; knex's query builder against a VIEW is awkward; mixing reads from VIEW with writes to the base table is confusing; Postgres + SQLite have subtle VIEW-updatability differences | Rejected |
| Trigger that keeps `runtimes.status` in sync with `instances.status` | Zero read-time cost | **Violates the ST1 HARD constraint** (InstanceManager is the only writer of instance state derivations — any trigger writing to `runtimes` from `instances` state creates a second writer with race conditions) | Rejected |
| Read-through stored status column | Fastest reads | Requires re-write on every instance status change — exactly what ST1 says not to do; desync guaranteed | Rejected |

### EE/Postgres compatibility

`CASE WHEN ... END` is standard SQL — identical on SQLite 3.38+ and Postgres 12+. Knex's `.raw()` passes it through verbatim; no dialect branching required. The `LEFT JOIN` ensures daemon runtimes (where `instance_id IS NULL`) still return, with the CASE falling through to `r.status`.

### What about writes?

- Hosted rows: INSERT with `status = 'offline'` as placeholder (the column still has NOT NULL + default 'offline' from migration 004:31). Never updated by the bridge. `status` column becomes ghost data; that's fine.
- Daemon rows: written normally — `status` column holds the authoritative value for `local_daemon` / `external_cloud_daemon` kinds. Heartbeat updates it; offline sweeper updates it.

### Verification query for SCS #3 ("always matches in any READ query")

```sql
-- Must pass after Phase 16 lands:
SELECT r.id, r.name, i.status AS instance_status,
  (CASE WHEN i.status='running' THEN 'online' ELSE 'offline' END) AS runtime_status
FROM runtimes r
JOIN instances i ON r.instance_id = i.id
WHERE r.kind = 'hosted_instance';
-- runtime_status must match (CASE logic applied to instance_status) for every row
```

## Offline Sweeper Pattern

### Decision: standalone 30s `setInterval` in `task-dispatch/offline-sweeper.ts`

### Why NOT extend `health-monitor.ts`

- **Separation of concerns:** `health-monitor.ts` is 414 lines already handling disk quotas, gateway /ready polling, config integrity, skill/plugin change detection, and Docker status reconcile. Adding runtime heartbeat sweeping conflates two independent subsystems.
- **Cadence mismatch:** health-monitor's slow loop is 30s (matches sweeper cadence) but its fast loop is 5s (runs on 'starting' instances). Splitting which runtime-kind check runs in which loop is a forced distinction.
- **Test isolation:** the sweeper's behaviour is a single-purpose unit — `node --test` or Playwright can exercise it without spinning up a container fleet.
- **Phase ownership:** health-monitor is owned by Phase 13 (health integration). Overloading it makes Phase 16 reviews require Phase 13 context.

### Why standalone

```typescript
// apps/server/src/task-dispatch/offline-sweeper.ts
import { db } from '../db/index.js';
import { broadcast } from '../ws/index.js';  // optional: emit runtime:updated

const HEARTBEAT_WINDOW_MS = 90_000;
const SWEEP_INTERVAL_MS = 30_000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;

async function sweepOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - HEARTBEAT_WINDOW_MS).toISOString();
  const affected = await db('runtimes')
    .whereIn('kind', ['local_daemon', 'external_cloud_daemon'])
    .where('status', 'online')
    .where((q) => q.where('last_heartbeat_at', '<', cutoff).orWhereNull('last_heartbeat_at'))
    .update({ status: 'offline', updated_at: db.fn.now() });
  if (affected > 0) {
    console.log(`[offline-sweeper] marked ${affected} daemon runtime(s) offline`);
    // Optional: emit runtime:updated event for Phase 25 UI (safe no-op today)
  }
}

export function startRuntimeOfflineSweeper(): void {
  if (sweepInterval) return;
  sweepOnce().catch(err => console.warn('[offline-sweeper] initial sweep failed:', err));
  sweepInterval = setInterval(() => {
    sweepOnce().catch(err => console.warn('[offline-sweeper] sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
}

export function stopRuntimeOfflineSweeper(): void {
  if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; }
}
```

### Edge case: runtime registered but never heartbeats

- `runtimes.last_heartbeat_at` is nullable (migration 004:34). Phase 19 (daemon REST) will INSERT rows with `last_heartbeat_at = now()` at register time. For defence-in-depth, the sweeper's predicate includes `OR last_heartbeat_at IS NULL`, so a row inserted directly (e.g., test fixture) with no heartbeat → offline within one tick.

### Why NOT a DB trigger or scheduled-job framework

- Triggers: SQLite triggers don't support time-based firing without polling anyway.
- Scheduled-job frameworks (node-cron, bull): zero existing dependency; a `setInterval` is 3 lines vs a new dep.

## File Layout

New files created by Phase 16 (all use ESM `.js` imports per CLAUDE.md):

```
apps/server/src/
├── services/
│   └── runtime-registry.ts            NEW  — CRUD for runtimes table
│                                              • listAll(workspaceId)      — LEFT JOIN status derivation
│                                              • getById(id)
│                                              • updateHeartbeat(id)       — Phase 19 will call; define signature now
│                                              • Does NOT handle hosted mirror logic; that's runtime-bridge
├── task-dispatch/                     NEW DIR  — per ARCHITECTURE.md §"File Layout" (no collision; dir did not exist)
│   ├── runtime-bridge.ts              NEW  — onInstanceCreated / onInstanceRenamed / reconcileFromInstances
│   └── offline-sweeper.ts             NEW  — startRuntimeOfflineSweeper / stopRuntimeOfflineSweeper
├── routes/
│   └── runtimes.ts                    NEW  — GET /api/runtimes with requireAuth (convention: routes/instances.ts)
└── server-core.ts                     MODIFY  — add 2 imports + 2 lines after line 265
└── services/instance-manager.ts       MODIFY  — add 4 hook calls (lines 167, 475, 820, 951)
```

**Collision check performed:** `ls apps/server/src/task-dispatch/` → directory does not exist. Safe to create.

**Service name:** `runtime-registry.ts` (not `runtimes.ts`) — disambiguates from `routes/runtimes.ts` and from the existing `runtime/` directory (`runtime/factory.ts`, `runtime/docker.ts`) which is the container-runtime engine, a distinct concern.

**Import pattern (mandatory from CLAUDE.md):**

```typescript
// apps/server/src/task-dispatch/runtime-bridge.ts
import { db } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import type { Instance } from '@aquarium/shared';
import type { Runtime } from '@aquarium/shared';  // v14-types re-exported via packages/shared/src/index.ts
```

## Known Pitfalls to Surface in Plans

### ST1 — Instance vs runtime status drift (HARD) — `.planning/research/PITFALLS.md:438`

- **Risk:** A trigger or write path that stores derived `runtimes.status` from `instances.status` creates a second writer → race → drift.
- **Prevention in Phase 16:** the bridge NEVER writes to `runtimes.status` for `kind='hosted_instance'` rows. `listAll()` projects status via JOIN. The stored `status` column holds `'offline'` placeholder from INSERT time and is never read for hosted rows.
- **Test:** post-migration, run `UPDATE runtimes SET status='online' WHERE kind='hosted_instance'` manually, then verify `GET /api/runtimes` still returns `status='offline'` for a stopped instance. The derived JOIN wins.

### ST4 — Instance delete cascade must clean mirror (HARD) — `.planning/research/PITFALLS.md:482`

- **Risk:** orphaned mirror rows after instance deletion; in-flight hosted tasks hit 404s.
- **Prevention in Phase 16:** already handled by migration 004 `runtimes.instance_id ON DELETE CASCADE` (verified in 15-02 summary). No code in Phase 16 needs to handle explicit deletion. Phase 20+ (hosted-worker) handles in-flight task failure on instance stop/delete.
- **Test:** INSERT an instance + mirror runtime + dummy agent, then `DELETE FROM instances WHERE id=?`, assert `runtimes` row is gone (already proven in 15-02 verification evidence).

### RT-bridge double-register hazard (NEW, Phase 16 specific)

- **Risk:** `reconcileFromInstances` at boot sees instance X → inserts mirror. Concurrently, a request thread creates a new instance via `createInstance` → hook fires → second insert attempted → UNIQUE constraint violation (migration 004 `UNIQUE(workspace_id, daemon_id, provider)` — but daemon_id is NULL for hosted, so this UNIQUE does NOT apply).
- **Actual constraint:** there is no UNIQUE on `(workspace_id, instance_id)` in migration 004 — only the partial `idx_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL` which is a regular index, not unique.
- **Prevention:** the bridge's INSERT must be a UPSERT keyed on `instance_id`. SQLite: `INSERT ... ON CONFLICT (instance_id) DO UPDATE ...` — but this REQUIRES a UNIQUE index on `instance_id WHERE instance_id IS NOT NULL`. **ACTION ITEM for planner:** either (a) add `t.unique(['instance_id'])` via a new sub-migration 009, or (b) implement UPSERT manually via `.first() + insert/update`. Option (a) is cleaner and matches the "one hosted mirror per instance" invariant — recommend adding a small migration 009 that converts the existing partial index to a partial UNIQUE index.
- **Open Question:** planner should decide (a) vs (b). Plan A (migration 009) is ~5 lines and idempotent; Plan B (service-level UPSERT) is ~15 lines but avoids a schema change.

### Rename race: broadcast before DB commit

- **Risk:** `updateInstanceConfig` at instance-manager.ts:822 calls `db.update()` then falls through. The rename hook call must come AFTER `await db(...).update(patch)` resolves, not before. Otherwise the bridge reads the old name.
- **Prevention:** place the hook call AFTER line 822's `await` completes. Line 823 is where `getInstance` re-reads, so hook goes at line 822.5 — right after the update awaits, before the getInstance re-read.

### No event-bus yet → future phases

- **Observation:** Phase 16 introduces explicit function-call hooks (not pub/sub). If Phase 17 (agents service) or Phase 20 (hosted-worker) also need to observe instance lifecycle, they can call the same bridge functions, OR we can promote the bridge to an in-process `EventEmitter` at a later phase.
- **Non-risk for Phase 16:** one consumer (the bridge itself) doesn't justify a bus. Flag for future phases only.

### CE1 — workspace_id enforcement on every query (HARD, inherited from Phase 15)

- **Risk:** `listAll()` without `WHERE workspace_id = ?` leaks runtimes across workspaces (EE concern; CE has one, but EE must work when it forks).
- **Prevention:** `runtime-registry.listAll(workspaceId)` takes `workspaceId` as required arg. CE route passes `'AQ'` (seeded by migration 003:44). EE will pass `req.auth.workspaceId`.

## Environment Availability

Skip — pure code/config changes. No new external deps.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (existing, per CLAUDE.md) — no unit test framework in CE today |
| Config file | `playwright.config.ts` at repo root |
| Quick run command | `npx playwright test tests/e2e/runtimes.spec.ts` (new) |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RT-01 | `GET /api/runtimes` returns unified list | e2e (HTTP + DB fixture) | `npx playwright test -g "RT-01"` | ❌ Wave 0 — create `tests/e2e/runtimes.spec.ts` |
| RT-02 | Boot reconcile mirrors instances | e2e — seed an instance, restart server, assert runtime row | `npx playwright test -g "RT-02"` | ❌ Wave 0 |
| RT-03 | Create/rename/delete mirror within 2s | e2e — create instance via API, poll for mirror row, measure <2000ms | `npx playwright test -g "RT-03"` | ❌ Wave 0 |
| RT-04 | Derived status via JOIN | e2e — stop instance, expect runtime.status='offline' in GET /api/runtimes | `npx playwright test -g "RT-04"` | ❌ Wave 0 |
| RT-05 | Offline sweeper flips stale heartbeat | e2e — INSERT daemon runtime with old heartbeat, wait 30s+, assert status='offline' | `npx playwright test -g "RT-05"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test tests/e2e/runtimes.spec.ts -g "RT-0[1-5]"` — ~15s
- **Per wave merge:** full `npx playwright test` — ~2-3 min
- **Phase gate:** full suite green + manual check that `GET /api/runtimes` returns expected shape

### Wave 0 Gaps

- [ ] `tests/e2e/runtimes.spec.ts` — new file covering RT-01..RT-05
- [ ] No shared fixtures needed beyond existing Playwright test harness

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `requireAuth` cookie-JWT on `GET /api/runtimes` (same pattern as `routes/instances.ts:23`) |
| V3 Session Management | no | No new session surface |
| V4 Access Control | yes | Route filters by `workspaceId` — CE=`'AQ'`; EE=`req.auth.workspaceId` |
| V5 Input Validation | minimal | Only path-param on `GET /api/runtimes/:id` (Phase 16 may not need this route yet; RT-01 is list-only) |
| V6 Cryptography | no | No crypto surface added |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace runtime leakage | Information Disclosure | Mandatory `.where('workspace_id', ctx.workspaceId)` in every runtime-registry function — enforced at service boundary |
| Bridge writes to `instances` table | Tampering | Hard static check: `runtime-bridge.ts` imports nothing from `services/instance-manager.ts` write paths; bridge only calls `db('instances').select(...)` — reviewable via grep for `db('instances').update` in the bridge file (expect zero matches) |
| Orphan mirror rows survive instance delete | Denial of Service (clutter) | Migration 004 FK CASCADE already enforces; Phase 16 adds no code around deletion |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `t.unique(['instance_id'])` partial-unique would require a new sub-migration 009; no such migration exists today | Known Pitfalls → double-register hazard | Planner must choose Option (a) migration or Option (b) service-level UPSERT; both are viable and low-risk |
| A2 | No existing `EventEmitter` or pub/sub infrastructure in InstanceManager — verified by `grep -n EventEmitter apps/server/src/services/instance-manager.ts` returning zero matches | InstanceManager Integration Map | If a hidden emitter surface is added by a concurrent phase, the explicit hooks are still correct (addition, not replacement) |
| A3 | Instance rename happens ONLY through `updateInstanceConfig` + `patchGatewayConfig` paths via `agentName` field | InstanceManager Integration Map | If a future route adds `PATCH /api/instances/:id/name` directly, it will miss the hook; reconcile loop catches within 10s — acceptable |
| A4 | Health-monitor's slow loop at 30s is an acceptable parallel cadence for the offline sweeper (both run at 30s → no throughput concern) | Offline Sweeper Pattern | If EE adds thousands of daemon runtimes, the sweep query runs on a narrow indexed predicate — `idx_runtimes_workspace_status` partially covers; not measured under load |

## Open Questions

1. **Partial-UNIQUE on `instance_id` — new migration or service-level UPSERT?**
   - What we know: migration 004 has a partial INDEX (not UNIQUE) on `instance_id WHERE instance_id IS NOT NULL`.
   - What's unclear: planner preference between small migration 009 (adds `CREATE UNIQUE INDEX uq_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL`) vs service-level check-then-insert.
   - Recommendation: **migration 009 (~10 LOC, dialect-branched the same way as existing partial index in 004:125)**. Simpler to reason about; enforces "one hosted mirror per instance" at schema level like other Phase 15 invariants.

2. **WebSocket emit semantics for runtime events**
   - What we know: ARCHITECTURE.md §"WebSocket Unification" says browser WS gains `subscribe_workspace` later.
   - What's unclear: Phase 16 can emit `broadcast(instanceId, { type: 'runtime:updated', payload: ... })` on every mirror change, but there's no client listening today.
   - Recommendation: **emit the events now** — harmless when no client is subscribed (broadcast iterates `clients` set, sends nothing). Phase 25 (Management UIs) reads them directly without a breaking-change round.

3. **Should Phase 16 also stub `GET /api/runtimes/:id`?**
   - What we know: RT-01 says "list all runtimes" — phrasing suggests list only.
   - What's unclear: Phase 25 UI may want detail-view later; stubbing now saves a route-handler round.
   - Recommendation: include `GET /api/runtimes/:id` at minimal cost (~15 LOC) in the same file. Dismiss if planner prefers strict scope.

4. **CE workspace resolution in routes**
   - What we know: CE seeds `workspaces.id = 'AQ'`.
   - What's unclear: does the route hardcode `'AQ'`, read from `config.ce.defaultWorkspaceId`, or look up via `SELECT id FROM workspaces LIMIT 1`?
   - Recommendation: hardcoded `'AQ'` constant in `routes/runtimes.ts` for Phase 16; EE branch passes `req.auth.workspaceId`. Same pattern will recur in Phase 17–19 routes; extracting a shared helper is a Phase 25 concern, not Phase 16.

## Code Examples

### Bridge hook signature

```typescript
// apps/server/src/task-dispatch/runtime-bridge.ts
// Source: verified from migration 004 column set + v14-types Runtime interface
import { db } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import { randomUUID } from 'crypto';
import type { Instance } from '@aquarium/shared';

const DEFAULT_WORKSPACE_ID = 'AQ';

export async function onInstanceCreated(instance: Instance): Promise<void> {
  await db('runtimes').insert({
    id: randomUUID(),
    workspace_id: DEFAULT_WORKSPACE_ID,
    name: instance.name,
    kind: 'hosted_instance',
    provider: 'hosted',                     // canonical per v14-types RuntimeProvider
    status: 'offline',                      // placeholder; derived via JOIN at read
    instance_id: instance.id,
    daemon_id: null,
    device_info: null,
    last_heartbeat_at: null,
    metadata: JSON.stringify({}),
    owner_user_id: instance.userId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  }).onConflict('instance_id').ignore();    // assumes migration 009 adds UNIQUE; fallback: catch + swallow
  // Optional: broadcast({ type: 'runtime:created', ... })
}

export async function onInstanceRenamed(instanceId: string, newName: string): Promise<void> {
  await db('runtimes')
    .where({ instance_id: instanceId, kind: 'hosted_instance' })
    .update({ name: newName, updated_at: db.fn.now() });
}

export async function reconcileFromInstances(): Promise<void> {
  const instances = await db('instances').select('id', 'user_id', 'name');
  for (const row of instances) {
    await db('runtimes')
      .insert({
        id: randomUUID(),
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: row.name,
        kind: 'hosted_instance',
        provider: 'hosted',
        status: 'offline',
        instance_id: row.id,
        daemon_id: null,
        metadata: JSON.stringify({}),
        owner_user_id: row.user_id,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .onConflict('instance_id')
      .merge({ name: row.name, updated_at: db.fn.now() });
  }
}
```

### Route controller (convention match)

```typescript
// apps/server/src/routes/runtimes.ts
// Source: mirrors apps/server/src/routes/instances.ts:22-52 convention
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listAll } from '../services/runtime-registry.js';
import type { ApiResponse, Runtime } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

const CE_WORKSPACE_ID = 'AQ';

router.get('/', async (_req, res) => {
  try {
    const runtimes = await listAll(CE_WORKSPACE_ID);
    res.json({ ok: true, data: runtimes } satisfies ApiResponse<Runtime[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
```

Register in `server-core.ts` next to `app.use('/api/instances', instanceRoutes);` (line 148):
```typescript
import runtimeRoutes from './routes/runtimes.js';
...
app.use('/api/runtimes', runtimeRoutes);
```

## Sources

### Primary (HIGH confidence)

- `.planning/research/SUMMARY.md` — runtime unification, derived status policy, boot sequence 9a-9e, recommended file layout
- `.planning/research/ARCHITECTURE.md` — service decomposition, runtime-bridge responsibilities, "critical path gotchas" #2-3
- `.planning/research/PITFALLS.md:438` (ST1), `:482` (ST4), `:561` (SCH3) — verified text
- `.planning/phases/15-schema-shared-types/15-02-SUMMARY.md` — migration 004 shape + CASCADE verification + PRAGMA foreign_key_list output
- `.planning/phases/15-schema-shared-types/15-06-SUMMARY.md` — v14 shared types export list (26 types including Runtime/RuntimeKind/RuntimeStatus)
- `apps/server/src/services/instance-manager.ts` — verified line-level write sites (createInstance:142, cloneInstance:446, updateStatus:69, updateInstanceConfig:804, patchGatewayConfig:843, deleteInstance:982, rename at :820 and :951)
- `apps/server/src/services/gateway-event-relay.ts:747–759` — `startGatewayEventRelay` existing 10s poll pattern (reference for hybrid approach)
- `apps/server/src/server-core.ts:202–281` — verified boot-order; insertion point at line 265–267
- `apps/server/src/ws/index.ts:115–146` — `broadcast` / `broadcastToUser` signatures (Phase 16 may emit runtime events through `broadcast(instanceId, ...)` reusing the channel)
- `apps/server/src/db/migrations/004_runtimes.ts` — full schema + trigger + FK CASCADE definitions
- `apps/server/src/routes/instances.ts:22–52` — route convention for RT-01
- `apps/server/src/services/health-monitor.ts:384–399` — existing 5s/30s dual-loop (reason to keep sweeper standalone)
- `apps/server/src/db/adapter.ts:29` — `dialect: 'pg' | 'sqlite'` for any future dialect branching
- `packages/shared/src/v14-types.ts:32–58` — `RuntimeKind` / `RuntimeStatus` / `RuntimeProvider` / `Runtime` interface

### Secondary (MEDIUM confidence)

- none — all sources are HIGH primary (direct file reads in this repo)

### Tertiary (LOW confidence)

- none

## Metadata

**Confidence breakdown:**
- InstanceManager integration map: HIGH — verified line-by-line against source
- Boot order recommendation: HIGH — exact line numbers in `server-core.ts` confirmed
- Derived-status JOIN pattern: HIGH — SQL syntax portable across SQLite 3.38+ and Postgres 12+; matches knex idiom
- Offline sweeper pattern: HIGH — trivial SQL; isolation decision is maintenance-driven, not technical
- File layout: HIGH — no collisions (directory `task-dispatch/` does not exist; filename `runtime-registry.ts` does not exist)
- Open question on UNIQUE constraint: MEDIUM — needs planner decision (two valid paths)

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days; phase spec is stable, no external deps to drift)
