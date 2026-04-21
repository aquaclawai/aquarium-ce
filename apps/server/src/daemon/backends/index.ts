/**
 * Backend registry (Phase 22).
 *
 * The shape of `ALL_BACKENDS` locks in the detection order; same-wave
 * parallelism in later plans (22-02 codex, 22-03 opencode/openclaw, 22-04
 * hermes) appends to this list.
 *
 * `detectBackends()` is PG2-resilient: a single backend's `detect()`
 * throwing (sync or async) or hanging must NOT block the others. Each probe
 * is wrapped in try/catch. The returned array preserves the input order for
 * deterministic operator log output (22-04's main.ts boot banner relies on
 * it).
 */

import type { Backend } from '../backend.js';
import { claudeBackend } from './claude.js';
import { codexBackend } from './codex.js';
import { opencodeBackend } from './opencode.js';
import { openclawBackend } from './openclaw.js';
import { hermesBackend } from './hermes.js';

export const ALL_BACKENDS: Backend[] = [
  claudeBackend,
  codexBackend,
  opencodeBackend,
  openclawBackend,
  hermesBackend,
];

export async function detectBackends(
  backends: Backend[] = ALL_BACKENDS,
): Promise<Array<{ backend: Backend; path: string; version: string }>> {
  const results: Array<{ backend: Backend; path: string; version: string }> = [];
  for (const backend of backends) {
    try {
      const found = await backend.detect();
      if (found) {
        results.push({ backend, path: found.path, version: found.version });
      }
    } catch {
      // PG2 — per-backend isolation. A single bad binary cannot block
      // detection of the other backends. Log-level decision deferred to
      // 22-04 where main.ts consumes this result.
    }
  }
  return results;
}
