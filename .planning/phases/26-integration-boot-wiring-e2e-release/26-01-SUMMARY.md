---
phase: 26-integration-boot-wiring-e2e-release
plan: 01
subsystem: task-dispatch/boot-wiring
tags: [boot-sequence, observability, regression-test, rel-02]
requires:
  - apps/server/src/task-dispatch/runtime-bridge.ts
  - apps/server/src/task-dispatch/hosted-orphan-sweep.ts
  - apps/server/src/task-dispatch/task-reaper.ts
  - apps/server/src/task-dispatch/hosted-task-worker.ts
  - apps/server/src/task-dispatch/offline-sweeper.ts
provides:
  - "[boot] 9a..9e observable log markers (grep-anchored) in server-core startup"
  - "node --test regression asserting source-order of 9a<9b<9c<9d<9e<server.listen"
affects:
  - apps/server/src/server-core.ts
tech_stack_added: []
tech_stack_patterns:
  - "Hermetic unit tests that assert source-order of boot-time console.log markers (no server spawn, no DB)"
key_files_created:
  - apps/server/tests/unit/boot-sequence.test.ts
key_files_modified:
  - apps/server/src/server-core.ts
decisions:
  - "Markers fire unconditionally (even on warned failure) so the [boot] grep anchor is present on partial-success boots"
  - "[boot] 9b marker omits failed=<n> suffix; the existing [startup] line carries the count when non-zero"
  - "Test reads SOURCE file rather than booting a real server — keeps the regression test hermetic; the @integration spec covers runtime capture"
  - "T-26-01-06 upgrade path documented inline: if boot ever parallelizes via Promise.all, upgrade test to capture stdout"
metrics:
  duration_min: 4
  completed_date: "2026-04-18"
  tasks_completed: 2
  files_changed: 2
---

# Phase 26 Plan 01: Integration Boot Wiring Observability Summary

## One-liner

Locked the v1.4 boot sequence with five grep-anchored `[boot] 9a..9e` console.log markers in `server-core.ts` and shipped a hermetic `node --test` regression asserting the source-order invariant `9a < 9b < 9c < 9d < 9e < server.listen`, satisfying REL-02.

## Changes

### server-core.ts instrumentation (Task 1 — commit `f355a06`)

Five `console.log('[boot] 9X ...')` calls inserted, one per boot step, preserving all existing code paths (no reordering, no new imports):

| Marker | Source line | Fires after                                     |
| ------ | ----------- | ----------------------------------------------- |
| 9a     | 316         | awaited `runtimeBridgeReconcile()` try/catch    |
| 9b     | 348         | awaited `failOrphanedHostedTasks()` try/catch   |
| 9c     | 355         | synchronous `startTaskReaper()`                 |
| 9d     | 372         | synchronous `startHostedTaskWorker()`           |
| 9e     | 377         | synchronous `startRuntimeOfflineSweeper()`      |

Updated the boot-order recap comment block (lines 379-386) to cite the new grep anchors.

`server.listen(config.port, ...)` remains at line 396, strictly AFTER all five markers.

### Boot-sequence regression test (Task 2 — commit `d94b2b9`)

Created `apps/server/tests/unit/boot-sequence.test.ts` (93 lines) with two hermetic sub-tests:

1. **Source-order assertion** — reads `server-core.ts`, locates each `console.log('[boot] 9X ...')` line by regex, asserts strict ascending line numbers and that all five precede `server.listen(config.port, ...)`.
2. **Exactly-once assertion** — each `[boot] 9X` console.log appears exactly once (the recap comment uses identical strings but NOT inside `console.log(...)`, so it's excluded by the regex anchor).

No imports from production source (`../../src/*`) — the test is a pure string-level lint against the source file, chosen over spawning a real server because the @integration spec (`tests/e2e/daemon-integration.spec.ts`) already covers runtime stdout capture, and the hermetic style avoids migrations + a mock docker engine.

The T-26-01-06 limitation (source-order vs runtime-order divergence under hypothetical `Promise.all` parallelization) is documented in the test file's JSDoc header with the explicit upgrade path.

## Verification Output

### Source-order awk (acceptance criterion)

```text
$ awk '/console.log.*\[boot\] 9a/{if(!a)a=NR} ... /server\.listen\(config\.port/{if(!f)f=NR} END { ... }' apps/server/src/server-core.ts
OK a=316 b=348 c=355 d=372 e=377 listen=396
```

### Unit-test run (acceptance criterion)

```text
$ cd apps/server && npx tsx --test tests/unit/boot-sequence.test.ts
✔ server-core.ts emits [boot] 9a-9e markers in order before server.listen (1.119583ms)
✔ each [boot] 9a-9e marker appears exactly once as a console.log (no duplicates, no comment-only occurrences) (0.240542ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

### Full unit-test suite (no regression)

```text
$ cd apps/server && npx tsx --test 'tests/unit/**/*.test.ts'
ℹ tests 323
ℹ suites 36
ℹ pass 323
ℹ fail 0
```

Baseline from the plan cited 226 tests (21-04 baseline) + 2 new = 228+ required. Actual: 323 pass, 0 fail (additional tests have accumulated since 21-04).

### Typecheck

```text
$ npm run typecheck -w @aquaclawai/aquarium
> tsc --noEmit
# exit 0
```

### No new imports check

```text
$ git diff 8096fad..HEAD -- apps/server/src/server-core.ts | grep -E '^\+import |^\+from '
(empty — no new imports)
```

## Commit Log

| Task | Commit    | Type  | Summary                                                          |
| ---- | --------- | ----- | ---------------------------------------------------------------- |
| 1    | `f355a06` | feat  | add [boot] 9a-9e log markers in server-core.ts                   |
| 2    | `d94b2b9` | test  | add boot-sequence regression test locking 9a-9e order            |

## Deviations from Plan

None — plan executed exactly as written. Zero Rule 1/2/3 auto-fixes, zero Rule 4 checkpoints, zero auth gates.

## Known Stubs

None — both files are fully wired. The markers fire on every boot; the test asserts real source-level invariants.

## Self-Check: PASSED

Files:
- `apps/server/src/server-core.ts` — FOUND, contains 5 new `console.log` markers at lines 316/348/355/372/377.
- `apps/server/tests/unit/boot-sequence.test.ts` — FOUND.

Commits:
- `f355a06` — FOUND in `git log --oneline`.
- `d94b2b9` — FOUND in `git log --oneline`.

All acceptance criteria from the plan satisfied:
- [x] grep-c "console.log.*\[boot\] 9X ..." == 1 for each of 9a-9e.
- [x] awk ordering check prints OK for console.log lines (316 < 348 < 355 < 372 < 377 < 396).
- [x] npm run typecheck exits 0.
- [x] npx tsx --test tests/unit/boot-sequence.test.ts passes both sub-tests.
- [x] Full unit suite passes (323/323 — baseline ≥ 228 comfortably exceeded).
- [x] No new imports in server-core.ts.
- [x] No imports from `../src/...` in the new test file.
- [x] REL-02 requirement satisfied: the boot-order invariant is locked by a regression test.
