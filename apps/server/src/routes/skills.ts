import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import {
  getSkillsForInstance,
  getSkillById,
  installSkill,
  enableSkill,
  disableSkill,
  uninstallSkill,
} from '../services/skill-store.js';
import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
import { LockConflictError } from '../services/extension-lock.js';
import { evaluateTrustPolicy } from '../services/trust-store.js';
import { getClawHubExtensionInfo } from '../services/marketplace-client.js';
import type {
  ApiResponse,
  InstanceSkill,
  SkillCatalogEntry,
  GatewayExtensionInfo,
  ExtensionSkillSource,
  TrustTier,
  TrustDecision,
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
      // Fetch gateway's native bundled skills via skills.status RPC
      const managedIds = new Set(managed.map(s => s.skillId));
      try {
        const rawResult = await gatewayCall(instance.id, 'skills.status', {}, 30_000) as Record<string, unknown> | null;
        const rawSkills = rawResult && Array.isArray(rawResult.skills) ? rawResult.skills : [];
        for (const item of rawSkills) {
          if (typeof item !== 'object' || item === null) continue;
          const entry = item as Record<string, unknown>;
          const entryId = (entry.name as string) ?? '';
          if (!entryId || managedIds.has(entryId)) continue;
          gatewayBuiltins.push({
            id: entryId,
            name: entryId,
            description: (entry.description as string) ?? '',
            version: (entry.version as string) || '',
            source: 'bundled',
            enabled: entry.eligible === true && entry.disabled !== true,
          });
        }
      } catch (rpcErr: unknown) {
        console.warn(
          '[skills] skills.status RPC failed:',
          rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
        );
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
// Browse the full catalog of available skills from the gateway + ClawHub.
// IMPORTANT: This route MUST be defined BEFORE /:id/skills/:skillId to prevent
// "catalog" from being matched as a skillId parameter.

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

    const { search, category, page: pageStr, limit: limitStr } = req.query as {
      search?: string;
      category?: string;
      page?: string;
      limit?: string;
    };

    // page/limit reserved for future ClawHub pagination
    void pageStr; void limitStr;

    // 1. Fetch bundled catalog from gateway RPC (skills.status returns { skills: [...] })
    let rawList: unknown[];
    try {
      const result = await gatewayCall(instance.id, 'skills.status', {}, 30_000) as Record<string, unknown> | null;
      rawList = result && Array.isArray(result.skills) ? result.skills : [];
    } catch (rpcErr: unknown) {
      console.warn(
        '[skills] skills.status RPC failed in catalog:',
        rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
      );
      rawList = [];
    }

    // 2. Build bundled catalog entries — bundled skills are always allowed
    const bundledById = new Map<string, SkillCatalogEntry>();
    if (rawList.length > 0) {
      for (const item of rawList) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        const entryId = (entry.name as string) ?? (entry.id as string) ?? '';
        if (!entryId) continue;
        const reqs = entry.requirements as Record<string, unknown> | undefined;
        bundledById.set(entryId, {
          id: entryId,
          slug: (entry.skillKey as string) ?? entryId,
          name: entryId,
          description: (entry.description as string) ?? '',
          category: (entry.category as string) ?? 'general',
          source: String(entry.source ?? '').startsWith('openclaw') ? 'bundled' as const : 'clawhub' as const,
          version: (entry.version as string) ?? '',
          requiredCredentials: Array.isArray(entry.requiredCredentials) ? entry.requiredCredentials : [],
          requiredBinaries: reqs && Array.isArray(reqs.bins) ? reqs.bins as string[] : [],
          requiredEnvVars: Array.isArray(entry.requiredEnvVars) ? entry.requiredEnvVars : [],
          trustTier: 'bundled' as TrustTier,
          trustDecision: 'allow' as TrustDecision,
          blockReason: undefined,
          trustSignals: undefined,
        });
      }
    }

    // 3. Fetch ClawHub results via gateway CLI (docker exec openclaw skills search --json)
    let hasMore = false;
    const clawHubEntries: SkillCatalogEntry[] = [];
    if (search) {
      try {
        const containerName = `${instance.agentType}-${instance.id.slice(0, 8)}`;
        const { execSync } = await import('node:child_process');
        const stdout = execSync(
          `docker exec ${containerName} openclaw skills search ${JSON.stringify(search)} --json`,
          { timeout: 15_000, encoding: 'utf-8' },
        );
        const parsed = JSON.parse(stdout) as { results?: unknown[] };
        const results = Array.isArray(parsed.results) ? parsed.results : [];

        for (const item of results) {
          if (typeof item !== 'object' || item === null) continue;
          const r = item as Record<string, unknown>;
          const slug = (r.slug as string) ?? '';
          if (!slug || bundledById.has(slug)) continue;

          clawHubEntries.push({
            id: slug,
            slug,
            name: (r.displayName as string) ?? slug,
            description: (r.summary as string) ?? '',
            category: 'clawhub',
            source: 'clawhub',
            version: (r.version as string) ?? '',
            requiredCredentials: [],
            requiredBinaries: [],
            requiredEnvVars: [],
            trustTier: 'community' as TrustTier,
            trustDecision: 'allow' as TrustDecision,
            blockReason: undefined,
            trustSignals: undefined,
          });
        }
      } catch (searchErr: unknown) {
        console.warn(
          '[skills] ClawHub search failed (graceful degradation):',
          searchErr instanceof Error ? searchErr.message : String(searchErr),
        );
      }
    }

    // 4. Merge: bundled first, then ClawHub (bundled wins on conflict — already filtered above)
    let catalog: SkillCatalogEntry[] = [...bundledById.values(), ...clawHubEntries];

    // 5. Apply optional search and category filters to bundled results
    // (ClawHub search was already filtered server-side via query params)
    if (search) {
      const searchLower = search.toLowerCase();
      catalog = catalog.filter(
        s =>
          s.source !== 'clawhub' &&
            (s.name.toLowerCase().includes(searchLower) || s.description.toLowerCase().includes(searchLower))
          || s.source === 'clawhub',
      );
    }
    if (category) {
      catalog = catalog.filter(s => s.source === 'clawhub' || s.category === category);
    }

    res.json({ ok: true, data: { catalog, hasMore } } satisfies ApiResponse<{ catalog: SkillCatalogEntry[]; hasMore: boolean }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── POST /:id/skills/install ─────────────────────────────────────────────────
// Install a skill from a source (clawhub, url, etc.)
// Server-side trust enforcement: non-bundled sources are checked via evaluateTrustPolicy.

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

    // (A) Server-side trust enforcement: block non-bundled installs that fail trust policy
    if (skillSource.type !== 'bundled') {
      // Fetch ClawHub metadata for trust signals (soft-fails if unavailable)
      const clawHubInfo = await getClawHubExtensionInfo(
        skillId,
        'skill',
      );
      const signals = clawHubInfo?.trustSignals ?? null;
      const evaluation = await evaluateTrustPolicy(instance.id, skillId, 'skill', skillSource, signals);
      if (evaluation.decision === 'block') {
        res.status(403).json({
          ok: false,
          error: evaluation.blockReason ?? 'Extension blocked by trust policy',
        } satisfies ApiResponse);
        return;
      }
    }

    const { skill, requiredCredentials } = await installSkill(
      instance.id,
      skillId,
      skillSource,
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

// ─── PUT /:id/skills/:skillId/upgrade ─────────────────────────────────────────
// Upgrade a skill to the latest ClawHub version.
// Supports dryRun=true for version comparison without installing.
// IMPORTANT: Defined BEFORE /:id/skills/:skillId to prevent route capture.

router.put('/:id/skills/:skillId/upgrade', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to upgrade skills' } satisfies ApiResponse);
      return;
    }

    const { skillId } = req.params;
    const { dryRun } = req.body as { dryRun?: unknown };
    const isDryRun = dryRun === true;

    const skill = await getSkillById(instance.id, skillId);
    if (!skill) {
      res.status(404).json({ ok: false, error: 'Skill not found' } satisfies ApiResponse);
      return;
    }

    const allowedStatuses = ['active', 'installed', 'disabled'] as const;
    if (!allowedStatuses.includes(skill.status as typeof allowedStatuses[number])) {
      res.status(400).json({
        ok: false,
        error: `Skill "${skillId}" cannot be upgraded from status "${skill.status}"`,
      } satisfies ApiResponse);
      return;
    }

    // Fetch latest version info from ClawHub
    const clawHubInfo = await getClawHubExtensionInfo(
      skillId,
      'skill',
    );

    // No ClawHub info or already on latest
    if (!clawHubInfo || clawHubInfo.version === skill.lockedVersion) {
      res.json({
        ok: true,
        data: { upToDate: true, currentVersion: skill.lockedVersion },
      } satisfies ApiResponse<{ upToDate: boolean; currentVersion: string | null }>);
      return;
    }

    // dryRun: return version comparison without installing
    if (isDryRun) {
      res.json({
        ok: true,
        data: {
          upToDate: false,
          currentVersion: skill.lockedVersion,
          newVersion: clawHubInfo.version,
        },
      } satisfies ApiResponse<{ upToDate: boolean; currentVersion: string | null; newVersion: string }>);
      return;
    }

    // Perform upgrade: install new version via RPC, update locked_version and integrity_hash
    const { db } = await import('../db/index.js');
    const { acquireLock, releaseLock } = await import('../services/extension-lock.js');

    const { fencingToken, operationId } = await acquireLock(instance.id, 'upgrade', skillId, 'skill');
    const previousVersion = skill.lockedVersion;
    let upgradedSkill: InstanceSkill | null = null;

    try {
      const installResult = await gatewayCall(
        instance.id,
        'skills.install',
        { source: 'clawhub', slug: skillId, version: clawHubInfo.version },
        300_000,
      );

      // Update locked_version and integrity_hash
      const resultObj = (typeof installResult === 'object' && installResult !== null)
        ? installResult as Record<string, unknown>
        : {};
      const newIntegrityHash = typeof resultObj.integrityHash === 'string' ? resultObj.integrityHash : null;

      await db('instance_skills')
        .where({ instance_id: instance.id, skill_id: skillId })
        .update({
          locked_version: clawHubInfo.version,
          integrity_hash: newIntegrityHash,
          updated_at: db.fn.now(),
        });

      upgradedSkill = await getSkillById(instance.id, skillId);
    } finally {
      await releaseLock(operationId, fencingToken, 'success');
    }

    // Skills do NOT require restart — no activation step needed

    res.json({
      ok: true,
      data: {
        upToDate: false,
        previousVersion,
        newVersion: clawHubInfo.version,
        skill: upgradedSkill,
      },
    } satisfies ApiResponse<{
      upToDate: boolean;
      previousVersion: string | null;
      newVersion: string;
      skill: InstanceSkill | null;
    }>);
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
      ? await enableSkill(instance.id, skillId, req.auth!.userId)
      : await disableSkill(instance.id, skillId, req.auth!.userId);

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

    await uninstallSkill(instance.id, skillId);

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
