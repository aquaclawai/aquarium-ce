import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@aquarium/shared';

/**
 * TaskStateBadge — shows the current lifecycle state of the latest task.
 *
 * State accents follow 24-UI-SPEC §Color §Per-task-state table:
 *   idle        outline, muted
 *   queued      secondary
 *   dispatched  secondary + pulse-dot before the label (activity hint)
 *   running     info-subtle token (bg + text)
 *   completed   success-subtle token
 *   failed      destructive
 *   cancelled   outline + opacity-70
 *
 * Token values resolve via existing Oxide CSS variables — no new colors.
 * Pure presentational component: no hooks beyond t(), no network, no state.
 */
export function TaskStateBadge({ state }: { state: TaskStatus | 'idle' }) {
  const { t } = useTranslation();

  switch (state) {
    case 'queued':
      return (
        <Badge
          variant="secondary"
          data-task-badge-state="queued"
        >
          {t('issues.detail.task.state.queued')}
        </Badge>
      );
    case 'dispatched':
      // Pulse-dot uses a pseudo-element so screen readers ignore it and the
      // dot respects prefers-reduced-motion via the global rule in index.css.
      return (
        <Badge
          variant="secondary"
          className="relative pl-5 before:content-[''] before:absolute before:left-1.5 before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-current before:animate-pulse"
          data-task-badge-state="dispatched"
        >
          {t('issues.detail.task.state.dispatched')}
        </Badge>
      );
    case 'running':
      return (
        <Badge
          className="bg-[var(--color-info-subtle-bg)] text-[var(--color-info-subtle-text)] border-transparent"
          data-task-badge-state="running"
        >
          {t('issues.detail.task.state.running')}
        </Badge>
      );
    case 'completed':
      return (
        <Badge
          className="bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)] border-transparent"
          data-task-badge-state="completed"
        >
          {t('issues.detail.task.state.completed')}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" data-task-badge-state="failed">
          {t('issues.detail.task.state.failed')}
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge
          variant="outline"
          className="opacity-70"
          data-task-badge-state="cancelled"
        >
          {t('issues.detail.task.state.cancelled')}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" data-task-badge-state="idle">
          {t('issues.detail.task.idle')}
        </Badge>
      );
  }
}
