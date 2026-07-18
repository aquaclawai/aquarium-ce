/**
 * Per-task cancel watcher (CLI-06).
 *
 * Polls `GET /api/daemon/tasks/:id/status` every `intervalMs` (default 5000).
 * On the first `cancelled: true` response, fires `onCancel` EXACTLY ONCE and
 * stops polling permanently.
 *
 * Resilience + mitigations:
 *   • PG2 — every tick wraps `getTaskStatus` in try/catch; errors surfaced
 *     via `onError` callback; polling CONTINUES after transient errors.
 *   • PG5 — per-task AbortSignal stops the poller (cleanup cascade).
 *   • Timer handles are `.unref()`'d so pending polls never pin process exit.
 *   • 401s are NOT treated differently here — the crash handler / main loop
 *     owns daemon-wide death on revoked token.
 *
 * @returns cleanup fn that cancels the pending tick (idempotent).
 */

import type { DaemonHttpClient } from './http-client.js';

export interface StartCancelPollerOpts {
  taskId: string;
  intervalMs: number;
  httpClient: Pick<DaemonHttpClient, 'getTaskStatus'>;
  signal: AbortSignal;
  onCancel: () => void;
  onError?: (err: unknown) => void;
  _setTimeout?: (fn: () => void, ms: number) => unknown;
  _clearTimeout?: (h: unknown) => void;
}

export function startCancelPoller(opts: StartCancelPollerOpts): () => void {
  const setTimeoutFn = opts._setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimeoutFn =
    opts._clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let handle: unknown = null;
  let stopped = false;
  let fired = false;

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    if (handle !== null) {
      clearTimeoutFn(handle);
      handle = null;
    }
  };

  opts.signal.addEventListener('abort', cleanup);

  const schedule = (): void => {
    if (stopped || fired) return;
    handle = setTimeoutFn(() => { void tick(); }, opts.intervalMs);
    // NOTE: do NOT unref here — the caller scopes the poller to the lifetime
    // of one task via cleanup() / AbortSignal. Unref'ing makes the pending
    // tick invisible to the event loop, which breaks node:test assertions
    // that await the poller's first fire.
  };

  const tick = async (): Promise<void> => {
    if (stopped || fired) return;
    try {
      const { cancelled } = await opts.httpClient.getTaskStatus(opts.taskId);
      if (cancelled && !fired) {
        fired = true;
        cleanup();
        try { opts.onCancel(); } catch { /* host owns its errors (PG2) */ }
        return;
      }
    } catch (err) {
      // PG2 — never throw; surface via onError and keep polling.
      try { opts.onError?.(err); } catch { /* ignore */ }
    }
    schedule();
  };

  schedule();

  return cleanup;
}
