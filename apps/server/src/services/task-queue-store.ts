import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import type { AgentTask, TaskStatus } from '@aquarium/shared';

/**
 * Task queue store — Phase 17 slice (enqueue + cancel only).
 *
 * This file ships the MINIMUM task-queue surface needed for issue-status
 * transitions to work. Phase 18 will extend this module with:
 *   • claimTask(runtimeId) using BEGIN IMMEDIATE (SCH-05 partial unique is the backstop)
 *   • startTask / progressTask / completeTask / failTask (task lifecycle)
 *   • reapStaleTasks (dispatched > 5min, running > 2.5h — TASK-04)
 *   • cancelTask(id) with runtime-side abort propagation (TASK-05)
 *
 * Responsibilities (Phase 17):
 *   • enqueueTaskForIssue                  — ISSUE-02 assign hook
 *   • cancelPendingTasksForIssueAgent      — ISSUE-03 reassign swap
 *   • cancelAllTasksForIssue               — ISSUE-04 issue cancellation
 *   • getPendingTaskForIssueAgent          — idempotency check + tests
 *
 * HARD constraints:
 *   • All operations accept an optional `trx` parameter so callers (issue-store)
 *     can chain them inside their own db.transaction() — ISSUE-03's cancel+enqueue
 *     swap MUST be atomic.
 *   • idx_one_pending_task_per_issue_agent (migration 007) is a safety net; the
 *     enqueue path already checks for a pending row first (idempotency).
 *   • Enqueue with agent.runtime_id = NULL is a no-op that returns null and
 *     logs a warning — tasks require a dispatch target (§ST4 "agents outlive
 *     runtimes"; tasks do not).
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
function runner(trx?: Knex.Transaction): TxOrDb {
  return trx ?? db;
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
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const row = await trx('agent_task_queue').where({ id }).first();
    return row ? toAgentTask(row as Record<string, unknown>) : null;
  };

  if (args.trx) return doEnqueue(args.trx);
  return db.transaction(doEnqueue);
}

export interface CancelPendingArgs {
  workspaceId: string;
  issueId: string;
  agentId: string;
  trx?: Knex.Transaction;
}

/**
 * Cancel all pending tasks (queued|dispatched) for an (issue, agent) pair.
 * Used by ISSUE-03 reassignment swap — must run in the caller's trx so the
 * cancel + new-enqueue are atomic.
 */
export async function cancelPendingTasksForIssueAgent(args: CancelPendingArgs): Promise<number> {
  const r = runner(args.trx);
  const affected = await r('agent_task_queue')
    .where({
      workspace_id: args.workspaceId,
      issue_id: args.issueId,
      agent_id: args.agentId,
    })
    .whereIn('status', ['queued', 'dispatched'])
    .update({
      status: 'cancelled',
      cancelled_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  return Number(affected);
}

export interface CancelAllTasksArgs {
  workspaceId: string;
  issueId: string;
  trx?: Knex.Transaction;
}

/**
 * Cancel every live task (queued|dispatched|running) for an issue. Used by
 * ISSUE-04 when the issue itself transitions to `status='cancelled'`. Includes
 * `running` because an in-flight task should stop when the issue is killed.
 * Phase 18 will attach runtime-side abort propagation around this — here we
 * only flip the DB state.
 */
export async function cancelAllTasksForIssue(args: CancelAllTasksArgs): Promise<number> {
  const r = runner(args.trx);
  const affected = await r('agent_task_queue')
    .where({
      workspace_id: args.workspaceId,
      issue_id: args.issueId,
    })
    .whereIn('status', ['queued', 'dispatched', 'running'])
    .update({
      status: 'cancelled',
      cancelled_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  return Number(affected);
}
