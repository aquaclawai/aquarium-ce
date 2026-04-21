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
  appendTaskMessage,
  startTaskMessageBatcher,
  stopTaskMessageBatcher,
  flushTaskMessages,
  __setBatcherDbForTests__,
  __resetBatcherState__,
} from '../../src/task-dispatch/task-message-batcher.js';

/**
 * Phase 18-02 task-message-batcher tests.
 *
 * Covered:
 *   • TASK-03 / SC-2: single-task flush yields monotonic seq 1..N
 *   • TASK-03 / SQ4: 20 concurrent appenders over one task still produce
 *     a gap-free strictly-monotonic seq (MAX(seq)+1 inside BEGIN IMMEDIATE)
 *   • Per-task independence: two tasks have independent 1..N sequences
 *   • SQ5: buffer soft-cap (500) triggers early flush — eventual DB count = appends
 *   • Graceful shutdown: stopTaskMessageBatcher() drains in-memory buffer
 *
 * Each test creates its own isolated SQLite file, injects it into the batcher's
 * module state via __setBatcherDbForTests__, and resets state in the finally
 * block. stopTaskMessageBatcher() is always awaited so lingering intervals from
 * a prior test never fire against a destroyed DB.
 */

async function withBatcherDb<T>(fn: (ctx: Awaited<ReturnType<typeof setupTestDb>>) => Promise<T>): Promise<T> {
  const ctx = await setupTestDb();
  __setBatcherDbForTests__(ctx.db);
  try {
    return await fn(ctx);
  } finally {
    try {
      await stopTaskMessageBatcher();
    } catch {
      // stop is best-effort during cleanup
    }
    __resetBatcherState__();
    await teardownTestDb(ctx);
  }
}

async function seedOneTask(db: Awaited<ReturnType<typeof setupTestDb>>['db'], issueNumber: number): Promise<{ taskId: string; issueId: string }> {
  const runtimeId = await seedRuntime(db);
  const agentId = await seedAgent(db, { runtimeId });
  const issueId = await seedIssue(db, { issueNumber, assigneeId: agentId });
  const taskId = await seedTask(db, { issueId, agentId, runtimeId, status: 'running' });
  return { taskId, issueId };
}

test('single-task flush: 500 appends yield seq 1..500 monotonically (TASK-03)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 1);

    for (let i = 0; i < 500; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `msg-${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }

    await flushTaskMessages(taskId);

    const rows = await ctx.db('task_messages')
      .where({ task_id: taskId })
      .orderBy('seq', 'asc')
      .select('seq', 'content');

    assert.equal(rows.length, 500, 'exactly 500 rows written');
    const seqs = rows.map((r) => Number(r.seq));
    for (let i = 0; i < 500; i += 1) {
      assert.equal(seqs[i], i + 1, `row ${i} has seq ${i + 1}`);
    }
  });
});

test('concurrent appenders: 20 x 25 appends yield 500 rows with strictly monotonic seq (TASK-03 + SQ4)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 2);

    // 20 pseudo-concurrent appenders each appending 25 messages.
    // Because appendTaskMessage is synchronous (in-memory buffer push), the
    // Promise.all merely ensures the microtask queue interleaves them.
    await Promise.all(
      Array.from({ length: 20 }, (_, appenderIdx) =>
        (async () => {
          for (let i = 0; i < 25; i += 1) {
            appendTaskMessage(taskId, {
              type: 'text',
              content: `appender-${appenderIdx}-msg-${i}`,
              workspaceId: 'AQ',
              issueId,
            });
          }
        })(),
      ),
    );

    await flushTaskMessages(taskId);

    const rows = await ctx.db('task_messages')
      .where({ task_id: taskId })
      .orderBy('seq', 'asc')
      .select('seq');

    assert.equal(rows.length, 500, '20 * 25 = 500 rows written');
    const seqs = rows.map((r) => Number(r.seq));
    for (let i = 0; i < 500; i += 1) {
      assert.equal(seqs[i], i + 1, `row ${i} has seq ${i + 1}`);
    }
  });
});

test('per-task independence: two tasks each have their own 1..N monotonic sequence', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId: taskA, issueId: issueA } = await seedOneTask(ctx.db, 10);
    const { taskId: taskB, issueId: issueB } = await seedOneTask(ctx.db, 11);

    // Interleave appends to A and B.
    for (let i = 0; i < 10; i += 1) {
      appendTaskMessage(taskA, {
        type: 'text',
        content: `A-${i}`,
        workspaceId: 'AQ',
        issueId: issueA,
      });
      appendTaskMessage(taskB, {
        type: 'text',
        content: `B-${i}`,
        workspaceId: 'AQ',
        issueId: issueB,
      });
    }

    await flushTaskMessages();

    const rowsA = await ctx.db('task_messages')
      .where({ task_id: taskA })
      .orderBy('seq', 'asc')
      .select('seq', 'content');
    const rowsB = await ctx.db('task_messages')
      .where({ task_id: taskB })
      .orderBy('seq', 'asc')
      .select('seq', 'content');

    assert.equal(rowsA.length, 10);
    assert.equal(rowsB.length, 10);
    for (let i = 0; i < 10; i += 1) {
      assert.equal(Number(rowsA[i]?.seq), i + 1, `task A row ${i} seq = ${i + 1}`);
      assert.equal(rowsA[i]?.content, `A-${i}`);
      assert.equal(Number(rowsB[i]?.seq), i + 1, `task B row ${i} seq = ${i + 1}`);
      assert.equal(rowsB[i]?.content, `B-${i}`);
    }
  });
});

test('overflow early flush: appending 600 messages triggers mid-stream flush (SQ5)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 20);

    // Append 600 messages — the soft cap of 500 must schedule an early flush
    // at message #500, then we append #501..600 while/after the early flush
    // drains. A final explicit flush drains residual.
    for (let i = 0; i < 600; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `msg-${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }

    // Let the microtask-scheduled early flush settle.
    await new Promise((r) => setTimeout(r, 50));
    // Drain residual.
    await flushTaskMessages(taskId);

    const rows = await ctx.db('task_messages')
      .where({ task_id: taskId })
      .orderBy('seq', 'asc')
      .select('seq');

    assert.equal(rows.length, 600, 'all 600 messages ended up in the DB');
    const seqs = rows.map((r) => Number(r.seq));
    for (let i = 0; i < 600; i += 1) {
      assert.equal(seqs[i], i + 1, `row ${i} has seq ${i + 1}`);
    }
  });
});

test('stopTaskMessageBatcher final-flushes in-memory buffer', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 30);

    startTaskMessageBatcher();
    for (let i = 0; i < 5; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `final-${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }
    await stopTaskMessageBatcher();

    const rows = await ctx.db('task_messages')
      .where({ task_id: taskId })
      .orderBy('seq', 'asc')
      .select('seq', 'content');

    assert.equal(rows.length, 5);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(Number(rows[i]?.seq), i + 1);
      assert.equal(rows[i]?.content, `final-${i}`);
    }
  });
});
