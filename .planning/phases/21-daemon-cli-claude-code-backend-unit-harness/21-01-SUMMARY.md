---
phase: 21-daemon-cli-claude-code-backend-unit-harness
plan: 01
subsystem: testing
tags: [node-test, tsx, ndjson, readline, semaphore, fifo, mock-timers, utf-8, stream-json, claude-code, shared-types, tdd]

requires:
  - phase: 15-schema-shared-types
    provides: v14-types.ts append point + export * re-export barrel in packages/shared/src/index.ts
  - phase: 18-task-dispatch
    provides: apps/server/tests/unit/ node:test layout (task-queue.test.ts / task-message-batcher.test.ts style, test-db.ts helper — re-used conventions; DB helpers NOT used here)
  - phase: 19-daemon-rest
    provides: DaemonRegisterRequest/Response types that AgentMessage + DaemonConfigFile are appended next to

provides:
  - AgentMessage discriminated union (5 branches) + DaemonConfigFile interface exported from @aquarium/shared
  - Semaphore class (FIFO bounded concurrency primitive) at apps/server/src/daemon/semaphore.ts
  - escalateKill helper (SIGTERM→SIGKILL with injected-deps test seam) at apps/server/src/daemon/kill-escalation.ts
  - parseNdjson async generator (CRLF + UTF-8 + malformed-line-drop + inactivity watchdog) at apps/server/src/daemon/ndjson-parser.ts
  - Scripted claude-stream-sample.ndjson fixture + fake-claude.js Node stub
  - apps/server scripts.test:unit + test:unit:watch entries (no new runtime deps)
  - Playwright e2e stub tests/e2e/daemon-integration.spec.ts (test.skip tagged @integration)

affects: [21-02-plan, 21-03-plan, 21-04-plan, phase-22-other-backends]

tech-stack:
  added: []
  patterns:
    - "Node-native TDD: tsx --test 'tests/unit/**/*.test.ts' via package.json scripts.test:unit"
    - "Injected-deps test seam (kill-escalation.ts) lets node:test mock.timers drive real timer logic without wall-clock waits"
    - "Async-generator NDJSON parser: readline + for-await + per-line try/catch, never throws on malformed input"
    - "FIFO Semaphore without third-party deps (p-limit rejected): push/shift queue, direct-transfer release"
    - "One-shot release closures with `released` flag for idempotent double-release"

key-files:
  created:
    - apps/server/src/daemon/semaphore.ts (63 LOC)
    - apps/server/src/daemon/kill-escalation.ts (70 LOC)
    - apps/server/src/daemon/ndjson-parser.ts (90 LOC)
    - apps/server/tests/unit/semaphore.test.ts (90 LOC, 7 tests)
    - apps/server/tests/unit/kill-escalation.test.ts (121 LOC, 8 tests)
    - apps/server/tests/unit/ndjson-parser.test.ts (134 LOC, 9 tests)
    - apps/server/tests/unit/fixtures/claude-stream-sample.ndjson (6 lines)
    - apps/server/tests/unit/fixtures/fake-claude.js (54 LOC executable ESM stub)
    - tests/e2e/daemon-integration.spec.ts (Playwright test.skip stub)
  modified:
    - packages/shared/src/v14-types.ts (appended AgentMessage + DaemonConfigFile at lines 213–253, AFTER DaemonRegisterResponse, BEFORE ClaimedTask)
    - apps/server/package.json (scripts.test:unit + scripts.test:unit:watch)

key-decisions:
  - "Use node:test's `mock.timers.enable({ apis: ['setTimeout'] })` (corrected from plan's ['setTimeout','clearTimeout'] — the clear variants are mocked together with their set pair; explicit 'clearTimeout' is not a valid enum value in Node 23's mock.timers API)."
  - "Test for `escalateKill` that uses real-globals default must call the returned `cleanup()` after asserting, otherwise the real 10 s setTimeout pins the Node event loop and drags the single-file test duration to ~10 s."
  - "Zero runtime dependencies added in this plan — commander + execa deferred to Plan 21-02 per RESEARCH §Core additions."
  - "fake-claude.js handles `--hang --version` as an early-exit escape hatch for detect.ts unit tests (Plan 21-02 consumer)."

patterns-established:
  - "Per-primitive source file + matching tests/unit/<name>.test.ts sibling; import via '../../src/daemon/<name>.js' (NodeNext ESM extension)."
  - "TDD commit discipline: test(21-01): RED → feat(21-01): GREEN, one commit pair per primitive."
  - "Watchdog timers use .unref() so the background SIGKILL-escalator never blocks process exit."

requirements-completed: [BACKEND-04, BACKEND-06, BACKEND-07, CLI-04]

duration: 5min
completed: 2026-04-17
---

# Phase 21 Plan 01: Daemon CLI + Claude-Code Backend + Unit Harness — Wave-1 Primitives Summary

**Ships three unit-testable daemon primitives (Semaphore FIFO / escalateKill SIGTERM→SIGKILL / parseNdjson async-generator), the shared AgentMessage + DaemonConfigFile type contracts, and the Wave-0 test scaffolding (fixtures + `scripts.test:unit` + Playwright e2e stub) that every downstream Phase 21 plan consumes.**

## Performance

- **Duration:** ~5 min (wall-clock between first and last commit)
- **Started:** 2026-04-17T10:38:30+02:00 (Task 1 commit)
- **Completed:** 2026-04-17T10:43:37+02:00 (Task 4 GREEN commit)
- **Tasks:** 4/4 complete
- **New test cases:** 24 (7 + 8 + 9 across 3 files)
- **Full unit suite after this plan:** 143/143 pass in 5.4 s
- **Files created:** 9 (3 primitives + 3 tests + 2 fixtures + 1 e2e stub)
- **Files modified:** 2 (shared types append + package.json scripts)

## Accomplishments

- Shared contracts (`AgentMessage` 5-branch union + `DaemonConfigFile` with 13 fields) land before any consumer import → Plans 21-02 / 21-03 / 21-04 can type-check against the final shape with no codebase exploration.
- `Semaphore` proves FIFO bounded concurrency under 100-parallel stress (`maxInFlight ≤ 3` when `max=3`) with zero third-party deps.
- `escalateKill` test-seamed — injected setTimeout/clearTimeout lets `mock.timers.tick(10_000)` drive SIGTERM→SIGKILL in milliseconds, not a real 10-second wall-clock wait (plan's core design constraint met).
- `parseNdjson` handles the four HARD pitfalls (PG7/PG8/PG9/PG10) in 90 LOC; the 100-line mixed-malformed stress test confirms it never throws on adversarial input and the inactivity watchdog fires exactly once under `mock.timers` without real waits.
- Wave-0 scaffolding complete: `npm run test:unit -w @aquaclawai/aquarium` is a single command, 143/143 tests pass in 5.4 s including the 24 new cases, and the Playwright e2e stub is in place for 21-04 to unskip.

## Task Commits

Each task committed atomically with TDD RED → GREEN pairs:

1. **Task 1: Wave-0 scaffolding** — `262a99b` (feat) — shared types + fixtures + package.json script + e2e stub (single commit since Task 1 is scaffolding, no source/test pairing)
2. **Task 2: Semaphore** — RED `2aab589` (test) → GREEN `c92216a` (feat)
3. **Task 3: escalateKill** — RED `106e233` (test) → GREEN `551bd47` (feat)
4. **Task 4: parseNdjson** — RED `3c3807f` (test) → GREEN `76c6a09` (feat)

Total: 7 commits.

## Files Created

| Path | LOC | Purpose |
|---|---:|---|
| `apps/server/src/daemon/semaphore.ts` | 63 | FIFO bounded concurrency (PG1 mitigation, CLI-04) |
| `apps/server/src/daemon/kill-escalation.ts` | 70 | SIGTERM→SIGKILL primitive with injected-deps test seam (PM1, PG3, PG4 mitigation; BACKEND-04) |
| `apps/server/src/daemon/ndjson-parser.ts` | 90 | Line-framed async-generator parser + inactivity watchdog (PG7/PG8/PG9/PG10 mitigation; BACKEND-06) |
| `apps/server/tests/unit/semaphore.test.ts` | 90 | 7 node:test cases (acquire/release/FIFO/stress) |
| `apps/server/tests/unit/kill-escalation.test.ts` | 121 | 8 node:test cases, uses `mock.timers` |
| `apps/server/tests/unit/ndjson-parser.test.ts` | 134 | 9 node:test cases, consumes shipped fixture + mock-timers watchdog test |
| `apps/server/tests/unit/fixtures/claude-stream-sample.ndjson` | 6 | Scripted Claude Code stream-json transcript |
| `apps/server/tests/unit/fixtures/fake-claude.js` | 54 | Executable Node ESM stub, honors `--hang / --delay-ms / --exit-code / --version` |
| `tests/e2e/daemon-integration.spec.ts` | 7 | Playwright stub: `test.skip('@integration daemon full cycle (21-04)', …)` |

## Files Modified

- `packages/shared/src/v14-types.ts` — appended `AgentMessage` discriminated union (5 branches) and `DaemonConfigFile` interface (13 optional fields) between `DaemonRegisterResponse` (line 211) and `ClaimedTask` (line 254). No existing lines touched.
- `apps/server/package.json` — added `scripts.test:unit` (`tsx --test 'tests/unit/**/*.test.ts'`) and `scripts.test:unit:watch`. No new runtime or dev dependencies (tsx already a devDep).

## Pitfall Mitigations

Each OWNED pitfall in this plan's scope cited to file + line:

| Pitfall | Mitigation | Where |
|---|---|---|
| **PG1** — unbounded goroutine-leak equivalent | FIFO `Semaphore` primitive with direct-transfer release + 100-parallel stress test cap | `apps/server/src/daemon/semaphore.ts` line 5 (header comment) + line 33 (`makeOneShotRelease` direct-transfer); verified by `semaphore.test.ts` stress test (lines 69–86) |
| **PG3** — timer cleanup on cancel | `cleanup()` closure clears pending SIGKILL timer + idempotent on second call | `apps/server/src/daemon/kill-escalation.ts` lines 49–56 (`cleanup` fn with `cancelled` flag); verified by `kill-escalation.test.ts` "cleanup function cancels pending SIGKILL" (line 73) |
| **PG4** — exit cancels dropped-signal risk | `child.once('exit', cleanup)` short-circuits the SIGKILL timer | `apps/server/src/daemon/kill-escalation.ts` line 65 (child.once('exit', cleanup)); verified by `kill-escalation.test.ts` "SIGKILL does NOT fire if child exits before graceMs" (line 30) |
| **PG7** — readline with `crlfDelay: Infinity` + `for await` | `createInterface({ input: stream, crlfDelay: Infinity })` + for-await consume | `apps/server/src/daemon/ndjson-parser.ts` line 7 (header PG7 cite) + line 40 (`crlfDelay: Infinity`) + line 72 (`for await (const line of rl)`); verified by `ndjson-parser.test.ts` "CRLF line endings parse correctly" (line 56) |
| **PG8** — backpressure via `for await` + no custom accumulator | for-await naturally propagates backpressure upstream | `apps/server/src/daemon/ndjson-parser.ts` line 8 (header PG8 cite); implicit in the async-generator consumption model |
| **PG9** — UTF-8 multi-byte boundary handling | `stream.setEncoding('utf8')` attaches stateful decoder before readline | `apps/server/src/daemon/ndjson-parser.ts` line 9 (header PG9 cite) + line 38 (`stream.setEncoding('utf8')`); verified by `ndjson-parser.test.ts` "emoji + multi-byte UTF-8 round-trips" (line 47) |
| **PG10** — per-line try/catch, malformed lines dropped not thrown | `try { JSON.parse } catch { onParseError; continue }` | `apps/server/src/daemon/ndjson-parser.ts` line 11 (header PG10 cite) + lines 76–80 (try/catch); verified by `ndjson-parser.test.ts` "malformed middle line dropped, onParseError fired once" (line 34) and 100-line stress test (line 117) |
| **PM1** — SIGTERM→SIGKILL escalation primitive | `escalateKill(child, graceMs, deps?)` with 10-s default grace | `apps/server/src/daemon/kill-escalation.ts` line 1 (file header) + line 42 (`child.kill('SIGTERM')`) + line 61 (`child.kill('SIGKILL')`); verified by `kill-escalation.test.ts` "SIGKILL fires exactly once after graceMs" (line 45) |
| **T1** — unit-testable primitive without real child process | `parseNdjson` takes a `Readable` → drive via `Readable.from([...])` in tests | `apps/server/tests/unit/ndjson-parser.test.ts` helper `streamFromLines` (line 14); watchdog test uses `new Readable({ read() { /*never pushes*/ } })` + `mock.timers` to verify without wall-clock wait (line 94) |
| **T2** — Playwright integration stub lands now, unskipped by 21-04 | `test.skip('@integration daemon full cycle (21-04)', …)` placeholder | `tests/e2e/daemon-integration.spec.ts` (entire 7-line file) |

## Tests Added

| File | Command | What it asserts |
|---|---|---|
| `apps/server/tests/unit/semaphore.test.ts` | `npx tsx --test apps/server/tests/unit/semaphore.test.ts` | 7 tests: immediate-acquire, max=1 blocking, FIFO across 3 waiters, direct-transfer on release, idempotent double-release, constructor validation (4 invalid inputs), 100-parallel stress cap |
| `apps/server/tests/unit/kill-escalation.test.ts` | `npx tsx --test apps/server/tests/unit/kill-escalation.test.ts` | 8 tests: sync SIGTERM, exit-before-grace cancels SIGKILL, SIGKILL after exact graceMs (9999 tick no-op / +1 tick fires), SIGKILL throw swallowed, cleanup fn cancels pending timer, injected deps override globals, graceMs=0 on next microtask, non-finite rejected |
| `apps/server/tests/unit/ndjson-parser.test.ts` | `npx tsx --test apps/server/tests/unit/ndjson-parser.test.ts` | 9 tests: 3 well-formed lines, malformed middle dropped + onParseError fired, emoji + multi-byte UTF-8 round-trip, CRLF line endings, whitespace-only skipped silently, isValid guard filters, real fixture yields ≥6 msgs incl. assistant/user/result, inactivity watchdog fires exactly once via mock.timers, 100 mixed malformed+valid never throws |
| **All three** | `npm run test:unit -w @aquaclawai/aquarium` | 24 new tests pass; full unit suite 143/143 pass in 5.4 s |

## Decisions Made

- **Node `mock.timers.enable({ apis })` correction:** the plan prescribed `['setTimeout', 'clearTimeout']` but Node 23's node:test mock timers rejects `'clearTimeout'` as an enum entry — the set/clear pair is enabled together under the single `'setTimeout'` key. Corrected in 5 call sites in `kill-escalation.test.ts` and 1 site in `ndjson-parser.test.ts`. Behaviour identical; only the API-enum string changed.
- **Explicit `cleanup()` call in first escalateKill test:** the plan's first test uses real-globals default (no `mock.timers`), so the 10 000 ms real setTimeout stays alive after the assertion and pins the event loop, dragging the test-file duration to ~10 s. Calling the returned `cleanup()` drops the timer reference — test file runs in 108 ms as designed.
- **No runtime deps added** in Plan 21-01; `commander` + `execa` land in Plan 21-02 per RESEARCH §Core additions. `tsx` is already a devDep so `scripts.test:unit` works out of the box.
- **No source edits outside the four named primitive files + shared-types append + package.json scripts.** Followed the plan's zero-scope-creep discipline exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] })` rejected by Node 23's node:test API**
- **Found during:** Task 3 (escalateKill GREEN run)
- **Issue:** Node's `mock.timers.enable` rejects `'clearTimeout'` as an enum value with `TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.apis' option clearTimeout is not supported.`
- **Fix:** Replaced all 6 occurrences (5 in `kill-escalation.test.ts`, 1 in `ndjson-parser.test.ts`) with `apis: ['setTimeout']` — this single entry mocks both `setTimeout` and `clearTimeout` together (and `setInterval`/`setImmediate` are sibling entries, not listed inside).
- **Files modified:** `apps/server/tests/unit/kill-escalation.test.ts`, `apps/server/tests/unit/ndjson-parser.test.ts`
- **Verification:** All 17 affected tests pass; the plan's intended behaviour verification is unchanged (mock.timers.tick(N) still drives both set and clear paths).
- **Committed in:** `551bd47` (Task 3 GREEN) and `76c6a09` (Task 4 GREEN — the ndjson-parser test was fixed inline before its first green run since the issue was discovered in Task 3).

**2. [Rule 1 - Bug] Dangling real 10 s timer pinned event loop in the first escalateKill test**
- **Found during:** Task 3 (escalateKill GREEN run, after fixing deviation #1)
- **Issue:** The plan-prescribed first test `'SIGTERM fires synchronously'` uses the real-globals default (no `mock.timers`), so the 10 000 ms real `setTimeout` scheduled by `escalateKill` outlives the test body and keeps the event loop alive. Single-file test duration ballooned to ~10 s.
- **Fix:** Captured the returned `cleanup` fn and called it after the assertion; file now runs in 108 ms.
- **Files modified:** `apps/server/tests/unit/kill-escalation.test.ts`
- **Verification:** `time npx tsx --test apps/server/tests/unit/kill-escalation.test.ts` shows 0.47 s total (down from 10.54 s).
- **Committed in:** `551bd47` (Task 3 GREEN, same commit as deviation #1).

---

**Total deviations:** 2 auto-fixed (both Rule 1 — Bug)
**Impact on plan:** Both fixes were required for the plan's `< 15 s` full-suite-duration and non-flake discipline to hold. No scope creep — only test files touched, impl files match the plan verbatim.

## Issues Encountered

- Worktree branch was based on `main` (`fb47148`) instead of the phase-HEAD `f70520a`, so the `.planning/phases/21-...` files weren't visible. Resolved with a `git reset --hard f70520ad2c405d1130a15a528dcd05bf78bcd596` before any other work (per the `worktree_branch_check` protocol in the executor prompt).

## User Setup Required

None — the three primitives and their fixtures use only Node 22 built-ins. No env vars, no external services, no dashboard setup.

## Next Phase Readiness

- **Plan 21-02** can now `import type { DaemonConfigFile } from '@aquarium/shared'` and consume `scripts.test:unit` for its TDD work; no new deps contention (`commander` + `execa` arrive fresh in 21-02).
- **Plan 21-03** can `import { Semaphore } from '../daemon/semaphore.js'`, `import { escalateKill } from '../daemon/kill-escalation.js'`, `import { parseNdjson } from '../daemon/ndjson-parser.js'`, and use `apps/server/tests/unit/fixtures/claude-stream-sample.ndjson` as its streaming-batcher input fixture.
- **Plan 21-04** unskips `tests/e2e/daemon-integration.spec.ts` and invokes `fake-claude.js` as a scripted stand-in for the real `claude` CLI.

The shared-types append is live in `packages/shared/dist/` after `npm run build -w @aquarium/shared`.

## Self-Check: PASSED

- [x] `apps/server/src/daemon/semaphore.ts` exists (63 LOC)
- [x] `apps/server/src/daemon/kill-escalation.ts` exists (70 LOC)
- [x] `apps/server/src/daemon/ndjson-parser.ts` exists (90 LOC)
- [x] `apps/server/tests/unit/semaphore.test.ts` exists (7 tests, 90 LOC)
- [x] `apps/server/tests/unit/kill-escalation.test.ts` exists (8 tests, 121 LOC)
- [x] `apps/server/tests/unit/ndjson-parser.test.ts` exists (9 tests, 134 LOC)
- [x] `apps/server/tests/unit/fixtures/claude-stream-sample.ndjson` exists (6 valid JSON lines)
- [x] `apps/server/tests/unit/fixtures/fake-claude.js` exists and handles `--hang`/`--version`/default emit (54 LOC)
- [x] `tests/e2e/daemon-integration.spec.ts` exists with one `test.skip('@integration …')` call
- [x] `packages/shared/src/v14-types.ts` exports `AgentMessage` + `DaemonConfigFile` (grep -c returns 1 each)
- [x] `apps/server/package.json` has `test:unit` and `test:unit:watch` scripts
- [x] Commits exist: `262a99b`, `2aab589`, `c92216a`, `106e233`, `551bd47`, `3c3807f`, `76c6a09`
- [x] `npm run build -w @aquarium/shared` exits 0
- [x] `npm run typecheck -w @aquaclawai/aquarium` exits 0
- [x] `npm run test:unit -w @aquaclawai/aquarium` passes 143/143 in 5.4 s
- [x] The 24 new tests pass in 125 ms when run as a three-file subset
- [x] No `any` in any shipped `src/daemon/*.ts` file

---
*Phase: 21-daemon-cli-claude-code-backend-unit-harness*
*Plan: 01*
*Completed: 2026-04-17*
