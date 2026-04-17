import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { CommentThread } from './CommentThread';
import type { CommentTreeNode } from './CommentThread';
import { CommentComposer } from './CommentComposer';
import type { Comment } from '@aquarium/shared';

interface CommentsTimelineProps {
  issueId: string;
  comments: Comment[];
  onPost: (content: string, parentId?: string) => Promise<void>;
  onEdit: (commentId: string, content: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  loadingIds: Set<string>;
}

/**
 * Builds a forest of CommentTreeNodes by parent_id. Roots (parent_id === null)
 * are sorted by createdAt ASC; each root's children array contains its direct
 * descendants in createdAt ASC order. Orphaned children (parent_id that no
 * longer points at an existing comment — e.g. parent deleted with SET NULL)
 * surface as additional roots so they remain visible in the timeline.
 */
function buildForest(comments: Comment[]): CommentTreeNode[] {
  const byId = new Map<string, Comment>();
  for (const c of comments) byId.set(c.id, c);

  const childrenOf = new Map<string | null, Comment[]>();
  for (const c of comments) {
    // Treat orphan parents (deleted SET NULL) as roots.
    const parentKey = c.parentId && byId.has(c.parentId) ? c.parentId : null;
    const bucket = childrenOf.get(parentKey) ?? [];
    bucket.push(c);
    childrenOf.set(parentKey, bucket);
  }

  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const build = (comment: Comment): CommentTreeNode => ({
    comment,
    children: (childrenOf.get(comment.id) ?? []).map(build),
  });

  return (childrenOf.get(null) ?? []).map(build);
}

export function CommentsTimeline({
  comments,
  onPost,
  onEdit,
  onDelete,
}: CommentsTimelineProps) {
  const { t } = useTranslation();
  const [activeReplyTarget, setActiveReplyTarget] = useState<string | null>(null);

  const forest = useMemo(() => buildForest(comments), [comments]);

  return (
    <section className="space-y-4" data-testid="comments-timeline">
      <header className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">
          {t('issues.detail.comments.header')}
        </h2>
        <Badge variant="outline">
          {t('issues.detail.comments.count', { count: comments.length })}
        </Badge>
      </header>

      {comments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <div className="text-sm font-medium mb-1">
            {t('issues.detail.comments.empty.heading')}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('issues.detail.comments.empty.body')}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {forest.map((node) => (
            <CommentThread
              key={node.comment.id}
              root={node.comment}
              replies={node.children}
              depth={0}
              onReply={setActiveReplyTarget}
              activeReplyTarget={activeReplyTarget}
              onPost={onPost}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <div className="pt-2">
        <CommentComposer
          onSubmit={(c) => onPost(c)}
          placeholderKey="issues.detail.comments.replyPlaceholder"
        />
      </div>
    </section>
  );
}
