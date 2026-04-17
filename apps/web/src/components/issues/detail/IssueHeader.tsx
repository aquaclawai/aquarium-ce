import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function statusVariant(status: IssueStatus): BadgeVariant {
  switch (status) {
    case 'done': return 'secondary';
    case 'cancelled': return 'outline';
    case 'blocked': return 'destructive';
    case 'in_progress': return 'default';
    default: return 'outline';
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const deltaSec = Math.floor((Date.now() - then) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
}

interface IssueHeaderProps {
  issue: Issue;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onChangeStatus: (s: IssueStatus) => void;
}

export function IssueHeader({ issue, onEdit, onDelete, onAssign, onChangeStatus }: IssueHeaderProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDeleteConfirm = () => {
    setConfirmOpen(false);
    onDelete();
  };

  return (
    <Card className="p-6" data-issue-header={issue.id}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <h1 className="text-[28px] font-medium leading-[1.1]">
            <span className="text-muted-foreground mr-2">
              {t('issues.detail.issueNumber', { number: issue.issueNumber })}
            </span>
            {issue.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(issue.status)}>
              {t(`issues.board.columns.${issue.status}`)}
            </Badge>
            {issue.priority !== 'none' && (
              <Badge variant={priorityVariant(issue.priority)}>
                {t(`issues.board.priority.${issue.priority}`)}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {t('issues.detail.postedMeta', {
                relativeTime: formatRelative(issue.createdAt),
                author: issue.creatorUserId ?? t('issues.detail.comments.author.system'),
              })}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('issues.detail.actions.edit')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              {t('issues.detail.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAssign}>
              {t('issues.detail.actions.assignAgent')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChangeStatus('done')}>
              {t('issues.detail.actions.changeStatus')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setConfirmOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              {t('issues.detail.actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('issues.detail.confirmDelete.title')}</DialogTitle>
            <DialogDescription>{t('issues.detail.confirmDelete.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('issues.detail.comments.cancelReply')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              {t('issues.detail.confirmDelete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
