import { useCallback, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';
import { api } from '../api';
import { useIssueDetail } from '../components/issues/detail/useIssueDetail';
import { IssueHeader } from '../components/issues/detail/IssueHeader';
import { IssueDescription } from '../components/issues/detail/IssueDescription';
import { CommentsTimeline } from '../components/issues/detail/CommentsTimeline';
import { IssueActionSidebar } from '../components/issues/detail/IssueActionSidebar';
import type { UpdateIssuePatch } from '../components/issues/detail/IssueActionSidebar';
import { TaskPanel } from '../components/issues/detail/TaskPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import type { Issue, IssueStatus } from '@aquarium/shared';

/**
 * Route component for /issues/:id. Wires useIssueDetail → IssueHeader +
 * IssueDescription + CommentsTimeline + IssueActionSidebar. Live
 * reconciliation is provided by the hook; this page only dispatches user
 * actions (post/edit/delete comment, patch/delete issue) against the REST
 * API — WS events flowing back update state through useIssueDetail.
 *
 * Wave 1 leaves Wave 2 (task panel) and Wave 5 (chat composer) insertion
 * points as comment markers inside the main column; the detail page's
 * architecture does not require changes for those waves.
 */
export function IssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { issue, comments, latestTask, loading, error, refetch } = useIssueDetail(id ?? '');

  // Set document.title while this page is mounted; restore on unmount.
  useEffect(() => {
    if (!issue) return;
    const prev = document.title;
    document.title = t('issues.detail.titleSuffix', {
      issueNumber: issue.issueNumber,
      workspaceName: 'Aquarium',
    });
    return () => { document.title = prev; };
  }, [issue, t]);

  // issue:deleted → navigate back to /issues (hook sets error =
  // 'ISSUE_DELETED' when the WS event fires).
  useEffect(() => {
    if (error === 'ISSUE_DELETED') {
      toast.info(t('issues.detail.notFound'));
      navigate('/issues');
    }
  }, [error, navigate, t]);

  const handleCommentPost = useCallback(async (content: string, parentId?: string) => {
    if (!id) return;
    try {
      await api.post<{ comment: unknown; enqueuedTask: unknown }>(
        `/issues/${id}/comments`,
        { content, parentId: parentId ?? null },
      );
      refetch();
    } catch (err) {
      toast.error(t('issues.detail.comments.postFailed'));
      throw err;
    }
  }, [id, refetch, t]);

  const handleCommentEdit = useCallback(async (commentId: string, content: string) => {
    try {
      await api.patch(`/comments/${commentId}`, { content });
      refetch();
    } catch {
      toast.error(t('issues.detail.comments.postFailed'));
    }
  }, [refetch, t]);

  const handleCommentDelete = useCallback(async (commentId: string) => {
    try {
      await api.delete(`/comments/${commentId}`);
      refetch();
    } catch {
      toast.error(t('issues.detail.comments.postFailed'));
    }
  }, [refetch, t]);

  const handleIssuePatch = useCallback(async (patch: UpdateIssuePatch) => {
    if (!id) return;
    try {
      await api.patch<Issue>(`/issues/${id}`, patch);
      refetch();
    } catch {
      toast.error(t('issues.board.statusChangeFailed'));
    }
  }, [id, refetch, t]);

  const handleIssueDelete = useCallback(async () => {
    if (!id) return;
    try {
      await api.delete(`/issues/${id}`);
      navigate('/issues');
    } catch {
      toast.error(t('issues.board.statusChangeFailed'));
    }
  }, [id, navigate, t]);

  const handleIssueAssign = useCallback(() => {
    // Wave 3 wires the assignee popover here; Wave 1 leaves it as a no-op.
  }, []);

  const handleIssueChangeStatus = useCallback((status: IssueStatus) => {
    void handleIssuePatch({ status });
  }, [handleIssuePatch]);

  const handleIssueEdit = useCallback(() => {
    // Wave 3 wires the inline-edit flow; Wave 1 leaves it as a no-op.
  }, []);

  if (loading && !issue) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-4" data-testid="issue-detail-loading">
        <Skeleton className="h-16" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('issues.detail.notFound')}
        </p>
        <Button variant="outline" asChild>
          <Link to="/issues">
            <ChevronLeft className="w-4 h-4 mr-1" />
            {t('issues.detail.back')}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div
      className="p-6 pb-8 max-w-[1200px] mx-auto space-y-6"
      data-testid="issue-detail"
      data-issue-id={issue.id}
    >
      <div>
        <Button variant="ghost" asChild>
          <Link to="/issues">
            <ChevronLeft className="w-4 h-4 mr-1" />
            {t('issues.detail.back')}
          </Link>
        </Button>
      </div>
      {/* sr-only live region host for Wave 2-3 announcements */}
      <div role="status" aria-live="polite" className="visually-hidden" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        <div className="space-y-6">
          <IssueHeader
            issue={issue}
            onEdit={handleIssueEdit}
            onDelete={handleIssueDelete}
            onAssign={handleIssueAssign}
            onChangeStatus={handleIssueChangeStatus}
          />
          <IssueDescription description={issue.description} />
          <CommentsTimeline
            issueId={id ?? ''}
            comments={comments}
            onPost={handleCommentPost}
            onEdit={handleCommentEdit}
            onDelete={handleCommentDelete}
            loadingIds={new Set()}
          />
          <TaskPanel issueId={id ?? ''} latestTask={latestTask} />
          {/* Wave 5 inserts the chat composer at the bottom */}
        </div>
        <IssueActionSidebar issue={issue} onPatch={handleIssuePatch} />
      </div>
    </div>
  );
}
