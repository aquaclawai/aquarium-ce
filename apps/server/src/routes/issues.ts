import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createIssue,
  updateIssue,
  deleteIssue,
  getIssue,
  listIssues,
  reorderIssue,
  type CreateIssueArgs,
  type UpdateIssuePatch,
  type ListIssuesOpts,
  type ReorderIssueArgs,
} from '../services/issue-store.js';
import { listTasksForIssue } from '../services/task-queue-store.js';
import { broadcast } from '../ws/index.js';
import type { AgentTask, ApiResponse, Issue, IssueStatus } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// CE: single default workspace (seeded by migration 003). Matches routes/runtimes.ts + routes/agents.ts.
// TODO(EE): swap for `req.auth.workspaceId` once the auth payload carries it.
const DEFAULT_WORKSPACE_ID = 'AQ';

/**
 * Validation errors from the service layer surface here as `Error.message`.
 * Known patterns:
 *   • "status must be ..." / "priority must be ..." — validateStatus/Priority
 *   • "title is required" — createIssue guard
 *   • "neighbour issue ... not found in workspace" — readPosition under reorder
 *   • "UNIQUE constraint failed" — DB backstop (should not reach here under
 *     normal atomic allocation; kept for defence-in-depth).
 */
function isValidationError(message: string): boolean {
  return /must be|is required|not found in workspace|UNIQUE constraint failed/.test(message);
}

/**
 * GET /api/issues[?status=in_progress][&assigneeId=...]
 *
 * ISSUE-01 list. Ordering: position NULLS LAST, created_at DESC (kanban hot path,
 * idx_issues_kanban covers the composite (workspace_id, status, position)).
 */
router.get('/', async (req, res) => {
  try {
    const opts: ListIssuesOpts = {};
    if (typeof req.query.status === 'string') opts.status = req.query.status as IssueStatus;
    if (typeof req.query.assigneeId === 'string') opts.assigneeId = req.query.assigneeId;
    const issues = await listIssues(DEFAULT_WORKSPACE_ID, opts);
    res.json({ ok: true, data: issues } satisfies ApiResponse<Issue[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * GET /api/issues/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const issue = await getIssue(req.params.id, DEFAULT_WORKSPACE_ID);
    if (!issue) {
      res.status(404).json({ ok: false, error: 'Issue not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: issue } satisfies ApiResponse<Issue>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * GET /api/issues/:id/tasks
 *
 * Phase 24-02 (UI-05). Returns up to 20 recent tasks for the issue, ordered
 * by `created_at DESC`. Consumed by `useIssueDetail` to derive `latestTask`
 * for the TaskPanel. Workspace-scoped — cross-workspace issueIds return an
 * empty array (T-24-02-06 information-disclosure mitigation).
 */
router.get('/:id/tasks', async (req, res) => {
  try {
    const tasks = await listTasksForIssue(DEFAULT_WORKSPACE_ID, req.params.id);
    res.json({ ok: true, data: { tasks } } satisfies ApiResponse<{ tasks: AgentTask[] }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * POST /api/issues
 *
 * Body: CreateIssueArgs (minus workspaceId + creatorUserId which come from auth).
 * ISSUE-01 create with atomic `issue_number` allocation (per plan 17-02 task 1).
 */
router.post('/', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreateIssueArgs>;
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'title is required' } satisfies ApiResponse);
      return;
    }
    const issue = await createIssue({
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: body.title,
      description: body.description ?? null,
      status: body.status,
      priority: body.priority,
      assigneeId: body.assigneeId ?? null,
      creatorUserId: req.auth?.userId ?? null,
      dueDate: body.dueDate ?? null,
      metadata: body.metadata,
    });
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'issue:created',
      issueId: issue.id,
      payload: issue,
    });
    res.status(201).json({ ok: true, data: issue } satisfies ApiResponse<Issue>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(isValidationError(message) ? 400 : 500)
      .json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * PATCH /api/issues/:id
 *
 * Body: UpdateIssuePatch (partial — every field optional). Status transitions
 * are pure field updates here; task enqueue/cancel side-effects attach in
 * plan 17-03.
 */
router.patch('/:id', async (req, res) => {
  try {
    const patch = (req.body ?? {}) as UpdateIssuePatch;
    const result = await updateIssue(req.params.id, DEFAULT_WORKSPACE_ID, patch);
    if (!result) {
      res.status(404).json({ ok: false, error: 'Issue not found' } satisfies ApiResponse);
      return;
    }
    const { issue, cancelledTasks } = result;
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'issue:updated',
      issueId: issue.id,
      payload: issue,
    });
    // Phase 18-04 TASK-05: after the service transaction commits, fan out a
    // `task:cancelled` WS event per row cancelled by side-effects (ISSUE-03
    // reassign swap or ISSUE-04 issue-cancel). The helpers passed `trx` to
    // the service so they did NOT broadcast themselves — the route owns the
    // broadcast to avoid ghost events on rollback (§threat_model T-18-19).
    for (const row of cancelledTasks) {
      broadcast(row.workspaceId, {
        type: 'task:cancelled',
        taskId: row.taskId,
        issueId: row.issueId,
        payload: { taskId: row.taskId, issueId: row.issueId },
      });
    }
    res.json({ ok: true, data: issue } satisfies ApiResponse<Issue>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(isValidationError(message) ? 400 : 500)
      .json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * DELETE /api/issues/:id
 *
 * Hard-delete. FK CASCADE on comments and agent_task_queue removes children.
 * Unlike agents (which are soft-archived to preserve FK targets), issues are
 * the parents of those cascades — a true delete is the intended semantic.
 */
router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteIssue(req.params.id, DEFAULT_WORKSPACE_ID);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'Issue not found' } satisfies ApiResponse);
      return;
    }
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'issue:deleted',
      issueId: req.params.id,
    });
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * POST /api/issues/:id/reorder
 *
 * Body: { beforeId?: string | null, afterId?: string | null }
 * ISSUE-05: server computes the midpoint between neighbours, triggers a
 * workspace-wide renumber sweep when precision collapses below 1e-6.
 */
router.post('/:id/reorder', async (req, res) => {
  try {
    const body = (req.body ?? {}) as ReorderIssueArgs;
    const issue = await reorderIssue(req.params.id, DEFAULT_WORKSPACE_ID, body);
    if (!issue) {
      res.status(404).json({ ok: false, error: 'Issue not found' } satisfies ApiResponse);
      return;
    }
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'issue:reordered',
      issueId: issue.id,
      payload: { position: issue.position },
    });
    res.json({ ok: true, data: issue } satisfies ApiResponse<Issue>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(isValidationError(message) ? 400 : 500)
      .json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
