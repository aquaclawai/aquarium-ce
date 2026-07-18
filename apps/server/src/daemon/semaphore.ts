/**
 * Bounded async semaphore with FIFO waiter ordering.
 *
 * Used by the daemon poll loop (Plan 21-03) to cap concurrent task
 * executions at `DaemonConfig.maxConcurrentTasks` (default 10).
 * Mitigation: PG1 (unbounded goroutine-leak equivalent in Node).
 *
 * Contract:
 *   • `acquire()` resolves with a one-shot `release` function.
 *   • Caller MUST call `release()` exactly once, typically in `finally`.
 *   • Waiters are served in FIFO order. First-queued first-resolved.
 *   • `stats()` is observability-only (debug logs).
 *
 * Design notes:
 *   • No third-party dep (p-limit rejected per RESEARCH §Bounded Semaphore)
 *     BECAUSE BACKEND-07 requires a unit-testable acquire/release ordering.
 *   • Waiter queue is a plain array used FIFO (`push` enqueue, `shift` dequeue).
 *     For the expected waiter counts (< 100) this is O(1) amortised in V8.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`Semaphore max must be an integer >= 1 (got ${max})`);
    }
    this.available = max;
  }

  /**
   * Acquire a slot. Resolves with a one-shot `release` function.
   * If no slot is available, the promise waits until another caller releases.
   */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return this.makeOneShotRelease();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(this.makeOneShotRelease()));
    });
  }

  stats(): { available: number; waiters: number; max: number } {
    return { available: this.available, waiters: this.waiters.length, max: this.max };
  }

  private makeOneShotRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent double-release is a no-op (defensive)
      released = true;
      const next = this.waiters.shift();
      if (next) {
        // Transfer slot directly to next waiter — do NOT bump `available`.
        next();
      } else {
        this.available++;
      }
    };
  }
}
