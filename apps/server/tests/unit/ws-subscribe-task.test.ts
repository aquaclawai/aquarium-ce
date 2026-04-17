import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
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
import { setupWebSocket, broadcastTaskMessage } from '../../src/ws/index.js';
import {
  __setDbForTests__,
  __resetDbForTests__,
} from '../../src/db/index.js';
import {
  listMessagesAfterSeq,
  REPLAY_ROW_CAP,
} from '../../src/services/task-message-store.js';

/**
 * Phase 24-00 Task 2 — WS subscribe_task buffer-replay-live ordering.
 *
 * ST2 invariants:
 *   • subscribe_task replays DB rows with seq > lastSeq, then drains any
 *     live broadcasts that arrived during the replay window, then switches
 *     to live-only.
 *   • pause_stream suppresses live broadcasts until a fresh subscribe_task.
 *   • replay is capped at 500 via listRecentMessagesAfterSeq (DESC LIMIT 500
 *     then reversed); a `replay_truncated` sentinel fires BEFORE the rows
 *     when older entries were omitted.
 */

interface HarnessCtx {
  server: HttpServer;
  ctx: Awaited<ReturnType<typeof setupTestDb>>;
  port: number;
}

async function bootHarness(): Promise<HarnessCtx> {
  const ctx = await setupTestDb();
  __setBatcherDbForTests__(ctx.db);
  __setDbForTests__(ctx.db);
  const server = createServer();
  setupWebSocket(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return { server, ctx, port: addr.port };
}

async function tearDownHarness(h: HarnessCtx): Promise<void> {
  try {
    await stopTaskMessageBatcher();
  } catch {
    /* best-effort */
  }
  __resetBatcherState__();
  __resetDbForTests__();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  await teardownTestDb(h.ctx);
}

async function seedOneTask(
  db: Awaited<ReturnType<typeof setupTestDb>>['db'],
  issueNumber: number,
): Promise<{ taskId: string; issueId: string; workspaceId: string }> {
  const runtimeId = await seedRuntime(db);
  const agentId = await seedAgent(db, { runtimeId });
  const issueId = await seedIssue(db, { issueNumber, assigneeId: agentId });
  const taskId = await seedTask(db, { issueId, agentId, runtimeId, status: 'running' });
  return { taskId, issueId, workspaceId: 'AQ' };
}

interface CollectedClient {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  ready: Promise<void>;
  close: () => void;
}

async function connectClient(port: number): Promise<CollectedClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: Array<Record<string, unknown>> = [];
  const ready = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    } catch {
      /* ignore malformed */
    }
  });
  await ready;
  return {
    ws,
    messages,
    ready,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function sendJson(ws: WebSocket, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify(payload), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withHarness<T>(fn: (h: HarnessCtx) => Promise<T>): Promise<T> {
  const h = await bootHarness();
  try {
    return await fn(h);
  } finally {
    await tearDownHarness(h);
  }
}

test('subscribe_task replay-live ordering: replay first, then live; no reorder (ST2)', async () => {
  await withHarness(async (h) => {
    const { taskId, issueId, workspaceId } = await seedOneTask(h.ctx.db, 301);

    // Seed 10 DB rows.
    for (let i = 0; i < 10; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `m${i}`,
        workspaceId,
        issueId,
      });
    }
    await flushTaskMessages(taskId);

    // Client A already subscribed (auth + subscribe to workspace).
    const A = await connectClient(h.port);
    await sendJson(A.ws, { type: 'auth', token: 'ce-admin' });
    await waitFor(() => A.messages.some((m) => m.type === 'auth' && m.ok === true));
    await sendJson(A.ws, { type: 'subscribe', instanceId: workspaceId });

    // Client B — about to subscribe_task.
    const B = await connectClient(h.port);
    await sendJson(B.ws, { type: 'auth', token: 'ce-admin' });
    await waitFor(() => B.messages.some((m) => m.type === 'auth' && m.ok === true));
    await sendJson(B.ws, { type: 'subscribe', instanceId: workspaceId });

    // Small delay so subscription takes effect.
    await new Promise((r) => setTimeout(r, 20));

    // Kick off subscribe_task + immediately (same tick) push 3 live messages
    // to force the buffer window. The live broadcasts must be BUFFERED until
    // the replay flush completes, then drained AFTER the 10 replay rows.
    const subscribePromise = sendJson(B.ws, {
      type: 'subscribe_task',
      taskId,
      lastSeq: 0,
    });
    // Immediately enqueue 3 live broadcasts for the same taskId.
    for (let i = 11; i <= 13; i += 1) {
      broadcastTaskMessage(workspaceId, taskId, {
        type: 'task:message',
        taskId,
        issueId,
        seq: i,
        payload: { taskId, issueId, seq: i, type: 'text', content: `live-${i}` },
      });
    }
    await subscribePromise;

    // Wait until B has received 13 task:message events total (10 replay + 3 live).
    await waitFor(() => {
      const tm = B.messages.filter((m) => m.type === 'task:message');
      return tm.length >= 13;
    }, 3000);

    const taskMessages = B.messages.filter((m) => m.type === 'task:message');
    // Strict seq-ascending order, no gaps, no duplicates.
    const seqs = taskMessages.map((m) => Number(m.seq));
    for (let i = 0; i < seqs.length; i += 1) {
      assert.equal(seqs[i], i + 1, `message ${i} has seq ${i + 1}`);
    }
    assert.equal(seqs.length, 13);

    A.close();
    B.close();
  });
});

test('pause_stream suppresses live; resume via subscribe_task replays gap (ST2)', async () => {
  await withHarness(async (h) => {
    const { taskId, issueId, workspaceId } = await seedOneTask(h.ctx.db, 302);

    // Seed 5 initial rows.
    for (let i = 0; i < 5; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `base-${i}`,
        workspaceId,
        issueId,
      });
    }
    await flushTaskMessages(taskId);

    const B = await connectClient(h.port);
    await sendJson(B.ws, { type: 'auth', token: 'ce-admin' });
    await waitFor(() => B.messages.some((m) => m.type === 'auth' && m.ok === true));
    await sendJson(B.ws, { type: 'subscribe', instanceId: workspaceId });
    await new Promise((r) => setTimeout(r, 10));
    await sendJson(B.ws, { type: 'subscribe_task', taskId, lastSeq: 0 });

    await waitFor(() => B.messages.filter((m) => m.type === 'task:message').length >= 5);

    // Pause the stream for this task.
    await sendJson(B.ws, { type: 'pause_stream', taskId });
    await new Promise((r) => setTimeout(r, 10));

    // Append 5 more rows while paused; broadcasts must NOT reach B.
    for (let i = 5; i < 10; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `paused-${i}`,
        workspaceId,
        issueId,
      });
    }
    await flushTaskMessages(taskId);
    await new Promise((r) => setTimeout(r, 50));

    const beforeResume = B.messages.filter((m) => m.type === 'task:message').length;
    assert.equal(beforeResume, 5, 'no new messages while paused');

    // Resume via subscribe_task with the current lastSeq=5. Server replays the gap.
    await sendJson(B.ws, { type: 'subscribe_task', taskId, lastSeq: 5 });
    await waitFor(() => B.messages.filter((m) => m.type === 'task:message').length >= 10, 3000);

    const all = B.messages.filter((m) => m.type === 'task:message');
    const seqs = all.map((m) => Number(m.seq));
    for (let i = 0; i < seqs.length; i += 1) {
      assert.equal(seqs[i], i + 1);
    }
    assert.equal(seqs.length, 10);

    B.close();
  });
});

test('500-row DESC cap + replay_truncated sentinel; REST ASC path independently returns 500/1..500 (ST2)', async () => {
  await withHarness(async (h) => {
    const { taskId, issueId, workspaceId } = await seedOneTask(h.ctx.db, 303);

    // Seed 600 rows.
    for (let i = 0; i < 600; i += 1) {
      appendTaskMessage(taskId, {
        type: 'text',
        content: `m${i}`,
        workspaceId,
        issueId,
      });
    }
    // Early-flush settle + residual drain.
    await new Promise((r) => setTimeout(r, 50));
    await flushTaskMessages(taskId);

    const B = await connectClient(h.port);
    await sendJson(B.ws, { type: 'auth', token: 'ce-admin' });
    await waitFor(() => B.messages.some((m) => m.type === 'auth' && m.ok === true));
    await sendJson(B.ws, { type: 'subscribe', instanceId: workspaceId });
    await new Promise((r) => setTimeout(r, 10));

    // subscribe_task with lastSeq=0 → should trigger DESC-500 replay; sentinel
    // first, then 500 rows in ASC order (seq 101..600).
    await sendJson(B.ws, { type: 'subscribe_task', taskId, lastSeq: 0 });
    // Wait for all 501 expected frames (1 sentinel + 500 rows).
    await waitFor(() => {
      const sentinel = B.messages.some(
        (m) => m.type === 'task:message' && m.replay_truncated === true,
      );
      const rowCount = B.messages.filter(
        (m) => m.type === 'task:message' && m.replay_truncated !== true,
      ).length;
      return sentinel && rowCount >= 500;
    }, 5000);

    // Sentinel MUST appear before any replay row — locate its index.
    const sentinelIdx = B.messages.findIndex(
      (m) => m.type === 'task:message' && m.replay_truncated === true,
    );
    assert.ok(sentinelIdx >= 0, 'replay_truncated sentinel present');
    assert.equal(B.messages[sentinelIdx]!.olderOmittedCount, 100);

    const rowsAfterSentinel = B.messages
      .slice(sentinelIdx + 1)
      .filter((m) => m.type === 'task:message' && m.replay_truncated !== true);
    assert.equal(rowsAfterSentinel.length, 500, '500 rows after the sentinel');
    assert.equal(Number(rowsAfterSentinel[0]!.seq), 101);
    assert.equal(Number(rowsAfterSentinel[499]!.seq), 600);

    // Independent REST path: GET equivalent via listMessagesAfterSeq(afterSeq=0)
    // returns the FIRST 500 rows (seq 1..500) with hasMore=true.
    const rest = await listMessagesAfterSeq(h.ctx.db, taskId, 0);
    assert.equal(rest.messages.length, REPLAY_ROW_CAP);
    assert.equal(rest.hasMore, true);
    assert.equal(rest.messages[0]!.seq, 1);
    assert.equal(rest.messages[REPLAY_ROW_CAP - 1]!.seq, 500);

    B.close();
  });
});
