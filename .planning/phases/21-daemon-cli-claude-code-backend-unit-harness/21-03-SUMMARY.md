---
phase: 21-daemon-cli-claude-code-backend-unit-harness
plan: 03
subsystem: daemon
tags: [daemon, claude-backend, stream-batcher, cancel-poller, poll-loop, crash-handler, heartbeat, control-request, auto-approval, ndjson, tdd, node-test]

requires:
  - phase: 21-01-PLAN
    provides: Semaphore + escalateKill + parseNdjson primitives + AgentMessage + DaemonConfigFile + test:unit script
  - phase: 21-02-PLAN
    provides: DaemonHttpClient (10 endpoints), loadDaemonConfig, detectClaude, commander CLI dispatch + daemon/main.ts stub
  - phase: 19-daemon-rest-api-auth
    provides: 10 /api/daemon/* endpoints consumed by DaemonHttpClient; 90 s offline threshold

provides:
  - "claudeBackend (run/spawn/buildControlResponse/mapClaudeMessageToAgentMessage) at apps/server/src/daemon/backends/claude.ts"
  - "StreamBatcher (500 ms flush + 100-item / 64 KB caps + PG4 re-prepend on failure) at apps/server/src/daemon/stream-batcher.ts"
  - "startCancelPoller (5 s polling, per-task AbortSignal, resilient to HTTP errors) at apps/server/src/daemon/cancel-poller.ts"
  - "startPollLoop (per-runtime, semaphore-gated, PG1-hardened) at apps/server/src/daemon/poll-loop.ts"
  - "startHeartbeatLoop (15 s, single request per tick for all runtimeIds) at apps/server/src/daemon/heartbeat.ts"
  - "handleFatal + gracefulShutdown + registerProcessHandlers + errorToString at apps/server/src/daemon/crash-handler.ts"
  - "main.startDaemon orchestrator (replaces 21-02 typecheck stub) at apps/server/src/daemon/main.ts"
  - "48 new unit tests across 5 files under apps/server/tests/unit/"
  - "AQUARIUM_DAEMON_TEST_CRASH_AT escape hatch for Plan 21-04 integration tests"

affects: [21-04-plan, phase-22-other-backends]

tech-stack:
  added: []      # execa 9.6.1 + commander 14.0.3 were added in Plan 21-02
  patterns:
    - "Per-task lifecycle orchestration: abortAc → StreamBatcher(signal) + startCancelPoller(signal) + runClaudeTask(abortSignal); cleanup() + batcher.stop() in finally"
    - "Semaphore-gated fire-and-forget: `await semaphore.acquire()` BEFORE claimTask, release in `.finally(release)` on runTask — PG1 HARD"
    - "execa-native SIGTERM→SIGKILL escalation: `cancelSignal` + `forceKillAfterDelay: gracefulKillMs` — replaces hand-rolled escalateKill for claude backend"
    - "Open-stdin control-request handshake: write initial user frame, KEEP stdin open for control_response writes, close stdin only after task loop exits — overrides the naive 'write + end' PM4 template when control protocol is active"
    - "No `.unref()` inside test-awaited Promise.race — node:test's runner flags unref'd pending timers inside awaited races as 'pending'; cleared explicitly with setTimeout-handle capture instead"
    - "Dependency-injection test seams on every time-sensitive primitive (_setTimeout, _clearTimeout, _setInterval, _clearInterval, _execa, _appendFileSync, _exit, _spawn) — 5 test files drive the full surface without real child processes or real wall-clock waits"
    - "Audit-trail for auto-approval: every buildControlResponse decision emits a `type='thinking'` PendingTaskMessageWire so the issue timeline records `[auto-approve] tool=X` / `[deny] tool=Y` — T-21-04 mitigation"

key-files:
  created:
    - apps/server/src/daemon/backends/claude.ts (347 LOC — spawnClaude + buildControlResponse + mapClaudeMessageToAgentMessage + toPendingTaskMessage + sanitizeCustomEnv + runClaudeTask)
    - apps/server/src/daemon/stream-batcher.ts (106 LOC — StreamBatcher class with 500ms/100-item/64KB triggers)
    - apps/server/src/daemon/cancel-poller.ts (75 LOC — startCancelPoller)
    - apps/server/src/daemon/poll-loop.ts (84 LOC — startPollLoop + runPerRuntimeLoop)
    - apps/server/src/daemon/heartbeat.ts (57 LOC — startHeartbeatLoop)
    - apps/server/src/daemon/crash-handler.ts (130 LOC — handleFatal + gracefulShutdown + registerProcessHandlers + errorToString)
    - apps/server/tests/unit/stream-batcher.test.ts (160 LOC, 9 tests)
    - apps/server/tests/unit/claude-control-request.test.ts (383 LOC, 16 tests)
    - apps/server/tests/unit/cancel-poller.test.ts (110 LOC, 5 tests)
    - apps/server/tests/unit/poll-loop.test.ts (193 LOC, 6 tests)
    - apps/server/tests/unit/daemon-crash-handler.test.ts (185 LOC, 12 tests)
  modified:
    - apps/server/src/daemon/main.ts (replaced 43-LOC 21-02 stub with 299-LOC real orchestrator — startDaemon composes loadDaemonConfig + detectClaude + register + pollLoop + heartbeat + crash handlers; stopDaemon/daemonStatus/listTokens/revokeToken preserved as stubs for CLI dispatch)

key-decisions:
  - "Keep stdin OPEN after initial user message, close only after NDJSON iterator exits — the plan's literal template writes the user frame then calls `.end()`, but `--permission-prompt-tool stdio` needs stdin to remain writable for the `control_response` frame. Closing after the task loop exits preserves PM4's intent (stdin.destroyed === true when runClaudeTask returns) while allowing the control-protocol handshake to complete."
  - "No `.unref()` inside test-awaited `Promise.race([allSettled, setTimeout(cap)])` — node:test flags these as 'pending' handles because the race creates a pending promise that the awaited test sees. Swapped to an explicit `clearTimeout(capHandle)` after allSettled resolves. Tests go from 0/12 pass → 12/12 pass with no change in handleFatal's functional semantics."
  - "No `.unref()` on cancel-poller's scheduled tick — the poller is scoped via AbortSignal + cleanup(), not by background-timer GC. Unref'ing would make the poller invisible to the event loop, breaking tests that `await` the first cancelled:true response."
  - "Single `process.env.AQUARIUM_DAEMON_TEST_CRASH_AT` read inside main.ts — this is the ONE sanctioned `process.env` access outside `config.ts` in the entire daemon module tree. Documented in source header (maybeTestCrashAt) and in this SUMMARY. The escape hatch accepts three markers (`after-register` / `before-poll` / `mid-task`) that Plan 21-04's integration test uses to synchronously exercise the fatal-handler path without needing to kill -SIGKILL a real child."
  - "Replace `handleFatal`'s plan-literal `new Promise<void>(resolve, { setTimeout(cap); unref() })` with a captured-handle `clearTimeout` pattern — prevents node:test 'pending promise' false positives AND provides deterministic cleanup on the happy path when `allSettled` wins the race."
  - "execa-native `cancelSignal` + `forceKillAfterDelay: gracefulKillMs` for the claude backend instead of hand-rolling `escalateKill`. escalateKill (21-01) remains available for non-execa paths (future codex/openclaw backends) but every test confirms the execa path is the one wired into runClaudeTask. T-21-05 zombie-child mitigation is therefore owned by execa's well-tested internals, not by hand-rolled SIGTERM→SIGKILL code."

requirements-completed: [CLI-04, CLI-05, CLI-06, BACKEND-01, BACKEND-04, BACKEND-05, BACKEND-06]

duration: ~40min
completed: 2026-04-17
---

# Phase 21 Plan 03: Daemon CLI + Claude-Code Backend + Unit Harness — Composition + Orchestrator Summary

**Completes the daemon as code: Claude backend (spawn + NDJSON → AgentMessage + control_request handshake + audit trail), a 500 ms stream batcher, per-task cancel poller, bounded-concurrency poll loop, crash handler with bounded failTask sweep, heartbeat loop, and a `main.ts` that composes every piece. 48 new unit tests pass in <6 s without spawning a real `claude` CLI.**

## Performance

- **Duration:** ~40 min (wall-clock across 8 commits)
- **Tasks:** 4/4 complete (all TDD RED → GREEN pairs)
- **New test cases:** 48 (9 + 16 + 5 + 6 + 12)
- **Full unit suite after this plan:** 226/226 pass in 5.5 s (178 pre-existing + 48 new)
- **Files created:** 11 (6 daemon source + 5 test files)
- **Files modified:** 1 (main.ts replaced — 43 LOC stub → 299 LOC real orchestrator)
- **New runtime deps:** 0 (execa + commander already pinned in 21-02)

## Task Commits

Each task shipped as a TDD RED → GREEN commit pair:

1. **Task 1: StreamBatcher** — RED `f4f6303` → GREEN `de8709e`
2. **Task 2: Claude backend** — RED `50330c8` → GREEN `cafd732`
3. **Task 3: Cancel poller + Poll loop + Heartbeat** — RED `e11845c` → GREEN `6b85e40`
4. **Task 4: Crash handler + main.ts** — RED `5aca47f` → GREEN `c535a4e`

Total: 8 commits.

## Files Created

| Path | LOC | Purpose |
|---|---:|---|
| `apps/server/src/daemon/backends/claude.ts` | 347 | Claude spawn + NDJSON → AgentMessage + control_request handshake + audit thinking (BACKEND-01 / PM1 / PM3 / PM4 / PM7 / T-21-04 / T-21-05) |
| `apps/server/src/daemon/stream-batcher.ts` | 106 | Per-task message batcher (500 ms / 100-item / 64 KB / re-prepend on POST failure) — PG3 / PG4 / PG5 / PG6 |
| `apps/server/src/daemon/cancel-poller.ts` | 75 | Per-task cancel watcher (5 s default; fires onCancel exactly once) — CLI-06 / PG2 / PG5 |
| `apps/server/src/daemon/poll-loop.ts` | 84 | Multi-runtime poll loop, semaphore-gated — CLI-04 / PG1 HARD / PG2 / PG5 / PG6 |
| `apps/server/src/daemon/heartbeat.ts` | 57 | 15 s heartbeat loop, single request for all runtimeIds — PG2 / PG6 |
| `apps/server/src/daemon/crash-handler.ts` | 130 | handleFatal + gracefulShutdown + registerProcessHandlers + errorToString — CLI-05 / PG2 / T-21-13 |
| `apps/server/tests/unit/stream-batcher.test.ts` | 160 | 9 node:test cases, uses `mock.timers` + scripted mock httpClient |
| `apps/server/tests/unit/claude-control-request.test.ts` | 383 | 16 node:test cases: buildControlResponse matrix, mapper mapping, sanitizeCustomEnv, spawnClaude args+env, runClaudeTask with scripted PassThrough child |
| `apps/server/tests/unit/cancel-poller.test.ts` | 110 | 5 node:test cases: one-shot onCancel, error-resilience, cleanup, AbortSignal, onCancel-throws-doesn't-crash |
| `apps/server/tests/unit/poll-loop.test.ts` | 193 | 6 node:test cases: peak concurrency ≤ max, claim-null sleeps, claim error → onError, shutdown exits, two-runtime independence, runTask rejection swallowed |
| `apps/server/tests/unit/daemon-crash-handler.test.ts` | 185 | 12 node:test cases: errorToString branches, handleFatal append+failTask+exit, cap enforcement, failTask throw swallow, appendFile-EACCES swallow, gracefulShutdown drain+dereg+exit, hung-drain cap, dereg-throw-still-exits |

## Files Modified

- `apps/server/src/daemon/main.ts` — replaced the 43-LOC 21-02 `DaemonNotImplementedError` stub with a 299-LOC orchestrator. All five original exports preserved (`startDaemon`, `stopDaemon`, `daemonStatus`, `listTokens`, `revokeToken`). `startDaemon` now composes `loadDaemonConfig` → `detectClaude` → `http.register` → `startPollLoop` → `startHeartbeatLoop` with `registerProcessHandlers` wiring both fatal paths (unhandledRejection / uncaughtException → `handleFatal`) and signal paths (SIGTERM / SIGINT → `gracefulShutdown`). The `AQUARIUM_DAEMON_TEST_CRASH_AT` escape hatch is fired at three deterministic markers to let Plan 21-04 exercise the fatal-handler flow.

## Pitfall Mitigations

Every OWNED pitfall in this plan's scope cited to file + line of the mitigation:

| Pitfall | Mitigation | Where |
|---|---|---|
| **PG1 HARD** — unbounded goroutine-leak equivalent | `await semaphore.acquire()` BEFORE every claim, released in `.finally(release)` on runTask or immediately on null-task | `apps/server/src/daemon/poll-loop.ts` L22–25 (doc) + L44 (body) + L54 (`release()` on shutdown check) + L82 (`.finally(release)`); verified by `poll-loop.test.ts` "respects semaphore — peak concurrency never exceeds max" |
| **PG2** — unhandled rejections | try/catch per tick in poll-loop / cancel-poller / heartbeat; `registerProcessHandlers` wires unhandledRejection + uncaughtException → `handleFatal` before loops start; `main.ts` at lines 110-127 | `poll-loop.ts` L60 + L77; `cancel-poller.ts` L52 + L62; `heartbeat.ts` L37–41; `crash-handler.ts` L27 (registerProcessHandlers); `main.ts` L110 (PG2 call-out) |
| **PG3** — timer cleanup on cancel | StreamBatcher.stop() clears interval + awaits final flush; cancel-poller cleanup() clearTimeout's pending tick; heartbeat cleanup() clearInterval | `stream-batcher.ts` L25 (doc) + L77–81 (stop body); `cancel-poller.ts` L42–48 (cleanup); `heartbeat.ts` L52–54 (cleanup) |
| **PG4** — dropped-channel-full semantics | `StreamBatcher.flushInternal` re-prepends failed batch to buffer on postMessages failure; `onFlushError` callback for observability only | `stream-batcher.ts` L22 (doc) + L96–100 (catch re-prepend); verified by `stream-batcher.test.ts` "POST failure re-queues batch for next flush (PG4 — never drops)" |
| **PG5** — AbortSignal thread-through | DaemonHttpClient (21-02) threads `signal: this.signal` into every fetch; poll-loop checks `shutdownSignal.aborted` at top of every iteration; cancel-poller + stream-batcher + heartbeat use `signal.addEventListener('abort', cleanup)` | `poll-loop.ts` L48 + L54 (aborted checks); `cancel-poller.ts` L45 (addEventListener); `stream-batcher.ts` L47 (addEventListener); `heartbeat.ts` L49 (addEventListener) |
| **PG6** — await-in-loop discipline | StreamBatcher flushes sequentially per task (never Promise.all across batches); heartbeat posts ALL runtimeIds in one request (no per-runtime `for-await`); poll-loop runs per-runtime (runA await does not block runB) | `stream-batcher.ts` L26–29 (doc); `heartbeat.ts` L12–14 (doc); `poll-loop.ts` L26 (per-runtime split — runPerRuntimeLoop) |
| **PG7** — `for await (const line of rl)` | Consumed via `parseNdjson` (21-01) in `runClaudeTask`; no raw `rl.on('line', …)` in this plan | `backends/claude.ts` L273 (parseNdjson call site) |
| **PG8** — backpressure via for-await | Inherited from parseNdjson (21-01); `runClaudeTask` consumes with single `for await` | `backends/claude.ts` L273–278 |
| **PG9** — UTF-8 boundary handling | Inherited from parseNdjson (21-01); `runClaudeTask` relies on setEncoding('utf8') inside the parser | `backends/claude.ts` header — "Research references: §NDJSON Stream-JSON Parser" |
| **PG10** — per-line try/catch | Inherited from parseNdjson (21-01); `runClaudeTask` has its own outer try/catch around the iterator for spawn failures | `backends/claude.ts` L300–302 (outer catch is non-throw — "child exit below is authoritative") |
| **PM1** HARD — SIGTERM→SIGKILL + process-group kill | `spawnClaude` passes `shell: false` + `detached: process.platform !== 'win32'` + `forceKillAfterDelay: gracefulKillMs` + `cancelSignal: abortSignal` to execa 9 | `backends/claude.ts` L9–11 (doc) + L226–232 (spawn options); verified by `claude-control-request.test.ts` "passes correct args + env + spawn options" |
| **PM2** — orphan task pids | `inFlight` Map in `main.ts` tracks every running task; `handleFatal` iterates + best-effort `failTask` each before exit. Full pgrep orphan-replay is deferred — AQUARIUM_DAEMON_TEST_CRASH_AT scaffolds 21-04 integration test for this path | `main.ts` L23 (doc) + L113–114 (inFlight Map) + L117–123 (handleFatal wiring) |
| **PM3** — PATH inheritance | `spawnClaude` sets `env.PATH = path.dirname(process.execPath) + path.delimiter + process.env.PATH` before merging customEnv | `backends/claude.ts` L12 (doc) + L213–215 (env composition) |
| **PM4** — stdin write-then-close | `runClaudeTask` writes ONE user message, KEEPS stdin open while NDJSON iterator runs (control_response handshake needs writable stdin), closes stdin via `.end()` AFTER iterator exits | `backends/claude.ts` L14 (doc) + L260–267 (write without end) + L321–323 (post-loop end) |
| **PM7** — token leak via env | `sanitizeCustomEnv` strips PATH + AQUARIUM_* from `agent.customEnv`; `spawnClaude` ALSO explicitly `delete env.AQUARIUM_DAEMON_TOKEN` + `delete env.AQUARIUM_TOKEN` after merge | `backends/claude.ts` L16 (doc) + L171–180 (sanitizeCustomEnv) + L218–220 (explicit delete); verified by `claude-control-request.test.ts` "passes correct args + env + spawn options" assertion that AQUARIUM_TOKEN is undefined in env |
| **T1** carry-through — unit-testable without real child | `runClaudeTask` accepts `_spawn` test seam; test uses `PassThrough` streams and a Promise-resolved `fakeChild` to script stdout + capture stdin writes. Zero real `claude` binary spawned across all 48 new tests | `claude-control-request.test.ts` L156–168 (PassThrough setup + fakeChild object + spawnMock) |
| **T2** carry-through — e2e stub unskipped by 21-04 | N/A in this plan — Playwright stub remains skipped; 21-04 unskips | `tests/e2e/daemon-integration.spec.ts` (unchanged here) |

## Threat Mitigations

| Threat | Category | Mitigation | Where |
|---|---|---|---|
| **T-21-01** — Daemon token leakage via logs / error messages | Information Disclosure | `main.startDaemon` never logs `config.token` — grep `console\.log.*config\.token|logSafe.*token` in `main.ts` returns 0. Token also never passed to child via env (see T-21-11). | `main.ts` L29 (doc guarantee) + L79 (comment); `grep -c` verified = 0 |
| **T-21-03** — Malicious `claude` binary on PATH hijacks execution | Spoofing + Elevation | `main.startDaemon` logs `[daemon] claude=<absolute path> (v<version>)` on startup so operators see exactly what will be spawned. `spawnClaude` passes the absolute path to execa with `shell: false` (no arg injection via shell). | `main.ts` L27 (doc) + L82 (audit log); `backends/claude.ts` L3 (T-21-03 doc) + L211–232 (spawn with absolute path + shell:false) |
| **T-21-04** — Auto-approval of dangerous tools via `control_request` | Elevation + Tampering | `buildControlResponse` honours `DaemonConfig.backends.claude.allow` (default `['*']` → approve-all; set to explicit list for deny-by-default). EVERY decision fires an audit `type='thinking'` `PendingTaskMessageWire` with `[auto-approve] tool=<name>` or `[deny] tool=<name>`. Verified by 3 runClaudeTask scripted tests (allow path, deny path, malformed frame) | `backends/claude.ts` L17 (doc) + L70–89 (buildControlResponse) + L285–296 (audit thinking message emission) |
| **T-21-05** — Zombie child processes leaking resources | DoS | execa-native `forceKillAfterDelay: gracefulKillMs` = 10 s SIGTERM→SIGKILL escalation; `detached: process.platform !== 'win32'` = process-group leader on POSIX so SIGTERM reaches the whole tree (bash -> claude -> claude-worker). `escalateKill` from 21-01 remains available for non-execa paths. | `backends/claude.ts` L20–22 (doc) + L231–232 (forceKillAfterDelay + detached) |
| **T-21-06** carry-through — Malformed NDJSON crashes daemon | DoS + Log Forging | `parseNdjson` from 21-01 consumed verbatim — per-line try/catch drops malformed frames; `runClaudeTask`'s outer catch swallows iterator failures (child exit below is authoritative). Verified by `claude-control-request.test.ts` "malformed control_request frames are dropped, never crash" | `backends/claude.ts` L300–302 (outer try/catch) |
| **T-21-11** carry-through — Token passed to child via env | Information Disclosure | Not only `sanitizeCustomEnv` (which strips AQUARIUM_*) but ALSO explicit `delete env.AQUARIUM_DAEMON_TOKEN` + `delete env.AQUARIUM_TOKEN` AFTER merge — even if a future helper reintroduces the key, the guard stays. Test "passes correct args + env + spawn options" asserts `env.AQUARIUM_TOKEN === undefined`. | `backends/claude.ts` L218–220 |
| **T-21-12** — Log injection via `control_request.tool_name` | Log Forging | Audit message content constructed via template literal with `tool_name ?? 'unknown'`; server's 16 KB truncation covers the UI render path (UI-07 existing). No `console.*` in this plan interpolates raw tool_name (only shows in the audit PendingTaskMessageWire which the server-side UI truncates). | `backends/claude.ts` L293 (template literal with fallback) |
| **T-21-13** — Unhandled rejection leaves in-flight task orphaned in DB | DoS + Resource Leak | `handleFatal` best-effort calls `failTask(id, 'daemon <source>')` for every in-flight task with `failTaskTimeoutMs` cap (default 2000 ms). Server's Phase 18 reaper (5 min threshold) catches any misses. Crash log line written FIRST even if HTTP is unreachable. | `crash-handler.ts` L2 (doc) + L71–89 (failTask sweep); verified by `daemon-crash-handler.test.ts` "appends crash log line and fails in-flight tasks and calls exit(1)" + "failTask that hangs does not block exit beyond cap" |

## Tests Added

| File | Command | What it asserts (count) |
|---|---|---|
| `stream-batcher.test.ts` | `npx tsx --test apps/server/tests/unit/stream-batcher.test.ts` | **9 tests**: sync push, interval flush, 100-item cap, 64 KB cap, flushNow, stop drains + rejects further push, PG4 re-prepend, concurrent flush sequencing, AbortSignal stop |
| `claude-control-request.test.ts` | `npx tsx --test apps/server/tests/unit/claude-control-request.test.ts` | **16 tests**: buildControlResponse allow/deny matrix (4), mapClaudeMessageToAgentMessage branches (6), toPendingTaskMessage unknown-tool fallback (1), sanitizeCustomEnv PM7 (1), spawnClaude args+env+options (1), runClaudeTask allow-path scripted child (1), deny-path (1), malformed frame (1) |
| `cancel-poller.test.ts` | `npx tsx --test apps/server/tests/unit/cancel-poller.test.ts` | **5 tests**: onCancel exactly-once, getTaskStatus-throw continues polling, cleanup stops polling, AbortSignal also stops (idempotent cleanup), onCancel-throw does not crash poller |
| `poll-loop.test.ts` | `npx tsx --test apps/server/tests/unit/poll-loop.test.ts` | **6 tests**: peak concurrency ≤ sem.max, null-claim sleeps pollIntervalMs, claim error → onError + continue, shutdownSignal.abort exits both runtimes, two-runtime independence, runTask rejection swallowed by onError |
| `daemon-crash-handler.test.ts` | `npx tsx --test apps/server/tests/unit/daemon-crash-handler.test.ts` | **12 tests**: errorToString 4 branches, handleFatal append + failTask + exit(1), hung failTask honours cap, failTask throw doesn't cascade, appendFileSync-EACCES swallowed + still exits, empty inFlight still logs + exits, gracefulShutdown drain+deregister+exit(0), hung drain honours gracefulShutdownMs cap, deregister-throw still exits(0) |
| **All 5** | `npm run test:unit -w @aquaclawai/aquarium` | 48 new tests green; full unit suite 226/226 pass in 5.5 s |

### Tests that inject mock `execa`

| Test file | Mock approach | What it validates without a real `claude` binary |
|---|---|---|
| `claude-control-request.test.ts` "passes correct args + env + spawn options" | `_execa` test seam captures `(cmd, args, opts)` into a local variable | PM1 (`shell: false`, `detached`, `forceKillAfterDelay`, `cancelSignal`) + PM3 (PATH prepended) + PM7 (AQUARIUM_TOKEN absent from env) + correct arg order `--output-format stream-json --input-format stream-json --verbose --permission-prompt-tool stdio` |
| `claude-control-request.test.ts` runClaudeTask scripted tests (3 cases) | `_spawn` test seam returns a Promise-resolved `fakeChild` object with `PassThrough` stdout/stdin/stderr | Full end-to-end: NDJSON lines written to stdout → runClaudeTask emits correct PendingTaskMessageWire shape via onAgentMessage + writes control_response to stdin |

### Tests that use `node:test`'s `mock.timers`

| Test file | mock.timers usage | Purpose |
|---|---|---|
| `stream-batcher.test.ts` "push returns synchronously without HTTP call" | `mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })` | Prevents the real 500 ms interval from firing during the sync-push assertion |
| `stream-batcher.test.ts` "interval flush fires after 500 ms with accumulated batch" | `mock.timers.tick(500)` | Drives the interval firing deterministically without a real 500 ms wait |

## Known Stubs

None. Plan 21-02 shipped `main.ts` as a typecheck-only stub (`DaemonNotImplementedError` for all five exports); this plan **replaces the entire file** with real implementations. The four non-startDaemon exports (`stopDaemon`, `daemonStatus`, `listTokens`, `revokeToken`) are minimal operational helpers (PID file → SIGTERM / PID file → running-or-stopped / console hint pointing at the web UI). They're not stubs — they're the v1.4 operational surface. Full `token list` and `token revoke` functionality routes through the web UI's DaemonTokens page per CLI-02 research.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `stdin.end()` after user message broke control_response handshake**

- **Found during:** Task 2 GREEN run (first `runClaudeTask` scripted test)
- **Issue:** The plan's literal `runClaudeTask` template writes the user frame to stdin then calls `.end()`, per PM4. But the test expects a `control_response` frame to be written back to stdin in response to a `control_request` — impossible on a closed stream. Test assertion "control_response was written to stdin" failed with "actual: '{\"type\":\"user\",...}\\n', expected: /\"type\":\"control_response\"/".
- **Resolution:** Removed the `.end()` after the user message; added `.end()` AFTER the NDJSON iterator exits (by which point the control protocol has completed or the child has died). PM4's intent (stdin.destroyed === true by the time runClaudeTask returns) is preserved — just moved to the end of the function. Documented in the file header and inline.
- **Files modified:** `apps/server/src/daemon/backends/claude.ts` L263–267 (removed early .end) + L321–323 (added late .end)
- **Verification:** All 3 runClaudeTask scripted tests green; test explicitly asserts `stdinWrites.join('')` contains both the initial user frame AND the control_response frame.
- **Committed in:** `cafd732` (Task 2 GREEN)

**2. [Rule 1 — Bug] `.unref()` inside Promise.race in handleFatal caused node:test to report all tests as "Promise resolution is still pending but the event loop has already resolved"**

- **Found during:** Task 4 GREEN run (all 12 tests failed identically despite the direct-invocation smoke test working)
- **Issue:** node:test's runner monitors the event loop during awaited test callbacks. When `await handleFatal(...)` contained `await Promise.race([allSettled, new Promise(r => { setTimeout(r, cap).unref(); })])`, the runner saw an unref'd pending timer inside an awaited promise and flagged it as "pending". All 12 tests failed with identical diagnostic; the runner aborted each test immediately even though the actual functional path was correct.
- **Resolution:** Replaced the unref'd-timer pattern with a captured-handle + explicit `clearTimeout`. Same functional contract (cap honoured, happy-path resolves via allSettled, timeout resolves via the setTimeout callback), but now the timer is either cleared when allSettled wins OR fires as a normal (unref-free) timer that resolves via its callback. Applied the same fix to `gracefulShutdown`.
- **Rationale for not unref'ing:** In the fatal path, handleFatal is the last thing to run before `process.exit(1)`. Pinning the event loop for up to `cap` ms (default 2000) is fine — the process is dying regardless. In `gracefulShutdown`, the cap is `gracefulShutdownMs` (default 15 000) which is also pre-exit; same reasoning.
- **Files modified:** `apps/server/src/daemon/crash-handler.ts` L71–82 (handleFatal race) + L103–114 (gracefulShutdown race)
- **Verification:** Test results went from 0/12 pass → 12/12 pass; full suite 226/226 pass in 5.5 s.
- **Committed in:** `c535a4e` (Task 4 GREEN)

**3. [Rule 1 — Bug] `.unref()` on cancel-poller's scheduled tick broke test event-loop semantics**

- **Found during:** Task 3 GREEN run (5/5 cancel-poller tests failed with "Promise resolution is still pending")
- **Issue:** Same class of issue as #2 — cancel-poller's `setTimeout` for the next tick was `.unref()`'d, making it invisible to node:test's event-loop monitor. The test's own outer `await new Promise(r => setTimeout(r, 60))` keeps the loop alive, but the test's awaited `pending` promise (which the cancel-poller resolves) never saw any ref'd handle to hang its fulfillment on.
- **Resolution:** Removed the `.unref()` call in `cancel-poller.ts`'s `schedule()` function. The poller is already lifecycle-scoped via `cleanup()` + AbortSignal, so the unref is redundant for the production path (nothing holds the daemon open past the scheduled poller ticks anyway — the main daemon loop is the keep-alive). Added a doc comment explaining the rationale.
- **Files modified:** `apps/server/src/daemon/cancel-poller.ts` L53–59 (removed unref + added rationale comment)
- **Verification:** 5/5 cancel-poller tests pass; production daemon still exits cleanly on SIGTERM (the main `await new Promise(() => {})` in startDaemon is what keeps the process alive, not poller ticks).
- **Committed in:** `6b85e40` (Task 3 GREEN)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — Bug)
**Impact on plan:** All three are TEST-INFRASTRUCTURE fixes — the plan's functional contract is preserved in every case. No change to pitfall / threat mitigations; every citable grep target still resolves. No new deps, no API-surface changes, no regression in the 178 pre-existing unit tests.

## Threat Flags

No new threat surface beyond what's declared in the plan's `<threat_model>`. Every mitigation cited there is live in source per the Threat Mitigations table above.

## Issues Encountered

- Worktree branch was based on `fb47148` (the main-branch HEAD) instead of the required phase-HEAD `015d437`. The incoming prompt's `worktree_branch_check` ran `git reset --hard 015d43705ab45209906fe3c75bb343a767cdd1cc` to realign before any other work; after the reset, baseline `npm run typecheck` + `npm run test:unit` both passed with the 178-test suite (21-01 + 21-02 baseline).
- Three test-infrastructure bugs (documented as Deviations #1, #2, #3) required inline fixes during GREEN. All three are fully explained above with before/after context.

## User Setup Required

None — the 7 new source files and 5 new test files use only Node 22 built-ins plus the execa + commander deps already pinned in Plan 21-02. No env vars, no external services, no `claude` binary required for the 48 new tests (all child-process behaviour is exercised via the `_execa` + `_spawn` test seams with `PassThrough` streams). The `AQUARIUM_DAEMON_TEST_CRASH_AT` hook is opt-in and off-by-default.

## `AQUARIUM_DAEMON_TEST_CRASH_AT` Test Hook Contract

Plan 21-04's integration spec will set this env var to one of three exact strings to trigger a deterministic synthetic crash at a known point in daemon startup:

| Value | Fires at | Throws | Use |
|---|---|---|---|
| `after-register` | Immediately after `http.register` resolves, before `inFlight` Map is created | `Error('AQUARIUM_DAEMON_TEST_CRASH_AT=after-register — synthetic crash')` | Proves `handleFatal` can exit cleanly when no tasks are in flight |
| `before-poll` | Right before `startPollLoop` is called, after process handlers are registered | same template | Proves registered handlers see an early crash |
| `mid-task` | Inside the first `runTask`, after abortAc + batcher + cancelPoller are wired but before `http.startTask` | same template | Proves `inFlight` Map has the task entry so `handleFatal` fails it |

Any other value (or unset) is a silent no-op — **production daemons are unaffected**. The escape hatch is the ONE sanctioned `process.env` access outside `config.ts` in the whole daemon module tree; called out in `main.ts`'s `maybeTestCrashAt` function header.

## Next Phase Readiness

- **Plan 21-04** can now:
  - Unskip `tests/e2e/daemon-integration.spec.ts` and drive a real `aquarium daemon start` against `fake-claude.js` (the 21-01 fixture).
  - Use `AQUARIUM_DAEMON_TEST_CRASH_AT=mid-task` to synchronously trigger the crash-handler path and assert the crash log line + in-flight task's `failTask` call without needing `kill -9`.
  - Verify `pgrep -f fake-claude` is empty 2 s after cancel (T-21-05 integration proof) — the execa `forceKillAfterDelay` + detached process-group gives us that invariant.
  - Hit the running daemon's poll + heartbeat loops against the real Phase 19 server surface.
- **Plan 21-04** consumes ZERO new source files from this plan directly — the smoke test is a pure integration exercise against `main.startDaemon`.

## Self-Check: PASSED

- [x] `apps/server/src/daemon/stream-batcher.ts` exists (106 LOC, `export class StreamBatcher` + `PG4` cited)
- [x] `apps/server/src/daemon/backends/claude.ts` exists (347 LOC, `spawnClaude` / `buildControlResponse` / `mapClaudeMessageToAgentMessage` / `sanitizeCustomEnv` / `runClaudeTask` exports)
- [x] `apps/server/src/daemon/cancel-poller.ts` exists (75 LOC, `startCancelPoller` + `CLI-06` cited)
- [x] `apps/server/src/daemon/poll-loop.ts` exists (84 LOC, `startPollLoop` + `PG1` + `PG2` + `await opts.semaphore.acquire()` cited)
- [x] `apps/server/src/daemon/heartbeat.ts` exists (57 LOC, `startHeartbeatLoop` + `PG2` + `PG6` cited)
- [x] `apps/server/src/daemon/crash-handler.ts` exists (130 LOC, `handleFatal` / `gracefulShutdown` / `registerProcessHandlers` / `errorToString` + `CLI-05` + `PG2` + `appendFileSync` cited)
- [x] `apps/server/src/daemon/main.ts` replaces the 21-02 stub (299 LOC real orchestrator; `startDaemon` + `stopDaemon` + `daemonStatus` + `listTokens` + `revokeToken`; `registerProcessHandlers` wired; `[daemon] claude=…` audit logged; `daemon.crash.log` path referenced)
- [x] `apps/server/tests/unit/stream-batcher.test.ts` — 9 tests
- [x] `apps/server/tests/unit/claude-control-request.test.ts` — 16 tests
- [x] `apps/server/tests/unit/cancel-poller.test.ts` — 5 tests
- [x] `apps/server/tests/unit/poll-loop.test.ts` — 6 tests
- [x] `apps/server/tests/unit/daemon-crash-handler.test.ts` — 12 tests
- [x] Commits exist: `f4f6303`, `de8709e`, `50330c8`, `cafd732`, `e11845c`, `6b85e40`, `5aca47f`, `c535a4e`
- [x] `npm run typecheck -w @aquaclawai/aquarium` exits 0
- [x] `npm run test:unit -w @aquaclawai/aquarium` passes 226/226 in 5.5 s (<20 s budget)
- [x] No `any` type annotations in any shipped `src/daemon/**/*.ts` file (4 `any` hits are all prose-`any` in comments)
- [x] No `@ts-ignore` / `@ts-expect-error` in any shipped `src/daemon/**/*.ts`
- [x] `spawnClaude` grep-verifies: `shell: false`, `detached:`, `forceKillAfterDelay`, `cancelSignal`, `permission-prompt-tool`, `PM3|BACKEND-05`, `PM4`, `PM7|sanitizeCustomEnv`, `delete env.AQUARIUM_DAEMON_TOKEN|delete env.AQUARIUM_TOKEN`
- [x] `main.ts` grep for `console.log.*config.token|logSafe.*token` returns 0 (T-21-01 / T-21-11 verified)
- [x] All OWNED pitfalls PG1–PG10 + PM1–PM4 + PM7 have citable mitigations in source comments (see Pitfall Mitigations table)
- [x] Threats T-21-01, T-21-03, T-21-04, T-21-05, T-21-11, T-21-13 all cited in source + SUMMARY
- [x] No scratch files (`probe-*`, `check-argv*`, `*-min.test.ts`) in the repo
- [x] `AQUARIUM_DAEMON_TEST_CRASH_AT` hook contract documented in this SUMMARY + source header

---
*Phase: 21-daemon-cli-claude-code-backend-unit-harness*
*Plan: 03*
*Completed: 2026-04-17*
