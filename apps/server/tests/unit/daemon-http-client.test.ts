import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DaemonHttpClient, DaemonHttpError } from '../../src/daemon/http-client.js';

type FetchArgs = [string | URL, RequestInit | undefined];

function makeFakeFetch(responses: Array<Response | (() => Response | Promise<Response>)>) {
  const calls: FetchArgs[] = [];
  let i = 0;
  const fn: typeof fetch = async (url, init) => {
    calls.push([url as string | URL, init as RequestInit | undefined]);
    const next = responses[i++];
    if (!next) throw new Error('fake fetch: no more responses scripted');
    return typeof next === 'function' ? await next() : next;
  };
  return { fn, calls };
}

function okJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function errJson(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchFn: typeof fetch, extras: Record<string, unknown> = {}): DaemonHttpClient {
  return new DaemonHttpClient({
    server: 'http://localhost:3001',
    token: 'adt_test_token_abc',
    _fetch: fetchFn,
    _setTimeout: (fn) => {
      fn();
      return 0;
    },
    _clearTimeout: () => {},
    ...extras,
  });
}

describe('DaemonHttpClient (CLI-02 / T-21-01 / PG5)', () => {
  test('register POSTs to /api/daemon/register with bearer header', async () => {
    const { fn, calls } = makeFakeFetch([okJson({ runtimes: [] })]);
    const client = makeClient(fn);
    const result = await client.register({
      workspaceId: '',
      daemonId: 'd1',
      deviceName: 'host',
      cliVersion: '1.4.0',
      launchedBy: 'u',
      runtimes: [],
    });
    assert.deepEqual(result, { runtimes: [] });
    assert.equal(calls.length, 1);
    const [url, init] = calls[0]!;
    assert.equal(String(url), 'http://localhost:3001/api/daemon/register');
    assert.equal(init?.method, 'POST');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer adt_test_token_abc');
  });

  test('claimTask handles { task: null } response', async () => {
    const { fn } = makeFakeFetch([okJson({ task: null })]);
    const client = makeClient(fn);
    const r = await client.claimTask('rt-1');
    assert.deepEqual(r, { task: null });
  });

  test('completeTask returns { discarded: true, status: "cancelled" } without throwing', async () => {
    const { fn } = makeFakeFetch([okJson({ discarded: true, status: 'cancelled' })]);
    const client = makeClient(fn);
    const r = await client.completeTask('t-1');
    assert.deepEqual(r, { discarded: true, status: 'cancelled' });
  });

  test('retries 503 twice then succeeds (3 total attempts)', async () => {
    const { fn, calls } = makeFakeFetch([errJson(503, 'upstream'), errJson(503, 'upstream'), okJson({ ok: true })]);
    const client = makeClient(fn);
    const r = await client.deregister(['rt-1']);
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 3);
  });

  test('retries 503 to exhaustion then throws DaemonHttpError', async () => {
    const { fn, calls } = makeFakeFetch([errJson(503, 'down'), errJson(503, 'down'), errJson(503, 'down')]);
    const client = makeClient(fn);
    await assert.rejects(
      client.deregister(['rt-1']),
      (err: unknown) => err instanceof DaemonHttpError && (err as DaemonHttpError).status === 503,
    );
    assert.equal(calls.length, 3);
  });

  test('does NOT retry 401 — throws immediately', async () => {
    const { fn, calls } = makeFakeFetch([errJson(401, 'daemon authentication failed')]);
    const client = makeClient(fn);
    await assert.rejects(
      client.heartbeat(['rt-1']),
      (err: unknown) => err instanceof DaemonHttpError && (err as DaemonHttpError).status === 401,
    );
    assert.equal(calls.length, 1);
  });

  test('does NOT retry 400 — throws with server error string', async () => {
    const { fn, calls } = makeFakeFetch([errJson(400, 'invalid body')]);
    const client = makeClient(fn);
    await assert.rejects(
      client.startTask('t-1'),
      (err: unknown) => err instanceof DaemonHttpError && /invalid body/.test((err as Error).message),
    );
    assert.equal(calls.length, 1);
  });

  test('retries 429 (respects server-side per-token bucket)', async () => {
    const { fn, calls } = makeFakeFetch([errJson(429, 'rate-limited'), okJson({ ok: true })]);
    const client = makeClient(fn);
    await client.deregister(['rt-1']);
    assert.equal(calls.length, 2);
  });

  test('AbortError propagates without retry', async () => {
    const { fn, calls } = makeFakeFetch([
      () => {
        const e = new Error('abort');
        (e as { name?: string }).name = 'AbortError';
        throw e;
      },
    ]);
    const client = makeClient(fn);
    await assert.rejects(client.heartbeat([]), (err: unknown) => (err as { name?: string }).name === 'AbortError');
    assert.equal(calls.length, 1);
  });

  test('exponential backoff delays are 100 * 2^n (verified via injected setTimeout)', async () => {
    const delays: number[] = [];
    const { fn } = makeFakeFetch([errJson(503, 'x'), errJson(503, 'x'), okJson({ ok: true })]);
    const client = new DaemonHttpClient({
      server: 'http://localhost:3001',
      token: 'adt_x',
      _fetch: fn,
      _setTimeout: (cb, ms) => {
        delays.push(ms);
        cb();
        return 0;
      },
      _clearTimeout: () => {},
      _baseBackoffMs: 100,
      _maxAttempts: 3,
    });
    await client.deregister(['rt-1']);
    assert.deepEqual(delays, [100, 200]);
  });

  test('token never appears in client-constructed error messages', async () => {
    // Server error body contains no token reference — proves client doesn't inject one.
    // Three 500s to exhaust the retry budget (maxAttempts=3) and surface DaemonHttpError.
    const { fn } = makeFakeFetch([
      errJson(500, 'internal error'),
      errJson(500, 'internal error'),
      errJson(500, 'internal error'),
    ]);
    const client = makeClient(fn);
    try {
      await client.startTask('t-1');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof DaemonHttpError, `expected DaemonHttpError, got ${(err as Error).constructor.name}`);
      const msg = (err as DaemonHttpError).message;
      assert.doesNotMatch(msg, /adt_test_token_abc/, 'token must never leak into error.message');
    }
  });

  test('getTaskStatus GETs /api/daemon/tasks/:id/status', async () => {
    const { fn, calls } = makeFakeFetch([okJson({ status: 'running', cancelled: false })]);
    const client = makeClient(fn);
    const r = await client.getTaskStatus('t-1');
    assert.deepEqual(r, { status: 'running', cancelled: false });
    assert.equal(calls[0]![1]?.method, 'GET');
    assert.equal(String(calls[0]![0]), 'http://localhost:3001/api/daemon/tasks/t-1/status');
  });

  test('postMessages wraps array as { messages: [...] }', async () => {
    const { fn, calls } = makeFakeFetch([okJson({ accepted: 2 })]);
    const client = makeClient(fn);
    const msgs = [
      { type: 'text' as const, content: 'a', workspaceId: 'w', issueId: 'i' },
      { type: 'text' as const, content: 'b', workspaceId: 'w', issueId: 'i' },
    ];
    const r = await client.postMessages('t-1', msgs);
    assert.deepEqual(r, { accepted: 2 });
    const body = JSON.parse(String(calls[0]![1]?.body ?? '{}')) as { messages?: unknown[] };
    assert.deepEqual(body.messages, msgs);
  });

  test('signal is threaded into every fetch call (PG5)', async () => {
    const controller = new AbortController();
    const { fn, calls } = makeFakeFetch([okJson({ runtimes: [] })]);
    const client = new DaemonHttpClient({
      server: 'http://localhost:3001',
      token: 'adt_x',
      signal: controller.signal,
      _fetch: fn,
      _setTimeout: (cb) => {
        cb();
        return 0;
      },
      _clearTimeout: () => {},
    });
    await client.register({
      workspaceId: '',
      daemonId: 'd1',
      deviceName: 'h',
      cliVersion: 'x',
      launchedBy: 'u',
      runtimes: [],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![1]?.signal, controller.signal);
  });
});
