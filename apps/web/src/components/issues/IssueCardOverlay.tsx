import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Issue, IssuePriority } from '@aquarium/shared';

/**
 * Stateless drag overlay preview rendered inside @dnd-kit's <DragOverlay>.
 * Intentionally does NOT register a sortable hook — it is a preview layer,
 * not a sortable item. Visual treatment per 23-UI-SPEC §Color reserved
 * usage #2-3: brand-accent ring + subtle shadow glow to distinguish the
 * floating preview from the ghosted original card in its slot.
 */

interface IssueCardOverlayProps {
  issue: Issue;
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

export function IssueCardOverlay({ issue }: IssueCardOverlayProps) {
  const { t } = useTranslation();
  // Security (T-23-02-05 mitigate): issue.title + issue.description render
  // as plain React string children — auto-escaped. No raw HTML injection
  // paths in this file.
  return (
    <Card
      className="p-3 min-h-[72px] gap-2 flex flex-col ring-2 ring-[var(--color-primary)] shadow-[0_8px_24px_rgba(255,107,53,0.2)] cursor-grabbing"
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
