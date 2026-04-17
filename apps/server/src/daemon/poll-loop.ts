/**
 * Multi-runtime poll loop (CLI-04 — bounded concurrency, PG1 HARD).
 *
 * For each online runtime, loops forever:
 *   1. Wait for a semaphore slot (bounds concurrent task executions).
 *      — PG1 HARD: `await semaphore.acquire()` BEFORE the `claimTask` HTTP call
 *      so we never claim a task we can't run. Slot released in the task's
 *      `finally` (success, failure, or throw).
 *   2. Claim a task from that runtime's queue.
 *   3. If task present → fire-and-forget `runTask(task).finally(release)`.
 *      If task absent → release the slot immediately, sleep `pollIntervalMs`,
 *      retry.
 *
 * Mitigations:
 *   • PG1 — `await semaphore.acquire()` BEFORE every fire-and-forget runTask.
 *   • PG2 — per-tick try/catch wraps `claimTask` AND `runTask`; errors logged
 *     via `onError`; the loop continues so a single HTTP hiccup never kills
 *     the daemon.
 *   • PG5 — `shutdownSignal.aborted` checked at every loop top AND after the
 *     semaphore acquires (so a concurrent shutdown releases pending waiters
 *     and exits without dispatching stale claims).
 *   • PG6 — separate `runPerRuntimeLoop` per runtime so a slow claim on
 *     runtime-A does NOT block runtime-B's polls (avoids the multica
 *     `for range` sequential-await bug).
 */

import type { Semaphore } from './semaphore.js';
import type { DaemonHttpClient } from './http-client.js';
import type { ClaimedTask, Runtime } from '@aquarium/shared';

export interface PollLoopOpts {
  runtimes: Array<Pick<Runtime, 'id'>>;
  httpClient: Pick<DaemonHttpClient, 'claimTask'>;
  semaphore: Semaphore;
  pollIntervalMs: number;
  shutdownSignal: AbortSignal;
  runTask: (task: ClaimedTask) => Promise<void>;
  onError?: (err: unknown, where: string) => void;
  _setTimeout?: (fn: () => void, ms: number) => unknown;
}

export function startPollLoop(opts: PollLoopOpts): Promise<void[]> {
  const perRuntime = opts.runtimes.map((rt) => runPerRuntimeLoop(rt.id, opts));
  return Promise.all(perRuntime);
}

async function runPerRuntimeLoop(runtimeId: string, opts: PollLoopOpts): Promise<void> {
  const setTimeoutFn = opts._setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeoutFn(() => resolve(), ms);
    });

  while (!opts.shutdownSignal.aborted) {
    // PG1 — acquire BEFORE claim so we never claim a task we can't run.
    const release = await opts.semaphore.acquire();
    if (opts.shutdownSignal.aborted) { release(); break; }

    let task: ClaimedTask | null = null;
    try {
      const r = await opts.httpClient.claimTask(runtimeId);
      task = r.task;
    } catch (err) {
      // PG2 — claim error: release the slot, log, sleep, retry.
      release();
      try { opts.onError?.(err, `claim:${runtimeId}`); } catch { /* ignore */ }
      if (!opts.shutdownSignal.aborted) await sleep(opts.pollIntervalMs);
      continue;
    }

    if (!task) {
      release();
      if (!opts.shutdownSignal.aborted) await sleep(opts.pollIntervalMs);
      continue;
    }

    // Fire-and-forget — the semaphore is the backpressure.
    const running = task;
    void opts.runTask(running)
      .catch((err: unknown) => {
        try { opts.onError?.(err, `runTask:${running.id}`); } catch { /* ignore */ }
      })
      .finally(release);
  }
}
