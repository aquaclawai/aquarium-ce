import { Router } from 'express';
import { getMetadata } from '../services/metadata-store.js';
import type { ApiResponse, ProviderGroup, ChannelOption } from '@aquarium/shared';

const router = Router();

router.get('/providers', (_req, res) => {
  const metadata = getMetadata();
  res.json({ ok: true, data: metadata.providers } satisfies ApiResponse<ProviderGroup[]>);
});

router.get('/channels', (_req, res) => {
  const metadata = getMetadata();
  res.json({ ok: true, data: metadata.channels } satisfies ApiResponse<ChannelOption[]>);
});

export default router;
