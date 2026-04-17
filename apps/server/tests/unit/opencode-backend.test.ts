/**
 * Phase 22 Plan 03 — OpenCode backend unit tests (BACKEND-03 part 1).
 *
 * Covers:
 *   • mapOpencodeEventToAgentMessage pure-function shape (text, tool_use,
 *     tool_use failed, tool_use non-string output, error, step_start /
 *     step_finish / unknown → []).
 *   • detectOpencode happy path + miss.
 *   • runOpenCodeTask spawn argv shape (verifies the mandatory
 *     `['run', '--format', 'json', ...]` vector and the T-22-11 regression
 *     guard — argv MUST NOT carry `-s` / `-c` / `--share` session-resume flags).
 *   • runOpenCodeTask stdin behaviour — stdin is closed immediately because
 *     OpenCode reads the prompt from argv (keeping stdin open stalls the child).
 *   • Fixture round-trip — `opencode-stream-sample.ndjson` piped through a
 *     PassThrough fake-child and the expected sequence of
 *     PendingTaskMessageWire entries is captured; the malformed line is
 *     dropped (PG10 carry-forward).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  mapOpencodeEventToAgentMessage,
  runOpenCodeTask,
  spawnOpenCode,
} from '../../src/daemon/backends/opencode.js';
import { detectOpencode } from '../../src/daemon/backends/detect-opencode.js';
import type { ClaimedTask } from '@aquarium/shared';

type FakeExecaResult = { stdout: string; stderr?: string };
type FakeExecaFn = (
  file: string,
  args: readonly string[],
  opts?: unknown,
) => Promise<FakeExecaResult>;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'fixtures', 'opencode-stream-sample.ndjson');

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

/**
 * Build an awaitable fake-child (execa's Subprocess shape: it's a Promise
 * augmented with stdin/stdout/stderr). `exit()` resolves the awaitable.
 */
function buildFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinEnds: number[] = [];
  const origEnd = stdin.end.bind(stdin);
  stdin.end = ((...args: unknown[]) => {
    stdinEnds.push(Date.now());
    return origEnd(...(args as Parameters<typeof origEnd>));
  }) as typeof stdin.end;

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

  return { child, stdin, stdout, stderr, stdinEnds, exit: resolveExit };
}

// ── mapOpencodeEventToAgentMessage ─────────────────────────────────────────

describe('mapOpencodeEventToAgentMessage (BACKEND-03 part 1)', () => {
  test('text event → one text AgentMessage', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'text',
      timestamp: 0,
      sessionID: 's',
      part: { id: 'p1', type: 'text', text: 'hi', time: { start: 0, end: 0 } },
    });
    assert.deepEqual(out, [{ kind: 'text', text: 'hi' }]);
  });

  test('tool_use status=completed → emits BOTH tool_use and tool_result (isError=false)', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'tool_use',
      timestamp: 0,
      sessionID: 's',
      part: {
        callID: 'c1',
        tool: 'bash',
        state: { status: 'completed', input: { cmd: 'ls' }, output: 'hello' },
      },
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      kind: 'tool_use',
      toolUseId: 'c1',
      toolName: 'bash',
      input: { cmd: 'ls' },
    });
    assert.deepEqual(out[1], {
      kind: 'tool_result',
      toolUseId: 'c1',
      content: 'hello',
      isError: false,
    });
  });

  test('tool_use status=failed → tool_result.isError=true', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'tool_use',
      timestamp: 0,
      sessionID: 's',
      part: {
        callID: 'c2',
        tool: 'bash',
        state: { status: 'failed', input: {}, output: 'boom' },
      },
    });
    const tr = out[1];
    assert.ok(tr && tr.kind === 'tool_result');
    assert.equal(tr.isError, true);
  });

  test('tool_use with non-string output → content is JSON.stringify(output)', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'tool_use',
      timestamp: 0,
      sessionID: 's',
      part: {
        callID: 'c3',
        tool: 'read',
        state: { status: 'completed', input: {}, output: { lines: 3, first: 'hello' } },
      },
    });
    const tr = out[1];
    assert.ok(tr && tr.kind === 'tool_result');
    assert.equal(tr.content, JSON.stringify({ lines: 3, first: 'hello' }));
  });

  test('error event → error AgentMessage with message from error.data.message', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'error',
      timestamp: 0,
      sessionID: 's',
      error: { name: 'UnknownError', data: { message: 'oops' } },
    });
    assert.deepEqual(out, [{ kind: 'error', error: 'oops' }]);
  });

  test('error event missing message → fallback string "opencode error"', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'error',
      timestamp: 0,
      sessionID: 's',
      error: {},
    } as unknown as Parameters<typeof mapOpencodeEventToAgentMessage>[0]);
    assert.deepEqual(out, [{ kind: 'error', error: 'opencode error' }]);
  });

  test('step_start, step_finish → [] (bookkeeping)', () => {
    for (const t of ['step_start', 'step_finish']) {
      const out = mapOpencodeEventToAgentMessage({
        type: t,
        timestamp: 0,
        sessionID: 's',
        part: { reason: 'stop' },
      } as unknown as Parameters<typeof mapOpencodeEventToAgentMessage>[0]);
      assert.deepEqual(out, [], `expected [] for type=${t}`);
    }
  });

  test('unknown type → [] (safe default)', () => {
    const out = mapOpencodeEventToAgentMessage({
      type: 'not_a_real_event',
      timestamp: 0,
      sessionID: 's',
    } as unknown as Parameters<typeof mapOpencodeEventToAgentMessage>[0]);
    assert.deepEqual(out, []);
  });
});

// ── detectOpencode ─────────────────────────────────────────────────────────

describe('detectOpencode (BACKEND-03)', () => {
  test('happy path: PATH hit + version parse', async () => {
    const fakeExeca: FakeExecaFn = async (_file, args) => {
      if (args[0] === '--version') return { stdout: 'opencode v1.2.3', stderr: '' };
      throw new Error(`unexpected args: ${args.join(' ')}`);
    };
    const result = await detectOpencode({
      _which: async () => '/Users/shuai/.opencode/bin/opencode',
      _exists: (p) => p === '/Users/shuai/.opencode/bin/opencode',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.deepEqual(result, { path: '/Users/shuai/.opencode/bin/opencode', version: '1.2.3' });
  });

  test('returns null when PATH miss and no fallback exists', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: 'never', stderr: '' });
    const result = await detectOpencode({
      _which: async () => null,
      _exists: () => false,
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });
});

// ── spawnOpenCode argv shape ───────────────────────────────────────────────

describe('spawnOpenCode argv construction (BACKEND-03 + T-22-11)', () => {
  test('argv = ["run", "--format", "json", "--dir", workDir, prompt] when workDir set', () => {
    let capturedFile = '';
    let capturedArgs: readonly string[] = [];
    const fakeExeca = ((
      file: string,
      args: readonly string[],
      _opts: unknown,
    ): unknown => {
      capturedFile = file;
      capturedArgs = args;
      const { child } = buildFakeChild();
      return child;
    }) as unknown as typeof import('execa').execa;

    const ac = new AbortController();
    spawnOpenCode({
      binaryPath: '/bin/fake-opencode',
      workDir: '/tmp',
      customEnv: {},
      customArgs: [],
      prompt: 'hello world',
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });

    assert.equal(capturedFile, '/bin/fake-opencode');
    assert.deepEqual(capturedArgs, ['run', '--format', 'json', '--dir', '/tmp', 'hello world']);
  });

  test('argv omits --dir when workDir is null', () => {
    let capturedArgs: readonly string[] = [];
    const fakeExeca = ((
      _file: string,
      args: readonly string[],
      _opts: unknown,
    ): unknown => {
      capturedArgs = args;
      const { child } = buildFakeChild();
      return child;
    }) as unknown as typeof import('execa').execa;

    const ac = new AbortController();
    spawnOpenCode({
      binaryPath: '/bin/fake-opencode',
      workDir: null,
      customEnv: {},
      customArgs: [],
      prompt: 'no-workdir-prompt',
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });

    assert.deepEqual(capturedArgs, ['run', '--format', 'json', 'no-workdir-prompt']);
    assert.equal(capturedArgs.includes('--dir'), false);
  });

  test('argv DOES NOT contain session-resume flags -s / -c / --share (T-22-11)', () => {
    let capturedArgs: readonly string[] = [];
    const fakeExeca = ((
      _file: string,
      args: readonly string[],
      _opts: unknown,
    ): unknown => {
      capturedArgs = args;
      const { child } = buildFakeChild();
      return child;
    }) as unknown as typeof import('execa').execa;

    const ac = new AbortController();
    spawnOpenCode({
      binaryPath: '/bin/fake-opencode',
      workDir: '/tmp',
      customEnv: {},
      customArgs: [],
      prompt: 'p',
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });

    assert.equal(capturedArgs.includes('-s'), false, 'T-22-11: argv must not contain -s');
    assert.equal(capturedArgs.includes('-c'), false, 'T-22-11: argv must not contain -c');
    assert.equal(capturedArgs.includes('--share'), false, 'argv must not contain --share');
  });
});

// ── runOpenCodeTask end-to-end ─────────────────────────────────────────────

describe('runOpenCodeTask (BACKEND-03 — end-to-end)', () => {
  test('closes stdin immediately (prompt comes from argv, not stdin)', async () => {
    const { child, stdinEnds, stdout, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const ac = new AbortController();
    const done = runOpenCodeTask({
      task: buildTask(),
      binaryPath: '/bin/fake-opencode',
      config: { backend: {}, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: () => undefined,
      abortSignal: ac.signal,
      _spawn,
    });

    // Allow microtasks to flush so the run() implementation closes stdin.
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(stdinEnds.length >= 1, 'expected child.stdin.end() to be called immediately');

    stdout.end();
    exit({ exitCode: 0, isCanceled: false });
    const result = await done;
    assert.equal(result.exitCode, 0);
    assert.equal(result.cancelled, false);
  });

  test('fixture round-trip: pipes opencode-stream-sample.ndjson and emits text / tool_use+tool_result / text', async () => {
    const { child, stdout, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{
      type: string;
      content?: string | null;
      tool?: string | null;
      output?: unknown;
      metadata?: Record<string, unknown>;
    }> = [];
    const ac = new AbortController();

    const done = runOpenCodeTask({
      task: buildTask(),
      binaryPath: '/bin/fake-opencode',
      config: { backend: {}, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });

    // Pipe the fixture (including the malformed trailing line) through stdout.
    const body = readFileSync(FIXTURE_PATH, 'utf8');
    // Write the entire body then close.
    stdout.write(body);
    stdout.end();
    exit({ exitCode: 0, isCanceled: false });
    const result = await done;

    assert.equal(result.exitCode, 0);

    // Expected sequence from the fixture (ignoring step_start / step_finish
    // and the malformed final line):
    //   1. text "I will read /tmp/x.txt"
    //   2. tool_use bash→read (call_1)
    //   3. tool_result for call_1
    //   4. text "Done."
    const types = received.map((m) => m.type);
    assert.deepEqual(
      types,
      ['text', 'tool_use', 'tool_result', 'text'],
      `expected 4 messages in order, got: ${types.join(',')}`,
    );
    assert.equal(received[0]!.content, 'I will read /tmp/x.txt');
    assert.equal(received[1]!.tool, 'read');
    assert.equal(received[2]!.output, 'hello');
    assert.equal(received[3]!.content, 'Done.');
  });

  test('exits cleanly with cancelled=true when execa marks isCanceled', async () => {
    const { child, stdout, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const ac = new AbortController();
    const done = runOpenCodeTask({
      task: buildTask(),
      binaryPath: '/bin/fake-opencode',
      config: { backend: {}, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: () => undefined,
      abortSignal: ac.signal,
      _spawn,
    });

    stdout.end();
    exit({ exitCode: 143, isCanceled: true });
    const result = await done;
    assert.equal(result.cancelled, true);
    assert.equal(result.exitCode, 143);
  });
});
