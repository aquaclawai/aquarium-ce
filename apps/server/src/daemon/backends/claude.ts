/**
 * Claude Code agent backend (Phase 21 Plan 03 — BACKEND-01).
 *
 * Spawns the resolved `claude` CLI with stream-json IO and stdio permission
 * handshake, translates its `stream-json` line frames into the daemon's
 * `AgentMessage` union, and handles `control_request` frames with the
 * auto-approval allow-list policy.
 *
 * OWNED pitfall + threat mitigations:
 *   • PM1 HARD — `shell: false` + `detached: process.platform !== 'win32'`
 *     (POSIX process-group leader so SIGTERM reaches the whole tree) +
 *     `forceKillAfterDelay: gracefulKillMs` (execa-native SIGTERM→SIGKILL).
 *   • PM3 / BACKEND-05 — `env.PATH` prepended with `path.dirname(process.execPath)`
 *     so the child `aquarium` CLI is resolvable from claude MCP hooks.
 *   • PM4 — write EXACTLY ONE `{type:'user', message:{...}}` JSON line to
 *     stdin then call `.end()`. Claude parses stream-json framed by newlines.
 *   • PM7 — `sanitizeCustomEnv` strips PATH + AQUARIUM_* from `agent.customEnv`,
 *     AND the assembled `env` explicitly `delete env.AQUARIUM_TOKEN` +
 *     `delete env.AQUARIUM_DAEMON_TOKEN` — token NEVER reaches the child.
 *   • T-21-03 — `claudePath` is resolved upstream by `detectClaude` to an
 *     absolute path, logged by `main.startDaemon` at boot.
 *   • T-21-04 — `buildControlResponse` honours allow-list; every decision
 *     emits an audit `thinking` `PendingTaskMessageWire` so the issue timeline
 *     shows `[auto-approve] tool=X` or `[deny] tool=Y`.
 *   • T-21-05 (mitigation) — execa `forceKillAfterDelay` + detached POSIX
 *     ensures no zombie child outlives the task cancel.
 *
 * Research references:
 *   .planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-RESEARCH.md
 *     §Claude Code Backend, §Claude Control Protocol, §NDJSON Stream-JSON
 *     Parser, §Common Pitfalls PM1/PM3/PM4/PM7.
 */

import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { execa, type ResultPromise, type Subprocess } from 'execa';
import { parseNdjson } from '../ndjson-parser.js';
import type { AgentMessage, ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from '../http-client.js';

export interface ClaudeStreamMessage {
  type: 'system' | 'assistant' | 'user' | 'result' | 'log' | 'control_request';
  subtype?: string;
  session_id?: string;
  message?: {
    id?: string;
    role?: 'assistant' | 'user';
    content?: Array<ClaudeContentBlock>;
  };
  is_error?: boolean;
  duration_ms?: number;
  result?: string;
  request_id?: string;
  request?: { subtype: 'can_use_tool'; tool_name: string; input?: unknown; tool_use_id?: string };
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown; is_error?: boolean };

export interface ControlResponse {
  type: 'control_response';
  response: {
    request_id: string;
    subtype: 'can_use_tool_response';
    behavior: 'allow' | 'deny';
    message?: string;
  };
}

/**
 * §Claude Control Protocol — auto-approval with optional allow-list (T-21-04).
 *   • `allow=undefined` or `['*']` → approve all (default daemon policy).
 *   • `allow=[...]` → approve iff tool_name in list; deny otherwise with
 *     an explanatory `message` so the UI can show it in the audit trail.
 * Every decision is paired with an audit `thinking` message in `runClaudeTask`.
 */
export function buildControlResponse(
  req: { request_id?: string; request?: { subtype?: string; tool_name?: string } },
  allow: string[] | undefined,
): ControlResponse {
  const toolName = req.request?.tool_name ?? 'unknown';
  const isAllowed =
    !allow ||
    allow.length === 0 ||
    allow.includes('*') ||
    allow.includes(toolName);
  return {
    type: 'control_response',
    response: {
      request_id: req.request_id ?? '',
      subtype: 'can_use_tool_response',
      behavior: isAllowed ? 'allow' : 'deny',
      message: isAllowed ? undefined : `Tool '${toolName}' not in daemon allow-list`,
    },
  };
}

/**
 * Maps one Claude stream-json message to zero or more `AgentMessage` values.
 * Returns [] for messages that produce no user-visible output
 * (`system`, `log`, `result` with is_error=false). Caller filters.
 */
export function mapClaudeMessageToAgentMessage(
  msg: ClaudeStreamMessage,
  toolNameLookup: Map<string, string>,
): AgentMessage[] {
  const out: AgentMessage[] = [];
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message!.content!) {
      if (block.type === 'text') out.push({ kind: 'text', text: block.text });
      else if (block.type === 'thinking') out.push({ kind: 'thinking', thinking: block.thinking });
      else if (block.type === 'tool_use') {
        toolNameLookup.set(block.id, block.name);
        out.push({ kind: 'tool_use', toolUseId: block.id, toolName: block.name, input: block.input });
      }
    }
  } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message!.content!) {
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        out.push({
          kind: 'tool_result',
          toolUseId: block.tool_use_id,
          content,
          isError: Boolean(block.is_error),
        });
      }
    }
  } else if (msg.type === 'result' && msg.is_error) {
    out.push({ kind: 'error', error: msg.result ?? 'agent failed' });
  }
  return out;
}

export function toPendingTaskMessage(
  agentMsg: AgentMessage,
  ctx: { workspaceId: string; issueId: string; toolNameLookup: Map<string, string> },
): PendingTaskMessageWire {
  switch (agentMsg.kind) {
    case 'text':
      return { type: 'text', content: agentMsg.text, workspaceId: ctx.workspaceId, issueId: ctx.issueId };
    case 'thinking':
      return { type: 'thinking', content: agentMsg.thinking, workspaceId: ctx.workspaceId, issueId: ctx.issueId };
    case 'tool_use':
      return {
        type: 'tool_use',
        tool: agentMsg.toolName,
        input: agentMsg.input,
        metadata: { toolUseId: agentMsg.toolUseId },
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool: ctx.toolNameLookup.get(agentMsg.toolUseId) ?? 'unknown',
        output: agentMsg.content,
        metadata: { toolUseId: agentMsg.toolUseId, isError: agentMsg.isError },
        workspaceId: ctx.workspaceId,
        issueId: ctx.issueId,
      };
    case 'error':
      return { type: 'error', content: agentMsg.error, workspaceId: ctx.workspaceId, issueId: ctx.issueId };
  }
}

/**
 * PM7 — strip PATH / AQUARIUM_* from agent custom_env before handing to child.
 * Prevents user-shadowed credentials from leaking into the spawned claude.
 */
export function sanitizeCustomEnv(customEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(customEnv)) {
    if (k === 'PATH' || k === 'Path') continue;
    if (k.startsWith('AQUARIUM_')) continue;
    out[k] = v;
  }
  return out;
}

export interface SpawnClaudeOpts {
  prompt: string;
  workDir: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  claudePath: string;
  abortSignal: AbortSignal;
  gracefulKillMs: number;
  /** Test seam — replace `execa`. */
  _execa?: typeof execa;
}

/**
 * Spawn `claude` with stream-json IO and stdio permission handshake.
 *   PM1 — `shell: false` + `detached` (POSIX only) + `forceKillAfterDelay`.
 *   PM3 — PATH prepended with daemon binary dir so child `aquarium` resolves.
 *   PM7 — AQUARIUM_TOKEN / AQUARIUM_DAEMON_TOKEN explicitly deleted from env.
 */
export function spawnClaude(opts: SpawnClaudeOpts): Subprocess {
  const spawnFn = opts._execa ?? execa;
  const daemonBinDir = path.dirname(process.execPath);
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: daemonBinDir + path.delimiter + (process.env.PATH ?? ''),
    ...sanitizeCustomEnv(opts.customEnv),
  };
  // PM7 — token must NEVER leak into child env:
  delete env.AQUARIUM_DAEMON_TOKEN;
  delete env.AQUARIUM_TOKEN;

  return spawnFn(
    opts.claudePath,
    [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio',
      ...opts.customArgs,
    ],
    {
      cwd: opts.workDir ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,                                          // PM1 HARD
      detached: process.platform !== 'win32',                // PM1 — process group kill on POSIX
      cancelSignal: opts.abortSignal,                        // execa 9 native
      forceKillAfterDelay: opts.gracefulKillMs,              // SIGTERM → SIGKILL escalation
    },
  ) as unknown as Subprocess;
}

// ── Top-level orchestrator: run one task end-to-end ──

export interface RunClaudeTaskDeps {
  task: ClaimedTask;
  claudePath: string;
  config: {
    backends: { claude: { allow: string[] } };
    gracefulKillMs: number;
    inactivityKillMs: number;
  };
  onAgentMessage: (pending: PendingTaskMessageWire) => void;
  abortSignal: AbortSignal;
  /** Test seams */
  _spawn?: typeof spawnClaude;
}

export interface RunClaudeTaskResult {
  exitCode: number;
  cancelled: boolean;
}

export async function runClaudeTask(deps: RunClaudeTaskDeps): Promise<RunClaudeTaskResult> {
  const spawn = deps._spawn ?? spawnClaude;
  const customEnv = deps.task.agent.customEnv ?? {};
  const customArgs = deps.task.agent.customArgs ?? [];
  const prompt = buildPrompt(deps.task);

  const child = spawn({
    prompt,
    workDir: deps.task.workDir,
    customEnv,
    customArgs,
    claudePath: deps.claudePath,
    abortSignal: deps.abortSignal,
    gracefulKillMs: deps.config.gracefulKillMs,
  });

  // PM4 — write ONE user message. Keep stdin OPEN for the control_response
  // handshake (control_request frames arrive on stdout mid-stream; stdin is
  // closed via `.end()` after the task loop exits, below).
  try {
    const stdin = child.stdin as Writable | null;
    if (stdin) {
      stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
    }
  } catch { /* spawn failure — surfaces via child.catch below */ }

  const toolNameLookup = new Map<string, string>();

  try {
    const stdout = child.stdout as Readable | null;
    if (!stdout) throw new Error('claude child has no stdout');
    for await (const msg of parseNdjson<ClaudeStreamMessage>(stdout, {
      inactivityMs: deps.config.inactivityKillMs,
      onInactive: () => {
        // Caller's abort controller drives kill-escalation through execa's
        // cancelSignal. We don't touch child.kill() here.
      },
    })) {
      if (deps.abortSignal.aborted) break;
      if (msg.type === 'control_request') {
        const response = buildControlResponse(msg, deps.config.backends.claude.allow);
        const stdin = child.stdin as Writable | null;
        try { stdin?.write(JSON.stringify(response) + '\n'); } catch { /* child closed */ }
        // T-21-04 audit: emit a thinking message so the decision is in the issue timeline.
        const verdict = response.response.behavior === 'allow' ? 'auto-approve' : 'deny';
        deps.onAgentMessage({
          type: 'thinking',
          content: `[${verdict}] tool=${msg.request?.tool_name ?? 'unknown'}`,
          workspaceId: deps.task.workspaceId,
          issueId: deps.task.issue.id,
          metadata: { requestId: response.response.request_id },
        });
        continue;
      }
      const agentMsgs = mapClaudeMessageToAgentMessage(msg, toolNameLookup);
      for (const am of agentMsgs) {
        deps.onAgentMessage(toPendingTaskMessage(am, {
          workspaceId: deps.task.workspaceId,
          issueId: deps.task.issue.id,
          toolNameLookup,
        }));
      }
    }
  } catch {
    // NDJSON iterator ended in a non-exit way — child exit below is authoritative.
  }

  // PM4 — close stdin now that the task loop has exited. Keeping it open any
  // longer would pin the child if it's still reading from stdin.
  try { (child.stdin as Writable | null)?.end?.(); } catch { /* child may already be closed */ }

  // Await child exit — execa promise resolves with { exitCode, isCanceled } or rejects.
  try {
    const result = (await (child as unknown as ResultPromise)) as {
      exitCode?: number;
      isCanceled?: boolean;
    };
    return { exitCode: result.exitCode ?? 0, cancelled: Boolean(result.isCanceled) };
  } catch (err) {
    const e = err as { exitCode?: number; isCanceled?: boolean };
    return { exitCode: e.exitCode ?? 1, cancelled: Boolean(e.isCanceled) };
  }
}

function buildPrompt(task: ClaimedTask): string {
  const pieces = [
    task.agent.instructions.trim(),
    '',
    `Issue #${task.issue.issueNumber}: ${task.issue.title}`,
  ];
  if (task.issue.description) pieces.push('', task.issue.description);
  if (task.triggerCommentContent) pieces.push('', `Reply context:`, task.triggerCommentContent);
  return pieces.join('\n').trim();
}

export const claudeBackend = {
  runClaudeTask,
  spawnClaude,
  buildControlResponse,
  mapClaudeMessageToAgentMessage,
};
