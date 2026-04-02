import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { addCredential, listCredentials, deleteCredential } from '../services/credential-store.js';
import type { ApiResponse, Credential, AddCredentialRequest, CredentialType } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

function toPublicCredential(row: Record<string, unknown>): Credential {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    provider: row.provider as string,
    credentialType: row.credential_type as CredentialType,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

router.get('/:id/credentials', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const rows = await listCredentials(instance.id);
    res.json({ ok: true, data: rows.map(r => toPublicCredential(r as unknown as Record<string, unknown>)) } satisfies ApiResponse<Credential[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/credentials', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const body = req.body as AddCredentialRequest;
    if (!body.provider || !body.credentialType || !body.value) {
      res.status(400).json({ ok: false, error: 'Missing provider, credentialType, or value' } satisfies ApiResponse);
      return;
    }

    const row = await addCredential(instance.id, body.provider, body.credentialType, body.value, body.metadata, {
      userId: req.auth!.userId,
      source: 'api',
      ipAddress: req.ip,
    });
    res.status(201).json({ ok: true, data: toPublicCredential(row as unknown as Record<string, unknown>) } satisfies ApiResponse<Credential>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.delete('/:id/credentials/:credId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const deleted = await deleteCredential(req.params.credId, instance.id, {
      userId: req.auth!.userId,
      source: 'api',
      ipAddress: req.ip,
    });
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'Credential not found' } satisfies ApiResponse);
      return;
    }

    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
