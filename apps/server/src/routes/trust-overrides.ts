import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { createTrustOverride } from '../services/trust-store.js';
import type { ApiResponse, TrustOverride } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── PUT /:id/plugins/:pluginId/trust-override ────────────────────────────────
// Create or update an admin trust override for a community plugin.
// Requires credentialAccessAcknowledged=true — caller confirms the extension
// will have access to all instance credentials.

router.put('/:id/plugins/:pluginId/trust-override', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { action, reason, credentialAccessAcknowledged } = req.body as {
      action: unknown;
      reason: unknown;
      credentialAccessAcknowledged: unknown;
    };

    if (action !== 'allow') {
      res.status(400).json({ ok: false, error: "Invalid action — must be 'allow'" } satisfies ApiResponse);
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'Reason is required and must be a non-empty string' } satisfies ApiResponse);
      return;
    }

    if (credentialAccessAcknowledged !== true) {
      res.status(400).json({
        ok: false,
        error: 'Credential access acknowledgment is required. You must confirm that this community extension will have access to all credentials on this instance.',
      } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const userId = req.auth!.userId;

    const override = await createTrustOverride(
      instance.id,
      pluginId,
      'plugin',
      reason.trim(),
      userId,
      credentialAccessAcknowledged,
    );

    res.json({
      ok: true,
      data: { override, auditId: override.id },
    } satisfies ApiResponse<{ override: TrustOverride; auditId: string }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── PUT /:id/skills/:skillId/trust-override ──────────────────────────────────
// Create or update an admin trust override for a community skill.
// Requires credentialAccessAcknowledged=true.

router.put('/:id/skills/:skillId/trust-override', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { action, reason, credentialAccessAcknowledged } = req.body as {
      action: unknown;
      reason: unknown;
      credentialAccessAcknowledged: unknown;
    };

    if (action !== 'allow') {
      res.status(400).json({ ok: false, error: "Invalid action — must be 'allow'" } satisfies ApiResponse);
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'Reason is required and must be a non-empty string' } satisfies ApiResponse);
      return;
    }

    if (credentialAccessAcknowledged !== true) {
      res.status(400).json({
        ok: false,
        error: 'Credential access acknowledgment is required. You must confirm that this community extension will have access to all credentials on this instance.',
      } satisfies ApiResponse);
      return;
    }

    const { skillId } = req.params;
    const userId = req.auth!.userId;

    const override = await createTrustOverride(
      instance.id,
      skillId,
      'skill',
      reason.trim(),
      userId,
      credentialAccessAcknowledged,
    );

    res.json({
      ok: true,
      data: { override, auditId: override.id },
    } satisfies ApiResponse<{ override: TrustOverride; auditId: string }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
