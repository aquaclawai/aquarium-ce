/**
 * Per-task message batcher for the daemon HTTP path.
 *
 * Ships `PendingTaskMessageWire` items to `/api/daemon/tasks/:id/messages`
 * via the DaemonHttpClient. Flushes on:
 *   • `flushIntervalMs` (default 500 ms) timer.
 *   • `maxBatchItems` (default 100) reached.
 *   • `maxBatchBytes` (default 64 KB) reached.
 *   • `flushNow()` — awaited drain (used by runClaudeTask end-of-task).
 *   • `stop()` — final drain + interval cleared.
 *
 * Mitigations:
 *   • PG4 (dropped-channel-full semantics): on `postMessages` failure, the
 *     batch is RE-PREPENDED to the buffer so the next flush retries.
 *     `onFlushError` is called for observability but the daemon never drops.
 *   • PG3 (timer leak): `stop()` clears the interval + awaits the final flush.
 *   • PG5 (AbortSignal thread-through): signal → stop() cascade.
 *   • PG6 (await-in-loop discipline): flushes run SEQUENTIALLY per task — the
 *     in-flight POST must resolve before the next batch is sent. Never wrap in
 *     Promise.all across batches (server-side MAX(seq)+1 requires sequencing).
 *
 * Shape matches the server-side `/api/daemon/tasks/:id/messages` contract:
 *   batch cap 100 OR 64 KB (whichever triggers first) — Phase 19 Plan 2.
 */

import type { DaemonHttpClient, PendingTaskMessageWire } from './http-client.js';

export interface StreamBatcherOpts {
  taskId: string;
  httpClient: Pick<DaemonHttpClient, 'postMessages'>;
  flushIntervalMs: number;    // default 500 from DaemonConfig.messageFlushIntervalMs
  maxBatchItems?: number;     // default 100
  maxBatchBytes?: number;     // default 64 * 1024
  signal?: AbortSignal;
  onFlushError?: (err: unknown, batch: PendingTaskMessageWire[]) => void;
  /** Test seams */
  _setInterval?: (fn: () => void, ms: number) => unknown;
  _clearInterval?: (h: unknown) => void;
}

type FlushReason = 'interval' | 'cap' | 'manual' | 'stop';

export class StreamBatcher {
  private buffer: PendingTaskMessageWire[] = [];
  private bufferBytes = 0;
  private inflight = false;
  private stopped = false;
  private readonly timer: unknown;
  private readonly clearFn: (h: unknown) => void;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly opts: StreamBatcherOpts) {
    const setIv = opts._setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.clearFn = opts._clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
    this.timer = setIv(() => { void this.flushInternal('interval'); }, opts.flushIntervalMs);
    // Don't block process exit on the interval.
    try { (this.timer as { unref?: () => void })?.unref?.(); } catch { /* test seam may not have unref */ }
    // Stop on abort (PG5).
    opts.signal?.addEventListener('abort', () => { void this.stop(); });
  }

  push(msg: PendingTaskMessageWire): void {
    if (this.stopped) throw new Error('StreamBatcher: push after stop');
    this.buffer.push(msg);
    // Approximate byte count — JSON.stringify overhead is acceptable for capping.
    this.bufferBytes += JSON.stringify(msg).length;
    const maxItems = this.opts.maxBatchItems ?? 100;
    const maxBytes = this.opts.maxBatchBytes ?? 64 * 1024;
    if (this.buffer.length >= maxItems || this.bufferBytes >= maxBytes) {
      void this.flushInternal('cap');
    }
  }

  async flushNow(): Promise<void> {
    await this.flushInternal('manual');
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearFn(this.timer);
    await this.flushInternal('stop');
  }

  stats(): { buffered: number; bufferBytes: number; inflight: boolean; stopped: boolean } {
    return {
      buffered: this.buffer.length,
      bufferBytes: this.bufferBytes,
      inflight: this.inflight,
      stopped: this.stopped,
    };
  }

  private flushInternal(_reason: FlushReason): Promise<void> {
    if (this.inflight || this.buffer.length === 0) return this.pending;
    this.inflight = true;
    const batch = this.buffer;
    this.buffer = [];
    this.bufferBytes = 0;
    this.pending = this.opts.httpClient.postMessages(this.opts.taskId, batch)
      .then(() => { /* success */ })
      .catch((err: unknown) => {
        // PG4 — do NOT drop the batch. Re-prepend for next flush.
        this.buffer = batch.concat(this.buffer);
        this.bufferBytes = this.buffer.reduce((n, m) => n + JSON.stringify(m).length, 0);
        try { this.opts.onFlushError?.(err, batch); } catch { /* host logs */ }
      })
      .finally(() => { this.inflight = false; });
    return this.pending;
  }
}
