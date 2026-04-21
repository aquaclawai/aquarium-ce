/**
 * NDJSON line-framed JSON parser for agent-backend stdout streams.
 *
 * Pitfall mitigations (HARD):
 *   • PG7 — `for await (const line of rl)` (never `rl.on('line', asyncFn)`)
 *   • PG8 — `for await` naturally backpressures the child stdout pipe
 *   • PG9 — `stream.setEncoding('utf8')` attaches a stateful decoder so
 *           multi-byte UTF-8 boundaries split across chunks are handled
 *   • PG10 — per-line `try { JSON.parse } catch { continue }` — malformed
 *            lines are dropped, counter feeds `onParseError`
 *
 * Inactivity watchdog (BACKEND-06): fires `onInactive` if no line arrives
 * within `inactivityMs` (default 60 000). Callers invoke kill-escalation
 * from the handler. Timer is `.unref()`'d so it never blocks process exit.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export interface ParseNdjsonOpts<T> {
  /** Optional narrowing type guard; non-matching values are skipped (no error). */
  isValid?: (msg: unknown) => msg is T;
  /** Called once per malformed line. Default: silent drop. */
  onParseError?: (line: string, err: Error) => void;
  /** Silence watchdog in ms. 0 disables. Default 60_000. */
  inactivityMs?: number;
  /** Invoked when `inactivityMs` elapses without a new line. */
  onInactive?: () => void;
}

/**
 * Async generator that yields one parsed JSON value per line of the input
 * stream. Consumes via `for await` so the child stdout is naturally
 * backpressured. Never throws on malformed input.
 */
export async function* parseNdjson<T = unknown>(
  stream: Readable,
  opts: ParseNdjsonOpts<T> = {},
): AsyncGenerator<T, void, void> {
  const inactivityMs = opts.inactivityMs ?? 60_000;
  // PG9 mitigation: stateful UTF-8 decoder.
  stream.setEncoding('utf8');
  // PG7 mitigation: readline with crlfDelay: Infinity.
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let watchdog: NodeJS.Timeout | null = null;
  let watchdogFired = false;

  const clearWatchdog = (): void => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const resetWatchdog = (): void => {
    clearWatchdog();
    if (inactivityMs > 0 && opts.onInactive && !watchdogFired) {
      watchdog = setTimeout(() => {
        watchdogFired = true;
        watchdog = null;
        try { opts.onInactive?.(); } catch { /* host handles own errors */ }
      }, inactivityMs);
      // Do NOT block event-loop exit on the watchdog itself.
      watchdog.unref();
    }
  };

  resetWatchdog();

  try {
    for await (const line of rl) {
      resetWatchdog();
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        opts.onParseError?.(trimmed, err instanceof Error ? err : new Error(String(err)));
        continue;
      }
      if (opts.isValid && !opts.isValid(parsed)) continue;
      yield parsed as T;
    }
  } finally {
    clearWatchdog();
    rl.close();
  }
}
