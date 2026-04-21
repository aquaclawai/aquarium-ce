import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CommentCard } from './CommentCard';
import { CommentComposer } from './CommentComposer';
import type { Comment } from '@aquarium/shared';

export interface CommentTreeNode {
  comment: Comment;
  children: CommentTreeNode[];
}

interface CommentThreadProps {
  root: Comment;
  replies: CommentTreeNode[];
  depth: number;
  onReply: (parentId: string | null) => void;
  activeReplyTarget: string | null;
  onPost: (content: string, parentId: string) => Promise<void>;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const VISIBLE_CHILD_LIMIT = 5;
const KEEP_VISIBLE_WHEN_COLLAPSED = 2;
const MAX_VISIBLE_DEPTH = 3;

/**
 * Recursive thread renderer. Indentation grows to a depth cap of 3; deeper
 * replies render at depth=3 with no additional indent (visual flatten).
 *
 * Collapse rule (T-24-01-04): if a subtree has > 5 direct children, hide
 * all children below index 2 behind a "Show {n} more replies" button.
 */
export function CommentThread({
  root,
  replies,
  depth,
  onReply,
  activeReplyTarget,
  onPost,
  onEdit,
  onDelete,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const shouldCollapse = replies.length > VISIBLE_CHILD_LIMIT && !expanded;
  const displayedReplies = shouldCollapse
    ? replies.slice(0, KEEP_VISIBLE_WHEN_COLLAPSED)
    : replies;
  const collapsedCount = shouldCollapse
    ? replies.length - KEEP_VISIBLE_WHEN_COLLAPSED
    : 0;

  const isReplyingHere = activeReplyTarget === root.id;
  const canReply = root.authorType !== 'system';

  return (
    <div
      data-comment-thread={root.id}
      className={depth === 0 ? 'space-y-3' : 'pl-6 border-l border-border space-y-3 mt-2'}
    >
      <CommentCard
        comment={root}
        isActiveReplyTarget={isReplyingHere}
        onReply={() => canReply && onReply(isReplyingHere ? null : root.id)}
        onEdit={() => onEdit(root.id, root.content)}
        onDelete={() => void onDelete(root.id)}
      />

      {isReplyingHere && canReply && (
        <CommentComposer
          onSubmit={(c) => onPost(c, root.id)}
          autoFocus
          placeholderKey="issues.detail.comments.replyPlaceholder"
          authorName={root.authorDisplayName ?? root.authorUserId ?? root.authorAgentId ?? ''}
          onCancel={() => onReply(null)}
        />
      )}

      {displayedReplies.map((node) => (
        <CommentThread
          key={node.comment.id}
          root={node.comment}
          // Visual depth cap — deeper threads keep indent at MAX_VISIBLE_DEPTH.
          // Branching tree continues regardless of visual depth cap.
          depth={Math.min(depth + 1, MAX_VISIBLE_DEPTH)}
          replies={node.children}
          onReply={onReply}
          activeReplyTarget={activeReplyTarget}
          onPost={onPost}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}

      {collapsedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          data-comment-collapsed={collapsedCount}
          onClick={() => setExpanded(true)}
        >
          {t('issues.detail.comments.showMore', { count: collapsedCount })}
        </Button>
      )}
    </div>
  );
}
