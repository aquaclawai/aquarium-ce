import { memo } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  MessageSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { SafeMarkdown } from './markdown';
import type { TaskMessage } from '@aquarium/shared';

/**
 * TaskMessageItem — renders ONE task message row.
 *
 * Per-kind dispatch (24-UI-SPEC §Per-task-message-kind table + §UX6 rendering):
 *   text        SafeMarkdown — body 14/400, MessageSquare icon
 *   thinking    SafeMarkdown — italic + muted, Brain icon, muted left gutter
 *   tool_use    <pre>{JSON.stringify(input, null, 2)}</pre> — info-left gutter, Wrench icon
 *   tool_result <pre>{content | JSON.stringify(output)}</pre> — success or destructive gutter
 *               based on metadata.isError; CheckCircle2 or AlertCircle icon
 *   error       plain <span> — destructive gutter + XCircle icon
 *
 * HARD UX6 invariant: zero raw-HTML injection. JSON.stringify output as a
 * text child is auto-escaped by React; SafeMarkdown is sanitized by
 * rehype-sanitize. Grep guard `danger` + `etInnerHTML` keyword fires at 0.
 *
 * Data attributes (for Playwright selectors — 24-UI-SPEC §Data-Attribute Markers):
 *   data-task-message-seq          seq number
 *   data-task-message-kind         type literal (text|thinking|tool_use|tool_result|error)
 *   data-task-message-truncated    'true' | 'false' from metadata.truncated
 *
 * Memoized on `id + seq + metadata.truncated + isLatest` so virtualizer-driven
 * re-renders don't churn sanitized markdown output.
 */

interface TaskMessageItemProps {
  message: TaskMessage;
  isLatest: boolean;
}

function TaskMessageItemImpl({ message, isLatest }: TaskMessageItemProps) {
  const isTruncated = message.metadata?.truncated === true;
  // animate-pulse on the newest row respects the global prefers-reduced-motion
  // rule in apps/web/src/index.css, so accessibility isn't compromised.
  const latestAccent = isLatest ? 'animate-pulse' : '';
  const rowBase = `px-3 py-2 flex gap-3 text-sm ${latestAccent}`;

  const commonAttrs = {
    'data-task-message-seq': message.seq,
    'data-task-message-kind': message.type,
    'data-task-message-truncated': isTruncated ? 'true' : 'false',
  } as const;

  switch (message.type) {
    case 'text':
      return (
        <div {...commonAttrs} className={rowBase}>
          <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 leading-relaxed">
            <SafeMarkdown>{message.content ?? ''}</SafeMarkdown>
            {isTruncated && <TruncationMarkerPlaceholder />}
          </div>
        </div>
      );

    case 'thinking':
      return (
        <div {...commonAttrs} className={`${rowBase} border-l-2 border-muted pl-3`}>
          <Brain className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 italic text-muted-foreground leading-relaxed">
            <SafeMarkdown>{message.content ?? ''}</SafeMarkdown>
            {isTruncated && <TruncationMarkerPlaceholder />}
          </div>
        </div>
      );

    case 'tool_use': {
      // JSON.stringify → text child; React auto-escapes. NEVER innerHTML.
      const serialised = safeJsonStringify(message.input);
      return (
        <div
          {...commonAttrs}
          className={`${rowBase} border-l-2 border-[var(--color-info)] pl-3`}
        >
          <Wrench className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground mb-1">
              {message.tool ?? 'tool'}
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto bg-muted p-2 rounded">
              {serialised}
            </pre>
            {isTruncated && <TruncationMarkerPlaceholder />}
          </div>
        </div>
      );
    }

    case 'tool_result': {
      const isError = message.metadata?.isError === true;
      const content =
        typeof message.output === 'string'
          ? message.output
          : safeJsonStringify(message.output);
      const gutterColor = isError
        ? 'border-[var(--color-destructive)]'
        : 'border-[var(--color-success)]';
      return (
        <div {...commonAttrs} className={`${rowBase} border-l-2 ${gutterColor} pl-3`}>
          {isError ? (
            <AlertCircle
              className="w-3.5 h-3.5 mt-0.5 text-[var(--color-destructive)] shrink-0"
              aria-hidden
            />
          ) : (
            <CheckCircle2
              className="w-3.5 h-3.5 mt-0.5 text-[var(--color-success)] shrink-0"
              aria-hidden
            />
          )}
          <div className="flex-1 min-w-0">
            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto">
              {content}
            </pre>
            {isTruncated && <TruncationMarkerPlaceholder />}
          </div>
        </div>
      );
    }

    case 'error':
      return (
        <div
          {...commonAttrs}
          className={`${rowBase} border-l-2 border-[var(--color-destructive)] pl-3`}
        >
          <XCircle
            className="w-3.5 h-3.5 mt-0.5 text-[var(--color-destructive)] shrink-0"
            aria-hidden
          />
          <span className="flex-1 min-w-0 text-sm text-[var(--color-destructive)] font-medium">
            {message.content ?? ''}
          </span>
        </div>
      );

    default: {
      // Exhaustive-match guard so future TaskMessageType additions fail loudly.
      const exhaustive: never = message.type;
      void exhaustive;
      return null;
    }
  }
}

/**
 * Placeholder for Wave 4's <TruncationMarker /> "Show full" link. Rendered
 * as `null` today so `data-task-message-truncated="true"` is the only hint
 * the UI surfaces — Task 2a deliberately ships the marker-ready structure
 * without Wave 4's network call.
 */
function TruncationMarkerPlaceholder() {
  return null;
}

/**
 * Guarded JSON.stringify. Agent-authored input can include BigInt or
 * circular refs; a throw here would blank the row. Catch + render a short
 * fallback so the panel stays readable.
 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return '[unrenderable payload]';
  }
}

export const TaskMessageItem = memo(
  TaskMessageItemImpl,
  (a, b) =>
    a.message.id === b.message.id &&
    a.message.seq === b.message.seq &&
    a.message.metadata?.truncated === b.message.metadata?.truncated &&
    a.isLatest === b.isLatest,
);
