/**
 * `claude` CLI auto-detection (Plan 21-02, CLI-01 / BACKEND-01).
 *
 * Resolves a `claude` executable by probing PATH first, then a small list of
 * known fallback install locations. Parses `--version` with a 5-second cap so
 * a hung binary can't block daemon startup. All failure paths return `null`
 * — this function NEVER throws (PG2 contract).
 *
 * OWNED pitfall mitigations:
 *   • T-21-03 — resolves absolute path; Plan 21-03's `main.ts` logs the
 *     resolved path at startup for operator visibility. execa spawn in 21-03
 *     uses `shell: false` so arg injection is impossible.
 *   • PG2 — per-candidate try/catch; a single bad binary doesn't abort the
 *     search.
 *
 * Platform notes:
 *   • macOS/Linux: PATH resolution via iterating `:`-delimited entries.
 *   • Windows: PATHEXT extension matching (.EXE/.CMD/.BAT); `.cmd` shims work
 *     natively under execa@9.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execa as realExeca } from 'execa';

export interface DetectClaudeOpts {
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
  join(homedir(), '.claude', 'local', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  'C:\\Program Files\\Claude\\claude.exe',
];

const VERSION_TIMEOUT_MS = 5_000;

export async function detectClaude(
  opts: DetectClaudeOpts = {},
): Promise<{ path: string; version: string } | null> {
  const env = opts._env ?? process.env;
  const existsFn = opts._exists ?? existsSync;
  const whichFn = opts._which ?? ((name: string) => whichCrossPlatform(name, env, existsFn));
  const execaFn = opts._execa ?? realExeca;

  const onPath = await whichFn('claude').catch(() => null);
  const candidates = onPath ? [onPath, ...FALLBACK_PATHS] : [...FALLBACK_PATHS];

  for (const p of candidates) {
    if (!existsFn(p)) continue;
    try {
      const result = await execaFn(p, ['--version'], { timeout: VERSION_TIMEOUT_MS });
      const stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
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
