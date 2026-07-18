/**
 * Phase 25 management UI — relative-time helper shared across the three
 * management pages (Agents / Runtimes / Daemon Tokens).
 *
 * Returns locale-aware relative-time strings using `Intl.RelativeTimeFormat`
 * when available, falling back to a small English-only formatter if the
 * runtime lacks Intl support (older browsers; CI shouldn't hit this but the
 * fallback keeps the helper pure).
 *
 *   formatRelativeTime(null, locale)             // → 'Never'
 *   formatRelativeTime('<5s ago>', locale)       // → 'Just now'
 *   formatRelativeTime('<2m ago>', locale)       // → '2m ago'
 *   formatRelativeTime('<3h ago>', locale)       // → '3h ago'
 *   formatRelativeTime('<6d ago>', locale)       // → '6d ago'
 *
 * Never throws — malformed ISO strings return the "Just now" bucket rather
 * than cascading a runtime error into a table row render.
 */

export interface FormatRelativeTimeOptions {
  /** ISO timestamp or null (→ 'Never'). */
  ts: string | null;
  /** BCP-47 locale (react-i18next `i18n.resolvedLanguage`). */
  locale: string;
  /** Localized 'Never' label; required so callers pass the i18n-translated string. */
  neverLabel: string;
  /** Localized 'Just now' label. */
  justNowLabel: string;
}

/**
 * Format an ISO timestamp as a short relative-time string. See examples in the
 * module docstring. Callers MUST pass the localized `neverLabel` + `justNowLabel`
 * (we don't have access to the t() function here).
 */
export function formatRelativeTime(opts: FormatRelativeTimeOptions): string {
  const { ts, locale, neverLabel, justNowLabel } = opts;
  if (!ts) return neverLabel;
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return justNowLabel;
  const deltaMs = Date.now() - then;
  const deltaSec = Math.floor(deltaMs / 1000);

  if (deltaSec < 60) return justNowLabel;

  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return formatUnit(deltaMin, 'minute', locale);

  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return formatUnit(deltaHr, 'hour', locale);

  const deltaDay = Math.floor(deltaHr / 24);
  return formatUnit(deltaDay, 'day', locale);
}

/**
 * Format an absolute ISO timestamp (for Tooltip content). Uses the user's
 * browser locale to render date + time. Falls back to raw ISO on parse failure.
 */
export function formatAbsoluteTime(ts: string | null, locale: string): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return ts;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatUnit(n: number, unit: 'minute' | 'hour' | 'day', locale: string): string {
  // We use the `narrow` style so values render as "2m ago" / "3h ago" / "6d ago"
  // in English. For non-English locales `Intl.RelativeTimeFormat` produces the
  // locale-appropriate short form (e.g. "il y a 2 min" in fr).
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });
    return rtf.format(-n, unit);
  } catch {
    // Fallback — English only.
    const short = unit === 'minute' ? 'm' : unit === 'hour' ? 'h' : 'd';
    return `${n}${short} ago`;
  }
}
