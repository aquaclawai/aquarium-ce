import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TaskMessageItem } from './TaskMessageItem';
import type { TaskMessage } from '@aquarium/shared';

/**
 * TaskMessageList — scroll container for a task's message stream.
 *
 * Virtualization contract (24-UI-SPEC §Virtualization):
 *   messages.length <= 100  → plain `.map()` render
 *   messages.length >  100  → `useVirtualizer` with 56 px estimate, overscan
 *                             bumped to 24 during replay to keep the catch-up
 *                             scroll from blank-flashing.
 *
 * Empty state shows the i18n-keyed `issues.detail.task.stream.waiting` copy.
 * The parent (TaskPanel) passes either `messages` or `renderedMessages`
 * (useDeferredValue view) from useTaskStream depending on whether it wants
 * the rendered-or-fresh tradeoff — Task 2b passes `renderedMessages` to
 * smooth bursts.
 *
 * Pure component: no hooks beyond refs / i18n / virtualizer, no state.
 */

interface TaskMessageListProps {
  taskId: string;
  messages: TaskMessage[];
  isReplaying: boolean;
}

const VIRTUALIZE_THRESHOLD = 100;

export function TaskMessageList({ messages, isReplaying }: TaskMessageListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const useVirtual = messages.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => 56,
    overscan: isReplaying ? 24 : 12,
    getScrollElement: () => scrollRef.current,
    enabled: useVirtual,
  });

  if (messages.length === 0) {
    return (
      <div
        className="p-6 text-sm text-muted-foreground text-center"
        data-testid="task-message-list-empty"
      >
        {t('issues.detail.task.stream.waiting')}
      </div>
    );
  }

  if (!useVirtual) {
    return (
      <div
        ref={scrollRef}
        className="max-h-[600px] overflow-y-auto flex flex-col gap-1"
        data-testid="task-message-list"
      >
        {messages.map((m, i) => (
          <TaskMessageItem
            key={m.id}
            message={m}
            isLatest={i === messages.length - 1}
          />
        ))}
      </div>
    );
  }

  // Virtualized path — absolute-positioned rows inside a spacer div sized to
  // the full virtual-content height. Pattern mirrors Phase 23's kanban list.
  return (
    <div
      ref={scrollRef}
      className="max-h-[600px] overflow-y-auto"
      data-testid="task-message-list"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const m = messages[vi.index];
          return (
            <div
              key={m.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <TaskMessageItem
                message={m}
                isLatest={vi.index === messages.length - 1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
