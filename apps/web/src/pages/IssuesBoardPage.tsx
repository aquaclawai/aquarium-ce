import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { IssueBoard } from '../components/issues/IssueBoard';
import { CreateIssueDialog } from '../components/issues/CreateIssueDialog';
import type { Issue } from '@aquarium/shared';

export function IssuesBoardPage() {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    api.get<Issue[]>('/issues')
      .then(setIssues)
      .catch(() => toast.error(t('issues.board.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  // Server-generated issue is prepended so the user immediately sees the
  // row they just created in the Backlog column (or wherever their chosen
  // initial status routes it). De-duplicate by id because the WebSocket
  // stream (IssueBoard's subscription) may also echo the same row — we
  // don't want a double render.
  const handleCreated = useCallback((issue: Issue) => {
    setIssues((prev) => (prev.some((i) => i.id === issue.id) ? prev : [issue, ...prev]));
    toast.success(t('issues.board.createSucceeded', { title: issue.title }));
  }, [t]);

  return (
    <div className="p-6" data-testid="issues-board">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-serif">{t('issues.board.title')}</h1>
        <Button
          onClick={() => setCreateOpen(true)}
          data-issue-create-open
        >
          {t('issues.board.actions.create')}
        </Button>
      </div>
      {loading
        ? <div className="text-muted-foreground text-sm">{/* skeleton deferred */}</div>
        : <IssueBoard issues={issues} setIssues={setIssues} />}
      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
