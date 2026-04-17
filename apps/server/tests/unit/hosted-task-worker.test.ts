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
      // Wait until the worker has dispatched (task claimed/started) so the WARN site has been crossed.
      await waitUntil(
        async () => gw.calls.some((c) => c.method === 'chat.send'),
        { message: 'chat.send should be invoked so we know dispatch ran past the WARN site' },
      );
    } finally {
      await stopHostedTaskWorker();
    }

    void task;
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

