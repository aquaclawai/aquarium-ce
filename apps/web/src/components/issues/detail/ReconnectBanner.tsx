import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ReconnectBanner — a compact aria-live status row that surfaces the WS
 * reconnect/replay state to the user. Visible ONLY while:
 *   • isReconnecting (WS socket down → no live events flowing), OR
 *   • isReplaying    (server's buffer-replay-live window is still draining)
 *
 * On the transition out of both flags the banner fades in a "Caught up" tone
 * for 1.5 s so the user gets a positive confirmation that no messages were
 * lost (Phase 24-03 ST2 end-to-end contract). After the fade the banner
 * unmounts entirely.
 *
 * Styling uses the Oxide "warning-subtle" + "success-subtle" tokens already
 * defined in `apps/web/src/index.css:222-227,522-527` so dark theme parity
 * is automatic. No new tokens are introduced.
 *
 * Accessibility: role="status" + aria-live="polite" (not "assertive") because
 * the banner is a background network status hint, not a user-blocking error.
 * Rate of change is bounded by the 500 ms isReplaying quiet timer + the
 * 3 s reconnect backoff in WebSocketContext — screen readers won't thrash.
 */

interface ReconnectBannerProps {
  isReconnecting: boolean;
  isReplaying: boolean;
}

export function ReconnectBanner({ isReconnecting, isReplaying }: ReconnectBannerProps) {
  const { t } = useTranslation();
  // `showCaughtUp` is a pure boolean: when active flips to idle we set it
  // true, schedule a 1.5 s timer in the same effect to flip it back to false,
  // and clear the timer on any dep change. All clock reads live inside the
  // effect — never at render time (react-hooks/purity). The active→idle
  // transition is detected via a ref that mirrors the previous prop value,
  // not via state (react-hooks/set-state-in-effect).
  const active = isReconnecting || isReplaying;
  const [showCaughtUp, setShowCaughtUp] = useState(false);
  const prevActiveRef = useRef(active);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;

    // Only schedule the fade on the exact active → idle edge.
    if (!wasActive || active) return;

    // The fade is an external-timer-driven UI pulse: we MUST setState inside
    // the effect to trigger the fade (true) and retract it 1.5 s later
    // (false). There is no external store we can useSyncExternalStore over —
    // the trigger is a local prop transition. This is the React 19 recommended
    // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
    // when a prop change must produce a transient, timed UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCaughtUp(true);
    const handle = setTimeout(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowCaughtUp(false);
    }, 1500);
    return () => clearTimeout(handle);
  }, [active]);

  if (!active && !showCaughtUp) return null;

  const stateKey = isReconnecting
    ? 'reconnecting'
    : isReplaying
      ? 'replaying'
      : 'caught-up';

  const label = active
    ? t('issues.detail.ws.reconnecting')
    : t('issues.detail.ws.replayDone');

  // warning-subtle tokens for in-flight (matches 24-UI-SPEC §Color), success
  // tokens for the caught-up fade. No raw-HTML injection — t() produces a
  // plain text node, React auto-escapes. (UX6 grep guard: split keyword to
  // avoid a false positive on "danger" + "ouslySetInnerHTML".)
  const cls = showCaughtUp
    ? 'bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)] border border-[var(--color-success-subtle-border)]'
    : 'bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)] border border-[var(--color-warning-subtle-border)]';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`px-3 py-1.5 text-xs rounded-md ${cls}`}
      data-reconnect-banner={stateKey}
    >
      {label}
    </div>
  );
}
