import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragCancelEvent,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Issue, IssueStatus } from '@aquarium/shared';

/**
 * useIssueBoard — owns the drag-and-drop state machine for the issue board.
 *
 * UX1 HARD invariant (23-UI-SPEC §WebSocket Reconciliation Contract #1):
 * activeIdRef MUST remain set from onDragStart through the completion of
 * BOTH awaits (PATCH + POST) in onDragEnd. While set, useBoardReconciler
 * queues incoming issue:* events into pendingEventsRef — it does NOT apply
 * them to the rendered board. Only after both network calls resolve (success
 * or failure) do we clear activeIdRef and call flushPendingRemoteEvents().
 *
 * Compensating rollback for partial failure (23-02-PLAN Blocker 2):
 * POST /api/issues/:id/reorder accepts ONLY { beforeId, afterId } — NOT a
 * `status` field. Therefore a cross-column drag MUST issue two calls
 * (PATCH status + POST reorder). If PATCH commits but POST throws, the catch
 * block sends a best-effort compensating PATCH reverting to sourceStatus.
 * If that also fails, the user sees the reorderFailed toast and must reload.
 *
 * Position math (23-RESEARCH §Don't Hand-Roll):
 * The server owns RENUMBER_STEP=1000 and COLLAPSE_EPSILON=1e-6. Client sends
 * only { beforeId, afterId } — NEVER numerical positions.
 */

interface UseIssueBoardArgs {
  issues: Issue[];
  setIssues: (updater: (prev: Issue[]) => Issue[]) => void;
  activeIdRef: RefObject<string | null>;
  flushPendingRemoteEvents: () => void;
  lastLocalMutationRef: RefObject<{ issueId: string; position: number } | null>;
}

interface UseIssueBoardReturn {
  activeId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: (event: DragCancelEvent) => void;
}

/** Mirror of IssueColumn's byPositionThenCreated sort — position ASC NULLS LAST, created_at DESC. */
function byPositionThenCreated(a: Issue, b: Issue): number {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Compute { beforeId, afterId } for the drop neighbours in the target column.
 * Algorithm verbatim from 23-RESEARCH §Code Example 2 with the refinements
 * specified in 23-02-PLAN step 3.
 */
export function computeNeighbours(
  draggedId: string,
  targetStatus: IssueStatus,
  issues: Issue[],
  overId: string | null,
): { beforeId: string | null; afterId: string | null } {
  const columnIssues = issues
    .filter(i => i.status === targetStatus && i.id !== draggedId)
    .sort(byPositionThenCreated);

  if (!overId || overId === targetStatus || columnIssues.length === 0 || overId === draggedId) {
    const last = columnIssues[columnIssues.length - 1] ?? null;
    return { beforeId: last?.id ?? null, afterId: null };
  }

  const overIndex = columnIssues.findIndex(i => i.id === overId);
  if (overIndex === -1) {
    const last = columnIssues[columnIssues.length - 1] ?? null;
    return { beforeId: last?.id ?? null, afterId: null };
  }

  const before = columnIssues[overIndex - 1] ?? null;
  const after = columnIssues[overIndex] ?? null;
  return { beforeId: before?.id ?? null, afterId: after?.id ?? null };
}

/**
 * Apply the optimistic local reorder: move draggedId into targetStatus with
 * a temporary midpoint position. The server response overwrites this with
 * the authoritative position in handleDragEnd step 10 — the exact temporary
 * value does not matter provided the visual order is correct until the
 * server responds. Using Number.MAX_SAFE_INTEGER / 2 biases the card to the
 * end when neighbours are unknown; when we DO know afterId, we pick a value
 * just below afterId's position to keep the card in the visually correct
 * slot during the round-trip.
 */
function moveIssueOptimistic(
  issues: Issue[],
  draggedId: string,
  targetStatus: IssueStatus,
  beforeId: string | null,
  afterId: string | null,
): Issue[] {
  const dragged = issues.find(i => i.id === draggedId);
  if (!dragged) return issues;

  const beforePos = beforeId ? issues.find(i => i.id === beforeId)?.position ?? null : null;
  const afterPos = afterId ? issues.find(i => i.id === afterId)?.position ?? null : null;

  let tempPosition: number;
  if (beforePos !== null && afterPos !== null) {
    tempPosition = (beforePos + afterPos) / 2;
  } else if (beforePos !== null) {
    tempPosition = beforePos + 1;
  } else if (afterPos !== null) {
    tempPosition = afterPos - 1;
  } else {
    tempPosition = Number.MAX_SAFE_INTEGER / 2;
  }

  return issues.map(i => {
    if (i.id !== draggedId) return i;
    return { ...i, status: targetStatus, position: tempPosition };
  });
}

/**
 * Resolve the target column for a drop event. `over.id` may be a card id or
 * the column sentinel (column status string). We first consult
 * `over.data.current?.status` (set by useDroppable on columns and by
 * useSortable on cards in IssueCard.tsx). If absent, we look up the card by
 * id and read its status. If neither yields a status, fall back to the
 * active's own data.
 */
function resolveTargetStatus(
  event: DragEndEvent,
  issues: Issue[],
  activeStatus: IssueStatus,
): IssueStatus {
  const { over, active } = event;
  if (!over) return activeStatus;

  const overStatus = (over.data.current as { status?: IssueStatus } | undefined)?.status;
  if (overStatus) return overStatus;

  const overId = typeof over.id === 'string' ? over.id : String(over.id);
  const overIssue = issues.find(i => i.id === overId);
  if (overIssue) return overIssue.status;

  const activeData = (active.data.current as { status?: IssueStatus } | undefined)?.status;
  return activeData ?? activeStatus;
}

export function useIssueBoard({
  issues,
  setIssues,
  activeIdRef,
  flushPendingRemoteEvents,
  lastLocalMutationRef,
}: UseIssueBoardArgs): UseIssueBoardReturn {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevSnapshotRef = useRef<Issue[] | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const id = typeof event.active.id === 'string' ? event.active.id : String(event.active.id);
    activeIdRef.current = id;
    setActiveId(id);
    prevSnapshotRef.current = issues;
  };

  const handleDragOver = (_event: DragOverEvent): void => {
    // No-op for now. Plan 23-03/04 may wire this for cross-column visual
    // highlight; Plan 23-02 does not need it for the state machine.
    void _event;
  };

  const handleDragCancel = (_event: DragCancelEvent): void => {
    void _event;
    activeIdRef.current = null;
    setActiveId(null);
    flushPendingRemoteEvents();
    prevSnapshotRef.current = null;
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const draggedId = typeof active.id === 'string' ? active.id : String(active.id);

    // Step 1: no drop target → abort, flush, clear state.
    if (!over) {
      activeIdRef.current = null;
      setActiveId(null);
      flushPendingRemoteEvents();
      prevSnapshotRef.current = null;
      return;
    }

    // Step 5 (read from snapshot, not current state): capture sourceStatus
    // BEFORE any state mutation. Used both for status-change detection and
    // for compensating rollback in the error path.
    const snapshot = prevSnapshotRef.current ?? issues;
    const sourceIssue = snapshot.find(i => i.id === draggedId);
    if (!sourceIssue) {
      activeIdRef.current = null;
      setActiveId(null);
      flushPendingRemoteEvents();
      prevSnapshotRef.current = null;
      return;
    }
    const sourceStatus = sourceIssue.status;

    // Step 2: resolve target column.
    const targetStatus = resolveTargetStatus(event, snapshot, sourceStatus);
    const statusChanged = targetStatus !== sourceStatus;

    // Step 3: compute { beforeId, afterId }.
    const overId = typeof over.id === 'string' ? over.id : String(over.id);
    const { beforeId, afterId } = computeNeighbours(
      draggedId,
      targetStatus,
      snapshot,
      overId,
    );

    // Step 4: optimistic local reorder — the server response overwrites this
    // below.
    setIssues(prev => moveIssueOptimistic(prev, draggedId, targetStatus, beforeId, afterId));

    // Track PATCH success for compensating-rollback decision.
    let patchCommitted = false;

    try {
      // Step 6: cross-column PATCH first (so the POST sees the correct status).
      if (statusChanged) {
        await api.patch<Issue>(`/issues/${draggedId}`, { status: targetStatus });
        patchCommitted = true;
      }

      // Step 7: fractional reorder POST.
      const authoritative = await api.post<Issue>(
        `/issues/${draggedId}/reorder`,
        { beforeId, afterId },
      );

      // Step 8: UX1 HARD invariant — clear activeIdRef NOW, AFTER both awaits
      // have resolved. Remote WS events that arrived while activeIdRef was
      // set have been queued in pendingEventsRef; they will now apply (in
      // step 11) in receipt order.
      activeIdRef.current = null;
      setActiveId(null);

      // Step 9: record own-echo marker so the reconciler skips the server's
      // broadcast of OUR OWN reorder (idempotent skip — prevents an extra
      // re-render cycle).
      lastLocalMutationRef.current = {
        issueId: authoritative.id,
        position: authoritative.position ?? 0,
      };

      // Step 10: apply authoritative position/status.
      setIssues(prev => prev.map(i => (i.id === authoritative.id ? authoritative : i)));

      // Step 11: drain the deferred remote events.
      flushPendingRemoteEvents();

      // Step 12: clear snapshot.
      prevSnapshotRef.current = null;
    } catch (err) {
      // Error path (UX1 HARD invariant preserved — activeIdRef stays set
      // through both awaits; cleared at the END of this catch block).

      // Rollback local UI to the pre-drag snapshot.
      const snap = prevSnapshotRef.current;
      if (snap) {
        setIssues(() => snap);
      }

      // Compensating PATCH rollback (Blocker 2 resolution): if PATCH
      // succeeded but POST threw, the server holds the new status while the
      // client rolled back → divergence. Best-effort revert. If this PATCH
      // also fails, the user's reorderFailed toast is their signal to
      // reload.
      if (statusChanged && patchCommitted) {
        await api.patch<Issue>(`/issues/${draggedId}`, { status: sourceStatus }).catch(() => {
          // Compensating PATCH failed — non-recoverable; toast below is the
          // user's only signal. Do not rethrow: the outer catch already
          // handles UI cleanup.
        });
      }

      // Surface the error to the user.
      toast.error(t('issues.board.reorderFailed'));

      // Log for debugging without leaking to production UI.
      if (typeof console !== 'undefined') {
        console.error('[useIssueBoard] reorder failed', err);
      }

      // Clear drag state and flush deferred events. In the error path,
      // activeIdRef is cleared at the END (still AFTER both awaits resolved —
      // failed or otherwise) to preserve the UX1 HARD invariant.
      activeIdRef.current = null;
      setActiveId(null);
      flushPendingRemoteEvents();
      prevSnapshotRef.current = null;
    }
  };

  return { activeId, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel };
}
