import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireDaemonAuth } from '../middleware/daemon-auth.js';
import {
  upsertDaemonRuntime,
  updateHeartbeat,
  setRuntimeOffline,
  getById as getRuntimeById,
} from '../services/runtime-registry.js';
import {
  claimTask,
  startTask,
  completeTask,
  failTask,
  isTaskCancelled,
  type TerminalResult,
} from '../services/task-queue-store.js';
import {
  appendTaskMessage,
  flushTaskMessages,
  type PendingTaskMessage,
} from '../task-dispatch/task-message-batcher.js';
import {
  listTaskMessagesOfKind,
  truncateForStorage,
} from '../services/task-message-store.js';
import { createAgentComment } from '../services/comment-store.js';
import { broadcast } from '../ws/index.js';
import { db } from '../db/index.js';
import type {
  ApiResponse,
  Runtime,
  DaemonRegisterRequest,
  DaemonRegisterResponse,
  ClaimedTask,
  TaskStatus,
  TaskMessageType,
} from '@aquarium/shared';

/**
 * Phase 19-02 daemon REST endpoints.
 *
 * All nine endpoints are mounted under `/api/daemon/*` and gated by
 * `requireDaemonAuth` (Phase 19-01). The router is a thin HTTP wrapper over
 * Phase 16/17/18 services — no new business logic, no direct SQL for
 * business-state mutations. The only DB reads that happen in-route are
 * workspace-scoping guards for /progress (issue_id lookup for WS routing)
 * and /status (read of `status` + cancelled flag).
 *
 * Workspace scoping (AUTH4 IDOR guard): every endpoint that receives a
 * runtime id or task id in the URL resolves it via a workspace-filtered
 * query before dispatching to the service layer. Mismatched ids → 404.
 *
 * Rate-limiter topology (DAEMON-08): a per-token bucket (1000 req / 60s
 * keyed by `req.daemonAuth.tokenHash`) is mounted AFTER `requireDaemonAuth`
 * so the key is always populated. Guarded by `NODE_ENV === 'production'`
 * to match the existing server-core pattern (limiter disabled in dev/test).
 *
 * Error-body policy (AUTH2): fixed strings for validation/auth errors;
 * 500s surface `err.message` (never request headers or token substrings).
 */

const router = Router();
router.use(requireDaemonAuth);

// §DAEMON-08 per-token bucket — mounted AFTER `requireDaemonAuth` so
// `req.daemonAuth.tokenHash` is populated. Guarded by NODE_ENV=production
// to match the existing server-core limiter pattern (disabled in dev/test
// so Playwright E2E isn't throttled).
const daemonBucket = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // Disable the ipv6 keyGenerator-fallback validator: our keyGenerator returns
  // the SHA-256 token hash (a 64-char hex string, never an IP), so the
  // library's "IP used as key" check is a false positive here.
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
    keyGeneratorIpFallback: false,
  },
  keyGenerator: (req) => {
    // `req.daemonAuth.tokenHash` is populated by requireDaemonAuth above.
    // If (impossibly) missing, fall back to a fixed anon bucket rather than
    // `req.ip` — that avoids the library's ipv6-bypass worry entirely.
    return req.daemonAuth?.tokenHash ?? 'anon';
  },
});
if (process.env.NODE_ENV === 'production') {
  router.use(daemonBucket);
}

// Batch limits for /messages — defence against a compromised daemon
// fire-hosing the batcher (pairs with task-message-batcher BUFFER_SOFT_CAP=500).
const MAX_BATCH = 100;
const MAX_BATCH_BYTES = 64 * 1024;

// ── POST /register — DAEMON-01 ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const body = req.body as Partial<DaemonRegisterRequest> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'invalid body' } satisfies ApiResponse);
      return;
    }
    if (!body.daemonId || typeof body.daemonId !== 'string') {
      res.status(400).json({ ok: false, error: 'daemonId required' } satisfies ApiResponse);
      return;
    }
    // Q1: reject body workspaceId mismatch with the token's workspace (defence-in-depth).
    if (
      typeof body.workspaceId === 'string' &&
      body.workspaceId !== req.daemonAuth!.workspaceId
    ) {
      res.status(400).json({ ok: false, error: 'workspace mismatch' } satisfies ApiResponse);
      return;
    }
    if (!Array.isArray(body.runtimes) || body.runtimes.length === 0) {
      res.status(400).json({ ok: false, error: 'runtimes array required' } satisfies ApiResponse);
      return;
    }

    // Persist daemon_id on the token row so subsequent /heartbeat can enforce lifecycle (Q8).
    await db('daemon_tokens')
      .where({ id: req.daemonAuth!.tokenId })
      .update({ daemon_id: body.daemonId, updated_at: new Date().toISOString() });

    // Map the DaemonRegisterRequest device fields onto RuntimeDeviceInfo's
    // shared shape (os? / hostname? / arch? / version?) — hostname carries
    // deviceName, version carries cliVersion. `launchedBy` is informational
    // and is folded into the runtime metadata via upsertDaemonRuntime's
    // existing deviceInfo JSON column (keys beyond the typed surface are
    // preserved by adapter.jsonValue roundtrip).
    const deviceInfo = body.deviceName
      ? ({
          hostname: body.deviceName,
          version: body.cliVersion ?? '',
        } as const)
      : null;

    const created: Runtime[] = [];
    for (const rt of body.runtimes) {
      const id = await upsertDaemonRuntime({
        workspaceId: req.daemonAuth!.workspaceId,
        daemonId: body.daemonId,
        provider: rt.provider,
        name: rt.name,
        deviceInfo,
        ownerUserId: null,
        kind: 'local_daemon',
      });
      const runtime = await getRuntimeById(req.daemonAuth!.workspaceId, id);
      if (runtime) created.push(runtime);
    }

    const payload: DaemonRegisterResponse = { runtimes: created };
    res.json({ ok: true, data: payload } satisfies ApiResponse<DaemonRegisterResponse>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /heartbeat — DAEMON-02 ────────────────────────────────────────────
router.post('/heartbeat', async (req, res) => {
  try {
    // Q8: /heartbeat rejects with 409 when /register has not populated daemon_id yet.
    if (!req.daemonAuth!.daemonId) {
      res.status(409).json({
        ok: false,
        error: 'daemon not registered — call /register first',
      } satisfies ApiResponse);
      return;
    }
    const raw = (req.body as { runtimeIds?: unknown } | undefined)?.runtimeIds;
    const runtimeIds = Array.isArray(raw) ? (raw as unknown[]) : [];
    for (const id of runtimeIds) {
      if (typeof id !== 'string') continue;
      // AUTH4: workspace-scope guard before touching the row.
      const runtime = await getRuntimeById(req.daemonAuth!.workspaceId, id);
      if (!runtime) continue; // silently skip foreign ids; daemon's cache may be stale
      await updateHeartbeat(id);
    }
    res.json({
      ok: true,
      data: { pendingPings: [] as unknown[], pendingUpdates: [] as unknown[] },
    } satisfies ApiResponse<{ pendingPings: unknown[]; pendingUpdates: unknown[] }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /deregister — DAEMON-03 ───────────────────────────────────────────
router.post('/deregister', async (req, res) => {
  try {
    const raw = (req.body as { runtimeIds?: unknown } | undefined)?.runtimeIds;
    const runtimeIds = Array.isArray(raw) ? (raw as unknown[]) : [];
    for (const id of runtimeIds) {
      if (typeof id !== 'string') continue;
      const runtime = await getRuntimeById(req.daemonAuth!.workspaceId, id);
      if (!runtime) continue;
      await setRuntimeOffline(id);
    }
    res.json({ ok: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /runtimes/:id/tasks/claim — DAEMON-04 ────────────────────────────
router.post('/runtimes/:id/tasks/claim', async (req, res) => {
  try {
    // AUTH4: workspace-scope guard — cross-workspace runtime → 404.
    const runtime = await getRuntimeById(req.daemonAuth!.workspaceId, req.params.id);
    if (!runtime) {
      res.status(404).json({ ok: false, error: 'runtime not found' } satisfies ApiResponse);
      return;
    }
    const task = await claimTask(req.params.id);
    res.json({ ok: true, data: { task } } satisfies ApiResponse<{ task: ClaimedTask | null }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /tasks/:id/start — DAEMON-05a ────────────────────────────────────
router.post('/tasks/:id/start', async (req, res) => {
  try {
    const result = await startTask(req.params.id);
    res.json({ ok: true, data: result } satisfies ApiResponse<{
      started: boolean;
      status: TaskStatus;
    }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /tasks/:id/progress — DAEMON-05b (Q4: WS-only, no DB write) ──────
router.post('/tasks/:id/progress', async (req, res) => {
  try {
    const body = (req.body as { progress?: unknown; note?: unknown } | undefined) ?? {};
    const progress = typeof body.progress === 'number' ? body.progress : null;
    const note = typeof body.note === 'string' ? body.note : undefined;
    // Workspace-scope guard + issue_id lookup for the WS routing payload.
    // Pure read — no UPDATE (Phase 15 schema has no progress column).
    const row = await db('agent_task_queue')
      .where({ id: req.params.id, workspace_id: req.daemonAuth!.workspaceId })
      .first('issue_id');
    if (!row) {
      res.status(404).json({ ok: false, error: 'task not found' } satisfies ApiResponse);
      return;
    }
    broadcast(req.daemonAuth!.workspaceId, {
      type: 'task:progress',
      taskId: req.params.id,
      issueId: row.issue_id as string,
      payload: {
        taskId: req.params.id,
        issueId: row.issue_id as string,
        progress,
        note,
      },
    });
    res.json({ ok: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /tasks/:id/messages — DAEMON-05c (batched ingest) ────────────────
router.post('/tasks/:id/messages', async (req, res) => {
  try {
    const body = (req.body as { messages?: unknown } | undefined) ?? {};
    const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : null;
    if (!messages) {
      res.status(400).json({
        ok: false,
        error: 'messages array required',
      } satisfies ApiResponse);
      return;
    }
    if (messages.length > MAX_BATCH) {
      res.status(413).json({
        ok: false,
        error: 'batch too large (max 100)',
      } satisfies ApiResponse);
      return;
    }
    // Cheap JSON-size guard — pairs with BUFFER_SOFT_CAP in the batcher.
    if (JSON.stringify(req.body).length > MAX_BATCH_BYTES) {
      res.status(413).json({
        ok: false,
        error: 'batch too large (>64KB)',
      } satisfies ApiResponse);
      return;
    }

    // Resolve issueId once via a workspace-scoped SELECT (cheaper than per-msg).
    const task = await db('agent_task_queue')
      .where({ id: req.params.id, workspace_id: req.daemonAuth!.workspaceId })
      .first('issue_id');
    if (!task) {
      res.status(404).json({ ok: false, error: 'task not found' } satisfies ApiResponse);
      return;
    }

    let accepted = 0;
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const type = m.type as TaskMessageType | undefined;
      if (!type) continue;
      const pending: PendingTaskMessage = {
        type,
        tool: typeof m.tool === 'string' ? m.tool : null,
        content: typeof m.content === 'string' ? m.content : null,
        input: m.input,
        output: m.output,
        metadata:
          m.metadata && typeof m.metadata === 'object'
            ? (m.metadata as Record<string, unknown>)
            : {},
        workspaceId: req.daemonAuth!.workspaceId,
        issueId: task.issue_id as string,
      };
      appendTaskMessage(req.params.id, pending);
      accepted++;
    }
    res.json({ ok: true, data: { accepted } } satisfies ApiResponse<{ accepted: number }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /tasks/:id/complete — DAEMON-05d ─────────────────────────────────
// Phase 24-05 (CHAT-01): on successful completion the route reconstructs the
// agent's final text via `listTaskMessagesOfKind(taskId, 'text')` — the SAME
// uniform DB-select fallback the hosted-worker uses. The request body is
// `{ result?: unknown }` — no text field exists on this request body; the
// final agent text is NEVER taken from the request (T-24-05-04 mitigation).
router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const body = req.body as { result?: unknown } | undefined;
    const taskId = req.params.id;

    // Workspace-scoped lookup for triggerCommentId + routing fields. Cross-workspace
    // task ids → 404 (AUTH4 IDOR guard; matches /messages + /status pattern).
    const taskRow = await db('agent_task_queue')
      .where({ id: taskId, workspace_id: req.daemonAuth!.workspaceId })
      .first('id', 'workspace_id', 'issue_id', 'agent_id', 'trigger_comment_id');
    if (!taskRow) {
      res.status(404).json({ ok: false, error: 'task not found' } satisfies ApiResponse);
      return;
    }

    // Flush any pending buffered task_messages for this task so the DB-select
    // fallback below sees the complete set of 'text' rows (same guarantee the
    // hosted worker gives via its pre-completion flush).
    await flushTaskMessages(taskId);

    const result = await completeTask(taskId, body?.result);

    // CHAT-01 threaded-reply post. Only when:
    //   (a) the task transitioned to 'completed' (not cancelled / idempotent-discarded), AND
    //   (b) the task has a trigger_comment_id (i.e. it was created in response
    //       to a user chat message via POST /api/issues/:id/comments).
    if (
      !result.discarded
      && result.status === 'completed'
      && taskRow.trigger_comment_id
    ) {
      let agentComment = null;
      try {
        // UNCONDITIONAL DB-SELECT — reconstruct final text from ALL 'text' kind
        // rows for this task. Same uniform helper used by the hosted worker.
        const textRows = await listTaskMessagesOfKind(db, taskId, 'text');
        const concatenated = textRows
          .map((r) => r.content ?? '')
          .filter((s) => s.length > 0)
          .join('\n\n')
          .trim();
        if (concatenated) {
          const truncation = truncateForStorage({
            content: concatenated,
            input: undefined,
            output: undefined,
          });
          const agentCommentContent = truncation.truncatedContent ?? concatenated;
          agentComment = await createAgentComment({
            workspaceId: taskRow.workspace_id as string,
            issueId: taskRow.issue_id as string,
            authorAgentId: taskRow.agent_id as string,
            content: agentCommentContent,
            parentId: taskRow.trigger_comment_id as string,
          });
        }
      } catch (commentErr) {
        // Never let the agent-reply post-step mask the successful completion.
        console.warn(
          `[daemon:/complete] createAgentComment failed for task ${taskId}:`,
          commentErr instanceof Error ? commentErr.message : String(commentErr),
        );
      }
      if (agentComment) {
        // Post-commit broadcast (SQ5 pattern — completeTask + createAgentComment
        // both own their own transactions and are committed by now).
        broadcast(taskRow.workspace_id as string, {
          type: 'comment:posted',
          issueId: taskRow.issue_id as string,
          payload: agentComment,
        });
      }
    }

    // ALWAYS 200 — { discarded: true } is not an error (TASK-06 idempotency).
    res.json({ ok: true, data: result } satisfies ApiResponse<TerminalResult>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/task .* not found/.test(msg)) {
      res.status(404).json({ ok: false, error: msg } satisfies ApiResponse);
      return;
    }
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── POST /tasks/:id/fail — DAEMON-05e ─────────────────────────────────────
router.post('/tasks/:id/fail', async (req, res) => {
  try {
    const body = req.body as { error?: unknown } | undefined;
    const errorText = typeof body?.error === 'string' ? body.error : 'unspecified';
    const result = await failTask(req.params.id, errorText);
    res.json({ ok: true, data: result } satisfies ApiResponse<TerminalResult>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/task .* not found/.test(msg)) {
      res.status(404).json({ ok: false, error: msg } satisfies ApiResponse);
      return;
    }
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── GET /tasks/:id/status — DAEMON-06 ─────────────────────────────────────
router.get('/tasks/:id/status', async (req, res) => {
  try {
    // Workspace-scoped read — cross-workspace task ids → 404.
    const row = await db('agent_task_queue')
      .where({ id: req.params.id, workspace_id: req.daemonAuth!.workspaceId })
      .first('status');
    if (!row) {
      res.status(404).json({ ok: false, error: 'task not found' } satisfies ApiResponse);
      return;
    }
    const cancelled = await isTaskCancelled(req.params.id);
    res.json({
      ok: true,
      data: { status: row.status as TaskStatus, cancelled },
    } satisfies ApiResponse<{ status: TaskStatus; cancelled: boolean }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

export default router;
