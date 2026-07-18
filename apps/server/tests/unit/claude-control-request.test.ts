import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildControlResponse,
  mapClaudeMessageToAgentMessage,
  toPendingTaskMessage,
  sanitizeCustomEnv,
  spawnClaude,
  runClaudeTask,
  type ClaudeStreamMessage,
} from '../../src/daemon/backends/claude.js';
import type { ClaimedTask } from '@aquarium/shared';

describe('buildControlResponse (T-21-04 / BACKEND-01)', () => {
  test('allow=undefined → approve all', () => {
    const r = buildControlResponse(
      { request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } },
      undefined,
    );
    assert.equal(r.response.behavior, 'allow');
    assert.equal(r.response.request_id, 'r1');
    assert.equal(r.response.subtype, 'can_use_tool_response');
    assert.equal(r.type, 'control_response');
  });
  test('allow=["*"] → approve all', () => {
    const r = buildControlResponse(
      { request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'WebFetch' } },
      ['*'],
    );
    assert.equal(r.response.behavior, 'allow');
  });
  test('allow=["Read","Edit"] — allow Read, deny WebFetch with message', () => {
    const a = buildControlResponse(
      { request_id: 'a', request: { subtype: 'can_use_tool', tool_name: 'Read' } },
      ['Read', 'Edit'],
    );
    const b = buildControlResponse(
      { request_id: 'b', request: { subtype: 'can_use_tool', tool_name: 'WebFetch' } },
      ['Read', 'Edit'],
    );
    assert.equal(a.response.behavior, 'allow');
    assert.equal(b.response.behavior, 'deny');
    assert.match(b.response.message ?? '', /allow-list/);
  });
  test('preserves request_id verbatim', () => {
    const r = buildControlResponse(
      { request_id: 'req-uuid-123', request: { subtype: 'can_use_tool', tool_name: 'X' } },
      undefined,
    );
    assert.equal(r.response.request_id, 'req-uuid-123');
  });
});

describe('mapClaudeMessageToAgentMessage (BACKEND-01)', () => {
  test('assistant text', () => {
    const out = mapClaudeMessageToAgentMessage(
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
      new Map(),
    );
    assert.deepEqual(out, [{ kind: 'text', text: 'hi' }]);
  });
  test('assistant thinking', () => {
    const out = mapClaudeMessageToAgentMessage(
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'I think' }] } },
      new Map(),
    );
    assert.deepEqual(out, [{ kind: 'thinking', thinking: 'I think' }]);
  });
  test('assistant tool_use populates lookup + emits tool_use', () => {
    const lookup = new Map<string, string>();
    const out = mapClaudeMessageToAgentMessage(
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { p: '/x' } }] } },
      lookup,
    );
    assert.deepEqual(out, [{ kind: 'tool_use', toolUseId: 'tu_1', toolName: 'Read', input: { p: '/x' } }]);
    assert.equal(lookup.get('tu_1'), 'Read');
  });
  test('user tool_result', () => {
    const out = mapClaudeMessageToAgentMessage(
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'output', is_error: false }] } },
      new Map(),
    );
    assert.deepEqual(out, [{ kind: 'tool_result', toolUseId: 'tu_1', content: 'output', isError: false }]);
  });
  test('result + is_error → error AgentMessage', () => {
    const out = mapClaudeMessageToAgentMessage(
      { type: 'result', subtype: 'failure', is_error: true, result: 'bad' },
      new Map(),
    );
    assert.deepEqual(out, [{ kind: 'error', error: 'bad' }]);
  });
  test('system + successful result → no AgentMessage', () => {
    assert.deepEqual(mapClaudeMessageToAgentMessage({ type: 'system', subtype: 'init' }, new Map()), []);
    assert.deepEqual(mapClaudeMessageToAgentMessage({ type: 'result', is_error: false } as ClaudeStreamMessage, new Map()), []);
  });
});

describe('toPendingTaskMessage (BACKEND-01)', () => {
  test('tool_result falls back to "unknown" tool when lookup misses', () => {
    const lookup = new Map<string, string>();
    const out = toPendingTaskMessage(
      { kind: 'tool_result', toolUseId: 'nope', content: 'x', isError: false },
      { workspaceId: 'w', issueId: 'i', toolNameLookup: lookup },
    );
    assert.equal(out.tool, 'unknown');
    assert.equal(out.type, 'tool_result');
  });
});

describe('sanitizeCustomEnv (PM7)', () => {
  test('strips PATH and AQUARIUM_* keys', () => {
    const out = sanitizeCustomEnv({ PATH: 'x', Path: 'y', AQUARIUM_TOKEN: 'leak', AQUARIUM_DEBUG: '1', FOO: 'bar' });
    assert.deepEqual(out, { FOO: 'bar' });
  });
});

describe('spawnClaude (PM1 / PM3 / BACKEND-05)', () => {
  test('passes correct args + env + spawn options', () => {
    let captured: { cmd: string; args: string[]; opts: Record<string, unknown> } | null = null;
    const fakeExeca = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      captured = { cmd, args, opts };
      return { stdout: null, stdin: null, stderr: null, pid: 9999, kill: () => true, then: () => undefined } as unknown;
    }) as unknown as typeof import('execa').execa;
    const ac = new AbortController();
    spawnClaude({
      prompt: 'hi',
      workDir: null,
      customEnv: { AQUARIUM_TOKEN: 'must-be-stripped', FOO: 'bar' },
      customArgs: ['--model', 'sonnet'],
      claudePath: '/usr/local/bin/claude',
      abortSignal: ac.signal,
      gracefulKillMs: 10_000,
      _execa: fakeExeca,
    });
    assert.ok(captured);
    const cap = captured as { cmd: string; args: string[]; opts: Record<string, unknown> };
    assert.equal(cap.cmd, '/usr/local/bin/claude');
    assert.deepEqual(cap.args.slice(0, 9), [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio',
      '--model', 'sonnet',
    ]);
    const opts = cap.opts as {
      shell?: boolean;
      detached?: boolean;
      forceKillAfterDelay?: number;
      cancelSignal?: AbortSignal;
      env?: Record<string, string>;
    };
    assert.equal(opts.shell, false);
    assert.equal(opts.detached, process.platform !== 'win32');
    assert.equal(opts.forceKillAfterDelay, 10_000);
    assert.ok(opts.cancelSignal);
    assert.ok(opts.env?.PATH?.startsWith(path.dirname(process.execPath)));
    // PM7: AQUARIUM_TOKEN stripped
    assert.equal(opts.env?.AQUARIUM_TOKEN, undefined);
    assert.equal(opts.env?.AQUARIUM_DAEMON_TOKEN, undefined);
    // But FOO preserved
    assert.equal(opts.env?.FOO, 'bar');
  });
});

// Integration-style test of runClaudeTask with a fake child — keeps unit-isolated.
describe('runClaudeTask end-to-end with scripted mock child (BACKEND-01)', () => {
  test('scripts text + control_request + result → emits text + audit thinking; writes control_response to stdin', async () => {
    const { PassThrough } = await import('node:stream');
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stdinWrites: string[] = [];
    stdin.on('data', (chunk: Buffer) => stdinWrites.push(chunk.toString('utf8')));

    // A minimal execa-subprocess-like object: awaitable (Promise.resolve'd) with io streams attached.
    const fakeChild = Object.assign(
      Promise.resolve({ exitCode: 0, isCanceled: false }),
      {
        stdout,
        stdin,
        stderr: new PassThrough(),
        pid: 1234,
        kill: () => true,
      },
    );
    const spawnMock = (() => fakeChild) as unknown as typeof spawnClaude;

    const received: Array<{ type: string; content?: string | null }> = [];
    const ac = new AbortController();

    // Emit scripted NDJSON lines after the iterator starts consuming.
    setImmediate(() => {
      stdout.write(JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      }) + '\n');
      stdout.write(JSON.stringify({
        type: 'control_request',
        request_id: 'rq-1',
        request: { subtype: 'can_use_tool', tool_name: 'Read' },
      }) + '\n');
      stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n');
      stdout.end();
    });

    const task = {
      id: 't-1',
      workspaceId: 'w-1',
      issueId: 'i-1',
      agentId: 'a',
      runtimeId: 'rt-1',
      triggerCommentId: null,
      status: 'running' as const,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agent: { id: 'a', name: 'A', instructions: 'do it', customEnv: {}, customArgs: [] },
      issue: { id: 'i-1', issueNumber: 1, title: 'x', description: null },
      triggerCommentContent: null,
    } satisfies ClaimedTask;

    await runClaudeTask({
      task,
      claudePath: '/bin/fake',
      config: { backends: { claude: { allow: ['*'] } }, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn: spawnMock,
    });

    // Expect: text message + audit thinking for the approved tool
    const types = received.map((m) => m.type);
    assert.ok(types.includes('text'));
    assert.ok(types.includes('thinking'));
    const audit = received.find((m) => m.type === 'thinking');
    assert.match(String(audit?.content ?? ''), /auto-approve.*Read/);
    // control_response was written to stdin
    const combinedStdin = stdinWrites.join('');
    assert.match(combinedStdin, /"type":"control_response"/);
    assert.match(combinedStdin, /"behavior":"allow"/);
    assert.match(combinedStdin, /"request_id":"rq-1"/);
  });

  test('deny path: tool not in allow-list → deny control_response + audit deny thinking', async () => {
    const { PassThrough } = await import('node:stream');
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stdinWrites: string[] = [];
    stdin.on('data', (chunk: Buffer) => stdinWrites.push(chunk.toString('utf8')));

    const fakeChild = Object.assign(
      Promise.resolve({ exitCode: 0, isCanceled: false }),
      { stdout, stdin, stderr: new PassThrough(), pid: 2345, kill: () => true },
    );
    const spawnMock = (() => fakeChild) as unknown as typeof spawnClaude;

    const received: Array<{ type: string; content?: string | null }> = [];
    const ac = new AbortController();

    setImmediate(() => {
      stdout.write(JSON.stringify({
        type: 'control_request',
        request_id: 'rq-deny',
        request: { subtype: 'can_use_tool', tool_name: 'WebFetch' },
      }) + '\n');
      stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n');
      stdout.end();
    });

    const task = {
      id: 't-2',
      workspaceId: 'w-2',
      issueId: 'i-2',
      agentId: 'a',
      runtimeId: 'rt-1',
      triggerCommentId: null,
      status: 'running' as const,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agent: { id: 'a', name: 'A', instructions: 'do it', customEnv: {}, customArgs: [] },
      issue: { id: 'i-2', issueNumber: 2, title: 'x', description: null },
      triggerCommentContent: null,
    } satisfies ClaimedTask;

    await runClaudeTask({
      task,
      claudePath: '/bin/fake',
      config: { backends: { claude: { allow: ['Read'] } }, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn: spawnMock,
    });

    const audit = received.find((m) => m.type === 'thinking');
    assert.match(String(audit?.content ?? ''), /deny.*WebFetch/);
    const combinedStdin = stdinWrites.join('');
    assert.match(combinedStdin, /"behavior":"deny"/);
    assert.match(combinedStdin, /"request_id":"rq-deny"/);
  });

  test('malformed control_request frames are dropped, never crash (T-21-06 carry-through)', async () => {
    const { PassThrough } = await import('node:stream');
    const stdout = new PassThrough();
    const stdin = new PassThrough();

    const fakeChild = Object.assign(
      Promise.resolve({ exitCode: 0, isCanceled: false }),
      { stdout, stdin, stderr: new PassThrough(), pid: 3456, kill: () => true },
    );
    const spawnMock = (() => fakeChild) as unknown as typeof spawnClaude;

    const received: Array<{ type: string }> = [];
    const ac = new AbortController();

    setImmediate(() => {
      // Malformed line — parseNdjson drops silently
      stdout.write('not-json-at-all\n');
      // Valid but partial control_request (missing tool_name) — accepted with 'unknown' tool
      stdout.write(JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      }) + '\n');
      stdout.write(JSON.stringify({ type: 'result', is_error: false }) + '\n');
      stdout.end();
    });

    const task = {
      id: 't-3',
      workspaceId: 'w-3',
      issueId: 'i-3',
      agentId: 'a',
      runtimeId: 'rt-1',
      triggerCommentId: null,
      status: 'running' as const,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agent: { id: 'a', name: 'A', instructions: 'do it', customEnv: {}, customArgs: [] },
      issue: { id: 'i-3', issueNumber: 3, title: 'x', description: null },
      triggerCommentContent: null,
    } satisfies ClaimedTask;

    const result = await runClaudeTask({
      task,
      claudePath: '/bin/fake',
      config: { backends: { claude: { allow: ['*'] } }, gracefulKillMs: 10_000, inactivityKillMs: 60_000 },
      onAgentMessage: (m) => received.push(m),
      abortSignal: ac.signal,
      _spawn: spawnMock,
    });
    assert.equal(result.exitCode, 0);
    // text went through
    assert.ok(received.some((m) => m.type === 'text'));
  });
});
