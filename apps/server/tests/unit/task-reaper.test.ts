import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestDb,
  teardownTestDb,
  seedRuntime,
  seedAgent,
  seedIssue,
  seedTask,
} from './test-db.js';
import {
  reapOnce,
  startTaskReaper,
  stopTaskReaper,
} from '../../src/task-dispatch/task-reaper.js';
import { startTask } from '../../src/services/task-queue-store.js';

/**
 * Phase 18-03 task-reaper tests (TASK-04).
 *
 * Strategy:
 *   • `reapOnce(db?)` is exported so tests can seed stale rows with controlled
 *     `dispatched_at` / `started_at` timestamps and call the reaper directly
 *     without fake-clock plumbing. This mirrors the production behaviour (the
 *     thresholds are relative to `Date.now()`), and keeps the test surface
 *     focused on correctness of the WHERE/UPDATE — not the setInterval machine.
 *   • `startTaskReaper()` / `stopTaskReaper()` idempotency is covered by
 *     calling the functions against the app singleton `db` (no fixture DB
 *     swap), so the initial sweep is a no-op against an empty table and the
 *     test asserts no throws + clean shutdown.
 *   • ST6 race safety is tested by calling `startTask()` BEFORE `reapOnce()`
 *     to simulate a daemon win — the reaper's `.andWhere('status','dispatched')`
 *     guard must fail to match the now-running row.
 *
 * Each test uses a fresh throwaway SQLite DB and cleans up in `finally` /
 * `t.after()` so nothing leaks between blocks.
 */

test('reapOnce: fails tasks dispatched > 5 min (TASK-04)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueStale = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const issueFresh = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });

    const now = Date.now();
    const staleTs = new Date(now - 6 * 60_000).toISOString();   // 6 min ago — stale
    const freshTs = new Date(now - 3 * 60_000).toISOString();   // 3 min ago — within window

    const staleTaskId = await seedTask(ctx.db, {
      issueId: issueStale,
      agentId,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: staleTs,
    });
    const freshTaskId = await seedTask(ctx.db, {
      issueId: issueFresh,
      agentId,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: freshTs,
    });

    const result = await reapOnce(ctx.db);
    assert.deepEqual(result, { dispatchedFailed: 1, runningFailed: 0 });

    const staleRow = await ctx.db('agent_task_queue').where({ id: staleTaskId }).first();
    assert.equal(staleRow?.status, 'failed');
    assert.equal(staleRow?.error, 'Reaper: dispatched > 5 min without start');
    assert.ok(staleRow?.completed_at, 'stale row has completed_at set');

    const freshRow = await ctx.db('agent_task_queue').where({ id: freshTaskId }).first();
    assert.equal(freshRow?.status, 'dispatched', 'within-window task is untouched');
    assert.equal(freshRow?.error, null);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('reapOnce: fails tasks running > 2.5h (TASK-04)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueStale = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const issueFresh = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });

    const now = Date.now();
    const staleTs = new Date(now - 3 * 60 * 60_000).toISOString();  // 3h ago — stale
    const freshTs = new Date(now - 1 * 60 * 60_000).toISOString();  // 1h ago — within window

    const staleTaskId = await seedTask(ctx.db, {
      issueId: issueStale,
      agentId,
      runtimeId,
      status: 'running',
      dispatchedAtIso: staleTs,
      startedAtIso: staleTs,
    });
    const freshTaskId = await seedTask(ctx.db, {
      issueId: issueFresh,
      agentId,
      runtimeId,
      status: 'running',
      dispatchedAtIso: freshTs,
      startedAtIso: freshTs,
    });

    const result = await reapOnce(ctx.db);
    assert.deepEqual(result, { dispatchedFailed: 0, runningFailed: 1 });

    const staleRow = await ctx.db('agent_task_queue').where({ id: staleTaskId }).first();
    assert.equal(staleRow?.status, 'failed');
    assert.equal(staleRow?.error, 'Reaper: running beyond configured timeout');
    assert.ok(staleRow?.completed_at);

    const freshRow = await ctx.db('agent_task_queue').where({ id: freshTaskId }).first();
    assert.equal(freshRow?.status, 'running', 'within-window running task is untouched');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('reapOnce: leaves terminal tasks alone (completed/failed/cancelled)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });

    const now = Date.now();
    // Seed three tasks with ancient timestamps but already-terminal statuses.
    const ancientTs = new Date(now - 10 * 60 * 60_000).toISOString(); // 10h ago

    const issueA = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const issueB = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });
    const issueC = await seedIssue(ctx.db, { issueNumber: 3, assigneeId: agentId });

    const completedId = await seedTask(ctx.db, {
      issueId: issueA,
      agentId,
      runtimeId,
      status: 'completed',
      dispatchedAtIso: ancientTs,
      startedAtIso: ancientTs,
    });
    const failedId = await seedTask(ctx.db, {
      issueId: issueB,
      agentId,
      runtimeId,
      status: 'failed',
      dispatchedAtIso: ancientTs,
      startedAtIso: ancientTs,
    });
    const cancelledId = await seedTask(ctx.db, {
      issueId: issueC,
      agentId,
      runtimeId,
      status: 'cancelled',
      dispatchedAtIso: ancientTs,
      startedAtIso: ancientTs,
    });

    const result = await reapOnce(ctx.db);
    assert.deepEqual(result, { dispatchedFailed: 0, runningFailed: 0 });

    const completed = await ctx.db('agent_task_queue').where({ id: completedId }).first();
    assert.equal(completed?.status, 'completed');
    const failed = await ctx.db('agent_task_queue').where({ id: failedId }).first();
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, null, 'terminal failed row not overwritten by reaper error text');
    const cancelled = await ctx.db('agent_task_queue').where({ id: cancelledId }).first();
    assert.equal(cancelled?.status, 'cancelled');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('startTaskReaper: idempotent — two calls register one interval, stopTaskReaper clears it', async (t) => {
  // Uses the app singleton DB (empty agent_task_queue in this test process), so
  // the initial sweep is a no-op. The test asserts no throws and that a second
  // start() is a no-op (return early without creating a second interval).
  t.after(() => {
    stopTaskReaper();
  });

  startTaskReaper();
  startTaskReaper(); // should be a no-op — guarded by the module-level interval handle
  stopTaskReaper();

  // Cold-restart parity: stop+start again behaves like a fresh start.
  startTaskReaper();
  stopTaskReaper();

  // stopTaskReaper is itself idempotent — second call without an active interval is fine.
  stopTaskReaper();
});

test('ST6 race safety: daemon startTask mid-tick is not clobbered (TASK-04, PITFALLS §ST6)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });

    const now = Date.now();
    const staleDispatchedAt = new Date(now - 6 * 60_000).toISOString(); // 6 min — would be stale
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: staleDispatchedAt,
    });

    // Simulate daemon winning the race: startTask commits first, moving the
    // row from 'dispatched' to 'running' and updating started_at to now.
    const startRes = await startTask(taskId, ctx.db);
    assert.deepEqual(startRes, { started: true, status: 'running' });

    // Reaper ticks AFTER the transition commits. Its WHERE clause for the
    // dispatched sweep is `status = 'dispatched' AND dispatched_at < cutoff`;
    // the row's status is now 'running' so it does not match the pre-UPDATE
    // SELECT. The running-sweep cutoff is 2.5h in the past, so the row (just
    // transitioned to running at now) is NOT in that window either.
    const result = await reapOnce(ctx.db);
    assert.deepEqual(result, { dispatchedFailed: 0, runningFailed: 0 });

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first();
    assert.equal(row?.status, 'running', 'row preserved in running state — not clobbered by reaper');
    assert.equal(row?.error, null, 'no reaper error text was written');
  } finally {
    await teardownTestDb(ctx);
  }
});
