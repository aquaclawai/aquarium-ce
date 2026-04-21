import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Badge } from '@/components/ui/badge';
import { IssueCard } from './IssueCard';
import type { Issue, IssueStatus } from '@aquarium/shared';

/**
 * Virtualization threshold per 23-UI-SPEC §Virtualization Contract.
 * Below this, a plain .map() renders — zero virtualizer overhead.
 * Above this, useVirtualizer windows the DOM.
 */
const VIRTUALIZATION_THRESHOLD = 100;

interface IssueColumnProps {
  status: IssueStatus;
  items: Issue[];
  // Plan 02 consumes these; plan 03 uses `activeId` to bump the virtualizer
  // overscan during an active drag so the dragged card never unmounts.
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

export function IssueColumn({ status, items, activeId }: IssueColumnProps) {
  const { t } = useTranslation();
  const sortedItems = [...items].sort(byPositionThenCreated);

  // useDroppable so the column itself is a valid drop target when it is
  // empty or when the user drops at its "tail" (below the last card).
  // The `data.status` here is consumed by useIssueBoard.resolveTargetStatus.
  const { setNodeRef } = useDroppable({
    id: status,
    data: { status },
  });

  // Virtualizer ref + hook. useVirtualizer MUST be called unconditionally
  // (Rules of Hooks) even when below threshold; when `shouldVirtualize` is
  // false, its output is simply unused — no DOM rendered from it.
  //
  // Plan 23-03 §Pitfall 7 mitigation (virtualizer integration pitfall):
  // during an active drag (activeId !== null), overscan bumps to items.length
  // so the dragged card never unmounts, even if the user scrolls the column
  // while holding it. On drag-end, overscan restores to 10 (the `activeId ?
  // ... : 10` ternary).
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72, // matches 23-UI-SPEC min-h-[72px] card height
    overscan: activeId !== null ? sortedItems.length : 10,
  });

  const shouldVirtualize = sortedItems.length > VIRTUALIZATION_THRESHOLD;

  return (
    <div
      ref={setNodeRef}
      className="min-w-[280px] max-w-[320px] bg-muted rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-semibold">{t(`issues.board.columns.${status}`)}</span>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {/*
        Critical rule (23-UI-SPEC §Virtualization Contract): SortableContext
        MUST receive the FULL id array — never just the visible window. If we
        passed only the visible subset, @dnd-kit's drop math would fail for
        off-screen drop targets (cross-column drops into virtualized slots).
      */}
      <SortableContext
        items={sortedItems.map(i => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {shouldVirtualize ? (
          <div
            ref={scrollRef}
            data-scroll-container
            data-issue-column={status}
            className="overflow-auto"
            // min-height: 0 is required to prevent the flex-item default
            // (min-height: auto = content-size) from stretching this div to
            // fit the 14400px spacer inside, which would defeat virtualization.
            // height is bounded to 70vh so the virtualizer can window the list.
            style={{ height: '70vh', minHeight: 0 }}
          >
            <div
              style={{
                position: 'relative',
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const issue = sortedItems[vRow.index];
                return (
                  <div
                    key={issue.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    <IssueCard issue={issue} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div data-issue-column={status} className="flex flex-col gap-2 min-h-[40px]">
            {sortedItems.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">
                {t('issues.board.emptyColumn')}
              </div>
            ) : (
              sortedItems.map(issue => (
                <IssueCard key={issue.id} issue={issue} />
              ))
            )}
          </div>
        )}
      </SortableContext>
    </div>
  );
}
