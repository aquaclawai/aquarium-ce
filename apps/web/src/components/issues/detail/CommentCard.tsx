import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from './markdown';
import type { Comment } from '@aquarium/shared';

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const deltaSec = Math.floor((Date.now() - then) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface CommentCardProps {
  comment: Comment;
  isActiveReplyTarget: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function CommentCardImpl({ comment, isActiveReplyTarget, onReply, onEdit, onDelete }: CommentCardProps) {
  const { t } = useTranslation();

  // System comments render as a compact single-line italic row — no avatar,
  // no actions, no reply affordance. The server refuses replies to system
  // comments (Phase 17-04 guard), so the tree never grows under them.
  if (comment.authorType === 'system') {
    return (
      <Card
        className="px-3 py-2 bg-muted/30 border-none shadow-none"
        data-comment={comment.id}
        data-comment-author-type="system"
        data-comment-parent={comment.parentId ?? ''}
      >
        <div className="text-xs text-muted-foreground italic">
          {comment.content}
        </div>
      </Card>
    );
  }

  const authorName = comment.authorType === 'agent'
    ? (comment.authorAgentId ?? 'agent')
    : (comment.authorUserId ?? 'user');
  const authorLabel = comment.authorType === 'agent'
    ? t('issues.detail.comments.author.agent', { agentName: authorName })
    : t('issues.detail.comments.author.user', { displayName: authorName });

  return (
    <Card
      className="p-3"
      data-comment={comment.id}
      data-comment-author-type={comment.authorType}
      data-comment-parent={comment.parentId ?? ''}
    >
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-medium shrink-0">
          {initialsOf(authorName)}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium">{authorLabel}</span>
            <span className="text-muted-foreground">
              · {formatRelative(comment.createdAt)}
            </span>
          </div>
          <div className="text-sm">
            <SafeMarkdown>{comment.content}</SafeMarkdown>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onReply}
              aria-pressed={isActiveReplyTarget}
              data-action="reply"
            >
              {t('issues.detail.comments.reply')}
            </Button>
            {comment.authorType === 'user' && (
              <>
                <Button variant="ghost" size="sm" onClick={onEdit} data-action="edit">
                  {t('issues.detail.comments.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  className="text-destructive hover:text-destructive"
                  data-action="delete"
                >
                  {t('issues.detail.comments.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export const CommentCard = memo(
  CommentCardImpl,
  (a, b) => (
    a.comment.id === b.comment.id
    && a.comment.updatedAt === b.comment.updatedAt
    && a.comment.content === b.comment.content
    && a.isActiveReplyTarget === b.isActiveReplyTarget
  ),
);
