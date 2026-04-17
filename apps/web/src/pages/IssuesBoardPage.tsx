import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../api';
import { IssueBoard } from '../components/issues/IssueBoard';
import type { Issue } from '@aquarium/shared';

export function IssuesBoardPage() {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Issue[]>('/issues')
      .then(setIssues)
      .catch(() => toast.error(t('issues.board.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div className="p-6" data-testid="issues-board">
      <h1 className="text-2xl font-serif mb-4">{t('issues.board.title')}</h1>
      {loading
        ? <div className="text-muted-foreground text-sm">{/* skeleton deferred */}</div>
        : <IssueBoard issues={issues} setIssues={setIssues} />}
    </div>
  );
}
