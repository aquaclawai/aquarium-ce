import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { IssueCard } from './IssueCard';
import type { Issue, IssueStatus } from '@aquarium/shared';

interface IssueColumnProps {
  status: IssueStatus;
  items: Issue[];
  // Plan 02 consumes these; plan 01 freezes the prop shape.
  isActiveDropTarget: boolean;
  activeId: string | null;
}

/**
 * Mirrors the server ordering in routes/issues.ts: position ASC NULLS LAST,
 * created_at DESC.
 */
function byPositionThenCreated(a: Issue, b: Issue): number {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  return b.createdAt.localeCompare(a.createdAt);
}

export function IssueColumn({ status, items }: IssueColumnProps) {
  const { t } = useTranslation();
  const sortedItems = [...items].sort(byPositionThenCreated);

  return (
    <div
      data-issue-column={status}
      className="min-w-[280px] max-w-[320px] bg-muted rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-semibold">{t(`issues.board.columns.${status}`)}</span>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {sortedItems.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          {t('issues.board.emptyColumn')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedItems.map(issue => (
            <IssueCard key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}
