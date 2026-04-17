// Placeholder — overwritten in Task 2 with real column grid + WS reconciliation wiring.
// Task 1 creates this so App.tsx/IssuesBoardPage compile while the real board lands.
import type { Issue } from '@aquarium/shared';

interface IssueBoardProps {
  issues: Issue[];
  setIssues: (updater: (prev: Issue[]) => Issue[]) => void;
}

export function IssueBoard(_props: IssueBoardProps): null {
  return null;
}
