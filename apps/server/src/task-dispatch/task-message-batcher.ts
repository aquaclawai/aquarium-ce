/**
 * Task-message batcher — Phase 18 TASK-03.
 *
 * In-memory per-task buffer; flushes every BATCH_INTERVAL_MS (500ms) via a
 * single setInterval. Each flush computes MAX(seq)+1 INSIDE a `BEGIN IMMEDIATE`
 * transaction then bulk-inserts the pending messages. The UNIQUE(task_id, seq)
 * index from migration 007 is the schema backstop.
 *
 * Design invariants (from 18-RESEARCH §Monotonic seq for task_messages):
 *   • Per-task ordering is strictly monotonic and gap-free
 *   • Across-task ordering is NOT guaranteed (and not needed)
 *   • All DB work happens inside BEGIN IMMEDIATE (pool=1 serialises writers;
 *     BEGIN IMMEDIATE also protects against deferred-upgrade trap §SQ1)
 *   • WS broadcasts fire ONLY AFTER commit — PITFALLS §SQ5 (no I/O in txn)
 *   • Per-task buffer cap BUFFER_SOFT_CAP=500 triggers early flush (SQ5
 *     write-lock-starvation prevention)
 *   • stopTaskMessageBatcher() awaits a final flush so graceful shutdown
 *     never drops queued messages
 *
 * Consumers:
 *   • Phase 19 daemon route `POST /api/daemon/tasks/:id/messages` → calls
 *     appendTaskMessage(taskId, msg) per streamed event.
 *   • Phase 20 HostedTaskWorker emits its own task_messages via the same API.
 */

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { broadcastTaskMessage } from '../ws/index.js';
import { withImmediateTx } from '../services/task-queue-store.js';
import { truncateForStorage } from '../services/task-message-store.js';
import type { TaskMessageType } from '@aquarium/shared';

const BATCH_INTERVAL_MS = 500;
const BUFFER_SOFT_CAP = 500;

export interface PendingTaskMessage {
  type: TaskMessageType;
  tool?: string | null;
  content?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  /** Required for WS broadcast routing after the flush commits. */
  workspaceId: string;
  /** Included in the WS payload so the UI can match the event to an issue. */
  issueId: string;
}

// Per-task pending buffer. Entries are appended synchronously; each flush
// splices the entire current buffer for one task, so a new append during a
// flush lands in a fresh slot for the next flush.
const buffer: Map<string, PendingTaskMessage[]> = new Map();

// Re-entrance guard: if a soft-cap-triggered early flush races with the
// timer-triggered flushAll(), the second caller skips the same task.
const flushingTasks: Set<string> = new Set();

let flushInterval: ReturnType<typeof setInterval> | null = null;

// Swappable db reference so tests can point the batcher at an isolated
// throwaway SQLite file (see apps/server/tests/unit/test-db.ts).
let activeDb: Knex = defaultDb;

/**
 * Queue a task message. Synchronous — the write is buffered in memory and the
 * actual INSERT happens on the next flush (500 ms by default).
 *
 * When the per-task buffer crosses BUFFER_SOFT_CAP, this call also kicks off
 * an immediate fire-and-forget flush to keep the transaction row count bounded
 * (PITFALLS §SQ5 10ms transaction budget).
 */
export function appendTaskMessage(taskId: string, msg: PendingTaskMessage): void {
  const list = buffer.get(taskId) ?? [];
  list.push(msg);
  buffer.set(taskId, list);
  if (list.length >= BUFFER_SOFT_CAP) {
    // Fire-and-forget early flush to keep per-txn row count bounded.
    flushOne(taskId).catch((err) => {
      console.warn(
        '[task-message-batcher] early flush failed for task',
        taskId,
        ':',
        err instanceof Error ? err.message : String(err),
      );
    });
  }
}

/**
 * Start the 500 ms flush interval. Idempotent — subsequent calls are a no-op.
 * Safe to call from server-core.ts startup alongside other lifecycle pieces.
 */
export function startTaskMessageBatcher(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushAll().catch((err) => {
      console.warn(
        '[task-message-batcher] flush failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  }, BATCH_INTERVAL_MS);
  console.log('[task-message-batcher] started (500ms flush, 500-msg soft cap)');
}

/**
 * Stop the flush interval and perform a FINAL flush of every buffered task so
 * no messages are lost on graceful shutdown. The returned promise resolves
 * after the final flush commits (or errors out — in which case the error is
 * swallowed with a warning per flushAll's contract).
 */
export async function stopTaskMessageBatcher(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  // Final flush drains the in-memory buffer.
  await flushAll();
  console.log('[task-message-batcher] stopped');
}

/**
 * Test hook: flush one task (or all if taskId is omitted). Public so unit
 * tests can force a flush without waiting 500 ms.
 */
export async function flushTaskMessages(taskId?: string): Promise<void> {
  if (taskId !== undefined) {
    await flushOne(taskId);
    return;
  }
  await flushAll();
}

/** Test-only: inject an isolated Knex instance for unit tests. */
export function __setBatcherDbForTests__(kx: Knex): void {
  activeDb = kx;
}

/** Test-only: reset module-level state between tests. */
export function __resetBatcherState__(): void {
  buffer.clear();
  flushingTasks.clear();
  activeDb = defaultDb;
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

async function flushAll(): Promise<void> {
  const taskIds = [...buffer.keys()];
  for (const id of taskIds) {
    try {
      await flushOne(id);
    } catch (err) {
      console.warn(
        '[task-message-batcher] flushOne failed for',
        id,
        ':',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function flushOne(taskId: string): Promise<void> {
  // Re-entrance guard: if a flush is already in flight for this task
  // (e.g. soft-cap overflow racing with the timer tick), skip — the in-flight
  // flush will drain whatever is in the buffer when it snapshotted.
  if (flushingTasks.has(taskId)) return;
  const pending = buffer.get(taskId);
  if (!pending || pending.length === 0) return;

  // Snapshot + clear the buffer BEFORE the DB call so new appends during the
  // flush accumulate for the NEXT round (strict per-flush monotonicity).
  const batch = pending.splice(0, pending.length);
  if (batch.length === 0) return;

  flushingTasks.add(taskId);
  try {
    const adapter = getAdapter();
    // Assembled broadcast payloads — populated during tx, fired AFTER commit.
    const toBroadcast: Array<{
      workspaceId: string;
      issueId: string;
      seq: number;
      type: TaskMessageType;
      tool: string | null;
      content: string | null;
      input: unknown;
      output: unknown;
    }> = [];

    await withImmediateTx(activeDb, async (trx) => {
      const row = (await trx('task_messages')
        .where({ task_id: taskId })
        .max({ m: 'seq' })
        .first()) as { m: number | null } | undefined;
      let next = Number(row?.m ?? 0);
      // Phase 24-00 UX6: overflow writes land in the same transaction as
      // the task_messages INSERT so a row never exists in one table without
      // the other.
      const overflowInserts: Array<{
        task_id: string;
        seq: number;
        content: string | null;
        input_json: string | null;
        output: string | null;
        original_bytes: number;
        created_at: string;
      }> = [];
      const nowIso = new Date().toISOString();
      const inserts = batch.map((m) => {
        next += 1;
        const trunc = truncateForStorage({
          content: m.content ?? null,
          input: m.input,
          output: m.output,
        });
        const metadata: Record<string, unknown> = { ...(m.metadata ?? {}) };
        if (trunc.didTruncate) {
          metadata.truncated = true;
          metadata.originalBytes = trunc.originalBytes;
        }
        // `truncatedInput` is the JSON-string form when truncation happened
        // and the original object otherwise — adapter.jsonValue handles both.
        const storedInputRaw = trunc.truncatedInput;
        // When input was truncated, the serialized JSON has already been
        // cropped to LIMIT bytes; store it as TEXT directly rather than
        // re-encoding via adapter.jsonValue (which would wrap it in quotes).
        const didTruncateInput =
          trunc.didTruncate && trunc.overflow?.input_json !== null && trunc.overflow?.input_json !== undefined;
        const storedInput =
          storedInputRaw === undefined || storedInputRaw === null
            ? null
            : didTruncateInput
              ? (storedInputRaw as string)
              : adapter.jsonValue(storedInputRaw);
        const storedOutput =
          trunc.truncatedOutput === null || trunc.truncatedOutput === undefined
            ? null
            : trunc.truncatedOutput;

        toBroadcast.push({
          workspaceId: m.workspaceId,
          issueId: m.issueId,
          seq: next,
          type: m.type,
          tool: m.tool ?? null,
          content: trunc.truncatedContent,
          // Broadcast carries the truncated form so WS wire size stays bounded
          // (UX6). The UI's TruncationMarker calls GET /full for uncapped.
          input: storedInputRaw ?? null,
          output: trunc.truncatedOutput,
        });

        if (trunc.didTruncate && trunc.overflow) {
          overflowInserts.push({
            task_id: taskId,
            seq: next,
            content: trunc.overflow.content,
            input_json: trunc.overflow.input_json,
            output: trunc.overflow.output,
            original_bytes: trunc.originalBytes,
            created_at: nowIso,
          });
        }

        return {
          id: randomUUID(),
          task_id: taskId,
          seq: next,
          type: m.type,
          tool: m.tool ?? null,
          content: trunc.truncatedContent,
          input: storedInput,
          output: storedOutput,
          metadata: adapter.jsonValue(metadata),
          created_at: nowIso,
        };
      });
      // Single bulk INSERT keeps the write-lock window minimal (SQ5 10ms budget).
      await trx('task_messages').insert(inserts);
      if (overflowInserts.length > 0) {
        await trx('task_message_overflow').insert(overflowInserts);
      }
    });

    // Broadcast AFTER commit — never inside the transaction (PITFALLS §SQ5).
    // Phase 24-00: route via broadcastTaskMessage so per-client replay state
    // (pause_stream + subscribe_task buffer window) is honoured. Workspace
    // subscribers that never sent subscribe_task are intentionally skipped —
    // Phase 23's board reconciler consumes task:cancelled only (grep-verified
    // no `task:message` handlers exist in apps/web/src/**).
    for (const b of toBroadcast) {
      broadcastTaskMessage(b.workspaceId, taskId, {
        type: 'task:message',
        taskId,
        issueId: b.issueId,
        seq: b.seq,
        payload: {
          taskId,
          issueId: b.issueId,
          seq: b.seq,
          type: b.type,
          tool: b.tool,
          content: b.content,
          input: b.input,
          output: b.output,
        },
      });
    }
  } finally {
    flushingTasks.delete(taskId);
    // Drop the Map entry if drained — keeps Map small between flushes.
    if ((buffer.get(taskId)?.length ?? 0) === 0) buffer.delete(taskId);
  }
}
