/**
 * `hermes` CLI auto-detection (Plan 22-04, BACKEND-03 part 3 — A10).
 *
 * Mirrors `detect-opencode.ts` — PATH probe + fallbacks, no strict subcommand
 * probe. Even when detection succeeds, `runHermesStub` DOES NOT spawn hermes;
 * we still detect so operators can see the binary in `/api/runtimes` and
 * understand WHY the provider is present but non-functional (Phase 22 Plan 04
 * ships hermes as a detect-and-error-on-run stub — see hermes.ts header).
 *
 * OWNED pitfall mitigations:
 *   • PG2 — per-candidate try/catch; bad binaries don't abort the search.
 *   • T-22-03 carry-forward — absolute path resolution (even though no spawn
 *     happens; keeps the startup audit log honest).
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §Hermes
 *   Backend + §Assumptions Log A10.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execa as realExeca } from 'execa';

export interface DetectHermesOpts {
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
  join(homedir(), '.hermes', 'bin', 'hermes'),
  '/opt/homebrew/bin/hermes',
  '/usr/local/bin/hermes',
];

const VERSION_TIMEOUT_MS = 5_000;

export async function detectHermes(
  opts: DetectHermesOpts = {},
): Promise<{ path: string; version: string } | null> {
  const env = opts._env ?? process.env;
  const existsFn = opts._exists ?? existsSync;
  const whichFn = opts._which ?? ((name: string) => whichCrossPlatform(name, env, existsFn));
  const execaFn = opts._execa ?? realExeca;

  const onPath = await whichFn('hermes').catch(() => null);
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
