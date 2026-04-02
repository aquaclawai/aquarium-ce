import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import {
  getGatewayClient,
  consumePendingApproval,
  getPendingApprovalsForInstance,
} from '../services/gateway-event-relay.js';
import { broadcastToUser } from '../ws/index.js';
import type { ApiResponse, ExecApprovalResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

router.post('/:id/exec-approval', async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalId, approved } = req.body as ExecApprovalResponse;

    if (typeof approvalId !== 'string' || approvalId.trim().length === 0 || typeof approved !== 'boolean') {
      res.status(400).json({ ok: false, error: 'Missing or invalid approvalId or approved' } satisfies ApiResponse);
      return;
    }

    const instance = await getInstance(id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const client = getGatewayClient(id);
    if (!client) {
      res.status(502).json({ ok: false, error: 'Gateway not connected' } satisfies ApiResponse);
      return;
    }

    try {
      await client.call('exec.approval.resolve', { id: approvalId, approved }, 10_000);
    } catch (err) {
      res.status(502).json({ ok: false, error: `Gateway RPC failed: ${(err as Error).message}` } satisfies ApiResponse);
      return;
    }

    consumePendingApproval(id, approvalId);

    broadcastToUser(req.auth!.userId, {
      type: 'instance:exec_approval_resolved',
      instanceId: id,
      payload: { approvalId, approved, respondedBy: req.auth!.userId },
    });

    res.json({ ok: true, data: { approvalId, approved } } satisfies ApiResponse);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message } satisfies ApiResponse);
  }
});

router.get('/:id/exec-approval/pending', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const pending = getPendingApprovalsForInstance(req.params.id);
    res.json({ ok: true, data: pending } satisfies ApiResponse);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message } satisfies ApiResponse);
  }
});

export default router;
