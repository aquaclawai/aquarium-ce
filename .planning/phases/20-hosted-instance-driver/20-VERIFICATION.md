---
phase: 20-hosted-instance-driver
verified: 2026-04-17T07:19:55Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Assign an issue to a hosted-instance agent while its Docker container is running; confirm task_message rows appear in the DB with types matching the gateway stream (text, tool_use, tool_result, thinking)"
    expected: "task_message rows are inserted in real time with correct types and seq values; UI would see them as a live stream"
    why_human: "Requires a real running OpenClaw gateway container; cannot test without a live Docker environment in CI"
  - test: "Disconnect the gateway WS for an instance mid-task (e.g. kill the container), wait 4+ seconds, then reconnect; observe that the task stays in queued status (not failed) and resumes dispatch after reconnection"
    expected: "Worker tick silently skips while isGatewayConnected returns false; on reconnect the next tick dispatches the task"
    why_human: "Requires real gateway WS lifecycle; cannot mock Docker network partitions in unit tests"
  - test: "Kill the server while a hosted task is in dispatched/running status; restart the server; check the task row"
    expected: "Task transitions to status=failed with error='hosted-orphan-on-boot' within the boot sequence, before the first HTTP request"
    why_human: "Requires a real server kill mid-task; unit tests cover the sweep logic but not the actual server restart flow end-to-end"
---

# Phase 20: Hosted-Instance Driver Verification Report

**Phase Goal:** Tasks assigned to agents whose runtime is a hosted Aquarium instance are automatically dispatched through the existing gateway RPC, with live `chat.send` events translated into `task_message` rows so the UI sees the same streaming shape regardless of runtime kind.
**Verified:** 2026-04-17T07:19:55Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Gateway parts (text/toolCall/toolResult/thinking) translate 1:1 into `task_message` rows with correct `type` | VERIFIED | `translatePartsToMessages` in `hosted-task-worker.ts` handles text/thinking/toolCall/tool_use/toolResult/tool_result; Tests 1–4 verify all mappings; Test 11 confirms 3 streaming frames + final → 3 task_message rows |
| 2 | With gateway disconnected, worker tick leaves task queued (does not fail); resumes within 2s of reconnect | VERIFIED | `isGatewayConnected()` called per runtime at the top of `tick()` before `claimTask` (line 296); TICK_MS=2000; Test 6 asserts queued task stays queued when disconnected |
| 3 | Killing the server mid-task fails all in-flight hosted tasks during boot (not waiting for reaper) | VERIFIED | `failOrphanedHostedTasks` one-shot sweep in `hosted-orphan-sweep.ts`; wired as Step 9b at server-core.ts:331, before `startTaskReaper` at line 346; error='hosted-orphan-on-boot'; 5 unit tests cover all cases |
| 4 | Hosted task with agent `custom_env` set completes successfully with a WARN log | VERIFIED | `warnIgnoredFields` function present (3 grep hits); Test 7 confirms WARN cites all four fields; Test 8 confirms no spurious WARN when fields are empty |
| 5 | Hosted task dispatch never modifies `instances.status` | VERIFIED | Zero references to `instance-manager` or `updateStatus` in `hosted-task-worker.ts` (grep count = 0); Test 15 DB-snapshot proof — `instances` row is byte-identical before/after a full dispatch cycle |

**Score:** 5/5 truths verified

### Deferred Items

None. All 5 ROADMAP success criteria are met by code that exists in HEAD.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/gateway-event-relay.ts` | `registerChatStreamListener` + `ChatStreamPayload` + `dispatchChatStream` wiring | VERIFIED | 1 export of `registerChatStreamListener`, 1 export of `ChatStreamPayload`, 10 occurrences of `chatStreamListeners`, 3 of `dispatchChatStream`; wired at line 528-529 between one-shot callback dispatch and DLP broadcast |
| `apps/server/src/task-dispatch/hosted-task-worker.ts` | 685-line worker with tick/dispatch/translatePartsToMessages/cancelWatcher | VERIFIED | Exactly 685 lines; all 3 key exports found; TICK_MS=2000, CANCEL_POLL_MS=2000, CHAT_SEND_TIMEOUT_MS=30_000, CHAT_WAIT_TIMEOUT_MS=120_000 |
| `apps/server/src/task-dispatch/hosted-orphan-sweep.ts` | `failOrphanedHostedTasks` one-shot with ST6 guard + broadcast-per-SELECT-row | VERIFIED | 162 lines; `failOrphanedHostedTasks` exported; `'hosted-orphan-on-boot'` present 3 times; ST6 guard (`whereIn` on UPDATE) present; Blocker-3 filter-by-index anti-pattern absent (grep = 0); `benign` documented 4 times |
| `apps/server/src/server-core.ts` | Step 9b (orphan sweep) + Step 9d (hosted worker) wired in correct order | VERIFIED | `failOrphanedHostedTasks` appears 3 times (import + call + comment); `startHostedTaskWorker` appears 3 times; awk ordering checks: 9b(331) < 9c(346) < 9d(353) < 9e(357) — all exit 0 |
| `apps/server/tests/unit/gateway-event-relay-stream.test.ts` | 7 tests covering stream listener delivery, unsubscribe, fan-out, isolation, regression | VERIFIED | File exists (9,925 bytes); 7 tests pass in isolation |
| `apps/server/tests/unit/hosted-task-worker.test.ts` | 19 tests covering all HOSTED-0x requirements + invariants | VERIFIED | File exists (35,735 bytes); 19 tests pass in isolation |
| `apps/server/tests/unit/hosted-orphan-sweep.test.ts` | 5 tests covering HOSTED-04 behavior, ST6 race, daemon isolation | VERIFIED | File exists (12,905 bytes); 5 tests pass in isolation |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `server-core.ts` | `hosted-orphan-sweep.ts` | `import { failOrphanedHostedTasks }` at boot Step 9b | VERIFIED | Import confirmed; `failOrphanedHostedTasks()` called at line 331 |
| `server-core.ts` | `hosted-task-worker.ts` | `import { startHostedTaskWorker }` at boot Step 9d | VERIFIED | Import confirmed; `startHostedTaskWorker()` called at line 353 |
| `hosted-task-worker.ts` | `gateway-event-relay.ts` | `registerChatStreamListener`, `isGatewayConnected`, `waitForChatCompletion`, `cancelChatCompletion` | VERIFIED | All 4 imported at lines 13-18; all called in dispatch flow |
| `hosted-task-worker.ts` | `task-message-batcher.ts` | `appendTaskMessage` | VERIFIED | Imported at line 19; called in stream listener callback |
| `hosted-task-worker.ts` | `gateway-rpc.ts` | `gatewayCall('chat.send', ...)` | VERIFIED | Imported at line 11; called in `dispatchHostedTask` with `CHAT_SEND_TIMEOUT_MS=30_000` |
| `gateway-event-relay.ts` (chat router) | `dispatchChatStream` | Called at lines 528-529 inside `if (msg.event === 'chat')` block, after one-shot callback dispatch, before `sendChatToSession` DLP broadcast | VERIFIED | Lines 528-529 confirmed in file |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `hosted-task-worker.ts` translatePartsToMessages | `payload.message.content` / `payload.content` | `ChatStreamPayload` from `registerChatStreamListener` callback → `dispatchChatStream` in gateway router → real gateway WS frames | Yes — production path driven by real gateway WS; unit tests drive via `createMockGateway().emitFrame()` | FLOWING |
| `hosted-orphan-sweep.ts` | `rows` from `agent_task_queue JOIN runtimes` SELECT | Knex query against SQLite `agent_task_queue` table | Yes — real DB query with JOIN filter `r.kind='hosted_instance'` AND `status IN ('dispatched','running')` | FLOWING |
| `server-core.ts` Step 9b | `{ failed }` from `failOrphanedHostedTasks()` | Real DB call | Yes — returns actual update count | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 31 Phase-20 unit tests pass (7 + 19 + 5) | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test .../gateway-event-relay-stream.test.ts .../hosted-task-worker.test.ts .../hosted-orphan-sweep.test.ts` | `tests 31, pass 31, fail 0` | PASS |
| Full 119-test suite regression | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts` | `tests 119, pass 119, fail 0` | PASS |
| Boot ordering: 9b < 9c | `awk '/failOrphanedHostedTasks\(\)/{a=NR} /startTaskReaper\(\)/{b=NR} END{exit (a && b && a<b)?0:1}' server-core.ts` | exit 0; 9b=331, 9c=346 | PASS |
| Boot ordering: 9c < 9d < 9e | `awk '/startTaskReaper\(\)/{a=NR} /startHostedTaskWorker\(\)/{b=NR} /startRuntimeOfflineSweeper\(\)/{c=NR} END{exit (a<b && b<c)?0:1}'` | exit 0; 9c=346, 9d=353, 9e=357 | PASS |
| ST5 invariant — no instance-manager import | `grep -c "import.*instance-manager\|updateStatus" hosted-task-worker.ts` | 0 | PASS |
| Blocker-3 anti-pattern absent | `grep -c "filter((_, idx) => idx < failed)" hosted-orphan-sweep.ts` | 0 | PASS |

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| HOSTED-01 | 20-02 | In-process worker polls task queue every 2s for online hosted_instance runtimes | SATISFIED | `TICK_MS = 2_000`; `tick()` queries `runtimes JOIN instances WHERE kind='hosted_instance' AND i.status='running'`; Test 5 |
| HOSTED-02 | 20-02 | Dispatch invokes `gatewayCall(instanceId, 'chat.send', …, 120_000)` via existing persistent-WS client | SATISFIED | Split implementation: 30s RPC-accept (`CHAT_SEND_TIMEOUT_MS`) + 120s completion (`CHAT_WAIT_TIMEOUT_MS`); documented in code + summary; Test 10 |
| HOSTED-03 | 20-01 + 20-02 | Gateway text/toolCall/toolResult/thinking events → 1:1 `task_message` rows | SATISFIED | `registerChatStreamListener` provides multi-shot frame delivery; `translatePartsToMessages` maps all 4 types; Tests 1–4 + Test 11 |
| HOSTED-04 | 20-03 | On restart, all in-flight hosted tasks failed during boot | SATISFIED | `failOrphanedHostedTasks` + Step 9b wiring; error='hosted-orphan-on-boot'; 5 unit tests |
| HOSTED-05 | 20-02 | Hosted tasks ignore session_id/work_dir/custom_env/custom_args with WARN log | SATISFIED | `warnIgnoredFields` function; Tests 7 + 8 |
| HOSTED-06 | 20-02 | Gateway disconnected → worker silently skips tick (task stays queued) | SATISFIED | `isGatewayConnected` guard before `claimTask` in `tick()`; Test 6 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | - |

No `TODO`/`FIXME`/`PLACEHOLDER` comments, no `return null`/`return []` stubs, no `any`/`@ts-ignore`/`@ts-expect-error`, no `process.env` direct reads, and no `instance-manager` imports found in any Phase 20 files.

### Human Verification Required

#### 1. Live Gateway Round-Trip (End-to-End Streaming)

**Test:** Create an agent with a `hosted_instance` runtime pointing to a running Aquarium instance. Assign an issue to that agent. Wait 4 seconds.
**Expected:** `agent_task_queue` row transitions `queued → dispatched → running → completed`; `task_messages` table has rows with `type IN ('text','tool_use','tool_result','thinking')` and monotonically increasing `seq`.
**Why human:** Requires a live OpenClaw gateway container reachable via the persistent-WS client; Docker must be running and `openclaw-net` bridge network must exist.

#### 2. Gateway Disconnect Resilience (HOSTED-06 Live Path)

**Test:** Start a dispatch (task in `dispatched` state), then stop the gateway container mid-flight (e.g. `docker stop <instance>`). Wait 6 seconds. Observe task status.
**Expected:** Task remains `queued` (worker skips ticks while `isGatewayConnected` returns false); no `failed` transition.
**Why human:** Requires live Docker; cannot simulate real WS disconnection deterministically in unit tests without a running gateway.

#### 3. Boot Orphan Sweep on Real Server Kill (HOSTED-04 Live Path)

**Test:** Start the server with a task in `dispatched` status for a hosted_instance runtime. Send SIGKILL to the server process. Start the server again. Immediately check the task row.
**Expected:** Within boot (before first HTTP listen), the task is `failed` with `error='hosted-orphan-on-boot'`. The server logs `[hosted-orphan-sweep] failed 1 hosted-orphan task(s) on boot` followed by `[task-reaper] started` in that order.
**Why human:** Requires real SIGKILL + server restart; unit tests cover the SQL logic but not the OS-level kill + process restart sequence.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are verified by code that exists in HEAD. The 3 human verification items above are live-server integration tests that cannot be automated without a real Docker environment — they do not represent missing implementation.

---

_Verified: 2026-04-17T07:19:55Z_
_Verifier: Claude (gsd-verifier)_
