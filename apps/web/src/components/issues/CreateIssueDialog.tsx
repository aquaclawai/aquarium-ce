import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Issue, IssuePriority, IssueStatus } from '@aquarium/shared';
import { api, ApiError } from '../../api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Minimal issue-create dialog. Fills the Phase 23 gap where the board
 * page shipped without a create affordance (users had to POST /api/issues
 * by hand). Validated at the API boundary by issue-store.createIssue —
 * we only enforce a non-empty title client-side.
 *
 * Scope: title + optional description + initial status + priority. Assignee
 * / dueDate are not in the create flow on purpose — the issue detail page
 * already handles both edits post-create, and keeping the create modal
 * lean preserves the "one-click new issue" feel.
 */

const STATUSES: readonly IssueStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const PRIORITIES: readonly IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (issue: Issue) => void;
}

export function CreateIssueDialog({ open, onOpenChange, onCreated }: CreateIssueDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<IssueStatus>('backlog');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStatus('backlog');
      setPriority('medium');
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const issue = await api.post<Issue>('/issues', {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
      });
      onCreated(issue);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('issues.board.createFailed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-issue-create-dialog className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{t('issues.board.create.title')}</DialogTitle>
          <DialogDescription>{t('issues.board.create.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="issue-create-title" className="text-sm font-medium">
              {t('issues.board.create.fields.title')}
            </label>
            <Input
              id="issue-create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('issues.board.create.fields.titlePlaceholder')}
              autoFocus
              required
              maxLength={255}
              data-issue-create-title
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="issue-create-description" className="text-sm font-medium">
              {t('issues.board.create.fields.description')}
            </label>
            <textarea
              id="issue-create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('issues.board.create.fields.descriptionPlaceholder')}
              className="min-h-[96px] w-full p-3 rounded-md border border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              data-issue-create-description
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="issue-create-status" className="text-sm font-medium">
                {t('issues.board.create.fields.status')}
              </label>
              <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
                <SelectTrigger id="issue-create-status" data-issue-create-status>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`issues.board.columns.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="issue-create-priority" className="text-sm font-medium">
                {t('issues.board.create.fields.priority')}
              </label>
              <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
                <SelectTrigger id="issue-create-priority" data-issue-create-priority>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`issues.board.priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('issues.board.create.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-issue-create-submit>
              {submitting
                ? t('issues.board.create.creating')
                : t('issues.board.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
