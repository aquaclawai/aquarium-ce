import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  buildCodexApprovalResponse,
  mapCodexNotificationToAgentMessage,
  runCodexTask,
} from '../../src/daemon/backends/codex.js';
import { detectCodex } from '../../src/daemon/backends/detect-codex.js';
import type { ClaimedTask } from '@aquarium/shared';

type FakeExecaResult = { stdout: string; stderr?: string };
type FakeExecaFn = (
  file: string,
  args: readonly string[],
  opts?: unknown,
) => Promise<FakeExecaResult>;

// Build a minimal ClaimedTask for runCodexTask drive tests.
function buildTask(overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  const now = new Date().toISOString();
  return {
    id: 't-1',
    workspaceId: 'w-1',
    issueId: 'i-1',
    agentId: 'a-1',
    runtimeId: 'rt-1',
    triggerCommentId: null,
    status: 'running',
    priority: 0,
    sessionId: null,
    workDir: null,
    error: null,
    result: null,
    metadata: {},
    dispatchedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    agent: { id: 'a-1', name: 'A', instructions: 'do it', customEnv: {}, customArgs: [] },
    issue: { id: 'i-1', issueNumber: 1, title: 'Test issue', description: null },
    triggerCommentContent: null,
    ...overrides,
  } as ClaimedTask;
}

// Build a fake execa-subprocess-like object that is awaitable and carries stdin/stdout/stderr.
function buildFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrites: string[] = [];
  stdin.on('data', (chunk: Buffer) => stdinWrites.push(chunk.toString('utf8')));

  let resolveExit: (v: { exitCode: number; isCanceled: boolean }) => void = () => undefined;
  const exitPromise = new Promise<{ exitCode: number; isCanceled: boolean }>((r) => {
    resolveExit = r;
  });

  const child = Object.assign(exitPromise, {
    stdin,
    stdout,
    stderr,
    pid: 4242,
    kill: () => true,
  });

  return { child, stdin, stdout, stderr, stdinWrites, exit: resolveExit };
}

// ── detectCodex ────────────────────────────────────────────────────────────

describe('detectCodex (BACKEND-02)', () => {
  test('happy path: PATH hit + version parse + app-server help recognised', async () => {
    const fakeExeca: FakeExecaFn = async (_file, args) => {
      if (args[0] === '--version') return { stdout: 'codex-cli 0.118.0', stderr: '' };
      if (args[0] === 'app-server') return { stdout: '[experimental] Run the app server\nOptions: --listen <URL>', stderr: '' };
      throw new Error(`unexpected args: ${args.join(' ')}`);
    };
    const result = await detectCodex({
      _which: async () => '/opt/homebrew/bin/codex',
      _exists: (p) => p === '/opt/homebrew/bin/codex',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.deepEqual(result, { path: '/opt/homebrew/bin/codex', version: '0.118.0' });
  });

  test('rejects codex binary lacking the app-server subcommand', async () => {
    const fakeExeca: FakeExecaFn = async (_file, args) => {
      if (args[0] === '--version') return { stdout: 'codex-cli 0.118.0', stderr: '' };
      if (args[0] === 'app-server') return { stdout: 'Usage: codex [options]', stderr: '' };
      throw new Error('unexpected');
    };
    const result = await detectCodex({
      _which: async () => '/opt/homebrew/bin/codex',
      _exists: (p) => p === '/opt/homebrew/bin/codex',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });

  test('returns null when PATH miss and no fallback exists', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: 'never', stderr: '' });
    const result = await detectCodex({
      _which: async () => null,
      _exists: () => false,
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });
});

// ── buildCodexApprovalResponse ────────────────────────────────────────────

describe('buildCodexApprovalResponse (T-22-05)', () => {
  test('default allow=undefined → approved', () => {
    const r = buildCodexApprovalResponse(
      { id: 42, method: 'item/commandExecution/requestApproval', params: { tool_name: 'exec', command: 'ls' } },
      undefined,
    );
    assert.equal(r.id, 42);
    assert.deepEqual(r.result, { decision: 'approved' });
  });

  test('allow=["*"] → approved', () => {
    const r = buildCodexApprovalResponse(
      { id: 'x', method: 'item/commandExecution/requestApproval', params: { tool_name: 'exec' } },
      ['*'],
    );
    const result = r.result as { decision?: string };
    assert.equal(result.decision, 'approved');
  });

  test('allow=[] → approved (empty list = approve-all, matching claude semantics)', () => {
    const r = buildCodexApprovalResponse(
      { id: 1, method: 'item/commandExecution/requestApproval', params: { tool_name: 'exec' } },
      [],
    );
    assert.equal((r.result as { decision?: string }).decision, 'approved');
  });

  test('allow=["exec"] — tool_name=exec → approved; tool_name=bash → denied', () => {
    const allow = ['exec'];
    const approved = buildCodexApprovalResponse(
      { id: 1, method: 'item/commandExecution/requestApproval', params: { tool_name: 'exec' } },
      allow,
    );
    const denied = buildCodexApprovalResponse(
      { id: 2, method: 'item/commandExecution/requestApproval', params: { tool_name: 'bash' } },
      allow,
    );
    assert.equal((approved.result as { decision?: string }).decision, 'approved');
    assert.equal((denied.result as { decision?: string }).decision, 'denied');
  });

  test('allow=["read"] with tool_name=exec → denied with message field', () => {
    const r = buildCodexApprovalResponse(
      { id: 10, method: 'item/commandExecution/requestApproval', params: { tool_name: 'exec' } },
      ['read'],
    );
    const result = r.result as { decision?: string; message?: string };
    assert.equal(result.decision, 'denied');
    assert.match(result.message ?? '', /allow-list/);
  });

  test('item/tool/requestUserInput → always { denied: true } regardless of allow', () => {
    const r = buildCodexApprovalResponse(
      { id: 99, method: 'item/tool/requestUserInput', params: { tool_name: 'anything' } },
      ['*'],
    );
    assert.equal(r.id, 99);
    assert.deepEqual(r.result, { denied: true });
  });

  test('fileChange approval — uses "edit" as tool_name fallback', () => {
    const r = buildCodexApprovalResponse(
      { id: 5, method: 'item/fileChange/requestApproval', params: {} },
      ['edit'],
    );
    assert.equal((r.result as { decision?: string }).decision, 'approved');
  });
});

// ── mapCodexNotificationToAgentMessage ─────────────────────────────────────

describe('mapCodexNotificationToAgentMessage (BACKEND-02)', () => {
  test('item/agentMessage/delta → text', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/agentMessage/delta',
      params: { delta: 'Hello' },
    });
    assert.deepEqual(out, [{ kind: 'text', text: 'Hello' }]);
  });

  test('item/agentMessage/delta with empty delta → []', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/agentMessage/delta',
      params: { delta: '' },
    });
    assert.deepEqual(out, []);
  });

  test('item/reasoning/textDelta → thinking', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/reasoning/textDelta',
      params: { delta: 'reasoning...' },
    });
    assert.deepEqual(out, [{ kind: 'thinking', thinking: 'reasoning...' }]);
  });

  test('item/completed type=agentMessage → text', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/completed',
      params: { item: { id: 'it_1', type: 'agentMessage', text: 'final' } },
    });
    assert.deepEqual(out, [{ kind: 'text', text: 'final' }]);
  });

  test('item/completed type=commandExecution status=succeeded → tool_use + tool_result (isError=false)', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/completed',
      params: {
        item: {
          id: 'cmd_1',
          type: 'commandExecution',
          command: 'ls /tmp',
          aggregatedOutput: 'foo\nbar',
          status: 'succeeded',
        },
      },
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      kind: 'tool_use',
      toolUseId: 'cmd_1',
      toolName: 'exec',
      input: { command: 'ls /tmp' },
    });
    assert.deepEqual(out[1], {
      kind: 'tool_result',
      toolUseId: 'cmd_1',
      content: 'foo\nbar',
      isError: false,
    });
  });

  test('item/completed type=commandExecution status=failed → tool_result isError=true', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/completed',
      params: {
        item: {
          id: 'cmd_2',
          type: 'commandExecution',
          command: 'false',
          aggregatedOutput: 'boom',
          status: 'failed',
        },
      },
    });
    const tr = out[1];
    assert.ok(tr && tr.kind === 'tool_result');
    assert.equal(tr.isError, true);
  });

  test('item/completed type=reasoning → thinking', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'item/completed',
      params: { item: { id: 'r1', type: 'reasoning', text: 'I considered...' } },
    });
    assert.deepEqual(out, [{ kind: 'thinking', thinking: 'I considered...' }]);
  });

  test('error notification → error AgentMessage', () => {
    const out = mapCodexNotificationToAgentMessage({
      method: 'error',
      params: { message: 'kaboom' },
    });
    assert.deepEqual(out, [{ kind: 'error', error: 'kaboom' }]);
  });

  test('thread/started, turn/started, turn/completed → [] (bookkeeping)', () => {
    for (const m of ['thread/started', 'turn/started', 'turn/completed']) {
      assert.deepEqual(
        mapCodexNotificationToAgentMessage({ method: m, params: {} }),
        [],
      );
    }
  });
});

// ── runCodexTask end-to-end with scripted mock child ───────────────────────

describe('runCodexTask (BACKEND-02 — end-to-end)', () => {
  test('handshake writes initialize → thread/start → turn/start in order', async () => {
    const { child, stdin, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string; content?: string | null }> = [];
    const ac = new AbortController();

    // Drive: wait for each stdin write, then push the corresponding response.
    // Use nextTick polling on stdinWrites length.
    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: { serverInfo: { name: 'codex-cli', version: '0.118.0' } } }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'thread_abc' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'turn_xyz' } } }) + '\n');
      // Then emit a turn/completed notification to break the loop
      stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread_abc', turnId: 'turn_xyz' } }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    const result = await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;
    void stdin;

    // First three stdin writes should be initialize, thread/start, turn/start in order.
    const lines = stdinWrites.join('').split('\n').filter(Boolean);
    assert.ok(lines.length >= 3, `expected at least 3 stdin writes, got ${lines.length}`);
    const parsed = lines.slice(0, 3).map((l) => JSON.parse(l) as { method: string; id?: number });
    assert.equal(parsed[0]?.method, 'initialize');
    assert.equal(parsed[1]?.method, 'thread/start');
    assert.equal(parsed[2]?.method, 'turn/start');
    assert.equal(parsed[0]?.id, 1);
    assert.equal(parsed[1]?.id, 2);
    assert.equal(parsed[2]?.id, 3);
    assert.equal(result.exitCode, 0);
    assert.equal(result.cancelled, false);
  });

  test('notification (agentMessage delta) → onAgentMessage text', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string; content?: string | null }> = [];
    const ac = new AbortController();

    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'thread_abc' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'turn_xyz' } } }) + '\n');
      stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Hello' } }) + '\n');
      stdout.write(JSON.stringify({ method: 'turn/completed', params: {} }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    const textMsg = received.find((m) => m.type === 'text');
    assert.ok(textMsg, 'expected a text message on the output stream');
    assert.equal(textMsg?.content, 'Hello');
  });

  test('approval request (allow) → stdin reply decision=approved + audit thinking [auto-approve]', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string; content?: string | null; metadata?: Record<string, unknown> }> = [];
    const ac = new AbortController();

    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'thread_abc' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'turn_xyz' } } }) + '\n');
      // Server-initiated approval request
      stdout.write(JSON.stringify({
        id: 100,
        method: 'item/commandExecution/requestApproval',
        params: { tool_name: 'exec', command: 'ls /tmp' },
      }) + '\n');
      // Give daemon time to respond, then emit turn/completed
      await waitForWrite(4);
      stdout.write(JSON.stringify({ method: 'turn/completed', params: {} }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    // stdin reply — 4th frame overall — should carry id=100 decision=approved.
    const lines = stdinWrites.join('').split('\n').filter(Boolean);
    const replyLine = lines.find((l) => {
      try {
        const p = JSON.parse(l) as { id?: number };
        return p.id === 100;
      } catch { return false; }
    });
    assert.ok(replyLine, 'expected an id=100 reply on stdin');
    const reply = JSON.parse(replyLine ?? '{}') as { id: number; result: { decision?: string } };
    assert.equal(reply.id, 100);
    assert.equal(reply.result.decision, 'approved');

    const audit = received.find((m) => m.type === 'thinking');
    assert.ok(audit, 'expected an audit thinking message');
    assert.match(String(audit?.content ?? ''), /\[auto-approve\] codex tool=exec/);
  });

  test('approval request (deny) — allow=["read"] with tool=exec → decision=denied + audit [deny]', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string; content?: string | null }> = [];
    const ac = new AbortController();

    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'thread_abc' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'turn_xyz' } } }) + '\n');
      stdout.write(JSON.stringify({
        id: 101,
        method: 'item/commandExecution/requestApproval',
        params: { tool_name: 'exec', command: 'rm -rf /' },
      }) + '\n');
      await waitForWrite(4);
      stdout.write(JSON.stringify({ method: 'turn/completed', params: {} }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['read'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    const lines = stdinWrites.join('').split('\n').filter(Boolean);
    const replyLine = lines.find((l) => {
      try {
        const p = JSON.parse(l) as { id?: number };
        return p.id === 101;
      } catch { return false; }
    });
    assert.ok(replyLine);
    const reply = JSON.parse(replyLine ?? '{}') as { id: number; result: { decision?: string } };
    assert.equal(reply.result.decision, 'denied');

    const audit = received.find((m) => m.type === 'thinking');
    assert.match(String(audit?.content ?? ''), /\[deny\] codex tool=exec/);
  });

  test('abortSignal.aborted → turn/interrupt written to stdin before loop exit', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string }> = [];
    const ac = new AbortController();

    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'thread_abc' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'turn_xyz' } } }) + '\n');
      // Emit one delta so the consumer loop is running
      stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'working' } }) + '\n');
      // Give the daemon time to process, then trigger abort.
      await new Promise((r) => setTimeout(r, 20));
      ac.abort();
      // Wait for turn/interrupt on stdin.
      await waitForWrite(4);
      // Close stream + resolve exit.
      stdout.end();
      exit({ exitCode: 143, isCanceled: true });
    })();

    await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    const lines = stdinWrites.join('').split('\n').filter(Boolean);
    const interruptLine = lines.find((l) => {
      try {
        const p = JSON.parse(l) as { method?: string };
        return p.method === 'turn/interrupt';
      } catch { return false; }
    });
    assert.ok(interruptLine, 'expected a turn/interrupt frame on stdin after abort');
    const parsed = JSON.parse(interruptLine ?? '{}') as { method: string; params: { threadId?: string; turnId?: string } };
    assert.equal(parsed.method, 'turn/interrupt');
    assert.equal(parsed.params.threadId, 'thread_abc');
    assert.equal(parsed.params.turnId, 'turn_xyz');
  });

  test('malformed JSON-RPC frame (no id, no method) is dropped — no crash, no onAgentMessage', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{ type: string }> = [];
    const ac = new AbortController();

    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 't' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 't1' } } }) + '\n');
      // Malformed envelope (no id, no method, just a random object).
      stdout.write(JSON.stringify({ foo: 'bar' }) + '\n');
      // Also a valid text notification so we can confirm loop is still alive.
      stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'alive' } }) + '\n');
      stdout.write(JSON.stringify({ method: 'turn/completed', params: {} }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    const result = await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    assert.equal(result.exitCode, 0);
    const textMsgs = received.filter((m) => m.type === 'text');
    assert.equal(textMsgs.length, 1);
  });

  test('turn/completed exits consumer loop cleanly; runCodexTask resolves {exitCode:0, cancelled:false}', async () => {
    const { child, stdout, stdinWrites, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const ac = new AbortController();
    const waitForWrite = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const tick = (): void => {
          if (stdinWrites.length >= n) return resolve();
          setImmediate(tick);
        };
        tick();
      });

    const driver = (async (): Promise<void> => {
      await waitForWrite(1);
      stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
      await waitForWrite(2);
      stdout.write(JSON.stringify({ id: 2, result: { threadId: 'th' } }) + '\n');
      await waitForWrite(3);
      stdout.write(JSON.stringify({ id: 3, result: { turn: { turnId: 'tu' } } }) + '\n');
      stdout.write(JSON.stringify({ method: 'turn/completed', params: {} }) + '\n');
      stdout.end();
      exit({ exitCode: 0, isCanceled: false });
    })();

    const result = await runCodexTask({
      task: buildTask(),
      binaryPath: '/bin/fake-codex',
      config: { allow: ['*'], gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: () => undefined,
      abortSignal: ac.signal,
      _spawn,
    });
    await driver;

    assert.deepEqual(result, { exitCode: 0, cancelled: false });
  });
});
