import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getConfig, updateConfig, generateApiKey } from '../services/system-config.js';
import { reloadDynamicMiddleware } from '../middleware/dynamic-middleware.js';
import type { ApiResponse, SystemConfig, PlatformApiKey } from '@aquarium/shared';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await getConfig();
    res.json({ ok: true, data: config } satisfies ApiResponse<SystemConfig>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load config';
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse<never>);
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const settings = req.body as Partial<SystemConfig>;
    const config = await updateConfig(settings);
    await reloadDynamicMiddleware();
    res.json({ ok: true, data: config } satisfies ApiResponse<SystemConfig>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update config';
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse<never>);
  }
});

router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'Key name is required' } satisfies ApiResponse<never>);
      return;
    }

    const { key, prefix } = generateApiKey();
    const newKey: PlatformApiKey = {
      id: randomUUID(),
      name: name.trim(),
      prefix,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    const cfg = await getConfig();
    const existingKeys = cfg.apiKeys ?? [];
    await updateConfig({ apiKeys: [...existingKeys, newKey] });

    res.json({ ok: true, data: { ...newKey, fullKey: key } } satisfies ApiResponse<PlatformApiKey & { fullKey: string }>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create API key';
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse<never>);
  }
});

router.delete('/api-keys/:keyId', async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;
    const cfg = await getConfig();
    const existingKeys = cfg.apiKeys ?? [];
    const filtered = existingKeys.filter(k => k.id !== keyId);

    if (filtered.length === existingKeys.length) {
      res.status(404).json({ ok: false, error: 'API key not found' } satisfies ApiResponse<never>);
      return;
    }

    await updateConfig({ apiKeys: filtered });
    res.json({ ok: true } satisfies ApiResponse<never>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revoke API key';
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse<never>);
  }
});

export default router;
