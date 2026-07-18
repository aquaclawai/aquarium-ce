/**
 * Daemon crash handler + graceful shutdown (CLI-05 / PG2).
 *
 * Ordering (per §21-RESEARCH §Crash Handling):
 *   1. Synchronous `appendFileSync` to `~/.aquarium/daemon.crash.log` —
 *      attempted FIRST so an audit trail lives on disk even if the HTTP
 *      calls below hang.
 *   2. Best-effort `httpClient.failTask` for each in-flight task, capped at
 *      `failTaskTimeoutMs` (default 2000 ms) TOTAL across all tasks. A hung
 *      call on one task never blocks exit beyond the cap.
 *   3. `process.exit(1)` via the injected `_exit` seam.
 *
 * Mitigations:
 *   • PG2 — never throws; every await is try/catch'd.
 *   • T-21-13 — orphan tasks get a best-effort `failTask` so the server's
 *     reaper has less work to do.
 *
 * Graceful shutdown ordering:
 *   1. abort the shutdown AbortController → all per-task / per-loop signals
 *      cascade-abort via opts.signal.addEventListener('abort', ...).
 *   2. await `inFlightDone()` up to `gracefulShutdownMs`.
 *   3. best-effort `deregister(runtimeIds)` so the server marks this daemon
 *      offline immediately instead of waiting for the 90 s heartbeat window.
 *   4. `process.exit(0)` via injected `_exit` seam.
 */

import { appendFileSync } from 'node:fs';
import type { DaemonHttpClient } from './http-client.js';

export function errorToString(err: unknown): string {
  if (err === null) return 'null';
  if (err === undefined) return 'undefined';
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack ?? ''}`.trim();
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export interface InFlightRecord {
  taskId: string;
  workspaceId: string;
}

export interface HandleFatalOpts {
  err: unknown;
  source: 'unhandledRejection' | 'uncaughtException' | 'manual';
  crashLogPath: string;
  inFlight: Iterable<InFlightRecord>;
  httpClient: Pick<DaemonHttpClient, 'failTask'>;
  failTaskTimeoutMs?: number;
  /** Test seams */
  _appendFileSync?: typeof appendFileSync;
  _exit?: (code: number) => void;
}

export async function handleFatal(opts: HandleFatalOpts): Promise<void> {
  const appendFn = opts._appendFileSync ?? appendFileSync;
  const exitFn = opts._exit ?? ((code: number) => process.exit(code));
  const cap = opts.failTaskTimeoutMs ?? 2_000;

  // Step 1 — crash log.
  const line = `${new Date().toISOString()}\t${opts.source}\t${errorToString(opts.err)}\n`;
  try {
    appendFn(opts.crashLogPath, line);
  } catch (e) {
    try { process.stderr.write(`crash log write failed: ${String(e)}\n`); } catch { /* ignore */ }
  }

  // Step 2 — best-effort failTask for each in-flight task, with total cap.
  const tasks = Array.from(opts.inFlight);
  const attempts = tasks.map(async (t) => {
    try {
      await opts.httpClient.failTask(t.taskId, `daemon ${opts.source}`);
    } catch {
      // Best-effort — swallow.
    }
  });
  // NOTE: do NOT `.unref()` the cap timer — handleFatal runs in the fatal
  // path; a pinned event loop for up to `cap` ms (default 2000) is fine and
  // avoids a node:test quirk where unref'd timers inside a test-awaited
  // promise race look like "pending" handles to the test runner.
  let capHandle: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    Promise.allSettled(attempts).then(() => { /* clear cap race below */ }),
    new Promise<void>((resolve) => {
      capHandle = setTimeout(resolve, cap);
    }),
  ]);
  if (capHandle !== null) clearTimeout(capHandle);

  // Step 3 — exit.
  exitFn(1);
}

export interface GracefulShutdownOpts {
  shutdownAc: AbortController;
  inFlightDone: () => Promise<void>;
  gracefulShutdownMs: number;
  runtimeIds: string[];
  httpClient: Pick<DaemonHttpClient, 'deregister'>;
  _exit?: (code: number) => void;
}

export async function gracefulShutdown(opts: GracefulShutdownOpts): Promise<void> {
  opts.shutdownAc.abort();
  // NOTE: no `.unref()` — see handleFatal comment. The cap (`gracefulShutdownMs`)
  // is bounded and the loop unwinds deterministically through the timer.
  let capHandle: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    opts.inFlightDone(),
    new Promise<void>((resolve) => {
      capHandle = setTimeout(resolve, opts.gracefulShutdownMs);
    }),
  ]);
  if (capHandle !== null) clearTimeout(capHandle);
  try {
    await opts.httpClient.deregister(opts.runtimeIds);
  } catch {
    // best effort
  }
  (opts._exit ?? ((c: number) => process.exit(c)))(0);
}

export interface RegisterProcessHandlersOpts {
  onFatal: (err: unknown, source: 'unhandledRejection' | 'uncaughtException') => Promise<void>;
  onSignal: (signal: 'SIGTERM' | 'SIGINT') => Promise<void>;
}

export function registerProcessHandlers(opts: RegisterProcessHandlersOpts): () => void {
  const onRejection = (err: unknown): void => { void opts.onFatal(err, 'unhandledRejection'); };
  const onException = (err: unknown): void => { void opts.onFatal(err, 'uncaughtException'); };
  const onTerm = (): void => { void opts.onSignal('SIGTERM'); };
  const onInt = (): void => { void opts.onSignal('SIGINT'); };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  return () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
  };
}
