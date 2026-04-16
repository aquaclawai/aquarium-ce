import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import {
  enqueueTaskForIssue,
  cancelPendingTasksForIssueAgent,
  cancelAllTasksForIssue,
} from './task-queue-store.js';
import type { Issue, IssueStatus, IssuePriority } from '@aquarium/shared';
import type { Knex } from 'knex';

/**
 * Issue store — CRUD + kanban reorder for the `issues` table.
 *
 * Responsibilities (Phase 17):
 *   • createIssue       — atomic issue_number allocation via workspaces.issue_counter
 *   • updateIssue       — pure field updates (status side-effects live in plan 17-03)
 *   • deleteIssue       — hard delete; FK CASCADE clears comments + tasks
 *   • getIssue / list   — workspace-scoped reads; list uses idx_issues_kanban ordering
 *   • reorderIssue      — fractional midpoint between neighbours with collapse-detection
 *                         and automatic renumber sweep when precision thrash occurs
 *
 * HARD constraints:
 *   • All reads/writes are workspace-scoped (CE passes 'AQ').
 *   • issue_number is allocated inside db.transaction() via atomic counter-bump
 *     (per 15-04 SUMMARY §"Reminder for Phase 17"). Schema has
 *     UNIQUE(workspace_id, issue_number); atomicity is the service's job.
 *   • Status/priority validated at the API boundary — migration-006 triggers are
 *     the DB backstop, not the first line of defense.
 *   • reorderIssue detects fractional collapse (|a - b| < 1e-6) and renumbers
 *     the entire workspace in a single transaction to step=1000 before retrying.
 */

const RENUMBER_STEP = 1000;
const COLLAPSE_EPSILON = 1e-6;

function toIssue(row: Record<string, unknown>): Issue {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    issueNumber: Number(row.issue_number),
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as IssueStatus,
    priority: row.priority as IssuePriority,
    assigneeId: (row.assignee_id as string) ?? null,
    creatorUserId: (row.creator_user_id as string) ?? null,
    position:
      row.position !== null && row.position !== undefined ? Number(row.position) : null,
    dueDate: row.due_date ? String(row.due_date) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    metadata: row.metadata
      ? (adapter.parseJson<Record<string, unknown>>(row.metadata) ?? {})
      : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const VALID_STATUS: ReadonlyArray<IssueStatus> = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'blocked',
  'cancelled',
];
const VALID_PRIORITY: ReadonlyArray<IssuePriority> = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];

function validateStatus(s: string): asserts s is IssueStatus {
  if (!VALID_STATUS.includes(s as IssueStatus)) {
    throw new Error(`status must be one of ${VALID_STATUS.join(', ')}`);
  }
}

function validatePriority(p: string): asserts p is IssuePriority {
  if (!VALID_PRIORITY.includes(p as IssuePriority)) {
    throw new Error(`priority must be one of ${VALID_PRIORITY.join(', ')}`);
  }
}

export interface CreateIssueArgs {
  workspaceId: string;
  title: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
  creatorUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new issue with an atomically-allocated `issue_number`.
 *
 * The increment + read-back + INSERT run inside the same `db.transaction()`.
 * SQLite's BEGIN IMMEDIATE (from our `busy_timeout=5000` + WAL pragmas, migration
 * 003) serialises concurrent writers, and the DB-side UNIQUE(workspace_id,
 * issue_number) is the last-line backstop if serialisation ever breaks.
 */
export async function createIssue(args: CreateIssueArgs): Promise<Issue> {
  const adapter = getAdapter();
  if (args.status !== undefined) validateStatus(args.status);
  if (args.priority !== undefined) validatePriority(args.priority);
  if (!args.title || args.title.trim().length === 0) {
    throw new Error('title is required');
  }

  const id = randomUUID();
  return db.transaction(async (trx) => {
    // Atomic counter bump — SQLite BEGIN IMMEDIATE + busy_timeout=5000 + WAL serialise writers.
    await trx('workspaces').where({ id: args.workspaceId }).increment('issue_counter', 1);
    const ws = await trx('workspaces')
      .where({ id: args.workspaceId })
      .first('issue_counter');
    if (!ws) throw new Error(`workspace ${args.workspaceId} not found`);
    const issueNumber = Number(ws.issue_counter);

    await trx('issues').insert({
      id,
      workspace_id: args.workspaceId,
      issue_number: issueNumber,
      title: args.title,
      description: args.description ?? null,
      status: args.status ?? 'backlog',
      priority: args.priority ?? 'medium',
      assignee_id: args.assigneeId ?? null,
      creator_user_id: args.creatorUserId ?? null,
      position: null, // NULL until first drag — per 15-04 decision
      due_date: args.dueDate ?? null,
      completed_at: null,
      cancelled_at: null,
      metadata: adapter.jsonValue(args.metadata ?? {}),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const row = await trx('issues').where({ id }).first();
    if (!row) throw new Error('Issue creation failed — row not readable');
    return toIssue(row as Record<string, unknown>);
  });
}

export interface UpdateIssuePatch {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Status / assignee transition side-effects (ISSUE-02, ISSUE-03, ISSUE-04).
 *
 * Runs inside the same transaction as updateIssue's field UPDATE so that
 * cancel-old + enqueue-new under reassignment, and cancel-all under
 * issue-cancellation, are atomic. Branches are mutually exclusive:
 *
 *   next.status='cancelled' & prev.status!='cancelled'     → cancelAllTasksForIssue (ISSUE-04)
 *   assigneeId changed (reassignment):                      ISSUE-03
 *     · prev.assigneeId !== null                           → cancelPendingTasksForIssueAgent
 *     · next.assigneeId !== null & next.status!='backlog'  → enqueueTaskForIssue   (ISSUE-02)
 *   assigneeId unchanged & prev.status='backlog' & next!='backlog' & assignee set
 *                                                          → enqueueTaskForIssue   (ISSUE-02)
 *
 * Notes:
 *   • Clearing the assignee (next.assigneeId = null) counts as a reassignment — the
 *     old pending task is cancelled and no new task is enqueued.
 *   • Reassigning to the SAME agent (prev === next) is not a reassignment and
 *     produces zero writes here (task-queue-store's idempotency guards a no-op
 *     even if the ladder were traversed).
 */
async function applyIssueSideEffects(
  trx: Knex.Transaction,
  workspaceId: string,
  prev: { status: string; assigneeId: string | null },
  next: { status: string; assigneeId: string | null },
  issueId: string,
): Promise<void> {
  // ISSUE-04: transition to 'cancelled' cancels every live task (pending + running)
  if (next.status === 'cancelled' && prev.status !== 'cancelled') {
    await cancelAllTasksForIssue({ workspaceId, issueId, trx });
    return;
  }

  const reassignment = next.assigneeId !== prev.assigneeId;
  const leavingBacklog = prev.status === 'backlog' && next.status !== 'backlog';

  // ISSUE-03: reassignment swap (including assign→null and null→assign)
  if (reassignment) {
    if (prev.assigneeId) {
      await cancelPendingTasksForIssueAgent({
        workspaceId,
        issueId,
        agentId: prev.assigneeId,
        trx,
      });
    }
    if (next.assigneeId && next.status !== 'backlog') {
      // ISSUE-02: new assignee on a non-backlog issue auto-enqueues
      await enqueueTaskForIssue({
        workspaceId,
        issueId,
        agentId: next.assigneeId,
        trx,
      });
    }
    return;
  }

  // ISSUE-02: same assignee, issue moved OUT of backlog — enqueue if assignee present
  if (leavingBacklog && next.assigneeId) {
    await enqueueTaskForIssue({
      workspaceId,
      issueId,
      agentId: next.assigneeId,
      trx,
    });
  }
}

/**
 * Field update + status/assignee side-effects.
 *
 * Terminal-status timestamp bookkeeping (completed_at / cancelled_at) and the
 * task-queue side-effect dispatch both run inside the same `db.transaction()`
 * that wraps the field UPDATE. Any thrown error rolls back the whole unit.
 */
export async function updateIssue(
  id: string,
  workspaceId: string,
  patch: UpdateIssuePatch,
): Promise<Issue | null> {
  const adapter = getAdapter();
  if (patch.status !== undefined) validateStatus(patch.status);
  if (patch.priority !== undefined) validatePriority(patch.priority);

  return db.transaction(async (trx) => {
    const existing = await trx('issues')
      .where({ id, workspace_id: workspaceId })
      .first();
    if (!existing) return null;

    const update: Record<string, unknown> = { updated_at: db.fn.now() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.status !== undefined) {
      update.status = patch.status;
      // Terminal-status timestamp bookkeeping (pure field logic, not side-effects)
      if (patch.status === 'done' && !existing.completed_at) {
        update.completed_at = db.fn.now();
      }
      if (patch.status === 'cancelled' && !existing.cancelled_at) {
        update.cancelled_at = db.fn.now();
      }
    }
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId;
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
    if (patch.metadata !== undefined) update.metadata = adapter.jsonValue(patch.metadata);

    await trx('issues').where({ id, workspace_id: workspaceId }).update(update);

    // Compute effective next values — fields not in the patch stay at existing.
    const nextStatus: string = (patch.status ?? existing.status) as string;
    const nextAssigneeId: string | null =
      patch.assigneeId !== undefined
        ? patch.assigneeId
        : ((existing.assignee_id as string) ?? null);

    await applyIssueSideEffects(
      trx,
      workspaceId,
      {
        status: existing.status as string,
        assigneeId: (existing.assignee_id as string) ?? null,
      },
      { status: nextStatus, assigneeId: nextAssigneeId },
      id,
    );

    const row = await trx('issues').where({ id, workspace_id: workspaceId }).first();
    return row ? toIssue(row as Record<string, unknown>) : null;
  });
}

export async function deleteIssue(id: string, workspaceId: string): Promise<boolean> {
  const affected = await db('issues').where({ id, workspace_id: workspaceId }).delete();
  return affected > 0;
}

export async function getIssue(id: string, workspaceId: string): Promise<Issue | null> {
  const row = await db('issues').where({ id, workspace_id: workspaceId }).first();
  return row ? toIssue(row as Record<string, unknown>) : null;
}

export interface ListIssuesOpts {
  status?: IssueStatus;
  assigneeId?: string;
}

/**
 * Workspace-scoped list.
 *
 * Kanban ordering: `position` NULLS LAST, then `created_at` DESC. SQLite and
 * Postgres both support the CASE-WHEN-NULL idiom with a literal constant
 * orderByRaw string (no user input — SQLi-safe per CLAUDE.md §"Server Patterns").
 */
export async function listIssues(
  workspaceId: string,
  opts: ListIssuesOpts = {},
): Promise<Issue[]> {
  let query = db('issues').where({ workspace_id: workspaceId });
  if (opts.status) query = query.where({ status: opts.status });
  if (opts.assigneeId) query = query.where({ assignee_id: opts.assigneeId });
  const rows = await query
    .orderByRaw('CASE WHEN position IS NULL THEN 1 ELSE 0 END ASC')
    .orderBy('position', 'asc')
    .orderBy('created_at', 'desc');
  return rows.map((r: Record<string, unknown>) => toIssue(r));
}

export interface ReorderIssueArgs {
  beforeId?: string | null;
  afterId?: string | null;
}

/**
 * Read `position` for a neighbour issue inside the active transaction.
 * Throws if the referenced id does not exist in the given workspace — a 400 at
 * the route boundary is clearer than silently treating the neighbour as NULL.
 */
async function readPosition(
  trx: Knex.Transaction,
  workspaceId: string,
  id: string | null | undefined,
): Promise<number | null> {
  if (!id) return null;
  const row = await trx('issues')
    .where({ id, workspace_id: workspaceId })
    .first('position');
  if (!row) throw new Error(`neighbour issue ${id} not found in workspace`);
  return row.position !== null && row.position !== undefined ? Number(row.position) : null;
}

/**
 * Renumber every non-null-positioned issue in the workspace to step=1000.
 * Called inside the reorder transaction when collapse is detected. step=1000
 * gives ~10^6 headroom for successive midpoint divisions before the next
 * sweep is needed (each midpoint halves the gap; 2^20 ≈ 10^6).
 */
async function renumberWorkspacePositions(
  trx: Knex.Transaction,
  workspaceId: string,
): Promise<void> {
  const rows = await trx('issues')
    .where({ workspace_id: workspaceId })
    .whereNotNull('position')
    .orderBy('position', 'asc')
    .select('id');
  let pos = RENUMBER_STEP;
  for (const row of rows) {
    await trx('issues')
      .where({ id: row.id as string })
      .update({ position: pos, updated_at: db.fn.now() });
    pos += RENUMBER_STEP;
  }
}

/**
 * Compute the new position for an issue landing between `before` and `after`.
 *
 *   - both NULL              → first entry:           RENUMBER_STEP
 *   - only `after` given     → move below that row:   after + RENUMBER_STEP
 *   - only `before` given    → move above that row:   before - RENUMBER_STEP
 *   - both given             → midpoint:              (before + after) / 2
 *
 * `before` is the row positioned BEFORE the target on screen (smaller
 * position), `after` is the row AFTER the target on screen (larger position).
 */
function computeMidpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return RENUMBER_STEP;
  if (before !== null && after === null) return before + RENUMBER_STEP;
  if (before === null && after !== null) return after - RENUMBER_STEP;
  // both non-null
  return (Number(before) + Number(after)) / 2;
}

/**
 * Reorder an issue between two neighbours.
 *
 * ISSUE-05: fractional midpoint with collapse detection. The entire operation
 * runs inside a single `db.transaction()` so (a) position reads/writes are
 * atomic w.r.t. concurrent reorders and (b) the renumber sweep — when
 * triggered — runs under the same lock as the computation that needed it.
 */
export async function reorderIssue(
  id: string,
  workspaceId: string,
  args: ReorderIssueArgs,
): Promise<Issue | null> {
  return db.transaction(async (trx) => {
    const target = await trx('issues')
      .where({ id, workspace_id: workspaceId })
      .first();
    if (!target) return null;

    let beforePos = await readPosition(trx, workspaceId, args.beforeId ?? null);
    let afterPos = await readPosition(trx, workspaceId, args.afterId ?? null);

    // Collapse detection: both neighbours non-null and positions too close to bisect.
    if (
      beforePos !== null &&
      afterPos !== null &&
      Math.abs(beforePos - afterPos) < COLLAPSE_EPSILON
    ) {
      await renumberWorkspacePositions(trx, workspaceId);
      beforePos = await readPosition(trx, workspaceId, args.beforeId ?? null);
      afterPos = await readPosition(trx, workspaceId, args.afterId ?? null);
    }

    const newPos = computeMidpoint(beforePos, afterPos);
    await trx('issues')
      .where({ id, workspace_id: workspaceId })
      .update({ position: newPos, updated_at: db.fn.now() });

    const row = await trx('issues').where({ id, workspace_id: workspaceId }).first();
    return row ? toIssue(row as Record<string, unknown>) : null;
  });
}

export { toIssue };
