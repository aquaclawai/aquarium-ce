/**
 * `opencode` CLI auto-detection (Plan 22-03, BACKEND-03 part 1).
 *
 * PATH probe + fallback paths. Unlike codex, there is no strict subcommand
 * probe: `opencode run --help` would succeed on any recent build, so the
 * version parse alone is sufficient to accept a binary. If an install ships
 * without `run --format json`, task execution fails loudly at spawn time —
 * the inactivity watchdog (BACKEND-06) catches any hang.
 *
 * OWNED pitfall mitigations:
 *   • PG2 — per-candidate try/catch; a single bad binary doesn't abort the
 *     search.
 *   • T-22-03 — resolves absolute path; `shell: false` at spawn (see
 *     opencode.ts).
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §OpenCode
 *   Backend + §Detect.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execa as realExeca } from 'execa';

export interface DetectOpencodeOpts {
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
  join(homedir(), '.opencode', 'bin', 'opencode'),
  '/opt/homebrew/bin/opencode',
  '/usr/local/bin/opencode',
];

const VERSION_TIMEOUT_MS = 5_000;

export async function detectOpencode(
  opts: DetectOpencodeOpts = {},
): Promise<{ path: string; version: string } | null> {
  const env = opts._env ?? process.env;
  const existsFn = opts._exists ?? existsSync;
  const whichFn = opts._which ?? ((name: string) => whichCrossPlatform(name, env, existsFn));
  const execaFn = opts._execa ?? realExeca;

  const onPath = await whichFn('opencode').catch(() => null);
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
