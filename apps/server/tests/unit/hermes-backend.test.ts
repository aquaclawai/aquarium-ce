import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectHermes } from '../../src/daemon/backends/detect-hermes.js';
import { hermesBackend, runHermesStub } from '../../src/daemon/backends/hermes.js';
import type { ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from '../../src/daemon/http-client.js';

// Mirror of codex-backend.test.ts buildTask helper — minimum valid ClaimedTask.
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

describe('detectHermes (A10)', () => {
  test('happy path returns path + version', async () => {
    const r = await detectHermes({
      _which: async () => '/opt/homebrew/bin/hermes',
      _exists: () => true,
      _execa: (async () => ({ stdout: 'hermes 0.1.0' })) as never,
    });
    assert.deepEqual(r, { path: '/opt/homebrew/bin/hermes', version: '0.1.0' });
  });

  test('returns null when hermes is not found (missing on PATH, no fallbacks)', async () => {
    const r = await detectHermes({
      _which: async () => null,
      _exists: () => false,
      _execa: (async () => {
        throw new Error('ENOENT');
      }) as never,
    });
    assert.equal(r, null);
  });

  test('returns "unknown" version when binary exists but version is unparseable', async () => {
    const r = await detectHermes({
      _which: async () => '/opt/homebrew/bin/hermes',
      _exists: () => true,
      _execa: (async () => ({ stdout: 'weird build tag without version' })) as never,
    });
    assert.deepEqual(r, { path: '/opt/homebrew/bin/hermes', version: 'unknown' });
  });
});

describe('Hermes stub backend (T-22-14 / A4)', () => {
  test('runHermesStub emits one error message then exit 1 (no child spawn)', async () => {
    const emitted: PendingTaskMessageWire[] = [];
    const ac = new AbortController();
    const r = await runHermesStub({
      task: buildTask(),
      binaryPath: '/x/hermes',
      config: {
        backend: {},
        gracefulKillMs: 1000,
        inactivityKillMs: 1000,
      },
      onAgentMessage: (m) => emitted.push(m),
      abortSignal: ac.signal,
    });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]!.type, 'error');
    const content = String(emitted[0]!.content ?? '');
    assert.match(content, /not supported.*v1\.4/i);
    assert.match(content, /Nous Research|nousresearch/);
    // Metadata carries the hermesStub discriminator for UI/audit.
    assert.equal(
      (emitted[0]!.metadata as { hermesStub?: boolean } | undefined)?.hermesStub,
      true,
    );
    // Task's workspaceId + issueId are propagated so the timeline displays the error.
    assert.equal(emitted[0]!.workspaceId, 'w-1');
    assert.equal(emitted[0]!.issueId, 'i-1');
    assert.deepEqual(r, { exitCode: 1, cancelled: false });
  });

  test('runHermesStub honours pre-aborted signal (no emit, cancelled true)', async () => {
    const emitted: PendingTaskMessageWire[] = [];
    const ac = new AbortController();
    ac.abort();
    const r = await runHermesStub({
      task: buildTask(),
      binaryPath: '/x/hermes',
      config: {
        backend: {},
        gracefulKillMs: 1000,
        inactivityKillMs: 1000,
      },
      onAgentMessage: (m) => emitted.push(m),
      abortSignal: ac.signal,
    });
    assert.equal(emitted.length, 0);
    assert.equal(r.exitCode, 1);
    assert.equal(r.cancelled, true);
  });

  test('hermesBackend exports Backend conforming object', () => {
    assert.equal(hermesBackend.provider, 'hermes');
    assert.equal(typeof hermesBackend.detect, 'function');
    assert.equal(typeof hermesBackend.run, 'function');
  });
});
