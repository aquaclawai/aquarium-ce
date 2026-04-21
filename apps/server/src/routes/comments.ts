import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createUserComment,
  updateComment,
  deleteComment,
  getComment,
  listCommentsForIssue,
  type CreateUserCommentArgs,
  type UpdateCommentPatch,
} from '../services/comment-store.js';
import { broadcast } from '../ws/index.js';
import type { ApiResponse, Comment, AgentTask } from '@aquarium/shared';

// CE: single default workspace (seeded by migration 003). Matches routes/runtimes.ts,
// routes/agents.ts, and routes/issues.ts. TODO(EE): swap for `req.auth.workspaceId`.
const DEFAULT_WORKSPACE_ID = 'AQ';

/**
 * Map service-layer validation errors to HTTP 400. Known patterns:
 *   • "content is required" / "content cannot be empty"
 *   • "issue not found in workspace" / "parent comment not found in this issue"
 *   • "parent comment must be a user comment"
 *   • "type must be one of ..."
 */
function isValidationError(message: string): boolean {
  return /is required|cannot be empty|not found in|must be/.test(message);
}

/**
 * Nested router mounted at `/api/issues/:issueId/comments`.
 *
 * Handles the timeline-bound flows (list + post). `mergeParams: true` is
 * required for `req.params.issueId` to populate in a router mounted on a
 * parent path that declared the param.
 */
export const issueCommentRouter = Router({ mergeParams: true });
issueCommentRouter.use(requireAuth);

/**
 * GET /api/issues/:issueId/comments
 *
 * COMMENT-01 / 02 / 03: full timeline for the issue (user + system),
 * ordered by created_at ASC. Returns [] silently for out-of-workspace
 * issues (T-17-04-03 mitigation is the workspace-gate in
 * listCommentsForIssue).
 */
issueCommentRouter.get('/', async (req, res) => {
  try {
    const { issueId } = req.params as { issueId: string };
    const comments = await listCommentsForIssue(DEFAULT_WORKSPACE_ID, issueId);
    res.json({ ok: true, data: comments } satisfies ApiResponse<Comment[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * POST /api/issues/:issueId/comments
 *
 * Body: { content: string, parentId?: string|null, triggerCommentId?: string|null, metadata? }
 *
 * COMMENT-01: if triggerCommentId is supplied AND the issue has an assignee,
 * createUserComment enqueues an agent task with trigger_comment_id pointing
 * at the newly created comment id.
 *
 * T-17-04-01 mitigation: we do NOT forward `authorType` / `authorUserId` /
 * `authorAgentId` from the body — those are set server-side from req.auth.
 */
issueCommentRouter.post('/', async (req, res) => {
  try {
    const { issueId } = req.params as { issueId: string };
    const body = (req.body ?? {}) as Partial<CreateUserCommentArgs>;
    if (typeof body.content !== 'string') {
      res
        .status(400)
        .json({ ok: false, error: 'content is required' } satisfies ApiResponse);
      return;
    }
    const result = await createUserComment({
      workspaceId: DEFAULT_WORKSPACE_ID,
      issueId,
      authorUserId: req.auth?.userId ?? 'unknown',
      content: body.content,
      parentId: body.parentId ?? null,
      triggerCommentId: body.triggerCommentId ?? null,
      metadata: body.metadata,
    });
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'comment:posted',
      issueId,
      payload: result.comment,
    });
    res.status(201).json({
      ok: true,
      data: { comment: result.comment, enqueuedTask: result.enqueuedTask },
    } satisfies ApiResponse<{ comment: Comment; enqueuedTask: AgentTask | null }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(isValidationError(message) ? 400 : 500)
      .json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * Top-level router mounted at `/api/comments`.
 *
 * Handles GET / PATCH / DELETE on a specific comment by id. These endpoints
 * are addressed directly from client-side UI (e.g. comment-context-menu edits
 * and deletions) — separate from the timeline router above.
 */
export const commentRouter = Router();
commentRouter.use(requireAuth);

/**
 * GET /api/comments/:id
 */
commentRouter.get('/:id', async (req, res) => {
  try {
    const comment = await getComment(req.params.id);
    if (!comment) {
      res
        .status(404)
        .json({ ok: false, error: 'Comment not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: comment } satisfies ApiResponse<Comment>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * PATCH /api/comments/:id
 *
 * Body: { content?: string }. Only `content` is mutable — author, type, and
 * parent are immutable (T-17-04-02 + T-17-04-01 mitigations).
 */
commentRouter.patch('/:id', async (req, res) => {
  try {
    const existing = await getComment(req.params.id);
    if (!existing) {
      res
        .status(404)
        .json({ ok: false, error: 'Comment not found' } satisfies ApiResponse);
      return;
    }
    const patch = (req.body ?? {}) as UpdateCommentPatch;
    const comment = await updateComment(req.params.id, existing.issueId, patch);
    if (!comment) {
      res
        .status(404)
        .json({ ok: false, error: 'Comment not found' } satisfies ApiResponse);
      return;
    }
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'comment:updated',
      issueId: comment.issueId,
      payload: comment,
    });
    res.json({ ok: true, data: comment } satisfies ApiResponse<Comment>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(isValidationError(message) ? 400 : 500)
      .json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * DELETE /api/comments/:id
 *
 * Hard-delete. Children preserved via schema-level SET NULL on the
 * self-referencing parent_id FK (migration 006 + PITFALLS §ST4).
 */
commentRouter.delete('/:id', async (req, res) => {
  try {
    const existing = await getComment(req.params.id);
    if (!existing) {
      res
        .status(404)
        .json({ ok: false, error: 'Comment not found' } satisfies ApiResponse);
      return;
    }
    const ok = await deleteComment(req.params.id, existing.issueId);
    if (!ok) {
      res
        .status(404)
        .json({ ok: false, error: 'Comment not found' } satisfies ApiResponse);
      return;
    }
    broadcast(DEFAULT_WORKSPACE_ID, {
      type: 'comment:deleted',
      issueId: existing.issueId,
      payload: { id: req.params.id },
    });
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default commentRouter;
