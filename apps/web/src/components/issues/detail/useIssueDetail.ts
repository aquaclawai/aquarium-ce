import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import { api } from '../../../api';
import type { Comment, Issue, WsMessage } from '@aquarium/shared';

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
  loading: boolean;
  error: string | null;
  refetch: () => void;
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
    ])
      .then(([fetchedIssue, fetchedComments]) => {
        if (cancelled) return;
        setIssue(fetchedIssue);
        setComments(fetchedComments);
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

    subscribe('AQ');
    addHandler('issue:updated', onIssueUpdated);
    addHandler('issue:deleted', onIssueDeleted);
    addHandler('comment:posted', onCommentPosted);
    addHandler('comment:updated', onCommentUpdated);
    addHandler('comment:deleted', onCommentDeleted);

    return () => {
      removeHandler('issue:updated', onIssueUpdated);
      removeHandler('issue:deleted', onIssueDeleted);
      removeHandler('comment:posted', onCommentPosted);
      removeHandler('comment:updated', onCommentUpdated);
      removeHandler('comment:deleted', onCommentDeleted);
      unsubscribe('AQ');
    };
  }, [issueId, subscribe, unsubscribe, addHandler, removeHandler]);

  return { issue, comments, loading, error, refetch };
}
