/**
 * OpenCode agent backend (Phase 22 Plan 03 — BACKEND-03 part 1).
 *
 * Wire protocol: NDJSON via `opencode run --format json`. One-shot invocation
 * per task — NO ACP session handshake (research §Don't Hand-Roll). Session
 * persistence is deferred to v1.5 (SESS-01); every task creates a fresh
 * opencode session, so argv NEVER carries `-s` / `-c` / `--share`
 * (T-22-11 mitigation).
 *
 * Stream shape (5 event kinds, VERIFIED live on research machine — A2):
 *   • `step_start` / `step_finish` → bookkeeping, ignored (exit code is
 *     authoritative for turn completion).
 *   • `text` → `AgentMessage{kind:'text', text:part.text}`.
 *   • `tool_use` → TWO messages: `tool_use` + `tool_result` (OpenCode merges
 *     call + result into one event; `toolUseId = part.callID`;
 *     `isError = part.state.status !== 'completed'`). Non-string
 *     `state.output` is `JSON.stringify`'d for stable serialisation.
 *   • `error` → `AgentMessage{kind:'error', error:ev.error.data.message}`.
 *   • Unknown `type` → `[]` (safe default per PG10 + T-22-12).
 *
 * OWNED pitfall + threat mitigations:
 *   • PG7/PG8/PG9/PG10 via `parseNdjson` (readline + per-line try/catch).
 *   • PM1 HARD — `shell: false` + `detached` (POSIX only) + execa
 *     `forceKillAfterDelay: gracefulKillMs` (SIGTERM → SIGKILL).
 *   • PM3 / BACKEND-05 — PATH prepended via `buildChildEnv`.
 *   • PM4 — stdin `.end()` called immediately (OpenCode reads prompt from
 *     argv; keeping stdin open stalls the child).
 *   • PM7 / T-22-10 — `buildChildEnv` deletes `AQUARIUM_DAEMON_TOKEN` +
 *     `AQUARIUM_TOKEN` after merging customEnv.
 *   • T-22-11 — argv never contains `-s` / `-c` / `--share`; every task
 *     creates a fresh session so prior context cannot leak.
 *   • T-22-12 — malformed stream frames are dropped by `parseNdjson`
 *     (per-line try/catch); unrecognised `type` values map to `[]`.
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md
 *     §OpenCode Backend (event table, implementation skeleton),
 *     §Don't Hand-Roll (ACP avoidance), §Assumptions Log A2.
 */

import type { Readable } from 'node:stream';
import { execa, type ResultPromise, type Subprocess } from 'execa';
import { parseNdjson } from '../ndjson-parser.js';
import { buildChildEnv } from './env.js';
import { detectOpencode } from './detect-opencode.js';
import type { Backend, BackendRunDeps, BackendRunResult } from '../backend.js';
import type { AgentMessage, ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from '../http-client.js';

// ── Event type surface ────────────────────────────────────────────────────

interface OpencodeTextPart {
  id: string;
  type: 'text';
  text: string;
  time?: { start: number; end: number };
}

interface OpencodeToolState {
  status: string;
  input: unknown;
  output: unknown;
  title?: string;
  metadata?: unknown;
  time?: unknown;
}

interface OpencodeToolPart {
  callID: string;
  tool: string;
  state: OpencodeToolState;
}

interface OpencodeEventBase {
  type: string;
  timestamp: number;
  sessionID: string;
}

export type OpencodeEvent =
  | (OpencodeEventBase & { type: 'text'; part: OpencodeTextPart })
  | (OpencodeEventBase & { type: 'tool_use'; part: OpencodeToolPart })
  | (OpencodeEventBase & { type: 'step_start' | 'step_finish'; part?: unknown })
  | (OpencodeEventBase & {
      type: 'error';
      error: { name?: string; data?: { message?: string } };
    });

// ── Pure mapper ───────────────────────────────────────────────────────────

/**
 * Map a single OpenCode event to zero or more `AgentMessage` values. Pure
 * function — easy to unit-test. Returns `[]` for bookkeeping events
 * (`step_start`, `step_finish`) and any unrecognised `type` (PG10 / T-22-12).
 */
export function mapOpencodeEventToAgentMessage(
  ev: OpencodeEvent | Record<string, unknown>,
): AgentMessage[] {
  if (!ev || typeof ev !== 'object') return [];
  const type = (ev as { type?: unknown }).type;

  if (type === 'text') {
    const part = (ev as { part?: { text?: unknown } }).part;
    const text = part?.text;
    return typeof text === 'string' ? [{ kind: 'text', text }] : [];
  }

  if (type === 'tool_use') {
    const part = (ev as { part?: OpencodeToolPart }).part;
    if (!part || typeof part.callID !== 'string') return [];
    const output = part.state?.output;
    const content =
      typeof output === 'string' ? output : JSON.stringify(output ?? '');
    const status = part.state?.status;
    return [
      {
        kind: 'tool_use',
        toolUseId: part.callID,
        toolName: typeof part.tool === 'string' ? part.tool : 'unknown',
        input: part.state?.input,
      },
      {
        kind: 'tool_result',
        toolUseId: part.callID,
        content,
        isError: status !== 'completed',
      },
    ];
  }

  if (type === 'error') {
    const err = (ev as { error?: { data?: { message?: unknown } } }).error;
    const msg =
      typeof err?.data?.message === 'string' ? err.data.message : 'opencode error';
    return [{ kind: 'error', error: msg }];
  }

  // step_start, step_finish, unknown → ignore.
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

export interface SpawnOpenCodeOpts {
  binaryPath: string;
  workDir: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  prompt: string;
  abortSignal: AbortSignal;
  gracefulKillMs: number;
  /** Test seam — replace `execa`. */
  _execa?: typeof execa;
}

/**
 * Spawn `opencode run --format json [--dir <workDir>] <prompt>`.
 *   PM1 — `shell: false` + `detached` (POSIX only) + `forceKillAfterDelay`.
 *   PM3 — PATH prepended with daemon binary dir (via buildChildEnv).
 *   PM7 — AQUARIUM_TOKEN + AQUARIUM_DAEMON_TOKEN deleted from env.
 *   T-22-11 — argv never contains `-s` / `-c` / `--share`.
 */
export function spawnOpenCode(opts: SpawnOpenCodeOpts): Subprocess {
  const spawnFn = opts._execa ?? execa;
  const env = buildChildEnv({ customEnv: opts.customEnv });

  const args: string[] = ['run', '--format', 'json'];
  if (opts.workDir) args.push('--dir', opts.workDir);
  // customArgs intentionally appended BEFORE the prompt — operators can pass
  // `--model`, `--agent`, `--thinking`, etc. — but daemon-owned flags
  // (`--format json`, `--dir`) take precedence because they appear first.
  args.push(...opts.customArgs);
  args.push(opts.prompt);

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

// ── Top-level orchestrator: run one opencode task end-to-end ──

export async function runOpenCodeTask(
  deps: BackendRunDeps,
): Promise<BackendRunResult> {
  const spawn = (deps._spawn as typeof spawnOpenCode | undefined) ?? spawnOpenCode;
  const prompt = buildPrompt(deps.task);
  const child = spawn({
    binaryPath: deps.binaryPath,
    workDir: deps.task.workDir,
    customEnv: deps.task.agent.customEnv ?? {},
    customArgs: deps.task.agent.customArgs ?? [],
    prompt,
    abortSignal: deps.abortSignal,
    gracefulKillMs: deps.config.gracefulKillMs,
  });

  // PM4 — OpenCode reads prompt from argv, not stdin. Close stdin immediately
  // so the child isn't blocked waiting for stdin EOF.
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
      for await (const raw of parseNdjson<OpencodeEvent>(stdout, {
        inactivityMs: deps.config.inactivityKillMs,
      })) {
        if (deps.abortSignal.aborted) break;
        const msgs = mapOpencodeEventToAgentMessage(raw);
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

export const opencodeBackend: Backend = {
  provider: 'opencode',
  detect: detectOpencode,
  run: runOpenCodeTask,
};
