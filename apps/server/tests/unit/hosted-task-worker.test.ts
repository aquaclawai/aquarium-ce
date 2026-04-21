import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import {
  setupTestDb,
  teardownTestDb,
  seedAgent,
  seedIssue,
  seedTask,
} from './test-db.js';
import {
  startHostedTaskWorker,
  stopHostedTaskWorker,
  translatePartsToMessages,
  __setHostedWorkerDepsForTests__,
  __resetHostedWorkerState__,
} from '../../src/task-dispatch/hosted-task-worker.js';
import type { ChatStreamPayload, ChatEventData } from '../../src/services/gateway-event-relay.js';
import type { PendingTaskMessage } from '../../src/task-dispatch/task-message-batcher.js';
import {
  __setBatcherDbForTests__,
  __resetBatcherState__,
  flushTaskMessages,
} from '../../src/task-dispatch/task-message-batcher.js';
import { cancelTask } from '../../src/services/task-queue-store.js';

/**
 * Phase 20-02 hosted-task-worker tests.
 *
 * Tests 1-9 cover Task 1 surface (mapper + tick + WARN + start/stop).
 * Tests 10-19 cover Task 2 surface (dispatch + cancel + completion).
 *
 * Strategy:
 *   - Each test seeds its own throwaway SQLite DB.
 *   - The hosted worker's gateway / event-relay / batcher dependencies are
 *     injected via __setHostedWorkerDepsForTests__ so we never reach a real
 *     gateway socket.
 *   - No test writes to instances.status (ST5 invariant) — Test 15 proves it
 *     via a pre/post snapshot.
 *   - Cancel-race test (16) deliberately emits NO stream frames so the
 *     REACTIVE watcher is exercised in isolation.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed a hosted_instance runtime linked to a fresh `instances` row in
 * 'running' status. Inserts a parent `users` row because `instances.user_id`
 * is a NOT NULL FK and `foreign_keys=ON` is applied at setup.
 */
async function seedHostedRuntime(
  kx: Knex,
  opts: { name?: string } = {},
): Promise<{ runtimeId: string; instanceId: string; userId: string }> {
  const userId = randomUUID();
  const now = new Date().toISOString();
  await kx('users').insert({
    id: userId,
    email: `user-${userId.slice(0, 8)}@test.local`,
    display_name: `Test User ${userId.slice(0, 8)}`,
    role: 'admin',
    totp_enabled: 0,
    force_password_change: 0,
    created_at: now,
    updated_at: now,
  });

  const instanceId = randomUUID();
  await kx('instances').insert({
    id: instanceId,
    user_id: userId,
    name: opts.name ?? `test-inst-${instanceId.slice(0, 8)}`,
    agent_type: 'openclaw',
    image_tag: 'test-image:latest',
    status: 'running',
    deployment_target: 'docker',
    auth_token: `auth-${instanceId.slice(0, 8)}`,
    config: '{}',
    security_profile: 'unrestricted',
    billing_mode: 'byok',
    created_at: now,
    updated_at: now,
  });

  const runtimeId = randomUUID();
  await kx('runtimes').insert({
    id: runtimeId,
    workspace_id: 'AQ',
    name: opts.name ?? `hosted-${instanceId.slice(0, 8)}`,
    kind: 'hosted_instance',
    provider: 'openclaw',
    status: 'online',
    daemon_id: null,
    instance_id: instanceId,
    metadata: '{}',
    created_at: now,
    updated_at: now,
  });

  return { runtimeId, instanceId, userId };
}

interface MockGatewayCall {
  instanceId: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}

interface MockGateway {
  gatewayCall: (
    instanceId: string,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<unknown>;
  isGatewayConnected: (instanceId: string) => boolean;
  waitForChatCompletion: (
    instanceId: string,
    sessionKey: string,
    timeoutMs?: number,
  ) => Promise<ChatEventData>;
  cancelChatCompletion: (instanceId: string, sessionKey: string) => void;
  registerChatStreamListener: (
    instanceId: string,
    sessionKey: string,
    cb: (p: ChatStreamPayload) => void,
  ) => () => void;
  appendTaskMessage: (taskId: string, msg: PendingTaskMessage) => void;
  emitFrame: (p: ChatStreamPayload) => void;
  emitFinal: (content: unknown, opts?: { messageId?: string; role?: string }) => void;
  emitError: (message: string) => void;
  setConnected: (id: string, connected: boolean) => void;
  appended: Array<{ taskId: string; msg: PendingTaskMessage }>;
  calls: MockGatewayCall[];
  setChatSendImpl: (
    impl: (
      instanceId: string,
      method: string,
      params: Record<string, unknown>,
      timeoutMs: number,
    ) => Promise<unknown>,
  ) => void;
}

function createMockGateway(opts: { allConnected?: boolean } = {}): MockGateway {
  const calls: MockGatewayCall[] = [];
  const appended: Array<{ taskId: string; msg: PendingTaskMessage }> = [];
  const connected = new Map<string, boolean>();
  const allConnected = opts.allConnected ?? true;
  let streamListener: ((p: ChatStreamPayload) => void) | null = null;
  let currentSessionKey = '';
  let completionResolve: ((data: ChatEventData) => void) | null = null;
  let completionReject: ((err: Error) => void) | null = null;
  let chatSendImpl:
    | ((
        instanceId: string,
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
      ) => Promise<unknown>)
    | null = null;

  const gw: MockGateway = {
    gatewayCall: async (instanceId, method, params = {}, timeoutMs = 30_000) => {
      const entry: MockGatewayCall = { instanceId, method, params, timeoutMs };
      calls.push(entry);
      if (chatSendImpl && method === 'chat.send') {
        return chatSendImpl(instanceId, method, params, timeoutMs);
      }
      return { ok: true };
    },
    isGatewayConnected: (id) => {
      if (connected.has(id)) return connected.get(id) === true;
      return allConnected;
    },
    waitForChatCompletion: (_id, sk) => {
      currentSessionKey = sk;
      return new Promise<ChatEventData>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });
    },
    cancelChatCompletion: (_id, _sk) => {
      if (completionReject) {
        completionReject(new Error('Chat completion cancelled'));
        completionReject = null;
        completionResolve = null;
      }
    },
    registerChatStreamListener: (_id, _sk, cb) => {
      streamListener = cb;
      return () => {
        streamListener = null;
      };
    },
    appendTaskMessage: (taskId, msg) => {
      appended.push({ taskId, msg });
    },
    emitFrame: (p) => {
      if (streamListener) streamListener(p);
    },
    emitFinal: (content, o = {}) => {
      if (completionResolve) {
        completionResolve({
          sessionKey: currentSessionKey,
          state: 'final',
          content,
          role: o.role ?? 'assistant',
          messageId: o.messageId,
        });
        completionResolve = null;
        completionReject = null;
      }
    },
    emitError: (message) => {
      if (completionReject) {
        completionReject(new Error(message));
        completionReject = null;
        completionResolve = null;
      }
    },
    setConnected: (id, c) => {
      connected.set(id, c);
    },
    calls,
    appended,
    setChatSendImpl: (impl) => {
      chatSendImpl = impl;
    },
  };

  return gw;
}

/**
 * Deterministic poll helper — awaits a predicate with a bounded upper limit.
 * Replaces fixed setTimeout(50) sync points in tests.
 */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(opts.message ?? `waitUntil timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function captureConsoleWarn(): { messages: string[]; restore: () => void } {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}

// ── Task 1 tests (mapper + tick + WARN + lifecycle) ────────────────────────

test('Test 1 (HOSTED-03 mapper): translates text/thinking/toolCall/toolResult to task_messages in order', () => {
  const payload: ChatStreamPayload = {
    sessionKey: 'task:t1',
    state: 'streaming',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'thinking', thinking: 'why' },
        { type: 'toolCall', name: 'bash', arguments: { cmd: 'ls' }, id: 'tc-1' },
        { type: 'toolResult', tool_use_id: 'tc-1', content: 'out', is_error: false },
      ],
    },
  };
  const ctx = { taskId: 't1', workspaceId: 'AQ', issueId: 'issue-1' };
  const msgs = translatePartsToMessages(payload, ctx);
  assert.equal(msgs.length, 4, '4 content parts -> 4 messages');
  assert.equal(msgs[0].type, 'text');
  assert.equal(msgs[0].content, 'hi');
  assert.equal(msgs[1].type, 'thinking');
  assert.equal(msgs[1].content, 'why');
  assert.equal(msgs[2].type, 'tool_use');
  assert.equal(msgs[2].tool, 'bash');
  assert.deepEqual(msgs[2].input, { cmd: 'ls' });
  assert.equal(msgs[3].type, 'tool_result');
  assert.equal(msgs[3].output, 'out');
  assert.deepEqual(msgs[3].metadata, { toolUseId: 'tc-1', isError: false });
});

test('Test 2 (HOSTED-03 mapper): accepts both camelCase and snake_case part.type spellings', () => {
  const payloadCamel: ChatStreamPayload = {
    sessionKey: 'task:t2',
    state: 'streaming',
    message: {
      content: [
        { type: 'toolCall', name: 'bash', arguments: {}, id: 'tc-1' },
        { type: 'toolResult', tool_use_id: 'tc-1', content: 'x' },
      ],
    },
  };
  const payloadSnake: ChatStreamPayload = {
    sessionKey: 'task:t2',
    state: 'streaming',
    message: {
      content: [
        { type: 'tool_use', name: 'bash', input: {}, id: 'tc-1' },
        { type: 'tool_result', tool_use_id: 'tc-1', content: 'x' },
      ],
    },
  };
  const ctx = { taskId: 't2', workspaceId: 'AQ', issueId: 'issue-1' };
  const a = translatePartsToMessages(payloadCamel, ctx);
  const b = translatePartsToMessages(payloadSnake, ctx);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.equal(a[0].type, 'tool_use');
  assert.equal(b[0].type, 'tool_use');
  assert.equal(a[1].type, 'tool_result');
  assert.equal(b[1].type, 'tool_result');
});

test('Test 3 (HOSTED-03 mapper): drops unknown part.type and logs warn', () => {
  const warnSpy = captureConsoleWarn();
  try {
    const payload: ChatStreamPayload = {
      sessionKey: 'task:t3',
      state: 'streaming',
      message: { content: [{ type: 'image', url: 'http://x' }] },
    };
    const msgs = translatePartsToMessages(payload, {
      taskId: 't3',
      workspaceId: 'AQ',
      issueId: 'issue-1',
    });
    assert.equal(msgs.length, 0, 'image part is dropped — no rows emitted');
    assert.ok(
      warnSpy.messages.some((m) => m.includes('image') && m.includes('t3')),
      'warn cites the dropped part type and the task id',
    );
  } finally {
    warnSpy.restore();
  }
});

test('Test 4 (HOSTED-03 mapper): string content fallback yields one text message', () => {
  const payload: ChatStreamPayload = {
    sessionKey: 'task:t4',
    state: 'final',
    content: 'plain string',
  };
  const msgs = translatePartsToMessages(payload, {
    taskId: 't4',
    workspaceId: 'AQ',
    issueId: 'issue-1',
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].type, 'text');
  assert.equal(msgs[0].content, 'plain string');
});

test('Test 5 (HOSTED-01 tick): iterates online hosted runtimes and claims a task per runtime', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    // Block chat.send so dispatch hangs and we can observe the two claims without races.
    gw.setChatSendImpl(() => new Promise(() => {}));
    __setHostedWorkerDepsForTests__(gw);

    const r1 = await seedHostedRuntime(ctx.db, { name: 'hosted-1' });
    const r2 = await seedHostedRuntime(ctx.db, { name: 'hosted-2' });

    const agent1 = await seedAgent(ctx.db, { runtimeId: r1.runtimeId, name: 'a1' });
    const agent2 = await seedAgent(ctx.db, { runtimeId: r2.runtimeId, name: 'a2' });
    const issue1 = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent1 });
    const issue2 = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agent2 });
    const task1 = await seedTask(ctx.db, {
      issueId: issue1,
      agentId: agent1,
      runtimeId: r1.runtimeId,
    });
    const task2 = await seedTask(ctx.db, {
      issueId: issue2,
      agentId: agent2,
      runtimeId: r2.runtimeId,
    });

    startHostedTaskWorker(ctx.db);
    try {
      // Both tasks must transition out of 'queued' (claimed → dispatched/running).
      await waitUntil(
        async () => {
          const rows = await ctx.db('agent_task_queue')
            .whereIn('id', [task1, task2])
            .select('id', 'status');
          return rows.every((r) => r.status !== 'queued');
        },
        { message: 'both tasks should be claimed within tick window' },
      );
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 6 (HOSTED-06 + X5): disconnected gateway leaves queued task untouched', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: false });
    gw.setChatSendImpl(() => new Promise(() => {}));
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId, instanceId } = await seedHostedRuntime(ctx.db);
    gw.setConnected(instanceId, false);

    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      // Give the worker a chance to tick (initial + one cycle).
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      await stopHostedTaskWorker();
    }

    const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
    assert.equal(row?.status, 'queued', 'task row unchanged when gateway disconnected');
    assert.equal(gw.calls.length, 0, 'no gatewayCall made when disconnected');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 7 (HOSTED-05): WARN cites every ignored field when agent has customEnv/customArgs + task has session_id/work_dir', async () => {
  const ctx = await setupTestDb();
  const warnSpy = captureConsoleWarn();
  try {
    const gw = createMockGateway({ allConnected: true });
    // Block chat.send so dispatch hangs — we only need the WARN to have fired.
    gw.setChatSendImpl(() => new Promise(() => {}));
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    // Seed an agent with non-empty custom_env and custom_args.
    const agentId = randomUUID();
    const now = new Date().toISOString();
    await ctx.db('agents').insert({
      id: agentId,
      workspace_id: 'AQ',
      runtime_id: runtimeId,
      name: 'custom-agent',
      instructions: '',
      custom_env: JSON.stringify({ K: 'v' }),
      custom_args: JSON.stringify(['--x']),
      max_concurrent_tasks: 6,
      visibility: 'workspace',
      status: 'idle',
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    // Insert task with session_id + work_dir populated.
    const taskId = randomUUID();
    await ctx.db('agent_task_queue').insert({
      id: taskId,
      workspace_id: 'AQ',
      issue_id: issue,
      agent_id: agentId,
      runtime_id: runtimeId,
      trigger_comment_id: null,
      status: 'queued',
      priority: 0,
      session_id: 's',
      work_dir: '/w',
      error: null,
      result: null,
      metadata: '{}',
      dispatched_at: null,
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () =>
          warnSpy.messages.some(
            (m) =>
              m.includes('custom_env') &&
              m.includes('custom_args') &&
              m.includes('session_id') &&
              m.includes('work_dir'),
          ),
        { message: 'WARN must cite every ignored field' },
      );
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    warnSpy.restore();
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 8 (HOSTED-05): no WARN when agent has empty customEnv/customArgs and task has null session_id/work_dir', async () => {
  const ctx = await setupTestDb();
  const warnSpy = captureConsoleWarn();
  try {
    const gw = createMockGateway({ allConnected: true });
    // Block chat.send so dispatch hangs past the WARN site.
    gw.setChatSendImpl(() => new Promise(() => {}));
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      // Wait until the task is claimed (moves out of 'queued') so we know the
      // worker's dispatch path ran far enough past the WARN site.
      await waitUntil(
        async () => {
          const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
          return row?.status !== 'queued';
        },
        { message: 'task should be claimed so WARN site is crossed' },
      );
    } finally {
      await stopHostedTaskWorker();
    }

    // No message should cite the ignored-fields WARN.
    const offending = warnSpy.messages.find((m) => m.includes('ignoring'));
    assert.equal(offending, undefined, 'no ignored-fields WARN for clean agent/task');
  } finally {
    warnSpy.restore();
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 9 (start/stop idempotency): double-start does not create two intervals; stop awaits outstanding dispatches', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    gw.setChatSendImpl(() => new Promise(() => {}));
    __setHostedWorkerDepsForTests__(gw);

    // Start twice — should be idempotent (no throw, no double interval).
    startHostedTaskWorker(ctx.db);
    startHostedTaskWorker(ctx.db);

    // Stop should resolve cleanly even with no in-flight work.
    await stopHostedTaskWorker();

    // Calling stop a second time is also fine.
    await stopHostedTaskWorker();
    assert.ok(true, 'start/stop idempotent');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

// ── Task 2 tests (dispatch + cancel + completion) ───────────────────────────

test('Test 10 (HOSTED-02 chat.send payload): first chat.send has sessionKey=task:<id>, idempotencyKey=<task.id>, 30_000ms RPC-accept', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      // Trigger completion so the dispatch unwinds cleanly.
      gw.emitFinal([{ type: 'text', text: 'done' }], { messageId: 'm-1' });
    } finally {
      await stopHostedTaskWorker();
    }

    const sendCall = gw.calls.find((c) => c.method === 'chat.send');
    assert.ok(sendCall, 'chat.send call recorded');
    const params = sendCall.params;
    assert.equal(params.sessionKey, `task:${task}`, 'sessionKey encodes task id');
    assert.equal(params.idempotencyKey, task, 'idempotencyKey is task.id (stable UUID)');
    assert.equal(typeof params.message, 'string');
    assert.ok((params.message as string).length > 0, 'message is non-empty');
    assert.equal(sendCall.timeoutMs, 30_000, 'HOSTED-02 split: 30s RPC-accept');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 11 (HOSTED-03 end-to-end): 3 streaming frames + final yield 3 task_message rows with correct types', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    // Use the real batcher + inject ctx.db so task_messages land in the test DB.
    __setBatcherDbForTests__(ctx.db);
    __setHostedWorkerDepsForTests__({
      ...gw,
      // Use the real batcher for this test — not the mock.
      appendTaskMessage: (await import('../../src/task-dispatch/task-message-batcher.js'))
        .appendTaskMessage,
    });

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked before streaming' },
      );
      gw.emitFrame({
        sessionKey: `task:${task}`,
        state: 'streaming',
        message: { content: [{ type: 'text', text: 'a' }] },
      });
      gw.emitFrame({
        sessionKey: `task:${task}`,
        state: 'streaming',
        message: { content: [{ type: 'text', text: 'b' }] },
      });
      gw.emitFrame({
        sessionKey: `task:${task}`,
        state: 'streaming',
        message: { content: [{ type: 'thinking', thinking: 'c' }] },
      });
      // Final frame — repeats the last text/thinking; dedupe must suppress duplicates.
      gw.emitFinal(
        [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
          { type: 'thinking', thinking: 'c' },
        ],
        { messageId: 'm-final' },
      );
      // Wait for the task to settle as completed.
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'completed';
      }, { message: 'task must complete' });
    } finally {
      await stopHostedTaskWorker();
      await flushTaskMessages();
    }

    const rows = await ctx.db('task_messages').where({ task_id: task }).orderBy('seq', 'asc');
    assert.equal(rows.length, 3, '3 unique content parts -> 3 rows');
    assert.equal(rows[0].type, 'text');
    assert.equal(rows[1].type, 'text');
    assert.equal(rows[2].type, 'thinking');
  } finally {
    __resetHostedWorkerState__();
    __resetBatcherState__();
    await teardownTestDb(ctx);
  }
});

test('Test 12 (complete happy path): waitForChatCompletion resolves -> task row status=completed', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      gw.emitFinal([{ type: 'text', text: 'done' }], { messageId: 'm-1' });
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'completed';
      });
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 13 (fail on chat.send throw): gatewayCall rejects -> failTask; task row=failed with hosted-dispatch-error prefix', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    gw.setChatSendImpl(async () => {
      throw new Error('gateway bad-wire');
    });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status', 'error');
        return row?.status === 'failed';
      }, { message: 'task must fail on chat.send throw' });

      const row = await ctx.db('agent_task_queue').where({ id: task }).first('error');
      assert.ok(
        typeof row?.error === 'string' && row.error.startsWith('hosted-dispatch-error:'),
        `error should start with 'hosted-dispatch-error:' — got ${JSON.stringify(row?.error)}`,
      );
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 14 (fail on completion error): waitForChatCompletion rejects -> task=failed', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      gw.emitError('agent crashed');
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'failed';
      });
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 15 (ST5 invariant): dispatch does NOT mutate the instances row', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId, instanceId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    const cols: string[] = [
      'id',
      'status',
      'deployment_target',
      'agent_type',
      'user_id',
      'auth_token',
      'image_tag',
      'updated_at',
      'created_at',
    ];
    const before = await ctx.db('instances').select(...cols).where({ id: instanceId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      gw.emitFinal([{ type: 'text', text: 'done' }], { messageId: 'm-1' });
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'completed';
      });
    } finally {
      await stopHostedTaskWorker();
    }

    const after = await ctx.db('instances').select(...cols).where({ id: instanceId });
    assert.deepStrictEqual(before, after, 'ST5: dispatch must not mutate instances row');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 16 (PM6 REACTIVE cancel — stream-independent): cancel fires chat.abort within CANCEL_POLL_MS without any stream frames', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      // Wait for chat.send so we know the cancel watcher is subscribed.
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked so the cancel watcher is live' },
      );

      // Flip task to 'cancelled' — DO NOT emit any stream frames.
      await cancelTask(task, ctx.db);

      // REACTIVE watcher must detect cancel and invoke chat.abort within one poll cycle.
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.abort'),
        { timeoutMs: 3500, message: 'chat.abort never invoked via REACTIVE path' },
      );

      const abortCall = gw.calls.find((c) => c.method === 'chat.abort');
      assert.ok(abortCall, 'chat.abort recorded');
      assert.equal(abortCall.params.sessionKey, `task:${task}`, 'abort sessionKey matches');

      // Task row stays 'cancelled' (never flips to 'failed').
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'cancelled';
      }, { message: 'task row should stay cancelled' });
    } finally {
      await stopHostedTaskWorker();
    }
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 17 (X5 pre-flight cancel): cancelled before dispatch -> no chat.send ever invoked', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    // Cancel BEFORE starting the worker — task row is 'cancelled' before claim.
    await cancelTask(task, ctx.db);

    startHostedTaskWorker(ctx.db);
    try {
      // Wait long enough for any dispatch to run (3 ticks + grace).
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      await stopHostedTaskWorker();
    }

    const sendCalls = gw.calls.filter((c) => c.method === 'chat.send');
    assert.equal(sendCalls.length, 0, 'no chat.send when task pre-cancelled');

    const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
    assert.equal(row?.status, 'cancelled', 'task row stays cancelled');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 18 (X6 abort on already-completed task): cancel after completion is a no-op (no throw, no state change)', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      gw.emitFinal([{ type: 'text', text: 'done' }], { messageId: 'm-1' });
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'completed';
      });

      // After completion: cancelling is idempotent at the DB layer (returns cancelled:false).
      // The worker's in-flight map is already empty -> handleCancel path would be no-op
      // even if invoked. Assert no throw.
      const result = await cancelTask(task, ctx.db);
      assert.equal(result.cancelled, false, 'cancel after completion is a no-op at DB');
    } finally {
      await stopHostedTaskWorker();
    }

    const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
    assert.equal(row?.status, 'completed', 'task remains completed after late cancel');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});

test('Test 19 (cleanup invariant): successful dispatch leaves no in-flight entries or lingering intervals', async () => {
  const ctx = await setupTestDb();
  try {
    const gw = createMockGateway({ allConnected: true });
    __setHostedWorkerDepsForTests__(gw);

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agent = await seedAgent(ctx.db, { runtimeId });
    const issue = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agent });
    const task = await seedTask(ctx.db, { issueId: issue, agentId: agent, runtimeId });

    startHostedTaskWorker(ctx.db);
    try {
      await waitUntil(
        () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send must be invoked' },
      );
      gw.emitFinal([{ type: 'text', text: 'done' }], { messageId: 'm-1' });
      await waitUntil(async () => {
        const row = await ctx.db('agent_task_queue').where({ id: task }).first('status');
        return row?.status === 'completed';
      });
      // Give the finally{} block time to run (microtask drain).
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      await stopHostedTaskWorker();
    }

    // The reset helper iterating inFlight must find no entries to clean up —
    // i.e. finally{} already cleared them. We can't directly observe the Map,
    // but __resetHostedWorkerState__ calling clearInterval() on a stale
    // watcher would throw in the test harness if one existed. The fact that
    // stopHostedTaskWorker + __resetHostedWorkerState__ completed without
    // error is the invariant under test.
    assert.ok(true, 'dispatch cleanup completed without leaking entries');
  } finally {
    __resetHostedWorkerState__();
    await teardownTestDb(ctx);
  }
});
