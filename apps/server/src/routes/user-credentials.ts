import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listUserCredentials,
  addUserCredential,
  updateUserCredential,
  deleteUserCredential,
  updateCredentialStatus,
} from '../services/user-credential-store.js';
import type {
  ApiResponse,
  UserCredentialExtended,
  CredentialStatus,
  AddUserCredentialRequest,
  UpdateUserCredentialRequest,
} from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// GET / — list user credentials (extended with role/status/maskedValue)
router.get('/', async (req, res) => {
  try {
    const credentials = await listUserCredentials(req.auth!.userId);
    res.json({ ok: true, data: credentials } satisfies ApiResponse<UserCredentialExtended[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST / — add a credential to the user vault
router.post('/', async (req, res) => {
  try {
    const body = req.body as AddUserCredentialRequest;
    if (!body.provider || !body.credentialType || !body.value) {
      res.status(400).json({ ok: false, error: 'Missing provider, credentialType, or value' } satisfies ApiResponse);
      return;
    }

    const credential = await addUserCredential(
      req.auth!.userId,
      body.provider,
      body.credentialType,
      body.value,
      body.displayName,
      body.metadata,
      { source: 'api', ipAddress: req.ip ?? null },
    );
    res.status(201).json({ ok: true, data: credential } satisfies ApiResponse<UserCredentialExtended>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// PUT /:id — update a credential
router.put('/:id', async (req, res) => {
  try {
    const body = req.body as UpdateUserCredentialRequest;
    const credential = await updateUserCredential(req.params.id, req.auth!.userId, body, { source: 'api', ipAddress: req.ip ?? null });
    if (!credential) {
      res.status(404).json({ ok: false, error: 'Credential not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: credential } satisfies ApiResponse<UserCredentialExtended>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// PUT /:id/status — toggle credential active/disabled
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body as { status: CredentialStatus };
    if (!status || !['active', 'disabled'].includes(status)) {
      res.status(400).json({ ok: false, error: 'Invalid status. Must be "active" or "disabled".' } satisfies ApiResponse);
      return;
    }

    const credential = await updateCredentialStatus(
      req.params.id,
      req.auth!.userId,
      status,
      { source: 'api', ipAddress: req.ip ?? null },
    );
    if (!credential) {
      res.status(404).json({ ok: false, error: 'Credential not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: credential } satisfies ApiResponse<UserCredentialExtended>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// DELETE /:id — delete a credential
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteUserCredential(req.params.id, req.auth!.userId, { source: 'api', ipAddress: req.ip ?? null });
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
