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
  stopTaskMessageBatcher,
  flushTaskMessages,
  __setBatcherDbForTests__,
  __resetBatcherState__,
} from '../../src/task-dispatch/task-message-batcher.js';
import {
  listMessagesAfterSeq,
  listRecentMessagesAfterSeq,
  listTaskMessagesOfKind,
  getFullMessage,
  REPLAY_ROW_CAP,
} from '../../src/services/task-message-store.js';

/**
 * Phase 24-00 Task 1 — REST replay + WS-capped replay + kind-filter + full-message helpers.
 *
 * Covers ST2 replay invariants:
 *   • listMessagesAfterSeq — ASC paginated for REST
 *   • listRecentMessagesAfterSeq — DESC LIMIT N, reversed to ASC for WS subscribe_task
 *   • listTaskMessagesOfKind — completion-path helper (Wave 5 final-text reconstruction)
 *   • getFullMessage — overflow-first uncapped lookup
 */

async function withBatcherDb<T>(
  fn: (ctx: Awaited<ReturnType<typeof setupTestDb>>) => Promise<T>,
): Promise<T> {
  const ctx = await setupTestDb();
  __setBatcherDbForTests__(ctx.db);
  try {
    return await fn(ctx);
  } finally {
    try {
      await stopTaskMessageBatcher();
    } catch {
      // best-effort
    }
    __resetBatcherState__();
    await teardownTestDb(ctx);
  }
}

async function seedOneTask(
  db: Awaited<ReturnType<typeof setupTestDb>>['db'],
  issueNumber: number,
): Promise<{ taskId: string; issueId: string }> {
  const runtimeId = await seedRuntime(db);
  const agentId = await seedAgent(db, { runtimeId });
  const issueId = await seedIssue(db, { issueNumber, assigneeId: agentId });
  const taskId = await seedTask(db, { issueId, agentId, runtimeId, status: 'running' });
  return { taskId, issueId };
}

test('listMessagesAfterSeq returns 10 rows ASC when afterSeq=0 and 5 rows when afterSeq=5 (ST2 REST)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 201);
    for (let i = 0; i < 10; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `msg-${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }
    await flushTaskMessages(taskId);

    const all = await listMessagesAfterSeq(ctx.db, taskId, 0);
    assert.equal(all.messages.length, 10);
    assert.equal(all.hasMore, false);
    for (let i = 0; i < 10; i += 1) {
      assert.equal(all.messages[i]!.seq, i + 1);
    }

    const tail = await listMessagesAfterSeq(ctx.db, taskId, 5);
    assert.equal(tail.messages.length, 5);
    assert.equal(tail.hasMore, false);
    assert.equal(tail.messages[0]!.seq, 6);
    assert.equal(tail.messages[4]!.seq, 10);
  });
});

test('listMessagesAfterSeq hasMore=true when count >= REPLAY_ROW_CAP (ST2 REST pagination)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 202);
    const n = REPLAY_ROW_CAP + 10;
    for (let i = 0; i < n; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `m${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }
    // Appending > BUFFER_SOFT_CAP triggers a fire-and-forget early flush;
    // wait for it to settle before draining residual (mirrors the
    // overflow-early-flush test in task-message-batcher.test.ts).
    await new Promise((r) => setTimeout(r, 50));
    await flushTaskMessages(taskId);

    const first = await listMessagesAfterSeq(ctx.db, taskId, 0);
    assert.equal(first.messages.length, REPLAY_ROW_CAP);
    assert.equal(first.hasMore, true);
    assert.equal(first.messages[0]!.seq, 1);
    assert.equal(first.messages[REPLAY_ROW_CAP - 1]!.seq, REPLAY_ROW_CAP);
  });
});

test('getFullMessage returns uncapped original from overflow when present', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 203);
    const big = 'Z'.repeat(20 * 1024);
    appendTaskMessage(taskId, {
      type: 'text',
      content: big,
      workspaceId: 'AQ',
      issueId,
    });
    appendTaskMessage(taskId, {
      type: 'text',
      content: 'small',
      workspaceId: 'AQ',
      issueId,
    });
    await flushTaskMessages(taskId);

    const full1 = await getFullMessage(ctx.db, taskId, 1);
    assert.ok(full1);
    assert.equal(full1!.content, big, 'seq=1 returns the uncapped original from overflow');

    const full2 = await getFullMessage(ctx.db, taskId, 2);
    assert.ok(full2);
    assert.equal(full2!.content, 'small', 'seq=2 returns the row directly (no overflow)');
  });
});

test('listRecentMessagesAfterSeq returns the 500 most-recent rows + olderOmittedCount (ST2 WS DESC-500)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 204);
    for (let i = 0; i < 600; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `m${i}`,
        workspaceId: 'AQ',
        issueId,
      });
    }
    // Early-flush settle + residual drain pattern (see 18-02 batcher test).
    await new Promise((r) => setTimeout(r, 50));
    await flushTaskMessages(taskId);

    const result = await listRecentMessagesAfterSeq(ctx.db, taskId, 0, 500);
    assert.equal(result.messages.length, 500);
    assert.equal(result.olderOmittedCount, 100);
    // Most-recent 500 via DESC LIMIT 500 then reversed ASC:
    assert.equal(result.messages[0]!.seq, 101);
    assert.equal(result.messages[499]!.seq, 600);
  });
});

test('listTaskMessagesOfKind returns only the requested kind in seq ASC order; empty array when none', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 205);
    // Interleave 5 text + 3 tool_use + 2 thinking
    const kinds: Array<'text' | 'tool_use' | 'thinking'> = [
      'text', 'tool_use', 'text', 'thinking', 'text',
      'tool_use', 'text', 'thinking', 'tool_use', 'text',
    ];
    for (let i = 0; i < kinds.length; i += 1) {
      const kind = kinds[i]!;
      appendTaskMessage(taskId, {
        type: kind,
        content: kind === 'tool_use' ? null : `body-${i}`,
        tool: kind === 'tool_use' ? 'search' : null,
        input: kind === 'tool_use' ? { i } : undefined,
        workspaceId: 'AQ',
        issueId,
      });
    }
    await flushTaskMessages(taskId);

    const textRows = await listTaskMessagesOfKind(ctx.db, taskId, 'text');
    assert.equal(textRows.length, 5);
    // Verify seq ASC order (strictly increasing):
    for (let i = 1; i < textRows.length; i += 1) {
      assert.ok(textRows[i]!.seq > textRows[i - 1]!.seq);
    }

    const thinkingRows = await listTaskMessagesOfKind(ctx.db, taskId, 'thinking');
    assert.equal(thinkingRows.length, 2);

    // Second task without any text rows → returns [] without throwing.
    const { taskId: emptyTaskId, issueId: emptyIssue } = await seedOneTask(ctx.db, 206);
    // Seed nothing, OR seed a single non-text row.
    appendTaskMessage(emptyTaskId, {
      type: 'thinking',
      content: 'hmm',
      workspaceId: 'AQ',
      issueId: emptyIssue,
    });
    await flushTaskMessages(emptyTaskId);
    const emptyTextRows = await listTaskMessagesOfKind(ctx.db, emptyTaskId, 'text');
    assert.deepEqual(emptyTextRows, []);
  });
});
