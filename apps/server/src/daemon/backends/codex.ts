/**
 * Codex agent backend (Phase 22 Plan 02 — BACKEND-02).
 *
 * Wire protocol: JSON-RPC 2.0 over newline-delimited JSON on stdio.
 *   - Framing = NDJSON (no Content-Length headers).
 *   - 3-request handshake: `initialize` → `thread/start` → `turn/start`.
 *   - Notifications mapped to AgentMessage; server-initiated requests
 *     (approval prompts) answered with policy-gated decisions.
 *   - Cancel: fire-and-forget `turn/interrupt` on stdin, THEN execa's
 *     `cancelSignal` + `forceKillAfterDelay` backstop for SIGTERM→SIGKILL.
 *
 * OWNED pitfalls (carry-forward from Phases 21 + 22-01):
 *   PG1 (main.ts), PG2, PG4 (main.ts batcher), PG5, PG7, PG8, PG10, PM1,
 *   PM3, PM4, PM5/PM6 hybrid, PM7.
 *
 * OWNED threat mitigations:
 *   • T-22-05 — `buildCodexApprovalResponse` allow-list gating + audit
 *     `thinking` message for EVERY approval decision (allow AND deny paths).
 *   • T-22-06 — Audit content is fixed-format template literal; command
 *     preview truncated to 120 chars before emission.
 *   • T-22-07 — `buildChildEnv` strips AQUARIUM_DAEMON_TOKEN + AQUARIUM_TOKEN
 *     from child env; `sanitizeCustomEnv` drops AQUARIUM_* + PATH from custom.
 *   • T-22-08 — Cancel is fire-and-forget `turn/interrupt` (no await) +
 *     execa `forceKillAfterDelay` backstop.
 *
 * Research references:
 *   .planning/phases/22-remaining-agent-backends/22-RESEARCH.md
 *     §Codex Backend (method surface, approval shapes, cancel semantics),
 *     §Don't Hand-Roll, §Assumptions Log A1+A5+A6.
 */

import type { Readable, Writable } from 'node:stream';
import { execa, type ResultPromise, type Subprocess } from 'execa';
import { parseNdjson } from '../ndjson-parser.js';
import { buildChildEnv } from './env.js';
import { detectCodex } from './detect-codex.js';
import type { Backend, BackendRunDeps, BackendRunResult } from '../backend.js';
import type { AgentMessage, ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from '../http-client.js';

// ── JSON-RPC envelope helpers ──────────────────────────────────────────────

interface JsonRpcEnvelope {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isResponse(m: JsonRpcEnvelope): m is JsonRpcEnvelope & { id: string | number } {
  return (
    m.id !== undefined &&
    m.method === undefined &&
    (m.result !== undefined || m.error !== undefined)
  );
}

function isServerRequest(
  m: JsonRpcEnvelope,
): m is JsonRpcEnvelope & { id: string | number; method: string } {
  return m.id !== undefined && typeof m.method === 'string';
}

function isNotification(m: JsonRpcEnvelope): m is JsonRpcEnvelope & { method: string } {
  return m.id === undefined && typeof m.method === 'string';
}

// ── Approval decision policy ───────────────────────────────────────────────

interface CodexApprovalParams {
  tool_name?: string;
  command?: string;
}

/**
 * Build the JSON-RPC response the daemon writes to codex's stdin in reply to
 * a server-initiated approval request.
 *
 * • `item/tool/requestUserInput` — ALWAYS answered with `{ denied: true }`.
 *    The daemon runs headless; it cannot prompt a user for input.
 * • All other approval methods — allow-list gated. `{ decision: 'approved' }`
 *   or `{ decision: 'denied' }` matching Research Assumption A1 (see
 *   22-RESEARCH.md §Codex Backend approval shapes).
 * • Default allow=undefined or allow=[] or allow=['*'] → approve all.
 */
export function buildCodexApprovalResponse(
  req: { id: string | number; method: string; params?: unknown },
  allow: string[] | undefined,
): JsonRpcEnvelope & { id: string | number } {
  // User-input requests are ALWAYS denied in headless mode.
  if (req.method === 'item/tool/requestUserInput') {
    return { id: req.id, result: { denied: true } };
  }
  const params = (req.params ?? {}) as CodexApprovalParams;
  const toolName =
    params.tool_name ?? (req.method.includes('fileChange') ? 'edit' : 'unknown');
  const isAllowed =
    !allow || allow.length === 0 || allow.includes('*') || allow.includes(toolName);
  return {
    id: req.id,
    result: {
      decision: isAllowed ? 'approved' : 'denied',
      ...(isAllowed
        ? {}
        : { message: `Tool '${toolName}' not in daemon allow-list` }),
    },
  };
}

// ── Notification → AgentMessage mapping ───────────────────────────────────

interface CodexNotificationFrame {
  method: string;
  params?: Record<string, unknown>;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregatedOutput?: string;
  status?: string;
  tool?: string;
  changes?: unknown;
  server?: string;
}

/**
 * Map a single codex notification frame to zero or more `AgentMessage`
 * values. Returns [] for messages the daemon doesn't surface
 * (`thread/started`, `turn/started`, `turn/completed` — all bookkeeping).
 * Caller filters via `toPendingTaskMessage` → `deps.onAgentMessage`.
 */
export function mapCodexNotificationToAgentMessage(
  n: CodexNotificationFrame,
): AgentMessage[] {
  const params = n.params ?? {};
  switch (n.method) {
    case 'thread/started':
    case 'turn/started':
    case 'turn/completed':
      return [];
    case 'item/agentMessage/delta': {
      const delta = typeof params.delta === 'string' ? params.delta : '';
      return delta ? [{ kind: 'text', text: delta }] : [];
    }
    case 'item/reasoning/textDelta': {
      const delta = typeof params.delta === 'string' ? params.delta : '';
      return delta ? [{ kind: 'thinking', thinking: delta }] : [];
    }
    case 'item/completed': {
      const item = (params.item ?? {}) as CodexItem;
      const id = item.id ?? '';
      switch (item.type) {
        case 'agentMessage':
          return typeof item.text === 'string' && item.text.length > 0
            ? [{ kind: 'text', text: item.text }]
            : [];
        case 'reasoning':
          return typeof item.text === 'string'
            ? [{ kind: 'thinking', thinking: item.text }]
            : [];
        case 'commandExecution':
          return [
            {
              kind: 'tool_use',
              toolUseId: id,
              toolName: 'exec',
              input: { command: item.command },
            },
            {
              kind: 'tool_result',
              toolUseId: id,
              content: item.aggregatedOutput ?? '',
              isError: item.status !== 'succeeded',
            },
          ];
        case 'fileChange':
          return [
            {
              kind: 'tool_use',
              toolUseId: id,
              toolName: 'edit',
              input: { changes: item.changes },
            },
            {
              kind: 'tool_result',
              toolUseId: id,
              content: JSON.stringify(item.changes ?? {}),
              isError: item.status !== 'succeeded',
            },
          ];
        case 'mcpToolCall':
        case 'dynamicToolCall':
          return [
            {
              kind: 'tool_use',
              toolUseId: id,
              toolName: item.tool ?? 'unknown',
              input: params,
            },
            {
              kind: 'tool_result',
              toolUseId: id,
              content: JSON.stringify(params),
              isError: item.status !== 'succeeded',
            },
          ];
        default:
          return [];
      }
    }
    case 'error': {
      const msg = typeof params.message === 'string' ? params.message : 'codex error';
      return [{ kind: 'error', error: msg }];
    }
    default:
      return [];
  }
}

// ── PendingTaskMessageWire adapter ─────────────────────────────────────────

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

// ── spawn + run ────────────────────────────────────────────────────────────

export interface SpawnCodexOpts {
  binaryPath: string;
  workDir: string | null;
  customEnv: Record<string, string>;
  abortSignal: AbortSignal;
  gracefulKillMs: number;
  /** Test seam — replace `execa`. */
  _execa?: typeof execa;
}

/**
 * Spawn `codex app-server --listen stdio://`.
 *   PM1 — `shell: false` + `detached` (POSIX only) + `forceKillAfterDelay`.
 *   PM3 — PATH prepended with daemon binary dir (via buildChildEnv).
 *   PM7 — AQUARIUM_TOKEN + AQUARIUM_DAEMON_TOKEN deleted from env.
 */
export function spawnCodex(opts: SpawnCodexOpts): Subprocess {
  const spawnFn = opts._execa ?? execa;
  const env = buildChildEnv({ customEnv: opts.customEnv });

  return spawnFn(
    opts.binaryPath,
    ['app-server', '--listen', 'stdio://'],
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

// ── Top-level orchestrator: run one codex task end-to-end ──

export interface RunCodexTaskDeps {
  task: ClaimedTask;
  binaryPath: string;
  config: {
    allow?: string[];
    gracefulKillMs: number;
    inactivityKillMs: number;
  };
  onAgentMessage: (pending: PendingTaskMessageWire) => void;
  abortSignal: AbortSignal;
  /** Test seam — replace `spawnCodex`. */
  _spawn?: typeof spawnCodex;
}

export async function runCodexTask(
  deps: RunCodexTaskDeps,
): Promise<BackendRunResult> {
  const spawn = deps._spawn ?? spawnCodex;
  const child = spawn({
    binaryPath: deps.binaryPath,
    workDir: deps.task.workDir,
    customEnv: deps.task.agent.customEnv ?? {},
    abortSignal: deps.abortSignal,
    gracefulKillMs: deps.config.gracefulKillMs,
  });

  const stdin = child.stdin as Writable | null;
  const stdout = child.stdout as Readable | null;
  if (!stdin || !stdout) return { exitCode: 1, cancelled: false };

  let nextId = 1;
  const pendingReplies = new Map<number | string, (env: JsonRpcEnvelope) => void>();

  const writeLine = (obj: unknown): void => {
    try {
      stdin.write(JSON.stringify(obj) + '\n');
    } catch {
      // Child dying — signal escalation in execa handles it.
    }
  };

  const call = (method: string, params: unknown): Promise<JsonRpcEnvelope> => {
    const id = nextId++;
    return new Promise<JsonRpcEnvelope>((resolve) => {
      pendingReplies.set(id, resolve);
      writeLine({ id, method, params });
    });
  };

  let threadId: string | null = null;
  let turnId: string | null = null;
  const issueCtx = {
    workspaceId: deps.task.workspaceId,
    issueId: deps.task.issue.id,
  };

  // Consumer loop — runs in parallel with the handshake writes so that
  // handshake replies (id=1/2/3) are routed back to their pendingReplies
  // promises without deadlocking.
  const consume = async (): Promise<void> => {
    for await (const frame of parseNdjson<JsonRpcEnvelope>(stdout, {
      inactivityMs: deps.config.inactivityKillMs,
    })) {
      if (deps.abortSignal.aborted) break;

      if (isResponse(frame)) {
        const cb = pendingReplies.get(frame.id);
        if (cb) {
          pendingReplies.delete(frame.id);
          cb(frame);
        }
        continue;
      }

      if (isServerRequest(frame)) {
        const resp = buildCodexApprovalResponse(
          { id: frame.id, method: frame.method, params: frame.params },
          deps.config.allow,
        );
        writeLine(resp);
        // T-22-05 / T-22-06 audit: emit one `thinking` message per decision.
        const result = resp.result as { decision?: string; denied?: boolean };
        const verdict = result.decision === 'approved' ? 'auto-approve' : 'deny';
        const params = (frame.params ?? {}) as CodexApprovalParams;
        const toolName = params.tool_name ?? 'unknown';
        const cmdPreview = String(params.command ?? '').slice(0, 120);
        deps.onAgentMessage({
          type: 'thinking',
          content: `[${verdict}] codex tool=${toolName}${
            cmdPreview ? ` command=${cmdPreview}` : ''
          }`,
          workspaceId: issueCtx.workspaceId,
          issueId: issueCtx.issueId,
          metadata: { codexRequestId: String(frame.id) },
        });
        continue;
      }

      if (isNotification(frame)) {
        // Track threadId / turnId for the cancel-time `turn/interrupt`.
        if (frame.method === 'thread/started') {
          const p = (frame.params ?? {}) as { threadId?: string };
          if (typeof p.threadId === 'string') threadId = p.threadId;
        } else if (frame.method === 'turn/started') {
          const p = (frame.params ?? {}) as { turnId?: string };
          if (typeof p.turnId === 'string') turnId = p.turnId;
        }
        const msgs = mapCodexNotificationToAgentMessage({
          method: frame.method,
          params: (frame.params ?? {}) as Record<string, unknown>,
        });
        for (const am of msgs) {
          deps.onAgentMessage(toPendingTaskMessage(am, issueCtx));
        }
        if (frame.method === 'turn/completed') return;
        continue;
      }

      // Malformed envelope — neither response nor request nor notification.
      // Drop silently (PG10 carry-forward).
    }
  };

  const consumeDone = consume().catch(() => {
    /* Outer try/catch; child exit is authoritative. */
  });

  try {
    await call('initialize', {
      clientInfo: { name: 'aquarium-daemon', version: readDaemonVersion() },
    });
    const threadRes = await call('thread/start', {
      ...(deps.task.workDir ? { cwd: deps.task.workDir } : {}),
      baseInstructions: deps.task.agent.instructions,
    });
    const threadResult = (threadRes.result ?? {}) as { threadId?: string };
    if (typeof threadResult.threadId === 'string') threadId = threadResult.threadId;

    const prompt = buildCodexPrompt(deps.task);
    const turnRes = await call('turn/start', {
      threadId: threadId ?? '',
      input: [{ type: 'text', text: prompt }],
    });
    const turnResult = (turnRes.result ?? {}) as { turn?: { turnId?: string } };
    if (turnResult.turn && typeof turnResult.turn.turnId === 'string') {
      turnId = turnResult.turn.turnId;
    }
  } catch {
    // Handshake failed — let child exit drive the result.
  }

  // PM5/PM6 hybrid — on abort, fire-and-forget `turn/interrupt` into stdin,
  // THEN let execa's cancelSignal + forceKillAfterDelay complete SIGTERM→SIGKILL.
  const onAbort = (): void => {
    if (threadId && turnId) {
      writeLine({
        id: nextId++,
        method: 'turn/interrupt',
        params: { threadId, turnId },
      });
    }
  };
  if (deps.abortSignal.aborted) onAbort();
  else deps.abortSignal.addEventListener('abort', onAbort, { once: true });

  await consumeDone;

  try {
    stdin.end();
  } catch {
    /* Already closed. */
  }

  // Await child exit — execa promise resolves with { exitCode, isCanceled }.
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

function buildCodexPrompt(task: ClaimedTask): string {
  const pieces = [`Issue #${task.issue.issueNumber}: ${task.issue.title}`];
  if (task.issue.description) pieces.push('', task.issue.description);
  if (task.triggerCommentContent) pieces.push('', 'Reply context:', task.triggerCommentContent);
  return pieces.join('\n').trim();
}

function readDaemonVersion(): string {
  // Keep in sync with main.ts readPackageVersion; hard-coded fallback acceptable.
  return '1.4.0';
}

// ── Backend export ─────────────────────────────────────────────────────────

async function runCodexAsBackend(deps: BackendRunDeps): Promise<BackendRunResult> {
  return runCodexTask({
    task: deps.task,
    binaryPath: deps.binaryPath,
    config: {
      allow: deps.config.backend.allow,
      gracefulKillMs: deps.config.gracefulKillMs,
      inactivityKillMs: deps.config.inactivityKillMs,
    },
    onAgentMessage: deps.onAgentMessage,
    abortSignal: deps.abortSignal,
    _spawn: deps._spawn as typeof spawnCodex | undefined,
  });
}

export const codexBackend: Backend = {
  provider: 'codex',
  detect: detectCodex,
  run: runCodexAsBackend,
};
