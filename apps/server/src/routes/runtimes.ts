import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listAll, getById } from '../services/runtime-registry.js';
import type { ApiResponse, Runtime } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// CE: single default workspace (seeded by migration 003).
// TODO(EE): swap for `req.auth.workspaceId` once the auth payload carries it.
const DEFAULT_WORKSPACE_ID = 'AQ';

/**
 * GET /api/runtimes
 *
 * Returns all runtimes (hosted_instance + local_daemon + external_cloud_daemon)
 * for the current workspace. Status for hosted_instance rows is derived at read
 * time from `instances.status` via LEFT JOIN (see services/runtime-registry.ts#listAll).
 *
 * RT-01 (list all runtimes in a single view with kind / provider / status /
 * device_info / last_heartbeat_at).
 */
router.get('/', async (_req, res) => {
  try {
    const runtimes = await listAll(DEFAULT_WORKSPACE_ID);
    res.json({ ok: true, data: runtimes } satisfies ApiResponse<Runtime[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/**
 * GET /api/runtimes/:id
 *
 * Returns a single runtime with derived status. Stubbed here for Phase 25 UI
 * detail-view — included in Phase 16 because the extra 15 LOC makes the route
 * pair complete.
 */
router.get('/:id', async (req, res) => {
  try {
    const runtime = await getById(DEFAULT_WORKSPACE_ID, req.params.id);
    if (!runtime) {
      res.status(404).json({ ok: false, error: 'Runtime not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: runtime } satisfies ApiResponse<Runtime>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
