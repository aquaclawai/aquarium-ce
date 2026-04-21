import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  errorToString,
  handleFatal,
  gracefulShutdown,
} from '../../src/daemon/crash-handler.js';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aq-crash-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('errorToString (CLI-05)', () => {
  test('Error → name: message + stack', () => {
    const s = errorToString(new TypeError('bad'));
    assert.match(s, /^TypeError: bad/);
  });
  test('string passes through', () => {
    assert.equal(errorToString('x'), 'x');
  });
  test('plain object → JSON.stringify', () => {
    assert.equal(errorToString({ a: 1 }), '{"a":1}');
  });
  test('null / undefined → literal string', () => {
    assert.equal(errorToString(null), 'null');
    assert.equal(errorToString(undefined), 'undefined');
  });
});

describe('handleFatal (CLI-05 / PG2)', () => {
  test('appends crash log line and fails in-flight tasks and calls exit(1)', async () => {
    const crashLog = join(dir, 'daemon.crash.log');
    const failedTasks: string[] = [];
    let exited: number | null = null;
    await handleFatal({
      err: new Error('kaboom'),
      source: 'unhandledRejection',
      crashLogPath: crashLog,
      inFlight: [
        { taskId: 't-1', workspaceId: 'w' },
        { taskId: 't-2', workspaceId: 'w' },
      ],
      httpClient: {
        failTask: async (id: string) => {
          failedTasks.push(id);
          return { discarded: false, status: 'failed' as const };
        },
      },
      _exit: (code) => { exited = code; },
    });
    const body = readFileSync(crashLog, 'utf8');
    assert.match(body, /unhandledRejection/);
    assert.match(body, /kaboom/);
    assert.deepEqual(failedTasks.sort(), ['t-1', 't-2']);
    assert.equal(exited, 1);
  });

  test('failTask that hangs does not block exit beyond cap (overridden)', async () => {
    const crashLog = join(dir, 'daemon.crash.log');
    let exited: number | null = null;
    const started = Date.now();
    await handleFatal({
      err: 'x',
      source: 'uncaughtException',
      crashLogPath: crashLog,
      inFlight: [{ taskId: 't-1', workspaceId: 'w' }],
      httpClient: { failTask: () => new Promise(() => { /* never */ }) },
      failTaskTimeoutMs: 50,
      _exit: (code) => { exited = code; },
    });
    const elapsed = Date.now() - started;
    assert.equal(exited, 1);
    assert.ok(elapsed < 500, `elapsed=${elapsed}ms should be < 500`);
  });

  test('failTask throw does not cascade — still exits', async () => {
    const crashLog = join(dir, 'daemon.crash.log');
    let exited: number | null = null;
    await handleFatal({
      err: 'x',
      source: 'uncaughtException',
      crashLogPath: crashLog,
      inFlight: [{ taskId: 't-1', workspaceId: 'w' }],
      httpClient: { failTask: async () => { throw new Error('server down'); } },
      _exit: (code) => { exited = code; },
    });
    assert.equal(exited, 1);
  });

  test('appendFileSync failure is swallowed — still exits(1)', async () => {
    let exited: number | null = null;
    await handleFatal({
      err: 'x',
      source: 'uncaughtException',
      crashLogPath: '/does/not/exist/path.log',
      inFlight: [],
      httpClient: {
        failTask: async () => ({ discarded: false, status: 'failed' as const }),
      },
      _appendFileSync: () => { throw new Error('EACCES'); },
      _exit: (code) => { exited = code; },
    });
    assert.equal(exited, 1);
  });

  test('empty in-flight list still writes crash log and exits', async () => {
    const crashLog = join(dir, 'daemon.crash.log');
    let exited: number | null = null;
    await handleFatal({
      err: new Error('empty'),
      source: 'manual',
      crashLogPath: crashLog,
      inFlight: [],
      httpClient: {
        failTask: async () => ({ discarded: false, status: 'failed' as const }),
      },
      _exit: (code) => { exited = code; },
    });
    const body = readFileSync(crashLog, 'utf8');
    assert.match(body, /manual/);
    assert.equal(exited, 1);
  });
});

describe('gracefulShutdown', () => {
  test('aborts + drains + deregisters + exits(0)', async () => {
    const ac = new AbortController();
    const deregistered: string[][] = [];
    let exited: number | null = null;
    await gracefulShutdown({
      shutdownAc: ac,
      inFlightDone: async () => { /* drained immediately */ },
      gracefulShutdownMs: 50,
      runtimeIds: ['rt-1', 'rt-2'],
      httpClient: {
        deregister: async (ids: string[]) => {
          deregistered.push(ids);
          return { ok: true };
        },
      },
      _exit: (code) => { exited = code; },
    });
    assert.equal(ac.signal.aborted, true);
    assert.deepEqual(deregistered, [['rt-1', 'rt-2']]);
    assert.equal(exited, 0);
  });

  test('hanging drain honours gracefulShutdownMs cap (still exits)', async () => {
    const ac = new AbortController();
    let exited: number | null = null;
    const started = Date.now();
    await gracefulShutdown({
      shutdownAc: ac,
      inFlightDone: () => new Promise(() => { /* never drains */ }),
      gracefulShutdownMs: 50,
      runtimeIds: ['rt-1'],
      httpClient: {
        deregister: async () => ({ ok: true }),
      },
      _exit: (code) => { exited = code; },
    });
    const elapsed = Date.now() - started;
    assert.equal(exited, 0);
    assert.ok(elapsed < 300, `elapsed=${elapsed}ms should be < 300`);
  });

  test('deregister throw does not block exit(0)', async () => {
    const ac = new AbortController();
    let exited: number | null = null;
    await gracefulShutdown({
      shutdownAc: ac,
      inFlightDone: async () => { /* drained */ },
      gracefulShutdownMs: 50,
      runtimeIds: ['rt-1'],
      httpClient: {
        deregister: async () => { throw new Error('server down'); },
      },
      _exit: (code) => { exited = code; },
    });
    assert.equal(exited, 0);
  });
});
