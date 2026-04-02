import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  diffSnapshot,
  restoreSnapshot,
} from '../services/snapshot-store.js';
import type {
  ApiResponse,
  Snapshot,
  SnapshotSummary,
  SnapshotDiff,
  PaginatedResponse,
} from '@aquarium/shared';

interface SnapshotParams {
  id: string;
  snapshotId?: string;
}

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Verify the authenticated user owns the instance
router.use(async (req: Request<SnapshotParams>, res: Response, next: NextFunction) => {
  try {
    const instance = await getInstance((req.params as SnapshotParams).id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});
// GET / — list snapshots
router.get('/', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit) || 20)));
    const result = await listSnapshots((req.params as SnapshotParams).id, { page, limit });
    res.json({ ok: true, data: result } satisfies ApiResponse<PaginatedResponse<SnapshotSummary>>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST / — create manual snapshot
router.post('/', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    const { description } = req.body as { description?: string };
    const snapshot = await createSnapshot((req.params as SnapshotParams).id, req.auth!.userId, {
      triggerType: 'manual',
      description,
    });
    res.status(201).json({ ok: true, data: snapshot } satisfies ApiResponse<Snapshot>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:snapshotId — get single snapshot
router.get('/:snapshotId', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    const snapshot = await getSnapshot((req.params as SnapshotParams).snapshotId!);
    res.json({ ok: true, data: snapshot } satisfies ApiResponse<Snapshot>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:snapshotId/diff — diff snapshot vs current
router.get('/:snapshotId/diff', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    const diff = await diffSnapshot((req.params as SnapshotParams).snapshotId!, (req.params as SnapshotParams).id);
    res.json({ ok: true, data: diff } satisfies ApiResponse<SnapshotDiff>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:snapshotId/restore — restore snapshot
router.post('/:snapshotId/restore', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    await restoreSnapshot((req.params as SnapshotParams).snapshotId!, req.auth!.userId);
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// DELETE /:snapshotId — delete snapshot
router.delete('/:snapshotId', async (req: Request<SnapshotParams>, res: Response) => {
  try {
    await deleteSnapshot((req.params as SnapshotParams).snapshotId!);
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
