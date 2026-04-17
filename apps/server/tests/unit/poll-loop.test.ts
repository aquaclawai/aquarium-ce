import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startPollLoop } from '../../src/daemon/poll-loop.js';
import { Semaphore } from '../../src/daemon/semaphore.js';
import type { ClaimedTask } from '@aquarium/shared';

function mkTask(id: string): ClaimedTask {
  return {
    id,
    workspaceId: 'w-1',
    issueId: 'i-1',
    agentId: 'a',
    runtimeId: 'rt-1',
    triggerCommentId: null,
    status: 'dispatched',
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
    agent: { id: 'a', name: 'A', instructions: '', customEnv: {}, customArgs: [] },
    issue: { id: 'i-1', issueNumber: 1, title: 't', description: null },
    triggerCommentContent: null,
  };
}

describe('startPollLoop (CLI-04 / PG1 / PG2)', () => {
  test('respects semaphore — peak concurrency never exceeds max', async () => {
    const sem = new Semaphore(3);
    let tasksIssued = 0;
    const http = {
      claimTask: async () => {
        if (tasksIssued < 10) { tasksIssued++; return { task: mkTask(`t-${tasksIssued}`) }; }
        return { task: null };
      },
    };
    let inFlight = 0;
    let peak = 0;
    const ac = new AbortController();
    void startPollLoop({
      runtimes: [{ id: 'rt-1' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 1,
      shutdownSignal: ac.signal,
      runTask: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
      },
    }).catch(() => { /* ok */ });
    // Let a few ticks run then shut down
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(peak > 0, 'should have dispatched tasks');
    assert.ok(peak <= 3, `peak=${peak} must be <= semaphore.max=3`);
  });

  test('sleeps pollIntervalMs when claimTask returns null', async () => {
    const sem = new Semaphore(2);
    let claimCalls = 0;
    const http = { claimTask: async () => { claimCalls++; return { task: null }; } };
    const ac = new AbortController();
    void startPollLoop({
      runtimes: [{ id: 'rt-1' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 25,
      shutdownSignal: ac.signal,
      runTask: async () => { /* noop */ },
    });
    await new Promise((r) => setTimeout(r, 90));
    ac.abort();
    await new Promise((r) => setTimeout(r, 30));
    // ~3 ticks in 90 ms with 25 ms interval — allow a wide window for jitter
    assert.ok(claimCalls >= 2 && claimCalls <= 10,
      `claimCalls=${claimCalls} expected in [2,10]`);
  });

  test('claimTask error → onError called, loop continues', async () => {
    const sem = new Semaphore(2);
    let calls = 0;
    const errors: unknown[] = [];
    const http = { claimTask: async () => {
      calls++;
      if (calls === 1) throw new Error('net');
      return { task: null };
    }};
    const ac = new AbortController();
    void startPollLoop({
      runtimes: [{ id: 'rt-1' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 5,
      shutdownSignal: ac.signal,
      runTask: async () => { /* noop */ },
      onError: (err) => errors.push(err),
    });
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(errors.length >= 1, `expected at least 1 error, got ${errors.length}`);
    assert.ok(calls >= 2);
  });

  test('shutdownSignal.abort() exits per-runtime loops', async () => {
    const sem = new Semaphore(1);
    let stopped = false;
    const http = { claimTask: async () => ({ task: null }) };
    const ac = new AbortController();
    const all = startPollLoop({
      runtimes: [{ id: 'rt-1' }, { id: 'rt-2' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 5,
      shutdownSignal: ac.signal,
      runTask: async () => { /* noop */ },
    }).then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await all;
    assert.equal(stopped, true);
  });

  test('two runtimes poll independently', async () => {
    const sem = new Semaphore(2);
    const seen: string[] = [];
    const http = {
      claimTask: async (rid: string) => {
        seen.push(rid);
        return { task: null };
      },
    };
    const ac = new AbortController();
    void startPollLoop({
      runtimes: [{ id: 'rt-A' }, { id: 'rt-B' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 5,
      shutdownSignal: ac.signal,
      runTask: async () => { /* noop */ },
    });
    await new Promise((r) => setTimeout(r, 40));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.includes('rt-A'), 'rt-A should have been polled');
    assert.ok(seen.includes('rt-B'), 'rt-B should have been polled');
  });

  test('runTask rejection is swallowed by onError — loop continues', async () => {
    const sem = new Semaphore(2);
    let claimsLeft = 3;
    const errors: unknown[] = [];
    const http = {
      claimTask: async () => {
        if (claimsLeft > 0) { claimsLeft--; return { task: mkTask(`t-${claimsLeft}`) }; }
        return { task: null };
      },
    };
    const ac = new AbortController();
    void startPollLoop({
      runtimes: [{ id: 'rt-1' }],
      httpClient: http,
      semaphore: sem,
      pollIntervalMs: 2,
      shutdownSignal: ac.signal,
      runTask: async () => { throw new Error('task explosion'); },
      onError: (err) => errors.push(err),
    });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(errors.length >= 1, `expected at least 1 runTask error, got ${errors.length}`);
  });
});
