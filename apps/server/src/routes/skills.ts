import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import {
  getSkillsForInstance,
  installSkill,
  enableSkill,
  disableSkill,
  uninstallSkill,
} from '../services/skill-store.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { LockConflictError } from '../services/extension-lock.js';
import type {
  ApiResponse,
  InstanceSkill,
  SkillCatalogEntry,
  GatewayExtensionInfo,
  ExtensionSkillSource,
} from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── GET /:id/skills ──────────────────────────────────────────────────────────
// Returns managed skills from DB + gateway built-ins from RPC when running.

router.get('/:id/skills', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    // Managed skills from DB (always available)
    const managed: InstanceSkill[] = await getSkillsForInstance(instance.id);

    let gatewayBuiltins: GatewayExtensionInfo[] = [];

    if (instance.status === 'running' && instance.controlEndpoint) {
      // Fetch all skills known by gateway, separate out built-ins (not in DB)
      const managedIds = new Set(managed.map(s => s.skillId));
      const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
      try {
        const rawList = await rpc.call('skills.list', {}, 30_000);
        if (Array.isArray(rawList)) {
          for (const item of rawList) {
            if (typeof item !== 'object' || item === null) continue;
            const entry = item as Record<string, unknown>;
            // Gateway built-ins have source='bundled' and are not tracked in our DB
            if (entry.source === 'bundled' && typeof entry.id === 'string' && !managedIds.has(entry.id)) {
              gatewayBuiltins.push({
                id: entry.id as string,
                name: (entry.name as string) ?? entry.id as string,
                description: (entry.description as string) ?? '',
                version: (entry.version as string) ?? '0.0.0',
                source: 'bundled',
                enabled: Boolean(entry.enabled),
              });
            }
          }
        }
      } finally {
        rpc.close();
      }
    }

    res.json({
      ok: true,
      data: { managed, gatewayBuiltins },
    } satisfies ApiResponse<{ managed: InstanceSkill[]; gatewayBuiltins: GatewayExtensionInfo[] }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── GET /:id/skills/catalog ──────────────────────────────────────────────────
// Browse the full catalog of available skills from the gateway.

router.get('/:id/skills/catalog', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to browse skill catalog' } satisfies ApiResponse);
      return;
    }

    const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
    let rawList: unknown;
    try {
      rawList = await rpc.call('skills.list', {}, 30_000);
    } finally {
      rpc.close();
    }

    const catalog: SkillCatalogEntry[] = [];
    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        catalog.push({
          id: (entry.id as string) ?? '',
          slug: (entry.slug as string) ?? (entry.id as string) ?? '',
          name: (entry.name as string) ?? (entry.id as string) ?? '',
          description: (entry.description as string) ?? '',
          category: (entry.category as string) ?? 'general',
          source: (entry.source as 'bundled' | 'clawhub') ?? 'bundled',
          version: (entry.version as string) ?? '0.0.0',
          requiredCredentials: Array.isArray(entry.requiredCredentials) ? entry.requiredCredentials : [],
          requiredBinaries: Array.isArray(entry.requiredBinaries) ? entry.requiredBinaries : [],
          requiredEnvVars: Array.isArray(entry.requiredEnvVars) ? entry.requiredEnvVars : [],
        });
      }
    }

    res.json({ ok: true, data: catalog } satisfies ApiResponse<SkillCatalogEntry[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── POST /:id/skills/install ─────────────────────────────────────────────────
// Install a skill from a source (clawhub, url, etc.)

const VALID_SKILL_SOURCES = ['clawhub', 'url', 'bundled'] as const;

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

    const { skillId, source } = req.body as { skillId: unknown; source: unknown };
    if (!skillId || typeof skillId !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing or invalid skillId' } satisfies ApiResponse);
      return;
    }
    if (!source || typeof source !== 'object') {
      res.status(400).json({ ok: false, error: 'Missing or invalid source — must be an object with a type field' } satisfies ApiResponse);
      return;
    }

    const sourceObj = source as Record<string, unknown>;
    if (!sourceObj.type || !VALID_SKILL_SOURCES.includes(sourceObj.type as typeof VALID_SKILL_SOURCES[number])) {
      res.status(400).json({
        ok: false,
        error: `Invalid source.type. Must be one of: ${VALID_SKILL_SOURCES.join(', ')}`,
      } satisfies ApiResponse);
      return;
    }

    const skillSource = source as ExtensionSkillSource;

    const { skill, requiredCredentials } = await installSkill(
      instance.id,
      skillId,
      skillSource,
      instance.controlEndpoint,
      instance.authToken,
    );

    res.json({
      ok: true,
      data: { skill, requiredCredentials },
    } satisfies ApiResponse<{ skill: InstanceSkill; requiredCredentials: typeof requiredCredentials }>);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── PUT /:id/skills/:skillId ─────────────────────────────────────────────────
// Toggle enable/disable of an installed skill.

router.put('/:id/skills/:skillId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to update skills' } satisfies ApiResponse);
      return;
    }

    const { enabled } = req.body as { enabled: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'Missing or invalid enabled — must be a boolean' } satisfies ApiResponse);
      return;
    }

    const { skillId } = req.params;

    const skill = enabled
      ? await enableSkill(instance.id, skillId, instance.controlEndpoint, instance.authToken)
      : await disableSkill(instance.id, skillId, instance.controlEndpoint, instance.authToken);

    res.json({ ok: true, data: skill } satisfies ApiResponse<InstanceSkill>);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── DELETE /:id/skills/:skillId ──────────────────────────────────────────────
// Uninstall a skill from an instance.

router.delete('/:id/skills/:skillId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to uninstall skills' } satisfies ApiResponse);
      return;
    }

    const { skillId } = req.params;

    await uninstallSkill(instance.id, skillId, instance.controlEndpoint, instance.authToken);

    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
