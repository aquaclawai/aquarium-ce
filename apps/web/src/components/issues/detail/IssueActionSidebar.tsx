import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Issue, IssuePriority, IssueStatus } from '@aquarium/shared';

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

export interface UpdateIssuePatch {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

interface IssueActionSidebarProps {
  issue: Issue;
  onPatch: (patch: UpdateIssuePatch) => Promise<void>;
}

/**
 * Right-column sticky sidebar on viewports >= 1024px. On narrower viewports
 * this collapses into the header's dropdown menu (IssueHeader). The
 * matchMedia query + effect-driven state keeps the collapse reactive when
 * the window is resized live.
 *
 * Phase 24-01 ships this as a read-only summary card; inline edit flows
 * (click Status → dropdown, click Assignee → popover) are staged for
 * Waves 3-5 alongside the agent chat surface.
 */
export function IssueActionSidebar({ issue }: IssueActionSidebarProps) {
  const { t } = useTranslation();
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!isDesktop) {
    // Sidebar collapses into the header Actions dropdown on tablet/mobile.
    return null;
  }

  return (
    <Card className="p-4 sticky top-6 space-y-4" data-testid="issue-action-sidebar">
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {t('issues.detail.assignee')}
        </div>
        <div className="text-sm">
          {issue.assigneeId ?? t('issues.detail.unassigned')}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {t('issues.detail.priority')}
        </div>
        <div>
          {issue.priority === 'none' ? (
            <span className="text-sm text-muted-foreground">
              {t('issues.board.priority.none')}
            </span>
          ) : (
            <Badge variant={priorityVariant(issue.priority)}>
              {t(`issues.board.priority.${issue.priority}`)}
            </Badge>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {t('issues.detail.status')}
        </div>
        <div>
          <Badge variant="outline">
            {t(`issues.board.columns.${issue.status}`)}
          </Badge>
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {t('issues.detail.dueDate')}
        </div>
        <div className="text-sm">
          {issue.dueDate ?? t('issues.detail.unassigned')}
        </div>
      </div>
    </Card>
  );
}
