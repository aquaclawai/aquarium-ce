/**
 * Phase 22 Plan 01 — `detectBackends()` probe resilience (PG2).
 *
 * A single bad backend's `detect()` throwing or returning null MUST NOT
 * block the others. The registry probes in-order; the result preserves
 * that order for deterministic operator log output (22-04's main.ts boot
 * banner relies on it).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Backend } from '../../src/daemon/backend.js';
import { detectBackends, ALL_BACKENDS } from '../../src/daemon/backends/index.js';

const makeStub = (
  provider: Backend['provider'],
  detectImpl: Backend['detect'],
): Backend => ({
  provider,
  detect: detectImpl,
  run: async () => ({ exitCode: 0, cancelled: false }),
});

describe('detectBackends (PG2 — per-backend isolation)', () => {
  test('all backends return null → empty array, no throws', async () => {
    const stubs: Backend[] = [
      makeStub('claude', async () => null),
      makeStub('codex', async () => null),
    ];
    const r = await detectBackends(stubs);
    assert.deepEqual(r, []);
  });

  test('one throws, others still return results', async () => {
    const stubs: Backend[] = [
      makeStub('claude', async () => {
        throw new Error('boom');
      }),
      makeStub('codex', async () => ({ path: '/usr/bin/codex', version: '0.118.0' })),
    ];
    const r = await detectBackends(stubs);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.backend.provider, 'codex');
    assert.equal(r[0]!.path, '/usr/bin/codex');
    assert.equal(r[0]!.version, '0.118.0');
  });

  test('preserves list order in the result', async () => {
    const stubs: Backend[] = [
      makeStub('claude', async () => ({ path: '/a/claude', version: '1.0.0' })),
      makeStub('codex', async () => ({ path: '/a/codex', version: '0.118.0' })),
      makeStub('opencode', async () => ({ path: '/a/opencode', version: '1.2.3' })),
    ];
    const r = await detectBackends(stubs);
    assert.deepEqual(
      r.map((x) => x.backend.provider),
      ['claude', 'codex', 'opencode'],
    );
  });

  test('skips null-result backends but keeps non-null in order', async () => {
    const stubs: Backend[] = [
      makeStub('claude', async () => null),
      makeStub('codex', async () => ({ path: '/a/codex', version: '0.118.0' })),
      makeStub('opencode', async () => null),
      makeStub('openclaw', async () => ({ path: '/a/openclaw', version: '0.1.0' })),
    ];
    const r = await detectBackends(stubs);
    assert.deepEqual(
      r.map((x) => x.backend.provider),
      ['codex', 'openclaw'],
    );
  });

  test('synchronous throw in detect() is also caught', async () => {
    const stubs: Backend[] = [
      { provider: 'claude', detect: () => { throw new Error('sync boom'); }, run: async () => ({ exitCode: 0, cancelled: false }) },
      makeStub('codex', async () => ({ path: '/a/codex', version: '0.118.0' })),
    ];
    const r = await detectBackends(stubs);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.backend.provider, 'codex');
  });

  test('ALL_BACKENDS includes claudeBackend (Wave 1 default)', () => {
    const providers = ALL_BACKENDS.map((b) => b.provider);
    assert.ok(providers.includes('claude'), `ALL_BACKENDS providers=${providers.join(',')}`);
  });
});
