// For OAuth-type credentials, see oauth-proxy.ts which handles browser redirect flow.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { addCredential } from '../services/credential-store.js';
import { acquireLock, releaseLock, LockConflictError } from '../services/extension-lock.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { db } from '../db/index.js';
import { createHash } from 'node:crypto';
import type { ApiResponse, ExtensionKind } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── POST /:id/extension-credentials ─────────────────────────────────────────
// Save an extension-scoped credential + inject it via config.patch RPC.

router.post('/:id/extension-credentials', async (req, res) => {
  const instanceId = req.params.id;

  const instance = await getInstance(instanceId, req.auth!.userId);
  if (!instance) {
    res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
    return;
  }

  if (instance.status !== 'running' || !instance.controlEndpoint) {
    res.status(400).json({ ok: false, error: 'Instance must be running to configure extension credentials' } satisfies ApiResponse);
    return;
  }

  const {
    provider,
    credentialType,
    value,
    extensionKind,
    extensionId,
    targetField,
    source,     // optional: 'vault' when credential comes from vault
    vaultPath,  // optional: vault path/key when source is 'vault'
  } = req.body as {
    provider: unknown;
    credentialType: unknown;
    value: unknown;
    extensionKind: unknown;
    extensionId: unknown;
    targetField: unknown;
    source: unknown;
    vaultPath: unknown;
  };

  if (!provider || typeof provider !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid provider' } satisfies ApiResponse);
    return;
  }
  if (!credentialType || typeof credentialType !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid credentialType' } satisfies ApiResponse);
    return;
  }
  if (!value || typeof value !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid value' } satisfies ApiResponse);
    return;
  }
  if (!extensionKind || (extensionKind !== 'skill' && extensionKind !== 'plugin')) {
    res.status(400).json({ ok: false, error: 'Missing or invalid extensionKind — must be "skill" or "plugin"' } satisfies ApiResponse);
    return;
  }
  if (!extensionId || typeof extensionId !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid extensionId' } satisfies ApiResponse);
    return;
  }
  if (!targetField || typeof targetField !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid targetField' } satisfies ApiResponse);
    return;
  }
  if (source !== undefined && source !== 'vault') {
    res.status(400).json({ ok: false, error: 'Invalid source — must be "vault" if provided' } satisfies ApiResponse);
    return;
  }
  if (source === 'vault' && (typeof vaultPath !== 'string' || vaultPath.length === 0)) {
    res.status(400).json({ ok: false, error: 'vaultPath is required when source is "vault"' } satisfies ApiResponse);
    return;
  }

  const validatedKind = extensionKind as ExtensionKind;
  const validatedProvider = provider;
  const validatedCredentialType = credentialType;
  const validatedValue = value;
  const validatedExtensionId = extensionId;
  const validatedTargetField = targetField;

  // Acquire per-instance mutation lock for 'configure' operation
  let lockHandle: { fencingToken: string; operationId: string } | null = null;
  try {
    lockHandle = await acquireLock(instanceId, 'configure', validatedExtensionId, validatedKind);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
    return;
  }

  let configPatched = false;

  try {
    // 1. Encrypt and persist the credential bound to this extension
    const credentialMetadata: Record<string, unknown> = {
      extensionKind: validatedKind,
      extensionId: validatedExtensionId,
      targetField: validatedTargetField,
    };
    // Persist vault source/vaultPath so adapter.ts seedConfig can resolve vault references
    if (source === 'vault' && typeof vaultPath === 'string' && vaultPath.length > 0) {
      credentialMetadata.source = 'vault';
      credentialMetadata.vaultPath = vaultPath;
    }
    await addCredential(
      instanceId,
      validatedProvider,
      validatedCredentialType,
      validatedValue,
      credentialMetadata,
    );

    // 2. Build the SecretRef payload and config.patch path
    // Hash is derived from "${extensionKind}_${extensionId}_${targetField}" for uniqueness
    const hash = createHash('sha256')
      .update(`${validatedKind}_${validatedExtensionId}_${validatedTargetField}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    const secretRefId = `AQUARIUM_CRED_${hash}`;
    const secretRef = { source: 'env', id: secretRefId };

    // Scoped namespace: skills use skills.entries.<id>.env.<field>
    //                   plugins use plugins.entries.<id>.config.<field>
    let configPath: string;
    if (validatedKind === 'skill') {
      configPath = `skills.entries.${validatedExtensionId}.env.${validatedTargetField}`;
    } else {
      configPath = `plugins.entries.${validatedExtensionId}.config.${validatedTargetField}`;
    }

    // 3. Inject credential into extension's scoped namespace via config.patch RPC (30s timeout)
    const rpc = new GatewayRPCClient(instance.controlEndpoint!, instance.authToken);
    try {
      await rpc.call('config.patch', { path: configPath, value: secretRef }, 30_000);
      configPatched = true;
    } catch (rpcErr: unknown) {
      const rpcMessage = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      console.warn(
        `[extension-credentials] config.patch failed for ${validatedKind} ${validatedExtensionId}: ${rpcMessage}. ` +
        `Credential stored but extension remains in 'installed' status.`
      );
      // Leave status as-is; return partial success below
    } finally {
      rpc.close();
    }

    // 4. If config.patch succeeded and this is a skill, promote from 'installed' → 'active'
    if (configPatched && validatedKind === 'skill') {
      await db('instance_skills')
        .where({
          instance_id: instanceId,
          skill_id: validatedExtensionId,
          status: 'installed',
        })
        .update({ status: 'active', updated_at: db.fn.now() });
    }

    await releaseLock(lockHandle.operationId, lockHandle.fencingToken, 'success');

    res.json({
      ok: true,
      data: { credentialStored: true, configPatched },
    } satisfies ApiResponse<{ credentialStored: boolean; configPatched: boolean }>);
  } catch (err: unknown) {
    // Release lock on any unexpected failure
    if (lockHandle) {
      await releaseLock(
        lockHandle.operationId,
        lockHandle.fencingToken,
        'failed',
        err instanceof Error ? err.message : String(err),
      ).catch(() => {});
    }

    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
