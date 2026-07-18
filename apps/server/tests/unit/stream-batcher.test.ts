import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StreamBatcher } from '../../src/daemon/stream-batcher.js';
import type { PendingTaskMessageWire } from '../../src/daemon/http-client.js';

function mkMsg(content: string): PendingTaskMessageWire {
  return { type: 'text', content, workspaceId: 'w-1', issueId: 'i-1' };
}

type Call = { taskId: string; msgs: PendingTaskMessageWire[] };

interface MockHttp {
  calls: Call[];
  setMode(m: 'ok' | 'throw-once' | 'throw-always', times?: number): void;
  postMessages(taskId: string, msgs: PendingTaskMessageWire[]): Promise<{ accepted: number }>;
}

function mockHttp(): MockHttp {
  const calls: Call[] = [];
  let mode: 'ok' | 'throw-once' | 'throw-always' = 'ok';
  let throwsLeft = 0;
  return {
    calls,
    setMode(m, times = 0) { mode = m; throwsLeft = times; },
    postMessages: async (taskId: string, msgs: PendingTaskMessageWire[]) => {
      calls.push({ taskId, msgs });
      if (mode === 'throw-always') throw new Error('server down');
      if (mode === 'throw-once' && throwsLeft > 0) { throwsLeft--; throw new Error('transient'); }
      return { accepted: msgs.length };
    },
  };
}

describe('StreamBatcher (BACKEND-04 / PG4 / TASK-03)', () => {
  test('push returns synchronously without HTTP call', () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
      const http = mockHttp();
      const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500 });
      b.push(mkMsg('hello'));
      assert.equal(http.calls.length, 0);
      assert.equal(b.stats().buffered, 1);
    } finally { mock.timers.reset(); }
  });

  test('interval flush fires after 500 ms with accumulated batch', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
      const http = mockHttp();
      const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500 });
      b.push(mkMsg('a')); b.push(mkMsg('b'));
      mock.timers.tick(500);
      // Allow microtask queue drain for the POST promise chain
      await Promise.resolve(); await Promise.resolve();
      assert.equal(http.calls.length, 1);
      assert.equal(http.calls[0]!.msgs.length, 2);
      assert.equal(b.stats().buffered, 0);
    } finally { mock.timers.reset(); }
  });

  test('100-item cap triggers immediate flush', async () => {
    const http = mockHttp();
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500, maxBatchItems: 100 });
    for (let i = 0; i < 100; i++) b.push(mkMsg(`m${i}`));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0]!.msgs.length, 100);
    await b.stop();
  });

  test('64 KB cap triggers immediate flush', async () => {
    const http = mockHttp();
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500, maxBatchBytes: 1024 });
    // Each message is ~50 bytes of JSON; > 1024 bytes triggers.
    for (let i = 0; i < 40; i++) b.push(mkMsg('x'.repeat(20)));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(http.calls.length, 1);
    assert.ok(http.calls[0]!.msgs.length >= 1);
    await b.stop();
  });

  test('flushNow awaits the POST and clears buffer', async () => {
    const http = mockHttp();
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500 });
    b.push(mkMsg('a'));
    await b.flushNow();
    assert.equal(http.calls.length, 1);
    assert.equal(b.stats().buffered, 0);
    await b.stop();
  });

  test('stop() clears interval and drains final flush', async () => {
    const http = mockHttp();
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500 });
    b.push(mkMsg('a'));
    await b.stop();
    assert.equal(http.calls.length, 1);
    assert.equal(b.stats().stopped, true);
    assert.throws(() => b.push(mkMsg('b')), /after stop/);
  });

  test('POST failure re-queues batch for next flush (PG4 — never drops)', async () => {
    const http = mockHttp();
    http.setMode('throw-once', 1);
    let errors = 0;
    const b = new StreamBatcher({
      taskId: 't-1',
      httpClient: http,
      flushIntervalMs: 500,
      onFlushError: () => { errors++; },
    });
    b.push(mkMsg('a')); b.push(mkMsg('b'));
    await b.flushNow();
    assert.equal(errors, 1);
    // Buffer repopulated with the failed batch
    assert.equal(b.stats().buffered, 2);
    // Next flush succeeds
    await b.flushNow();
    assert.equal(http.calls.length, 2);
    assert.equal(b.stats().buffered, 0);
    await b.stop();
  });

  test('concurrent flushes do not interleave — second push during in-flight POST lands in next batch', async () => {
    let resolveFirst: (() => void) | null = null;
    const calls: Call[] = [];
    const http = {
      calls,
      postMessages: async (taskId: string, msgs: PendingTaskMessageWire[]) => {
        calls.push({ taskId, msgs });
        if (calls.length === 1) await new Promise<void>((r) => { resolveFirst = r; });
        return { accepted: msgs.length };
      },
    };
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500 });
    b.push(mkMsg('a'));
    const p1 = b.flushNow(); // blocks waiting for resolveFirst
    await Promise.resolve();
    b.push(mkMsg('b'));       // buffered — first flush is inflight
    resolveFirst?.();
    await p1;
    await b.flushNow();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.msgs.map((m) => m.content), ['a']);
    assert.deepEqual(calls[1]!.msgs.map((m) => m.content), ['b']);
    await b.stop();
  });

  test('AbortSignal stops the batcher', async () => {
    const http = mockHttp();
    const ac = new AbortController();
    const b = new StreamBatcher({ taskId: 't-1', httpClient: http, flushIntervalMs: 500, signal: ac.signal });
    b.push(mkMsg('a'));
    ac.abort();
    // Wait for the async stop cascade
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(b.stats().stopped, true);
  });
});
