/**
 * Phase 22 Plan 03 — OpenClaw backend unit tests (BACKEND-03 part 2).
 *
 * ASSUMPTION A3 — OpenClaw's `agent --json` NDJSON shape is assumed to match
 * Shape A (OpenCode-like): `{type: 'text'|'tool_use'|'tool_result'|'error'|
 * 'done', ...}`. OpenClaw was NOT installed on the Plan 22-03 execution
 * machine; the placeholder fixture from Plan 22-01 drives this suite. If a
 * future execution captures live output that reveals Shape B, update BOTH
 * apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson AND the
 * mapper in apps/server/src/daemon/backends/openclaw.ts together. The
 * Backend interface does not change.
 *
 * Covers:
 *   • mapOpenclawEventToAgentMessage pure-function shape for all 5 Shape A
 *     event kinds + unknown.
 *   • detectOpenclaw happy path + miss.
 *   • spawnOpenclaw argv shape — `['agent', '-m', prompt, '--json',
 *     '--agent', agentId]` when no sessionId set.
 *   • Fixture round-trip — `openclaw-stream-sample.ndjson` piped through a
 *     PassThrough fake-child; expected sequence text → tool_use → tool_result
 *     is captured; malformed trailing line dropped (PG10).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  mapOpenclawEventToAgentMessage,
  runOpenclawTask,
  spawnOpenclaw,
} from '../../src/daemon/backends/openclaw.js';
import { detectOpenclaw } from '../../src/daemon/backends/detect-openclaw.js';
import type { ClaimedTask } from '@aquarium/shared';

type FakeExecaResult = { stdout: string; stderr?: string };
type FakeExecaFn = (
  file: string,
  args: readonly string[],
  opts?: unknown,
) => Promise<FakeExecaResult>;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'fixtures', 'openclaw-stream-sample.ndjson');

function buildTask(overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  const now = new Date().toISOString();
  return {
    id: 't-1',
    workspaceId: 'w-1',
    issueId: 'i-1',
    agentId: 'agent-xyz',
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
    agent: { id: 'agent-xyz', name: 'A', instructions: 'do it', customEnv: {}, customArgs: [] },
    issue: { id: 'i-1', issueNumber: 1, title: 'Test issue', description: null },
    triggerCommentContent: null,
    ...overrides,
  } as ClaimedTask;
}

function buildFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let resolveExit: (v: { exitCode: number; isCanceled: boolean }) => void = () => undefined;
  const exitPromise = new Promise<{ exitCode: number; isCanceled: boolean }>((r) => {
    resolveExit = r;
  });

  const child = Object.assign(exitPromise, {
    stdin,
    stdout,
    stderr,
    pid: 4243,
    kill: () => true,
  });

  return { child, stdin, stdout, stderr, exit: resolveExit };
}

// ── mapOpenclawEventToAgentMessage ─────────────────────────────────────────

describe('mapOpenclawEventToAgentMessage (BACKEND-03 / ASSUMPTION A3)', () => {
  test('text event → one text AgentMessage', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'text',
      sessionId: 's',
      text: 'hi',
    });
    assert.deepEqual(out, [{ kind: 'text', text: 'hi' }]);
  });

  test('tool_use event → one tool_use AgentMessage (no tool_result yet)', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'tool_use',
      sessionId: 's',
      toolUseId: 'tu1',
      tool: 'bash',
      input: { cmd: 'ls' },
    });
    assert.deepEqual(out, [
      { kind: 'tool_use', toolUseId: 'tu1', toolName: 'bash', input: { cmd: 'ls' } },
    ]);
  });

  test('tool_result event → one tool_result AgentMessage (isError=false default)', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'tool_result',
      sessionId: 's',
      toolUseId: 'tu1',
      content: 'foo',
      isError: false,
    });
    assert.deepEqual(out, [
      { kind: 'tool_result', toolUseId: 'tu1', content: 'foo', isError: false },
    ]);
  });

  test('tool_result with isError=true → isError preserved', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'tool_result',
      sessionId: 's',
      toolUseId: 'tu2',
      content: 'boom',
      isError: true,
    });
    const tr = out[0];
    assert.ok(tr && tr.kind === 'tool_result');
    assert.equal(tr.isError, true);
  });

  test('error event with string error → error AgentMessage', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'error',
      sessionId: 's',
      error: 'oops',
    });
    assert.deepEqual(out, [{ kind: 'error', error: 'oops' }]);
  });

  test('error event with object error → pulls .message', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'error',
      sessionId: 's',
      error: { message: 'oops-obj' },
    });
    assert.deepEqual(out, [{ kind: 'error', error: 'oops-obj' }]);
  });

  test('done event → [] (bookkeeping)', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'done',
      sessionId: 's',
      reason: 'completed',
    });
    assert.deepEqual(out, []);
  });

  test('unknown event type → [] (PG10 / T-22-12 safe default)', () => {
    const out = mapOpenclawEventToAgentMessage({
      type: 'not_a_real_event',
      sessionId: 's',
    } as unknown as Parameters<typeof mapOpenclawEventToAgentMessage>[0]);
    assert.deepEqual(out, []);
  });
});

// ── detectOpenclaw ─────────────────────────────────────────────────────────

describe('detectOpenclaw (BACKEND-03)', () => {
  test('happy path: PATH hit + version parse', async () => {
    const fakeExeca: FakeExecaFn = async (_file, args) => {
      if (args[0] === '--version') return { stdout: 'openclaw 0.1.0', stderr: '' };
      throw new Error(`unexpected args: ${args.join(' ')}`);
    };
    const result = await detectOpenclaw({
      _which: async () => '/opt/homebrew/bin/openclaw',
      _exists: (p) => p === '/opt/homebrew/bin/openclaw',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.deepEqual(result, { path: '/opt/homebrew/bin/openclaw', version: '0.1.0' });
  });

  test('returns null when PATH miss and no fallback exists', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: 'never', stderr: '' });
    const result = await detectOpenclaw({
      _which: async () => null,
      _exists: () => false,
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });
});

// ── spawnOpenclaw argv shape ───────────────────────────────────────────────

describe('spawnOpenclaw argv construction (BACKEND-03)', () => {
  test('argv = ["agent", "-m", prompt, "--json", "--agent", agentId] when no sessionId', () => {
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
    spawnOpenclaw({
      binaryPath: '/bin/fake-openclaw',
      workDir: null,
      customEnv: {},
      customArgs: [],
      prompt: 'do a thing',
      agentId: 'agent-xyz',
      sessionId: null,
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });

    assert.equal(capturedFile, '/bin/fake-openclaw');
    assert.deepEqual(capturedArgs, [
      'agent',
      '-m',
      'do a thing',
      '--json',
      '--agent',
      'agent-xyz',
    ]);
  });

  test('argv uses --session-id when sessionId is set (forward-compat SESS-01)', () => {
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
    spawnOpenclaw({
      binaryPath: '/bin/fake-openclaw',
      workDir: null,
      customEnv: {},
      customArgs: [],
      prompt: 'reply',
      agentId: 'agent-xyz',
      sessionId: 'sess-abc',
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });

    assert.equal(capturedArgs.includes('--session-id'), true);
    assert.equal(capturedArgs.includes('sess-abc'), true);
    assert.equal(capturedArgs.includes('--agent'), false,
      'when sessionId is set, --agent is not needed');
  });
});

// ── runOpenclawTask end-to-end ─────────────────────────────────────────────

describe('runOpenclawTask (BACKEND-03 — end-to-end)', () => {
  // ASSUMPTION A3 — if openclaw live capture reveals different shape, update
  // both fixture and mapper together.
  test('fixture round-trip: pipes openclaw-stream-sample.ndjson and emits text → tool_use → tool_result', async () => {
    const { child, stdout, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const received: Array<{
      type: string;
      content?: string | null;
      tool?: string | null;
      output?: unknown;
    }> = [];
    const ac = new AbortController();

    const done = runOpenclawTask({
      task: buildTask(),
      binaryPath: '/bin/fake-openclaw',
      config: { backend: {}, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn,
    });

    const body = readFileSync(FIXTURE_PATH, 'utf8');
    stdout.write(body);
    stdout.end();
    exit({ exitCode: 0, isCanceled: false });
    const result = await done;

    assert.equal(result.exitCode, 0);

    // Expected sequence (ignoring `done` event + malformed trailing line):
    //   1. text "OpenClaw says hi"
    //   2. tool_use bash (tu_oc_1)
    //   3. tool_result for tu_oc_1
    const types = received.map((m) => m.type);
    assert.deepEqual(
      types,
      ['text', 'tool_use', 'tool_result'],
      `expected 3 messages in order, got: ${types.join(',')}`,
    );
    assert.equal(received[0]!.content, 'OpenClaw says hi');
    assert.equal(received[1]!.tool, 'bash');
    assert.equal(received[2]!.output, 'foo\nbar');
  });

  test('exits with cancelled=true when execa marks isCanceled', async () => {
    const { child, stdout, exit } = buildFakeChild();
    const _spawn = (() => child) as unknown as never;

    const ac = new AbortController();
    const done = runOpenclawTask({
      task: buildTask(),
      binaryPath: '/bin/fake-openclaw',
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
