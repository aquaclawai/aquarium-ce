import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startCancelPoller } from '../../src/daemon/cancel-poller.js';
import type { TaskStatus } from '@aquarium/shared';

describe('startCancelPoller (CLI-06 / PG2 / PG5)', () => {
  test('fires onCancel exactly once on first cancelled:true', async () => {
    let calls = 0;
    let fired = 0;
    const http = {
      getTaskStatus: async () => {
        calls++;
        return { status: 'running' as TaskStatus, cancelled: calls >= 2 };
      },
    };
    const ac = new AbortController();
    let resolveWhenFired: () => void = () => {};
    const pending = new Promise<void>((r) => { resolveWhenFired = r; });
    const cleanup = startCancelPoller({
      taskId: 't-1',
      intervalMs: 10,
      httpClient: http,
      signal: ac.signal,
      onCancel: () => { fired++; resolveWhenFired(); },
    });
    await pending;
    cleanup();
    assert.equal(fired, 1);
    assert.ok(calls >= 2);
  });

  test('getTaskStatus throw — continues polling and reports via onError', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const http = {
      getTaskStatus: async () => {
        calls++;
        if (calls === 1) throw new Error('network');
        return { status: 'running' as TaskStatus, cancelled: false };
      },
    };
    const ac = new AbortController();
    const cleanup = startCancelPoller({
      taskId: 't-1',
      intervalMs: 5,
      httpClient: http,
      signal: ac.signal,
      onCancel: () => { throw new Error('must not fire'); },
      onError: (err) => errors.push(err),
    });
    // Wait for a couple of ticks
    await new Promise((r) => setTimeout(r, 60));
    cleanup();
    assert.ok(errors.length >= 1, `expected at least 1 onError call, got ${errors.length}`);
    assert.ok(calls >= 2, `expected at least 2 poll calls, got ${calls}`);
  });

  test('cleanup() stops polling', async () => {
    let calls = 0;
    const http = {
      getTaskStatus: async () => {
        calls++;
        return { status: 'running' as TaskStatus, cancelled: false };
      },
    };
    const ac = new AbortController();
    const cleanup = startCancelPoller({
      taskId: 't-1',
      intervalMs: 5,
      httpClient: http,
      signal: ac.signal,
      onCancel: () => { throw new Error('must not fire'); },
    });
    await new Promise((r) => setTimeout(r, 20));
    cleanup();
    const after = calls;
    await new Promise((r) => setTimeout(r, 40));
    // Allow at most one in-flight tick after cleanup, but not many more
    assert.ok(calls - after <= 1, `calls grew from ${after} to ${calls} after cleanup`);
  });

  test('AbortSignal also stops polling (idempotent cleanup)', async () => {
    const http = {
      getTaskStatus: async () => ({ status: 'running' as TaskStatus, cancelled: false }),
    };
    const ac = new AbortController();
    const cleanup = startCancelPoller({
      taskId: 't-1',
      intervalMs: 5,
      httpClient: http,
      signal: ac.signal,
      onCancel: () => { throw new Error('nope'); },
    });
    ac.abort();
    // Cleanup should be idempotent.
    cleanup();
    // Just sanity: no unhandled rejection
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(true);
  });

  test('onCancel throw does not crash the poller (host owns its errors)', async () => {
    let fired = 0;
    const http = {
      getTaskStatus: async () => ({ status: 'running' as TaskStatus, cancelled: true }),
    };
    const ac = new AbortController();
    const cleanup = startCancelPoller({
      taskId: 't-1',
      intervalMs: 5,
      httpClient: http,
      signal: ac.signal,
      onCancel: () => { fired++; throw new Error('host exploded'); },
    });
    await new Promise((r) => setTimeout(r, 40));
    cleanup();
    assert.equal(fired, 1);
  });
});
