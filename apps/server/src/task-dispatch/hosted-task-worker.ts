import type { Knex } from 'knex';

import { db as defaultDb } from '../db/index.js';
import {
  claimTask,
  startTask,
  completeTask,
  failTask,
  isTaskCancelled,
} from '../services/task-queue-store.js';
import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
import {
  isGatewayConnected,
  waitForChatCompletion,
  cancelChatCompletion,
  registerChatStreamListener,
  type ChatStreamPayload,
} from '../services/gateway-event-relay.js';
import { appendTaskMessage, type PendingTaskMessage } from './task-message-batcher.js';
import type { ClaimedTask } from '@aquarium/shared';

/**
 * Hosted-task worker — dispatches queued hosted_instance tasks to the
 * existing gateway via `chat.send` and translates streaming chat events
 * into `task_message` rows.
 *
 * Requirements owned (Phase 20):
 *   - HOSTED-01 — 2s tick iterates online hosted_instance runtimes + calls
 *     claimTask per runtime; Fire-and-forget dispatchHostedTask per claim.
 *   - HOSTED-02 — dispatch uses gatewayCall('chat.send', {sessionKey,
 *     message, idempotencyKey:task.id}) with a 30s RPC-accept timeout and
 *     a 120s end-to-end completion wait via waitForChatCompletion.
 *   - HOSTED-03 — content parts map 1:1 to task_message rows:
 *     text -> text, thinking -> thinking, toolCall/tool_use -> tool_use,
 *     toolResult/tool_result -> tool_result. Unknown parts are dropped.
 *   - HOSTED-05 — agent.custom_env / agent.custom_args / task.session_id /
 *     task.work_dir are IGNORED by hosted_instance runtimes; dispatch
 *     logs a WARN citing each populated field but still ships chat.send.
 *   - HOSTED-06 — if isGatewayConnected(instanceId) is false the tick
 *     SKIPS the runtime (no claimTask, no failTask, task row unchanged).
 *
 * Invariants:
 *   - ST5 — worker NEVER writes instances.status, NEVER imports the
 *     instance-lifecycle module, and NEVER calls status-updating
 *     helpers. Only reads the instances table via JOIN in the tick SQL.
 *     (See acceptance-criteria greps in 20-02-PLAN.md for the HARD invariant.)
 *   - PM6 — cancel is detected via TWO paths:
 *       * REACTIVE: a per-in-flight-task setInterval polls isTaskCancelled
 *         every CANCEL_POLL_MS (2s). Fires chat.abort independent of
 *         whether the gateway is still emitting frames. PRIMARY path —
 *         the gateway typically stops streaming after cancel.
 *       * OPPORTUNISTIC: the stream listener also polls isTaskCancelled
 *         on every frame arrival. SECONDARY path — fires faster when
 *         frames are actually flowing.
 *     Both paths route through idempotent handleCancel(taskId) which
 *     guards against double-invocation via abort.signal.aborted.
 *   - X5 — pre-flight isTaskCancelled check after startTask and before
 *     gatewayCall('chat.send') so cancelled-between-enqueue-and-claim
 *     tasks never trigger an RPC.
 *   - X6 — cancel on an already-completed task is a no-op: inFlight.get
 *     returns undefined, handleCancel returns immediately.
 */

const TICK_MS = 2_000;
const CANCEL_POLL_MS = 2_000;            // REACTIVE cancel watcher interval (PM6 primary path)
const WORKSPACE_ID = 'AQ';               // CE constant (16-RESEARCH DEFAULT_WORKSPACE_ID)
// HOSTED-02 timeout split:
//   * 30s RPC-accept timeout matches the gateway's GroupChatRPCClient
//     (fail fast when the gateway doesn't ACK chat.send at all).
//   * 120s completion wait matches REQUIREMENTS.md HOSTED-02 line 123
//     literal 120_000 ms end-to-end budget.
// The split preserves the 120s end-to-end intent while failing fast on
// RPC-accept; both constants together satisfy the HOSTED-02 contract.
const CHAT_SEND_TIMEOUT_MS = 30_000;     // matches GroupChatRPCClient RPC accept
const CHAT_WAIT_TIMEOUT_MS = 120_000;    // matches HOSTED-02 literal 120_000 ms budget
const CHAT_ABORT_TIMEOUT_MS = 5_000;

interface InFlightEntry {
  abort: AbortController;
  sessionKey: string;
  instanceId: string;
  runId?: string;
  unsubscribe: () => void;
  cancelWatcher: ReturnType<typeof setInterval> | null;
  startedAt: number;
}

// Module-level state (test-resettable).
let tickHandle: ReturnType<typeof setInterval> | null = null;
let activeDb: Knex = defaultDb;
const inFlight = new Map<string, InFlightEntry>();
const dispatchPromises = new Set<Promise<void>>();

// Injectable deps for tests (mirrors Phase 18 task-message-batcher pattern).
interface HostedWorkerDeps {
  gatewayCall: typeof gatewayCall;
  isGatewayConnected: typeof isGatewayConnected;
  waitForChatCompletion: typeof waitForChatCompletion;
  cancelChatCompletion: typeof cancelChatCompletion;
  registerChatStreamListener: typeof registerChatStreamListener;
  appendTaskMessage: typeof appendTaskMessage;
}

const defaultDeps: HostedWorkerDeps = {
  gatewayCall,
  isGatewayConnected,
  waitForChatCompletion,
  cancelChatCompletion,
  registerChatStreamListener,
  appendTaskMessage,
};
let deps: HostedWorkerDeps = { ...defaultDeps };

/**
 * Test-only: swap in mock dependencies. MUST be paired with
 * __resetHostedWorkerState__ in afterEach for clean test isolation.
 */
export function __setHostedWorkerDepsForTests__(next: Partial<HostedWorkerDeps>): void {
  deps = { ...deps, ...next };
}

/**
 * Test-only: reset module state (deps + inFlight + tickHandle +
 * dispatchPromises). Called from afterEach blocks.
 */
export function __resetHostedWorkerState__(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  // Clear lingering in-flight cancel watchers (test hygiene).
  for (const entry of inFlight.values()) {
    if (entry.cancelWatcher) clearInterval(entry.cancelWatcher);
    try {
      entry.unsubscribe();
    } catch {
      // Best-effort — test harness cleanup.
    }
  }
  inFlight.clear();
  dispatchPromises.clear();
  activeDb = defaultDb;
  deps = { ...defaultDeps };
}

// ── Mapper (HOSTED-03) ──────────────────────────────────────────────────────

export interface HostedDispatchContext {
  taskId: string;
  workspaceId: string;
  issueId: string;
}

/**
 * Translate a gateway chat ChatStreamPayload into zero or more
 * PendingTaskMessage rows. Accepts both gateway-wire format (camelCase:
 * toolCall/toolResult) AND Claude-style (snake_case: tool_use/tool_result).
 * Unknown part.type values are dropped with a console.warn.
 *
 * Exported so tests can exercise the mapper in isolation.
 */
export function translatePartsToMessages(
  payload: ChatStreamPayload,
  ctx: HostedDispatchContext,
): PendingTaskMessage[] {
  const raw = payload.message?.content ?? payload.content;
  if (raw == null) return [];
  if (typeof raw === 'string') {
    // String fallback — gateway occasionally sends terminal content as a bare string.
    return [
      {
        type: 'text',
        content: raw,
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      },
    ];
  }
  if (!Array.isArray(raw)) return [];
  const out: PendingTaskMessage[] = [];
  for (const partRaw of raw) {
    if (typeof partRaw !== 'object' || partRaw === null) continue;
    const part = partRaw as Record<string, unknown>;
    const t = typeof part.type === 'string' ? part.type : '';
    switch (t) {
      case 'text':
      case 'output_text':
      case 'input_text':
        out.push({
          type: 'text',
          content: typeof part.text === 'string' ? part.text : '',
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'thinking':
        out.push({
          type: 'thinking',
          content:
            typeof part.thinking === 'string'
              ? part.thinking
              : typeof part.text === 'string'
                ? part.text
                : '',
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      case 'toolCall':
      case 'tool_use': {
        const name = typeof part.name === 'string' ? part.name : '';
        const input = part.arguments ?? part.input ?? null;
        const id = typeof part.id === 'string' ? part.id : undefined;
        out.push({
          type: 'tool_use',
          tool: name,
          input,
          metadata: id ? { toolUseId: id } : {},
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      }
      case 'toolResult':
      case 'tool_result': {
        const toolUseId = (part.tool_use_id ?? part.toolUseId ?? null) as string | null;
        const isError = Boolean(part.is_error ?? part.isError ?? false);
        out.push({
          type: 'tool_result',
          tool: null,
          output: part.content ?? part.result ?? null,
          metadata: { toolUseId, isError },
          workspaceId: ctx.workspaceId,
          issueId: ctx.issueId,
        });
        break;
      }
      case 'image':
      case 'image_url':
      case 'file':
        console.warn(
          `[hosted-task-worker] dropping unsupported content part type '${t}' for task ${ctx.taskId}`,
        );
        break;
      default:
        console.warn(
          `[hosted-task-worker] unknown content part type '${t}' for task ${ctx.taskId}`,
        );
    }
  }
  return out;
}

// ── Ignored-fields WARN (HOSTED-05) ─────────────────────────────────────────

/**
 * Log a WARN for each agent field that hosted_instance runtimes cannot
 * honor. The message MUST cite each set field name so SC-4 can grep for
 * `custom_env` / `custom_args` / `session_id` / `work_dir`. Never throws;
 * never fails the task.
 */
function warnIgnoredFields(task: ClaimedTask): void {
  const ignored: string[] = [];
  if (task.sessionId) ignored.push('session_id');
  if (task.workDir) ignored.push('work_dir');
  if (task.agent.customEnv && Object.keys(task.agent.customEnv).length > 0) {
    ignored.push('custom_env');
  }
  if (task.agent.customArgs && task.agent.customArgs.length > 0) {
    ignored.push('custom_args');
  }
  if (ignored.length > 0) {
    console.warn(
      `[hosted-task-worker] ignoring ${ignored.join(', ')} for task ${task.id} ` +
        '(hosted_instance runtime — use a daemon runtime for per-task CLI args/env)',
    );
  }
}

// ── Tick (HOSTED-01, HOSTED-06) ─────────────────────────────────────────────

interface HostedRuntimeRow {
  runtime_id: string;
  instance_id: string;
}

async function tick(kx: Knex): Promise<void> {
  const hostedOnline = (await kx('runtimes as r')
    .leftJoin('instances as i', 'r.instance_id', 'i.id')
    .where('r.workspace_id', WORKSPACE_ID)
    .andWhere('r.kind', 'hosted_instance')
    .andWhere('i.status', 'running')
    .select('r.id as runtime_id', 'r.instance_id')) as HostedRuntimeRow[];

  for (const row of hostedOnline) {
    if (!deps.isGatewayConnected(row.instance_id)) {
      // HOSTED-06: silent skip. No claimTask, no failTask, task row unchanged.
      continue;
    }
    // claimTask atomically assigns runtime_id; the tick-row instanceId is
    // authoritative for the rest of the dispatch (no re-verification needed).
    const claimed = await claimTask(row.runtime_id, kx);
    if (!claimed) continue;
    // Fire-and-forget dispatch so this tick proceeds to the next runtime
    // without blocking on a potentially 120s chat.send+completion window.
    const p = dispatchHostedTask(claimed, row.instance_id, kx)
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          '[hosted-task-worker] dispatch crashed for',
          claimed.id,
          ':',
          msg,
        );
        // Safety net: if dispatch threw outside its own try/catch, fail the
        // task row. failTask is idempotent for already-cancelled/terminal rows.
        try {
          await failTask(claimed.id, `hosted-worker-crash: ${msg}`, kx);
        } catch {
          // already-terminal — swallow
        }
      })
      .finally(() => {
        dispatchPromises.delete(p);
      });
    dispatchPromises.add(p);
  }
}

// ── Dispatch body (Task 2) ──────────────────────────────────────────────────

/**
 * Return a Promise that rejects when the given AbortSignal is aborted.
 * Used to race against gatewayCall / waitForChatCompletion so graceful
 * shutdown or REACTIVE cancel unblocks the dispatch even when the
 * underlying Promise does not observe the AbortController directly.
 * Returns `Promise<never>` so it is a no-op on the success branch of
 * `Promise.race` when the primary Promise resolves first.
 */
function abortSignalToRejection(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}


/**
 * Dispatch a single claimed task through the gateway.
 *
 * Call order:
 *   1. warnIgnoredFields (HOSTED-05)
 *   2. pre-flight isTaskCancelled (X5 — skip chat.send if cancelled between
 *      enqueue and claim)
 *   3. startTask (dispatched -> running; bail on {started:false})
 *   4. Build sessionKey `task:<task.id>`; create AbortController + dedupe set
 *   5. Register REACTIVE cancel watcher (setInterval polling isTaskCancelled
 *      every CANCEL_POLL_MS — PM6 primary)
 *   6. Subscribe stream listener (registerChatStreamListener) BEFORE chat.send
 *      so no frames are missed (20-RESEARCH §Pitfall 2); listener also polls
 *      isTaskCancelled opportunistically (PM6 secondary)
 *   7. Register waitForChatCompletion BEFORE chat.send (same reason — gateway
 *      may emit final before chat.send resolves on fast backends)
 *   8. gatewayCall('chat.send', {sessionKey, message, idempotencyKey:task.id},
 *      30_000) — HOSTED-02 30s RPC-accept
 *   9. Await completion — 120s via CHAT_WAIT_TIMEOUT_MS (HOSTED-02 end-to-end)
 *  10. Replay final-frame parts through mapper with signature-dedupe so the
 *      terminal frame does not duplicate streaming rows
 *  11. completeTask (idempotent for already-cancelled)
 *  12. On error: failTask UNLESS abort.signal.aborted (cancel path already set
 *      the row to 'cancelled' — don't overwrite the clean state)
 *  13. finally: unsubscribe + cancelChatCompletion + clearInterval(cancelWatcher)
 *      + inFlight.delete(task.id) — single cleanup path (PM6 handleCancel does
 *      NOT delete/clearInterval; this block owns both)
 */
async function dispatchHostedTask(
  task: ClaimedTask,
  instanceId: string,
  kx: Knex,
): Promise<void> {
  warnIgnoredFields(task);

  // X5 pre-flight: user may have cancelled between enqueue and our claim.
  if (await isTaskCancelled(task.id, kx)) {
    console.log(
      `[hosted-task-worker] task ${task.id} cancelled before dispatch — skipping chat.send`,
    );
    return;
  }

  // Transition dispatched -> running. startTask guards against the race where
  // the row moved to cancelled/failed between claim and here.
  const startedResult = await startTask(task.id, kx);
  if (!startedResult.started) {
    console.log(
      `[hosted-task-worker] task ${task.id} not in dispatched state (now ${startedResult.status}) — skipping`,
    );
    return;
  }

  const sessionKey = `task:${task.id}`;
  const abort = new AbortController();
  // Dedupe set for final-frame duplicates. Signature keys on
  // `${type}:${content}:${JSON.stringify(input)}:${JSON.stringify(output)}`
  // so the mapper never emits two identical task_message rows.
  const seenSignatures = new Set<string>();

  const ctx: HostedDispatchContext = {
    taskId: task.id,
    workspaceId: task.workspaceId,
    issueId: task.issueId,
  };

  // ── PM6 REACTIVE cancel watcher ─────────────────────────────────────────
  // Why a setInterval (not a broadcast subscription): ws/index.ts exposes
  // `broadcast()` but NO subscribe/onTaskCancelled hook, and task-queue-store
  // has no event bus. A 2s poll per in-flight task is lightweight (bounded by
  // max_concurrent_tasks × |online hosted runtimes|) and guarantees cancel is
  // detected within CANCEL_POLL_MS REGARDLESS of whether the gateway is still
  // emitting frames. If the gateway stops streaming after cancel (typical),
  // the opportunistic poll in the stream listener never fires — only this
  // reactive watcher breaks the 120s waitForChatCompletion block.
  const cancelWatcher: ReturnType<typeof setInterval> = setInterval(() => {
    void isTaskCancelled(task.id, kx)
      .then((cancelled) => {
        if (cancelled) handleCancel(task.id);
      })
      .catch((err) => {
        // Swallow errors — reactive poll MUST NOT crash the dispatch.
        console.warn(
          `[hosted-task-worker] cancel poll failed for task ${task.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
  }, CANCEL_POLL_MS);

  // Subscribe BEFORE chat.send so no frames are missed (§Pitfall 2).
  const unsubscribe = deps.registerChatStreamListener(
    instanceId,
    sessionKey,
    (payload) => {
      // Capture runId for chat.abort (§Cancel/Abort — gateway uses runId to
      // correlate abort with the in-flight run when present).
      if (payload.runId) {
        const entry = inFlight.get(task.id);
        if (entry && !entry.runId) entry.runId = payload.runId;
      }
      // OPPORTUNISTIC cancel poll — fires faster when frames are arriving.
      void isTaskCancelled(task.id, kx).then((cancelled) => {
        if (cancelled) handleCancel(task.id);
      });

      const msgs = translatePartsToMessages(payload, ctx);
      for (const m of msgs) {
        const sig = `${m.type}:${m.content ?? ''}:${JSON.stringify(m.input ?? null)}:${JSON.stringify(m.output ?? null)}`;
        if (seenSignatures.has(sig)) continue;
        seenSignatures.add(sig);
        deps.appendTaskMessage(task.id, m);
      }
    },
  );

  inFlight.set(task.id, {
    abort,
    sessionKey,
    instanceId,
    unsubscribe,
    cancelWatcher,
    startedAt: Date.now(),
  });

  // Waiter BEFORE chat.send — avoid missing the final frame on a fast gateway.
  const completion = deps.waitForChatCompletion(
    instanceId,
    sessionKey,
    CHAT_WAIT_TIMEOUT_MS,
  );
  // Swallow the rejection here; handled by the try/catch below. Without this
  // an unhandled rejection fires if we error before awaiting completion.
  completion.catch(() => {
    /* handled below */
  });

  try {
    const prompt = buildPromptFromTask(task);

    // HOSTED-02: 30s RPC-accept timeout (the gateway's GroupChatRPCClient
    // uses the same value). idempotencyKey is the task.id (stable UUID) so
    // the gateway dedupes a retry from the same task — never randomUUID.
    // Race against the AbortController so graceful stop / cancel unblocks us
    // even when the underlying gatewayCall Promise does not observe the
    // signal directly (the RPC client has no AbortController wiring today).
    await Promise.race([
      deps.gatewayCall(
        instanceId,
        'chat.send',
        {
          sessionKey,
          message: prompt,
          idempotencyKey: task.id,
        },
        CHAT_SEND_TIMEOUT_MS,
      ),
      abortSignalToRejection(abort.signal),
    ]);

    const result = await Promise.race([completion, abortSignalToRejection(abort.signal)]);

    // One last pass for the final frame (catches parts only present in the
    // 'final' payload). The dedupe set suppresses duplicates of the streaming
    // deltas already written.
    const finalParts = translatePartsToMessages(
      {
        sessionKey,
        state: 'final',
        content: result.content,
        messageId: result.messageId,
        role: result.role,
      },
      ctx,
    );
    for (const m of finalParts) {
      const sig = `${m.type}:${m.content ?? ''}:${JSON.stringify(m.input ?? null)}:${JSON.stringify(m.output ?? null)}`;
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
      deps.appendTaskMessage(task.id, m);
    }

    // completeTask handles PM6 — returns {discarded:true, status:'cancelled'}
    // if the user cancelled between final and here. Idempotent.
    await completeTask(task.id, { sessionKey, messageId: result.messageId }, kx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (abort.signal.aborted) {
      // Cancel path already flipped the task row to 'cancelled' via cancelTask.
      // Do NOT call failTask — it would return {discarded:true} but the error
      // message 'hosted-dispatch-error: Chat completion cancelled' would
      // pollute the run log.
      return;
    }
    // failTask is idempotent for already-terminal states.
    await failTask(task.id, `hosted-dispatch-error: ${msg}`, kx);
  } finally {
    try {
      unsubscribe();
    } catch {
      // swallow — unsubscribe is best-effort
    }
    deps.cancelChatCompletion(instanceId, sessionKey);
    clearInterval(cancelWatcher);
    inFlight.delete(task.id);
  }
}

/**
 * Canonical prompt assembly from a claimed task. Text concatenation is
 * deterministic — no per-agent templating is needed for Phase 20.
 */
function buildPromptFromTask(task: ClaimedTask): string {
  const parts: string[] = [];
  if (task.agent.instructions) parts.push(task.agent.instructions);
  parts.push(`Issue #${task.issue.issueNumber}: ${task.issue.title}`);
  if (task.issue.description) parts.push(task.issue.description);
  if (task.triggerCommentContent) parts.push(`User: ${task.triggerCommentContent}`);
  return parts.join('\n\n');
}

/**
 * React to a cancel signal. Idempotent — if the task is not in-flight
 * (already completed, or cancel arrived after finally{} cleanup), this
 * is a no-op (X6).
 *
 * Invoked from TWO paths:
 *   1. REACTIVE — the per-task CANCEL_POLL_MS setInterval (primary;
 *      stream-independent).
 *   2. OPPORTUNISTIC — the stream-listener's isTaskCancelled poll
 *      (secondary; fires faster when frames arrive but silent when the
 *      gateway stops streaming).
 *
 * handleCancel does NOT delete inFlight or clearInterval — the finally
 * block in dispatchHostedTask owns cleanup on a single code path.
 */
function handleCancel(taskId: string): void {
  const entry = inFlight.get(taskId);
  if (!entry) return;
  if (entry.abort.signal.aborted) return; // Already processed — idempotent no-op.
  entry.abort.abort();
  // Best-effort gateway abort — web UI (ChatTab.tsx:565) ignores failures.
  const abortParams: Record<string, unknown> = { sessionKey: entry.sessionKey };
  if (entry.runId) abortParams.runId = entry.runId;
  deps
    .gatewayCall(entry.instanceId, 'chat.abort', abortParams, CHAT_ABORT_TIMEOUT_MS)
    .catch((err) => {
      console.warn(
        '[hosted-task-worker] chat.abort failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  // Also cancel the in-flight waitForChatCompletion so the dispatch unwinds
  // promptly (the relay rejects the Promise with 'Chat completion cancelled').
  deps.cancelChatCompletion(entry.instanceId, entry.sessionKey);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Start the hosted-task worker tick. Idempotent (subsequent calls are
 * no-ops). Fires an initial tick synchronously on start so a cold server
 * does not wait TICK_MS before dispatching the first hosted task.
 *
 * The optional `dbOverride` is the Knex instance tests inject via
 * setupTestDb(); production callers pass no argument and the worker
 * uses the app singleton.
 */
export function startHostedTaskWorker(dbOverride?: Knex): void {
  if (tickHandle) return;
  if (dbOverride) activeDb = dbOverride;

  // Initial tick — do not wait TICK_MS before first dispatch.
  tick(activeDb).catch((err) => {
    console.warn(
      '[hosted-task-worker] initial tick failed:',
      err instanceof Error ? err.message : String(err),
    );
  });

  tickHandle = setInterval(() => {
    tick(activeDb).catch((err) => {
      console.warn(
        '[hosted-task-worker] tick failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  }, TICK_MS);

  console.log('[hosted-task-worker] started (2s tick interval)');
}

/**
 * Stop the hosted-task worker tick AND await in-flight dispatches so
 * graceful shutdown does not leave orphan chat.send RPCs on the wire.
 *
 * For each in-flight task the graceful-stop path:
 *   - Aborts the AbortController so the dispatch's catch(abort.signal.aborted)
 *     branch skips the failTask call on unwind.
 *   - Calls deps.cancelChatCompletion to reject the waitForChatCompletion
 *     Promise, breaking the 120s wait.
 *   - Clears the REACTIVE cancel watcher so no further DB polls fire after
 *     shutdown.
 * The per-task finally{} block in dispatchHostedTask performs the final
 * unsubscribe + inFlight.delete — so the graceful-stop helper does NOT
 * touch those (single cleanup path invariant).
 *
 * Idempotent — safe to call multiple times; no-op if already stopped.
 */
export async function stopHostedTaskWorker(): Promise<void> {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  // Abort in-flight dispatches so chat.send / waitForChatCompletion unblocks.
  // Do this BEFORE awaiting dispatchPromises — otherwise a test that blocks
  // chat.send forever would hang stopHostedTaskWorker.
  for (const entry of inFlight.values()) {
    if (entry.abort.signal.aborted) continue;
    entry.abort.abort();
    try {
      deps.cancelChatCompletion(entry.instanceId, entry.sessionKey);
    } catch {
      // swallow — best-effort
    }
    if (entry.cancelWatcher) {
      clearInterval(entry.cancelWatcher);
      entry.cancelWatcher = null;
    }
  }
  // Snapshot + wait. Dispatch catch-all ensures none of these ever reject.
  const pending = [...dispatchPromises];
  await Promise.allSettled(pending);
  console.log('[hosted-task-worker] stopped');
}
