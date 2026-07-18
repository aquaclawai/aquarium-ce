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
  TASK_MESSAGE_CONTENT_LIMIT_BYTES,
  truncateForStorage,
} from '../../src/services/task-message-store.js';

/**
 * Phase 24-00 Task 1 — server-side 16 KB truncation.
 *
 * Covers UX6 truncation invariant:
 *   • appending > 16 KB content stores a truncated row + overflow blob
 *   • appending <= 16 KB content stores the row verbatim (no overflow row)
 *   • tool_use JSON input truncation mirrors text truncation
 *   • multi-byte UTF-8 prefix never splits a code point mid-way
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

test('constant TASK_MESSAGE_CONTENT_LIMIT_BYTES equals 16 KB (UX6)', () => {
  assert.equal(TASK_MESSAGE_CONTENT_LIMIT_BYTES, 16_384);
});

test('20 KB text content is truncated to <= 16 KB + overflow row keyed on (task_id, seq) (UX6)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 101);

    const big = 'A'.repeat(20 * 1024); // 20 KB ASCII
    appendTaskMessage(taskId, {
      type: 'text',
      content: big,
      workspaceId: 'AQ',
      issueId,
    });
    await flushTaskMessages(taskId);

    const rows = (await ctx.db('task_messages')
      .where({ task_id: taskId })
      .orderBy('seq', 'asc')
      .select('*')) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    const contentBytes = Buffer.byteLength(String(row.content ?? ''), 'utf8');
    assert.ok(
      contentBytes <= TASK_MESSAGE_CONTENT_LIMIT_BYTES,
      `content bytes ${contentBytes} must be <= LIMIT`,
    );
    const metadata = JSON.parse(String(row.metadata ?? '{}')) as {
      truncated?: boolean;
      originalBytes?: number;
    };
    assert.equal(metadata.truncated, true);
    assert.equal(metadata.originalBytes, 20 * 1024);

    const overflow = (await ctx.db('task_message_overflow')
      .where({ task_id: taskId, seq: Number(row.seq) })
      .first()) as Record<string, unknown> | undefined;
    assert.ok(overflow, 'overflow row exists');
    assert.equal(String(overflow!.content), big);
    assert.equal(Number(overflow!.original_bytes), 20 * 1024);
  });
});

test('10 KB text content stored verbatim; no metadata.truncated; no overflow row (UX6)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 102);

    const small = 'B'.repeat(10 * 1024);
    appendTaskMessage(taskId, {
      type: 'text',
      content: small,
      workspaceId: 'AQ',
      issueId,
    });
    await flushTaskMessages(taskId);

    const rows = (await ctx.db('task_messages')
      .where({ task_id: taskId })
      .select('*')) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(String(row.content), small);
    const metadata = JSON.parse(String(row.metadata ?? '{}')) as {
      truncated?: boolean;
    };
    assert.notEqual(metadata.truncated, true);

    const overflow = (await ctx.db('task_message_overflow')
      .where({ task_id: taskId })
      .select('*')) as unknown[];
    assert.equal(overflow.length, 0);
  });
});

test('tool_use with 20 KB JSON input is truncated + overflow holds full pre-serialized JSON (UX6)', async () => {
  await withBatcherDb(async (ctx) => {
    const { taskId, issueId } = await seedOneTask(ctx.db, 103);

    const blob = 'X'.repeat(20 * 1024);
    const input = { query: blob, meta: { tool: 'search' } };
    const originalJson = JSON.stringify(input);
    appendTaskMessage(taskId, {
      type: 'tool_use',
      tool: 'search',
      input,
      workspaceId: 'AQ',
      issueId,
    });
    await flushTaskMessages(taskId);

    const rows = (await ctx.db('task_messages')
      .where({ task_id: taskId })
      .select('*')) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    const inputStr = String(row.input ?? '');
    assert.ok(
      Buffer.byteLength(inputStr, 'utf8') <= TASK_MESSAGE_CONTENT_LIMIT_BYTES,
      'serialized input is capped at LIMIT',
    );
    const metadata = JSON.parse(String(row.metadata ?? '{}')) as {
      truncated?: boolean;
      originalBytes?: number;
    };
    assert.equal(metadata.truncated, true);
    assert.equal(metadata.originalBytes, Buffer.byteLength(originalJson, 'utf8'));

    const overflow = (await ctx.db('task_message_overflow')
      .where({ task_id: taskId, seq: Number(row.seq) })
      .first()) as Record<string, unknown> | undefined;
    assert.ok(overflow, 'overflow row exists for tool_use');
    assert.equal(String(overflow!.input_json), originalJson);
  });
});

test('multi-byte UTF-8 boundary: no invalid UTF-8 in truncated row (UX6)', () => {
  // 3-byte code point 'あ' (U+3042) = E3 81 82; build a string that overflows
  // exactly on a multi-byte boundary.
  const ch = 'あ'; // 3 bytes
  const repeat = Math.ceil((TASK_MESSAGE_CONTENT_LIMIT_BYTES + 1) / 3);
  const input = ch.repeat(repeat);
  const originalBytes = Buffer.byteLength(input, 'utf8');
  assert.ok(originalBytes > TASK_MESSAGE_CONTENT_LIMIT_BYTES);

  const result = truncateForStorage({ content: input, input: undefined, output: undefined });
  assert.equal(result.didTruncate, true);
  assert.equal(result.originalBytes, originalBytes);

  // The truncated string must be valid UTF-8 and <= LIMIT bytes.
  const truncated = result.truncatedContent ?? '';
  const truncatedBytes = Buffer.byteLength(truncated, 'utf8');
  assert.ok(truncatedBytes <= TASK_MESSAGE_CONTENT_LIMIT_BYTES);
  // Every character must be 'あ' (no partial/replacement char at the tail).
  for (const c of truncated) {
    assert.equal(c, ch);
  }
});
