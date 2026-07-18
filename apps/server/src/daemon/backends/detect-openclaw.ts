/**
 * `openclaw` CLI auto-detection (Plan 22-03, BACKEND-03 part 2).
 *
 * PATH probe + fallback paths. Version parse via `openclaw --version`. No
 * strict subcommand probe (docs imply `agent` is the stable entry point).
 *
 * OWNED pitfall mitigations:
 *   • PG2 — per-candidate try/catch; a single bad binary doesn't abort the
 *     search.
 *   • T-22-03 — resolves absolute path; `shell: false` at spawn (see
 *     openclaw.ts).
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §OpenClaw
 *   Backend + §Assumptions Log A3.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execa as realExeca } from 'execa';

export interface DetectOpenclawOpts {
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
  '/opt/homebrew/bin/openclaw',
  '/usr/local/bin/openclaw',
  join(homedir(), '.openclaw', 'bin', 'openclaw'),
];

const VERSION_TIMEOUT_MS = 5_000;

export async function detectOpenclaw(
  opts: DetectOpenclawOpts = {},
): Promise<{ path: string; version: string } | null> {
  const env = opts._env ?? process.env;
  const existsFn = opts._exists ?? existsSync;
  const whichFn = opts._which ?? ((name: string) => whichCrossPlatform(name, env, existsFn));
  const execaFn = opts._execa ?? realExeca;

  const onPath = await whichFn('openclaw').catch(() => null);
  const candidates = onPath ? [onPath, ...FALLBACK_PATHS] : [...FALLBACK_PATHS];

  for (const p of candidates) {
    if (!existsFn(p)) continue;
    try {
      const r = await execaFn(p, ['--version'], { timeout: VERSION_TIMEOUT_MS });
      const stdout = typeof r.stdout === 'string' ? r.stdout : String(r.stdout ?? '');
      const match = /(\d+\.\d+\.\d+)/.exec(stdout);
      return { path: p, version: match ? match[1]! : 'unknown' };
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
