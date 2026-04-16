import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { enqueueTaskForIssue } from './task-queue-store.js';
import type {
  Comment,
  CommentType,
  CommentAuthorType,
  AgentTask,
} from '@aquarium/shared';
import type { Knex } from 'knex';

/**
 * Comment store — CRUD + system-comment factory + trigger-comment enqueue.
 *
 * Responsibilities (Phase 17):
 *   • createUserComment       — user-authored comment; triggers task enqueue if triggerCommentId
 *                               is supplied AND the issue has an assignee (COMMENT-01)
 *   • createSystemComment     — author_type='system' factory for applyIssueSideEffects
 *                               (COMMENT-02) and future progress updates
 *   • updateComment           — content-only PATCH
 *   • deleteComment           — hard delete; schema SET NULL preserves children
 *   • getComment              — direct fetch by comment id
 *   • listCommentsForIssue    — ordered timeline (created_at ASC)
 *
 * HARD constraints:
 *   • XOR trigger (migration 006): author_type ↔ author_*_id must be consistent.
 *     This module is the ONLY author of that invariant: user comments always set
 *     author_user_id and NULL out author_agent_id; system comments NULL both.
 *     Agent-authored comments are Phase 18's responsibility (the hosted/daemon
 *     workers will call createAgentComment — stubbed out of scope here).
 *   • triggerCommentId on createUserComment: if set AND issue has an assignee,
 *     enqueueTaskForIssue is called inside the same transaction. If the issue
 *     has no assignee, the comment still posts (no-op enqueue).
 *   • Parent validation: if parentId supplied, we verify same-issue membership
 *     before insert (XOR trigger doesn't enforce this; we do it at the service).
 *     Parent must be a user comment (not a system status_change entry) — replies
 *     target conversation, not bookkeeping.
 */

function toComment(row: Record<string, unknown>): Comment {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    issueId: row.issue_id as string,
    authorType: row.author_type as CommentAuthorType,
    authorUserId: (row.author_user_id as string) ?? null,
    authorAgentId: (row.author_agent_id as string) ?? null,
    content: row.content as string,
    type: row.type as CommentType,
    parentId: (row.parent_id as string) ?? null,
    metadata: row.metadata
      ? (adapter.parseJson<Record<string, unknown>>(row.metadata) ?? {})
      : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const VALID_TYPES: ReadonlyArray<CommentType> = [
  'comment',
  'status_change',
  'progress_update',
  'system',
];
function validateType(t: string): asserts t is CommentType {
  if (!VALID_TYPES.includes(t as CommentType)) {
    throw new Error(`type must be one of ${VALID_TYPES.join(', ')}`);
  }
}

export interface CreateUserCommentArgs {
  workspaceId: string;
  issueId: string;
  authorUserId: string;
  content: string;
  parentId?: string | null;
  /** If set, enqueues a task for the issue's current assignee (COMMENT-01). */
  triggerCommentId?: string | null;
  metadata?: Record<string, unknown>;
  trx?: Knex.Transaction;
}

export interface CreateUserCommentResult {
  comment: Comment;
  enqueuedTask: AgentTask | null;
}

/**
 * Post a user-authored comment.
 *
 * Atomicity: the insert + optional task-enqueue run in the same transaction so
 * a failed enqueue rolls back the comment (and vice-versa). The NEW comment's
 * id becomes the `trigger_comment_id` of the enqueued task — `args.triggerCommentId`
 * in the request body only signals intent ("this comment triggers the agent");
 * the task row points at the comment we just wrote, not at the anchor.
 */
export async function createUserComment(
  args: CreateUserCommentArgs,
): Promise<CreateUserCommentResult> {
  const adapter = getAdapter();
  if (!args.content || args.content.trim().length === 0) {
    throw new Error('content is required');
  }

  const run = async (trx: Knex.Transaction): Promise<CreateUserCommentResult> => {
    // Verify issue exists + belongs to workspace (T-17-04-03 cross-workspace guard)
    const issue = await trx('issues')
      .where({ id: args.issueId, workspace_id: args.workspaceId })
      .first('id', 'assignee_id');
    if (!issue) throw new Error('issue not found in workspace');

    // Parent validation (T-17-04-07): must exist AND be on the same issue AND be a user comment
    if (args.parentId) {
      const parent = await trx('comments')
        .where({ id: args.parentId, issue_id: args.issueId })
        .first('id', 'author_type');
      if (!parent) throw new Error('parent comment not found in this issue');
      if ((parent.author_type as string) !== 'user') {
        throw new Error('parent comment must be a user comment');
      }
    }

    const id = randomUUID();
    const metadata: Record<string, unknown> = { ...(args.metadata ?? {}) };
    if (args.triggerCommentId) {
      metadata.triggerCommentId = args.triggerCommentId;
    }

    await trx('comments').insert({
      id,
      issue_id: args.issueId,
      author_type: 'user',
      author_user_id: args.authorUserId,
      author_agent_id: null,
      content: args.content,
      type: 'comment',
      parent_id: args.parentId ?? null,
      metadata: adapter.jsonValue(metadata),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const row = await trx('comments').where({ id }).first();
    const comment = toComment(row as Record<string, unknown>);

    let enqueuedTask: AgentTask | null = null;
    if (args.triggerCommentId && issue.assignee_id) {
      // COMMENT-01: the NEWLY CREATED comment id is the trigger on the task row
      // (not args.triggerCommentId — that was the anchor the user referenced).
      enqueuedTask = await enqueueTaskForIssue({
        workspaceId: args.workspaceId,
        issueId: args.issueId,
        agentId: issue.assignee_id as string,
        triggerCommentId: id,
        trx,
      });
    }

    return { comment, enqueuedTask };
  };

  if (args.trx) return run(args.trx);
  return db.transaction(run);
}

export interface CreateSystemCommentArgs {
  workspaceId: string;
  issueId: string;
  content: string;
  type?: Extract<CommentType, 'status_change' | 'progress_update' | 'system'>;
  metadata?: Record<string, unknown>;
  trx?: Knex.Transaction;
}

/**
 * Post a system-authored comment. COMMENT-02: called by applyIssueSideEffects
 * on every status / assignee transition. Phase 18 will also call this for
 * progress updates (`type='progress_update'`). NOT exposed to route handlers —
 * users cannot forge a system comment (T-17-04-02 mitigation).
 */
export async function createSystemComment(
  args: CreateSystemCommentArgs,
): Promise<Comment> {
  const adapter = getAdapter();
  const type: CommentType = args.type ?? 'status_change';
  validateType(type);

  const run = async (trx: Knex.Transaction): Promise<Comment> => {
    const id = randomUUID();
    await trx('comments').insert({
      id,
      issue_id: args.issueId,
      author_type: 'system',
      author_user_id: null,
      author_agent_id: null,
      content: args.content,
      type,
      parent_id: null,
      metadata: adapter.jsonValue(args.metadata ?? {}),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const row = await trx('comments').where({ id }).first();
    return toComment(row as Record<string, unknown>);
  };
  if (args.trx) return run(args.trx);
  return db.transaction(run);
}

export interface UpdateCommentPatch {
  content?: string;
}

/**
 * PATCH a comment — content-only mutation. `type`, `author_*`, and `parent_id`
 * are immutable; an edit request carrying them is silently ignored (only
 * `content` is copied into the UPDATE set).
 */
export async function updateComment(
  id: string,
  issueId: string,
  patch: UpdateCommentPatch,
): Promise<Comment | null> {
  if (patch.content !== undefined && patch.content.trim().length === 0) {
    throw new Error('content cannot be empty');
  }
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (patch.content !== undefined) update.content = patch.content;
  const affected = await db('comments')
    .where({ id, issue_id: issueId })
    .update(update);
  if (affected === 0) return null;
  const row = await db('comments').where({ id }).first();
  return row ? toComment(row as Record<string, unknown>) : null;
}

/**
 * Hard-delete a comment. Children are preserved via schema-level SET NULL on
 * the self-referencing parent_id FK (migration 006 + PITFALLS §ST4 "orphan
 * preservation").
 */
export async function deleteComment(id: string, issueId: string): Promise<boolean> {
  const affected = await db('comments')
    .where({ id, issue_id: issueId })
    .delete();
  return affected > 0;
}

export async function getComment(id: string): Promise<Comment | null> {
  const row = await db('comments').where({ id }).first();
  return row ? toComment(row as Record<string, unknown>) : null;
}

/**
 * Timeline: every comment on an issue, ordered ASC by created_at. The
 * workspaceId arg gates cross-workspace leakage (T-17-04-03) — if the issue
 * doesn't belong to the requested workspace, we return [] rather than the
 * timeline. Uses idx_comments_issue_created from migration 006.
 */
export async function listCommentsForIssue(
  workspaceId: string,
  issueId: string,
): Promise<Comment[]> {
  const issue = await db('issues')
    .where({ id: issueId, workspace_id: workspaceId })
    .first('id');
  if (!issue) return [];
  const rows = await db('comments')
    .where({ issue_id: issueId })
    .orderBy('created_at', 'asc');
  return rows.map((r: Record<string, unknown>) => toComment(r));
}

export { toComment };
