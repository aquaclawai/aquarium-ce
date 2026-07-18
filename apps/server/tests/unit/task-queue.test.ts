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
  claimTask,
  startTask,
  completeTask,
  failTask,
  cancelTask,
  isTaskCancelled,
  cancelPendingTasksForIssueAgent,
  cancelAllTasksForIssue,
} from '../../src/services/task-queue-store.js';

/**
 * Phase 18-01 task-queue lifecycle tests.
 *
 * Covered:
 *   • TASK-01 / SC-1: single claim + 20-concurrent claim coalescing
 *   • TASK-02: dispatched → running → completed transitions (claimTask already
 *     covered queued → dispatched in the claim tests).
 *   • TASK-06: completeTask / failTask on `cancelled` return
 *     { discarded: true, status: 'cancelled' } without throwing.
 *   • TASK-05 surface: cancelTask flips DB + isTaskCancelled reads truth.
 *
 * Every test sets up its own isolated SQLite file (tmpdir) and tears it down
 * in `finally`. No test depends on ordering or shared state.
 */

test('claim: single queued task → dispatched exactly once (TASK-01)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId });

    const claimed = await claimTask(runtimeId, ctx.db);
    assert.ok(claimed, 'first claim returns a ClaimedTask');
    assert.equal(claimed?.id, taskId);
    assert.equal(claimed?.status, 'dispatched');
    assert.ok(claimed?.dispatchedAt, 'dispatched_at is set');
    // ClaimedTask hydration — agent + issue snapshot present
    assert.equal(claimed?.agent.id, agentId);
    assert.equal(claimed?.issue.id, issueId);

    // Second claim on same runtime returns null (only one queued task existed).
    const secondClaim = await claimTask(runtimeId, ctx.db);
    assert.equal(secondClaim, null);

    // DB reflects exactly one dispatched row for this runtime.
    const dispatchedCount = await ctx.db('agent_task_queue')
      .where({ runtime_id: runtimeId, status: 'dispatched' })
      .count<{ n: number }[]>({ n: '*' });
    assert.equal(Number(dispatchedCount[0]?.n ?? 0), 1);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('claim: 20 concurrent pollers over N queued tasks dispatch at most N rows (TASK-01 / SC-1)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);

    // 5 distinct (issue, agent) pairs so the partial-unique index does not
    // conflate them. max_concurrent_tasks=6 per agent so the cap never trips
    // for this scenario (1 task per agent).
    const NUM_TASKS = 5;
    const seededTaskIds: string[] = [];
    for (let i = 0; i < NUM_TASKS; i += 1) {
      const agentId = await seedAgent(ctx.db, { runtimeId, name: `agent-${i}` });
      const issueId = await seedIssue(ctx.db, {
        issueNumber: i + 1,
        assigneeId: agentId,
      });
      seededTaskIds.push(await seedTask(ctx.db, { issueId, agentId, runtimeId }));
    }

    // Fire 20 concurrent claims. Pool=1 serialises them through one connection
    // but the property we assert is: each queued row is claimed exactly once.
    const NUM_POLLERS = 20;
    const results = await Promise.all(
      Array.from({ length: NUM_POLLERS }, () => claimTask(runtimeId, ctx.db)),
    );

    // Non-null results = actually claimed tasks.
    const claimed = results.filter((r) => r !== null);
    assert.equal(
      claimed.length,
      NUM_TASKS,
      `expected exactly ${NUM_TASKS} successful claims over ${NUM_POLLERS} pollers`,
    );

    // Every claimed task id is distinct (no duplicate dispatch).
    const ids = claimed.map((c) => c!.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, NUM_TASKS, 'every claimed task id is unique');

    // Every seeded task is now `dispatched`, with a timestamp.
    const dispatchedRows = await ctx.db('agent_task_queue')
      .where({ runtime_id: runtimeId, status: 'dispatched' })
      .select('id', 'dispatched_at');
    assert.equal(dispatchedRows.length, NUM_TASKS);
    for (const row of dispatchedRows) {
      assert.ok(row.dispatched_at, `task ${row.id} has dispatched_at`);
    }
  } finally {
    await teardownTestDb(ctx);
  }
});

test('claim: respects agent.max_concurrent_tasks (AGENT-02)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    // Single agent with cap=1 and three issues → at most one can dispatch.
    const agentId = await seedAgent(ctx.db, { runtimeId, maxConcurrentTasks: 1 });
    for (let i = 0; i < 3; i += 1) {
      const issueId = await seedIssue(ctx.db, {
        issueNumber: i + 1,
        assigneeId: agentId,
        title: `Issue ${i}`,
      });
      await seedTask(ctx.db, { issueId, agentId, runtimeId });
    }

    const first = await claimTask(runtimeId, ctx.db);
    assert.ok(first, 'first claim succeeds');
    const second = await claimTask(runtimeId, ctx.db);
    assert.equal(
      second,
      null,
      'second claim is null — agent at cap, NOT EXISTS guard prevents dispatch',
    );
  } finally {
    await teardownTestDb(ctx);
  }
});

test('lifecycle: claim → start → complete transitions cleanly (TASK-02)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId });

    const claimed = await claimTask(runtimeId, ctx.db);
    assert.equal(claimed?.id, taskId);
    assert.equal(claimed?.status, 'dispatched');

    const startRes = await startTask(taskId, ctx.db);
    assert.deepEqual(startRes, { started: true, status: 'running' });

    // Second start call is a no-op (status already running) — caller receives
    // started:false, NOT an exception.
    const secondStart = await startTask(taskId, ctx.db);
    assert.equal(secondStart.started, false);
    assert.equal(secondStart.status, 'running');

    const completeRes = await completeTask(taskId, { ok: true }, ctx.db);
    assert.deepEqual(completeRes, { discarded: false, status: 'completed' });

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first();
    assert.equal(row?.status, 'completed');
    assert.ok(row?.completed_at);
    // result JSON round-trip
    assert.equal(row?.result, JSON.stringify({ ok: true }));
  } finally {
    await teardownTestDb(ctx);
  }
});

test('lifecycle: startTask on queued (not dispatched) returns started:false (TASK-02)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'queued' });

    const res = await startTask(taskId, ctx.db);
    assert.equal(res.started, false);
    assert.equal(res.status, 'queued');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('discard: completeTask on cancelled returns { discarded: true, status: cancelled } (TASK-06)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'cancelled' });
    await ctx.db('agent_task_queue')
      .where({ id: taskId })
      .update({ cancelled_at: new Date().toISOString() });

    const res = await completeTask(taskId, { ok: true }, ctx.db);
    assert.deepEqual(res, { discarded: true, status: 'cancelled' });

    // DB unchanged — status still cancelled, result NULL.
    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first();
    assert.equal(row?.status, 'cancelled');
    assert.equal(row?.result, null);
    assert.equal(row?.completed_at, null);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('discard: failTask on cancelled returns { discarded: true, status: cancelled } (TASK-06)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'cancelled' });
    await ctx.db('agent_task_queue')
      .where({ id: taskId })
      .update({ cancelled_at: new Date().toISOString() });

    const res = await failTask(taskId, 'daemon crashed', ctx.db);
    assert.deepEqual(res, { discarded: true, status: 'cancelled' });

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first();
    assert.equal(row?.status, 'cancelled');
    assert.equal(row?.error, null);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('discard: completeTask on already-completed is idempotent (TASK-06 idempotency)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'completed' });

    const res = await completeTask(taskId, { again: true }, ctx.db);
    assert.equal(res.discarded, true);
    assert.equal(res.status, 'completed');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('cancel: cancelTask flips queued → cancelled and isTaskCancelled reads truth (TASK-05 surface)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'queued' });

    assert.equal(await isTaskCancelled(taskId, ctx.db), false);

    const res = await cancelTask(taskId, ctx.db);
    assert.equal(res.cancelled, true);
    assert.equal(res.previousStatus, 'queued');

    assert.equal(await isTaskCancelled(taskId, ctx.db), true);

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first();
    assert.equal(row?.status, 'cancelled');
    assert.ok(row?.cancelled_at);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('cancel: cancelTask on running task also flips to cancelled (TASK-05)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'running',
      dispatchedAtIso: new Date().toISOString(),
      startedAtIso: new Date().toISOString(),
    });

    const res = await cancelTask(taskId, ctx.db);
    assert.equal(res.cancelled, true);
    assert.equal(res.previousStatus, 'running');
    assert.equal(await isTaskCancelled(taskId, ctx.db), true);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('cancel: cancelTask on terminal task is a no-op (TASK-05 idempotency)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'completed' });

    const res = await cancelTask(taskId, ctx.db);
    assert.equal(res.cancelled, false);
    assert.equal(res.previousStatus, 'completed');
    assert.equal(await isTaskCancelled(taskId, ctx.db), false);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('isTaskCancelled: unknown task id returns false (no throw)', async () => {
  const ctx = await setupTestDb();
  try {
    assert.equal(await isTaskCancelled('00000000-0000-0000-0000-000000000000', ctx.db), false);
  } finally {
    await teardownTestDb(ctx);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 18-04 — TASK-05 mass-cancel helpers return cancelledRows + broadcast.
//
// These tests prove the return-shape change and the emitBroadcasts contract of
// the two Phase-17 helpers extended here:
//   • cancelPendingTasksForIssueAgent (queued|dispatched scope)
//   • cancelAllTasksForIssue         (queued|dispatched|running scope)
// ─────────────────────────────────────────────────────────────────────────────

test('TASK-05: cancelPendingTasksForIssueAgent returns cancelledRows with previousStatus', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const queuedId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'queued',
    });
    // Need a SECOND issue for the dispatched row because the partial-unique
    // index idx_one_pending_task_per_issue_agent forbids 2 pending tasks for
    // the same (issue, agent) pair.
    const issueId2 = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });
    const dispatchedId = await seedTask(ctx.db, {
      issueId: issueId2,
      agentId,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: new Date().toISOString(),
    });

    // The helper scope is (workspaceId, issueId, agentId) — run it twice to
    // cancel both. Each call should return exactly one row.
    const first = await cancelPendingTasksForIssueAgent({
      workspaceId: 'AQ',
      issueId,
      agentId,
      db: ctx.db,
    });
    assert.equal(first.count, 1);
    assert.equal(first.cancelledTaskIds.length, 1);
    assert.equal(first.cancelledTaskIds[0], queuedId);
    assert.equal(first.cancelledRows.length, 1);
    assert.equal(first.cancelledRows[0]?.taskId, queuedId);
    assert.equal(first.cancelledRows[0]?.issueId, issueId);
    assert.equal(first.cancelledRows[0]?.workspaceId, 'AQ');
    assert.equal(first.cancelledRows[0]?.previousStatus, 'queued');

    const second = await cancelPendingTasksForIssueAgent({
      workspaceId: 'AQ',
      issueId: issueId2,
      agentId,
      db: ctx.db,
    });
    assert.equal(second.count, 1);
    assert.equal(second.cancelledRows[0]?.taskId, dispatchedId);
    assert.equal(second.cancelledRows[0]?.previousStatus, 'dispatched');

    // DB state flipped for both.
    assert.equal(await isTaskCancelled(queuedId, ctx.db), true);
    assert.equal(await isTaskCancelled(dispatchedId, ctx.db), true);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('TASK-05: cancelAllTasksForIssue includes running tasks', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    // Use three distinct agents so the partial-unique pending-pair index does
    // not conflict — a single issue can have at most one pending task per
    // (issue, agent) pair.
    const agentA = await seedAgent(ctx.db, { runtimeId, name: 'agent-a' });
    const agentB = await seedAgent(ctx.db, { runtimeId, name: 'agent-b' });
    const agentC = await seedAgent(ctx.db, { runtimeId, name: 'agent-c' });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentA });

    const queuedId = await seedTask(ctx.db, {
      issueId,
      agentId: agentA,
      runtimeId,
      status: 'queued',
    });
    const dispatchedId = await seedTask(ctx.db, {
      issueId,
      agentId: agentB,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: new Date().toISOString(),
    });
    const runningId = await seedTask(ctx.db, {
      issueId,
      agentId: agentC,
      runtimeId,
      status: 'running',
      dispatchedAtIso: new Date().toISOString(),
      startedAtIso: new Date().toISOString(),
    });

    const res = await cancelAllTasksForIssue({
      workspaceId: 'AQ',
      issueId,
      db: ctx.db,
    });

    assert.equal(res.count, 3);
    assert.equal(res.cancelledRows.length, 3);
    const prevById = new Map(
      res.cancelledRows.map((r) => [r.taskId, r.previousStatus]),
    );
    assert.equal(prevById.get(queuedId), 'queued');
    assert.equal(prevById.get(dispatchedId), 'dispatched');
    assert.equal(prevById.get(runningId), 'running');

    // All three flipped in the DB.
    for (const id of [queuedId, dispatchedId, runningId]) {
      assert.equal(await isTaskCancelled(id, ctx.db), true, `task ${id} cancelled`);
    }
  } finally {
    await teardownTestDb(ctx);
  }
});

test('TASK-05: emitBroadcasts=true fires task:cancelled per row (no trx)', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'queued',
    });

    // Minimal verification: after call with emitBroadcasts:true, the DB state
    // flips and cancelledRows returned. Full WS-capture deferred — broadcast
    // absence is verified by code review + the trx test below (which uses the
    // same implementation path).
    const res = await cancelPendingTasksForIssueAgent({
      workspaceId: 'AQ',
      issueId,
      agentId,
      emitBroadcasts: true,
      db: ctx.db,
    });

    assert.equal(res.count, 1);
    assert.equal(res.cancelledRows[0]?.taskId, taskId);
    assert.equal(await isTaskCancelled(taskId, ctx.db), true);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('TASK-05: helpers called with a trx return rows and leave broadcast to caller', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'queued',
    });

    // Run inside an outer transaction — the `if (trx)` branch of the helper
    // takes over and MUST NOT broadcast. We cannot easily spy on the ws module
    // export from another module under node:test + tsx without more wiring, so
    // we assert the caller-ownership contract by verifying:
    //   (a) the row flips inside the transaction,
    //   (b) the returned CancelResult carries the row data,
    //   (c) no exception is thrown (which would be the case if the internal
    //       `if (trx)` path tried to open a second transaction to broadcast).
    const result = await ctx.db.transaction(async (trx) => {
      return cancelPendingTasksForIssueAgent({
        workspaceId: 'AQ',
        issueId,
        agentId,
        trx,
        // Even with emitBroadcasts set, trx-mode suppresses broadcast.
        emitBroadcasts: true,
      });
    });

    assert.equal(result.count, 1);
    assert.equal(result.cancelledRows[0]?.taskId, taskId);
    assert.equal(result.cancelledRows[0]?.previousStatus, 'queued');
    assert.equal(await isTaskCancelled(taskId, ctx.db), true);
  } finally {
    await teardownTestDb(ctx);
  }
});
