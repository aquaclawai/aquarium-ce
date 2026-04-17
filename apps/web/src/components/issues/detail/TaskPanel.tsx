import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '../../../api';
import { TaskMessageList } from './TaskMessageList';
import { TaskStateBadge } from './TaskStateBadge';
import type { UseTaskStreamReturn } from './useTaskStream';
import type { AgentTask } from '@aquarium/shared';

/**
 * TaskPanel — the "Active task" card on the issue detail page.
 *
 * Composes:
 *   • TaskStateBadge   — lifecycle state
 *   • Cancel button    — visible only for running/dispatched; opens a
 *                        destructive confirm Dialog (24-UI-SPEC pattern)
 *   • TaskMessageList  — virtualized message stream from useTaskStream
 *
 * When `latestTask === null` the panel renders the idle body copy and passes
 * a null taskId to useTaskStream (the hook no-ops — no fetch, no subscribe).
 *
 * Cancel flow: POST /api/tasks/:id/cancel (shipped by Wave 0). Success path
 * relies on the server's task:cancelled WS broadcast to flip latestTask.status
 * through useIssueDetail's onTaskLifecycle handler — TaskPanel itself doesn't
 * mutate state optimistically so a failed API doesn't desync the badge.
 */

interface TaskPanelProps {
  issueId: string;
  latestTask: AgentTask | null;
  // Phase 24-03 refactor: the caller (IssueDetailPage) owns the hook call so
  // the page-level ReconnectBanner can read the same stream.isReplaying
  // signal without a second hook instance. TaskPanel becomes a pure view
  // over (latestTask, stream).
  stream: UseTaskStreamReturn;
}

export function TaskPanel({ issueId, latestTask, stream }: TaskPanelProps) {
  const { t } = useTranslation();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const state = latestTask?.status ?? 'idle';
  // Cancel is only meaningful while the task can still be aborted.
  const showCancel = state === 'running' || state === 'dispatched' || state === 'queued';

  const handleCancel = useCallback(async () => {
    if (!latestTask) return;
    setCancelling(true);
    try {
      await api.post(`/tasks/${latestTask.id}/cancel`, {});
      setConfirmCancelOpen(false);
      // Server broadcasts task:cancelled; useIssueDetail flips latestTask.
    } catch {
      toast.error(t('issues.detail.task.cancelFailed'));
    } finally {
      setCancelling(false);
    }
  }, [latestTask, t]);

  return (
    <Card
      className="p-4"
      data-task-panel={latestTask?.id ?? 'idle'}
      data-task-state={state}
      data-issue-id={issueId}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-semibold truncate">
            {t('issues.detail.task.header')}
          </h2>
          <TaskStateBadge state={state} />
        </div>
        {showCancel && latestTask && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmCancelOpen(true)}
            data-action="cancel-task"
          >
            {t('issues.detail.task.cancel')}
          </Button>
        )}
      </div>

      {latestTask ? (
        <TaskMessageList
          taskId={latestTask.id}
          messages={stream.renderedMessages}
          isReplaying={stream.isReplaying}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('issues.detail.task.idleBody')}
        </p>
      )}

      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('issues.detail.task.cancelConfirm.title')}</DialogTitle>
            <DialogDescription>
              {t('issues.detail.task.cancelConfirm.body')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCancelOpen(false)}
              disabled={cancelling}
            >
              {t('common.buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
              data-action="confirm-cancel-task"
            >
              {t('issues.detail.task.cancelConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
