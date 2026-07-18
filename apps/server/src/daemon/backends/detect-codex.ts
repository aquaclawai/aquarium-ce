/**
 * `codex` CLI auto-detection (Plan 22-02, BACKEND-02).
 *
 * Rejects codex installations that do NOT support the `app-server --listen stdio://`
 * subcommand — older codex builds exit immediately with an unknown-subcommand error
 * when the daemon tries to spawn them, leaving the task hung on the inactivity watchdog.
 * We probe `codex app-server --help` at detect time so the runtime never registers
 * a codex binary that would fail at first task.
 *
 * OWNED pitfall mitigations:
 *   • PG2 — per-candidate try/catch; a single bad binary doesn't abort the search.
 *   • T-22-03 — resolves absolute path; `shell: false` at spawn (see codex.ts).
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §Codex Backend
 *   + §Codex fallback behaviour.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execa as realExeca } from 'execa';

export interface DetectCodexOpts {
  /** Test seam: override PATH resolver. */
  _which?: (name: string) => Promise<string | null>;
  /** Test seam: override fs.existsSync. */
  _exists?: (path: string) => boolean;
  /** Test seam: override execa. */
  _execa?: typeof realExeca;
  /** Override env. */
  _env?: NodeJS.ProcessEnv;
}

const FALLBACK_PATHS = [
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  join(homedir(), '.codex', 'bin', 'codex'),
  'C:\\Program Files\\codex\\codex.exe',
];

const VERSION_TIMEOUT_MS = 5_000;
const HELP_TIMEOUT_MS = 5_000;

export async function detectCodex(
  opts: DetectCodexOpts = {},
): Promise<{ path: string; version: string } | null> {
  const env = opts._env ?? process.env;
  const existsFn = opts._exists ?? existsSync;
  const whichFn = opts._which ?? ((name: string) => whichCrossPlatform(name, env, existsFn));
  const execaFn = opts._execa ?? realExeca;

  const onPath = await whichFn('codex').catch(() => null);
  const candidates = onPath ? [onPath, ...FALLBACK_PATHS] : [...FALLBACK_PATHS];

  for (const p of candidates) {
    if (!existsFn(p)) continue;
    try {
      const vRes = await execaFn(p, ['--version'], { timeout: VERSION_TIMEOUT_MS });
      const vOut = typeof vRes.stdout === 'string' ? vRes.stdout : String(vRes.stdout ?? '');
      const match = /(\d+\.\d+\.\d+)/.exec(vOut);
      if (!match) continue;
      // Strict check — reject codex binaries that lack the app-server subcommand.
      const helpRes = await execaFn(p, ['app-server', '--help'], {
        timeout: HELP_TIMEOUT_MS,
        reject: false,
      });
      const helpOut = typeof helpRes.stdout === 'string' ? helpRes.stdout : String(helpRes.stdout ?? '');
      const helpErr = typeof helpRes.stderr === 'string' ? helpRes.stderr : String(helpRes.stderr ?? '');
      const helpText = helpOut + helpErr;
      if (!/experimental.*app server|--listen/i.test(helpText)) continue;
      return { path: p, version: match[1]! };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function whichCrossPlatform(
  name: string,
  env: NodeJS.ProcessEnv,
  existsFn: (p: string) => boolean,
): Promise<string | null> {
  const pathEnv = env.PATH ?? env.Path ?? '';
  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsFn(candidate)) return candidate;
    }
  }
  return null;
}
