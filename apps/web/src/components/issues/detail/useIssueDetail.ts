import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import { api } from '../../../api';
import type { AgentTask, Comment, Issue, WsMessage } from '@aquarium/shared';

/**
 * useIssueDetail(issueId) — single source of truth for the detail page.
 *
 *  1. On mount: subscribe('AQ') on the workspace channel (Phase 23 A1 pattern)
 *     and fetch issue + comments in parallel. Both skeleton until the pair
 *     resolves.
 *  2. Registers WS handlers for issue:updated / issue:deleted /
 *     comment:posted / comment:updated / comment:deleted and reconciles
 *     local state on each event (type-guarded payloads — T-24-01-02).
 *  3. Cleanup: unsubscribe + removeHandler for each event on unmount.
 *  4. Exposes { issue, comments, loading, error, refetch }. `error ===
 *     'ISSUE_DELETED'` signals the consumer to navigate away.
 */

interface UseIssueDetailReturn {
  issue: Issue | null;
  comments: Comment[];
  /**
   * Phase 24-02: most-recent task attached to this issue. Hydrated on mount
   * via GET /api/issues/:id/tasks and updated through `task:*` WS events.
   * Null when the issue has no tasks yet.
   */
  latestTask: AgentTask | null;
  /**
   * Phase 24-02: optimistic setter used by Wave 5's ChatComposer to swap in a
   * fresh task before the server's dispatch WS lands. Called with the task
   * returned by POST /api/issues/:id/comments — stops the UI flicker.
   */
  overrideLatestTask: (task: AgentTask) => void;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function isAgentTask(payload: unknown): payload is AgentTask {
  return (
    typeof payload === 'object'
    && payload !== null
    && typeof (payload as { id?: unknown }).id === 'string'
    && typeof (payload as { issueId?: unknown }).issueId === 'string'
    && typeof (payload as { status?: unknown }).status === 'string'
  );
}

function isFullIssue(payload: unknown): payload is Issue {
  return (
    typeof payload === 'object'
    && payload !== null
    && typeof (payload as { id?: unknown }).id === 'string'
    && typeof (payload as { status?: unknown }).status === 'string'
    && typeof (payload as { updatedAt?: unknown }).updatedAt === 'string'
  );
}

function isFullComment(payload: unknown): payload is Comment {
  return (
    typeof payload === 'object'
    && payload !== null
    && typeof (payload as { id?: unknown }).id === 'string'
    && typeof (payload as { issueId?: unknown }).issueId === 'string'
    && typeof (payload as { authorType?: unknown }).authorType === 'string'
    && typeof (payload as { content?: unknown }).content === 'string'
  );
}

export function useIssueDetail(issueId: string): UseIssueDetailReturn {
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  // Phase 24-02: seeded from GET /issues/:id/tasks on mount. Updated through
  // task:* WS events (TaskPanel subscribes for the live stream, the hook just
  // tracks which task is current).
  const [latestTask, setLatestTask] = useState<AgentTask | null>(null);
  const overrideLatestTask = useCallback((task: AgentTask) => {
    setLatestTask(task);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable ref so WS handlers always see the current issueId without
  // re-registering on every render.
  const issueIdRef = useRef(issueId);
  useEffect(() => {
    issueIdRef.current = issueId;
  }, [issueId]);

  // Nonce bumps on each refetch() call, re-running the fetch effect below.
  // Initial state (loading=true, issue=null, comments=[], error=null) matches
  // the pre-fetch UI shape so the effect doesn't need to reset state
  // synchronously before kicking off the request.
  const [refetchNonce, setRefetchNonce] = useState(0);
  const refetch = useCallback(() => {
    setRefetchNonce(n => n + 1);
  }, []);

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    Promise.all([
      api.get<Issue>(`/issues/${issueId}`),
      api.get<Comment[]>(`/issues/${issueId}/comments`),
      // Phase 24-02: /issues/:id/tasks returns { tasks: AgentTask[] } ordered
      // DESC by created_at. Shape differs from the other two fetches —
      // hence the wrapper type. We soft-fail this one (catch inside) so an
      // issue still renders if the tasks route is flaky; the TaskPanel
      // shows its idle state until the next WS event updates it.
      api
        .get<{ tasks: AgentTask[] }>(`/issues/${issueId}/tasks`)
        .then((res) => res.tasks)
        .catch(() => [] as AgentTask[]),
    ])
      .then(([fetchedIssue, fetchedComments, fetchedTasks]) => {
        if (cancelled) return;
        setIssue(fetchedIssue);
        setComments(fetchedComments);
        setLatestTask(fetchedTasks.length > 0 ? fetchedTasks[0] : null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setIssue(null);
        setError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [issueId, refetchNonce]);

  // WS reconciliation
  useEffect(() => {
    if (!issueId) return;

    const onIssueUpdated = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      if (!isFullIssue(message.payload)) return;
      setIssue(message.payload);
    };

    const onIssueDeleted = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      setIssue(null);
      setError('ISSUE_DELETED');
    };

    const onCommentPosted = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      if (!isFullComment(message.payload)) return;
      const incoming = message.payload;
      setComments(prev => {
        if (prev.some(c => c.id === incoming.id)) return prev;
        return [...prev, incoming];
      });
    };

    const onCommentUpdated = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      if (!isFullComment(message.payload)) return;
      const incoming = message.payload;
      setComments(prev => prev.map(c => (c.id === incoming.id ? incoming : c)));
    };

    const onCommentDeleted = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      const raw = message.payload as { id?: unknown } | undefined;
      const deletedId = typeof raw?.id === 'string' ? raw.id : null;
      if (!deletedId) return;
      setComments(prev => prev.filter(c => c.id !== deletedId));
    };

    // Phase 24-02: task lifecycle reconciliation. dispatched / started /
    // completed / failed / cancelled all carry an AgentTask payload; we
    // refresh latestTask when the event's issueId matches ours. task:message
    // is handled per-panel by useTaskStream — not here.
    const onTaskLifecycle = (message: WsMessage) => {
      if (message.issueId !== issueIdRef.current) return;
      if (!isAgentTask(message.payload)) return;
      setLatestTask(message.payload);
    };

    subscribe('AQ');
    addHandler('issue:updated', onIssueUpdated);
    addHandler('issue:deleted', onIssueDeleted);
    addHandler('comment:posted', onCommentPosted);
    addHandler('comment:updated', onCommentUpdated);
    addHandler('comment:deleted', onCommentDeleted);
    addHandler('task:dispatched', onTaskLifecycle);
    addHandler('task:started', onTaskLifecycle);
    addHandler('task:completed', onTaskLifecycle);
    addHandler('task:failed', onTaskLifecycle);
    addHandler('task:cancelled', onTaskLifecycle);

    return () => {
      removeHandler('issue:updated', onIssueUpdated);
      removeHandler('issue:deleted', onIssueDeleted);
      removeHandler('comment:posted', onCommentPosted);
      removeHandler('comment:updated', onCommentUpdated);
      removeHandler('comment:deleted', onCommentDeleted);
      removeHandler('task:dispatched', onTaskLifecycle);
      removeHandler('task:started', onTaskLifecycle);
      removeHandler('task:completed', onTaskLifecycle);
      removeHandler('task:failed', onTaskLifecycle);
      removeHandler('task:cancelled', onTaskLifecycle);
      unsubscribe('AQ');
    };
  }, [issueId, subscribe, unsubscribe, addHandler, removeHandler]);

  return { issue, comments, latestTask, overrideLatestTask, loading, error, refetch };
}
