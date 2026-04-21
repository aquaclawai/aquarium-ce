import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import type { Announcements } from '@dnd-kit/core';
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

/** Mirror of IssueColumn's ordering: position ASC NULLS LAST, created_at DESC. */
function byPositionThenCreated(a: Issue, b: Issue): number {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  return b.createdAt.localeCompare(a.createdAt);
}

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
 *
 * UX2 mitigation (plan 23-04): DndContext receives an `accessibility` prop
 * whose `announcements` callbacks pull their strings through
 * `useTranslation()` + `issues.board.a11y.*` keys. The @dnd-kit/core package
 * internally auto-mounts an aria-live region via @dnd-kit/accessibility
 * (LiveRegion.tsx uses plain `textContent`, NOT innerHTML — verified for
 * T-23-04-01 in 23-04-PLAN threat model). `screenReaderInstructions.draggable`
 * is read once when focus enters a draggable card.
 */
export function IssueBoard({ issues, setIssues }: IssueBoardProps) {
  const { t } = useTranslation();

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

  // -----------------------------------------------------------------
  // A11y announcement helpers (plan 23-04 Task 1)
  // -----------------------------------------------------------------
  // Resolve a drag id (may be an issue id) to its title. The @dnd-kit Active
  // / Over `.id` field is typed as UniqueIdentifier = string | number — our
  // issues all use string ids but we normalize defensively.
  const getIssueTitle = useCallback(
    (id: string | number | null | undefined): string => {
      if (id === null || id === undefined) return '';
      const key = typeof id === 'string' ? id : String(id);
      return issues.find(i => i.id === key)?.title ?? key;
    },
    [issues],
  );

  // Given an `over.id` (which may be either a column sentinel — one of the
  // STATUSES strings set on useDroppable in IssueColumn — or an issue id),
  // return the localized column label. Falls back to empty string if neither.
  const getColumnLabel = useCallback(
    (id: string | number | null | undefined): string => {
      if (id === null || id === undefined) return '';
      const key = typeof id === 'string' ? id : String(id);
      const asStatus = (STATUSES as readonly string[]).includes(key)
        ? (key as IssueStatus)
        : null;
      if (asStatus) return t(`issues.board.columns.${asStatus}`);
      const issue = issues.find(i => i.id === key);
      return issue ? t(`issues.board.columns.${issue.status}`) : '';
    },
    [issues, t],
  );

  // Compute { pos, total, column } for an `over.id`, used by movedWithin /
  // movedAcross announcements. When `overId` IS a column sentinel (drop at
  // the tail of a column), the target slot is the column count + 1.
  const getColumnPosition = useCallback(
    (
      overId: string | number | null | undefined,
    ): { pos: number; total: number; column: string } => {
      if (overId === null || overId === undefined) {
        return { pos: 0, total: 0, column: '' };
      }
      const key = typeof overId === 'string' ? overId : String(overId);
      const asStatus = (STATUSES as readonly string[]).includes(key)
        ? (key as IssueStatus)
        : null;
      if (asStatus) {
        const cnt = issues.filter(i => i.status === asStatus).length;
        return {
          pos: cnt + 1,
          total: cnt + 1,
          column: t(`issues.board.columns.${asStatus}`),
        };
      }
      const issue = issues.find(i => i.id === key);
      if (!issue) return { pos: 0, total: 0, column: '' };
      const columnItems = issues
        .filter(i => i.status === issue.status)
        .sort(byPositionThenCreated);
      const pos = columnItems.findIndex(i => i.id === key) + 1;
      return {
        pos,
        total: columnItems.length,
        column: t(`issues.board.columns.${issue.status}`),
      };
    },
    [issues, t],
  );

  // Build the Announcements object once per dependency change. Memoized so we
  // don't churn the DndContext's internal Accessibility subscription every
  // render.
  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        return t('issues.board.a11y.picked', {
          title: getIssueTitle(active.id),
        });
      },
      onDragOver({ active, over }) {
        if (!over) return undefined;
        const activeIssue = issues.find(i => i.id === active.id);
        const overKey = typeof over.id === 'string' ? over.id : String(over.id);
        const overIsColumnSentinel = (STATUSES as readonly string[]).includes(overKey);
        const overColumnStatus = overIsColumnSentinel
          ? (overKey as IssueStatus)
          : issues.find(i => i.id === overKey)?.status;
        if (!overColumnStatus) return undefined;
        const { pos, total, column } = getColumnPosition(over.id);
        if (activeIssue && activeIssue.status === overColumnStatus) {
          return t('issues.board.a11y.movedWithin', {
            title: activeIssue.title,
            pos,
            total,
            column,
          });
        }
        return t('issues.board.a11y.movedAcross', {
          title: activeIssue?.title ?? '',
          pos,
          total,
          column,
        });
      },
      onDragEnd({ active, over }) {
        return t('issues.board.a11y.dropped', {
          title: getIssueTitle(active.id),
          column: getColumnLabel(over?.id),
        });
      },
      onDragCancel({ active }) {
        return t('issues.board.a11y.cancelled', {
          title: getIssueTitle(active.id),
        });
      },
    }),
    [t, issues, getIssueTitle, getColumnLabel, getColumnPosition],
  );

  const screenReaderInstructions = useMemo(
    () => ({ draggable: t('issues.board.tooltip.keyboardHint') }),
    [t],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions,
      }}
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
