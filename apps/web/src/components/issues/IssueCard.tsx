import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Issue, IssuePriority } from '@aquarium/shared';

interface IssueCardProps {
  issue: Issue;
  isDraggingOverlay?: boolean;
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function priorityVariant(priority: IssuePriority): BadgeVariant {
  switch (priority) {
    case 'urgent': return 'destructive';
    case 'high': return 'default';
    case 'medium': return 'secondary';
    case 'low': return 'outline';
    default: return 'outline';
  }
}

function IssueCardImpl({ issue }: IssueCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Plan 23-02: useSortable wires drag listeners + transform onto the card
  // root. `data.status` is consumed by useIssueBoard.resolveTargetStatus to
  // resolve cross-column drops when `over` is a card (vs a column sentinel).
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { status: issue.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,  // ghosted original slot while overlay floats
  };

  // Security (T-23-01-01 / T-23-02-05 mitigate): React auto-escapes string
  // children — issue.title + issue.description render as plain text. No raw
  // HTML injection paths in this file. UX6 markdown rendering is Phase 24.
  //
  // Memo comparator (below) keys on id + updatedAt + position + status +
  // isDraggingOverlay. It does NOT key on `isDragging` — but that's OK: the
  // useSortable hook mutates the React tree internally when isDragging flips,
  // forcing a re-render regardless of the memo comparator.
  return (
    <Card
      ref={setNodeRef}
      data-issue-card={issue.id}
      data-updated-at={issue.updatedAt}
      {...attributes}
      {...listeners}
      style={style}
      className="p-3 min-h-[72px] gap-2 flex flex-col cursor-grab"
    >
      <div className="flex items-start justify-between gap-2">
        {/*
         * Phase 24-01 navigation: title is a button, not a plain <h3>, so
         * clicking it routes to /issues/:id. We rely on @dnd-kit's
         * PointerSensor activation constraint (pointerDistance: 5) to
         * discriminate click vs drag: a stationary press + release fires
         * onClick here; a >5 px pointermove starts a drag through the Card
         * root's drag listeners. We deliberately do NOT stopPropagation on
         * pointerdown — that would break the drag when the user grabs the
         * title area (Phase 23 "own echo" regression).
         */}
        <button
          type="button"
          className="text-sm font-medium leading-snug line-clamp-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/issues/${issue.id}`);
          }}
        >
          {issue.title}
        </button>
        {issue.priority !== 'none' && (
          <Badge variant={priorityVariant(issue.priority)}>
            {t(`issues.board.priority.${issue.priority}`)}
          </Badge>
        )}
      </div>
      {issue.description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1">{issue.description}</p>
      )}
    </Card>
  );
}

export const IssueCard = React.memo(
  IssueCardImpl,
  (a, b) => (
    a.issue.id === b.issue.id
    && a.issue.updatedAt === b.issue.updatedAt
    && a.issue.position === b.issue.position
    && a.issue.status === b.issue.status
    && a.isDraggingOverlay === b.isDraggingOverlay
  ),
);
