import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createAgent,
  updateAgent,
  archiveAgent,
  restoreAgent,
  getAgent,
  listAgents,
  type CreateAgentArgs,
  type UpdateAgentPatch,
} from '../services/agent-store.js';
import type { ApiResponse, Agent } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// CE: single default workspace (seeded by migration 003). Matches routes/runtimes.ts.
// TODO(EE): swap for `req.auth.workspaceId` once the auth payload carries it.
const DEFAULT_WORKSPACE_ID = 'AQ';

/**
 * GET /api/agents[?includeArchived=true]
 *
 * AGENT-01 list: workspace-scoped, excludes archived by default.
 */
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const agents = await listAgents(DEFAULT_WORKSPACE_ID, { includeArchived });
    res.json({ ok: true, data: agents } satisfies ApiResponse<Agent[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * GET /api/agents/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const agent = await getAgent(req.params.id, DEFAULT_WORKSPACE_ID);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'Agent not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: agent } satisfies ApiResponse<Agent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * POST /api/agents
 *
 * Body: CreateAgentArgs (minus workspaceId which comes from auth context).
 * AGENT-01 create + AGENT-02 max_concurrent_tasks range enforcement.
 */
router.post('/', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreateAgentArgs>;
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'name is required' } satisfies ApiResponse);
      return;
    }
    const agent = await createAgent({
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: body.name,
      runtimeId: body.runtimeId ?? null,
      avatarUrl: body.avatarUrl ?? null,
      description: body.description ?? null,
      instructions: body.instructions,
      customEnv: body.customEnv,
      customArgs: body.customArgs,
      maxConcurrentTasks: body.maxConcurrentTasks,
      visibility: body.visibility,
      ownerUserId: req.auth?.userId ?? null,
    });
    res.status(201).json({ ok: true, data: agent } satisfies ApiResponse<Agent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Validation errors from the service (MCT range, unknown runtime_id, visibility enum)
    // surface as 400; UNIQUE(workspace_id, name) collision SQLite message also maps here.
    const isValidation =
      /must be|references an unknown|UNIQUE constraint failed/.test(message);
    res.status(isValidation ? 400 : 500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * PATCH /api/agents/:id
 *
 * Body: UpdateAgentPatch (partial — every field optional).
 */
router.patch('/:id', async (req, res) => {
  try {
    const patch = (req.body ?? {}) as UpdateAgentPatch;
    const agent = await updateAgent(req.params.id, DEFAULT_WORKSPACE_ID, patch);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'Agent not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: agent } satisfies ApiResponse<Agent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidation = /must be|references an unknown|UNIQUE constraint failed/.test(message);
    res.status(isValidation ? 400 : 500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * DELETE /api/agents/:id
 *
 * Soft-delete (archive): sets archived_at + archived_by. FK targets (issues,
 * tasks) remain valid — AGENT-01 requires archive, not hard delete.
 */
router.delete('/:id', async (req, res) => {
  try {
    const agent = await archiveAgent(req.params.id, DEFAULT_WORKSPACE_ID, req.auth?.userId ?? null);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'Agent not found or already archived' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: agent } satisfies ApiResponse<Agent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * POST /api/agents/:id/restore
 */
router.post('/:id/restore', async (req, res) => {
  try {
    const agent = await restoreAgent(req.params.id, DEFAULT_WORKSPACE_ID);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'Agent not found or not archived' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: agent } satisfies ApiResponse<Agent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
