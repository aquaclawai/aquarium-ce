/**
 * Shared child-env builder for ALL daemon backends (Phase 22).
 *
 * OWNED pitfall + threat anchors:
 *   • T-22-01 / PM7 HARD — `delete env.AQUARIUM_DAEMON_TOKEN` +
 *     `delete env.AQUARIUM_TOKEN` AFTER merging customEnv. Guarantees no
 *     spawn site in `apps/server/src/daemon/` can leak the daemon token
 *     into a child process, no matter what customEnv contains or what
 *     process.env carries. Defence-in-depth — `sanitizeCustomEnv` also
 *     strips the `AQUARIUM_` prefix from customEnv before merge.
 *   • PM3 / BACKEND-05 — `path.dirname(process.execPath)` is prepended to
 *     PATH so child agents resolving `aquarium` find the daemon's own CLI.
 *
 * Single source of truth: `sanitizeCustomEnv` was hoisted out of
 * `backends/claude.ts` into this module; `claude.ts` re-exports it for
 * back-compat with the 16-test `claude-control-request.test.ts` suite.
 */

import path from 'node:path';

/** Strip PATH / AQUARIUM_* from agent custom_env before merging into child env. */
export function sanitizeCustomEnv(
  customEnv: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(customEnv)) {
    if (k === 'PATH' || k === 'Path') continue;
    if (k.startsWith('AQUARIUM_')) continue;
    out[k] = v;
  }
  return out;
}

export function buildChildEnv(deps: {
  customEnv: Record<string, string>;
}): Record<string, string | undefined> {
  const daemonBinDir = path.dirname(process.execPath);
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: daemonBinDir + path.delimiter + (process.env.PATH ?? ''),
    ...sanitizeCustomEnv(deps.customEnv),
  };
  // PM7 HARD — token must NEVER leak into child env, regardless of customEnv
  // or process.env contents.
  delete env.AQUARIUM_DAEMON_TOKEN;
  delete env.AQUARIUM_TOKEN;
  return env;
}
