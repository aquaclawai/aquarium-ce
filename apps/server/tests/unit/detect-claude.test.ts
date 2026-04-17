import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaude } from '../../src/daemon/detect.js';

// Typed shim for mock execa: returns a partial result; only `stdout` matters here.
type FakeExecaResult = { stdout: string };
type FakeExecaFn = (file: string, args: readonly string[], opts?: unknown) => Promise<FakeExecaResult>;

describe('detectClaude (CLI-01 / T-21-03)', () => {
  test('happy path: PATH hit + version parse', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: '2.1.112 (Claude Code)' });
    const result = await detectClaude({
      _which: async () => '/usr/local/bin/claude',
      _exists: (p) => p === '/usr/local/bin/claude',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.deepEqual(result, { path: '/usr/local/bin/claude', version: '2.1.112' });
  });

  test('returns null when PATH miss and no fallback path exists', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: 'never' });
    const result = await detectClaude({
      _which: async () => null,
      _exists: () => false,
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });

  test('falls back to next candidate when --version throws (timeout/hang)', async () => {
    const attempts: string[] = [];
    const fakeExeca: FakeExecaFn = async (file) => {
      attempts.push(file);
      if (file === '/first/claude') throw new Error('timeout');
      return { stdout: '1.2.3' };
    };
    const result = await detectClaude({
      _which: async () => '/first/claude',
      _exists: (p) => p === '/first/claude' || p.endsWith('/.claude/local/claude'),
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.ok(attempts.length >= 2, 'should try fallback after first throws');
    assert.equal(result?.version, '1.2.3');
  });

  test('version-parse failure returns { path, version: "unknown" }', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: 'Claude-Code beta' });
    const result = await detectClaude({
      _which: async () => '/usr/local/bin/claude',
      _exists: (p) => p === '/usr/local/bin/claude',
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result?.path, '/usr/local/bin/claude');
    assert.equal(result?.version, 'unknown');
  });

  test('never throws (even when which rejects)', async () => {
    const fakeExeca: FakeExecaFn = async () => ({ stdout: '' });
    const result = await detectClaude({
      _which: async () => {
        throw new Error('which failed');
      },
      _exists: () => false,
      _execa: fakeExeca as unknown as typeof import('execa').execa,
    });
    assert.equal(result, null);
  });
});
