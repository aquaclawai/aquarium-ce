# Phase 20: Hosted-Instance Driver — Research

**Researched:** 2026-04-16
**Domain:** in-process task dispatch worker bridging agent_task_queue rows to gateway `chat.send` RPC + event-stream translation into `task_message` rows
**Confidence:** HIGH (all gateway + queue primitives already exist; no external library research required)

## Summary

Phase 20 ships a single in-process module, `apps/server/src/task-dispatch/hosted-task-worker.ts`, that acts as a thin pump between two surfaces the platform already owns:

1. **Task-queue-store (Phase 18)** — `claimTask`, `startTask`, `completeTask`, `failTask`, `isTaskCancelled`, plus the `task-message-batcher.appendTaskMessage` ingest point.
2. **Gateway-event-relay (Phase 11/12/13)** — the persistent `PersistentGatewayClient` per running instance, driven by `gatewayCall(instanceId, method, params, timeoutMs)` with an already-queued-when-disconnected behaviour, plus the co-existing `waitForChatCompletion` / `cancelChatCompletion` callback surface and a whitelisted `chat.send` / `chat.abort` method pair.

The worker ticks every 2 s, iterates `runtimes WHERE kind='hosted_instance' AND status='online'` (derived via LEFT JOIN on `instances.status`), and for each online runtime calls `claimTask(runtimeId)`. If a task is returned it forks a dispatch promise that (a) `startTask`, (b) subscribes to `waitForChatCompletion(instanceId, sessionKey)`, (c) reads gateway `chat` events as they stream (via a new listener hook wired into gateway-event-relay's existing `chat` event router), (d) translates each streamed content part into an `appendTaskMessage` call with 1:1 type mapping, (e) on `state='final'` resolves with `completeTask`, (f) on `state='error'` or RPC throw calls `failTask`, (g) on `task:cancelled` broadcast or user-cancel poll invokes `gatewayCall(instanceId, 'chat.abort', { sessionKey, runId }, 5_000)` AND trips an `AbortController` for the in-flight promise.

Boot-time (server-core.ts Step 9b, slotted BEFORE Step 9c task-reaper per ROADMAP Phase 26 SC-1): a single sweep fails all `agent_task_queue` rows with `status IN ('dispatched','running')` whose agent's `runtime.kind='hosted_instance'`. Reason string: `'hosted-orphan-on-boot'`. This runs once on cold start so the user does not wait 5 min (task-reaper DISPATCH_STALE_MS) for the reaper to clean up — HOSTED-04.

**Primary recommendation:** Build `HostedTaskWorker` as a small state-free module with `startHostedTaskWorker()` / `stopHostedTaskWorker()` exports matching the Phase 18 task-reaper + Phase 16 offline-sweeper shape. A per-process `inFlight: Map<taskId, {abort: AbortController, sessionKey: string, instanceId: string}>` prevents double-claim within a single tick window. All runtime state flows through the existing persistent WS client — NO new WS subscription or connection management is needed.

## User Constraints

This phase has no CONTEXT.md. The phase description, HOSTED-01..06 requirements, and ROADMAP success criteria constitute the constraint set, reproduced verbatim in **Phase Requirements** below.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOSTED-01 | In-process `HostedTaskWorker` polls every 2s per online `hosted_instance` runtime | §HostedTaskWorker Design — one global `setInterval(2000)` that iterates online hosted runtimes per tick; per-runtime polling proven equivalent with simpler semantics |
| HOSTED-02 | Invokes `gatewayCall(instanceId, 'chat.send', …, 120_000)` reusing persistent-WS client | §Gateway RPC Surface — `gatewayCall` facade at `agent-types/openclaw/gateway-rpc.ts:12` already accepts timeoutMs; `chat.send` is already whitelisted |
| HOSTED-03 | Gateway `text / toolCall / toolResult / thinking` events → `task_message` rows (1:1 type mapping) | §Event-to-Row Translation — gateway emits content parts as `{type:'text',text} \| {type:'toolCall',arguments} \| {type:'toolResult',...} \| {type:'thinking',thinking}`; map to `TaskMessageType: 'text'/'tool_use'/'tool_result'/'thinking'` |
| HOSTED-04 | On server restart, fail all hosted tasks in `dispatched`/`running` during boot | §Boot Orphan Cleanup — one-shot SELECT+UPDATE at server-core Step 9b BEFORE task-reaper (Step 9c) |
| HOSTED-05 | Ignore `session_id`, `work_dir`, `custom_env`, `custom_args` with WARN log | §Ignored Fields Handling — single `console.warn` per dispatch with cited fields; still proceed with `chat.send` |
| HOSTED-06 | Gateway disconnected → worker tick silently skips (task stays queued) | §Gateway Disconnect Handling — tick reads `isGatewayConnected(instanceId)` from gateway-event-relay; returns early per runtime without claim or fail |

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | already installed (used by gateway-event-relay) | WebSocket client to gateway | Established in Phase 9-13 — not changing |
| knex + better-sqlite3 | already installed | task_queue + task_messages DB writes | Phase 18 pattern (`withImmediateTx`, `dbOverride`) |
| `node:test` + `tsx` | already installed | unit tests for mapper, boot-orphan sweep, skip-on-disconnect | Matches Phase 18 / 19 (see `apps/server/tests/unit/README.md`) |
| `@aquarium/shared` | workspace dep | `TaskMessageType`, `ClaimedTask`, `AgentTask` | Frozen in Phase 15 / 18 |

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| One-global-tick `setInterval(2000)` iterating online hosted runtimes | Per-runtime `setInterval` registered on runtime online, cleared on offline | Adds a subscription-lifecycle surface area (runtime-registry event emitter) that does not exist today. Global tick iterates <=N hosted runtimes (CE typical: 1–3) — cost is trivial. |
| New listener hook on gateway-event-relay chat-event router | Fresh WS connection per task | Would double the gateway WS connections and duplicate the connect.challenge / reconnect / ping-pong machinery already in PersistentGatewayClient (gateway-event-relay.ts:197) |
| AbortController inside `gatewayCall` (chat.send) | Rely on 120s timeout | AbortController support would require widening the PersistentGatewayClient.call surface; it's simpler to use `gatewayCall(instanceId, 'chat.abort', …)` which the gateway already supports (§Cancel/Abort Semantics) |

**Installation:** None — zero new npm dependencies.

**Version verification:** Not applicable (no new deps).

## Gateway RPC Surface

**Confidence:** HIGH — verified from `apps/server/src/agent-types/openclaw/gateway-rpc.ts:12–26`, `services/gateway-event-relay.ts:583–622,793–801`, and `routes/rpc-proxy.ts:11–38`.

### `gatewayCall` function signature

```typescript
// apps/server/src/agent-types/openclaw/gateway-rpc.ts:12
export async function gatewayCall(
  instanceId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown>;
```

**Behaviour (verified from PersistentGatewayClient.call at gateway-event-relay.ts:583):**
- If `getGatewayClient(instanceId)` returns null (no client created yet, e.g. instance not running) → throws synchronously with `'No gateway connection for instance <id>. Instance may not be running or persistent client not yet created.'`
- If client exists and is connected → `sendRPC` puts a `{type:'req', id, method, params}` frame on the wire and returns a Promise that resolves with `msg.result ?? msg.payload` or rejects with `'Gateway RPC error: <msg.error?.message>'` / `'Gateway RPC timeout: <method> (<timeoutMs>ms)'`.
- If client exists but is not connected → the call is queued (max depth 50 with oldest-reject overflow) and drained on reconnect. Timeout is honoured against the original window, so a long disconnect can cause `'Gateway RPC queue timeout: <method> (<timeoutMs>ms)'`.

**Implications for Phase 20:** the worker's `chat.send` dispatch is **not** atomic with the tick. If the WS is up, the request goes out immediately. If it is disconnected mid-dispatch, the RPC enters the queue with the 120s window; it will either fire on reconnect or time-out as an Error. Phase 20 interprets the timeout as a `failTask` condition; a queued-but-not-yet-sent call is fine because the gateway ultimately receives a single `chat.send` or the 120s elapses.

### Currently supported RPC methods

Verified whitelist from `apps/server/src/routes/rpc-proxy.ts:11-38`:

```
chat.send, chat.abort, chat.history,
sessions.*, agents.list, agents.files.*, health,
exec.approval.resolve, logs.tail, models.list,
tools.catalog, tools.effective,
skills.status, skills.search,
cron.*
```

The rpc-proxy whitelist is the **UI-accessible** subset; the persistent client itself does not gate methods (`PersistentGatewayClient.sendRPC` just puts the frame on the wire). Phase 20 runs in-process and does **not** go through rpc-proxy, so the whitelist is informational: it confirms `chat.send` and `chat.abort` are accepted by the gateway. [VERIFIED: grep against `apps/server/src/routes/rpc-proxy.ts:12-13`]

### `chat.send` payload shape

Verified from `apps/server/src/agent-types/openclaw/gateway-rpc.ts:164-197` (`GroupChatRPCClient.sendChat`) and corroborated by `tests/e2e/chat-streaming.spec.ts:141-154` + `tests/e2e/chat-complete.spec.ts:107-112`:

```typescript
await gatewayCall(instanceId, 'chat.send', {
  sessionKey: string,       // opaque; gateway prepends 'agent:<agentId>:' server-side
  message: string,          // user prompt
  idempotencyKey: string,   // UUID — recommended for retry safety
  attachments?: Array<{     // optional; Phase 20 will not set this
    type: 'image' | 'file',
    mimeType: string,
    content: string,        // base64
    fileName?: string,
  }>,
}, timeoutMs = 120_000);
```

The RPC **returns synchronously** once the gateway has accepted the request — the actual LLM streaming happens asynchronously through `event: 'chat'` frames. Phase 20 sends `chat.send` with a short 30s timeout (matching `GroupChatRPCClient`'s internal RPC call at gateway-rpc.ts:183) and separately awaits completion via the `chat` event stream out to 120s.

## Gateway Event Shape

**Confidence:** HIGH (verified) + MEDIUM (content-part structure). Sources: `gateway-event-relay.ts:425-499` (chat-event router + `waitForChatCompletion`), `agent-types/openclaw/gateway-rpc.ts:130-151` (`extractTextFromContent`), and `apps/web/src/components/chat/MessageRenderer.tsx:7-55` (confirms the content-part taxonomy the gateway emits).

### Event frame structure

The gateway sends each streaming update as a top-level frame of the form:

```typescript
{
  type: 'event',
  event: 'chat',
  payload: {
    sessionKey: string,           // 'agent:<agentId>:<userSessionKey>' — gateway-prefixed
    state: 'streaming' | 'final' | 'error',
    messageId?: string,
    role?: 'user' | 'assistant',
    content?: unknown,            // top-level fallback — may carry the final content
    message?: {                   // canonical streaming vehicle
      role: 'assistant',
      content: ContentPart[] | string,
    },
    errorMessage?: string,        // only present when state === 'error'
  },
}
```

**State semantics (confirmed from `waitForChatCompletion` at gateway-event-relay.ts:437-454):**
- `state='streaming'` → partial content update; multiple frames per turn
- `state='final'` → resolve with `{ sessionKey, state:'final', content: message.content ?? content, role, messageId }`
- `state='error'` → reject with `new Error(errorMessage || 'Agent run failed')`

### ContentPart taxonomy (payload.message.content[*].type)

Verified from `extractTextFromContent` (gateway-rpc.ts:130-151) which branches on `part.type === 'text'` and `part.type === 'toolCall'`, confirmed by `MessageRenderer.tsx:48-55` which declares the union `TextBlock | ImageBlock | FileBlock | ThinkingBlockType | ToolUseBlock | ToolResultBlock`:

| Part type | Fields | TaskMessage mapping (HOSTED-03) |
|-----------|--------|---------------------------------|
| `'text'` (or `'output_text'`, `'input_text'`) | `{ type, text: string }` | `type='text'`, `content=text` |
| `'thinking'` | `{ type:'thinking', thinking: string, signature?: string }` | `type='thinking'`, `content=thinking` |
| `'toolCall'` (gateway wire format) **or** `'tool_use'` (Claude-style) | `{ type, id?, name: string, arguments?: Record<string,unknown> \| string, input?: unknown }` | `type='tool_use'`, `tool=name`, `input=arguments ?? input` |
| `'toolResult'` (gateway wire format) **or** `'tool_result'` (Claude-style) | `{ type, tool_use_id: string, content: string \| Array<{type,text}>, is_error?: boolean }` | `type='tool_result'`, `tool=<lookup from tool_use>`, `output=content`, `metadata.toolUseId=tool_use_id`, `metadata.isError=is_error` |

**Important note on naming drift:** the gateway source uses `toolCall` / `toolResult` (camelCase) while Claude's native stream-json uses `tool_use` / `tool_result` (snake_case). The MessageRenderer accepts both via the `ToolUseBlock` / `ToolResultBlock` unions. Phase 20 MUST handle both spellings in the mapper. The `TaskMessageType` enum in `packages/shared/src/v14-types.ts:156` is `'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error'` — note Phase 20 writes **snake_case** `tool_use` / `tool_result` to the DB regardless of wire format. [VERIFIED: grep `TaskMessageType` + `extractTextFromContent`]

### Event routing and the "sessionKey prefix strip"

Gateway-event-relay already strips the `agent:<agentId>:` prefix before routing to chat-session subscribers and the `waitForChatCompletion` callback (gateway-event-relay.ts:431):

```typescript
const userSessionKey = rawSessionKey.replace(/^agent:[^:]+:/, '');
```

Phase 20 generates a per-task sessionKey (recommended: `task:<taskId>` or `hosted:<taskId>`) and uses it verbatim for `chat.send` / `waitForChatCompletion` / `chat.abort`. The gateway sends events back with the prefixed form; the existing strip in gateway-event-relay makes this transparent.

### How Phase 20 receives streaming events

Today, only `waitForChatCompletion` sees chat events — and only the terminal state (final/error). Phase 20 needs every streaming frame so it can produce a `task_message` row per content-part delta.

**Recommended approach:** extend gateway-event-relay with a second hook alongside the existing chatEventCallbacks map, e.g. `onChatStream(instanceId, sessionKey, (payload) => void)` that fires for **every** `state !== 'final' && state !== 'error'` frame (plus final with the trailing content). The hook signature mirrors `waitForChatCompletion` but is a subscription (multi-shot) rather than a one-shot Promise. Cleanup: auto-removed when `waitForChatCompletion` resolves/rejects.

**Rationale:** we avoid adding a module-level EventEmitter surface to gateway-event-relay; we also avoid widening the `ChatEventData` type. The new hook lives in the same file so the chat-event router (gateway-event-relay.ts:425-499) can invoke it inline after the existing `callback.resolve(...)` branch.

## Cancel/Abort Semantics

**PRIMARY ROADMAP RESEARCH OUTPUT.** **Confidence: HIGH.**

### Answer: the gateway DOES support a cancel RPC (`chat.abort`).

Evidence:
1. `'chat.abort'` is present in the rpc-proxy whitelist at `apps/server/src/routes/rpc-proxy.ts:13`. [VERIFIED: grep]
2. The web UI invokes it with `{ sessionKey, runId? }` params: `apps/web/src/components/chat/ChatTab.tsx:565` — `rpc(instanceId, 'chat.abort', runIdToAbort ? { sessionKey, runId: runIdToAbort } : { sessionKey }).catch(() => {});`. [VERIFIED: grep]
3. `docs/gateway-communication-analysis.md:81` catalogues `chat.abort` as the "Cancel active generation" method. [VERIFIED: grep]

### `chat.abort` payload

```typescript
await gatewayCall(instanceId, 'chat.abort', {
  sessionKey: string,   // required — same key used in chat.send
  runId?: string,       // optional — narrows the abort to a specific run; the web UI
                        // passes it when it has captured a runId from an earlier event,
                        // and omits it otherwise. Phase 20 should omit it unless the
                        // gateway exposes the runId in the stream.
}, 5_000);
```

Best-effort semantics: the web UI catches-and-ignores errors (`.catch(() => {})`), confirming `chat.abort` may fail (e.g. already completed) and that is acceptable. Phase 20 does the same: log at `warn` but do not fail the task over an abort RPC failure — the DB `cancelled` state is already set by `cancelTask`.

### Hosted-cancel end-to-end contract

Phase 20 handles cancellation in two coordinated ways to close the race between the DB flip and the gateway still streaming:

1. **Reactive path (WS broadcast — preferred):** the worker subscribes to WS `task:cancelled` events (broadcast by `cancelTask` / `cancelAllTasksForIssue` / `cancelPendingTasksForIssueAgent` — all shipped in 18-01/18-04). When the event arrives for a task in its `inFlight` map, it:
   - Fires `gatewayCall(instanceId, 'chat.abort', { sessionKey }, 5_000).catch(warn)` (no await of the outer promise).
   - Calls `cancelChatCompletion(instanceId, sessionKey)` (gateway-event-relay.ts:842) to reject the in-flight `waitForChatCompletion` promise.
   - Aborts the dispatch AbortController; the dispatch promise unwinds cleanly without calling `failTask` (because the task is already `cancelled`; `completeTask`/`failTask` would return `{ discarded: true }` anyway per TASK-06).

2. **Polling fallback (safety net):** between streamed events the worker checks `isTaskCancelled(taskId)` at a low interval (every 5 s, piggy-backing on chat event arrivals — **not** a separate setInterval; the worker only polls *when an event arrives and has been mapped*). If cancelled, same `chat.abort` + abort path.

**Reason for both paths:** WS broadcasts can drop in rare cases (connection churn); the 5s poll provides CLI-06-equivalent latency. Neither is critical individually — either alone satisfies the success criterion "worker responds to user cancel within seconds" — but together they close the race for zero additional cost (the poll is a single indexed SELECT).

### AbortController support in the gateway client

`PersistentGatewayClient.call` does NOT accept an AbortSignal — the code path from `gateway-event-relay.ts:583-622` uses `setTimeout(..., timeoutMs)` only. Phase 20 does **not** try to add AbortSignal support to the persistent client (out of scope). Cancellation is handled via `chat.abort` + `cancelChatCompletion` + the worker's own AbortController (which gates the outer `dispatchHostedTask` promise, not the individual RPC frames).

### Summary for the planner

- `chat.abort` exists; no new gateway protocol work needed.
- The worker cancel flow is: WS `task:cancelled` → `chat.abort` RPC + `cancelChatCompletion` + worker AbortController → dispatch promise unwinds → skip `completeTask`/`failTask` (or call one and accept `{discarded:true}`).
- No poll-interval setInterval is introduced solely for cancellation; the 2s tick + between-event `isTaskCancelled` check satisfy the contract.

## Instance Lifecycle Invariant

**HARD constraint ST1 (already proven in Phase 16):** `instances.status` is written by `updateStatus` in `apps/server/src/services/instance-manager.ts:70-73` **and only there**. Phase 16-02 verified this by `grep "db('instances').*\\.update"` against `task-dispatch/runtime-bridge.ts` (zero matches).

**Phase 20's corresponding invariant:** `apps/server/src/task-dispatch/hosted-task-worker.ts` MUST satisfy:

```bash
grep -nE "db\\(['\"]instances['\"]\\).*\\.(update|insert|delete)" apps/server/src/task-dispatch/hosted-task-worker.ts
# expect: zero matches
grep -nE "updateStatus" apps/server/src/task-dispatch/hosted-task-worker.ts
# expect: zero matches (the worker never calls instance-manager.updateStatus)
```

The worker reads runtime availability via `runtime-registry.listAll(workspaceId)` which derives `runtime.status` for hosted rows via the `CASE WHEN i.status='running' THEN 'online'` LEFT JOIN (runtime-registry.ts:78-88). This is a **read path**; no writes to either `instances` or `runtimes.status` for hosted rows happen in the worker.

Even on `chat.send` timeout or gateway-offline error, the worker does **not** touch instance status — it only flips the task row (`failTask` or leaves it queued per HOSTED-06). The instance's own status is managed by `instance-manager.reconcileInstances` + the health-monitor; Phase 20 is a consumer of that state, not a producer.

**Success criterion 5 (ROADMAP §Phase 20 SC-5) verification plan:** write a unit test that spies on `updateStatus` (e.g. by re-exporting it through a mockable indirection, or by asserting `db('instances')` table state pre/post dispatch). The simpler version asserts the `instances.status`, `instances.updated_at`, and `instances.runtime_id` columns are byte-identical before and after a hosted dispatch cycle. See §Validation Architecture.

## HostedTaskWorker Design

**Confidence:** HIGH (pattern verified against offline-sweeper.ts + task-reaper.ts + gateway-event-relay.ts).

### Module: `apps/server/src/task-dispatch/hosted-task-worker.ts`

**Public surface:**

```typescript
export function startHostedTaskWorker(dbOverride?: Knex): void;
export function stopHostedTaskWorker(): Promise<void>;

// Testing hooks (Phase 18/19 pattern):
export function __setHostedWorkerDepsForTests__(deps: HostedWorkerDeps): void;
export function __resetHostedWorkerState__(): void;

// Boot-orphan sweep (exported so server-core Step 9b calls it BEFORE startTaskReaper):
export async function failOrphanedHostedTasks(dbOverride?: Knex): Promise<{ failed: number }>;
```

**Dependencies (injected for testability):**

```typescript
interface HostedWorkerDeps {
  gatewayCall: typeof gatewayCall;
  isGatewayConnected: (instanceId: string) => boolean;
  waitForChatCompletion: typeof waitForChatCompletion;
  cancelChatCompletion: typeof cancelChatCompletion;
  onChatStream: (instanceId: string, sessionKey: string, cb: (payload: ChatStreamPayload) => void) => () => void;
  // default = real implementations; tests inject mocks
}
```

### Tick shape (HOSTED-01)

```typescript
const TICK_MS = 2000;
let tickHandle: ReturnType<typeof setInterval> | null = null;
const inFlight = new Map<string /* taskId */, {
  abort: AbortController,
  sessionKey: string,
  instanceId: string,
  startedAt: number,
}>();

export function startHostedTaskWorker(dbOverride?: Knex): void {
  if (tickHandle) return;
  // Initial tick (don't wait 2s on cold start).
  tick(dbOverride).catch(logWarn);
  tickHandle = setInterval(() => tick(dbOverride).catch(logWarn), TICK_MS);

  // Subscribe once to task:cancelled broadcasts (for reactive-cancel path).
  onTaskCancelled((taskId) => handleCancel(taskId));
}

async function tick(kx: Knex): Promise<void> {
  // 1. List online hosted runtimes for the CE workspace ('AQ').
  //    In CE this typically yields 1–3 rows; the query is a single indexed JOIN.
  const hostedOnline = await kx('runtimes as r')
    .leftJoin('instances as i', 'r.instance_id', 'i.id')
    .where('r.workspace_id', 'AQ')
    .andWhere('r.kind', 'hosted_instance')
    .andWhere('i.status', 'running')
    .select('r.id as runtime_id', 'r.instance_id');

  // 2. Per runtime: skip if gateway disconnected (HOSTED-06), else claim + dispatch.
  for (const row of hostedOnline) {
    if (!isGatewayConnected(row.instance_id)) continue;
    const claimed = await claimTask(row.runtime_id, kx);
    if (!claimed) continue;
    // Fire-and-forget dispatch so next runtime's claim can proceed this tick.
    dispatchHostedTask(claimed, kx).catch((err) => {
      console.warn('[hosted-task-worker] dispatch crashed for', claimed.id, ':', err?.message ?? err);
      // Safety net: failTask on uncaught error. discarded:true if already cancelled.
      failTask(claimed.id, `hosted-worker-crash: ${err?.message ?? err}`, kx).catch(() => {});
    });
  }
}
```

### Dispatch cycle (per task)

```typescript
async function dispatchHostedTask(task: ClaimedTask, kx: Knex): Promise<void> {
  // 0. Resolve the hosted instance id from the runtime row (task.runtimeId).
  const runtimeRow = await kx('runtimes').where({ id: task.runtimeId }).first('instance_id');
  const instanceId = runtimeRow?.instance_id as string | undefined;
  if (!instanceId) {
    await failTask(task.id, 'hosted-runtime-missing-instance_id', kx);
    return;
  }

  // 1. Warn about ignored fields (HOSTED-05).
  const ignored: string[] = [];
  if (task.sessionId) ignored.push('session_id');
  if (task.workDir) ignored.push('work_dir');
  if (task.agent.customEnv && Object.keys(task.agent.customEnv).length > 0) ignored.push('custom_env');
  if (task.agent.customArgs && task.agent.customArgs.length > 0) ignored.push('custom_args');
  if (ignored.length > 0) {
    console.warn(
      `[hosted-task-worker] ignoring ${ignored.join(', ')} for task ${task.id} (hosted_instance runtime)`
    );
  }

  // 2. Mark as running. If startTask returns { started: false } the task was already
  //    claimed elsewhere or cancelled between claim + now; bail.
  const started = await startTask(task.id, kx);
  if (!started.started) return;

  // 3. Register in-flight state (for reactive cancel).
  const sessionKey = `task:${task.id}`;
  const abort = new AbortController();
  inFlight.set(task.id, { abort, sessionKey, instanceId, startedAt: Date.now() });

  // 4. Build the prompt from issue + trigger comment.
  const prompt = buildPromptFromTask(task);

  // 5. Subscribe to streamed chat events BEFORE chat.send so no frames are missed.
  const unsubscribe = onChatStream(instanceId, sessionKey, (payload) => {
    for (const msg of translatePartsToMessages(payload, task)) {
      appendTaskMessage(task.id, msg);
    }
    // Poll cancel between events (5s SLA fallback, cheap indexed read).
    void isTaskCancelled(task.id, kx).then((cancelled) => {
      if (cancelled) handleCancel(task.id);
    });
  });

  // 6. Register the completion waiter BEFORE firing chat.send.
  const completion = waitForChatCompletion(instanceId, sessionKey, 120_000);
  completion.catch(() => {});  // prevent unhandled rejection

  try {
    // 7. Fire chat.send. 30s RPC-accept timeout (matches GroupChatRPCClient convention).
    //    The 120s actual window is tracked by waitForChatCompletion above.
    await gatewayCall(instanceId, 'chat.send', {
      sessionKey,
      message: prompt,
      idempotencyKey: task.id,  // task id is a UUID — naturally unique.
    }, 30_000);

    // 8. Await final/error frame.
    const result = await completion;

    // 9. Persist any trailing content parts (final frame often carries the full message).
    for (const msg of translatePartsToMessages(result, task, { isFinal: true })) {
      appendTaskMessage(task.id, msg);
    }

    // 10. Mark completed. Handles TASK-06 cancelled-race via { discarded: true }.
    await completeTask(task.id, { sessionKey, messageId: result.messageId }, kx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (abort.signal.aborted) {
      // Normal cancel unwind — task row already `cancelled` by cancelTask.
      return;
    }
    await failTask(task.id, `hosted-dispatch-error: ${msg}`, kx);
  } finally {
    unsubscribe();
    cancelChatCompletion(instanceId, sessionKey);
    inFlight.delete(task.id);
  }
}

function handleCancel(taskId: string): void {
  const entry = inFlight.get(taskId);
  if (!entry) return;  // either not-in-flight or already cleaned up
  entry.abort.abort();
  // Best-effort gateway abort — web UI does the same.
  gatewayCall(entry.instanceId, 'chat.abort', { sessionKey: entry.sessionKey }, 5_000)
    .catch((err) => console.warn('[hosted-task-worker] chat.abort failed:', err?.message ?? err));
  cancelChatCompletion(entry.instanceId, entry.sessionKey);
  inFlight.delete(taskId);
}
```

### Concurrency guard (AGENT-02, per-agent max_concurrent_tasks)

`claimTask` (task-queue-store.ts:520-574) already enforces `agent.max_concurrent_tasks` via the inner subquery:

```sql
AND (SELECT COUNT(*) FROM agent_task_queue c
     WHERE c.agent_id = q.agent_id
       AND c.status IN ('dispatched','running')) < a.max_concurrent_tasks
```

No additional work in Phase 20. The worker simply calls `claimTask(runtimeId)` and trusts the service.

**Concurrent-dispatch safety within a single tick:** the tick is serial (iterates runtimes, awaiting each `claimTask` but not the subsequent `dispatchHostedTask` — that's fire-and-forget). This preserves the invariant that two concurrent `claimTask` calls in the same process still serialise through the `BEGIN IMMEDIATE` transaction. Between ticks: a task still in `inFlight` is by definition in `running` status, so the next tick's `claimTask` subquery sees it as one of the `a.max_concurrent_tasks` slots and will not re-claim it.

### Why NOT extend offline-sweeper or task-reaper

Same rationale as Phase 18-03 and Phase 16-03: keep each timer single-purpose. Runtime liveness (offline-sweeper), task reaping (task-reaper), and hosted dispatch (this file) have different SLAs, different failure modes, and different test surfaces. A single grep for `setInterval` across task-dispatch/ should still list one timer per concern.

## Event-to-Row Translation

**Confidence:** MEDIUM on specific content-part field names (gateway source not available in this repo); HIGH on target shape (TaskMessage schema is frozen in migration 007).

### Mapper contract

```typescript
interface HostedDispatchContext {
  taskId: string;
  workspaceId: string;
  issueId: string;
}

function translatePartsToMessages(
  payload: { message?: { content?: unknown }; content?: unknown; state?: string },
  ctx: HostedDispatchContext,
  opts?: { isFinal?: boolean },
): PendingTaskMessage[] {
  const parts = extractParts(payload);  // normalises string | array | {text} | {content} shapes
  const out: PendingTaskMessage[] = [];

  for (const part of parts) {
    const t = (part as any)?.type;
    switch (t) {
      case 'text':
      case 'output_text':
      case 'input_text':
        out.push({
          type: 'text',
          content: String((part as any).text ?? ''),
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'thinking':
        out.push({
          type: 'thinking',
          content: String((part as any).thinking ?? (part as any).text ?? ''),
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'toolCall':  // gateway wire format
      case 'tool_use':  // Claude-style (also seen from some agent backends)
        out.push({
          type: 'tool_use',
          tool: String((part as any).name ?? ''),
          input: (part as any).arguments ?? (part as any).input ?? null,
          metadata: (part as any).id ? { toolUseId: (part as any).id } : {},
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'toolResult':  // gateway wire format
      case 'tool_result':  // Claude-style
        out.push({
          type: 'tool_result',
          tool: null,  // tool name lookup would require in-worker state; leave null
          output: (part as any).content ?? (part as any).result ?? null,
          metadata: {
            toolUseId: (part as any).tool_use_id ?? (part as any).toolUseId ?? null,
            isError: Boolean((part as any).is_error ?? (part as any).isError ?? false),
          },
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'image':
      case 'image_url':
      case 'file':
        // Not in TaskMessageType union; emit as text row with a sentinel so the UI
        // has SOMETHING to render; or skip with a warn. Recommend skip + warn.
        console.warn(`[hosted-task-worker] dropping unsupported content part type '${t}' for task ${ctx.taskId}`);
        break;
      default:
        console.warn(`[hosted-task-worker] unknown content part type '${t}' for task ${ctx.taskId}`);
    }
  }

  return out;
}
```

### One row per content-part — NOT merged

Recommendation: emit exactly one `task_message` row per content part, even across successive streaming frames that repeat prefixes. Reasoning:

- The `(task_id, seq)` UNIQUE index (migration 007) gives strict per-task ordering; the UI can coalesce at render time.
- Mem-level dedup across frames would require in-worker streaming-diff logic — error-prone and out of scope for Phase 20.
- The task-message-batcher (task-message-batcher.ts:34-88) already batches at 500ms with a 500-msg soft cap, so insert cost is bounded.
- `TaskMessageType='error'` is reserved for dispatch errors; the mapper never emits `'error'` for tool_result `is_error=true` — that goes in `metadata.isError` on a `tool_result` row.

### The final-frame double-write question

`waitForChatCompletion` (gateway-event-relay.ts:437-448) resolves with `message.content ?? content` on `state='final'`. Many gateway implementations send the full accumulated content in the final frame, not just a delta. To avoid duplicating earlier streaming parts:

- Recommendation: in `translatePartsToMessages(result, task, {isFinal:true})`, only emit parts the mapper has not already seen this task. Keep a per-task `Set<string>` of seen-part-signatures (e.g. `${type}:${hashContent(part)}`). Cleared when dispatch completes.

This is a correctness-nice-to-have, not a blocker — if the final frame duplicates, the UI sees two otherwise-identical rows with distinct `seq`. The **user** sees them as two messages though, which is ugly. Plan decision: include the dedupe set.

## Boot Orphan Cleanup

**HOSTED-04 requirement:** fail all hosted tasks in `dispatched|running` at boot, do not wait 5 min for task-reaper.

### Single-sweep function

```typescript
export async function failOrphanedHostedTasks(dbOverride?: Knex): Promise<{ failed: number }> {
  const kx = dbOverride ?? defaultDb;
  const now = new Date().toISOString();

  // Select hosted orphans: tasks dispatched|running whose agent's runtime is hosted_instance.
  const rows = (await kx('agent_task_queue as q')
    .join('runtimes as r', 'r.id', 'q.runtime_id')
    .where('r.kind', 'hosted_instance')
    .whereIn('q.status', ['dispatched', 'running'])
    .select('q.id', 'q.issue_id', 'q.workspace_id', 'q.status')) as Array<{
      id: string; issue_id: string; workspace_id: string; status: 'dispatched' | 'running';
    }>;

  if (rows.length === 0) return { failed: 0 };

  const ids = rows.map((r) => r.id);
  // ST6 race guard: re-apply status filter on UPDATE — no concurrent daemon writes are
  // possible this early in boot (Step 9b runs before HTTP listens + task-reaper Step 9c),
  // but the guard is cheap and matches task-reaper.ts:84 / 96.
  const failed = await kx('agent_task_queue')
    .whereIn('id', ids)
    .whereIn('status', ['dispatched', 'running'])
    .update({
      status: 'failed',
      error: 'hosted-orphan-on-boot',
      completed_at: now,
      updated_at: now,
    });

  // Broadcast task:failed per row AFTER commit (single-statement UPDATE autocommits).
  for (const r of rows) {
    broadcast(r.workspace_id, {
      type: 'task:failed',
      taskId: r.id,
      issueId: r.issue_id,
      payload: { taskId: r.id, issueId: r.issue_id },
    });
  }

  console.log(`[hosted-task-worker] failed ${failed} hosted-orphan task(s) on boot`);
  return { failed };
}
```

### Server-core wiring

Boot-order (server-core.ts:236-347), per ROADMAP Phase 26 SC-1 ordering "Step 9a → 9b → 9c → 9d → 9e":

```
Step 9a: runtimeBridgeReconcile  (Phase 16 — EXISTING line 305)
Step 9b: failOrphanedHostedTasks (Phase 20 — NEW, goes here)
Step 9c: startTaskReaper         (Phase 18 — EXISTING line 326)
Step 9d: startHostedTaskWorker   (Phase 20 — NEW, after reaper)
Step 9e: startRuntimeOfflineSweeper (Phase 16 — EXISTING line 330)
```

**Why 9b BEFORE 9c:** if 9c's initial reaper sweep runs first, hosted orphans older than 5 min would be reaped with `'Reaper: dispatched > 5 min without start'` — the wrong error. HOSTED-04 requires `'hosted-orphan-on-boot'` as the reason. 9b runs first, flips all hosted dispatched/running rows to failed with the correct error, then 9c's sweep finds nothing to do (for hosted tasks) and proceeds to reap any daemon orphans.

**Why 9d AFTER 9c:** startHostedTaskWorker's initial tick could race with the boot-orphan sweep if they ran in either order without the 9b prerequisite — but 9b runs synchronously *before* 9c so by the time 9d starts ticking, the DB is clean.

## Ignored Fields Handling

**HOSTED-05 contract:** log WARN citing the field names, still dispatch.

```typescript
const ignored: string[] = [];
if (task.sessionId) ignored.push('session_id');
if (task.workDir) ignored.push('work_dir');
if (Object.keys(task.agent.customEnv ?? {}).length > 0) ignored.push('custom_env');
if ((task.agent.customArgs ?? []).length > 0) ignored.push('custom_args');
if (ignored.length > 0) {
  console.warn(
    `[hosted-task-worker] ignoring ${ignored.join(', ')} for task ${task.id} (hosted_instance runtime — use a daemon runtime for per-task CLI args/env)`,
  );
}
```

**Format spec (used by SC-4 test):**
- Prefix: `[hosted-task-worker] ignoring`
- List of fields (comma-separated) — the SC-4 test asserts the string `custom_env` appears in the log output.
- Suffix explaining why and pointing at the daemon runtime.

**Never fail the task over this.** The task proceeds to `chat.send` regardless of ignored fields; the assumption is the agent's baked-in config covers the runtime environment (the instance already has its own env, work_dir inside the container, etc.). If the user wants per-task overrides, they must pick a daemon runtime.

## Gateway Disconnect Handling

**HOSTED-06 contract:** disconnected → skip tick, leave task queued, do not fail.

Gateway connection state is exposed by `isGatewayConnected(instanceId)` (gateway-event-relay.ts:798):

```typescript
export function isGatewayConnected(instanceId: string): boolean {
  const client = connections.get(instanceId);
  return !!(client && client.isConnected);
}
```

**Worker logic:**

```typescript
for (const row of hostedOnline) {
  if (!isGatewayConnected(row.instance_id)) {
    // Silent skip — task stays queued, next tick (2s later) tries again.
    continue;
  }
  const claimed = await claimTask(row.runtime_id, kx);
  // ... dispatch
}
```

**Why this satisfies HOSTED-06:**
- The SELECT of online hosted runtimes already filtered by `i.status='running'`, but the instance could be `running` yet the gateway-event-relay's WS could have dropped (e.g. during a gateway restart window).
- `claimTask` is NOT called in the disconnected case — so no task transitions from `queued → dispatched`. The task stays `queued` and the next tick retries.
- **Zero failTask calls on the disconnect path.**

**Edge case — mid-dispatch disconnect:** if the WS drops AFTER `claimTask` but BEFORE `chat.send` returns, the `gatewayCall` path will either queue the request (for up to 30s) or throw with `'Gateway connection lost for instance <id>'`. Phase 20 treats this as a dispatch error → `failTask`. Rationale: the task already transitioned `queued → dispatched`, so we cannot silently restore it to `queued` (per SC-5 / ST6 the transition is one-way). A failed task is better than a limbo task; user can re-enqueue. This is a deviation from HOSTED-06 but matches the spirit: HOSTED-06 specifically says "worker silently skips its tick" — that means BEFORE claim. POST-claim failures follow the standard task-failure contract.

**Reconnect resume:** after the WS reconnects (PersistentGatewayClient exponential backoff with 30s cap, gateway-event-relay.ts:563-581), `isGatewayConnected` flips true; the next 2s tick picks up any `queued` tasks and dispatches them. ROADMAP SC-2 ("resumes within 2 seconds of reconnection") is satisfied by the tick interval.

## Pitfalls and Mitigations

From `.planning/PITFALLS.md` (canonical source referenced throughout the codebase). Phase 20 owns: **PM6, ST5, X5, X6.**

### PM6 — Hosted cancel race (chat.abort vs completion arrival)

**Scenario:** user hits Cancel at moment T. `cancelTask` flips status to `cancelled` + broadcasts `task:cancelled`. Worker receives broadcast at T+Δ. Between T and T+Δ the gateway emits `state='final'` — now both the completion resolves AND the cancel fires.

**Mitigation:**
1. `completeTask` (task-queue-store.ts:626-663) reads status first and returns `{discarded:true, status:'cancelled'}` if already cancelled — no throw, no DB change. The worker's code path:
   ```typescript
   await completeTask(task.id, result, kx);  // may return {discarded:true} — ignored
   ```
2. The WS `task:cancelled` broadcast has already fired (from cancelTask), so the UI sees the cancel. A second broadcast from the worker is not needed.
3. The worker's `finally` block cleans up the `inFlight` entry regardless of which branch wins.

**Test:** Integration test spawns a dispatch, cancels at T+50ms, has the mocked gateway emit `state='final'` at T+100ms, asserts final task status is `cancelled` (not `completed`) and asserts `task:cancelled` broadcast fired exactly once.

### ST5 — Streaming seq out of order across tasks

**Scenario:** two hosted tasks run concurrently on different agents. Events from task A interleave with events from task B.

**Mitigation:** the `(task_id, seq)` UNIQUE index (migration 007) + MAX(seq)+1 per-task computation in task-message-batcher.ts:195-205 guarantees **per-task** monotonicity. Across tasks, seq numbers are unrelated — this is correct and expected. Phase 20 does nothing additional; the batcher already handles this.

**Test:** unit test seeds two tasks, calls `appendTaskMessage` alternately for each, flushes, asserts each task's messages have strictly increasing seq starting from 1 independently.

### X5 — chat.send fires while task is already cancelled (double-read)

**Scenario:** user cancels between `startTask` and `gatewayCall('chat.send')`. Worker sends chat.send anyway — the gateway starts an LLM call that will be wasted.

**Mitigation:**
1. `isTaskCancelled(task.id)` check inside `dispatchHostedTask` immediately after `startTask.started=true` and before `gatewayCall`. If cancelled, skip the chat.send + call `chat.abort` + early-return.
2. The race window between this check and the RPC is ~1ms — acceptable. If cancellation lands in that 1ms window, the WS `task:cancelled` broadcast path (subscribed at startup) fires `chat.abort` for the in-flight RPC.

**Code snippet:**
```typescript
const preFlightCancelled = await isTaskCancelled(task.id, kx);
if (preFlightCancelled) {
  console.log(`[hosted-task-worker] task ${task.id} cancelled before dispatch, skipping`);
  return;  // no chat.send, no completeTask/failTask (already cancelled)
}
```

### X6 — chat.abort on already-completed task

**Scenario:** `state='final'` arrives, worker calls `completeTask`, before the `finally` block runs the user hits Cancel. Worker's cancel handler fires `chat.abort` on a session the gateway has already closed.

**Mitigation:** `chat.abort` is best-effort (web UI does `.catch(() => {})` at `ChatTab.tsx:565`). Phase 20 logs at `warn` level and moves on. The task row state is already `completed`; a late cancel on it is a no-op via cancelTask's `.whereIn('status', ['queued','dispatched','running'])` guard (task-queue-store.ts:742-749).

**Test:** unit test seeds a completed task, calls `handleCancel` directly, asserts no throw and no DB mutation.

## Runtime State Inventory

Phase 20 is a **new module** — no rename/refactor. Skipping per execution-flow Step 2.5.

## Environment Availability

Phase 20 has no external tool / service / CLI dependencies beyond what Phase 16-19 already ship:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥22 | everything | ✓ | — | — |
| better-sqlite3 | task_queue + task_messages writes | ✓ | (existing pin) | — |
| `ws` | PersistentGatewayClient | ✓ | (existing pin) | — |
| openclaw gateway instance with protocol v3 | chat.send / chat.abort | runtime-dependent | — | If no hosted instance runtimes exist at runtime, the worker's `hostedOnline` query returns 0 rows — worker becomes a no-op. No crash. |

Step 2.6: all external dependencies are already present from prior phases; Phase 20 adds none.

## Validation Architecture

**nyquist_validation is enabled** (workflow.nyquist_validation absent from config → treated as true per guide).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test + tsx (already in `apps/server/package.json` devDeps) |
| Config file | none — run via `npx tsx --test apps/server/tests/unit/*.test.ts` |
| Quick run command | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` |
| Full suite command | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOSTED-01 | Tick iterates online hosted runtimes, calls claimTask per | unit | `tsx --test apps/server/tests/unit/hosted-task-worker.test.ts -g "tick iterates"` | ❌ Wave 0 |
| HOSTED-02 | Dispatch calls `gatewayCall(instanceId, 'chat.send', {sessionKey, message, idempotencyKey}, 30_000)` | unit (mocked gateway spy) | `tsx --test … -g "chat.send payload"` | ❌ Wave 0 |
| HOSTED-03 | 4 part types map to 4 TaskMessageType values | unit (mapper isolation) | `tsx --test … -g "translatePartsToMessages"` | ❌ Wave 0 |
| HOSTED-04 | failOrphanedHostedTasks flips dispatched+running→failed with reason `hosted-orphan-on-boot` | unit | `tsx --test … -g "boot orphan sweep"` | ❌ Wave 0 |
| HOSTED-05 | WARN log includes each set ignored field name | unit (console.warn spy) | `tsx --test … -g "ignored fields"` | ❌ Wave 0 |
| HOSTED-06 | Disconnected gateway → tick does not call claimTask, task row unchanged | unit (mocked isGatewayConnected=false) | `tsx --test … -g "disconnect skip"` | ❌ Wave 0 |
| SC-1 | Hosted assign → task_message rows with correct types | integration (mock gateway) | `tsx --test … -g "integration dispatch cycle"` | ❌ Wave 0 |
| SC-2 | Gateway disconnected → queued, resumes within 2s of reconnect | integration | `tsx --test … -g "reconnect resume"` | ❌ Wave 0 |
| SC-3 | Server-kill mid-task + restart → all in-flight failed | unit (seed dispatched+running, call failOrphanedHostedTasks) | `tsx --test … -g "boot orphan sweep"` | ❌ Wave 0 |
| SC-4 | custom_env set → task completes + WARN log cites field | integration | `tsx --test … -g "ignored custom_env"` | ❌ Wave 0 |
| SC-5 | Hosted dispatch never writes `instances.status` | unit (snapshot instances row pre/post) | `tsx --test … -g "instances invariant"` | ❌ Wave 0 |
| PM6 | Cancel race — completeTask returns discarded:true on cancelled task | unit | `tsx --test … -g "cancel race discarded"` | ❌ Wave 0 |
| ST5 | Per-task monotonic seq across interleaved tasks | unit | `tsx --test … -g "monotonic seq cross-task"` | ❌ Wave 0 |
| X5 | Pre-flight isTaskCancelled skips chat.send | unit | `tsx --test … -g "preflight cancel skip"` | ❌ Wave 0 |
| X6 | chat.abort on completed task is no-op | unit | `tsx --test … -g "abort on completed"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts`
- **Per wave merge:** `npx tsx --test apps/server/tests/unit/*.test.ts`
- **Phase gate:** full suite green + Playwright E2E under tests/e2e/hosted-dispatch.spec.ts green (if planner schedules it; Phase 26 REL-01 owns the full E2E suite).

### Wave 0 Gaps
- [ ] `apps/server/tests/unit/hosted-task-worker.test.ts` — covers HOSTED-01..06 + SC-1..5 + PM6/ST5/X5/X6 (unit + mocked-integration tests)
- [ ] `apps/server/tests/unit/test-db.ts` — already exists from 18-01 (reuse `seedRuntime`, `seedAgent`, `seedIssue`, `seedTask` + extend with `seedHostedRuntime` helper if needed)
- [ ] Mock gateway harness: a minimal `MockGateway` helper that records `chat.send` / `chat.abort` calls and synthesises streamed `chat` event payloads for the worker's `onChatStream` listener. Lives in `apps/server/tests/unit/hosted-gateway-mock.ts`.
- [ ] **Dependency injection hook on hosted-task-worker:** `__setHostedWorkerDepsForTests__` (symmetric to Phase 18's `__setBatcherDbForTests__`). Tests swap `gatewayCall`, `isGatewayConnected`, `waitForChatCompletion`, `onChatStream` with mocks.
- [ ] **SC-5 spy mechanism:** simplest path = snapshot the `instances` row pre-dispatch, run the full dispatch, SELECT the row again, assert byte-equality on `status` + `updated_at` + `runtime_id` columns. (Avoids module-mocking of `updateStatus`, which node:test does not support ergonomically — this matches the Phase 18-04 test 15/16 decision to verify invariants via DB state rather than module mocks.)

## Security Domain

**security_enforcement: enabled** (absent from config → treated as enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (internal worker — no new auth surface) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Workspace-scoped listAll query (already enforced by runtime-registry — `workspace_id='AQ'` for CE) |
| V5 Input Validation | yes | Content-part types validated against `TaskMessageType` union; unknown types dropped with warn (never written to DB) |
| V6 Cryptography | no (no new crypto) | — |

### Known Threat Patterns for task-dispatch + gateway-RPC stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Gateway-emitted content part with `type='sql_injection'` — fake type string | Tampering | Mapper's `switch` has default `console.warn` + drop; no unknown type reaches DB. `task_messages.type` CHECK trigger (migration 007:112-131) is the backstop — trigger throws if a non-whitelisted type is inserted. |
| Gateway streams huge text content (>100MB) — DoS via task_messages | DoS | Per-part size check before `appendTaskMessage` — drop parts > 1MB with warn. task-message-batcher's BUFFER_SOFT_CAP=500 bounds in-memory growth; SQLite page size bounds per-row storage. |
| chat.abort fired with forged sessionKey | Spoofing | sessionKey is worker-internal (`task:<taskId>`); no external input path can forge it. The `inFlight` Map is the single source of truth — cancel flows only through `handleCancel(taskId)` which looks up the sessionKey from trusted in-memory state. |
| Gateway-emitted `toolResult` for an external command result the user never approved | Elevation of Privilege | Out of scope — gateway's own security model handles tool approval via `exec.approval.request` events; Phase 20 just records what the gateway reports. |
| Worker crash during dispatch leaves task in `running` forever | Availability | Task-reaper (Phase 18-03, running-stale threshold 2.5h) catches this. Boot-orphan sweep (§Boot Orphan Cleanup) catches it on next server start. |

### `Project Constraints (from CLAUDE.md)`

From `/Users/shuai/workspace/citronetic/aquarium-ce2/CLAUDE.md`:

| Constraint | Applies to Phase 20? | Compliance plan |
|-----------|----------------------|-----------------|
| ESM import: server `.ts` imports use `.js` extension | yes | `import { claimTask } from '../services/task-queue-store.js'` |
| Never `any` — use `unknown` + type guards | yes | `translatePartsToMessages` uses narrow casts inside `switch` |
| All API responses: `ApiResponse<T>` | no — Phase 20 has no HTTP routes | — |
| Shared types in `packages/shared/src/types.ts`, import as `@aquarium/shared` | yes | `TaskMessageType`, `ClaimedTask`, `AgentTask` come from `@aquarium/shared` |
| Naming: kebab-case files for server TS | yes | `hosted-task-worker.ts` |
| Request flow: Routes → Services → Runtime/DB | no — Phase 20 has no route | worker calls services directly, same as `task-reaper.ts` / `offline-sweeper.ts` |
| Never call `process.env` directly | yes | Read from `config.ts` if any new config needed (likely none — tick interval hard-coded at 2000ms per HOSTED-01) |
| Instance lifecycle only through InstanceManager | yes | Phase 20 never calls `updateStatus` — §Instance Lifecycle Invariant |
| Bug Fix Testing (global CLAUDE.md): every bug fix includes a regression test | yes | Phase 20 is feature-build; when bug fixes land post-ship, each must have a test. |

## Common Pitfalls

Project-specific pitfalls, captured so the planner and executor do not regress them.

### Pitfall 1: Forgetting to unsubscribe the chat-stream hook in the `finally` block

**What goes wrong:** hook accumulates across successive dispatches for the same instance; same-sessionKey collisions (`task:<taskId>`) can cross-wire events. Memory grows monotonically.

**Why it happens:** the subscription returns a disposer; easy to miss in a multi-branch try/catch.

**How to avoid:** capture `const unsubscribe = onChatStream(...)` and call `unsubscribe()` in `finally`. Assert in a unit test: after a completed dispatch cycle, the module-internal subscription count returns to zero.

**Warning signs:** `task_message` rows for task A arriving after task A is completed; duplicate entries.

### Pitfall 2: Calling `startTask` before the stream subscription is in place

**What goes wrong:** events between `startTask` return and `onChatStream` register are lost.

**Why it happens:** developer orders the code logically (start → subscribe → send) but the gateway-relay's chat-event router runs as soon as `chat.send` acknowledges.

**How to avoid:** order is **subscribe → register waitForCompletion → chat.send**. `startTask` can happen anywhere before chat.send; but prefer: subscribe → startTask check → waitForCompletion → chat.send.

### Pitfall 3: Using `chat.send`'s idempotencyKey as a new UUID per attempt

**What goes wrong:** gateway treats retries as fresh requests; partial double-charge / double-stream.

**Why it happens:** `randomUUID()` feels safe.

**How to avoid:** use `task.id` (itself a UUID) as the idempotency key. The task row is unique per dispatch attempt; Phase 18 `claimTask` only transitions `queued → dispatched` once.

### Pitfall 4: Running the worker twice in dev

**What goes wrong:** two processes claim the same task.

**Why it happens:** `tsx watch` restart can leave the old process alive briefly.

**How to avoid:** in CE mode there is one server process; double-start is prevented by the `if (tickHandle) return;` guard in `startHostedTaskWorker`. Tests that exercise the worker must call `stopHostedTaskWorker` in `afterEach` (returns a Promise — await it).

### Pitfall 5: Mis-identifying which column holds the instance id

**What goes wrong:** the worker tries `task.instanceId` (not a column) instead of joining through `runtimes.instance_id`.

**Why it happens:** `AgentTask` has `runtimeId` only; the mapping to `instance_id` requires the `runtimes` row.

**How to avoid:** fetch `runtime.instance_id` per-task or include it as a join in `claimTask`'s hydration. Recommended: hydrate inside the worker (`await kx('runtimes').where({id: task.runtimeId}).first('instance_id')`) — avoids widening `ClaimedTask` shape for a single consumer. The planner can choose to extend `hydrateClaimedTask` (task-queue-store.ts:450-497) to carry `runtime.kind` + `runtime.instance_id` if the cost of a second in-dispatch query is measured to matter.

## State of the Art

| Old Approach | Current Approach | Why |
|--------------|------------------|-----|
| Ephemeral WS per RPC (pre-Phase 9) | Persistent `PersistentGatewayClient` per instance with queued RPC + ping/pong liveness | RPC-01..05 (Phase 9) |
| `plugins.list` / other removed RPCs | `tools.catalog` + `config.get` (+ chat.send/chat.abort retained) | RPC-03, CLEAN-03 |
| WS callbacks by instance-scoped event broadcast | sessionKey-scoped `waitForChatCompletion` + `chat` event routing (gateway-event-relay.ts:425-499) | Enables multi-session-per-instance (group chats, Phase 20 task dispatch) |

**Deprecated/outdated:**
- `plugins.list` / `skills.list` / old RPC methods — removed in Phase 14.
- `{ type: 'subscribe' }` WS frame — gateway rejects it as INVALID_REQUEST (gateway-event-relay.ts:336-339 comment). Events flow to all authenticated connections automatically.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Gateway `chat` event content parts use `type:'toolCall'` (camelCase) per `extractTextFromContent` at gateway-rpc.ts:141 | Gateway Event Shape | LOW — if the real wire format is `tool_use` (snake_case), the mapper already handles both spellings in the switch statement. Zero-cost fallback. |
| A2 | Gateway `chat.abort` accepts `{ sessionKey, runId? }` — inferred from web UI call at ChatTab.tsx:565 | Cancel/Abort Semantics | LOW — web UI is live and works; payload is stable. If gateway version drift changes the params, log-and-move-on behaviour means the DB state is still correct (task already cancelled). |
| A3 | `onChatStream` hook can be added to gateway-event-relay without breaking existing subscribers | Gateway Event Shape / HostedTaskWorker Design | MEDIUM — requires touching a high-traffic file (gateway-event-relay.ts). Planner should verify by writing a test that existing `waitForChatCompletion` contract is preserved when `onChatStream` is added. The chat-event router at gateway-event-relay.ts:425-499 already has the extensibility point (after existing callback fires, call any registered stream hooks). |
| A4 | Gateway's final frame can repeat content already sent as streaming frames (requiring dedupe in §Event-to-Row Translation) | Event-to-Row Translation | LOW — if gateway only sends deltas, the dedupe set is a no-op. If it sends the full message on final, the dedupe prevents duplicate rows. Both behaviours result in the same end state; dedupe is defence. |
| A5 | `runtime.kind = 'hosted_instance' AND instances.status='running'` is the correct set of runtimes the worker should poll | HostedTaskWorker Design | LOW — Phase 16 RT-04 locks this invariant. Any drift would break the runtime listing UI too, so any bug here is caught by existing Phase 16 Playwright tests. |
| A6 | The per-instance gateway WS connection is established *before* the worker's first tick | HostedTaskWorker Design | MEDIUM — `startGatewayEventRelay()` runs at server-core Step pre-9 (line 299); Phase 20's worker starts at Step 9d (AFTER 9a-9c). By 9d, the relay has had ~1s to establish connections. If a hosted instance is added AFTER boot, the 10s gateway-event-relay poll catches it (gateway-event-relay.ts:702-745). HOSTED-06's "gateway disconnected → skip" covers the transient window. |

**Confirmation plan:** for A1 and A3, the planner should spec a 15-minute discovery task as Task 0 of Plan 20-01: "Read the gateway's chat-event emission code (in the openclaw-gateway repo, not this repo) and confirm the content-part type strings. Extend the mapper's switch if the real strings differ." If the gateway source is unavailable to the planner, a live dev server + Wireshark/ws-dump of a chat-session confirms the shape in <5 min.

## Open Questions for Planner

1. **Should the worker watch the workspace ID at boot, or iterate all workspaces?**
   - CE ships with a single `'AQ'` workspace (migration 003 seed). Hard-coding is correct for CE and matches Phase 16's `DEFAULT_WORKSPACE_ID = 'AQ'` constant. EE will extend later.
   - **Recommendation:** hard-code `'AQ'`, document as CE-specific.

2. **Should the 2s tick be configurable via `config.ts`, or a module constant?**
   - HOSTED-01 says "every 2s" — no configurability promised.
   - **Recommendation:** module constant `TICK_MS = 2000`. If EE needs tuning later, promote to config.

3. **How does `onChatStream` clean up if `waitForChatCompletion` never resolves (RPC timeout)?**
   - The waitForChatCompletion Promise rejects on its own setTimeout (gateway-event-relay.ts:823-828). The worker's `finally` block calls `cancelChatCompletion` + `unsubscribe()`.
   - **Recommendation:** add an explicit assertion in the unit test that `cancelChatCompletion` fires in all error paths (timeout, chat.send throw, ws-close-during-wait).

4. **Should `task_message.type='error'` be emitted for gateway-side errors?**
   - Phase 20 currently uses `failTask(taskId, 'hosted-dispatch-error: …')` for gateway errors, which flows to `task_row.error`. It does NOT write a `task_message` error row.
   - **Trade-off:** writing an error row gives the UI a place to show the error inline in the timeline; writing only to `task_row.error` means the UI has to look at the task-state for the message.
   - **Recommendation:** emit one `task_message{type:'error', content:message}` row alongside `failTask`, so the UI's existing message-stream renderer shows the error without a special-case branch. This matches how the daemon path (Phase 21/22 BACKEND-01) will likely work.

5. **Is `runId` available from gateway chat events to narrow `chat.abort`?**
   - Web UI at `ChatTab.tsx:565` conditionally includes `runId` if captured from an earlier event.
   - **Recommendation:** Phase 20 omits `runId` for simplicity. If a future gateway version refuses `chat.abort` without `runId`, the planner can extend the mapper to capture `runId` from the first streaming frame and pass it to `handleCancel`.

6. **Does the worker need per-workspace concurrency limiting?**
   - The existing `agent.max_concurrent_tasks` cap is per-agent. The worker has no per-workspace cap.
   - **Recommendation:** no — let the per-agent cap do the work. If the planner later identifies a "fire-hose of tasks across many agents in one workspace" scenario, add a semaphore; for CE single-workspace that's not realistic.

## Sources

### Primary (HIGH confidence)

- `apps/server/src/agent-types/openclaw/gateway-rpc.ts:12-26` — `gatewayCall` signature and behaviour
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts:130-151` — `extractTextFromContent` showing content-part taxonomy (text, toolCall)
- `apps/server/src/agent-types/openclaw/gateway-rpc.ts:153-197` — `GroupChatRPCClient` showing chat.send + waitForChatCompletion + cancelChatCompletion flow
- `apps/server/src/services/gateway-event-relay.ts:425-499` — chat event router; state='final'/'streaming'/'error' semantics
- `apps/server/src/services/gateway-event-relay.ts:583-622` — PersistentGatewayClient.call + sendRPC behaviour
- `apps/server/src/services/gateway-event-relay.ts:793-801` — isGatewayConnected + getGatewayClient
- `apps/server/src/services/gateway-event-relay.ts:808-850` — waitForChatCompletion + cancelChatCompletion public API
- `apps/server/src/services/task-queue-store.ts:126-786` — Phase 18 lifecycle + withImmediateTx + claim/start/complete/fail/cancel/isTaskCancelled semantics
- `apps/server/src/task-dispatch/task-message-batcher.ts:34-253` — appendTaskMessage contract + BUFFER_SOFT_CAP
- `apps/server/src/task-dispatch/task-reaper.ts:1-170` — single-timer sweeper pattern (shape Phase 20 mirrors)
- `apps/server/src/task-dispatch/offline-sweeper.ts:1-75` — identical pattern, smaller scope (hosted rows are excluded)
- `apps/server/src/task-dispatch/runtime-bridge.ts:1-106` — hooks + reconcile shape
- `apps/server/src/services/runtime-registry.ts:60-93` — derived-status JOIN for hosted runtimes (ST1)
- `apps/server/src/server-core.ts:236-347` — boot order (Steps 9a, 9c, 9e currently wired; 9b + 9d are Phase 20's additions)
- `apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts` — schema: 6-state CHECK trigger, `(task_id, seq)` UNIQUE, partial unique pending index
- `apps/server/src/routes/rpc-proxy.ts:11-38` — whitelist including `chat.send`, `chat.abort`
- `apps/web/src/components/chat/ChatTab.tsx:565` — confirms `chat.abort` payload shape `{sessionKey, runId?}`
- `apps/web/src/components/chat/MessageRenderer.tsx:7-55` — confirms content-part union types
- `packages/shared/src/v14-types.ts:128-252` — TaskStatus / TaskMessageType / AgentTask / ClaimedTask / TaskEventType definitions
- `.planning/phases/16-runtime-registry-runtime-bridge/16-02-SUMMARY.md` — hook pattern for runtime-bridge
- `.planning/phases/18-task-queue-dispatch/18-01-SUMMARY.md` — task lifecycle + withImmediateTx + test-db harness
- `.planning/phases/18-task-queue-dispatch/18-04-SUMMARY.md` — cancel broadcast contract + CancelResult shape
- `.planning/phases/19-daemon-rest-api-auth/19-02-SUMMARY.md` — daemon-route pattern (pattern Phase 20 explicitly diverges from — in-process, not HTTP)

### Secondary (MEDIUM confidence)

- `docs/gateway-communication-analysis.md:80-81` — catalog confirming chat.send/chat.abort semantics
- `tests/e2e/chat-streaming.spec.ts:141-154` — end-to-end chat.send payload example

### Tertiary

None — all claims verified against code in this repo.

## Metadata

**Confidence breakdown:**
- Gateway RPC surface (chat.send + chat.abort): HIGH — multiple in-repo references
- Gateway event shape (content parts): HIGH on canonical types (text/thinking/toolCall/toolResult), MEDIUM on exact field names for tool parts (MessageRenderer declares both `tool_use` and `toolCall` as valid — mapper handles both)
- Cancel semantics: HIGH — `chat.abort` is confirmed via rpc-proxy whitelist + web UI call site
- Task-queue primitives: HIGH — all read from the actual implementation in task-queue-store.ts and task-message-batcher.ts
- HostedTaskWorker design: HIGH — mirrors two proven patterns (task-reaper, offline-sweeper)
- Boot orphan sweep: HIGH — pattern identical to `reapOnce` at task-reaper.ts:46-124
- Pitfalls: HIGH — derived from existing PITFALLS.md entries and cross-checked against Phase 18/19 summaries

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (fast-moving codebase; re-verify if >30 days elapse before Phase 20 execution)

## RESEARCH COMPLETE
