import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, stat, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDaemonConfig, DaemonConfigError, DEFAULT_DAEMON_CONFIG } from '../../src/daemon/config.js';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aq-daemon-cfg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadDaemonConfig (CLI-03 / T-21-02)', () => {
  test('first-run seeds starter file with 0600 and exits with actionable error', async () => {
    await assert.rejects(
      loadDaemonConfig({ dataDir: dir, _env: {} }),
      (err: unknown) => err instanceof DaemonConfigError && /Created/.test(String((err as Error).message)),
    );
    const body = JSON.parse(await readFile(join(dir, 'daemon.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(body.server, 'http://localhost:3001');
    assert.equal(body.token, '');
    if (process.platform !== 'win32') {
      const mode = (await stat(join(dir, 'daemon.json'))).mode & 0o777;
      assert.equal(mode, 0o600, `starter file mode must be 0600, got 0${mode.toString(8)}`);
    }
  });

  test('rejects world-readable config (mode 0o644)', async () => {
    if (process.platform === 'win32') return; // POSIX-only check
    const p = join(dir, 'daemon.json');
    await writeFile(p, JSON.stringify({ server: 'http://x', token: 'adt_abc' }));
    await chmod(p, 0o644);
    await assert.rejects(
      loadDaemonConfig({ dataDir: dir, _env: {} }),
      (err: unknown) => err instanceof DaemonConfigError && /644|chmod/.test(String((err as Error).message)),
    );
  });

  test('precedence: flag > env > file > default', async () => {
    const p = join(dir, 'daemon.json');
    await writeFile(p, JSON.stringify({ server: 'http://file', token: 'adt_from_file' }), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    // File-only: server = http://file
    const c1 = await loadDaemonConfig({ dataDir: dir, _env: {} });
    assert.equal(c1.server, 'http://file');
    assert.equal(c1.token, 'adt_from_file');
    // Env wins over file
    const c2 = await loadDaemonConfig({ dataDir: dir, _env: { AQUARIUM_DAEMON_SERVER: 'http://env' } });
    assert.equal(c2.server, 'http://env');
    // Flag wins over env
    const c3 = await loadDaemonConfig({
      dataDir: dir,
      server: 'http://flag',
      _env: { AQUARIUM_DAEMON_SERVER: 'http://env' },
    });
    assert.equal(c3.server, 'http://flag');
  });

  test('defaults populated for every numeric field', async () => {
    const p = join(dir, 'daemon.json');
    await writeFile(p, JSON.stringify({ token: 'adt_x' }), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    const c = await loadDaemonConfig({ dataDir: dir, _env: {}, _hostname: () => 'testhost' });
    assert.equal(c.maxConcurrentTasks, DEFAULT_DAEMON_CONFIG.maxConcurrentTasks);
    assert.equal(c.pollIntervalMs, DEFAULT_DAEMON_CONFIG.pollIntervalMs);
    assert.equal(c.heartbeatIntervalMs, DEFAULT_DAEMON_CONFIG.heartbeatIntervalMs);
    assert.equal(c.cancelPollIntervalMs, DEFAULT_DAEMON_CONFIG.cancelPollIntervalMs);
    assert.equal(c.messageFlushIntervalMs, DEFAULT_DAEMON_CONFIG.messageFlushIntervalMs);
    assert.equal(c.inactivityKillMs, DEFAULT_DAEMON_CONFIG.inactivityKillMs);
    assert.equal(c.gracefulKillMs, DEFAULT_DAEMON_CONFIG.gracefulKillMs);
    assert.equal(c.gracefulShutdownMs, DEFAULT_DAEMON_CONFIG.gracefulShutdownMs);
    assert.equal(c.deviceName, 'testhost');
    assert.deepEqual(c.backends.claude.allow, DEFAULT_DAEMON_CONFIG.backends.claude.allow);
  });

  test('missing or non-adt token throws actionable error', async () => {
    const p = join(dir, 'daemon.json');
    await writeFile(p, JSON.stringify({ server: 'http://x', token: '' }), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    await assert.rejects(
      loadDaemonConfig({ dataDir: dir, _env: {} }),
      (err: unknown) => err instanceof DaemonConfigError && /no token/.test(String((err as Error).message)),
    );
    // Non-prefix:
    await writeFile(p, JSON.stringify({ server: 'http://x', token: 'nope' }), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    await assert.rejects(loadDaemonConfig({ dataDir: dir, _env: {} }), DaemonConfigError);
  });

  test('maxConcurrentTasks clamps into [1, 64]', async () => {
    const p = join(dir, 'daemon.json');
    await writeFile(p, JSON.stringify({ token: 'adt_x', maxConcurrentTasks: 999 }), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    const c = await loadDaemonConfig({ dataDir: dir, _env: {} });
    assert.equal(c.maxConcurrentTasks, 64);
    // Override with flag = 0 → clamp to 1
    const c2 = await loadDaemonConfig({ dataDir: dir, _env: {}, maxConcurrentTasks: 0 });
    assert.equal(c2.maxConcurrentTasks, 1);
  });

  test('invalid JSON in config file throws DaemonConfigError (not SyntaxError crash)', async () => {
    const p = join(dir, 'daemon.json');
    await writeFile(p, '{not valid', { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(p, 0o600);
    await assert.rejects(loadDaemonConfig({ dataDir: dir, _env: {} }), DaemonConfigError);
  });
});
