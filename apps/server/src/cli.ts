#!/usr/bin/env node

/**
 * Aquarium CLI entry point (Phase 21-02).
 *
 * Dispatches to one of two worlds via commander:
 *   • Default (no subcommand): boots the CE server exactly as pre-21.
 *   • `daemon {start|stop|status|token ...}`: the external daemon.
 *
 * Invariants:
 *   • `buildProgram()` is a pure factory — NO side effects at import time.
 *   • No static import of `./index.ce.js` / `./server-core.js` / `./db/index.js`
 *     — the daemon subcommand branch never loads CE server modules (PG2).
 *   • Default command's body is byte-equivalent (logically) to pre-21 behavior.
 *   • Token never printed to argv or logs — PM7 / T-21-01 carry-through.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

export interface DefaultOpts {
  port?: string;
  dataDir?: string;
  host?: string;
  open?: boolean;
}

export interface DaemonStartOpts {
  server?: string;
  token?: string;
  deviceName?: string;
  dataDir?: string;
  maxConcurrentTasks?: number;
  config?: string;
  foreground?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface CliHandlers {
  defaultAction?: (opts: DefaultOpts) => Promise<void> | void;
  daemonStart?: (opts: DaemonStartOpts) => Promise<void> | void;
  daemonStop?: () => Promise<void> | void;
  daemonStatus?: () => Promise<void> | void;
  daemonTokenList?: () => Promise<void> | void;
  daemonTokenRevoke?: (id: string) => Promise<void> | void;
}

// ── Version (read from package.json at runtime, not a hard-coded literal) ──
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // From dist/cli.js the package.json is one level up; from src via tsx the same.
    const pkgPath = join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ── Factory (exported for unit tests; do NOT execute at import time) ──
export function buildProgram(handlers?: CliHandlers): Command {
  const program = new Command();
  program.name('aquarium').version(readVersion());

  // Scope root-program options to the root command only. Without this,
  // commander v14 lets global options like `--data-dir` be consumed at the
  // parent level even when they appear AFTER a subcommand (e.g.
  // `aquarium daemon start --data-dir /tmp`), which clobbered the daemon
  // subcommand's own `--data-dir` flag. Per
  // https://github.com/tj/commander.js/blob/HEAD/docs/options-in-subcommands.md,
  // `enablePositionalOptions()` on the parent + the child's own matching
  // `option()` definitions let each subcommand own its flag space.
  //
  // Plan 21-04 deviation (Rule 1 — Bug): before this fix, `--data-dir` was
  // silently consumed by the root, landing as undefined in DaemonStartOpts
  // and letting loadDaemonConfig fall through to `~/.aquarium` (breaking
  // the SC-4 integration-test assertion that crash logs land in the
  // test's tmpdir).
  program.enablePositionalOptions();

  program
    .option('--port <p>', 'server port', '3001')
    .option('--data-dir <path>', 'data directory')
    .option('--host <h>', 'bind host')
    .option('--open', 'open browser on start', false)
    .action(async (opts: DefaultOpts) => {
      if (handlers?.defaultAction) {
        await handlers.defaultAction(opts);
        return;
      }
      await runDefaultServer(opts);
    });

  const daemon = program
    .command('daemon')
    .description('External daemon — connect to an Aquarium server and claim tasks');

  daemon
    .command('start')
    .description('Start the daemon (foreground)')
    .option('--server <url>', 'server URL (overrides daemon.json)')
    .option('--token <t>', 'daemon token (overrides daemon.json)')
    .option('--device-name <n>', 'device label')
    .option('--data-dir <path>', 'override ~/.aquarium')
    .option('--max-concurrent-tasks <n>', 'max parallel tasks', (v) => parseInt(v, 10))
    .option('--config <path>', 'path to daemon config file')
    .option('--foreground', 'force foreground (default on Windows)', false)
    .option('--log-level <l>', 'debug|info|warn|error')
    .action(async (opts: DaemonStartOpts) => {
      if (handlers?.daemonStart) {
        await handlers.daemonStart(opts);
        return;
      }
      // Production path: lazy-import so the daemon command never loads ./index.ce.js
      const { startDaemon } = (await import('./daemon/main.js')) as {
        startDaemon: (o: DaemonStartOpts) => Promise<void>;
      };
      await startDaemon(opts);
    });

  daemon
    .command('stop')
    .description('Stop the running daemon (reads PID file)')
    .action(async () => {
      if (handlers?.daemonStop) {
        await handlers.daemonStop();
        return;
      }
      const { stopDaemon } = (await import('./daemon/main.js')) as {
        stopDaemon: () => Promise<void>;
      };
      await stopDaemon();
    });

  daemon
    .command('status')
    .description('Show daemon status (PID + /status ping)')
    .action(async () => {
      if (handlers?.daemonStatus) {
        await handlers.daemonStatus();
        return;
      }
      const { daemonStatus } = (await import('./daemon/main.js')) as {
        daemonStatus: () => Promise<void>;
      };
      await daemonStatus();
    });

  const token = daemon.command('token').description('Daemon token management');
  token
    .command('list')
    .description('List daemon tokens for this daemon')
    .action(async () => {
      if (handlers?.daemonTokenList) {
        await handlers.daemonTokenList();
        return;
      }
      const { listTokens } = (await import('./daemon/main.js')) as {
        listTokens: () => Promise<void>;
      };
      await listTokens();
    });
  token
    .command('revoke <id>')
    .description('Revoke a daemon token by id')
    .action(async (id: string) => {
      if (handlers?.daemonTokenRevoke) {
        await handlers.daemonTokenRevoke(id);
        return;
      }
      const { revokeToken } = (await import('./daemon/main.js')) as {
        revokeToken: (id: string) => Promise<void>;
      };
      await revokeToken(id);
    });

  return program;
}

// ── Default command body — preserves pre-21 behavior verbatim ──
async function runDefaultServer(opts: DefaultOpts): Promise<void> {
  // Data directory: --data-dir flag > AQUARIUM_DATA_DIR env > ~/.aquarium/
  const dataDir = opts.dataDir ?? process.env.AQUARIUM_DATA_DIR ?? join(homedir(), '.aquarium');
  const dbPath = join(dataDir, 'aquarium.db');

  // Ensure data directory exists.
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  }

  // Set env vars BEFORE config.ts is imported (transitively via index.ce.ts).
  // config.ts reads process.env at module evaluation time, so these must be set
  // before the dynamic import below triggers that module graph.
  process.env.EDITION = 'ce';
  process.env.AQUARIUM_DB_PATH = dbPath;
  if (opts.port !== undefined) process.env.PORT = opts.port;
  if (opts.host !== undefined) process.env.HOST = opts.host;

  // Print startup banner before server starts.
  const port = opts.port ?? process.env.PORT ?? '3001';
  console.log('');
  console.log('  Aquarium CE');
  console.log('  -----------');
  console.log(`  Data:   ${dataDir}`);
  console.log(`  DB:     ${dbPath}`);
  console.log(`  Server: http://localhost:${port}`);
  console.log('');

  // Check Docker availability.
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore' });
    console.log('  Docker: connected');
  } catch {
    console.log('  Docker: not found (required for agent instances)');
  }
  console.log('');

  // Dynamic import so env vars are set before config.ts module-level reads.
  // index.ce.ts handles: log redaction install, createApp, proxy routes, startServer.
  await import('./index.ce.js');

  // Handle --open flag (open browser after server starts).
  if (opts.open) {
    const url = `http://localhost:${port}`;
    const { exec } = await import('node:child_process');
    if (process.platform === 'win32') {
      exec(`cmd /c start "" "${url}"`);
    } else {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${cmd} ${url}`);
    }
  }
}

// ── Entry point — only runs when this file is invoked directly ──
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  // PG2: top-level `.catch()` wraps all action-layer rejections.
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(msg);
      process.exit(1);
    });
}
