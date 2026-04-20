import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface CommentComposerProps {
  onSubmit: (content: string) => Promise<void>;
  placeholderKey: string;
  /**
   * Interpolation value for the i18n placeholder key. Required when the
   * placeholder key contains `{{authorName}}` — e.g. threaded replies. For
   * placeholder keys with no interpolation variables this is ignored.
   */
  authorName?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}

/**
 * Inline comment textarea + Post button. Plain Enter inserts a newline
 * (default behaviour); ⌘⏎ / Ctrl+Enter submits. Disabled while the parent
 * handler's promise is pending. Errors surface through the parent's toast.
 */
export function CommentComposer({ onSubmit, placeholderKey, authorName, autoFocus, onCancel }: CommentComposerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setContent('');
    } catch {
      // parent handles the toast; keep content so the user can retry.
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, onSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘⏎ (Mac) / Ctrl+Enter (Win/Linux) submits; plain Enter inserts newline.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        className="min-h-[80px] w-full p-3 rounded-md border border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={authorName ? t(placeholderKey, { authorName }) : t(placeholderKey)}
        disabled={submitting}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || content.trim().length === 0}
          size="sm"
        >
          {submitting
            ? t('issues.detail.task.showFullLoading')
            : t('issues.detail.comments.reply')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t('issues.detail.comments.cancelReply')}
          </Button>
        )}
      </div>
    </div>
  );
}
