import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { escalateKill, type KillableChild } from '../../src/daemon/kill-escalation.js';

// Minimal fake child: records signals, fires 'exit' on demand, double-kill safe.
function makeFakeChild(opts: { killThrowsOn?: 'SIGTERM' | 'SIGKILL' } = {}) {
  const signals: string[] = [];
  const exitHandlers: Array<() => void> = [];
  const child: KillableChild = {
    kill(sig) {
      signals.push(sig);
      if (opts.killThrowsOn === sig) throw new Error('already dead');
      return true;
    },
    once(evt, fn) {
      if (evt === 'exit') exitHandlers.push(fn);
      return child;
    },
  };
  return { child, signals, emitExit: () => { for (const fn of exitHandlers.splice(0)) fn(); } };
}

describe('escalateKill (PM1 / BACKEND-04)', () => {
  test('SIGTERM fires synchronously', () => {
    const { child, signals } = makeFakeChild();
    escalateKill(child, 10_000);
    assert.deepEqual(signals, ['SIGTERM']);
  });

  test('SIGKILL does NOT fire if child exits before graceMs', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
    try {
      const { child, signals, emitExit } = makeFakeChild();
      escalateKill(child, 10_000);
      assert.deepEqual(signals, ['SIGTERM']);
      mock.timers.tick(2_000);
      emitExit();
      mock.timers.tick(10_000);
      assert.deepEqual(signals, ['SIGTERM']);
    } finally {
      mock.timers.reset();
    }
  });

  test('SIGKILL fires exactly once after graceMs if child still alive', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
    try {
      const { child, signals } = makeFakeChild();
      escalateKill(child, 10_000);
      mock.timers.tick(9_999);
      assert.deepEqual(signals, ['SIGTERM']);
      mock.timers.tick(1);
      assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
      mock.timers.tick(10_000);
      assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); // no second SIGKILL
    } finally {
      mock.timers.reset();
    }
  });

  test('SIGKILL throw is swallowed (child already dead)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
    try {
      const { child } = makeFakeChild({ killThrowsOn: 'SIGKILL' });
      escalateKill(child, 10_000);
      assert.doesNotThrow(() => mock.timers.tick(10_000));
    } finally {
      mock.timers.reset();
    }
  });

  test('cleanup function cancels pending SIGKILL', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
    try {
      const { child, signals } = makeFakeChild();
      const cleanup = escalateKill(child, 10_000);
      cleanup();
      mock.timers.tick(20_000);
      assert.deepEqual(signals, ['SIGTERM']); // no SIGKILL
      // Double-cleanup is safe.
      assert.doesNotThrow(() => cleanup());
    } finally {
      mock.timers.reset();
    }
  });

  test('injected setTimeout/clearTimeout deps override globals', () => {
    const calls: Array<{ op: 'set' | 'clear'; ms?: number }> = [];
    let stored: { fn: () => void } | null = null;
    const deps = {
      setTimeout: (fn: () => void, ms: number) => { calls.push({ op: 'set', ms }); stored = { fn }; return stored; },
      clearTimeout: (_h: unknown) => { calls.push({ op: 'clear' }); stored = null; },
    };
    const { child, signals } = makeFakeChild();
    escalateKill(child, 10_000, deps);
    assert.equal(calls.filter((c) => c.op === 'set').length, 1);
    assert.equal(calls[0]?.ms, 10_000);
    // Fire the stored callback manually — verifies the deps path reaches SIGKILL.
    stored!.fn();
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  });

  test('graceMs=0 fires SIGKILL on the next microtask', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
    try {
      const { child, signals } = makeFakeChild();
      escalateKill(child, 0);
      mock.timers.tick(0);
      assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    } finally {
      mock.timers.reset();
    }
  });

  test('rejects negative or non-finite graceMs', () => {
    const { child } = makeFakeChild();
    assert.throws(() => escalateKill(child, -1), RangeError);
    assert.throws(() => escalateKill(child, NaN), RangeError);
  });
});
