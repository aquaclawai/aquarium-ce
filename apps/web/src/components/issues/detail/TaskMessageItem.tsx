import { memo, useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  MessageSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { SafeMarkdown } from './markdown';
import { TruncationMarker } from './TruncationMarker';
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
 * Truncation affordance (Wave 4):
 *   Rows whose server-stored payload was truncated (metadata.truncated===true)
 *   render <TruncationMarker /> inline. Clicking "Show full" fetches the
 *   overflow row via /api/tasks/:id/messages/:seq/full and lifts the full
 *   TaskMessage into local `fullOverride` state — the body re-renders through
 *   the same SafeMarkdown / <pre> path (never innerHTML). Collapse reverts.
 *
 *   Client-side hard cap of 256 KB on any single rendered payload defends
 *   against an adversarial overflow row slipping past the server's 1 MB cap.
 *   When that fires, the body shows a further-clipped prefix + a dedicated
 *   notice; the marker stays visible so the user is never surprised by the
 *   clipping.
 *
 * Data attributes (for Playwright selectors — 24-UI-SPEC §Data-Attribute Markers):
 *   data-task-message-seq          seq number
 *   data-task-message-kind         type literal (text|thinking|tool_use|tool_result|error)
 *   data-task-message-truncated    'true' | 'false' from metadata.truncated
 *
 * Memoized on `id + seq + metadata.truncated + isLatest` so virtualizer-driven
 * re-renders don't churn sanitized markdown output. The local `fullOverride`
 * state lives inside the component, so a parent re-render with the same
 * message prop does NOT drop the expanded body.
 */

interface TaskMessageItemProps {
  message: TaskMessage;
  isLatest: boolean;
}

/** UX6 client-side byte cap on a single rendered payload. Defends against
 *  an adversarial /full response (server caps at 1 MB; we cap further at
 *  256 KB for DOM/rendering sanity). */
const CLIENT_RENDER_CAP_BYTES = 262_144;

function byteLength(s: string): number {
  // new Blob([s]).size is the browser-safe equivalent of Buffer.byteLength(s, 'utf8').
  // Works in Node test environments too (JSDOM polyfills Blob).
  return new Blob([s]).size;
}

interface RenderPayload {
  body: string;
  clipped: boolean;
}

/** Cap a string at CLIENT_RENDER_CAP_BYTES bytes. UTF-8 codepoint safety is
 *  not strictly required here (the server already truncates at codepoint
 *  boundaries); .slice() on the character count suffices as a safe DOM-size
 *  guard — we over-shoot by capping chars at 128 KiB (worst case UTF-16 chars
 *  → ~256 KB of UTF-8). */
function clipForRender(s: string): RenderPayload {
  if (byteLength(s) <= CLIENT_RENDER_CAP_BYTES) {
    return { body: s, clipped: false };
  }
  // 128 Ki characters is a safe over-approximation: even 2-byte UTF-8 code
  // points stay under CLIENT_RENDER_CAP_BYTES; 4-byte emoji will over-clip
  // slightly, which is the conservative direction for a render cap.
  const CHAR_CAP = 131_072;
  return { body: s.slice(0, CHAR_CAP), clipped: true };
}

function TaskMessageItemImpl({ message, isLatest }: TaskMessageItemProps) {
  const [fullOverride, setFullOverride] = useState<TaskMessage | null>(null);
  const effective = fullOverride ?? message;

  // A row is "still truncated" (i.e. show the marker) whenever the server
  // flagged the original row. The button label flips between Show-full /
  // Collapse based on `isExpanded`; the marker itself stays visible so the
  // user can collapse back to the truncated payload at any time.
  const isExpanded = fullOverride !== null;
  const isTruncated = message.metadata?.truncated === true;

  const onCollapse = useCallback(() => setFullOverride(null), []);

  // animate-pulse on the newest row respects the global prefers-reduced-motion
  // rule in apps/web/src/index.css, so accessibility isn't compromised.
  const latestAccent = isLatest ? 'animate-pulse' : '';
  const rowBase = `px-3 py-2 flex gap-3 text-sm ${latestAccent}`;

  const commonAttrs = {
    'data-task-message-seq': message.seq,
    'data-task-message-kind': message.type,
    'data-task-message-truncated': isTruncated ? 'true' : 'false',
  } as const;

  // shown/total byte accounting for the marker copy. `shown` reflects the
  // payload the user currently sees (truncated prefix OR full body once the
  // Show-full response has landed). `total` is sourced from
  // metadata.originalBytes set at INSERT time by task-message-store.ts.
  const markerBytes = useMemo(() => {
    const shownSource =
      effective.type === 'text' || effective.type === 'thinking'
        ? effective.content ?? ''
        : effective.type === 'tool_use'
          ? safeJsonStringify(effective.input)
          : effective.type === 'tool_result'
            ? typeof effective.output === 'string'
              ? effective.output
              : safeJsonStringify(effective.output)
            : '';
    const shown = byteLength(shownSource);
    const total = Number(
      message.metadata?.originalBytes ??
        effective.metadata?.originalBytes ??
        shown,
    );
    return { shown, total };
  }, [effective, message.metadata?.originalBytes]);

  switch (effective.type) {
    case 'text': {
      const { body, clipped } = clipForRender(effective.content ?? '');
      return (
        <div {...commonAttrs} className={rowBase}>
          <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 leading-relaxed">
            <SafeMarkdown>{body}</SafeMarkdown>
            {clipped && <FurtherClippedNotice />}
            {isTruncated && (
              <TruncationMarker
                taskId={effective.taskId}
                seq={effective.seq}
                shownBytes={markerBytes.shown}
                totalBytes={markerBytes.total}
                onLoad={setFullOverride}
                onCollapse={onCollapse}
                isExpanded={isExpanded}
              />
            )}
          </div>
        </div>
      );
    }

    case 'thinking': {
      const { body, clipped } = clipForRender(effective.content ?? '');
      return (
        <div {...commonAttrs} className={`${rowBase} border-l-2 border-muted pl-3`}>
          <Brain className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 italic text-muted-foreground leading-relaxed">
            <SafeMarkdown>{body}</SafeMarkdown>
            {clipped && <FurtherClippedNotice />}
            {isTruncated && (
              <TruncationMarker
                taskId={effective.taskId}
                seq={effective.seq}
                shownBytes={markerBytes.shown}
                totalBytes={markerBytes.total}
                onLoad={setFullOverride}
                onCollapse={onCollapse}
                isExpanded={isExpanded}
              />
            )}
          </div>
        </div>
      );
    }

    case 'tool_use': {
      // JSON.stringify → text child; React auto-escapes. NEVER innerHTML.
      const serialised = safeJsonStringify(effective.input);
      const { body, clipped } = clipForRender(serialised);
      return (
        <div
          {...commonAttrs}
          className={`${rowBase} border-l-2 border-[var(--color-info)] pl-3`}
        >
          <Wrench className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground mb-1">
              {effective.tool ?? 'tool'}
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto bg-muted p-2 rounded">
              {body}
            </pre>
            {clipped && <FurtherClippedNotice />}
            {isTruncated && (
              <TruncationMarker
                taskId={effective.taskId}
                seq={effective.seq}
                shownBytes={markerBytes.shown}
                totalBytes={markerBytes.total}
                onLoad={setFullOverride}
                onCollapse={onCollapse}
                isExpanded={isExpanded}
              />
            )}
          </div>
        </div>
      );
    }

    case 'tool_result': {
      const isError = effective.metadata?.isError === true;
      const content =
        typeof effective.output === 'string'
          ? effective.output
          : safeJsonStringify(effective.output);
      const { body, clipped } = clipForRender(content);
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
              {body}
            </pre>
            {clipped && <FurtherClippedNotice />}
            {isTruncated && (
              <TruncationMarker
                taskId={effective.taskId}
                seq={effective.seq}
                shownBytes={markerBytes.shown}
                totalBytes={markerBytes.total}
                onLoad={setFullOverride}
                onCollapse={onCollapse}
                isExpanded={isExpanded}
              />
            )}
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
            {effective.content ?? ''}
          </span>
        </div>
      );

    default: {
      // Exhaustive-match guard so future TaskMessageType additions fail loudly.
      const exhaustive: never = effective.type;
      void exhaustive;
      return null;
    }
  }
}

/**
 * Nested notice rendered when the full response payload exceeded the client's
 * 256 KB render cap. The TruncationMarker also stays visible, so the user
 * sees both messages: the server's original truncation AND the defensive
 * client-side further-clipping.
 */
function FurtherClippedNotice() {
  return (
    <span
      className="text-xs italic text-muted-foreground block mt-1"
      data-further-clipped="true"
    >
      (further clipped for rendering)
    </span>
  );
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
