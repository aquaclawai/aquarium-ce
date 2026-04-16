---
phase: 16-runtime-registry-runtime-bridge
verified: 2026-04-16T18:45:00Z
status: passed
score: 4/4 success criteria + 5/5 requirements + 2/2 pitfalls verified
---

# Phase 16: Runtime Registry + Runtime-Bridge Verification Report

**Phase Goal:** Users can list all runtimes (hosted + daemon) in a single unified view, and the platform automatically mirrors existing Aquarium instances into the `runtimes` table as `hosted_instance` rows without modifying `InstanceManager`.
**Verified:** 2026-04-16T18:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (ROADMAP contract — all 4 verified)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /api/runtimes` returns hosted + daemon runtimes with kind / provider / status / device_info / last_heartbeat_at | VERIFIED | Route `apps/server/src/routes/runtimes.ts:23-31` calls `listAll('AQ')`; `runtime-registry.ts:60-93` projects all required columns. E2E test #2 (RT-01) asserts shape. |
| 2 | Create/rename/archive/delete of an Aquarium instance mirrors to `runtimes` row within 2 seconds | VERIFIED | 4 synchronous hooks wired in `instance-manager.ts:167,477,827,962`; FK CASCADE on delete (migration 004). E2E tests #3–#5 measured 2–3ms each (1000x under 2s budget). |
| 3 | `runtime.status` for `kind='hosted_instance'` always derived from `instances.status` via JOIN (never stored) | VERIFIED | `listAll` LEFT JOIN + CASE WHEN at `runtime-registry.ts:78-88`; `upsertHostedRuntime` UPDATE path excludes `status` (only `name + updated_at`). E2E test #6 + ST1 global proof #8 confirm stored `r.status='offline'` never mutates. |
| 4 | Offline sweeper transitions daemon runtimes with heartbeat > 90s ago to `status='offline'` within one sweep tick | VERIFIED | `offline-sweeper.ts` with `HEARTBEAT_WINDOW_MS=90_000`, `SWEEP_INTERVAL_MS=30_000`, `whereIn('kind', ['local_daemon', 'external_cloud_daemon'])` daemon-only guard. E2E test #7 flipped stale daemon in 23.6s (under 45s budget). |

**Score:** 4/4 success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/db/migrations/009_runtimes_instance_unique.ts` | Partial UNIQUE index on runtimes(instance_id) WHERE instance_id IS NOT NULL | VERIFIED | 61 LOC, drops `idx_runtimes_instance`, creates `uq_runtimes_instance`; dialect-branched via lazy `getAdapter()`. Migration applied to live DB (`~/.aquarium/aquarium.db`) — partial UNIQUE present, old non-unique index absent. |
| `apps/server/src/services/runtime-registry.ts` | listAll/getById/upsertHostedRuntime/upsertDaemonRuntime/updateHeartbeat/setRuntimeOffline | VERIFIED | All 6 exports present. LEFT JOIN + CASE WHEN derived status. `upsertHostedRuntime` now transactional (SELECT-then-UPDATE-or-INSERT) after 16-04 deviation fix; UPDATE branch excludes `status`. `whereIn` daemon-kind guard on `setRuntimeOffline` + `updateHeartbeat`. |
| `apps/server/src/task-dispatch/runtime-bridge.ts` | onInstanceCreated / onInstanceRenamed / reconcileFromInstances | VERIFIED | All 3 exports present. SELECT-only against instances; delegates all writes to `upsertHostedRuntime`; `DEFAULT_WORKSPACE_ID='AQ'`. |
| `apps/server/src/task-dispatch/offline-sweeper.ts` | startRuntimeOfflineSweeper / stopRuntimeOfflineSweeper | VERIFIED | Both exports present; 90s heartbeat window, 30s sweep interval, idempotent start, per-tick `.catch`, initial sweep on start, `whereIn('kind', [...daemon])` guard. |
| `apps/server/src/routes/runtimes.ts` | GET /api/runtimes + GET /api/runtimes/:id, requireAuth-gated, ApiResponse shape | VERIFIED | Both routes registered. `router.use(requireAuth)` applied. `satisfies ApiResponse<Runtime[]>` / `ApiResponse<Runtime>` compile-time enforcement. Thin controller — no direct `db(...)` calls. |
| `apps/server/src/server-core.ts` boot wiring | reconcile awaited AFTER gateway-event-relay, BEFORE server.listen; sweeper started after reconcile; route registered | VERIFIED | Line 269 `startGatewayEventRelay()` → 275 `await runtimeBridgeReconcile()` (try/catch wrapped) → 285 `setInterval(reconcile, 10_000).catch` → 292 `startRuntimeOfflineSweeper()` → 302 `server.listen`. Route registered at line 152 `app.use('/api/runtimes', runtimeRoutes)`. |
| `tests/e2e/runtimes.spec.ts` | Playwright coverage RT-01..RT-05 + ST1 | VERIFIED | 334 LOC, 8 tests in describe.serial, 8/8 passing in 24.3s (re-run at verification time). Direct better-sqlite3 reads assert ST1 column-level invariant. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `services/runtime-registry.ts#listAll` | instances table | LEFT JOIN + CASE WHEN i.status | WIRED | Line 62 `leftJoin('instances as i', 'r.instance_id', 'i.id')`; CASE WHEN at 78-88. |
| `db/migrations/009` | runtimes table | DROP idx_runtimes_instance + CREATE UNIQUE INDEX uq_runtimes_instance | WIRED | Live DB confirms `uq_runtimes_instance` exists, `idx_runtimes_instance` absent. |
| `instance-manager.ts#createInstance` | `runtime-bridge.ts#onInstanceCreated` | `await runtimeBridge.onInstanceCreated(instance)` | WIRED | Hook at line 167. |
| `instance-manager.ts#cloneInstance` | `runtime-bridge.ts#onInstanceCreated` | same | WIRED | Hook at line 477. |
| `instance-manager.ts#updateInstanceConfig` | `runtime-bridge.ts#onInstanceRenamed` | guarded on `patch.name` truthy | WIRED | Hook at line 827. |
| `instance-manager.ts#patchGatewayConfig` | `runtime-bridge.ts#onInstanceRenamed` | guarded on `patch.name` truthy | WIRED | Hook at line 962. |
| `runtime-bridge.ts#onInstanceCreated` | `runtime-registry.ts#upsertHostedRuntime` | delegation | WIRED | Line 36 of bridge. |
| `server-core.ts#startServer` | `runtime-bridge.ts#reconcileFromInstances` | awaited after startGatewayEventRelay, wrapped try/catch, + 10s safety-net setInterval | WIRED | Lines 269→275, 283-287. |
| `server-core.ts#startServer` | `offline-sweeper.ts#startRuntimeOfflineSweeper` | fire-and-forget after reconcile, before server.listen | WIRED | Line 292. |
| `routes/runtimes.ts` | `services/runtime-registry.ts#listAll` | requireAuth → listAll('AQ') | WIRED | Line 25. |
| instance delete | mirror runtime row | FK CASCADE on runtimes.instance_id → instances(id) | WIRED | Migration 004: `on delete CASCADE` (confirmed in live schema). E2E test #5 proves removal at both API and SQL layer. |

### Boot Order Verification

Executed: `grep -n "runtimeBridgeReconcile\|startRuntimeOfflineSweeper\|startGatewayEventRelay\|server.listen" apps/server/src/server-core.ts`

```
269:    startGatewayEventRelay();
275:      await runtimeBridgeReconcile();          (try/catch-wrapped)
285:      runtimeBridgeReconcile().catch(...)      (10s safety-net tick)
292:    startRuntimeOfflineSweeper();
302:    server.listen(config.port, () => {
```

Order: `startGatewayEventRelay → await reconcile → safety-net setInterval → startRuntimeOfflineSweeper → server.listen` — matches ROADMAP contract.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RT-01 | 16-01, 16-03 | List all runtimes in unified view with kind/provider/status/device_info/heartbeat | SATISFIED | Route + listAll + E2E test #2 |
| RT-02 | 16-02 | Boot-mirror existing instances into runtimes as hosted_instance | SATISFIED | `reconcileFromInstances` awaited at boot step 9a (line 275); E2E tests #3 (create) + #6 (fresh RT-04 instance) confirm mirror exists |
| RT-03 | 16-02 | Mirror create/rename/archive/delete within 2s | SATISFIED | 4 hook sites + FK CASCADE; E2E tests #3,#4,#5 measured 2–3ms each |
| RT-04 | 16-01 | runtime.status for hosted derived from instances via JOIN, never stored | SATISFIED | LEFT JOIN + CASE WHEN; UPDATE branch excludes status; E2E tests #6, #8 prove stored placeholder never mutates |
| RT-05 | 16-03 | Heartbeat-stale daemons auto-flipped offline by sweeper | SATISFIED | 90s/30s sweeper with daemon-only `whereIn` guard; E2E test #7 flipped in 23.6s |

**Coverage: 5/5 requirements satisfied. No orphaned requirements.**

### Owned Pitfalls Verification

**ST1 (HARD) — InstanceManager is only writer of `instances.status`; runtime-bridge read-only against instances; `runtimes.status` for hosted rows is derived (never stored at write time)**

Three grep assertions executed:

1. `grep -cE "db\('instances'\)\.(update|insert|delete)" apps/server/src/task-dispatch/runtime-bridge.ts` → **0** (expected 0)
   - Bridge uses only `db('instances').select('id','user_id','name')` in `reconcileFromInstances` (read-only).

2. `grep -cE "db\('runtimes'\)\.(update|insert|delete)" apps/server/src/services/instance-manager.ts` → **0** (expected 0)
   - InstanceManager has zero direct runtimes writes; all runtime writes route through `runtimeBridge.*` → registry.

3. Inspected `upsertHostedRuntime` hosted UPDATE branch (`runtime-registry.ts:164-167`):
   ```typescript
   await trx('runtimes')
     .where({ id: existing.id as string })
     .update({ name: args.name, updated_at: db.fn.now() });
   ```
   **UPDATE block excludes `status`** — only `name` and `updated_at`. Preserves ST1 HARD.

Defence-in-depth confirmed:
- `setRuntimeOffline` + `updateHeartbeat` guarded by `whereIn('kind', ['local_daemon', 'external_cloud_daemon'])`.
- `offline-sweeper.ts` batched UPDATE guarded by same `whereIn('kind', [...])`.
- E2E test #8 (ST1 global proof) reads stored `runtimes.status` for every hosted row → 0 violations (all remain 'offline' placeholder).

**Verdict: ST1 HARD VERIFIED.**

**ST4 — FK CASCADE from migration 004 (Phase 15) removes mirror runtime when instance deleted**

- Schema confirmed via `sqlite3 ~/.aquarium/aquarium.db "SELECT sql FROM sqlite_master WHERE name='runtimes'"`:
  `foreign key(instance_id) references instances(id) on delete CASCADE`
- E2E test #5 (RT-03 delete): after `DELETE /api/instances/:id?purge=true`, mirror row is gone in both API response and direct SQL query within 3ms.

**Verdict: ST4 VERIFIED.**

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 009 applied | `sqlite3 ~/.aquarium/aquarium.db "SELECT count(*) FROM knex_migrations WHERE name LIKE '%009%'"` | 1 | PASS |
| Partial UNIQUE live | `sqlite3 ~/.aquarium/aquarium.db "SELECT sql FROM sqlite_master WHERE name='uq_runtimes_instance'"` | `CREATE UNIQUE INDEX uq_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL` | PASS |
| Old non-unique index dropped | `sqlite3 ~/.aquarium/aquarium.db "SELECT sql FROM sqlite_master WHERE name='idx_runtimes_instance'"` | (empty) | PASS |
| FK CASCADE present | `sqlite3 ~/.aquarium/aquarium.db "SELECT sql FROM sqlite_master WHERE name='runtimes'"` | contains `foreign key(instance_id) references instances(id) on delete CASCADE` | PASS |
| ST1 grep: bridge vs instances writes | `grep -cE "db\('instances'\)\.(update\|insert\|delete)" ...runtime-bridge.ts` | 0 | PASS |
| ST1 grep: instance-manager vs runtimes writes | `grep -cE "db\('runtimes'\)\.(update\|insert\|delete)" ...instance-manager.ts` | 0 | PASS |
| Sweeper daemon-only guard | `grep "whereIn('kind'" ...offline-sweeper.ts` | matched at line 28 | PASS |
| Route registered | `grep "app.use.*runtimeRoutes" ...server-core.ts` | `app.use('/api/runtimes', runtimeRoutes);` at line 152 | PASS |
| Boot order | `grep -n "runtimeBridgeReconcile\|startRuntimeOfflineSweeper\|startGatewayEventRelay\|server.listen" ...server-core.ts` | 269→275→285→292→302 | PASS |
| Hook call count | `grep -c 'runtimeBridge\.' ...instance-manager.ts` | 4 | PASS |
| Typecheck | `npm run typecheck -w @aquaclawai/aquarium` | exit 0 | PASS |
| E2E full suite | `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` | 8/8 passed (24.3s) | PASS |

### Anti-Patterns Found

None. All files inspected:

- No `TODO`/`FIXME`/`PLACEHOLDER` blockers in production code (only `TODO(EE)` comment in `routes/runtimes.ts:10` for Phase 20+ multi-workspace work — informational).
- No stubs. Every function body contains real queries/logic.
- No `any`, no `@ts-ignore`, no empty-return placeholders.
- All relative imports use `.js` extension per CLAUDE.md §ESM Import Rules.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `routes/runtimes.ts` GET / | `runtimes` | `listAll('AQ')` → `db('runtimes as r').leftJoin('instances as i')...` | Yes (E2E test #2 returns non-empty list after instance creation) | FLOWING |
| `routes/runtimes.ts` GET /:id | `runtime` | `getById('AQ', id)` → joined query | Yes | FLOWING |
| `offline-sweeper.ts` sweepOnce | `affected` count | batched UPDATE returning affected row count | Yes (E2E test #7 confirms flip) | FLOWING |
| `runtime-bridge.ts` reconcileFromInstances | `rows` from instances table | `db('instances').select('id','user_id','name')` | Yes (iterates, upserts each row) | FLOWING |

### Human Verification Required

None. All success criteria programmatically verifiable via E2E suite + direct DB assertions.

### E2E Run Evidence

```
Running 8 tests using 1 worker

  ✓  1 [chromium] signup disposable test user via /api/auth/test-signup (20ms)
  ✓  2 [chromium] RT-01: GET /api/runtimes returns 200 with a Runtime[] shape (23ms)
[RT-02] mirror appeared in 3ms
  ✓  3 [chromium] RT-02: creating an instance produces a mirror runtime within 2s (11ms)
[RT-03 rename] mirror.name updated in 2ms
  ✓  4 [chromium] RT-03: renaming instance propagates to mirror.name within 2s (8ms)
[RT-03 delete] mirror CASCADE removed in 3ms
  ✓  5 [chromium] RT-03: deleting instance removes mirror runtime within 2s (FK CASCADE) (13ms)
  ✓  6 [chromium] RT-04: derived status + ST1 — stored r.status never written for hosted rows (11ms)
[RT-05] sweeper flipped daemon to offline in 23598ms
  ✓  7 [chromium] RT-05: daemon runtime with stale heartbeat flips offline within one sweep tick (23.6s)
  ✓  8 [chromium] ST1 global proof: r.status for every hosted_instance row is still offline placeholder (3ms)

  8 passed (24.3s)
```

## Summary

All 4 Phase 16 success criteria are observed and verified. All 5 requirements (RT-01..RT-05) satisfied with plan ownership mapping to code. Both owned pitfalls (ST1 HARD, ST4) re-proven at verification time via grep + direct SQL + E2E exercise. The refactored `upsertHostedRuntime` (transactional SELECT→UPDATE-or-INSERT after the 16-04 deviation fix) preserves ST1 HARD — the UPDATE branch only touches `name` and `updated_at`. Partial UNIQUE on `instance_id` still enforces at-most-one hosted mirror per instance at the schema layer.

Typecheck clean, E2E suite 8/8 green in 24.3s at verification time (re-run fresh, not relying on summary claims).

**Phase 16 goal achieved.**

---

_Verified: 2026-04-16T18:45:00Z_
_Verifier: Claude (gsd-verifier)_
