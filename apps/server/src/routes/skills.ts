import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { getAgentType } from '../agent-types/registry.js';
import type { ApiResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

const VALID_SOURCES = ['clawhub', 'url'] as const;

router.post('/:id/skills/install', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to install skills' } satisfies ApiResponse);
      return;
    }

    const { skillId, source } = req.body as { skillId: string; source: string };
    if (!skillId || typeof skillId !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing or invalid skillId' } satisfies ApiResponse);
      return;
    }
    if (!source || !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
      res.status(400).json({ ok: false, error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` } satisfies ApiResponse);
      return;
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.status(400).json({ ok: false, error: 'Agent type does not support skill installation' } satisfies ApiResponse);
      return;
    }

    const result = await adapter.translateRPC({
      method: 'skills.install',
      params: { skillId, source },
      endpoint: instance.controlEndpoint,
      token: instance.authToken,
      instanceId: instance.id,
    });

    res.json({ ok: true, data: result } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
