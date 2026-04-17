import * as React from 'react';
import { useTranslation } from 'react-i18next';
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
  // Security (T-23-01-01 mitigate): React auto-escapes string children —
  // issue.title and issue.description are rendered as plain text. No raw
  // HTML injection paths in this file. UX6 markdown rendering is Phase 24.
  return (
    <Card
      data-issue-card={issue.id}
      className="p-3 min-h-[72px] gap-2 flex flex-col cursor-grab"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug line-clamp-2">{issue.title}</h3>
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
