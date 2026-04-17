import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError } from '../../../api';
import type { TaskMessage } from '@aquarium/shared';

/**
 * TruncationMarker — Phase 24-04 / UI-07 / UX6.
 *
 * Inline affordance rendered next to any TaskMessageItem body whose server-
 * stored payload was truncated at the 16 KB cap (Wave 0). Offers "Show full"
 * which fetches the uncapped row via GET /api/tasks/:id/messages/:seq/full
 * (served by the overflow-table merge in task-message-store.ts) and
 * "Collapse" which reverts the parent body back to the truncated payload.
 *
 * Contract (24-UI-SPEC §UX6 Truncation + §Data-Attribute Markers):
 *   • The component NEVER renders agent content directly. It only paints the
 *     marker copy + button. Full content is handed back to TaskMessageItem
 *     via `onLoad`, which re-renders the body through SafeMarkdown / <pre>.
 *     This preserves the UX6 invariant that agent content passes through
 *     a single sanitization path with no raw-HTML injection.
 *   • Fetch goes through the shared `api.get<T>()` wrapper (never raw fetch
 *     — UX6 + CLAUDE.md). The wrapper unwraps ApiResponse<T> and throws
 *     ApiError on non-ok responses; we catch → toast → stay clickable
 *     to retry.
 *   • Loading state: link text swaps to `showFullLoading`; the button is
 *     disabled so double-click can't re-trigger the request.
 *   • Required data-attributes on the span / button:
 *       data-truncated="true"
 *       data-original-bytes={totalBytes}
 *       data-action="show-full"     (collapsed-state button only)
 *       data-task-id={taskId}        (collapsed-state button only)
 *       data-seq={seq}               (collapsed-state button only)
 *     These selectors are the Playwright "truncation marker" test's contract.
 */

interface TruncationMarkerProps {
  taskId: string;
  seq: number;
  shownBytes: number;
  totalBytes: number;
  onLoad: (full: TaskMessage) => void;
  onCollapse: () => void;
  isExpanded: boolean;
}

export function TruncationMarker({
  taskId,
  seq,
  shownBytes,
  totalBytes,
  onLoad,
  onCollapse,
  isExpanded,
}: TruncationMarkerProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleShowFull = useCallback(async () => {
    setLoading(true);
    try {
      // api.get<T>() unwraps ApiResponse<T> and throws ApiError on failure,
      // so a resolved value is always the TaskMessage payload. Plain string
      // concat (not template literal) keeps the /messages/ grep-invariant
      // trivially auditable from the key_links in the plan frontmatter.
      const full = await api.get<TaskMessage>(
        '/tasks/' + taskId + '/messages/' + seq + '/full',
      );
      onLoad(full);
    } catch (err) {
      const reason =
        err instanceof ApiError ? err.message : t('issues.detail.task.showFullFailed');
      toast.error(t('issues.detail.task.showFullFailed'), {
        description:
          reason === t('issues.detail.task.showFullFailed') ? undefined : reason,
      });
    } finally {
      setLoading(false);
    }
  }, [taskId, seq, onLoad, t]);

  return (
    <span
      className="text-xs text-muted-foreground mt-1 inline-flex flex-wrap items-center gap-x-2"
      data-truncated="true"
      data-original-bytes={totalBytes}
    >
      <span>
        {t('issues.detail.task.truncated', { shown: shownBytes, total: totalBytes })}
      </span>
      {isExpanded ? (
        <button
          type="button"
          className="text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm"
          onClick={onCollapse}
        >
          {t('issues.detail.task.collapse')}
        </button>
      ) : (
        <button
          type="button"
          className="text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleShowFull}
          disabled={loading}
          data-action="show-full"
          data-task-id={taskId}
          data-seq={seq}
        >
          {loading
            ? t('issues.detail.task.showFullLoading')
            : t('issues.detail.task.showFull')}
        </button>
      )}
    </span>
  );
}
