/**
 * Hermes stub backend (Phase 22 Plan 04 — BACKEND-03 part 3).
 *
 * Hermes (Nous Research) is TUI-first in April 2026 — no documented
 * headless JSON / ACP mode.
 * [CITED: hermes-agent.nousresearch.com/docs/user-guide/cli,
 *  github.com/NousResearch/hermes-agent/issues/569]
 *
 * This backend:
 *   1. Detects hermes on PATH so operators see it in /api/runtimes (UX clarity).
 *   2. On first task execution, emits ONE AgentMessage{kind:'error'} with an
 *      actionable message pointing users at a working provider OR the upstream
 *      issue tracker. Task transitions to `failed` with the error captured.
 *
 * The error message is a HARD-CODED TEMPLATE — NO interpolation of task /
 * agent data per T-22-14 (log-forging mitigation). The only runtime
 * substitutions are the task's workspaceId and issueId, which are propagated
 * via the AgentMessage envelope metadata (NOT into the message body).
 *
 * Swap this file for a real ACP client (~80 LOC) when upstream Issue #569
 * ships.
 *
 * OWNED pitfall + threat mitigations:
 *   • T-22-14 — error text is a hard-coded template literal; NO interpolation
 *     of runtime data into the message body. The grep assertion verifies this
 *     file contains no interpolation sigils for any of the runtime-bound
 *     identifiers (see plan 22-04 acceptance criteria).
 *   • PM1 / BACKEND-04 — no subprocess launch path, therefore nothing to kill;
 *     the abortSignal short-circuit returns `{cancelled:true}` before emitting
 *     so downstream cancel semantics stay uniform.
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §Hermes
 *   Backend, §Assumptions Log A4 + A10.
 */

import { detectHermes } from './detect-hermes.js';
import type { Backend, BackendRunDeps, BackendRunResult } from '../backend.js';

const HERMES_UNSUPPORTED_MESSAGE =
  'Hermes headless mode is not supported in Aquarium v1.4. ' +
  'Nous Research has not shipped a JSON / JSON-RPC / ACP mode for hermes yet ' +
  '(tracked at github.com/NousResearch/hermes-agent/issues/569). ' +
  'Please re-register this runtime under a different provider ' +
  '(claude / codex / opencode / openclaw), or upgrade Aquarium when hermes ACP support lands.';

export async function runHermesStub(deps: BackendRunDeps): Promise<BackendRunResult> {
  // Pre-abort short-circuit — if cancel lands before we get a chance to emit,
  // stay silent and report cancelled so main.ts's `failTask('cancelled')` path
  // fires (matches every other backend's post-abort behaviour).
  if (deps.abortSignal.aborted) {
    return { exitCode: 1, cancelled: true };
  }

  deps.onAgentMessage({
    type: 'error',
    content: HERMES_UNSUPPORTED_MESSAGE,
    workspaceId: deps.task.workspaceId,
    issueId: deps.task.issue.id,
    metadata: { hermesStub: true },
  });

  return { exitCode: 1, cancelled: false };
}

export const hermesBackend: Backend = {
  provider: 'hermes',
  detect: detectHermes,
  run: runHermesStub,
};
