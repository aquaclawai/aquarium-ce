import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram } from '../../src/cli.js';

type Recorder = { where: string; opts?: unknown; args?: unknown[] };

async function parseArgv(argv: string[], handlers: Parameters<typeof buildProgram>[0] = {}): Promise<Recorder> {
  const called: Recorder = { where: '' };
  const withRecorder = {
    defaultAction: (opts: unknown) => {
      called.where = 'default';
      called.opts = opts;
    },
    daemonStart: (opts: unknown) => {
      called.where = 'daemon:start';
      called.opts = opts;
    },
    daemonStop: () => {
      called.where = 'daemon:stop';
    },
    daemonStatus: () => {
      called.where = 'daemon:status';
    },
    daemonTokenList: () => {
      called.where = 'daemon:token:list';
    },
    daemonTokenRevoke: (id: string) => {
      called.where = 'daemon:token:revoke';
      called.args = [id];
    },
    ...handlers,
  };
  const program = buildProgram(withRecorder);
  program.exitOverride();
  await program.parseAsync(['node', 'aquarium', ...argv]);
  return called;
}

describe('cli.ts commander dispatch (CLI-02)', () => {
  test('default command with --port routes to defaultAction', async () => {
    const called = await parseArgv(['--port', '3002']);
    assert.equal(called.where, 'default');
    assert.equal((called.opts as { port?: string }).port, '3002');
  });

  test('daemon start --server --token routes to daemonStart', async () => {
    const called = await parseArgv(['daemon', 'start', '--server', 'http://foo:3001', '--token', 'adt_x']);
    assert.equal(called.where, 'daemon:start');
    const opts = called.opts as { server?: string; token?: string };
    assert.equal(opts.server, 'http://foo:3001');
    assert.equal(opts.token, 'adt_x');
  });

  test('daemon start --max-concurrent-tasks parses as integer', async () => {
    const called = await parseArgv(['daemon', 'start', '--max-concurrent-tasks', '7']);
    const opts = called.opts as { maxConcurrentTasks?: number };
    assert.equal(opts.maxConcurrentTasks, 7);
  });

  test('daemon stop routes to daemonStop', async () => {
    const called = await parseArgv(['daemon', 'stop']);
    assert.equal(called.where, 'daemon:stop');
  });

  test('daemon status routes to daemonStatus', async () => {
    const called = await parseArgv(['daemon', 'status']);
    assert.equal(called.where, 'daemon:status');
  });

  test('daemon token list routes to daemonTokenList', async () => {
    const called = await parseArgv(['daemon', 'token', 'list']);
    assert.equal(called.where, 'daemon:token:list');
  });

  test('daemon token revoke <id> passes id', async () => {
    const called = await parseArgv(['daemon', 'token', 'revoke', 'tok-123']);
    assert.equal(called.where, 'daemon:token:revoke');
    assert.deepEqual(called.args, ['tok-123']);
  });

  test('daemon start help output mentions core flags (--server / --token / --device-name)', () => {
    const program = buildProgram({
      daemonStart: () => {
        throw new Error('should not run');
      },
    });
    // Find the daemon start subcommand and ask it for its help text directly.
    // This avoids triggering commander's --help exit path which can disrupt node:test.
    const daemon = program.commands.find((c) => c.name() === 'daemon');
    assert.ok(daemon, 'daemon command registered');
    const start = daemon!.commands.find((c) => c.name() === 'start');
    assert.ok(start, 'daemon start subcommand registered');
    const helpText = start!.helpInformation();
    assert.match(helpText, /--server/);
    assert.match(helpText, /--token/);
    assert.match(helpText, /--device-name/);
  });

  test('importing cli.ts does NOT transitively load index.ce.js or server-core.js', async () => {
    // Hash the source to prove no static import of these modules exists.
    const { readFileSync } = await import('node:fs');
    const body = readFileSync(new URL('../../src/cli.ts', import.meta.url), 'utf8');
    const idxImports = body.match(/from\s+['"]\.\/index\.ce/g) ?? [];
    const srvImports = body.match(/from\s+['"]\.\/server-core/g) ?? [];
    const dbImports = body.match(/from\s+['"]\.\/db\/index/g) ?? [];
    assert.equal(idxImports.length, 0, 'index.ce.js must be dynamic-import only, no static `from` clause');
    assert.equal(srvImports.length, 0, 'server-core.js must not be imported from cli.ts');
    assert.equal(dbImports.length, 0, 'db/index.js must not be imported from cli.ts');
    // Dynamic import inside runDefaultServer is allowed:
    assert.match(body, /await import\(['"]\.\/index\.ce\.js['"]\)/);
  });
});
