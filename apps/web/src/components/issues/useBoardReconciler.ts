import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import type { Issue, WsMessage } from '@aquarium/shared';

/**
 * Board reconciler — subscribes to workspace 'AQ' and mutates local state on
 * issue:created / issue:updated / issue:deleted / issue:reordered events.
 *
 * While a drag is in progress (activeIdRef.current !== null), events are
 * queued and drained by flushPendingRemoteEvents() — plan 23-02 wires the
 * drag state machine to call this on drop. In plan 23-01 activeIdRef is
 * always null, so events apply immediately.
 *
 * Plan 23-02 additions:
 *  - `lastLocalMutationRef` — after a successful local reorder POST, the
 *    drag hook records { issueId, position }. The server broadcasts the
 *    same `issue:reordered` back to all clients INCLUDING us. We skip the
 *    applying write on exact match (one-shot skip, then the ref clears).
 *    This prevents a redundant state write + re-render cycle for OUR OWN
 *    echo while leaving remote sessions' echoes intact.
 *
 * A1 finding (see .planning/phases/23-issue-board-ui-kanban/23-00-A1-VERIFIED.md):
 * the existing subscribe(instanceId) method on WebSocketContext accepts the
 * workspace id 'AQ' as a subscription key — apps/server/src/ws/index.ts:115-121
 * filters broadcasts against the same instanceSubscriptions set the server
 * populates via 'subscribe' messages. No new subscribeWorkspace method
 * needed.
 */

interface UseBoardReconcilerArgs {
  setIssues: (updater: (prev: Issue[]) => Issue[]) => void;
  activeIdRef: RefObject<string | null>;
  lastLocalMutationRef?: RefObject<{ issueId: string; position: number } | null>;
}

interface UseBoardReconcilerReturn {
  flushPendingRemoteEvents: () => void;
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

export function useBoardReconciler({
  setIssues,
  activeIdRef,
  lastLocalMutationRef,
}: UseBoardReconcilerArgs): UseBoardReconcilerReturn {
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();
  const pendingEventsRef = useRef<WsMessage[]>([]);

  const applyRemoteEvent = useCallback((message: WsMessage) => {
    const { type, payload, issueId } = message;
    if (type === 'issue:created') {
      if (!isFullIssue(payload)) return;
      const incoming = payload;
      setIssues(prev => {
        const withoutDup = prev.filter(i => i.id !== incoming.id);
        return [...withoutDup, incoming];
      });
      return;
    }
    if (type === 'issue:updated') {
      if (!isFullIssue(payload)) return;
      const incoming = payload;
      setIssues(prev => prev.map(i => (i.id === incoming.id ? incoming : i)));
      return;
    }
    if (type === 'issue:deleted') {
      if (!issueId) return;
      setIssues(prev => prev.filter(i => i.id !== issueId));
      return;
    }
    if (type === 'issue:reordered') {
      if (!issueId) return;
      const rawPos = (payload as { position?: unknown } | undefined)?.position;
      if (typeof rawPos !== 'number' && rawPos !== null) return;
      const incomingPos = rawPos as number | null;

      // Plan 23-02 own-echo skip: if the last local mutation matches this
      // incoming event (same issue id + same position), consume the marker
      // and skip the state write. This is a one-shot skip — any subsequent
      // reorder events from other sessions apply normally.
      const last = lastLocalMutationRef?.current ?? null;
      if (
        last
        && last.issueId === issueId
        && typeof incomingPos === 'number'
        && Math.abs(last.position - incomingPos) < 1e-9
      ) {
        if (lastLocalMutationRef) {
          lastLocalMutationRef.current = null;
        }
        return;
      }

      setIssues(prev => prev.map(i => (i.id === issueId ? { ...i, position: incomingPos } : i)));
      return;
    }
  }, [setIssues, lastLocalMutationRef]);

  const handleEvent = useCallback((message: WsMessage) => {
    if (activeIdRef.current !== null) {
      pendingEventsRef.current.push(message);
      return;
    }
    applyRemoteEvent(message);
  }, [activeIdRef, applyRemoteEvent]);

  const flushPendingRemoteEvents = useCallback(() => {
    const queued = pendingEventsRef.current;
    pendingEventsRef.current = [];
    for (const message of queued) applyRemoteEvent(message);
  }, [applyRemoteEvent]);

  useEffect(() => {
    // A1: subscribe to workspace 'AQ' to receive issue:* broadcasts.
    subscribe('AQ');
    addHandler('issue:created', handleEvent);
    addHandler('issue:updated', handleEvent);
    addHandler('issue:deleted', handleEvent);
    addHandler('issue:reordered', handleEvent);
    return () => {
      removeHandler('issue:created', handleEvent);
      removeHandler('issue:updated', handleEvent);
      removeHandler('issue:deleted', handleEvent);
      removeHandler('issue:reordered', handleEvent);
      unsubscribe('AQ');
    };
  }, [subscribe, unsubscribe, addHandler, removeHandler, handleEvent]);

  return { flushPendingRemoteEvents };
}
