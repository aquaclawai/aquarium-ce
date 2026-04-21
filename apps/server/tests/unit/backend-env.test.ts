/**
 * Phase 22 Plan 01 — PM7 token-strip regression coverage for `buildChildEnv`.
 *
 * Threat anchor T-22-01: AQUARIUM_DAEMON_TOKEN + AQUARIUM_TOKEN MUST NEVER
 * cross the daemon → child-agent trust boundary, regardless of what the
 * caller passes in `customEnv`.
 *
 * Behaviour covered:
 *   • PATH is prepended with `path.dirname(process.execPath)` (PM3 / BACKEND-05)
 *   • `sanitizeCustomEnv` strips PATH / Path / AQUARIUM_* before merge
 *   • `delete env.AQUARIUM_*TOKEN` happens AFTER merge (defence-in-depth)
 *   • `process.env` is never mutated by `buildChildEnv`
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildChildEnv, sanitizeCustomEnv } from '../../src/daemon/backends/env.js';

describe('sanitizeCustomEnv (PM7 — single source of truth)', () => {
  test('strips PATH and AQUARIUM_* keys, keeps ordinary vars', () => {
    const out = sanitizeCustomEnv({
      PATH: 'evil',
      Path: 'evil',
      AQUARIUM_TOKEN: 'leak',
      AQUARIUM_DAEMON_TOKEN: 'leak',
      AQUARIUM_DEBUG: '1',
      FOO: 'bar',
      BAZ: 'qux',
    });
    assert.deepEqual(out, { FOO: 'bar', BAZ: 'qux' });
  });

  test('empty customEnv → empty object', () => {
    assert.deepEqual(sanitizeCustomEnv({}), {});
  });

  test('never mutates its input', () => {
    const input = { AQUARIUM_TOKEN: 'leak', FOO: 'bar' };
    sanitizeCustomEnv(input);
    assert.deepEqual(input, { AQUARIUM_TOKEN: 'leak', FOO: 'bar' });
  });
});

describe('buildChildEnv (PM3 / PM7 / T-22-01)', () => {
  test('prepends path.dirname(process.execPath) to PATH (BACKEND-05)', () => {
    const env = buildChildEnv({ customEnv: {} });
    const daemonBinDir = path.dirname(process.execPath);
    assert.ok(
      (env.PATH ?? '').startsWith(daemonBinDir + path.delimiter),
      `PATH=${env.PATH} expected to start with ${daemonBinDir}${path.delimiter}`,
    );
  });

  test('T-22-01: strips AQUARIUM_DAEMON_TOKEN + AQUARIUM_TOKEN when passed via customEnv', () => {
    const env = buildChildEnv({
      customEnv: {
        AQUARIUM_DAEMON_TOKEN: 'leak1',
        AQUARIUM_TOKEN: 'leak2',
        FOO: 'keep',
      },
    });
    assert.equal(env.AQUARIUM_DAEMON_TOKEN, undefined);
    assert.equal(env.AQUARIUM_TOKEN, undefined);
    assert.equal(env.FOO, 'keep');
  });

  test('T-22-01: strips AQUARIUM_*TOKEN even when present in process.env (defence-in-depth)', () => {
    const before = process.env.AQUARIUM_DAEMON_TOKEN;
    process.env.AQUARIUM_DAEMON_TOKEN = 'leak-from-process';
    try {
      const env = buildChildEnv({ customEnv: {} });
      assert.equal(env.AQUARIUM_DAEMON_TOKEN, undefined);
      assert.equal(env.AQUARIUM_TOKEN, undefined);
    } finally {
      if (before === undefined) delete process.env.AQUARIUM_DAEMON_TOKEN;
      else process.env.AQUARIUM_DAEMON_TOKEN = before;
    }
  });

  test('customEnv PATH=/evil does NOT overwrite the merged PATH (sanitize filters it)', () => {
    const env = buildChildEnv({ customEnv: { PATH: '/evil', FOO: 'keep' } });
    assert.ok(!(env.PATH ?? '').startsWith('/evil'));
    assert.equal(env.FOO, 'keep');
  });

  test('customEnv AQUARIUM_NEW is stripped by the AQUARIUM_ prefix filter', () => {
    const env = buildChildEnv({ customEnv: { AQUARIUM_NEW: 'x', FOO: 'bar' } });
    assert.equal(env.AQUARIUM_NEW, undefined);
    assert.equal(env.FOO, 'bar');
  });

  test('does NOT mutate process.env', () => {
    const snapshot = JSON.stringify(process.env);
    buildChildEnv({
      customEnv: { AQUARIUM_DAEMON_TOKEN: 'x', AQUARIUM_TOKEN: 'y', FOO: 'z' },
    });
    assert.equal(JSON.stringify(process.env), snapshot);
  });

  test('ordinary process.env values still flow through (e.g. HOME)', () => {
    const home = process.env.HOME;
    if (home === undefined) return; // Windows — HOME not set
    const env = buildChildEnv({ customEnv: {} });
    assert.equal(env.HOME, home);
  });
});
