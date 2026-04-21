---
phase: 20
plan: 03
subsystem: task-dispatch/hosted-orphan-sweep
tags:
  - hosted-driver
  - boot-cleanup
  - task-dispatch
  - server-core
one_liner: "One-shot boot sweep failOrphanedHostedTasks flips hosted_instance tasks in dispatched/running to failed with reason 'hosted-orphan-on-boot'; wired as Step 9b in server-core before task-reaper (9c) and the hosted-task worker (9d)."
dependency_graph:
  requires:
    - "20-01 — gateway stream hook (registerChatStreamListener) via 20-02"
    - "20-02 — startHostedTaskWorker / stopHostedTaskWorker lifecycle"
    - "16 — runtimeBridgeReconcile (Step 9a, runtimes.hosted_instance mirror)"
    - "18 — startTaskReaper (Step 9c, generic stale-task cleanup)"
  provides:
    - "failOrphanedHostedTasks(dbOverride?) — one-shot boot cleanup (HOSTED-04)"
    - "Step 9b wire-up in server-core.ts (pre-reaper hosted orphan sweep)"
    - "Step 9d wire-up in server-core.ts (hosted-task worker start)"
  affects:
    - "apps/server/src/task-dispatch/hosted-orphan-sweep.ts (new 141-line module)"
    - "apps/server/src/server-core.ts (+36 lines for imports + Step 9b/9d)"
    - "apps/server/tests/unit/hosted-orphan-sweep.test.ts (new 336-line test file, 5 tests)"
tech_stack:
  added: []
  patterns:
    - "Broadcast-per-SELECT-row (iterates SELECT result directly, not a filter-by-index subset — Blocker-3 fix)"
    - "ST6 race guard on UPDATE mirrors task-reaper.ts (whereIn status dispatched|running)"
    - "Test-only between-SELECT-and-UPDATE hook to deterministically exercise ST6 race"
    - "Inline try/catch around sweep so failure degrades to reaper-fallback rather than blocking server.listen"
key_files:
  created:
    - "apps/server/src/task-dispatch/hosted-orphan-sweep.ts"
    - "apps/server/tests/unit/hosted-orphan-sweep.test.ts"
  modified:
    - "apps/server/src/server-core.ts"
decisions:
  - "Broadcast iterates ALL SELECT rows (benign over-broadcast at boot) rather than filter-by-index: filter-by-index is position-based and has no guaranteed relationship to which rows the UPDATE guard actually transitioned (Blocker-3 per 20-03-PLAN.md revision). Over-broadcast is benign at boot because no WS clients are connected (HTTP has not yet started listening)."
  - "Added test-only __setBetweenSelectAndUpdateHookForTests__ so Test 3 can deterministically simulate the ST6 race between SELECT and UPDATE. Without this hook, a pre-SELECT UPDATE would cause the SELECT to filter out the racing row, collapsing the scenario to rows.length === 2 and preventing over-broadcast verification."
  - "Step 9b sweep is wrapped in a local try/catch that logs-and-continues: a failing boot sweep must never block server.listen. The generic task-reaper (Step 9c) will eventually catch any missed rows with the wrong error — acceptable fallback rather than server-failure."
  - "Step 9d startHostedTaskWorker takes no argument in production (uses default DB). Same pattern as startTaskReaper."
  - "Kept the existing Phase 18 comment block structure but replaced the outdated note ('Phase 20 will later slot in Step 9b and Step 9d') with a final-state recap of 9a→9b→9c→9d→9e so future readers see the canonical boot order in one place."
metrics:
  duration_seconds: 319
  completed_at: "2026-04-17T07:14:48Z"
requirements_completed:
  - HOSTED-04
---

# Phase 20 Plan 03: Boot Orphan Sweep + Server-Core Wiring Summary

Shipped `apps/server/src/task-dispatch/hosted-orphan-sweep.ts` — a one-shot boot sweep that fails all hosted-instance tasks stuck in `dispatched`/`running` with reason `'hosted-orphan-on-boot'`, wired as Step 9b in `server-core.ts` before the task-reaper (9c) and the hosted-task worker (9d). HOSTED-04 is satisfied; Phase 20 requirement coverage is now complete (HOSTED-01..06 all green across plans 20-01 / 20-02 / 20-03).

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `apps/server/src/task-dispatch/hosted-orphan-sweep.ts` | NEW module — `failOrphanedHostedTasks` + test hooks | +167 |
| `apps/server/src/server-core.ts` | Import + Step 9b sweep + Step 9d worker + boot-order recap comment | +36 / -2 |
| `apps/server/tests/unit/hosted-orphan-sweep.test.ts` | NEW 5-test file covering HOSTED-04 behavior | +336 |

## Exports Added

```typescript
// apps/server/src/task-dispatch/hosted-orphan-sweep.ts
export interface OrphanSweepResult {
  failed: number;
  rows: Array<{ taskId: string; issueId: string; workspaceId: string }>;
}

export async function failOrphanedHostedTasks(
  dbOverride?: Knex,
): Promise<OrphanSweepResult>;

// Test-only hooks
export function __setBroadcastForTests__(fn: typeof broadcast): void;
export function __resetBroadcastForTests__(): void;
export function __setBetweenSelectAndUpdateHookForTests__(
  fn: ((kx: Knex) => Promise<void>) | null,
): void;
export function __resetBetweenSelectAndUpdateHookForTests__(): void;
```

## Boot-Order Verification

```text
$ awk '/failOrphanedHostedTasks\(\)/{a=NR} /startTaskReaper\(\)/{b=NR} END{ print "9b:", a; print "9c:", b }' apps/server/src/server-core.ts
9b: 331
9c: 346

$ awk '/startTaskReaper\(\)/{a=NR} /startHostedTaskWorker\(\)/{b=NR} /startRuntimeOfflineSweeper\(\)/{c=NR} END{ print "9c:", a; print "9d:", b; print "9e:", c }' apps/server/src/server-core.ts
9c: 346
9d: 353
9e: 357
```

9a → 9b → 9c → 9d → 9e ordering is preserved. The awk line-number ordering assertions from the plan's acceptance criteria both exit 0.

## Manual Boot-Test Log Excerpt

Fresh data dir (`/tmp/aquarium-phase20-boot`), no orphans present:

```
[gateway-relay] Event relay started
[task-reaper] started (5min dispatched / 2.5h running thresholds, 30s sweep interval)
[hosted-task-worker] started (2s tick interval)
[offline-sweeper] started (90s heartbeat window, 30s sweep interval)
Server listening on port 3999
```

Step 9b (`failOrphanedHostedTasks`) ran before `startTaskReaper` but emits no `console.log` when there are no orphan rows — guarded by `if (failed > 0)`. This is the intended behavior: a clean boot is silent. The log order `task-reaper → hosted-task-worker → offline-sweeper` confirms 9c → 9d → 9e is preserved.

## Regression Evidence

```text
$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/hosted-orphan-sweep.test.ts
✔ Test 1: hosted in-flight rows flip to failed with correct reason; daemon + queued rows untouched (46.13ms)
✔ Test 2: empty table — no matching rows, no throw, returns {failed: 0} (15.92ms)
✔ Test 3: broadcasts fire per SELECTed row — ST6 benign over-broadcast at boot (14.82ms)
✔ Test 4: ST6 race guard — single row flipped to completed pre-sweep stays completed (19.89ms)
✔ Test 5: reason string — error column is exactly hosted-orphan-on-boot (16.39ms)
ℹ tests 5   pass 5   fail 0

$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts
ℹ tests 119   pass 119   fail 0
  (= 114 prior from 20-02 suite + 5 new from 20-03 suite)

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium
(both exit 0)
```

## Acceptance-Criteria Grep Check

```text
File: apps/server/src/task-dispatch/hosted-orphan-sweep.ts

  export async function failOrphanedHostedTasks           → 1   PASS
  'hosted-orphan-on-boot'                                 → 3   PASS (≥1)
  r.kind ... hosted_instance                              → 2   PASS (≥1)
  whereIn('q.status'|'status', ['dispatched','running'])  → 3   PASS (≥2 — SELECT + UPDATE guard)
  task:failed                                             → 4   PASS (≥1)
  filter((_, idx) => idx < failed)                        → 0   PASS (Blocker-3 anti-pattern absent)
  benign                                                  → 4   PASS (≥1 — documents over-broadcast)
  import.*instance-manager|updateStatus                   → 0   PASS (ST5 invariant)
  \bany\b|@ts-ignore|@ts-expect-error                     → 0   PASS

File: apps/server/src/server-core.ts

  failOrphanedHostedTasks                                 → 3   PASS (≥2 — import + call + comment)
  startHostedTaskWorker                                   → 3   PASS (≥2 — import + call + comment)
  import.*hosted-orphan-sweep                             → 1   PASS
  import.*hosted-task-worker                              → 1   PASS
  awk 9b<9c ordering exit code                            → 0   PASS
  awk 9c<9d<9e ordering exit code                         → 0   PASS
```

## Test Breakdown — 5 Tests

| # | Name | Purpose |
|---|------|---------|
| 1 | Happy path — hosted in-flight flips; daemon + queued untouched | HOSTED-04 scope assertion (hosted_instance JOIN + status filter + daemon isolation + queued preservation) |
| 2 | Empty table — {failed: 0}, no throw | Idempotency / empty-case robustness |
| 3 | Broadcast-per-SELECT-row with ST6 benign over-broadcast | Blocker-3 fix verification: 3 SELECTed rows → `failed = 2` after race guard → 3 broadcasts (over-broadcast for the concurrently-completed row documented as benign at boot) |
| 4 | ST6 race guard — pre-flip to 'completed' stays 'completed' | UPDATE guard correctness when SELECT status filter itself excludes the racing row |
| 5 | Reason string is exactly 'hosted-orphan-on-boot' | HOSTED-04 literal string contract (grep-asserted in acceptance criteria) |

### Test 3 — How the ST6 Race Is Simulated

The ST6 race requires a concurrent writer to mutate a row's state *between* the SELECT and the UPDATE inside `failOrphanedHostedTasks`. A pre-SELECT UPDATE would simply be filtered out by the SELECT's `whereIn('q.status', ['dispatched','running'])` and the over-broadcast scenario would never arise.

Solution: added a test-only hook `__setBetweenSelectAndUpdateHookForTests__` that `failOrphanedHostedTasks` awaits between the two statements. Production code leaves the hook null and pays zero overhead. Test 3 sets the hook to a callback that flips `t3` to `'completed'`, then asserts:

1. SELECT returns 3 rows (hook not yet fired).
2. UPDATE guard transitions only `t1` + `t2` because `t3.status = 'completed'` now. `result.failed === 2`.
3. `t3` row stays `'completed'` (benign — the concurrent "writer" won).
4. Broadcast count === 3 (one per SELECTed row — the over-broadcast for `t3` carries `t3`'s `taskId` but is dropped by the empty client map at boot).

This is a direct verification of the Blocker-3 fix: filter-by-index would broadcast to row positions, which has no guaranteed relationship to which rows the UPDATE actually transitioned. Broadcast-by-SELECT-result is identity-safe and the only extra cost is the benign over-broadcast at boot.

## Threat Model Touch Checks

All mitigations from 20-03-PLAN.md `<threat_model>` are enforced by the implementation:

| Threat ID | Mitigation | Enforcement |
|-----------|------------|-------------|
| T-20-16 (boot ordering) | Step 9b runs BEFORE 9c | awk line-order checks exit 0; boot log shows `task-reaper → hosted-task-worker → offline-sweeper` (9b is silent on clean DB but source file order places it before `startTaskReaper()`) |
| T-20-17 (ST6 race guard on UPDATE) | `whereIn('status', ['dispatched','running'])` on UPDATE | Tests 3 + 4 |
| T-20-18 (ST5 instance-status invariant) | No writes to `instances`, no import of instance-manager | `grep -cE "import.*instance-manager\|updateStatus" hosted-orphan-sweep.ts` = 0 |
| T-20-19 (DoS — sweep failure blocks boot) | Local try/catch around `failOrphanedHostedTasks()` in server-core | Inner catch logs warn and continues to `startTaskReaper()` |
| T-20-20 (reason string drift) | Literal `'hosted-orphan-on-boot'` | Test 5 + grep |
| T-20-21 (daemon tasks mis-reaped) | JOIN filter `r.kind='hosted_instance'` | Test 1 (daemon task stays 'dispatched') |
| T-20-22 (broadcast cross-row data leak) | Iterate SELECT rows directly; each broadcast carries its own row's taskId/issueId | Test 3 asserts per-broadcast shape |

## Phase 20 Requirement Coverage

With this plan shipped, Phase 20 requirement coverage is complete:

| Req | Coverage | Location |
|-----|----------|----------|
| HOSTED-01 | Tick iterates online hosted runtimes | 20-02 `hosted-task-worker.ts` |
| HOSTED-02 | chat.send dispatch with 30s RPC-accept + 120s completion | 20-02 `hosted-task-worker.ts` |
| HOSTED-03 | Streaming chat events → task_message rows | 20-01 `registerChatStreamListener` + 20-02 `translatePartsToMessages` |
| HOSTED-04 | Boot sweep fails orphaned hosted tasks | **20-03 `failOrphanedHostedTasks`** |
| HOSTED-05 | Ignored-field WARN | 20-02 `warnIgnoredFields` |
| HOSTED-06 | Gateway disconnect = silent tick skip | 20-02 `isGatewayConnected` gate |

## Deviations from Plan

**Deviation 1 (Rule 3 — blocking issue): Added `__setBetweenSelectAndUpdateHookForTests__` hook**

The plan's Test 3 sketched the ST6 race scenario with a pre-sweep UPDATE to flip `t3` to `'completed'`, then asserted `failed === 2` AND `broadcast count === 3`. Without a hook that fires between SELECT and UPDATE, the pre-sweep UPDATE is filtered out by the SELECT's own status filter, so `rows.length === 2` and the broadcast count can never reach 3. The over-broadcast scenario the plan wanted to exercise is only reachable if the row transition happens *after* the SELECT returns.

Fix: added a narrow, guarded test hook (`betweenSelectAndUpdateHook`, default `null`, runs as a no-op in production) that `failOrphanedHostedTasks` awaits between the SELECT and UPDATE. Test 3 installs a hook that flips `t3` and asserts the 3-broadcast over-broadcast outcome the plan specified.

Why Rule 3 (not an architectural change the user needs to approve): the plan's expectation (3 SELECTed rows, 2 UPDATEd rows, 3 broadcasts) is physically unreachable without this hook. The hook is dead code in production (zero cost — a single `if` check against `null`) and the production behavior is unchanged. Test 4 additionally verifies the non-hooked path where the flip happens before SELECT (Test 4 returns `failed === 0` which is correct for the pre-SELECT-flip case).

**No other deviations** — the plan's design was followed end-to-end.

## Known Stubs

None. `failOrphanedHostedTasks` is a complete one-shot boot function: SELECT + optional race hook + UPDATE with ST6 guard + broadcast + log. Both `dbOverride` (used by tests) and the default `db` singleton (used by server-core) are exercised.

## Self-Check: PASSED

- File exists: `apps/server/src/task-dispatch/hosted-orphan-sweep.ts` — FOUND
- File exists: `apps/server/tests/unit/hosted-orphan-sweep.test.ts` — FOUND
- File exists: `.planning/phases/20-hosted-instance-driver/20-03-SUMMARY.md` — (written by this step)
- Commit exists: `6158c04` (Task 1 RED) — FOUND
- Commit exists: `7446714` (Task 1 GREEN) — FOUND
- Commit exists: `93be073` (Task 2 server-core wiring) — FOUND
- All 5 new tests pass — VERIFIED
- Full 119-test regression passes (114 prior + 5 new) — VERIFIED
- Typecheck clean (`npm run typecheck -w @aquaclawai/aquarium` exit 0) — VERIFIED
- Boot-order awk checks pass — VERIFIED
- Blocker-3 anti-pattern grep returns 0 — VERIFIED
- Benign-over-broadcast documentation grep returns ≥1 — VERIFIED (4 mentions)
- No `any` / `@ts-ignore` / `@ts-expect-error` / `process.env` introduced — VERIFIED
- ST5 invariant grep returns 0 — VERIFIED
