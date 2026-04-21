import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';

/**
 * Task reaper — fails stale tasks in `agent_task_queue`.
 *
 * Scope (Phase 18, TASK-04):
 *   • dispatched rows older than DISPATCH_STALE_MS (5 min) -> failed
 *     (daemon claimed but never called startTask — crash between claim and start)
 *   • running rows older than RUNNING_STALE_MS (2.5 h) -> failed
 *     (daemon crashed mid-task, or child process deadlocked)
 *   • Runs every SWEEP_INTERVAL_MS (30 s). First sweep fires immediately on start.
 *   • Standalone module — clone of offline-sweeper.ts shape (16-RESEARCH §"Why NOT
 *     extend health-monitor.ts" applies: task and runtime lifecycles are separate).
 *   • Broadcasts `task:failed` per reaped row AFTER the UPDATE commits (never inside
 *     the write path — PITFALLS §SQ5).
 *
 * Race safety (PITFALLS §ST6):
 *   The reaper's UPDATE is guarded by both `status = '<stale-state>'` AND
 *   `<ts-column> < cutoff`. If a legitimate daemon transition (startTask /
 *   completeTask / failTask / cancelTask) commits first under pool=1, the
 *   reaper's WHERE no longer matches and affects 0 rows. Both orderings
 *   produce consistent terminal state (see 18-RESEARCH §"Race avoidance").
 */

const DISPATCH_STALE_MS = 5 * 60_000;
const RUNNING_STALE_MS  = 2.5 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;

interface StaleRow {
  id: string;
  issue_id: string;
  workspace_id: string;
}

/**
 * Run a single reap pass against the given Knex instance (defaults to the app
 * singleton). Exposed so unit tests can seed rows with controlled timestamps
 * and invoke the sweep without waiting for setInterval.
 *
 * Returns a summary of reaped rows per stale-state bucket.
 */
export async function reapOnce(
  dbOverride?: Knex,
): Promise<{ dispatchedFailed: number; runningFailed: number }> {
  const kx = dbOverride ?? defaultDb;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const dispatchCut = new Date(now - DISPATCH_STALE_MS).toISOString();
  const runningCut  = new Date(now - RUNNING_STALE_MS).toISOString();

  // SELECT candidate IDs first so we can broadcast per-row after each UPDATE.
  //
  // Comparison uses `julianday(<col>) < julianday(<cutoff>)` rather than raw
  // string `<` because the column may be stored in either ISO-8601 format
  // (when callers write `new Date().toISOString()`) or SQLite's
  // CURRENT_TIMESTAMP format (`YYYY-MM-DD HH:MM:SS`, emitted by `fn.now()`).
  // Lexicographic `<` between the two formats is INCORRECT because the
  // space (0x20) separator sorts before 'T' (0x54), so a freshly-written
  // CURRENT_TIMESTAMP value would appear "older" than any ISO cutoff and the
  // reaper would clobber live daemon transitions (ST6). `julianday()`
  // normalises both formats to a numeric day count and compares safely.
  const stuckDispatched = (await kx('agent_task_queue')
    .where('status', 'dispatched')
    .whereNotNull('dispatched_at')
    .andWhereRaw('julianday(dispatched_at) < julianday(?)', [dispatchCut])
    .select('id', 'issue_id', 'workspace_id')) as StaleRow[];

  const stuckRunning = (await kx('agent_task_queue')
    .where('status', 'running')
    .whereNotNull('started_at')
    .andWhereRaw('julianday(started_at) < julianday(?)', [runningCut])
    .select('id', 'issue_id', 'workspace_id')) as StaleRow[];

  let dispatchedFailed = 0;
  let runningFailed = 0;

  if (stuckDispatched.length > 0) {
    dispatchedFailed = await kx('agent_task_queue')
      .whereIn('id', stuckDispatched.map((r) => r.id))
      .andWhere('status', 'dispatched') // ST6 race guard — daemon may have moved the row
      .update({
        status: 'failed',
        error: 'Reaper: dispatched > 5 min without start',
        completed_at: nowIso,
        updated_at: nowIso,
      });
  }

  if (stuckRunning.length > 0) {
    runningFailed = await kx('agent_task_queue')
      .whereIn('id', stuckRunning.map((r) => r.id))
      .andWhere('status', 'running')    // ST6 race guard
      .update({
        status: 'failed',
        error: 'Reaper: running beyond configured timeout',
        completed_at: nowIso,
        updated_at: nowIso,
      });
  }

  // Broadcast AFTER commits — single-statement UPDATEs autocommit before
  // returning, so this loop runs strictly after the write is durable
  // (PITFALLS §SQ5: never broadcast inside a txn).
  for (const r of [...stuckDispatched, ...stuckRunning]) {
    broadcast(r.workspace_id, {
      type: 'task:failed',
      taskId: r.id,
      issueId: r.issue_id,
      payload: { taskId: r.id, issueId: r.issue_id },
    });
  }

  if (dispatchedFailed + runningFailed > 0) {
    console.log(
      `[task-reaper] failed ${dispatchedFailed} dispatched + ${runningFailed} running stuck task(s)`,
    );
  }

  return { dispatchedFailed, runningFailed };
}

/**
 * Start the task reaper. Idempotent — safe to call multiple times (returns
 * immediately if already running). Fires an initial sweep synchronously on
 * start (cold-boot parity with offline-sweeper) so pre-existing stale rows
 * from a previous server crash are reaped before the first scheduled tick.
 *
 * The optional `dbOverride` parameter lets unit tests point the interval at
 * a throwaway SQLite fixture instead of the app singleton — mirrors the same
 * pattern on every `task-queue-store.ts` service function. Production callers
 * (`server-core.ts` Step 9c) invoke without arguments to use the default DB.
 */
export function startTaskReaper(dbOverride?: Knex): void {
  if (sweepInterval) return;

  // Initial sweep — do not wait 30s before first pass on a cold server.
  reapOnce(dbOverride).catch((err) => {
    console.warn(
      '[task-reaper] initial sweep failed:',
      err instanceof Error ? err.message : String(err),
    );
  });

  sweepInterval = setInterval(() => {
    reapOnce(dbOverride).catch((err) => {
      console.warn(
        '[task-reaper] sweep failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  }, SWEEP_INTERVAL_MS);

  console.log(
    '[task-reaper] started (5min dispatched / 2.5h running thresholds, 30s sweep interval)',
  );
}

/** Stop the reaper — used by tests and graceful shutdown. */
export function stopTaskReaper(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log('[task-reaper] stopped');
  }
}
