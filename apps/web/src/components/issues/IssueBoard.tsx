import { useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { IssueColumn } from './IssueColumn';
import { IssueCardOverlay } from './IssueCardOverlay';
import { useBoardReconciler } from './useBoardReconciler';
import { useIssueBoard } from './useIssueBoard';
import type { Issue, IssueStatus } from '@aquarium/shared';

interface IssueBoardProps {
  issues: Issue[];
  setIssues: (updater: (prev: Issue[]) => Issue[]) => void;
}

/**
 * Column order per 23-UI-SPEC §Copywriting Contract §Column Headers.
 * MUST stay in this exact order — plans 02/03/04 depend on left-to-right
 * rendering of these six statuses.
 */
const STATUSES: readonly IssueStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'blocked',
  'cancelled',
] as const;

/**
 * IssueBoard — top-level DndContext that wires sensors, collision detection,
 * and the four drag handlers from useIssueBoard. Also hosts the DragOverlay
 * portal so the dragged preview renders above everything else (z-index
 * ladder from 23-UI-SPEC §Z-Index Ladder: `--z-drag-overlay: 5000`).
 *
 * UX1 HARD invariant (23-UI-SPEC §WebSocket Reconciliation Contract): while
 * activeIdRef is non-null, useBoardReconciler queues incoming issue:* events
 * rather than applying them to local state. See useIssueBoard.handleDragEnd
 * for the strict ordering of clears + flush.
 */
export function IssueBoard({ issues, setIssues }: IssueBoardProps) {
  // Refs shared between the reconciler (writer: activeIdRef read;
  // lastLocalMutationRef read) and useIssueBoard (writer: both).
  const activeIdRef = useRef<string | null>(null);
  const lastLocalMutationRef = useRef<{ issueId: string; position: number } | null>(null);

  const { flushPendingRemoteEvents } = useBoardReconciler({
    setIssues,
    activeIdRef,
    lastLocalMutationRef,
  });

  const {
    activeId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useIssueBoard({
    issues,
    setIssues,
    activeIdRef,
    flushPendingRemoteEvents,
    lastLocalMutationRef,
  });

  // Sensors per 23-UI-SPEC §Interaction Contract §Sensors. 5 px activation
  // prevents accidental drags on plain clicks; KeyboardSensor with
  // sortableKeyboardCoordinates gives free keyboard DnD — plan 23-04 wires
  // the @dnd-kit/accessibility announcer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeIssue = activeId ? issues.find(i => i.id === activeId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pr-6">
        {STATUSES.map(status => {
          const columnItems = issues.filter(i => i.status === status);
          return (
            <IssueColumn
              key={status}
              status={status}
              items={columnItems}
              isActiveDropTarget={false}
              activeId={activeId}
            />
          );
        })}
      </div>
      <DragOverlay style={{ zIndex: 'var(--z-drag-overlay)' as unknown as number }}>
        {activeIssue ? <IssueCardOverlay issue={activeIssue} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
