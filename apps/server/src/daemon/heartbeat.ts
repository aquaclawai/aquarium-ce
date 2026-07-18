/**
 * Daemon heartbeat loop (Phase 16 offline-sweep threshold is 90 s).
 *
 * Pings `POST /api/daemon/heartbeat` every `intervalMs` (default 15 s,
 * 6× margin under the 90 s offline threshold) with all registered
 * `runtimeIds` in ONE request body — avoids per-runtime sequential POST
 * bug that multica's `for range` pattern hits.
 *
 * Mitigations:
 *   • PG2 — per-tick try/catch; errors logged via `onError`; loop continues.
 *     401 on a revoked token does NOT crash the daemon here — the crash
 *     handler / main owns daemon-wide death on repeated auth failures.
 *   • PG6 — single HTTP request covers all runtime IDs; no `await` inside a
 *     `for` across runtimes.
 *   • Timer is `.unref()`'d so it never pins process exit.
 *
 * @returns cleanup fn that stops the interval (idempotent).
 */

import type { DaemonHttpClient } from './http-client.js';

export interface HeartbeatLoopOpts {
  runtimeIds: string[];
  httpClient: Pick<DaemonHttpClient, 'heartbeat'>;
  intervalMs: number;
  shutdownSignal: AbortSignal;
  onError?: (err: unknown) => void;
  _setInterval?: (fn: () => void, ms: number) => unknown;
  _clearInterval?: (h: unknown) => void;
}

export function startHeartbeatLoop(opts: HeartbeatLoopOpts): () => void {
  const setIv = opts._setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIv =
    opts._clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));

  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || opts.shutdownSignal.aborted) return;
    try {
      await opts.httpClient.heartbeat(opts.runtimeIds);
    } catch (err) {
      // PG2 — never propagate.
      try { opts.onError?.(err); } catch { /* ignore */ }
    }
  };

  const handle = setIv(() => { void tick(); }, opts.intervalMs);
  try { (handle as { unref?: () => void })?.unref?.(); } catch { /* ignore */ }

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    clearIv(handle);
  };
  opts.shutdownSignal.addEventListener('abort', cleanup);
  return cleanup;
}
