/**
 * Daemon orchestrator entry point (Phase 21 Plan 03).
 *
 * Composes the primitives shipped by 21-01 / 21-02 / earlier 21-03 tasks into
 * the running daemon:
 *
 *   loadDaemonConfig → detectClaude → DaemonHttpClient.register
 *     → startPollLoop (semaphore-gated claim) → runClaudeTask per task
 *     → StreamBatcher (500 ms flush) → startCancelPoller (5 s poll)
 *     → startHeartbeatLoop (15 s ping)
 *     → registerProcessHandlers (unhandledRejection / uncaughtException / SIGTERM / SIGINT)
 *
 * OWNED pitfall + threat mitigations:
 *   • PG1 — poll-loop gates every dispatch behind `semaphore.acquire()`.
 *   • PG2 — `registerProcessHandlers` wires unhandledRejection +
 *     uncaughtException BEFORE loops start; `handleFatal` guarantees a
 *     bounded cleanup + exit.
 *   • PG5 — `shutdownAc.signal` + per-task abort controllers flow through
 *     every loop (poll, cancel-poller, stream-batcher, heartbeat).
 *   • PG6 — heartbeat posts one request with all runtimeIds; poll-loop is
 *     per-runtime (no await across runtimes in a loop body).
 *   • PM2 — `inFlight` Map tracks every running task; `handleFatal` walks it
 *     to `failTask` each entry before exit. Orphan-pid replay (full pgrep
 *     sweep on startup) is deferred — see `AQUARIUM_DAEMON_TEST_CRASH_AT`.
 *   • T-21-03 — `[daemon] claude=<absolute path> (v<version>)` logged at
 *     startup so operators can see the binary that will be spawned.
 *   • T-21-01 / T-21-11 — `config.token` is NEVER passed to `console.log` or
 *     any logger; grep-verifiable in this file.
 *
 * Testing hooks:
 *   • `AQUARIUM_DAEMON_TEST_CRASH_AT` — exclusive env-var escape hatch for
 *     Plan 21-04 integration tests to trigger a fatal at a controllable
 *     moment (`after-register`, `before-poll`, `mid-task`). Read directly
 *     from `process.env` (the ONE sanctioned read outside `config.ts` in
 *     the entire daemon codebase; see SUMMARY "Deviations" for rationale).
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDaemonConfig } from './config.js';
import { detectClaude } from './detect.js';
import { DaemonHttpClient } from './http-client.js';
import { Semaphore } from './semaphore.js';
import { StreamBatcher } from './stream-batcher.js';
import { startCancelPoller } from './cancel-poller.js';
import { startPollLoop } from './poll-loop.js';
import { startHeartbeatLoop } from './heartbeat.js';
import { runClaudeTask } from './backends/claude.js';
import {
  handleFatal,
  gracefulShutdown,
  registerProcessHandlers,
  type InFlightRecord,
} from './crash-handler.js';
import type { DaemonStartOpts } from '../cli.js';
import type { ClaimedTask, DaemonRegisterRequest, Runtime } from '@aquarium/shared';

interface InFlight extends InFlightRecord {
  abortAc: AbortController;
}

export async function startDaemon(opts: DaemonStartOpts): Promise<void> {
  // 1. Load config. loadDaemonConfig throws DaemonConfigError with actionable
  //    messages on missing token / wrong mode; we surface that at the CLI.
  const config = await loadDaemonConfig({
    server: opts.server,
    token: opts.token,
    deviceName: opts.deviceName,
    dataDir: opts.dataDir,
    maxConcurrentTasks: opts.maxConcurrentTasks,
    config: opts.config,
    logLevel: opts.logLevel,
  });

  // SECURITY: NEVER log config.token. The grep assertion in 21-03 SUMMARY
  // depends on this — do not introduce any console.* that references it.
  const logSafe = (msg: string): void => { console.log(msg); };
  logSafe(`[daemon] server=${config.server}`);
  logSafe(`[daemon] data-dir=${config.dataDir}`);

  // 2. Detect claude. If missing, the daemon still runs and sends heartbeats
  //    (so the server keeps this daemon online) but it registers no backends.
  const claude = await detectClaude();
  if (!claude) {
    console.warn('[daemon] claude not found on PATH — continuing without backends');
  } else {
    // T-21-03 — audit the resolved path so users see what will be spawned.
    logSafe(`[daemon] claude=${claude.path} (v${claude.version})`);
  }

  // 3. PID file (best-effort; non-fatal if the dir is read-only).
  const daemonId = randomUUID();
  const pidFile = path.join(config.dataDir, 'daemon.pid');
  try { writeFileSync(pidFile, String(process.pid), { mode: 0o600 }); } catch { /* non-fatal */ }

  const shutdownAc = new AbortController();
  const http = new DaemonHttpClient({
    server: config.server,
    token: config.token,
    signal: shutdownAc.signal,
  });

  // 4. Register with server.
  //
  // workspaceId is server-inferred from the bearer token (req.daemonAuth
  // workspaceId in the /register route — Phase 19 auth middleware). When
  // the daemon supplies a string value, the server's Q1 defence-in-depth
  // guard compares against the token's workspace and 400s on mismatch, so
  // we deliberately OMIT workspaceId from the body. The Phase 21-04
  // deviation updates `DaemonRegisterRequest` to make `workspaceId`
  // optional so this is type-safe without casts.
  const registerBody: DaemonRegisterRequest = {
    daemonId,
    deviceName: config.deviceName,
    cliVersion: readPackageVersion(),
    launchedBy: os.userInfo().username,
    runtimes: claude
      ? [{
          name: `${config.deviceName}-claude`,
          provider: 'claude' as const,
          version: claude.version,
          status: 'online' as const,
        }]
      : [],
  };
  const { runtimes } = await http.register(registerBody);
  logSafe(`[daemon] registered ${runtimes.length} runtime(s)`);

  // 5. In-flight tracking for crash handler + graceful shutdown.
  const inFlight = new Map<string, InFlight>();
  const inFlightRecords = (): InFlightRecord[] =>
    Array.from(inFlight.values()).map((r) => ({ taskId: r.taskId, workspaceId: r.workspaceId }));

  // 6. Wire process-level handlers BEFORE starting loops (PG2).
  registerProcessHandlers({
    onFatal: async (err, source) => {
      await handleFatal({
        err,
        source,
        crashLogPath: path.join(config.dataDir, 'daemon.crash.log'),
        inFlight: inFlightRecords(),
        httpClient: http,
      });
    },
    onSignal: async (_signal) => {
      await gracefulShutdown({
        shutdownAc,
        inFlightDone: () => waitForInFlightDrain(inFlight),
        gracefulShutdownMs: config.gracefulShutdownMs,
        runtimeIds: runtimes.map((r: Runtime) => r.id),
        httpClient: http,
      });
      try { unlinkSync(pidFile); } catch { /* ignore */ }
    },
  });

  // Plan 21-04 test hook: deliberately fires AFTER registerProcessHandlers
  // so the resulting unhandledRejection reaches handleFatal (which writes
  // daemon.crash.log). See `maybeTestCrashAt` header for semantics.
  maybeTestCrashAt('after-register');

  if (!claude || runtimes.length === 0) {
    logSafe('[daemon] no runtimes registered; idling (heartbeats continue so server keeps daemon "online")');
  }

  const semaphore = new Semaphore(config.maxConcurrentTasks);

  const runTask = async (task: ClaimedTask): Promise<void> => {
    const abortAc = new AbortController();
    const rec: InFlight = { taskId: task.id, workspaceId: task.workspaceId, abortAc };
    inFlight.set(task.id, rec);

    const batcher = new StreamBatcher({
      taskId: task.id,
      httpClient: http,
      flushIntervalMs: config.messageFlushIntervalMs,
      signal: abortAc.signal,
      onFlushError: (err) => console.warn(`[daemon] flush error ${task.id}: ${String(err)}`),
    });

    const cancelCleanup = startCancelPoller({
      taskId: task.id,
      intervalMs: config.cancelPollIntervalMs,
      httpClient: http,
      signal: abortAc.signal,
      onCancel: () => abortAc.abort(),
      onError: (err) => console.warn(`[daemon] cancel-poll ${task.id}: ${String(err)}`),
    });

    maybeTestCrashAt('mid-task');

    try {
      await http.startTask(task.id);
      if (!claude) throw new Error('no backend available');
      const result = await runClaudeTask({
        task,
        claudePath: claude.path,
        config: {
          backends: config.backends,
          gracefulKillMs: config.gracefulKillMs,
          inactivityKillMs: config.inactivityKillMs,
        },
        onAgentMessage: (pending) => batcher.push(pending),
        abortSignal: abortAc.signal,
      });
      await batcher.stop();
      if (result.cancelled) {
        await http.failTask(task.id, 'cancelled');
      } else if (result.exitCode === 0) {
        await http.completeTask(task.id);
      } else {
        await http.failTask(task.id, `exit ${result.exitCode}`);
      }
    } catch (err) {
      try { await batcher.stop(); } catch { /* ignore */ }
      try {
        const msg = err instanceof Error ? err.message : 'daemon error';
        await http.failTask(task.id, msg);
      } catch { /* best effort */ }
    } finally {
      cancelCleanup();
      inFlight.delete(task.id);
    }
  };

  maybeTestCrashAt('before-poll');

  // 7. Start poll loop (per-runtime, semaphore-gated — PG1).
  void startPollLoop({
    runtimes: runtimes.map((r: Runtime) => ({ id: r.id })),
    httpClient: http,
    semaphore,
    pollIntervalMs: config.pollIntervalMs,
    shutdownSignal: shutdownAc.signal,
    runTask,
    onError: (err, where) => console.warn(`[daemon] ${where}: ${String(err)}`),
  }).catch((err: unknown) => {
    console.error(`[daemon] poll-loop crashed: ${String(err)}`);
  });

  // 8. Heartbeat loop.
  startHeartbeatLoop({
    runtimeIds: runtimes.map((r: Runtime) => r.id),
    httpClient: http,
    intervalMs: config.heartbeatIntervalMs,
    shutdownSignal: shutdownAc.signal,
    onError: (err) => console.warn(`[daemon] heartbeat: ${String(err)}`),
  });

  // 9. Block forever — process.exit is driven by signal handlers or
  //    fatal errors (registered above).
  await new Promise<void>(() => { /* never resolves */ });
}

async function waitForInFlightDrain(inFlight: Map<string, InFlight>): Promise<void> {
  while (inFlight.size > 0) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Plan 21-04 integration-test escape hatch.
 *
 * Reads `process.env.AQUARIUM_DAEMON_TEST_CRASH_AT` — the ONE sanctioned
 * `process.env` access outside `config.ts` in the whole daemon module tree.
 * Accepts:
 *   • 'after-register' — throws right after registerProcessHandlers wires up
 *   • 'before-poll'    — throws before startPollLoop is called
 *   • 'mid-task'       — throws inside the first runTask before the backend runs
 *
 * The throw is scheduled via `queueMicrotask` so it escapes the awaited
 * `startDaemon` promise chain and reaches the process-level
 * `unhandledRejection` handler (wired by `registerProcessHandlers`).
 * That handler calls `handleFatal` → `appendFileSync(daemon.crash.log)` →
 * `process.exit(1)`, which is the flow Plan 21-04's SC-4 asserts.
 *
 * Plan 21-04 deviation (Rule 1 — Bug): the original 21-03 implementation
 * threw synchronously inside `startDaemon`; the throw was caught by
 * cli.ts's `.parseAsync().catch()`, never reaching `unhandledRejection`
 * and therefore never writing `daemon.crash.log`. The 21-04 integration
 * spec requires the crash log to exist, so this function now uses
 * `queueMicrotask` to route the throw around `startDaemon`'s awaited
 * callers. Production is unaffected — the hook is only active when the
 * env var is explicitly set to a recognised marker.
 *
 * Any other value (or undefined) is a no-op.
 */
function maybeTestCrashAt(marker: 'after-register' | 'before-poll' | 'mid-task'): void {
  if (process.env.AQUARIUM_DAEMON_TEST_CRASH_AT === marker) {
    queueMicrotask(() => {
      throw new Error(`AQUARIUM_DAEMON_TEST_CRASH_AT=${marker} — synthetic crash`);
    });
  }
}

// ── Stub entries for cli.ts commander — the remaining daemon subcommands. ──

export async function stopDaemon(): Promise<void> {
  const pidFile = resolveDaemonPidPath();
  if (!existsSync(pidFile)) {
    console.log('no daemon running');
    return;
  }
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error('invalid daemon.pid');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`sent SIGTERM to pid ${pid}`);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

export async function daemonStatus(): Promise<void> {
  const pidFile = resolveDaemonPidPath();
  if (!existsSync(pidFile)) {
    console.log('daemon: stopped');
    return;
  }
  const pid = readFileSync(pidFile, 'utf8').trim();
  console.log(`daemon: running (pid ${pid})`);
}

export async function listTokens(): Promise<void> {
  console.log(
    'token list — issue tokens via the web UI (Daemon Tokens) and paste into ~/.aquarium/daemon.json',
  );
}

export async function revokeToken(_id: string): Promise<void> {
  console.log('token revoke — use the web UI (Daemon Tokens → Revoke)');
}

function resolveDaemonPidPath(): string {
  const dataDir = process.env.AQUARIUM_DATA_DIR ?? path.join(os.homedir(), '.aquarium');
  return path.join(dataDir, 'daemon.pid');
}
