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
 *   - ST5 — worker NEVER writes instances.status, NEVER imports
 *     instance-manager.ts, NEVER calls updateStatus. Only reads the
 *     instances table via JOIN in the tick SQL.
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
  // Clear any lingering in-flight cancel watchers (test hygiene).
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

// ── Dispatch skeleton (Task 2 fills body) ───────────────────────────────────

/**
 * Dispatch a single claimed task. Task 1 skeleton only warns about
 * ignored fields and returns. Task 2 wires the full chat.send + stream
 * + REACTIVE cancel watcher + completion body.
 */
async function dispatchHostedTask(
  task: ClaimedTask,
  instanceId: string,
  _kx: Knex,
): Promise<void> {
  warnIgnoredFields(task);
  // Task 2 adds the chat.send + streaming + lifecycle block here.
  // Task 1 intentionally leaves this as a stub so the tick loop + mapper
  // can be tested without mocking the whole gateway surface.
  void instanceId;
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
 * Stop the hosted-task worker tick AND await any in-flight dispatches so
 * graceful shutdown does not leave orphan chat.send RPCs on the wire.
 */
export async function stopHostedTaskWorker(): Promise<void> {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  // Snapshot + wait. Dispatch catch-all ensures none of these ever reject.
  const pending = [...dispatchPromises];
  await Promise.allSettled(pending);
  console.log('[hosted-task-worker] stopped');
}
