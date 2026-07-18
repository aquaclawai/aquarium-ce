import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { AgentTask, Comment, Issue } from '@aquarium/shared';

/**
 * Phase 24-05 CHAT-01 — sticky chat composer at the bottom of the issue
 * detail main column. On submit:
 *   1) POST /api/issues/:id/comments with { content, triggerCommentId }
 *      (the triggerCommentId anchors the task to this chat turn per
 *       17-04 semantics — the NEWLY created user comment's id is what the
 *       server writes into agent_task_queue.trigger_comment_id).
 *   2) Response returns { comment, enqueuedTask } — the parent bubbles
 *      enqueuedTask up via onSubmit so the TaskPanel subscribes immediately
 *      (overrideLatestTask) without waiting for the task:dispatched WS event.
 *
 * UX invariants (24-UI-SPEC §ChatComposer, §Copywriting):
 *   • ⌘⏎ / Ctrl+Enter submits; plain Enter inserts newline.
 *   • Disabled when the issue has no assignee — toast + no submit
 *     (the assign-agent affordance lives in the sidebar; T-24-05-06 belt).
 *   • Char counter becomes visible only when content.length > MAX-200; hard
 *     cap at MAX=8000 client-side.
 *   • z-index: var(--z-sticky) keeps it above the main scroll column.
 *   • No raw-HTML injection anywhere in this component (UX6 invariant).
 */

const MAX_CHARS = 8000;
const CHAR_COUNTER_THRESHOLD = MAX_CHARS - 200;

export interface ChatSubmitArgs {
  content: string;
  triggerCommentId: string | null;
}

export interface ChatSubmitResult {
  comment: Comment;
  enqueuedTask: AgentTask | null;
}

interface ChatComposerProps {
  issue: Issue;
  lastUserCommentId: string | null;
  onSubmit: (args: ChatSubmitArgs) => Promise<ChatSubmitResult>;
  disabled?: boolean;
}

export function ChatComposer({
  issue,
  lastUserCommentId,
  onSubmit,
  disabled,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasAssignee = issue.assigneeId !== null;
  const effectiveDisabled = (disabled ?? false) || !hasAssignee;
  const showCharCounter = content.length > CHAR_COUNTER_THRESHOLD;

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;
    if (!hasAssignee) {
      toast.error(t('chat.composer.noAssignee'));
      return;
    }
    setSubmitting(true);
    try {
      // Phase 17-04 server-side invariant: createUserComment enqueues a task
      // iff `triggerCommentId` is truthy AND the issue has an assignee. The
      // NEWLY-created comment's id is what the server writes into
      // agent_task_queue.trigger_comment_id (the body value is an intent
      // flag — "this comment triggers the agent"). For subsequent turns we
      // prefer the last-user-comment id so completion threads the agent
      // reply under the most recent prompt per CHAT-01; for the FIRST chat
      // turn there is no prior user comment so we fall back to issue.id as
      // a truthy sentinel so the task still enqueues.
      await onSubmit({
        content: trimmed.slice(0, MAX_CHARS),
        triggerCommentId: lastUserCommentId ?? issue.id,
      });
      setContent('');
    } catch {
      toast.error(t('chat.composer.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, hasAssignee, onSubmit, lastUserCommentId, issue.id, t]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘⏎ (Mac) / Ctrl+Enter (Win/Linux) submits; plain Enter = newline.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className="sticky bottom-0 pt-4 bg-background"
      style={{ zIndex: 'var(--z-sticky)' }}
    >
      <h2 className="visually-hidden">{t('chat.composer.srHeader')}</h2>
      <Card
        className="p-3"
        data-chat-composer
        data-disabled={effectiveDisabled ? 'true' : 'false'}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.composer.placeholder')}
          className="min-h-[80px] w-full p-3 rounded-md border border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] resize-y"
          disabled={effectiveDisabled || submitting}
          aria-label={t('chat.composer.srHeader')}
        />
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-muted-foreground">
            {!hasAssignee ? t('chat.composer.noAssignee') : t('chat.composer.hint')}
            {showCharCounter && (
              <span className="ml-3">
                {t('chat.composer.chars', {
                  count: content.length,
                  max: MAX_CHARS,
                })}
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={effectiveDisabled || submitting || content.trim().length === 0}
            data-action="chat-send"
          >
            {submitting ? t('chat.composer.sending') : t('chat.composer.send')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
