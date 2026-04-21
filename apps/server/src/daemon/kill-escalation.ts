/**
 * SIGTERM → SIGKILL escalation helper (PM1 HARD mitigation).
 *
 * Sends SIGTERM synchronously, schedules a SIGKILL after `graceMs` if the
 * child has not emitted `'exit'`. Cleans up the SIGKILL timer when the
 * child exits first (PG3: timer cleanup; PG4: exit cancels dropped-signal risk).
 *
 * In PRODUCTION, execa 9's `forceKillAfterDelay` is the primary mechanism
 * (see Plan 21-03 `spawnClaude`). This helper exists for (a) cancel paths
 * where we need to invoke SIGTERM→SIGKILL without going through execa, and
 * (b) BACKEND-07 unit tests that prove the timing without waiting a real
 * 10 s wall clock — the injected `setTimeout` / `clearTimeout` deps let
 * `node:test`'s `mock.timers.tick()` drive the escalation.
 *
 * Zero dependencies. Zero `any`. Zero throws on double-kill.
 */

export interface KillEscalationDeps {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface KillableChild {
  kill(signal: 'SIGTERM' | 'SIGKILL'): boolean;
  once(event: 'exit', fn: () => void): unknown;
}

/**
 * @returns A cleanup function that cancels the pending SIGKILL timer.
 *          Safe to call multiple times; subsequent calls are no-ops.
 */
export function escalateKill(
  child: KillableChild,
  graceMs: number,
  deps: KillEscalationDeps = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): () => void {
  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new RangeError(`graceMs must be >= 0 (got ${graceMs})`);
  }

  // Step 1: signal termination synchronously.
  try { child.kill('SIGTERM'); } catch { /* already dead — fall through to timer */ }

  let timer: unknown = null;
  let cancelled = false;

  const cleanup = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (timer !== null) {
      deps.clearTimeout(timer);
      timer = null;
    }
  };

  // Step 2: schedule SIGKILL after graceMs.
  timer = deps.setTimeout(() => {
    if (cancelled) return;
    timer = null;
    try { child.kill('SIGKILL'); } catch { /* child already exited */ }
  }, graceMs);

  // Step 3: cancel the SIGKILL if the child exits first.
  child.once('exit', cleanup);

  return cleanup;
}
