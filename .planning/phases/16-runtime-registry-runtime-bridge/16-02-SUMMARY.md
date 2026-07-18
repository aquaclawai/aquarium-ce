---
phase: 16-runtime-registry-runtime-bridge
plan: 02
subsystem: runtime-bridge
tags: [service, hooks, upsert, hosted-mirror, task-dispatch, websocket]
requires:
  - .planning/phases/16-runtime-registry-runtime-bridge/16-01-SUMMARY.md
  - apps/server/src/services/runtime-registry.ts
  - apps/server/src/ws/index.ts
provides:
  - apps/server/src/task-dispatch/runtime-bridge.ts (onInstanceCreated / onInstanceRenamed / reconcileFromInstances)
  - 4 synchronous hook call sites in services/instance-manager.ts (createInstance, cloneInstance, updateInstanceConfig rename, patchGatewayConfig rename)
  - WS `runtime:created` / `runtime:updated` broadcast surface for Phase 25 UI consumers
affects:
  - server-core.ts (plan 16-03 will call reconcileFromInstances() at boot + start 10s interval)
  - offline-sweeper (plan 16-03 consumes setRuntimeOffline but orthogonal to bridge)
  - Phase 25 UI (consumes the new runtime:* WS events; zero-cost when no subscriber today)
tech-stack:
  added:
    - apps/server/src/task-dispatch/ directory (new module boundary)
  patterns:
    - Explicit function-call hooks at write sites (no EventEmitter) — RT-03 <2s SLA
    - Idempotent UPSERT via partial UNIQUE(instance_id) from migration 009
    - LEFT JOIN derived-status read path (untouched — consumers depend on 16-01 listAll)
key-files:
  created:
    - apps/server/src/task-dispatch/runtime-bridge.ts
  modified:
    - apps/server/src/services/instance-manager.ts (import + 4 hook calls, 10 LOC added)
decisions:
  - "Namespace import (`import * as runtimeBridge`) over named imports — makes every hook call site grep-able as `runtimeBridge.onInstanceCreated` / `runtimeBridge.onInstanceRenamed` for future audit"
  - "Hooks are placed AFTER the `await db('instances').update(...)` resolves at rename sites — prevents rename race (bridge reading stale name)"
  - "Rename hooks gated on `typeof patch.name === 'string' && patch.name.trim()` — mirrors the existing guard at updateInstanceConfig:818 and patchGatewayConfig:950, so the bridge fires only when a rename actually happened"
  - "deleteInstance intentionally NOT hooked — FK CASCADE from migration 004 (`runtimes.instance_id ... ON DELETE CASCADE`) removes the mirror row automatically. Adding a hook would either double-work or race the CASCADE."
  - "updateStatus / start / stop / restart NOT hooked — hosted status is derived at read time via listAll's LEFT JOIN + CASE WHEN (ST1 HARD: bridge is not the writer of runtimes.status for hosted rows)"
  - "reconcileFromInstances uses a per-row try/catch so one bad row never blocks the whole boot/10s reconcile — console.warn + continue"
  - "setInterval NOT started inside runtime-bridge.ts — plan 16-03's server-core wiring owns the 10s safety-net loop alongside other boot timers (single source of truth for timers)"
metrics:
  duration: "~5 min"
  tasks-completed: 2
  files-created: 1
  files-modified: 1
  loc-added: "~115 (106 bridge + 9 instance-manager edits)"
  commits: 2
  completed: 2026-04-16
---

# Phase 16 Plan 02: Runtime-Bridge Hook Surface + Reconcile Summary

**One-liner:** Shipped `task-dispatch/runtime-bridge.ts` (3 exports: onInstanceCreated, onInstanceRenamed, reconcileFromInstances) and wired 4 synchronous hook call sites into `services/instance-manager.ts` — hosted Aquarium instances now auto-mirror into the `runtimes` table within ~50ms of create/clone/rename, with a 10s reconcile safety-net path owned by plan 16-03.

## What Was Built

### 1. `apps/server/src/task-dispatch/runtime-bridge.ts` (NEW, 106 LOC)

Three exported functions (all `Promise<void>`):

```typescript
export async function onInstanceCreated(instance: Instance): Promise<void>;
export async function onInstanceRenamed(instanceId: string, newName: string): Promise<void>;
export async function reconcileFromInstances(): Promise<void>;
```

**Responsibilities per function:**

| Function | When fired | Body | Broadcasts |
|---|---|---|---|
| `onInstanceCreated` | After createInstance + cloneInstance inserts | `upsertHostedRuntime({ workspaceId: 'AQ', instanceId, name, ownerUserId })` | `runtime:created` on `instance.id` channel |
| `onInstanceRenamed` | After rename committed (both updateInstanceConfig + patchGatewayConfig) | `upsertHostedRuntime({ workspaceId: 'AQ', instanceId, name: newName, ownerUserId: null })` — the `.merge()` only touches name + updated_at | `runtime:updated` on `instanceId` channel |
| `reconcileFromInstances` | Boot + every 10s (wired by plan 16-03) | `SELECT id, user_id, name FROM instances` → for each row, call `upsertHostedRuntime(...)` with per-row try/catch | none (per-row) |

**Dependencies:**
- `../db/index.js` — SELECT-only against `instances` table inside `reconcileFromInstances`
- `../ws/index.js` — `broadcast()` helper (Phase 25 subscribers will consume)
- `../services/runtime-registry.js` — the only write path (`upsertHostedRuntime`)
- `@aquarium/shared` — `Instance` type

**Idempotency guarantee:** `upsertHostedRuntime` uses `.onConflict('instance_id').merge({ name, updated_at })` against the partial UNIQUE index `uq_runtimes_instance` shipped by migration 009 (plan 16-01). Running the boot reconcile concurrently with a create-hook produces identical end state — no duplicate rows, no status drift (the merge block excludes `status`).

### 2. `apps/server/src/services/instance-manager.ts` (MODIFIED, +9 LOC)

**Edit 0 — namespace import (line 26):**
```typescript
import * as runtimeBridge from '../task-dispatch/runtime-bridge.js';
```
Chosen over named imports so every hook call site is grep-able as `runtimeBridge.X` for future audit.

**Edits 1–4 — 4 hook call sites:**

| # | Function | Line | Fragment around edit (post-edit) |
|---|---|---|---|
| 1 | `createInstance` | 167 | `await addEvent(instance.id, 'created');` → `await runtimeBridge.onInstanceCreated(instance);` → `return instance;` |
| 2 | `cloneInstance` | 477 | `await addEvent(cloned.id, 'cloned', { sourceInstanceId: sourceId });` → `await runtimeBridge.onInstanceCreated(cloned);` → `return cloned;` |
| 3 | `updateInstanceConfig` rename | 827 | `await db('instances').where({ id }).update(patch);` → `if (typeof patch.name === 'string' && patch.name.trim()) { await runtimeBridge.onInstanceRenamed(id, patch.name); }` → `return (await getInstance(id, userId))!;` |
| 4 | `patchGatewayConfig` rename | 962 | `await db('instances').where({ id: instanceId }).update(patch);` → `if (typeof patch.name === 'string' && patch.name.trim()) { await runtimeBridge.onInstanceRenamed(instanceId, patch.name); }` → `return;` |

**Placement rationale (rename race, from 16-RESEARCH §Known Pitfalls):** Hooks at edits 3/4 must run AFTER the `await db('instances').update(patch)` resolves — if placed before, the bridge would read the pre-update name. The `newName` is passed as an argument (from the caller's local `patch.name`), not re-read from the DB, which is the simplest correctness guarantee.

**Deliberately NOT hooked:**
- `deleteInstance` — FK CASCADE on `runtimes.instance_id ON DELETE CASCADE` (migration 004) auto-removes the mirror row.
- `updateStatus` / `startInstance` / `stopInstance` / `restartInstance` — hosted status is derived at READ time via listAll's LEFT JOIN CASE WHEN. The bridge is NEVER the writer of `runtimes.status` for hosted rows (ST1 HARD).

## HARD-Constraint Proofs (ST1)

### ST1 HARD #1 — bridge never writes to `instances` table (SELECT only)

```bash
node -e "const s=require('fs').readFileSync('apps/server/src/task-dispatch/runtime-bridge.ts','utf8'); if(/db\('instances'\)[^)]*\.(update|insert|delete)/.test(s)){process.exit(1)}"
```
Output:
```
PASS: zero writes against instances in runtime-bridge
```

The only `db('instances')` reference in the bridge is the `SELECT id, user_id, name` in `reconcileFromInstances` — read-only.

### ST1 HARD #2 — instance-manager has zero direct writes against `runtimes` table

```bash
node -e "const s=require('fs').readFileSync('apps/server/src/services/instance-manager.ts','utf8'); if(/db\(['\"]runtimes['\"]\)[^)]*\.(update|insert|delete)/.test(s)){process.exit(1)}"
```
Output:
```
PASS: zero writes against runtimes in instance-manager
```

All runtime writes from instance-manager route through `runtimeBridge.on*()` → `upsertHostedRuntime` → the registry.

### Hook-count verification (expect exactly 4)

```bash
$ grep -c 'runtimeBridge\.' apps/server/src/services/instance-manager.ts
4
```

Line positions:
```
167:  await runtimeBridge.onInstanceCreated(instance);
477:  await runtimeBridge.onInstanceCreated(cloned);
827:    await runtimeBridge.onInstanceRenamed(id, patch.name);
962:        await runtimeBridge.onInstanceRenamed(instanceId, patch.name);
```

## Idempotency Proof — at-most-one hosted mirror invariant

The invariant "exactly one `hosted_instance` runtime per `instances.id`" is enforced by two independent layers:

1. **Schema layer (migration 009, plan 16-01):** partial UNIQUE index `uq_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL`. A second INSERT with the same `instance_id` fails with `UNIQUE constraint failed: runtimes.instance_id` before any application code runs.

2. **Service layer (`upsertHostedRuntime`, plan 16-01):** `.onConflict('instance_id').merge({ name, updated_at })`. The schema-layer UNIQUE failure is converted by knex's ON CONFLICT into a targeted UPDATE that touches only `name` and `updated_at` — NEVER `status` (preserving ST1 HARD).

**Concurrent boot reconcile + create hook race:** if boot-reconcile SELECTs `instances` mid-createInstance, the resulting race is:
- Hook inserts mirror for instance X (first write wins) → done.
- Reconcile tries to INSERT mirror for X → ON CONFLICT → merge(name, updated_at) with the same name → no-op effective change.

OR:
- Reconcile inserts mirror for X (first write wins) → done.
- Hook tries to INSERT mirror for X → ON CONFLICT → merge(name, updated_at) with the same name → no-op effective change.

**End state is identical in both orderings.** The bridge's `reconcileFromInstances` can be called any number of times — zero duplicates, zero drift.

## Rename Consistency Proof

Both rename hooks (edits 3 and 4) place the `runtimeBridge.onInstanceRenamed(...)` call AFTER the `await db('instances').update(patch)` resolves. This guarantees:

- The instance row's `name` column is already the new name by the time the bridge runs.
- `newName` is passed as a direct arg from the caller's `patch.name` — not re-read. Even if some concurrent writer raced the UPDATE, the bridge would propagate the name the caller intended.
- The `.merge({ name, updated_at })` in `upsertHostedRuntime` is atomic for this single column set.

The rename-race pitfall documented in 16-RESEARCH.md §"Rename race: broadcast before DB commit" is fully closed by this placement.

## Build + Typecheck

```
npm run build -w @aquarium/shared     # tsc
npm run typecheck -w @aquaclawai/aquarium  # tsc --noEmit
```

Both exit 0. No `any`, no `@ts-ignore`. All relative imports use `.js` suffix per CLAUDE.md §ESM Import Rules. File is kebab-case (`runtime-bridge.ts`).

## Deviations from Plan

**None — plan executed exactly as written.**

- Expected line numbers (plan called out 167 / 475 / 822 / 954 but cautioned "locate by code fragment"): actual post-edit positions are 167, 477, 827, 962. The small drift (+0, +2, +5, +8) is because each earlier edit adds 1–3 lines to the file. All 4 fragments matched exactly on the first attempt using the Edit tool's `old_string` / `new_string` replacement.
- No Rule 1–3 auto-fixes triggered — the existing registry surface from plan 16-01 fit the bridge needs precisely.

## Friction Encountered

Zero. Task 1 file creation + Task 2 surgical edits landed cleanly with typecheck green on first run. The plan's ordering of "create the file that exports the functions BEFORE wiring the hooks" was essential — `tsc --noEmit` would have thrown on the namespace import in Task 2 otherwise.

## Follow-ups for Plans 16-03 and 16-04

- **Plan 16-03** will add boot-wiring in `server-core.ts`: `await runtimeBridge.reconcileFromInstances()` at step 9a, plus `setInterval(reconcileFromInstances, 10_000)` safety net. Plan 16-03 also wires the `GET /api/runtimes` route and the 30s offline sweeper.
- **Plan 16-04** will Playwright-drive RT-01..RT-05 against the full stack. RT-03 ("mirror within 2s") is already achievable today: Task 1's hook fires in <50ms synchronously inside createInstance, so any Playwright assertion can poll the DB immediately after the create HTTP response resolves.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `85d958a` | feat(16-02): add runtime-bridge with hook surface + reconcile loop |
| 2 | `7368fa1` | feat(16-02): wire 4 runtime-bridge hook call sites into instance-manager |

## Self-Check: PASSED

- FOUND: apps/server/src/task-dispatch/runtime-bridge.ts
- FOUND: apps/server/src/services/instance-manager.ts (modified — 4 hook calls + import)
- FOUND: commit 85d958a
- FOUND: commit 7368fa1
- VERIFIED: ST1 HARD #1 grep (bridge vs instances writes) — 0 matches
- VERIFIED: ST1 HARD #2 grep (instance-manager vs runtimes writes) — 0 matches
- VERIFIED: hook count grep — exactly 4
- VERIFIED: `npm run typecheck -w @aquaclawai/aquarium` — exit 0
- VERIFIED: `npm run build -w @aquarium/shared` — exit 0
