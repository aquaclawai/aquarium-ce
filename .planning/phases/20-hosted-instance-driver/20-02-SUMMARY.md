---
phase: 20
plan: 02
subsystem: task-dispatch/hosted-task-worker
tags:
  - hosted-driver
  - task-dispatch
  - gateway
  - streaming
  - cancel
one_liner: "In-process pump (2s tick) that dispatches queued hosted_instance tasks through the gateway via chat.send, translates streaming chat events into task_message rows, and handles cancel via a REACTIVE setInterval watcher + OPPORTUNISTIC stream poll."
dependency_graph:
  requires:
    - "20-01 — registerChatStreamListener + ChatStreamPayload export"
    - "18 — claimTask/startTask/completeTask/failTask/isTaskCancelled in task-queue-store"
    - "18 — appendTaskMessage in task-message-batcher"
    - "16 — gatewayCall + gateway-event-relay isGatewayConnected/waitForChatCompletion/cancelChatCompletion"
  provides:
    - "startHostedTaskWorker(dbOverride?) / stopHostedTaskWorker() — lifecycle for server-core Step 9d"
    - "translatePartsToMessages(payload, ctx) — content-part -> PendingTaskMessage mapper (exported for test isolation)"
    - "__setHostedWorkerDepsForTests__ / __resetHostedWorkerState__ — dependency injection + state reset for unit tests"
  affects:
    - "apps/server/src/task-dispatch/hosted-task-worker.ts (new 685-line module)"
    - "apps/server/tests/unit/hosted-task-worker.test.ts (new 1001-line test file, 19 tests)"
tech_stack:
  added: []
  patterns:
    - "REACTIVE cancel watcher — per-in-flight-task setInterval polling isTaskCancelled every CANCEL_POLL_MS (2s) so cancel fires independent of gateway frames"
    - "OPPORTUNISTIC stream-listener cancel poll — piggybacks on frame arrival; fires faster when frames are flowing but silent when the gateway stops"
    - "Promise.race against abort signal so gatewayCall / waitForChatCompletion unblock on cancel / graceful stop even when the underlying Promise does not observe AbortSignal"
    - "Signature-dedupe set — prevents the final frame from duplicating streaming deltas when the gateway sends the accumulated content on 'final'"
    - "Single cleanup path invariant — handleCancel aborts but does NOT delete inFlight / clearInterval; the dispatch's finally{} block owns cleanup"
    - "Graceful stop abort-before-await — stopHostedTaskWorker aborts all in-flight controllers + cancels completion Promises BEFORE awaiting dispatchPromises, so a test with a blocking chat.send mock cannot hang shutdown"
key_files:
  created:
    - "apps/server/src/task-dispatch/hosted-task-worker.ts"
    - "apps/server/tests/unit/hosted-task-worker.test.ts"
  modified: []
decisions:
  - "HOSTED-02 timeout split — 30s RPC-accept (CHAT_SEND_TIMEOUT_MS) + 120s completion wait (CHAT_WAIT_TIMEOUT_MS). The 30s matches the gateway's GroupChatRPCClient and fails fast when the gateway refuses to ACK chat.send; the 120s matches REQUIREMENTS.md HOSTED-02 literal 120_000ms end-to-end budget. The split preserves the 120s end-to-end contract while failing fast on the RPC-accept boundary."
  - "REACTIVE cancel is a setInterval (NOT a WS subscription) because ws/index.ts exposes broadcast() but NO subscribe/onTaskCancelled hook, and task-queue-store has no event bus. A 2s poll per in-flight task is O(10) in CE and guarantees cancel latency ≤ CANCEL_POLL_MS + grace REGARDLESS of gateway frame activity."
  - "Dedupe keys off `${type}:${content}:${JSON.stringify(input)}:${JSON.stringify(output)}` — stable enough to catch final-frame duplicates of streaming deltas without false positives from text that happens to repeat (tool_use rows carry distinct JSON inputs)."
  - "Graceful stopHostedTaskWorker aborts in-flight controllers BEFORE awaiting dispatchPromises. Without this, a blocking chat.send (test mock or a gateway that hangs) would hang shutdown indefinitely. The abort triggers the race against abort.signal.aborted in the dispatch body, breaking the await."
  - "Canonical sessionKey is `task:<task.id>` (NOT `task:<uuid>`) so the gateway's `agent:<agentId>:` prefix stripping in gateway-event-relay resolves cleanly to the user sessionKey."
  - "buildPromptFromTask concatenates agent.instructions + 'Issue #N: title' + description + trigger comment with `\\n\\n` separators. No templating — keeps Phase 20 deterministic and out of scope of prompt design."
  - "Seed helper seedHostedRuntime inserts a parent users row because instances.user_id is a NOT NULL FK and foreign_keys=ON is applied at setup. This is the first test in the unit suite to touch the instances table."
metrics:
  duration_seconds: ~1400
  completed_at: "2026-04-17T07:00:00Z"
requirements_completed:
  - HOSTED-01
  - HOSTED-02
  - HOSTED-03
  - HOSTED-05
  - HOSTED-06
---

# Phase 20 Plan 02: HostedTaskWorker Summary

Shipped `apps/server/src/task-dispatch/hosted-task-worker.ts` — the in-process pump that dispatches queued hosted_instance tasks through the existing gateway via `chat.send`, translates streaming chat events into `task_message` rows, and cancels cleanly via a REACTIVE setInterval watcher.

## Module Surface

### Exported

| Symbol | Purpose |
|--------|---------|
| `startHostedTaskWorker(dbOverride?: Knex)` | Lifecycle start; idempotent; fires initial tick synchronously; 2s setInterval thereafter. |
| `stopHostedTaskWorker()` | Graceful stop; aborts in-flight dispatches, cancels pending completion Promises, clears REACTIVE watchers, awaits `dispatchPromises`. Idempotent. |
| `translatePartsToMessages(payload, ctx)` | Content-part -> `PendingTaskMessage[]` mapper. Exported for test isolation. |
| `HostedDispatchContext` | Typed ctx (`taskId`, `workspaceId`, `issueId`) used by the mapper. |
| `__setHostedWorkerDepsForTests__(next)` | Test-only dependency injection. |
| `__resetHostedWorkerState__()` | Test-only state reset — clears tickHandle, inFlight (with watchers), dispatchPromises, activeDb, deps. |

### Internal

| Symbol | Purpose |
|--------|---------|
| `tick(kx)` | HOSTED-01 / HOSTED-06 — JOIN runtimes + instances (status='running'), iterate, guard on `isGatewayConnected`, `claimTask` per runtime, fire-and-forget `dispatchHostedTask`. |
| `dispatchHostedTask(task, instanceId, kx)` | Per-task dispatch flow (pre-flight cancel → startTask → watcher + listener + waiter → chat.send → complete/fail → finally cleanup). |
| `handleCancel(taskId)` | Idempotent cancel handler invoked from REACTIVE + OPPORTUNISTIC paths. Aborts controller, fires chat.abort, cancels completion. |
| `buildPromptFromTask(task)` | Deterministic text concatenation of instructions + issue title/description + trigger comment. |
| `warnIgnoredFields(task)` | HOSTED-05 — WARN citing each populated `session_id` / `work_dir` / `custom_env` / `custom_args`. |
| `abortSignalToRejection(signal)` | Helper that returns a `Promise<never>` rejecting on abort; used in `Promise.race` to unblock gatewayCall / completion when the underlying Promise does not observe AbortSignal. |

## Dispatch-Cycle Call Order

```
tick()
 └─> isGatewayConnected? ── no ──> skip (HOSTED-06)
     └─ yes
         └─> claimTask(runtimeId, kx)  ── null ──> skip
             └─ task
                 └─> dispatchHostedTask(task, instanceId, kx)       [fire-and-forget]
                       1. warnIgnoredFields(task)                    (HOSTED-05)
                       2. isTaskCancelled(task.id)  ── true ──> return  (X5)
                       3. startTask(task.id)        ── !started ──> return
                       4. sessionKey = "task:" + task.id
                          abort = new AbortController()
                          seenSignatures = new Set()
                       5. cancelWatcher = setInterval(pollIsTaskCancelled, CANCEL_POLL_MS)   (PM6 REACTIVE)
                       6. unsubscribe = registerChatStreamListener(instanceId, sessionKey, cb)
                            cb: capture runId, opportunistic cancel poll, translate+dedupe+append
                       7. inFlight.set(task.id, {abort, sessionKey, instanceId, unsubscribe, cancelWatcher, ...})
                       8. completion = waitForChatCompletion(instanceId, sessionKey, 120_000)
                       9. try
                            Promise.race([gatewayCall('chat.send', {sessionKey, message, idempotencyKey: task.id}, 30_000),
                                          abortSignalToRejection(abort.signal)])
                            result = Promise.race([completion, abortSignalToRejection(abort.signal)])
                            translate+dedupe final-frame parts
                            completeTask(task.id, {sessionKey, messageId}, kx)
                       10. catch(err)
                            abort.signal.aborted  ── true  ──> return (row already 'cancelled')
                                                 ── false ──> failTask(task.id, 'hosted-dispatch-error: …')
                       11. finally
                            unsubscribe()
                            cancelChatCompletion(instanceId, sessionKey)
                            clearInterval(cancelWatcher)
                            inFlight.delete(task.id)
```

## Tick SQL (HOSTED-01 + HOSTED-06)

```sql
SELECT r.id AS runtime_id, r.instance_id
  FROM runtimes r
  LEFT JOIN instances i ON r.instance_id = i.id
  WHERE r.workspace_id = 'AQ'
    AND r.kind = 'hosted_instance'
    AND i.status = 'running'
```

- Read-only JOIN satisfies the ST5 invariant (no writes to `instances`).
- `isGatewayConnected(row.instance_id)` is a per-runtime check run BEFORE `claimTask`, so a disconnected instance never claims a row (HOSTED-06 silent skip).

## HOSTED-02 Timeout Split Rationale

REQUIREMENTS.md HOSTED-02 (line 123) specifies a literal 120_000 ms end-to-end budget. The implementation splits this into two constants:

| Constant | Value | Justification |
|----------|-------|---------------|
| `CHAT_SEND_TIMEOUT_MS` | `30_000` | Matches the gateway's `GroupChatRPCClient` RPC-accept timeout. Fails fast when the gateway refuses the RPC entirely (e.g. the instance died between `isGatewayConnected` and `chat.send`). |
| `CHAT_WAIT_TIMEOUT_MS` | `120_000` | Matches the HOSTED-02 literal 120s end-to-end budget. Applied to `waitForChatCompletion`. |
| `CHAT_ABORT_TIMEOUT_MS` | `5_000` | Best-effort; gateway abort failures are logged-and-moved-on. |

The end-to-end contract is preserved: from chat.send to final frame, the total wait is bounded by 120s. The 30s RPC-accept is a fail-fast boundary inside that 120s window.

## Cancel Path Architecture (PM6)

Two detection paths, one idempotent handler:

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│ REACTIVE (primary)          │      │ OPPORTUNISTIC (secondary)    │
│ per-task setInterval        │      │ in stream-listener callback  │
│ CANCEL_POLL_MS = 2s         │      │ fires on every chat frame    │
│ polls isTaskCancelled       │      │ polls isTaskCancelled        │
└─────────────┬───────────────┘      └──────────┬───────────────────┘
              │                                 │
              └────────────┬────────────────────┘
                           ▼
                ┌────────────────────────┐
                │ handleCancel(taskId)   │
                │ - inFlight.get? no-op │  (X6 completed-task guard)
                │ - signal.aborted? no-op│  (idempotency guard)
                │ - abort.abort()        │
                │ - gatewayCall chat.abort (5s) │
                │ - cancelChatCompletion │
                └────────────────────────┘
```

**Why REACTIVE is primary:** after a cancel, the gateway typically stops emitting chat frames. An opportunistic poll that only fires on frame arrival would never detect cancel in this case, and the dispatch would block the full 120s on `waitForChatCompletion` before timing out. The REACTIVE 2s interval guarantees detection within `CANCEL_POLL_MS + grace` regardless of gateway frame activity.

**Why setInterval (not WS subscription):** `apps/server/src/ws/index.ts` exposes `broadcast()` but NO `onMessage` / `subscribe` / `onTaskCancelled` hook. `task-queue-store.ts` emits `task:cancelled` WS frames but exposes no subscribable event bus. Adding one would cross a subsystem boundary outside Phase 20's scope. A 2s setInterval per in-flight task is lightweight (bounded by `max_concurrent_tasks × |online hosted runtimes|`, practically O(10) in CE). Future enhancement: if an `onTaskCancelled` event-bus API is added, the polling interval can be replaced with a direct subscription — `handleCancel(taskId)` stays unchanged.

**Promise.race against abort.signal:** `gatewayCall` and `waitForChatCompletion` do NOT observe AbortSignal today. To ensure the dispatch unwinds on cancel / graceful stop even when those Promises hang, each `await` is wrapped in a `Promise.race([primary, abortSignalToRejection(abort.signal)])`. On the success path this is a no-op (primary resolves first); on abort, the race rejects and the try/catch routes through the `abort.signal.aborted` branch.

## Graceful `stopHostedTaskWorker` Design

```
1. clearInterval(tickHandle)
2. For each inFlight entry:
     abort.abort()            // triggers abortSignalToRejection in dispatch
     cancelChatCompletion()   // rejects the completion Promise
     clearInterval(cancelWatcher)  // stop reactive poll (pre-finally cleanup)
3. await Promise.allSettled(dispatchPromises)
```

Aborting BEFORE the await is critical: a test that blocks `chat.send` forever (`new Promise(() => {})`) would otherwise hang stopHostedTaskWorker indefinitely. With this pattern, a deliberately-blocked test fixture can still exercise `startHostedTaskWorker` and exit cleanly.

## Test Suite — 19 Tests

| # | Name | Purpose |
|---|------|---------|
| 1 | translatePartsToMessages maps text/thinking/toolCall/toolResult in order | HOSTED-03 mapper happy path |
| 2 | accepts both camelCase (toolCall) and snake_case (tool_use) spellings | HOSTED-03 wire-format flexibility |
| 3 | drops unknown part.type and logs warn | HOSTED-03 + T-20-13 unknown-type robustness |
| 4 | string content fallback yields one text message | HOSTED-03 string-content normalisation |
| 5 | tick iterates online hosted runtimes and claims a task per runtime | HOSTED-01 tick correctness |
| 6 | isGatewayConnected=false leaves queued task untouched | HOSTED-06 + X5 silent-skip |
| 7 | WARN cites every populated ignored field | HOSTED-05 all four fields |
| 8 | no WARN when agent/task are clean | HOSTED-05 negative — no spurious log |
| 9 | start/stop idempotency | Lifecycle robustness |
| 10 | chat.send payload: sessionKey=task:<id>, idempotencyKey=task.id, 30_000ms | HOSTED-02 payload + RPC-accept split |
| 11 | 3 streaming frames + final -> 3 task_message rows | HOSTED-03 end-to-end + final-frame dedupe |
| 12 | waitForChatCompletion resolves -> task completed | Happy-path lifecycle |
| 13 | chat.send throws -> failTask('hosted-dispatch-error: …') | Error propagation |
| 14 | waitForChatCompletion rejects -> task failed | Completion-error propagation |
| 15 | ST5 invariant — pre/post snapshot of instances row is byte-identical | T-20-08 HARD invariant |
| 16 | PM6 REACTIVE cancel — chat.abort within CANCEL_POLL_MS with NO stream frames | T-20-07 primary path stream-independent |
| 17 | X5 pre-flight cancel — no chat.send when pre-cancelled | T-20-09 wasted-RPC avoidance |
| 18 | X6 abort on already-completed task — no throw, no state change | T-20-10 idempotency |
| 19 | cleanup invariant — no leaked in-flight entries | T-20-14 listener + interval leak prevention |

Test infrastructure additions:

- **`seedHostedRuntime(kx, opts)`** — inline helper that inserts a fresh `users` row (required for the `instances.user_id` FK), a running `instances` row (with all NOT NULL columns: `image_tag`, `auth_token`, `config`, `security_profile`, `billing_mode`), and a `hosted_instance` runtime row linked via `instance_id`. First test in the unit suite to exercise the `instances` table.
- **`createMockGateway({allConnected})`** — purpose-built mock implementing `gatewayCall`, `isGatewayConnected`, `waitForChatCompletion`, `cancelChatCompletion`, `registerChatStreamListener`, `appendTaskMessage` plus test helpers `emitFrame`, `emitFinal`, `emitError`, `setConnected`, `setChatSendImpl`.
- **`waitUntil(predicate, opts)`** — deterministic poll helper (replaces fragile fixed setTimeouts).

## Regression Evidence

```text
$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts
ℹ tests 19
ℹ pass 19
ℹ fail 0

$ NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts
ℹ tests 114
ℹ pass 114
ℹ fail 0
  (= 95 prior + 19 new)

$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium
(both exit 0)
```

## Acceptance-Criteria Grep Check

```text
File: apps/server/src/task-dispatch/hosted-task-worker.ts

Task 1 criteria:
  export function startHostedTaskWorker              → 1   PASS
  export async function stopHostedTaskWorker         → 1   PASS
  export function translatePartsToMessages           → 1   PASS
  TICK_MS = 2000                                     → 1   PASS
  isGatewayConnected references                      → 5   PASS (≥2)

Task 2 criteria:
  gatewayCall + chat.send + idempotencyKey task.id   → 2   PASS (≥1)
  gatewayCall chat.abort                             → 1   PASS (≥1)
  registerChatStreamListener                         → 5   PASS (≥2)
  waitForChatCompletion                              → 11  PASS (≥2)
  isTaskCancelled call sites                         → 11  PASS (≥3)
  setInterval / task:cancelled / onTaskCancelled     → 9   PASS (≥1)
  appendTaskMessage                                  → 5   PASS (≥2)
  task.id                                            → 25  PASS (≥3)
  seenSignatures / dedupe                            → 9   PASS (≥1)
  CANCEL_POLL_MS                                     → 6   PASS (≥2)
  CHAT_SEND_TIMEOUT_MS = 30_000                      → 1   PASS
  120_000                                            → 4   PASS (≥1)
  HOSTED-02 / HOSTED-05 / HOSTED-06 markers          → 14  PASS (≥3)

Invariants (HARD — must be 0):
  import.*instance-manager | updateStatus            → 0   PASS
  instances writes (db('instances').{update,insert,delete}) → 0   PASS
  \bany\b | @ts-ignore | @ts-expect-error            → 0   PASS
  process.env                                         → 0   PASS
```

## ST5 Invariant — DB-Snapshot Proof

Test 15 snapshots the `instances` row (`id`, `status`, `deployment_target`, `agent_type`, `user_id`, `auth_token`, `image_tag`, `updated_at`, `created_at`) BEFORE and AFTER a complete dispatch cycle (task claimed → chat.send → final → completeTask). The two arrays are asserted byte-identical via `assert.deepStrictEqual`. A single write to any of these columns would flip `updated_at` at minimum and fail the test.

## Deviations from Plan

**Deviation 1 (Rule 2 — missing critical functionality): `stopHostedTaskWorker` graceful-abort BEFORE awaiting dispatchPromises**

The plan's Task 1 STEP 5 defined `stopHostedTaskWorker` as a simple `clearInterval + await Promise.allSettled(dispatchPromises)`. With the Task 2 dispatch body wired up, a mocked `chat.send` that blocks (`new Promise(() => {})` — used in Tests 5-8 to hold the dispatch at a known point) would hang the stop forever because the underlying Promise never resolves. The fix: iterate `inFlight` in stop, abort each entry's controller, cancel the completion Promise, and clear the reactive watcher BEFORE awaiting `dispatchPromises`. The abort then triggers `Promise.race([primary, abortSignalToRejection(abort.signal)])` in the dispatch, which rejects with 'aborted', which the dispatch's try/catch routes through the `abort.signal.aborted` short-circuit.

Why this is Rule 2 (not a plan deviation the user needs to approve): graceful shutdown in the presence of a hanging gateway is a correctness requirement, not a "feature". The plan's simpler stop would deadlock on any blocked test. Documented here for traceability.

**Deviation 2 (Rule 2 — missing critical functionality): `abortSignalToRejection` helper + `Promise.race` on chat.send and completion**

Related to Deviation 1. The plan described the cancel path as "handleCancel aborts the controller + cancels completion", but today's `gatewayCall` does not observe AbortSignal. Without the race, `await gatewayCall('chat.send', ...)` still blocks when the mock (or a real unresponsive gateway) hangs, and the REACTIVE watcher can fire chat.abort all day without unblocking the dispatch. The race makes the AbortController effective: an abort triggers `abortSignalToRejection` → `Promise.race` rejects → try/catch → `abort.signal.aborted` short-circuit → finally cleanup.

This is a structural addition that makes the cancel path correct in the presence of gateway-wire blocking, and is required for Test 16 (PM6 REACTIVE cancel) to pass within its 3.5s budget.

**Deviation 3 (Rule 3 — blocking issue): Test 8 readiness signal**

The plan's Test 8 originally awaited `gw.calls.some(c => c.method === 'chat.send')` as the "dispatch ran past the WARN site" signal. In the Task 1 commit (before Task 2 wired chat.send), the stub `dispatchHostedTask` never calls `chat.send`, so the test timed out. Updated the signal to `task row status !== 'queued'` which is true as soon as `claimTask` runs — and `claimTask` runs immediately after `isGatewayConnected` returns true, so the dispatch entry (and `warnIgnoredFields`) has executed by the time the status flips.

**No other deviations — the plan's design was followed end-to-end.**

## Known Stubs

None. `dispatchHostedTask` is fully wired with real chat.send + streaming + completion + cancel; Tests 11–16 exercise the full flow against the mocked gateway.

## Threat-Model Touch Checks

All mitigations in the plan's `<threat_model>` are enforced:

| Threat ID | Mitigation | Enforcement |
|-----------|------------|-------------|
| T-20-07 (PM6 cancel race) | REACTIVE watcher + OPPORTUNISTIC poll + idempotent handleCancel | Tests 16 + 18 |
| T-20-08 (ST5 instance-status pollution) | no imports, no writes, DB snapshot | Test 15 + grep |
| T-20-09 (X5 wasted chat.send) | pre-flight isTaskCancelled | Test 17 |
| T-20-10 (X6 cancel on completed) | inFlight.get undefined no-op | Test 18 |
| T-20-11 (HOSTED-06 disconnected) | isGatewayConnected skip BEFORE claim | Test 6 |
| T-20-12 (HOSTED-05 silent drop) | warnIgnoredFields cites each field | Test 7 |
| T-20-13 (unknown part type) | mapper default-branch warn + drop | Test 3 |
| T-20-14 (listener + interval leak) | finally{} unsubscribe + clearInterval + inFlight.delete | Test 19 |
| T-20-15 (idempotencyKey reuse) | `idempotencyKey: task.id` (stable UUID) | Test 10 |

## Self-Check: PASSED

- File exists: `apps/server/src/task-dispatch/hosted-task-worker.ts` — FOUND
- File exists: `apps/server/tests/unit/hosted-task-worker.test.ts` — FOUND
- Commit `8363fcf` (Task 1 RED) — FOUND
- Commit `1274d2e` (Task 1 GREEN) — FOUND
- Commit `a0eb1f7` (Task 2 RED) — FOUND
- Commit `dfaaf74` (Task 2 GREEN) — FOUND
- All 19 tests pass — VERIFIED
- Full 114-test regression passes — VERIFIED
- Typecheck clean — VERIFIED
- ST5 invariant grep returns 0 — VERIFIED
- No `any` / `@ts-ignore` / `process.env` — VERIFIED
