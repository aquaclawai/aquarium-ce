---
phase: 18-task-queue-dispatch
plan: 03
subsystem: task-dispatch
tags: [task-queue, stale-reaper, setInterval, sqlite-julianday, st6-race-safety, boot-wiring]
dependency-graph:
  requires:
    - Phase 18 Plan 01 (withImmediateTx, claimTask, startTask, seedTask test harness)
    - Phase 16 Plan 03 (offline-sweeper.ts template shape)
    - Phase 15 (migration 007 — agent_task_queue schema + status trigger)
  provides:
    - startTaskReaper / stopTaskReaper (lifecycle)
    - reapOnce(dbOverride?) (test hook — direct call against seeded stale rows)
    - SQLite `julianday()` normalisation pattern for ISO vs CURRENT_TIMESTAMP comparisons
  affects:
    - Phase 18 Plan 04 (batcher + reaper share the same setInterval + per-tick .catch shape)
    - Phase 20 (will add Step 9b fail-in-flight hosted tasks on boot + Step 9d hosted worker loop next to 9c reaper)
    - Phase 21 BACKEND-07 (unit-test template for stale-row sweepers)
tech-stack:
  added: []
  patterns:
    - "julianday(<col>) < julianday(<iso>) — format-agnostic SQLite timestamp comparison across ISO-8601 and CURRENT_TIMESTAMP"
    - "setInterval sweeper with initial sweep on start + per-tick .catch + idempotent start/stop (offline-sweeper clone shape)"
    - "Module-level interval handle as idempotency guard (private let; never exported)"
    - "Optional dbOverride on both reapOnce() and startTaskReaper() so unit tests can avoid the production singleton connection"
key-files:
  created:
    - apps/server/src/task-dispatch/task-reaper.ts
  modified:
    - apps/server/src/server-core.ts
    - apps/server/tests/unit/task-reaper.test.ts
key-decisions:
  - "julianday() normalisation instead of raw lexicographic string comparison — the existing task-queue-store writes timestamps via Knex `fn.now()` (CURRENT_TIMESTAMP `YYYY-MM-DD HH:MM:SS`), but seedTask and new reaper UPDATEs use `new Date().toISOString()`. Space (0x20) sorts before T (0x54), so lexicographic `<` would flag freshly-started running rows as stale and clobber live daemon transitions (ST6). julianday() converts both formats to a numeric day count and compares safely."
  - "Thresholds hardcoded (DISPATCH_STALE_MS=5min, RUNNING_STALE_MS=2.5h, SWEEP_INTERVAL_MS=30s) — 18-RESEARCH §Reaper Design recommended this for Phase 18. Config-plumbed override deferred to a follow-up if a real user needs longer running tasks (>2.5h for complex codebases)."
  - "reapOnce and startTaskReaper both accept optional dbOverride — follows Phase 18-01's Knex-override pattern, lets the unit test idempotency test use a fixture DB instead of pinning the production singleton for ~30s pool idle."
  - "Wire at server-core Step 9c (between 9a 10s runtime-bridge loop and 9e offline-sweeper) — matches 18-RESEARCH SQ4 recommendation so the reaper is live BEFORE server.listen and any stale task from a previous server crash is being reaped when the first daemon registers."
  - "Broadcast task:failed per reaped row AFTER each UPDATE autocommits — never inside a transaction (PITFALLS §SQ5). Uses the stale row's workspace_id so isolation matches Phase 17's issue:* broadcast pattern."
patterns-established:
  - "Stale-row sweeper pattern: SELECT candidates → UPDATE with .andWhere status guard → broadcast per-row after commit. Applies to future 'cleanup daemon' modules (e.g. Phase 20 hosted-task boot failer)."
  - "Race guard: .andWhere('status', <expected>) on the UPDATE path — if a concurrent writer already transitioned the row under pool=1, the UPDATE affects 0 rows and the sweeper makes no noise."
  - "Idempotency guard for setInterval modules: module-level `let intervalHandle: ReturnType<typeof setInterval> | null` checked at start; matches offline-sweeper.ts exactly."
requirements-completed:
  - TASK-04
duration: ~20min
completed: 2026-04-16
---

# Phase 18 Plan 03: Stale-Task Reaper Summary

**30s-tick sweeper fails tasks stuck in `dispatched`>5min (daemon crashed between claim and start) or `running`>2.5h (daemon crashed mid-task), wired at server-core Step 9c with a ST6 race guard and julianday() timestamp normalisation so daemon-side transitions are never clobbered.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-16T22:40:00Z
- **Completed:** 2026-04-16T23:00:00Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 2

## Accomplishments

- `task-reaper.ts` exports `reapOnce(db?)` / `startTaskReaper(db?)` / `stopTaskReaper()`, cloned from `offline-sweeper.ts` shape (30s setInterval, initial sweep on start, per-tick `.catch`, idempotent start/stop via module-level handle).
- Race safety: every UPDATE guarded by `.andWhere('status', <stale>)` AND `julianday(<col>) < julianday(<cutoff>)` — under pool=1 serialisation, a daemon's legitimate transition commits first and the reaper's WHERE no longer matches (0 rows affected).
- Server-core Step 9c wiring (insert between Step 9a 10s runtime-bridge loop and Step 9e offline-sweeper), so the reaper is live before `server.listen`.
- 5 passing unit tests: dispatched>5min + running>2.5h threshold correctness, terminal-row safety, start/stop idempotency + initial sweep, ST6 race safety (daemon wins → row stays `running`).

## Exported API

```typescript
// apps/server/src/task-dispatch/task-reaper.ts

export async function reapOnce(
  dbOverride?: Knex,
): Promise<{ dispatchedFailed: number; runningFailed: number }>;

export function startTaskReaper(dbOverride?: Knex): void;

export function stopTaskReaper(): void;
```

## Thresholds

| Constant | Value | Rationale |
|---|---|---|
| `DISPATCH_STALE_MS` | `5 * 60_000` (5 min) | Daemon that claimed but never called startTask — typically a crash between claim and first RPC. |
| `RUNNING_STALE_MS`  | `2.5 * 60 * 60_000` (2.5 h) | Daemon crashed mid-task or child process deadlocked. 2.5h is TASK-04's default; long tasks can exceed 2h. |
| `SWEEP_INTERVAL_MS` | `30_000` (30 s) | Matches offline-sweeper. Worst-case detection latency = threshold + 30s (acceptable). |

## server-core.ts Boot-Order Delta

**Before 18-03:**

```bash
$ grep -n "runtimeBridgeReconcile\|startTaskReaper\|startRuntimeOfflineSweeper" apps/server/src/server-core.ts
19:import { reconcileFromInstances as runtimeBridgeReconcile } from './task-dispatch/runtime-bridge.js';
20:import { startRuntimeOfflineSweeper } from './task-dispatch/offline-sweeper.js';
282:      await runtimeBridgeReconcile();
292:      runtimeBridgeReconcile().catch(...);
299:    startRuntimeOfflineSweeper();
```

**After 18-03:**

```bash
$ grep -n "runtimeBridgeReconcile\|startTaskReaper\|startRuntimeOfflineSweeper" apps/server/src/server-core.ts
19:import { reconcileFromInstances as runtimeBridgeReconcile } from './task-dispatch/runtime-bridge.js';
20:import { startRuntimeOfflineSweeper } from './task-dispatch/offline-sweeper.js';
21:import { startTaskReaper } from './task-dispatch/task-reaper.js';
282:      await runtimeBridgeReconcile();
292:      runtimeBridgeReconcile().catch(...);
304:    startTaskReaper();
308:    startRuntimeOfflineSweeper();
```

Line 304 (Step 9c `startTaskReaper()`) sits between line 292 (Step 9a reconcile inside the 10s `setInterval`) and line 308 (Step 9e `startRuntimeOfflineSweeper()`). Boot order invariant satisfied:

- Step 9a initial + loop (lines 282, 292) → runs first, seeds the runtime-bridge mirror
- **Step 9c reaper (line 304)** — NEW
- Step 9e offline-sweeper (line 308) → heartbeat-based daemon status flipper
- `server.listen` (line 309+) — HTTP accept AFTER all timers are live

Phase 20 will later insert Step 9b (fail-in-flight hosted tasks on boot) adjacent to Step 9a, and Step 9d (hosted worker loop) between 9c and 9e.

## Test Coverage

`npx tsx --test apps/server/tests/unit/task-reaper.test.ts` → 5 pass / 0 fail / duration ~1.5s

| # | Test | Requirement | What it proves |
|---|------|-------------|----------------|
| 1 | `reapOnce: fails tasks dispatched > 5 min` | TASK-04 | Stale dispatched_at (6min ago) → status=failed, error='Reaper: dispatched > 5 min without start', completed_at set. Within-window task (3min ago) untouched. |
| 2 | `reapOnce: fails tasks running > 2.5h` | TASK-04 | Stale started_at (3h ago) → status=failed, error='Reaper: running beyond configured timeout'. Within-window task (1h ago) untouched. |
| 3 | `reapOnce: leaves terminal tasks alone` | TASK-04 | Ancient timestamps with status completed/failed/cancelled — zero rows changed. |
| 4 | `startTaskReaper: idempotent` | TASK-04 | Two start() calls → one interval. Initial sweep on start reaps a pre-seeded stale row. stop/start cycle works. stopTaskReaper() itself is idempotent. |
| 5 | `ST6 race safety: daemon startTask mid-tick is not clobbered` | TASK-04 / PITFALLS §ST6 | Seed stale dispatched row → call startTask (now running) → call reapOnce → row stays running, no reaper error text written. |

## Files Created/Modified

- `apps/server/src/task-dispatch/task-reaper.ts` (created, 167 lines) — reaper module with reapOnce/startTaskReaper/stopTaskReaper + docstrings + ST6 race guard.
- `apps/server/src/server-core.ts` (modified, +9 lines) — added `startTaskReaper` import (line 21) and Step 9c call site (line 304).
- `apps/server/tests/unit/task-reaper.test.ts` (replaced stub, 230 lines) — 5 real tests covering thresholds, terminal safety, idempotency, ST6 race.

## Decisions Made

1. **julianday() over lexicographic string comparison.** The existing `task-queue-store.ts` writes timestamps via Knex `fn.now()` which SQLite renders as `YYYY-MM-DD HH:MM:SS`. Test seeds and this reaper write ISO-8601. The two formats do NOT string-sort correctly against each other (space vs T). julianday() normalises both to a numeric day-count. Documented inline in task-reaper.ts.
2. **Thresholds hardcoded.** Per 18-RESEARCH §Reaper Design, env-var overrides deferred to a follow-up. Simpler boot path, one fewer config surface, aligns with offline-sweeper.ts precedent.
3. **reapOnce and startTaskReaper both accept optional dbOverride.** Tests can seed a throwaway SQLite fixture and exercise the interval-driven `initial sweep` without pinning the production singleton pool for 30s after tests finish.
4. **Broadcast AFTER each UPDATE autocommits.** Single-statement UPDATEs autocommit before returning. The for-loop that emits `task:failed` runs strictly after the write is durable (PITFALLS §SQ5).
5. **Reaped UPDATE sets completed_at + updated_at to ISO via `new Date().toISOString()` rather than `fn.now()`.** Consistent with the timestamp format used by test seeds; also simplifies the reaper's own WHERE clause on any future backward-reference.

## Deviations from Plan

### Rule 1 — Fix bug: lexicographic timestamp comparison was unsound

**Found during:** Task 1 (first test run — ST6 race safety test failed with `{ dispatchedFailed: 0, runningFailed: 1 }` when expected `{ 0, 0 }`).

**Issue:** The plan's example reaper query used `.where('dispatched_at', '<', dispatchCut)` with raw string comparison. This works when both sides are ISO-8601 but fails when the column was written via Knex `fn.now()` (SQLite CURRENT_TIMESTAMP format, space-separated, no timezone marker). The space character (0x20) sorts BEFORE T (0x54), so a row written at `'2026-04-16 22:44:00'` by the production `startTask` appeared "less than" an ISO cutoff of `'2026-04-16T20:14:00.123Z'` — flagging live running rows as stale and clobbering daemon transitions.

**Fix:** Replaced `.andWhere('dispatched_at', '<', dispatchCut)` with `.andWhereRaw('julianday(dispatched_at) < julianday(?)', [dispatchCut])` (and same for `started_at`). `julianday()` normalises both ISO-8601 and CURRENT_TIMESTAMP formats to a numeric day count and compares safely. Added inline commentary explaining the pitfall.

**Files modified:** `apps/server/src/task-dispatch/task-reaper.ts` lines 55-76.

**Verification:** Test 5 (ST6 race safety) now passes — daemon startTask that wins the race leaves the row in `running` state with no reaper error text.

**Committed in:** `a2882b8` (feat(18-03): add stale-task reaper).

### Rule 3 — Fix blocking issue: test isolation for idempotency test

**Found during:** Task 1 (tests hung for 30s+ instead of exiting).

**Issue:** The plan's idempotency test called `startTaskReaper()` which fired `reapOnce()` against the app singleton `db`. The singleton's Knex pool is `(min:1, max:1, idleTimeoutMillis:30_000)`, so the node process would not exit for 30s after the last query — making tests unusably slow in CI.

**Fix:** Added optional `dbOverride?: Knex` parameter to `startTaskReaper()` (same pattern as `reapOnce` and every `task-queue-store.ts` service function). Updated the idempotency test to pass `ctx.db`. Production callers (`server-core.ts`) invoke with no arguments and use the default.

**Files modified:** `apps/server/src/task-dispatch/task-reaper.ts` (startTaskReaper signature), `apps/server/tests/unit/task-reaper.test.ts` (test uses fixture DB).

**Verification:** Full test suite runs in ~1.5s total; no hanging processes after exit.

**Committed in:** `a2882b8` (same task 1 commit — fix applied before GREEN landed).

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking).
**Impact on plan:** Both fixes necessary for correctness. The julianday() fix prevents a silent production bug that would have reaped live running tasks on every tick. The dbOverride fix is a test-ergonomics cleanup; production surface unchanged. No scope creep.

## Issues Encountered

- First test run (after RED commit) showed ST6 race test failing because of the lexicographic-comparison bug described under deviations.
- Second test run hung because the idempotency test pinned the production SQLite pool; fixed by injecting the override.
- Both issues resolved before the feat commit (`a2882b8`) landed.

## Task Commits

1. **Task 1 RED: failing tests** — `31f9274` (test)
2. **Task 1 GREEN: reaper module + julianday fix + dbOverride** — `a2882b8` (feat)
3. **Task 2: server-core wiring at Step 9c** — `cb41f86` (feat)

## Authentication Gates

None encountered. No auth / network / third-party credentials required.

## Verification

```bash
$ grep -c "export function startTaskReaper(" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "export function stopTaskReaper(" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "export async function reapOnce(" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "DISPATCH_STALE_MS = 5 \* 60_000" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "RUNNING_STALE_MS  = 2.5 \* 60 \* 60_000" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "SWEEP_INTERVAL_MS = 30_000" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "andWhere('status', 'dispatched')" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "andWhere('status', 'running')" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "broadcast(" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "'task:failed'" apps/server/src/task-dispatch/task-reaper.ts
1
$ grep -c "import { startTaskReaper }" apps/server/src/server-core.ts
1
$ grep -c "startTaskReaper();" apps/server/src/server-core.ts
1
$ grep -c "startRuntimeOfflineSweeper();" apps/server/src/server-core.ts
1

$ npx tsx --test apps/server/tests/unit/task-reaper.test.ts
# 5 pass / 0 fail / 0 todo (duration 1466ms)

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run build -w @aquaclawai/aquarium
# exit 0
```

## Next Phase Readiness

- TASK-04 is satisfied end-to-end: stale rows are reaped with race-safe UPDATEs + broadcasts, threshold + interval hardcoded per 18-RESEARCH recommendation, server-core wiring is in place.
- No blockers for Plan 18-04 (final phase glue) or Phase 19 (daemon HTTP routes). Phase 19 will consume `isTaskCancelled` (from 18-01) alongside this reaper's cleanup of abandoned claims.
- Phase 20 will insert Step 9b (fail-in-flight hosted tasks on boot) and Step 9d (hosted worker loop) adjacent to 9c; the current wiring leaves clean seams for that.

## Self-Check

- `apps/server/src/task-dispatch/task-reaper.ts` — FOUND
- `apps/server/src/server-core.ts` — MODIFIED (import line 21, call site line 304)
- `apps/server/tests/unit/task-reaper.test.ts` — FOUND (5 real tests, 0 todos)
- Commit `31f9274` — FOUND (`git log --oneline --all | grep 31f9274`)
- Commit `a2882b8` — FOUND
- Commit `cb41f86` — FOUND
- `grep -c "julianday" apps/server/src/task-dispatch/task-reaper.ts` = 4 (ISO/CURRENT_TIMESTAMP normalisation present — 2 WHERE predicates × 2 usages each)
- `grep -c "startTaskReaper" apps/server/src/server-core.ts` = 2 (1 import + 1 call)
- `npx tsx --test apps/server/tests/unit/task-reaper.test.ts` → 5 pass / 0 fail
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0

## Self-Check: PASSED

---
*Phase: 18-task-queue-dispatch*
*Completed: 2026-04-16*
