import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { broadcast } from '../ws/index.js';
import type { AgentTask, ClaimedTask, TaskStatus } from '@aquarium/shared';

/**
 * Task queue store — Phase 17 slice (enqueue + cancel) + Phase 18 lifecycle.
 *
 * Phase 17 surface:
 *   • enqueueTaskForIssue                  — ISSUE-02 assign hook
 *   • cancelPendingTasksForIssueAgent      — ISSUE-03 reassign swap
 *                                            (18-04: returns CancelResult, opts `emitBroadcasts`)
 *   • cancelAllTasksForIssue               — ISSUE-04 issue cancellation
 *                                            (18-04: returns CancelResult, opts `emitBroadcasts`)
 *   • getPendingTaskForIssueAgent          — idempotency check + tests
 *
 * Phase 18 surface (this file):
 *   • claimTask(runtimeId, db?)            — atomic dispatch (TASK-01, SC-1)
 *   • startTask(taskId, db?)               — dispatched → running (TASK-02)
 *   • completeTask(taskId, result, db?)    — running → completed; { discarded }
 *                                            when task is already `cancelled` (TASK-06)
 *   • failTask(taskId, error, db?)         — running/dispatched → failed; same
 *                                            discarded semantics (TASK-06)
 *   • cancelTask(taskId, db?)              — any non-terminal → cancelled (TASK-05)
 *   • isTaskCancelled(taskId, db?)         — cheap read for daemon/hosted poll
 *                                            (TASK-05 / DAEMON-06)
 *
 * HARD constraints (Phase 18):
 *   • Every write transaction opens with `trx.raw('BEGIN IMMEDIATE')` so future
 *     multi-connection readers (Worker threads / debug shells) never hit the
 *     "deferred txn upgrade" SQLITE_BUSY trap (PITFALLS §SQ1). Today the
 *     CE Knex pool is (min: 1, max: 1) so in-process writes already serialise
 *     through one better-sqlite3 connection, but IMMEDIATE is a safety belt.
 *   • Lifecycle transitions add `.andWhere('status', <expected>)` to every
 *     UPDATE so the DB itself rejects a stale transition (e.g. daemon tries to
 *     complete a task the user cancelled 10 ms earlier). The migration-007
 *     CHECK triggers are the last backstop.
 *   • completeTask / failTask on an already-cancelled task return
 *     { discarded: true, status: 'cancelled' } (HTTP 200 at the route layer —
 *     PITFALLS §PM5). Never throw for this case.
 *   • WS broadcasts (`task:dispatch`, `task:completed`, `task:failed`,
 *     `task:cancelled`) emit AFTER the transaction commits (PITFALLS §SQ5).
 *   • All operations accept an optional `db` parameter so unit tests can inject
 *     an isolated Knex instance (see apps/server/tests/unit/test-db.ts).
 *
 * Out of scope for Phase 18:
 *   • Runtime-side cancel propagation (daemon SIGTERM, hosted AbortController)
 *     — Phase 19 (daemon) and Phase 20 (hosted) consume `isTaskCancelled`.
 *   • Streaming seq batcher (task-message-batcher.ts) — Plan 18-02.
 *   • Periodic reaper (task-reaper.ts) — Plan 18-03.
 *   • HTTP routes — Phase 19 wires /api/daemon/tasks/*.
 */

function toAgentTask(row: Record<string, unknown>): AgentTask {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    issueId: row.issue_id as string,
    agentId: row.agent_id as string,
    runtimeId: row.runtime_id as string,
    triggerCommentId: (row.trigger_comment_id as string) ?? null,
    status: row.status as TaskStatus,
    priority: Number(row.priority),
    sessionId: (row.session_id as string) ?? null,
    workDir: (row.work_dir as string) ?? null,
    error: (row.error as string) ?? null,
    result: row.result
      ? adapter.parseJson<unknown>(row.result)
      : null,
    metadata: row.metadata
      ? (adapter.parseJson<Record<string, unknown>>(row.metadata) ?? {})
      : {},
    dispatchedAt: row.dispatched_at ? String(row.dispatched_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

type TxOrDb = Knex | Knex.Transaction;
function runner(trx?: Knex.Transaction, dbOverride?: Knex): TxOrDb {
  return trx ?? dbOverride ?? defaultDb;
}

/**
 * Resolve the Knex instance for service calls. Phase-18 functions accept an
 * optional `db` override (for unit tests) but default to the app singleton.
 */
function resolveDb(dbOverride?: Knex): Knex {
  return dbOverride ?? defaultDb;
}

/**
 * Open an explicit `BEGIN IMMEDIATE` txn via Knex's `.transaction()` helper —
 * Knex starts with a stock `BEGIN;` (deferred), which we immediately ROLLBACK
 * and replace with `BEGIN IMMEDIATE`. Knex still owns the connection lease and
 * the final COMMIT/ROLLBACK is driven by the promise return / throw from `fn`.
 *
 * Why the ROLLBACK dance is necessary:
 *   • Knex's better-sqlite3 dialect hard-codes `BEGIN` at transaction start and
 *     does not expose an IMMEDIATE flag.
 *   • Calling `trx.raw('BEGIN IMMEDIATE')` inside an already-open Knex txn
 *     errors with "cannot start a transaction within a transaction".
 *   • Calling `kx.raw('BEGIN IMMEDIATE')` on the root Knex bypasses the pool's
 *     connection pinning, so concurrent callers step on each other.
 *   • `ROLLBACK` + `BEGIN IMMEDIATE` inside the Knex-managed trx keeps the
 *     connection lease (pool=1 serialisation) and upgrades the transaction
 *     mode to IMMEDIATE, giving us PITFALLS §SQ1's deferred-upgrade fix.
 *
 * Under CE's `pool: { min: 1, max: 1 }` (knexfile.ts), Knex.transaction() is
 * already serialising through one better-sqlite3 connection; the IMMEDIATE
 * upgrade is a safety belt for:
 *   • future Worker-thread readers (would break pool=1 invariant)
 *   • external writers (debug `sqlite3` shell running against the same file)
 *   • documentation — the code reads as intentional serialisation, not as
 *     "just works because pool=1".
 *
 * If Knex ever exposes a native IMMEDIATE option this helper collapses into
 * `kx.transaction(fn, { immediate: true })`.
 */
export async function withImmediateTx<T>(
  kx: Knex,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return kx.transaction(async (trx) => {
    // Close Knex's default `BEGIN;` and start fresh with `BEGIN IMMEDIATE`.
    await trx.raw('ROLLBACK');
    await trx.raw('BEGIN IMMEDIATE');
    return fn(trx);
  });
}

/**
 * Look up an existing pending task (queued|dispatched) for an (issue, agent)
 * pair. Matches the predicate of partial-unique index
 * `idx_one_pending_task_per_issue_agent` (migration 007).
 */
export async function getPendingTaskForIssueAgent(
  workspaceId: string,
  issueId: string,
  agentId: string,
  trx?: Knex.Transaction,
): Promise<AgentTask | null> {
  const r = runner(trx);
  const row = await r('agent_task_queue')
    .where({ workspace_id: workspaceId, issue_id: issueId, agent_id: agentId })
    .whereIn('status', ['queued', 'dispatched'])
    .first();
  return row ? toAgentTask(row as Record<string, unknown>) : null;
}

export interface EnqueueTaskArgs {
  workspaceId: string;
  issueId: string;
  agentId: string;
  triggerCommentId?: string | null;
  priority?: number;
  trx?: Knex.Transaction;
}

/**
 * Enqueue a new task for an (issue, agent) pair if no pending task already
 * exists. Returns the existing pending task on idempotent re-entry. Returns
 * null (without throwing) when the agent has no runtime_id — the caller's
 * reassignment path needs this to be soft so cancel-old still runs cleanly.
 *
 * Throws only when the agent does not exist in the given workspace (cross-
 * workspace or deleted-agent references). Archived agents also return null.
 */
export async function enqueueTaskForIssue(args: EnqueueTaskArgs): Promise<AgentTask | null> {
  const adapter = getAdapter();

  const doEnqueue = async (trx: Knex.Transaction): Promise<AgentTask | null> => {
    // Read runtime_id + archive state for this agent (respects 17-01 soft-archive)
    const agentRow = await trx('agents')
      .where({ id: args.agentId, workspace_id: args.workspaceId })
      .first('runtime_id', 'archived_at');
    if (!agentRow) {
      throw new Error(`agent ${args.agentId} not found in workspace`);
    }
    if (agentRow.archived_at) {
      console.warn(
        `[task-queue-store] refusing to enqueue for archived agent ${args.agentId}`,
      );
      return null;
    }
    if (!agentRow.runtime_id) {
      console.warn(
        `[task-queue-store] skipping enqueue: agent ${args.agentId} has no runtime_id (§ST4 unassigned)`,
      );
      return null;
    }

    // Idempotency: existing pending task for this pair?
    const existing = await getPendingTaskForIssueAgent(
      args.workspaceId,
      args.issueId,
      args.agentId,
      trx,
    );
    if (existing) return existing;

    const id = randomUUID();
    await trx('agent_task_queue').insert({
      id,
      workspace_id: args.workspaceId,
      issue_id: args.issueId,
      agent_id: args.agentId,
      runtime_id: agentRow.runtime_id as string,
      trigger_comment_id: args.triggerCommentId ?? null,
      status: 'queued',
      priority: args.priority ?? 0,
      session_id: null,
      work_dir: null,
      error: null,
      result: null,
      metadata: adapter.jsonValue({}),
      dispatched_at: null,
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      created_at: defaultDb.fn.now(),
      updated_at: defaultDb.fn.now(),
    });

    const row = await trx('agent_task_queue').where({ id }).first();
    return row ? toAgentTask(row as Record<string, unknown>) : null;
  };

  if (args.trx) return doEnqueue(args.trx);
  return defaultDb.transaction(doEnqueue);
}

export interface CancelPendingArgs {
  workspaceId: string;
  issueId: string;
  agentId: string;
  trx?: Knex.Transaction;
  /** Optional Knex override — used by unit tests to inject a throwaway SQLite. */
  db?: Knex;
  /**
   * When true AND no `trx` is provided, the helper fires `task:cancelled` WS
   * broadcasts per cancelled row AFTER its own transaction commits. When a
   * caller supplies `trx`, this flag is ignored — the caller owns broadcasts
   * to avoid ghost events on rollback. See 18-04-PLAN §threat_model T-18-19.
   */
  emitBroadcasts?: boolean;
}

export interface CancelAllTasksArgs {
  workspaceId: string;
  issueId: string;
  trx?: Knex.Transaction;
  /** Optional Knex override — used by unit tests to inject a throwaway SQLite. */
  db?: Knex;
  /** See CancelPendingArgs.emitBroadcasts. */
  emitBroadcasts?: boolean;
}

/**
 * Uniform result shape for the two mass-cancel helpers.
 *
 * `count` preserves the Phase-17 contract (callers that used `.count` keep
 * working). `cancelledTaskIds` is an id-only view for routes that only need
 * to fan out broadcasts. `cancelledRows` carries the full (taskId, issueId,
 * workspaceId, previousStatus) tuple so callers can broadcast AFTER their
 * own commit without re-reading the DB.
 */
export interface CancelResult {
  count: number;
  cancelledTaskIds: string[];
  cancelledRows: Array<{
    taskId: string;
    issueId: string;
    workspaceId: string;
    previousStatus: TaskStatus;
  }>;
}

function emptyCancelResult(): CancelResult {
  return { count: 0, cancelledTaskIds: [], cancelledRows: [] };
}

/**
 * Emit a `task:cancelled` WS broadcast for each row. Fires AFTER the caller
 * has committed its transaction (never from inside a trx — PITFALLS §SQ5).
 */
function broadcastCancelledRows(rows: CancelResult['cancelledRows']): void {
  for (const r of rows) {
    broadcast(r.workspaceId, {
      type: 'task:cancelled',
      taskId: r.taskId,
      issueId: r.issueId,
      payload: { taskId: r.taskId, issueId: r.issueId },
    });
  }
}

/**
 * Cancel all pending tasks (queued|dispatched) for an (issue, agent) pair.
 * Used by ISSUE-03 reassignment swap — must run in the caller's trx so the
 * cancel + new-enqueue are atomic.
 *
 * Phase 18-04 return-shape change: returns `CancelResult` (count + ids + rows)
 * so callers can broadcast `task:cancelled` per row after commit. The `count`
 * field preserves the Phase-17 number-returning contract.
 */
export async function cancelPendingTasksForIssueAgent(
  args: CancelPendingArgs,
): Promise<CancelResult> {
  const doWork = async (t: TxOrDb): Promise<CancelResult> => {
    const rows = (await t('agent_task_queue')
      .where({
        workspace_id: args.workspaceId,
        issue_id: args.issueId,
        agent_id: args.agentId,
      })
      .whereIn('status', ['queued', 'dispatched'])
      .select('id', 'status', 'issue_id', 'workspace_id')) as Array<{
      id: string;
      status: TaskStatus;
      issue_id: string;
      workspace_id: string;
    }>;
    if (rows.length === 0) return emptyCancelResult();

    const ids = rows.map((r) => r.id);
    // ST6 race guard: re-apply the status filter on the UPDATE so a concurrent
    // writer transitioning the row first (e.g. reaper) cannot be clobbered.
    await t('agent_task_queue')
      .whereIn('id', ids)
      .whereIn('status', ['queued', 'dispatched'])
      .update({
        status: 'cancelled',
        cancelled_at: defaultDb.fn.now(),
        updated_at: defaultDb.fn.now(),
      });

    return {
      count: ids.length,
      cancelledTaskIds: ids,
      cancelledRows: rows.map((r) => ({
        taskId: r.id,
        issueId: r.issue_id,
        workspaceId: r.workspace_id,
        previousStatus: r.status,
      })),
    };
  };

  if (args.trx) {
    // Caller owns the transaction — they also own broadcasts (to avoid ghost
    // events on rollback). Do NOT broadcast here even if emitBroadcasts=true.
    return doWork(args.trx);
  }

  const kx = resolveDb(args.db);
  const result = await withImmediateTx(kx, (tx) => doWork(tx));

  if (args.emitBroadcasts) {
    broadcastCancelledRows(result.cancelledRows);
  }

  return result;
}

/**
 * Cancel every live task (queued|dispatched|running) for an issue. Used by
 * ISSUE-04 when the issue itself transitions to `status='cancelled'`. Includes
 * `running` because an in-flight task should stop when the issue is killed.
 * Phase 19 + Phase 20 will attach runtime-side abort propagation (daemon
 * SIGTERM, hosted AbortController) around this — here we only flip the DB
 * state and (optionally) fire `task:cancelled` broadcasts.
 *
 * Phase 18-04 return-shape change: returns `CancelResult`. See
 * `cancelPendingTasksForIssueAgent` above for the full contract.
 */
export async function cancelAllTasksForIssue(
  args: CancelAllTasksArgs,
): Promise<CancelResult> {
  const doWork = async (t: TxOrDb): Promise<CancelResult> => {
    const rows = (await t('agent_task_queue')
      .where({
        workspace_id: args.workspaceId,
        issue_id: args.issueId,
      })
      .whereIn('status', ['queued', 'dispatched', 'running'])
      .select('id', 'status', 'issue_id', 'workspace_id')) as Array<{
      id: string;
      status: TaskStatus;
      issue_id: string;
      workspace_id: string;
    }>;
    if (rows.length === 0) return emptyCancelResult();

    const ids = rows.map((r) => r.id);
    await t('agent_task_queue')
      .whereIn('id', ids)
      .whereIn('status', ['queued', 'dispatched', 'running']) // ST6 race guard
      .update({
        status: 'cancelled',
        cancelled_at: defaultDb.fn.now(),
        updated_at: defaultDb.fn.now(),
      });

    return {
      count: ids.length,
      cancelledTaskIds: ids,
      cancelledRows: rows.map((r) => ({
        taskId: r.id,
        issueId: r.issue_id,
        workspaceId: r.workspace_id,
        previousStatus: r.status,
      })),
    };
  };

  if (args.trx) {
    return doWork(args.trx);
  }

  const kx = resolveDb(args.db);
  const result = await withImmediateTx(kx, (tx) => doWork(tx));

  if (args.emitBroadcasts) {
    broadcastCancelledRows(result.cancelledRows);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 18 lifecycle surface — claim / start / complete / fail / cancel /
// isTaskCancelled. Every write transaction opens with `BEGIN IMMEDIATE`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrate an `AgentTask` row into the Phase 20 `ClaimedTask` shape — includes
 * the joined agent snapshot + issue snapshot + trigger comment content so the
 * daemon / hosted worker does not need a second round-trip.
 *
 * Phase 18 ships this service function only. The HTTP route that wraps it
 * (`POST /api/daemon/runtimes/:id/tasks/claim`) is Phase 19.
 */
async function hydrateClaimedTask(
  r: TxOrDb,
  taskRow: Record<string, unknown>,
): Promise<ClaimedTask> {
  const base = toAgentTask(taskRow);
  const adapter = getAdapter();
  const agentRow = (await r('agents').where({ id: base.agentId }).first()) as
    | Record<string, unknown>
    | undefined;
  if (!agentRow) {
    throw new Error(`hydrateClaimedTask: agent ${base.agentId} not found`);
  }
  const issueRow = (await r('issues').where({ id: base.issueId }).first()) as
    | Record<string, unknown>
    | undefined;
  if (!issueRow) {
    throw new Error(`hydrateClaimedTask: issue ${base.issueId} not found`);
  }
  let triggerCommentContent: string | null = null;
  if (base.triggerCommentId) {
    const commentRow = (await r('comments')
      .where({ id: base.triggerCommentId })
      .first('content')) as Record<string, unknown> | undefined;
    triggerCommentContent = (commentRow?.content as string) ?? null;
  }
  return {
    ...base,
    agent: {
      id: agentRow.id as string,
      name: agentRow.name as string,
      instructions: (agentRow.instructions as string) ?? '',
      customEnv: agentRow.custom_env
        ? (adapter.parseJson<Record<string, string>>(agentRow.custom_env) ?? {})
        : {},
      customArgs: agentRow.custom_args
        ? (adapter.parseJson<string[]>(agentRow.custom_args) ?? [])
        : [],
    },
    issue: {
      id: issueRow.id as string,
      issueNumber: Number(issueRow.issue_number),
      title: issueRow.title as string,
      description: (issueRow.description as string) ?? null,
    },
    triggerCommentContent,
    workspaceId: base.workspaceId,
  };
}

/**
 * Atomically claim the highest-priority queued task for a runtime.
 *
 * Correctness (TASK-01, SC-1):
 *   1. `BEGIN IMMEDIATE` acquires the SQLite write lock up front, side-stepping
 *      the "deferred-upgrade SQLITE_BUSY" pitfall (PITFALLS §SQ1).
 *   2. The inner SELECT filters by `q.runtime_id=? AND q.status='queued'` with
 *      an agent join to apply the `max_concurrent_tasks` cap (AGENT-02). The
 *      `NOT EXISTS` semantic is expressed as `(count of dispatched|running) < cap`.
 *   3. The partial-unique index `idx_one_pending_task_per_issue_agent`
 *      (migration 007) is the schema-level coalescing guarantee — two pending
 *      rows for the same (issue_id, agent_id) cannot exist, so the claim can
 *      never return two.
 *   4. The UPDATE adds `.andWhere('status', 'queued')` as the final guard —
 *      if the row changed status between SELECT and UPDATE (impossible under
 *      BEGIN IMMEDIATE, but cheap to assert), the UPDATE matches zero rows and
 *      claimTask returns null.
 *
 * Returns `null` when nothing is claimable (capacity reached or no queued work).
 * Emits `task:dispatch` WS broadcast AFTER commit with `workspaceId` channel.
 */
export async function claimTask(
  runtimeId: string,
  dbOverride?: Knex,
): Promise<ClaimedTask | null> {
  const kx = resolveDb(dbOverride);
  const claimed = await withImmediateTx(kx, async (tx) => {
    // Inner SELECT — highest priority, oldest first, respecting
    // agent.max_concurrent_tasks and agent.archived_at.
    const candidate = await tx('agent_task_queue as q')
      .join('agents as a', 'a.id', 'q.agent_id')
      .where('q.runtime_id', runtimeId)
      .andWhere('q.status', 'queued')
      .whereNull('a.archived_at')
      .andWhereRaw(
        "(SELECT COUNT(*) FROM agent_task_queue c WHERE c.agent_id = q.agent_id AND c.status IN ('dispatched','running')) < a.max_concurrent_tasks",
      )
      .orderBy('q.priority', 'desc')
      .orderBy('q.created_at', 'asc')
      .first('q.id');
    if (!candidate) return null;

    const candidateId = candidate.id as string;
    const affected = await tx('agent_task_queue')
      .where({ id: candidateId })
      .andWhere('status', 'queued')
      .update({
        status: 'dispatched',
        dispatched_at: defaultDb.fn.now(),
        updated_at: defaultDb.fn.now(),
      });
    if (affected === 0) {
      // Impossible under BEGIN IMMEDIATE + pool=1, but keeps the service
      // honest if concurrency assumptions ever change.
      return null;
    }

    const row = (await tx('agent_task_queue').where({ id: candidateId }).first()) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return hydrateClaimedTask(tx, row);
  });

  if (claimed) {
    // Broadcast AFTER commit — never inside the transaction (PITFALLS §SQ5).
    broadcast(claimed.workspaceId, {
      type: 'task:dispatch',
      taskId: claimed.id,
      issueId: claimed.issueId,
      payload: { taskId: claimed.id, issueId: claimed.issueId },
    });
  }

  return claimed;
}

/**
 * Transition a task from `dispatched` to `running`. No-op (returns false) if
 * the task is not in `dispatched` state — callers must treat the false return
 * as "task already cancelled / failed / reaped" and back off. See TASK-02.
 */
export async function startTask(
  taskId: string,
  dbOverride?: Knex,
): Promise<{ started: boolean; status: TaskStatus }> {
  const kx = resolveDb(dbOverride);
  return withImmediateTx(kx, async (tx) => {
    const affected = await tx('agent_task_queue')
      .where({ id: taskId })
      .andWhere('status', 'dispatched')
      .update({
        status: 'running',
        started_at: defaultDb.fn.now(),
        updated_at: defaultDb.fn.now(),
      });
    if (affected === 0) {
      const row = (await tx('agent_task_queue').where({ id: taskId }).first('status')) as
        | { status: TaskStatus }
        | undefined;
      return { started: false, status: row?.status ?? 'queued' };
    }
    return { started: true, status: 'running' };
  });
}

/**
 * Terminal completion result (TASK-02 + TASK-06).
 *
 * `discarded=true` means the caller's request was dropped because the task is
 * already in a terminal state set by someone else (typically `cancelled` — user
 * hit Cancel after the daemon started the work, or reaper fired). In that case
 * the route layer returns HTTP 200 (not 400) per PITFALLS §PM5.
 */
export interface TerminalResult {
  discarded: boolean;
  status: TaskStatus;
}

/**
 * Transition a task from `running` to `completed`, OR return
 * `{ discarded: true, status: 'cancelled' }` when the task was already
 * cancelled. Never throws for the cancelled-race case (TASK-06).
 *
 * Any other non-`running` status (already completed / failed) is also treated
 * as `discarded=true` — idempotent for the daemon retry case.
 */
export async function completeTask(
  taskId: string,
  result: unknown,
  dbOverride?: Knex,
): Promise<TerminalResult> {
  const kx = resolveDb(dbOverride);
  const adapter = getAdapter();
  return withImmediateTx(kx, async (tx) => {
    const current = (await tx('agent_task_queue')
      .where({ id: taskId })
      .first('status')) as { status: TaskStatus } | undefined;
    if (!current) {
      throw new Error(`task ${taskId} not found`);
    }
    if (current.status === 'cancelled') {
      return { discarded: true, status: 'cancelled' };
    }
    const affected = await tx('agent_task_queue')
      .where({ id: taskId })
      .andWhere('status', 'running')
      .update({
        status: 'completed',
        completed_at: defaultDb.fn.now(),
        result: adapter.jsonValue(result),
        updated_at: defaultDb.fn.now(),
      });
    if (affected === 0) {
      const latest = (await tx('agent_task_queue')
        .where({ id: taskId })
        .first('status')) as { status: TaskStatus } | undefined;
      return {
        discarded: true,
        status: (latest?.status ?? current.status) as TaskStatus,
      };
    }
    return { discarded: false, status: 'completed' };
  });
}

/**
 * Transition a task from `dispatched|running` to `failed`, OR return
 * `{ discarded: true }` when the task was already cancelled. Mirrors
 * `completeTask` semantics for the race where the daemon reports a crash
 * after the user cancelled (TASK-06).
 */
export async function failTask(
  taskId: string,
  errorMessage: string,
  dbOverride?: Knex,
): Promise<TerminalResult> {
  const kx = resolveDb(dbOverride);
  return withImmediateTx(kx, async (tx) => {
    const current = (await tx('agent_task_queue')
      .where({ id: taskId })
      .first('status')) as { status: TaskStatus } | undefined;
    if (!current) {
      throw new Error(`task ${taskId} not found`);
    }
    if (current.status === 'cancelled') {
      return { discarded: true, status: 'cancelled' };
    }
    const affected = await tx('agent_task_queue')
      .where({ id: taskId })
      .whereIn('status', ['dispatched', 'running'])
      .update({
        status: 'failed',
        error: errorMessage,
        completed_at: defaultDb.fn.now(),
        updated_at: defaultDb.fn.now(),
      });
    if (affected === 0) {
      const latest = (await tx('agent_task_queue')
        .where({ id: taskId })
        .first('status')) as { status: TaskStatus } | undefined;
      return {
        discarded: true,
        status: (latest?.status ?? current.status) as TaskStatus,
      };
    }
    return { discarded: false, status: 'failed' };
  });
}

/**
 * Cancel a single task by id — transitions `queued|dispatched|running` to
 * `cancelled`. Idempotent: cancelling an already-terminal task is a no-op
 * (returns `{ cancelled: false }`). Emits `task:cancelled` WS broadcast after
 * commit. See TASK-05.
 *
 * Runtime-side abort propagation (daemon SIGTERM, hosted AbortController) is
 * Phase 19 / Phase 20 — Phase 18 only ships the DB flip + the `isTaskCancelled`
 * read surface.
 */
export async function cancelTask(
  taskId: string,
  dbOverride?: Knex,
): Promise<{ cancelled: boolean; previousStatus: TaskStatus | null }> {
  const kx = resolveDb(dbOverride);
  const result = await withImmediateTx(
    kx,
    async (
      tx,
    ): Promise<{
      cancelled: boolean;
      previousStatus: TaskStatus | null;
      workspaceId: string | null;
      issueId: string | null;
    }> => {
      const current = (await tx('agent_task_queue')
        .where({ id: taskId })
        .first('status', 'workspace_id', 'issue_id')) as
        | { status: TaskStatus; workspace_id: string; issue_id: string }
        | undefined;
      if (!current) {
        return { cancelled: false, previousStatus: null, workspaceId: null, issueId: null };
      }
      const affected = await tx('agent_task_queue')
        .where({ id: taskId })
        .whereIn('status', ['queued', 'dispatched', 'running'])
        .update({
          status: 'cancelled',
          cancelled_at: defaultDb.fn.now(),
          updated_at: defaultDb.fn.now(),
        });
      return {
        cancelled: affected > 0,
        previousStatus: current.status,
        workspaceId: current.workspace_id,
        issueId: current.issue_id,
      };
    },
  );

  if (result.cancelled && result.workspaceId && result.issueId) {
    broadcast(result.workspaceId, {
      type: 'task:cancelled',
      taskId,
      issueId: result.issueId,
      payload: { taskId, issueId: result.issueId },
    });
  }

  return { cancelled: result.cancelled, previousStatus: result.previousStatus };
}

/**
 * Cheap indexed read for `status='cancelled'`. Used by daemon workers (Phase
 * 19 — CLI-06 5-second SLA) and hosted workers (Phase 20 — AbortController
 * check) to detect user cancellation between the DB flip and the runtime-side
 * propagation. Returns `false` if the task does not exist.
 */
export async function isTaskCancelled(
  taskId: string,
  dbOverride?: Knex,
): Promise<boolean> {
  const kx = resolveDb(dbOverride);
  const row = (await kx('agent_task_queue')
    .where({ id: taskId })
    .first('status')) as { status: TaskStatus } | undefined;
  return row?.status === 'cancelled';
}

/**
 * Phase 24-02 — list the most-recent tasks for an issue, ordered by
 * `created_at DESC`. Workspace-scoped: cross-workspace issueIds return an
 * empty array (T-24-02-06 information-disclosure mitigation).
 *
 * Default `limit = 20`. TaskPanel only renders the first row (`latestTask`);
 * the higher cap keeps room for a future "Task history" drawer (24-UI-SPEC
 * §Task panel interactions — stretch goal) without another round-trip.
 */
export async function listTasksForIssue(
  workspaceId: string,
  issueId: string,
  limit = 20,
  dbOverride?: Knex,
): Promise<AgentTask[]> {
  const kx = resolveDb(dbOverride);
  const rows = (await kx('agent_task_queue')
    .where({ workspace_id: workspaceId, issue_id: issueId })
    .orderBy('created_at', 'desc')
    .limit(limit)) as Array<Record<string, unknown>>;
  return rows.map(toAgentTask);
}
