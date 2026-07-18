/**
 * OpenClaw agent backend (Phase 22 Plan 03 — BACKEND-03 part 2).
 *
 * ASSUMPTION A3 — OpenClaw's `agent --json` NDJSON shape is assumed to match
 * Shape A (OpenCode-like): `{type: 'text'|'tool_use'|'tool_result'|'error'|
 * 'done', ...}`. OpenClaw was NOT installed on the execution machine when
 * Plan 22-03 landed; the Plan 22-01 placeholder fixture drives the unit
 * suite. If a future live capture reveals Shape B, update the mapper below
 * AND `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson`
 * together. The `Backend` interface stays unchanged — the wire shape is
 * internal to this file.
 *
 * Wire protocol: NDJSON via `openclaw agent -m <prompt> --json [--agent
 * <agentId> | --session-id <sessionId>]`. One-shot invocation per task,
 * same spawn model as OpenCode. Session argument resolution:
 *   • `task.sessionId` set (forward-compat for SESS-01) → `--session-id <id>`.
 *   • Otherwise → `--agent <agent.id>` so openclaw scopes to a per-agent
 *     session.
 *
 * OWNED pitfall + threat mitigations:
 *   • PG7/PG8/PG9/PG10 via `parseNdjson` (readline + per-line try/catch).
 *   • PM1 HARD — `shell: false` + `detached` (POSIX only) + execa
 *     `forceKillAfterDelay: gracefulKillMs` (SIGTERM → SIGKILL).
 *   • PM3 / BACKEND-05 — PATH prepended via `buildChildEnv`.
 *   • PM4 — stdin `.end()` called immediately; prompt is on argv.
 *   • PM7 / T-22-10 — `buildChildEnv` deletes `AQUARIUM_DAEMON_TOKEN` +
 *     `AQUARIUM_TOKEN` after merging customEnv.
 *   • T-22-12 — malformed stream frames dropped by `parseNdjson`;
 *     unrecognised `type` maps to `[]`.
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md §OpenClaw
 *   Backend (Shape A vs B), §Assumptions Log A3, §Per-Backend Stub Strategy.
 */

import type { Readable } from 'node:stream';
import { execa, type ResultPromise, type Subprocess } from 'execa';
import { parseNdjson } from '../ndjson-parser.js';
import { buildChildEnv } from './env.js';
import { detectOpenclaw } from './detect-openclaw.js';
import type { Backend, BackendRunDeps, BackendRunResult } from '../backend.js';
import type { AgentMessage, ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from '../http-client.js';

// ── Event type surface (Shape A — assumed) ────────────────────────────────

interface OpenclawEventBase {
  type: string;
  sessionId?: string;
}

export type OpenclawEvent =
  | (OpenclawEventBase & { type: 'text'; text: string })
  | (OpenclawEventBase & {
      type: 'tool_use';
      toolUseId: string;
      tool: string;
      input: unknown;
    })
  | (OpenclawEventBase & {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError?: boolean;
    })
  | (OpenclawEventBase & {
      type: 'error';
      error: string | { message?: string };
    })
  | (OpenclawEventBase & { type: 'done'; reason?: string });

// ── Pure mapper ───────────────────────────────────────────────────────────

/**
 * Map a single OpenClaw event to zero or more `AgentMessage` values. Pure
 * function. Returns `[]` for `done` (bookkeeping) and unrecognised `type`
 * (PG10 / T-22-12 safe default).
 *
 * ASSUMPTION A3 — Shape A. If a live capture reveals Shape B, this is the
 * single update point together with the fixture.
 */
export function mapOpenclawEventToAgentMessage(
  ev: OpenclawEvent | Record<string, unknown>,
): AgentMessage[] {
  if (!ev || typeof ev !== 'object') return [];
  const type = (ev as { type?: unknown }).type;

  if (type === 'text') {
    const text = (ev as { text?: unknown }).text;
    return typeof text === 'string' ? [{ kind: 'text', text }] : [];
  }

  if (type === 'tool_use') {
    const e = ev as {
      toolUseId?: unknown;
      tool?: unknown;
      input?: unknown;
    };
    if (typeof e.toolUseId !== 'string') return [];
    return [
      {
        kind: 'tool_use',
        toolUseId: e.toolUseId,
        toolName: typeof e.tool === 'string' ? e.tool : 'unknown',
        input: e.input,
      },
    ];
  }

  if (type === 'tool_result') {
    const e = ev as {
      toolUseId?: unknown;
      content?: unknown;
      isError?: unknown;
    };
    if (typeof e.toolUseId !== 'string') return [];
    const content =
      typeof e.content === 'string' ? e.content : JSON.stringify(e.content ?? '');
    return [
      {
        kind: 'tool_result',
        toolUseId: e.toolUseId,
        content,
        isError: Boolean(e.isError),
      },
    ];
  }

  if (type === 'error') {
    const err = (ev as { error?: unknown }).error;
    let msg: string;
    if (typeof err === 'string') {
      msg = err;
    } else if (
      err &&
      typeof err === 'object' &&
      typeof (err as { message?: unknown }).message === 'string'
    ) {
      msg = (err as { message: string }).message;
    } else {
      msg = 'openclaw error';
    }
    return [{ kind: 'error', error: msg }];
  }

  // done, unknown → ignore.
  return [];
}

// ── PendingTaskMessageWire adapter ────────────────────────────────────────

function toPendingTaskMessage(
  am: AgentMessage,
  ctx: { workspaceId: string; issueId: string },
): PendingTaskMessageWire {
  switch (am.kind) {
    case 'text':
      return {
        type: 'text',
        content: am.text,
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'thinking':
      return {
        type: 'thinking',
        content: am.thinking,
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        tool: am.toolName,
        input: am.input,
        metadata: { toolUseId: am.toolUseId },
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        output: am.content,
        metadata: { toolUseId: am.toolUseId, isError: am.isError },
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'error':
      return {
        type: 'error',
        content: am.error,
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
  }
}

// ── spawn ─────────────────────────────────────────────────────────────────

export interface SpawnOpenclawOpts {
  binaryPath: string;
  workDir: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  prompt: string;
  /** Agent ID — used as session discriminator via `--agent <id>` when no sessionId. */
  agentId: string;
  /** Forward-compat for SESS-01 — if set, passes `--session-id <id>` and omits `--agent`. */
  sessionId: string | null;
  abortSignal: AbortSignal;
  gracefulKillMs: number;
  /** Test seam — replace `execa`. */
  _execa?: typeof execa;
}

/**
 * Spawn `openclaw agent -m <prompt> --json [--agent <id> | --session-id <id>]`.
 *   PM1 — `shell: false` + `detached` (POSIX only) + `forceKillAfterDelay`.
 *   PM3 — PATH prepended with daemon binary dir (via buildChildEnv).
 *   PM7 — AQUARIUM_TOKEN + AQUARIUM_DAEMON_TOKEN deleted from env.
 */
export function spawnOpenclaw(opts: SpawnOpenclawOpts): Subprocess {
  const spawnFn = opts._execa ?? execa;
  const env = buildChildEnv({ customEnv: opts.customEnv });

  const args: string[] = ['agent', '-m', opts.prompt, '--json'];
  if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  } else {
    args.push('--agent', opts.agentId);
  }
  // Operator-provided flags appended last (e.g. `--local`, `--timeout`). They
  // can override nothing daemon-owned because the daemon-owned flags are
  // already in place.
  args.push(...opts.customArgs);

  return spawnFn(
    opts.binaryPath,
    args,
    {
      cwd: opts.workDir ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,                                 // PM1 HARD
      detached: process.platform !== 'win32',       // PM1 process-group kill
      cancelSignal: opts.abortSignal,               // execa 9 native
      forceKillAfterDelay: opts.gracefulKillMs,     // SIGTERM → SIGKILL
    },
  ) as unknown as Subprocess;
}

// ── Top-level orchestrator: run one openclaw task end-to-end ──

export async function runOpenclawTask(
  deps: BackendRunDeps,
): Promise<BackendRunResult> {
  const spawn = (deps._spawn as typeof spawnOpenclaw | undefined) ?? spawnOpenclaw;
  const prompt = buildPrompt(deps.task);
  const child = spawn({
    binaryPath: deps.binaryPath,
    workDir: deps.task.workDir,
    customEnv: deps.task.agent.customEnv ?? {},
    customArgs: deps.task.agent.customArgs ?? [],
    prompt,
    agentId: deps.task.agent.id,
    sessionId: deps.task.sessionId,
    abortSignal: deps.abortSignal,
    gracefulKillMs: deps.config.gracefulKillMs,
  });

  // PM4 — prompt is on argv, close stdin immediately so the child isn't
  // pinned waiting for stdin EOF.
  try {
    child.stdin?.end();
  } catch {
    /* already closed — ignore */
  }

  const issueCtx = {
    workspaceId: deps.task.workspaceId,
    issueId: deps.task.issue.id,
  };

  const stdout = child.stdout as Readable | null;
  if (stdout) {
    try {
      for await (const raw of parseNdjson<OpenclawEvent>(stdout, {
        inactivityMs: deps.config.inactivityKillMs,
      })) {
        if (deps.abortSignal.aborted) break;
        const msgs = mapOpenclawEventToAgentMessage(raw);
        for (const am of msgs) {
          deps.onAgentMessage(toPendingTaskMessage(am, issueCtx));
        }
      }
    } catch {
      // NDJSON iterator closed non-cleanly — child exit below is authoritative.
    }
  }

  try {
    const result = (await (child as unknown as ResultPromise)) as {
      exitCode?: number;
      isCanceled?: boolean;
    };
    return {
      exitCode: result.exitCode ?? 0,
      cancelled: Boolean(result.isCanceled),
    };
  } catch (err) {
    const e = err as { exitCode?: number; isCanceled?: boolean };
    return {
      exitCode: e.exitCode ?? 1,
      cancelled: Boolean(e.isCanceled),
    };
  }
}

function buildPrompt(task: ClaimedTask): string {
  const pieces = [
    task.agent.instructions.trim(),
    '',
    `Issue #${task.issue.issueNumber}: ${task.issue.title}`,
  ];
  if (task.issue.description) pieces.push('', task.issue.description);
  if (task.triggerCommentContent) {
    pieces.push('', 'Reply context:', task.triggerCommentContent);
  }
  return pieces.join('\n').trim();
}

// ── Backend export ────────────────────────────────────────────────────────

export const openclawBackend: Backend = {
  provider: 'openclaw',
  detect: detectOpenclaw,
  run: runOpenclawTask,
};
