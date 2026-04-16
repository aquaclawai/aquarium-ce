import { db } from '../db/index.js';

/**
 * Offline sweeper — transitions daemon runtimes to `status='offline'` when
 * their last_heartbeat_at is older than HEARTBEAT_WINDOW_MS.
 *
 * Scope (Phase 16, RT-05):
 *   • Only affects runtimes where `kind IN ('local_daemon','external_cloud_daemon')`.
 *     Hosted-mirror rows are NEVER touched (ST1 HARD: instance-derived status is
 *     computed at read time via LEFT JOIN in runtime-registry.listAll).
 *   • Runs every SWEEP_INTERVAL_MS. First sweep fires immediately on start.
 *   • Standalone module (not merged into health-monitor) — see 16-RESEARCH
 *     §"Why NOT extend health-monitor.ts" for rationale.
 */

const HEARTBEAT_WINDOW_MS = 90_000;
const SWEEP_INTERVAL_MS = 30_000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;

async function sweepOnce(): Promise<number> {
  const cutoffIso = new Date(Date.now() - HEARTBEAT_WINDOW_MS).toISOString();

  // Batched UPDATE: transitions ALL stale daemon runtimes in a single round-trip.
  // The whereIn('kind', [...daemon kinds]) clause is the ST1 guard — hosted-mirror
  // rows cannot be flipped by this sweeper even by accident.
  const affected = await db('runtimes')
    .whereIn('kind', ['local_daemon', 'external_cloud_daemon'])
    .where('status', 'online')
    .where((qb) => {
      qb.where('last_heartbeat_at', '<', cutoffIso)
        .orWhereNull('last_heartbeat_at');
    })
    .update({
      status: 'offline',
      updated_at: db.fn.now(),
    });

  if (affected > 0) {
    console.log(`[offline-sweeper] marked ${affected} daemon runtime(s) offline`);
  }

  return affected;
}

/**
 * Start the offline sweeper. Idempotent — safe to call multiple times (returns
 * immediately if already running).
 */
export function startRuntimeOfflineSweeper(): void {
  if (sweepInterval) return;

  // Initial sweep — do not wait 30s before first pass on a cold server.
  sweepOnce().catch((err) => {
    console.warn('[offline-sweeper] initial sweep failed:', err instanceof Error ? err.message : String(err));
  });

  sweepInterval = setInterval(() => {
    sweepOnce().catch((err) => {
      console.warn('[offline-sweeper] sweep failed:', err instanceof Error ? err.message : String(err));
    });
  }, SWEEP_INTERVAL_MS);

  console.log('[offline-sweeper] started (90s heartbeat window, 30s sweep interval)');
}

/** Stop the sweeper — used by tests and graceful shutdown. */
export function stopRuntimeOfflineSweeper(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log('[offline-sweeper] stopped');
  }
}
