import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { querySecurityEvents, getSecuritySummary, getInstanceSecuritySummary } from '../services/security-event-service.js';
import type { ApiResponse, PaginatedResponse, InstanceEvent, SecuritySummary, InstanceSecuritySummary } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

router.get('/instances/:id/security-summary', async (req, res) => {
  try {
    const summary = await getInstanceSecuritySummary(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: summary } satisfies ApiResponse<InstanceSecuritySummary>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/instances/:id/security-events', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const severity = req.query.severity as string | undefined;
    const type = req.query.type as string | undefined;

    const result = await querySecurityEvents(
      req.params.id,
      req.auth!.userId,
      { page, limit, severity, type },
    );

    res.json({ ok: true, data: result } satisfies ApiResponse<PaginatedResponse<InstanceEvent>>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/security/summary', async (req, res) => {
  try {
    const summary = await getSecuritySummary(req.auth!.userId);
    res.json({ ok: true, data: summary } satisfies ApiResponse<SecuritySummary>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
