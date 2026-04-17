/**
 * Daemon config loader (Plan 21-02, CLI-03).
 *
 * Resolves the effective `DaemonConfig` by merging precedence layers:
 *   CLI flags > process env > ~/.aquarium/daemon.json > built-in defaults.
 *
 * OWNED pitfall mitigations:
 *   • T-21-02 — world-readable token file: refuses to start if
 *     `(stat.mode & 0o077) !== 0` on POSIX; writes with `{ mode: 0o600 }`
 *     then explicit `chmod 0o600`.
 *   • PG2 — every failure path throws a typed `DaemonConfigError` with an
 *     actionable message; no SyntaxError/ENOENT ever bubbles unclassified.
 *   • T-21-11 — token stays in the file/env/memory boundary, NEVER logged or
 *     echoed (nothing in this module writes `token` to console / argv).
 *
 * The module is platform-aware: Windows skips the mode check (NTFS perms
 * differ from POSIX), but still writes the file with `mode: 0o600` for
 * defence-in-depth on WSL / Cygwin / Git-Bash consumers.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import type { DaemonConfigFile } from '@aquarium/shared';

export interface DaemonConfig {
  server: string;
  token: string;
  deviceName: string;
  maxConcurrentTasks: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  cancelPollIntervalMs: number;
  messageFlushIntervalMs: number;
  inactivityKillMs: number;
  gracefulKillMs: number;
  gracefulShutdownMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dataDir: string;
  configPath: string;
  backends: {
    claude: { allow: string[] };
    codex: { allow: string[] };
    opencode: Record<string, never>;
    openclaw: { allow: string[] };
    hermes: Record<string, never>;
  };
}

export const DEFAULT_DAEMON_CONFIG = {
  server: 'http://localhost:3001',
  maxConcurrentTasks: 10,
  pollIntervalMs: 2_000,
  heartbeatIntervalMs: 15_000,
  cancelPollIntervalMs: 5_000,
  messageFlushIntervalMs: 500,
  inactivityKillMs: 60_000,
  gracefulKillMs: 10_000,
  gracefulShutdownMs: 15_000,
  logLevel: 'info' as const,
  backends: {
    claude: { allow: ['*'] },
    codex: { allow: ['*'] },
    opencode: {},
    openclaw: { allow: ['*'] },
    hermes: {},
  },
} as const;

export interface LoadDaemonConfigOpts {
  /** Already-parsed CLI flags from commander (highest precedence). */
  server?: string;
  token?: string;
  deviceName?: string;
  dataDir?: string;
  maxConcurrentTasks?: number;
  config?: string;
  logLevel?: DaemonConfig['logLevel'];
  /** Test seam: swap `os.hostname()` so tests are deterministic. */
  _hostname?: () => string;
  /** Test seam: swap env source. */
  _env?: NodeJS.ProcessEnv;
}

export class DaemonConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonConfigError';
  }
}

export async function loadDaemonConfig(opts: LoadDaemonConfigOpts = {}): Promise<DaemonConfig> {
  const env = opts._env ?? process.env;
  const hostnameFn = opts._hostname ?? osHostname;

  // Paths
  const dataDir = opts.dataDir ?? env.AQUARIUM_DATA_DIR ?? join(homedir(), '.aquarium');
  const configPath = opts.config ?? join(dataDir, 'daemon.json');

  // Ensure dataDir exists (parent of config file).
  await fsp.mkdir(dataDir, { recursive: true });

  // Load file if present — enforce 0600 (T-21-02).
  let fileConfig: DaemonConfigFile = {};
  try {
    const st = await fsp.stat(configPath);
    // On POSIX the low bits reflect mode; on Windows the field is less meaningful.
    if (process.platform !== 'win32') {
      const worldOrGroupBits = st.mode & 0o077;
      if (worldOrGroupBits !== 0) {
        const modeStr = (st.mode & 0o777).toString(8);
        throw new DaemonConfigError(
          `${configPath} has mode ${modeStr}; fix with \`chmod 600 ${configPath}\` (T-21-02)`,
        );
      }
    }
    const body = await fsp.readFile(configPath, 'utf8');
    try {
      fileConfig = JSON.parse(body) as DaemonConfigFile;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new DaemonConfigError(`${configPath} is not valid JSON: ${err.message}`);
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof DaemonConfigError) throw err;
    if (isEnoent(err)) {
      // First-run UX — seed a starter file and exit with actionable error.
      const starter: DaemonConfigFile = { server: 'http://localhost:3001', token: '' };
      await fsp.writeFile(configPath, JSON.stringify(starter, null, 2) + '\n', { mode: 0o600 });
      if (process.platform !== 'win32') await fsp.chmod(configPath, 0o600);
      throw new DaemonConfigError(
        `Created ${configPath}. Mint a daemon token in the web UI (Daemon Tokens → Create), save it into this file under "token", then re-run.`,
      );
    }
    throw err;
  }

  // Merge precedence: flags > env > file > defaults.
  const server =
    opts.server ?? env.AQUARIUM_DAEMON_SERVER ?? fileConfig.server ?? DEFAULT_DAEMON_CONFIG.server;
  const token = opts.token ?? env.AQUARIUM_DAEMON_TOKEN ?? fileConfig.token ?? '';
  const deviceName =
    opts.deviceName ?? env.AQUARIUM_DAEMON_DEVICE_NAME ?? fileConfig.deviceName ?? hostnameFn();
  const rawMax =
    opts.maxConcurrentTasks ??
    parseIntOr(env.AQUARIUM_DAEMON_MAX_CONCURRENT_TASKS, undefined) ??
    fileConfig.maxConcurrentTasks ??
    DEFAULT_DAEMON_CONFIG.maxConcurrentTasks;
  const maxConcurrentTasks = clampInt(rawMax, 1, 64);
  const logLevel: DaemonConfig['logLevel'] =
    opts.logLevel ??
    (env.AQUARIUM_DAEMON_LOG_LEVEL as DaemonConfig['logLevel'] | undefined) ??
    fileConfig.logLevel ??
    DEFAULT_DAEMON_CONFIG.logLevel;

  if (!token || !token.startsWith('adt_')) {
    throw new DaemonConfigError(
      `no token — mint one in the web UI (Daemon Tokens → Create) and save to ${configPath}, or pass --token`,
    );
  }

  const claudeAllow =
    fileConfig.backends?.claude?.allow && fileConfig.backends.claude.allow.length > 0
      ? fileConfig.backends.claude.allow.slice()
      : DEFAULT_DAEMON_CONFIG.backends.claude.allow.slice();
  const codexAllow =
    fileConfig.backends?.codex?.allow && fileConfig.backends.codex.allow.length > 0
      ? fileConfig.backends.codex.allow.slice()
      : DEFAULT_DAEMON_CONFIG.backends.codex.allow.slice();
  const openclawAllow =
    fileConfig.backends?.openclaw?.allow && fileConfig.backends.openclaw.allow.length > 0
      ? fileConfig.backends.openclaw.allow.slice()
      : DEFAULT_DAEMON_CONFIG.backends.openclaw.allow.slice();

  return {
    server,
    token,
    deviceName,
    maxConcurrentTasks,
    pollIntervalMs: fileConfig.pollIntervalMs ?? DEFAULT_DAEMON_CONFIG.pollIntervalMs,
    heartbeatIntervalMs: fileConfig.heartbeatIntervalMs ?? DEFAULT_DAEMON_CONFIG.heartbeatIntervalMs,
    cancelPollIntervalMs: fileConfig.cancelPollIntervalMs ?? DEFAULT_DAEMON_CONFIG.cancelPollIntervalMs,
    messageFlushIntervalMs: fileConfig.messageFlushIntervalMs ?? DEFAULT_DAEMON_CONFIG.messageFlushIntervalMs,
    inactivityKillMs: fileConfig.inactivityKillMs ?? DEFAULT_DAEMON_CONFIG.inactivityKillMs,
    gracefulKillMs: fileConfig.gracefulKillMs ?? DEFAULT_DAEMON_CONFIG.gracefulKillMs,
    gracefulShutdownMs: fileConfig.gracefulShutdownMs ?? DEFAULT_DAEMON_CONFIG.gracefulShutdownMs,
    logLevel,
    dataDir,
    configPath,
    backends: {
      claude: { allow: claudeAllow },
      codex: { allow: codexAllow },
      opencode: {},
      openclaw: { allow: openclawAllow },
      hermes: {},
    },
  };
}

// ── helpers ──
function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(Math.max(i, min), max);
}

function parseIntOr(v: string | undefined, fallback: number | undefined): number | undefined {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
