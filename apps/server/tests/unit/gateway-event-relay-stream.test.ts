import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerChatStreamListener,
  waitForChatCompletion,
  cancelChatCompletion,
  __dispatchChatFrameForTests__,
  type ChatStreamPayload,
} from '../../src/services/gateway-event-relay.js';

/**
 * Phase 20-01 — Gateway stream hook tests.
 *
 * Strategy:
 *   • `registerChatStreamListener(instanceId, sessionKey, cb)` is an in-memory
 *     multi-shot listener (no DB, no WebSocket). Each test registers a listener,
 *     drives the relay via `__dispatchChatFrameForTests__(instanceId, rawKey, payload)`
 *     which mirrors the production chat-event router (strip `agent:<id>:` prefix,
 *     resolve `chatEventCallbacks` for `final`/`error`, fan out to stream listeners)
 *     but skips the WS/DLP side-effects the real router performs.
 *   • `__dispatchChatFrameForTests__` is the only production-side export tests
 *     exercise for driving frames — tests do NOT reach into private maps.
 *   • The existing `waitForChatCompletion` / `cancelChatCompletion` Promises are
 *     covered by dedicated regression tests so wiring the stream hook into the
 *     same router cannot silently break the one-shot contract.
 *
 * No test leaks state: every listener registration is either disposed in the
 * test body or has its (instanceId, sessionKey) uniquely suffixed via
 * `randomKey()` so parallel tests do not collide.
 */

let nextKey = 0;
function randomKey(prefix: string): string {
  nextKey += 1;
  return `${prefix}-${Date.now()}-${nextKey}`;
}

test('registerChatStreamListener delivers streaming + final frames and unsubscribe silences delivery', () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const received: ChatStreamPayload[] = [];
  const unsubscribe = registerChatStreamListener(instanceId, sessionKey, (p) => {
    received.push(p);
  });

  __dispatchChatFrameForTests__(instanceId, raw, {
    sessionKey: raw,
    state: 'streaming',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
  });
  __dispatchChatFrameForTests__(instanceId, raw, {
    sessionKey: raw,
    state: 'final',
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    messageId: 'msg-1',
  });

  unsubscribe();

  __dispatchChatFrameForTests__(instanceId, raw, {
    sessionKey: raw,
    state: 'streaming',
    message: { role: 'assistant', content: [{ type: 'text', text: 'late — should not fire' }] },
  });

  assert.equal(received.length, 2, 'listener received streaming + final, not the post-unsubscribe frame');
  assert.equal(received[0].state, 'streaming');
  assert.equal(received[0].sessionKey, sessionKey, 'prefix agent:<id>: is stripped');
  assert.deepEqual(received[0].message, { role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
  assert.equal(received[1].state, 'final');
  assert.equal(received[1].messageId, 'msg-1');
});

test('registerChatStreamListener delivers error frames', () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const received: ChatStreamPayload[] = [];
  const unsubscribe = registerChatStreamListener(instanceId, sessionKey, (p) => {
    received.push(p);
  });

  try {
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'error',
      errorMessage: 'LLM provider failed',
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].state, 'error');
    assert.equal(received[0].errorMessage, 'LLM provider failed');
  } finally {
    unsubscribe();
  }
});

test('registerChatStreamListener fans out to multiple listeners for the same (instanceId, sessionKey)', () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const a: ChatStreamPayload[] = [];
  const b: ChatStreamPayload[] = [];
  const unsubA = registerChatStreamListener(instanceId, sessionKey, (p) => { a.push(p); });
  const unsubB = registerChatStreamListener(instanceId, sessionKey, (p) => { b.push(p); });

  try {
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'streaming',
      message: { role: 'assistant', content: [{ type: 'text', text: 'fan-out' }] },
    });

    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].state, 'streaming');
    assert.equal(b[0].state, 'streaming');
  } finally {
    unsubA();
    unsubB();
  }
});

test('registerChatStreamListener isolates listeners by sessionKey (different sessionKey under same instanceId does not fire)', () => {
  const instanceId = randomKey('inst');
  const sessionA = randomKey('task');
  const sessionB = randomKey('task');
  const rawA = `agent:main:${sessionA}`;
  const rawB = `agent:main:${sessionB}`;

  const receivedA: ChatStreamPayload[] = [];
  const receivedB: ChatStreamPayload[] = [];
  const unsubA = registerChatStreamListener(instanceId, sessionA, (p) => { receivedA.push(p); });
  const unsubB = registerChatStreamListener(instanceId, sessionB, (p) => { receivedB.push(p); });

  try {
    __dispatchChatFrameForTests__(instanceId, rawA, {
      sessionKey: rawA,
      state: 'streaming',
      message: { role: 'assistant', content: [{ type: 'text', text: 'for A only' }] },
    });

    assert.equal(receivedA.length, 1, 'listener A received its frame');
    assert.equal(receivedA[0].sessionKey, sessionA);
    assert.equal(receivedB.length, 0, 'listener B did not receive session A frame');
  } finally {
    unsubA();
    unsubB();
  }
});

test('waitForChatCompletion still resolves on state=final when a stream listener is also registered (regression)', async () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const streamReceived: ChatStreamPayload[] = [];
  const unsubscribe = registerChatStreamListener(instanceId, sessionKey, (p) => {
    streamReceived.push(p);
  });

  const completionPromise = waitForChatCompletion(instanceId, sessionKey, 10_000);

  try {
    // streaming frame — stream listener fires, one-shot callback does not resolve yet
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'streaming',
      message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
    });

    // final frame — both stream listener and one-shot callback fire
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'final',
      message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
      messageId: 'msg-final',
    });

    const completion = await completionPromise;
    assert.equal(completion.state, 'final');
    assert.equal(completion.messageId, 'msg-final');
    assert.equal(completion.sessionKey, sessionKey);
    assert.deepEqual(completion.content, [{ type: 'text', text: 'final answer' }]);

    assert.equal(streamReceived.length, 2, 'stream listener also saw streaming + final');
    assert.equal(streamReceived[0].state, 'streaming');
    assert.equal(streamReceived[1].state, 'final');
  } finally {
    unsubscribe();
    cancelChatCompletion(instanceId, sessionKey);
  }
});

test('waitForChatCompletion rejects on state=error even when a stream listener is also registered (regression)', async () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const streamReceived: ChatStreamPayload[] = [];
  const unsubscribe = registerChatStreamListener(instanceId, sessionKey, (p) => {
    streamReceived.push(p);
  });

  const completionPromise = waitForChatCompletion(instanceId, sessionKey, 10_000);

  try {
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'error',
      errorMessage: 'Gateway provider outage',
    });

    await assert.rejects(
      () => completionPromise,
      (err: Error) => err.message === 'Gateway provider outage',
    );

    assert.equal(streamReceived.length, 1);
    assert.equal(streamReceived[0].state, 'error');
    assert.equal(streamReceived[0].errorMessage, 'Gateway provider outage');
  } finally {
    unsubscribe();
    cancelChatCompletion(instanceId, sessionKey);
  }
});

test('listener that throws does not break other listeners or the event loop', () => {
  const instanceId = randomKey('inst');
  const sessionKey = randomKey('task');
  const raw = `agent:main:${sessionKey}`;

  const healthy: ChatStreamPayload[] = [];
  // Suppress the expected console.warn for the throwing listener so the test
  // output stays clean. Restore in finally.
  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnCalls.push(args); };

  const unsubThrower = registerChatStreamListener(instanceId, sessionKey, () => {
    throw new Error('intentional test throw');
  });
  const unsubHealthy = registerChatStreamListener(instanceId, sessionKey, (p) => {
    healthy.push(p);
  });

  try {
    // If the dispatcher did not catch per-listener errors, this call would throw
    // and `healthy` would stay empty.
    __dispatchChatFrameForTests__(instanceId, raw, {
      sessionKey: raw,
      state: 'streaming',
      message: { role: 'assistant', content: [{ type: 'text', text: 'still delivered' }] },
    });

    assert.equal(healthy.length, 1, 'healthy listener fired despite sibling throw');
    assert.equal(healthy[0].state, 'streaming');
    assert.ok(
      warnCalls.some(args => typeof args[0] === 'string' && args[0].includes('chat stream listener threw')),
      'console.warn was invoked with the chat stream listener throw message',
    );
  } finally {
    console.warn = originalWarn;
    unsubThrower();
    unsubHealthy();
  }
});
