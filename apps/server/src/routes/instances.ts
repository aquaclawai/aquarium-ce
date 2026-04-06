import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  createInstance,
  cloneInstance,
  getInstance,
  listInstances,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  getInstanceEvents,
  patchGatewayConfig,
  verifyLiveStatus,
  updateSecurityProfile,
} from '../services/instance-manager.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import { getInstanceModels } from '../services/instance-models.js';
import type { ApiResponse, Instance, InstancePublic, CreateInstanceRequest, CredentialRequirement, SecurityProfile, InstanceModelsResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

function toPublic(instance: Instance): InstancePublic {
  return {
    id: instance.id,
    userId: instance.userId,
    name: instance.name,
    agentType: instance.agentType,
    imageTag: instance.imageTag,
    status: instance.status,
    statusMessage: instance.statusMessage,
    deploymentTarget: instance.deploymentTarget,
    securityProfile: instance.securityProfile,
    billingMode: instance.billingMode,
    avatar: instance.avatar,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

router.get('/', async (req, res) => {
  try {
    const instances = await listInstances(req.auth!.userId);
    const verified = await Promise.all(instances.map(verifyLiveStatus));
    res.json({ ok: true, data: verified.map(toPublic) } satisfies ApiResponse<InstancePublic[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const verified = await verifyLiveStatus(instance);
    res.json({ ok: true, data: verified } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body as CreateInstanceRequest;
    if (!body.name || !body.agentType) {
      res.status(400).json({ ok: false, error: 'Missing name or agentType' } satisfies ApiResponse);
      return;
    }

    const instance = await createInstance(req.auth!.userId, body);
    res.status(201).json({ ok: true, data: instance } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('unique') || message.includes('duplicate') ? 409 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const instance = await startInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: instance } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const instance = await stopInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: instance } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    const instance = await restartInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: instance } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/clone', async (req, res) => {
  try {
    const instance = await cloneInstance(req.params.id, req.auth!.userId);
    res.status(201).json({ ok: true, data: instance } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const purge = req.query.purge === 'true';
    await deleteInstance(req.params.id, req.auth!.userId, purge);
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id/events', async (req, res) => {
  try {
    const eventType = req.query.type as string | undefined;
    const events = await getInstanceEvents(req.params.id, req.auth!.userId, eventType);
    res.json({ ok: true, data: events } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// BACK-01: Retained as internal API — used by platform services (credential seeding, template instantiation)
// and the AssistantEditPage (principles, identity, agentName).
router.patch('/:id/config', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const body = req.body as Record<string, unknown>;

    // Remap AssistantEditPage fields to actual config keys:
    //   principles        → soulmd       (SOUL.md workspace file)
    //   identityDescription → identitymd (IDENTITY.md workspace file)
    //   agentName         → agentName    (config) + instances.name (column)
    const configPatch: Record<string, unknown> = { ...body };

    if ('principles' in configPatch) {
      configPatch.soulmd = configPatch.principles;
      delete configPatch.principles;
    }
    if ('identityDescription' in configPatch) {
      configPatch.identitymd = configPatch.identityDescription;
      delete configPatch.identityDescription;
    }

    if (typeof configPatch.agentName === 'string' && configPatch.agentName.trim()) {
      await db('instances')
        .where({ id: instance.id, user_id: req.auth!.userId })
        .update({ name: configPatch.agentName.trim(), updated_at: new Date() });
    }

    // patchGatewayConfig handles both DB persist (deep merge) and gateway push (config.patch RPC)
    await patchGatewayConfig(instance.id, req.auth!.userId, configPatch, 'Platform config update');
    const updated = await getInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: updated ?? undefined } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidation = message.startsWith('Config validation failed');
    const status = message.includes('not found') ? 404 : isValidation ? 400 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

const VALID_SECURITY_PROFILES: SecurityProfile[] = ['strict', 'standard', 'developer', 'unrestricted'];

router.patch('/:id/security-profile', async (req, res) => {
  try {
    const { securityProfile } = req.body as { securityProfile: string };
    if (!securityProfile || !VALID_SECURITY_PROFILES.includes(securityProfile as SecurityProfile)) {
      res.status(400).json({ ok: false, error: `Invalid security profile. Must be one of: ${VALID_SECURITY_PROFILES.join(', ')}` } satisfies ApiResponse);
      return;
    }

    const updated = await updateSecurityProfile(req.params.id, req.auth!.userId, securityProfile as SecurityProfile);
    res.json({ ok: true, data: updated } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (!instance.runtimeId) {
      res.json({ ok: true, data: { running: false, phase: instance.status } } satisfies ApiResponse);
      return;
    }

    const engine = getRuntimeEngine(instance.deploymentTarget);
    const status = await engine.getStatus(instance.runtimeId);
    res.json({ ok: true, data: status } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (!instance.runtimeId) {
      res.status(400).json({ ok: false, error: 'Instance has no runtime' } satisfies ApiResponse);
      return;
    }

    const engine = getRuntimeEngine(instance.deploymentTarget);
    const tailLines = parseInt(req.query.tail as string) || 100;
    const stream = await engine.streamLogs(instance.runtimeId, { tailLines, follow: false });

    res.setHeader('Content-Type', 'text/plain');
    stream.pipe(res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

interface TemplateRequirementsResponse {
  requirements: CredentialRequirement[];
  credentialStatus: Record<string, 'fulfilled' | 'missing'>;
}

router.get('/:id/template-requirements', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (!instance.templateId) {
      res.json({ ok: true, data: { requirements: [], credentialStatus: {} } } satisfies ApiResponse<TemplateRequirementsResponse>);
      return;
    }

    const template = await db('templates').where({ id: instance.templateId }).first();
    if (!template) {
      res.json({ ok: true, data: { requirements: [], credentialStatus: {} } } satisfies ApiResponse<TemplateRequirementsResponse>);
      return;
    }

    let requirements: CredentialRequirement[] = [];
    try {
      const raw = typeof template.required_credentials === 'string'
        ? JSON.parse(template.required_credentials)
        : template.required_credentials;
      if (Array.isArray(raw)) {
        requirements = raw as CredentialRequirement[];
      }
    } catch {
      // invalid JSON, treat as no requirements
    }

    const instanceCreds = await db('instance_credentials')
      .where({ instance_id: instance.id })
      .select('provider', 'credential_type');

    const existingKeys = new Set(
      instanceCreds.map((c: { provider: string; credential_type: string }) => `${c.provider}:${c.credential_type}`)
    );

    const credentialStatus: Record<string, 'fulfilled' | 'missing'> = {};
    for (const cred of requirements) {
      const key = `${cred.provider}:${cred.credentialType}`;
      credentialStatus[key] = existingKeys.has(key) ? 'fulfilled' : 'missing';
    }

    res.json({ ok: true, data: { requirements, credentialStatus } } satisfies ApiResponse<TemplateRequirementsResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── Vault Config Endpoints ────────────────────────────────────────────────────
// Vault configuration (1Password, HashiCorp Vault) is stored in instances.config
// JSON column under the 'vaultConfig' key.

interface VaultConfigBody {
  type: 'onepassword' | 'hashicorp';
  address?: string;
  namespace?: string;
  authMethod?: string;
  mountPath?: string;
}

router.get('/:id/vault-config', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const existingConfig = typeof instance.config === 'string'
      ? (JSON.parse(instance.config) as Record<string, unknown>)
      : ((instance.config ?? {}) as Record<string, unknown>);
    const vaultConfig = (existingConfig.vaultConfig ?? null) as VaultConfigBody | null;

    res.json({ ok: true, data: { vaultConfig } } satisfies ApiResponse<{ vaultConfig: VaultConfigBody | null }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.put('/:id/vault-config', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const body = req.body as VaultConfigBody;

    if (!body.type || (body.type !== 'onepassword' && body.type !== 'hashicorp')) {
      res.status(400).json({ ok: false, error: 'type is required and must be "onepassword" or "hashicorp"' } satisfies ApiResponse);
      return;
    }
    if (body.type === 'hashicorp' && !body.address) {
      res.status(400).json({ ok: false, error: 'address is required for HashiCorp Vault' } satisfies ApiResponse);
      return;
    }

    const validatedBody: VaultConfigBody = { type: body.type };
    if (body.address) validatedBody.address = body.address;
    if (body.namespace) validatedBody.namespace = body.namespace;
    if (body.authMethod) validatedBody.authMethod = body.authMethod;
    if (body.mountPath) validatedBody.mountPath = body.mountPath;

    const existingConfig = typeof instance.config === 'string'
      ? (JSON.parse(instance.config) as Record<string, unknown>)
      : ((instance.config ?? {}) as Record<string, unknown>);
    existingConfig.vaultConfig = validatedBody;

    await db('instances')
      .where({ id: instance.id, user_id: req.auth!.userId })
      .update({ config: JSON.stringify(existingConfig), updated_at: db.fn.now() });

    res.json({ ok: true, data: { vaultConfig: validatedBody } } satisfies ApiResponse<{ vaultConfig: VaultConfigBody }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.delete('/:id/vault-config', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const existingConfig = typeof instance.config === 'string'
      ? (JSON.parse(instance.config) as Record<string, unknown>)
      : ((instance.config ?? {}) as Record<string, unknown>);
    delete existingConfig.vaultConfig;

    await db('instances')
      .where({ id: instance.id, user_id: req.auth!.userId })
      .update({ config: JSON.stringify(existingConfig), updated_at: db.fn.now() });

    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

router.put('/:id/avatar', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { type, presetId, image } = req.body as { type: string; presetId?: string; image?: string };

    let avatarValue: string | null = null;

    if (type === 'preset') {
      if (!presetId || typeof presetId !== 'string') {
        res.status(400).json({ ok: false, error: 'Missing presetId for preset avatar' } satisfies ApiResponse);
        return;
      }
      avatarValue = `preset:${presetId}`;
    } else if (type === 'custom') {
      if (!image || typeof image !== 'string') {
        res.status(400).json({ ok: false, error: 'Missing image data for custom avatar' } satisfies ApiResponse);
        return;
      }
      if (image.length > MAX_AVATAR_SIZE) {
        res.status(400).json({ ok: false, error: 'Image exceeds 2MB limit' } satisfies ApiResponse);
        return;
      }
      avatarValue = image;
    } else if (type === 'remove') {
      avatarValue = null;
    } else {
      res.status(400).json({ ok: false, error: 'Invalid type. Must be "preset", "custom", or "remove"' } satisfies ApiResponse);
      return;
    }

    await db('instances')
      .where({ id: instance.id, user_id: req.auth!.userId })
      .update({ avatar: avatarValue, updated_at: new Date() });

    const updated = await getInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: updated ?? undefined } satisfies ApiResponse<Instance>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// --- Instance models (gateway catalog + credential status) ---

router.get('/:id/models', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
      return;
    }

    const data = await getInstanceModels(instance);
    res.json({ ok: true, data } satisfies ApiResponse<InstanceModelsResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
