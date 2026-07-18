/**
 * Phase 22 backend interface — extracted from Phase 21's implicit claude shape.
 *
 * Every daemon backend (claude/codex/openclaw/opencode/hermes) implements this
 * contract. `main.ts` dispatches via a `Map<runtimeId, Backend>` built at
 * register time (see Plan 22-04 for the dispatch rewrite).
 *
 * `BackendRunDeps` intentionally includes `_execa` and `_spawn` as `unknown`
 * test seams — they are typed precisely per-backend to avoid coupling this
 * module to execa or per-backend spawn helpers.
 *
 * OWNED pitfall + threat anchors:
 *   • T-22-01 — `run()` implementations build their child env via
 *     `buildChildEnv()` from `./backends/env.js` so AQUARIUM_*TOKEN never
 *     crosses the daemon → child boundary.
 *   • PM1 — backends spawn with `shell: false` + execa `forceKillAfterDelay`
 *     driven by `deps.config.gracefulKillMs`.
 *   • BACKEND-06 — `deps.config.inactivityKillMs` feeds the NDJSON watchdog.
 */

import type { ClaimedTask, RuntimeProvider } from '@aquarium/shared';
import type { PendingTaskMessageWire } from './http-client.js';

export interface BackendRunDeps {
  task: ClaimedTask;
  /** Absolute path resolved by `detect()`. */
  binaryPath: string;
  config: {
    /** Per-backend allow-list (claude.allow, codex.allow, openclaw.allow …). */
    backend: { allow?: string[] };
    /** PM1 SIGTERM→SIGKILL window (from DaemonConfig). */
    gracefulKillMs: number;
    /** BACKEND-06 watchdog window (60 s default). */
    inactivityKillMs: number;
  };
  onAgentMessage: (pending: PendingTaskMessageWire) => void;
  abortSignal: AbortSignal;
  /** Test seam — replaces execa (used by codex/opencode/openclaw tests). */
  _execa?: unknown;
  /** Test seam — replaces the backend's spawn helper (used by claude). */
  _spawn?: unknown;
}

export interface BackendRunResult {
  exitCode: number;
  cancelled: boolean;
}

export interface Backend {
  /** `'hosted'` is reserved for Aquarium-native Docker instances — never a daemon backend. */
  readonly provider: Exclude<RuntimeProvider, 'hosted'>;
  detect(): Promise<{ path: string; version: string } | null>;
  run(deps: BackendRunDeps): Promise<BackendRunResult>;
}
