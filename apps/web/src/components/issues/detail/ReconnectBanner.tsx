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
  // caughtUpUntil holds a timestamp the "Caught up" state expires at — we
  // poll Date.now() on render (coarse) and set a timeout to force a re-render
  // at the exact millisecond we need to unmount.
  const [caughtUpUntil, setCaughtUpUntil] = useState(0);
  const prevActiveRef = useRef(isReconnecting || isReplaying);

  // Detect the transition active → idle. On that exact edge we light up the
  // 1.5 s "Caught up" fade. Subsequent renders with !active + stale
  // caughtUpUntil won't re-trigger because prevActiveRef now reflects idle.
  useEffect(() => {
    const active = isReconnecting || isReplaying;
    if (prevActiveRef.current && !active) {
      setCaughtUpUntil(Date.now() + 1500);
    }
    prevActiveRef.current = active;
  }, [isReconnecting, isReplaying]);

  // Drive a re-render when the caught-up window expires so the banner unmounts.
  useEffect(() => {
    if (caughtUpUntil === 0) return;
    const remaining = caughtUpUntil - Date.now();
    if (remaining <= 0) return;
    const handle = setTimeout(() => setCaughtUpUntil(0), remaining);
    return () => clearTimeout(handle);
  }, [caughtUpUntil]);

  const active = isReconnecting || isReplaying;
  const showCaughtUp = !active && caughtUpUntil > Date.now();

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
