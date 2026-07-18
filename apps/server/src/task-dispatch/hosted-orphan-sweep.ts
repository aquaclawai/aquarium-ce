import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';

/**
 * Boot-time orphan sweep for hosted-instance tasks — Phase 20, HOSTED-04.
 *
 * Scope:
 *   • SELECT agent_task_queue rows WHERE status IN ('dispatched','running')
 *     AND runtime.kind='hosted_instance' (JOIN on runtimes).
 *   • UPDATE those rows to status='failed', error='hosted-orphan-on-boot',
 *     completed_at=now, updated_at=now (with ST6 race guard re-applying the
 *     status filter so a concurrent legitimate transition is not clobbered).
 *   • Fire task:failed WS broadcasts for EVERY row returned by the SELECT
 *     (see "ST6 benign over-broadcast" note below).
 *
 * Ordering (server-core.ts):
 *   Step 9a runtimeBridgeReconcile  — EXISTING (Phase 16)
 *   Step 9b failOrphanedHostedTasks — THIS FILE (before task-reaper)
 *   Step 9c startTaskReaper         — EXISTING (Phase 18)
 *   Step 9d startHostedTaskWorker   — Phase 20-02 (after task-reaper)
 *   Step 9e startRuntimeOfflineSweeper — EXISTING (Phase 16)
 *
 * Why BEFORE 9c: task-reaper's generic "Reaper: dispatched > 5 min" error
 * would overwrite the correct 'hosted-orphan-on-boot' reason HOSTED-04
 * requires if 9c ran first (after the 5-min threshold).
 *
 * ST6 race guard (matches task-reaper.ts:84/96): the UPDATE re-applies
 * `whereIn('status', ['dispatched','running'])` so a concurrent legitimate
 * transition (daemon completing a task in the 1ms between SELECT and UPDATE)
 * cannot be clobbered. Under server-core Step 9b this race is effectively
 * impossible (HTTP not yet listening), but the guard is cheap.
 *
 * ST6 benign over-broadcast: if a row is returned by the SELECT but its
 * status transitioned between SELECT and UPDATE (so the UPDATE guard skipped
 * it), we still emit a `task:failed` broadcast for that row's taskId. This
 * is acceptable because at boot time NO WS CLIENTS ARE CONNECTED (server is
 * still in the startup sequence before HTTP.listen). The extra event is
 * dropped by the empty client map in broadcast(). A more correct alternative
 * would be to re-SELECT after UPDATE (or use RETURNING if the Knex SQLite
 * driver supports it), but the extra round trip isn't worth the complexity
 * for a benign failure mode.
 *
 * Why broadcast per SELECT row rather than filter-by-index: `filter((_, idx)
 * => idx < failed)` would filter by position, NOT row identity — there is no
 * guaranteed relationship between a row's position in the SELECT result
 * array and whether the UPDATE guard actually transitioned it. See Blocker 3
 * in 20-03-PLAN.md.
 *
 * Daemon tasks are NOT touched: the join filter `r.kind='hosted_instance'`
 * excludes local_daemon and external_cloud_daemon rows.
 *
 * Idempotent: running the sweep twice in succession flips the same zero rows
 * the second time (the first UPDATE moved them all to 'failed' which the
 * SELECT status filter excludes).
 */

// Module-level broadcast binding — tests swap this in to count invocations
// without standing up a real WS server. Declared BEFORE failOrphanedHostedTasks
// so the function captures the mutable binding at call time (not at module
// init), allowing __setBroadcastForTests__ to take effect.
let activeBroadcast: typeof broadcast = broadcast;

/**
 * Test-only hook: swap the broadcast function. Reset with
 * __resetBroadcastForTests__ in afterEach to avoid cross-test leakage.
 */
export function __setBroadcastForTests__(fn: typeof broadcast): void {
  activeBroadcast = fn;
}

export function __resetBroadcastForTests__(): void {
  activeBroadcast = broadcast;
}

// Test-only hook: callback invoked BETWEEN the SELECT and UPDATE inside
// failOrphanedHostedTasks. Used by Test 3 to simulate the ST6 race where a
// concurrent legitimate writer transitions a SELECTed row before the UPDATE
// guard evaluates. Production code never sets this; it stays null so the
// tick path has zero overhead.
let betweenSelectAndUpdateHook: ((kx: Knex) => Promise<void>) | null = null;

export function __setBetweenSelectAndUpdateHookForTests__(fn: ((kx: Knex) => Promise<void>) | null): void {
  betweenSelectAndUpdateHook = fn;
}

export function __resetBetweenSelectAndUpdateHookForTests__(): void {
  betweenSelectAndUpdateHook = null;
}

export interface OrphanSweepResult {
  failed: number;
  rows: Array<{ taskId: string; issueId: string; workspaceId: string }>;
}

export async function failOrphanedHostedTasks(dbOverride?: Knex): Promise<OrphanSweepResult> {
  const kx = dbOverride ?? defaultDb;
  const nowIso = new Date().toISOString();

  // SELECT candidate rows first so we can broadcast per-row after UPDATE.
  const rows = (await kx('agent_task_queue as q')
    .join('runtimes as r', 'r.id', 'q.runtime_id')
    .where('r.kind', 'hosted_instance')
    .whereIn('q.status', ['dispatched', 'running'])
    .select('q.id', 'q.issue_id', 'q.workspace_id', 'q.status')) as Array<{
      id: string;
      issue_id: string;
      workspace_id: string;
      status: 'dispatched' | 'running';
    }>;

  if (rows.length === 0) return { failed: 0, rows: [] };

  const ids = rows.map((r) => r.id);

  // Test-only: simulate ST6 race by allowing a concurrent writer to mutate
  // row state between the SELECT above and the UPDATE below. Production code
  // never sets this hook, so the call is a no-op at zero cost.
  if (betweenSelectAndUpdateHook) {
    await betweenSelectAndUpdateHook(kx);
  }

  // ST6 race guard — re-apply status filter on UPDATE. Matches the pattern
  // in task-reaper.ts (lines 84/96). Single-statement UPDATE autocommits
  // before returning (SQ5: no I/O in txn).
  const failed = await kx('agent_task_queue')
    .whereIn('id', ids)
    .whereIn('status', ['dispatched', 'running'])
    .update({
      status: 'failed',
      error: 'hosted-orphan-on-boot',
      completed_at: nowIso,
      updated_at: nowIso,
    });

  // Broadcast AFTER commit — iterate the SELECT result directly (NOT a
  // filter-by-index subset). In the ST6 race case where a row transitioned
  // concurrently between SELECT and UPDATE, we still emit a task:failed
  // broadcast for that row. This is benign at boot time: no WS clients are
  // connected because HTTP has not yet started listening.
  const reapedRows = rows.map((r) => ({
    taskId: r.id,
    issueId: r.issue_id,
    workspaceId: r.workspace_id,
  }));

  for (const r of reapedRows) {
    activeBroadcast(r.workspaceId, {
      type: 'task:failed',
      taskId: r.taskId,
      issueId: r.issueId,
      payload: { taskId: r.taskId, issueId: r.issueId },
    });
  }

  if (failed > 0) {
    console.log(`[hosted-orphan-sweep] failed ${failed} hosted-orphan task(s) on boot`);
  }

  return { failed, rows: reapedRows };
}
