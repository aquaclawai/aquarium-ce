import { useRef } from 'react';
import { IssueColumn } from './IssueColumn';
import { useBoardReconciler } from './useBoardReconciler';
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

export function IssueBoard({ issues, setIssues }: IssueBoardProps) {
  // Plan 02 writes to activeIdRef on drag start / clears on drag end.
  // Plan 01 keeps it null — useBoardReconciler's queue path is never hit.
  const activeIdRef = useRef<string | null>(null);

  // flushPendingRemoteEvents is returned for plan 02 to call on drag end.
  // Plan 01 leaves it unused — the reconciler always flushes immediately.
  useBoardReconciler({ setIssues, activeIdRef });

  return (
    <div className="flex gap-4 overflow-x-auto pr-6">
      {STATUSES.map(status => {
        const columnItems = issues.filter(i => i.status === status);
        return (
          <IssueColumn
            key={status}
            status={status}
            items={columnItems}
            isActiveDropTarget={false}
            activeId={null}
          />
        );
      })}
    </div>
  );
}
