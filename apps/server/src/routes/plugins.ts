import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import {
  getPluginsForInstance,
  getPluginById,
  installPlugin,
  activatePlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from '../services/plugin-store.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { LockConflictError } from '../services/extension-lock.js';
import { evaluateTrustPolicy } from '../services/trust-store.js';
import { searchClawHub, getClawHubExtensionInfo } from '../services/marketplace-client.js';
import type {
  ApiResponse,
  InstancePlugin,
  PluginCatalogEntry,
  GatewayExtensionInfo,
  PluginSource,
  TrustTier,
  TrustDecision,
} from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── GET /:id/plugins ─────────────────────────────────────────────────────────
// Returns managed plugins from DB + gateway built-ins from RPC when running.

router.get('/:id/plugins', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    // Managed plugins from DB (always available)
    const managed: InstancePlugin[] = await getPluginsForInstance(instance.id);

    let gatewayBuiltins: GatewayExtensionInfo[] = [];

    if (instance.status === 'running' && instance.controlEndpoint) {
      // Fetch all plugins known by gateway, separate out built-ins (not in DB)
      const managedIds = new Set(managed.map(p => p.pluginId));
      const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
      try {
        const rawList = await rpc.call('plugins.list', {}, 30_000);
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
      } catch (rpcErr: unknown) {
        // Soft-log: older gateway versions may not support plugins.list
        console.warn(
          '[plugins] plugins.list RPC failed (older gateway?):',
          rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
        );
      } finally {
        rpc.close();
      }
    }

    res.json({
      ok: true,
      data: { managed, gatewayBuiltins },
    } satisfies ApiResponse<{ managed: InstancePlugin[]; gatewayBuiltins: GatewayExtensionInfo[] }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── GET /:id/plugins/catalog ─────────────────────────────────────────────────
// Browse the full catalog of available plugins from the gateway + ClawHub.
// IMPORTANT: This route MUST be defined BEFORE /:id/plugins/:pluginId so
// "catalog" is not matched as a pluginId parameter.

router.get('/:id/plugins/catalog', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to browse plugin catalog' } satisfies ApiResponse);
      return;
    }

    const { search, category, page: pageStr, limit: limitStr } = req.query as {
      search?: string;
      category?: string;
      page?: string;
      limit?: string;
    };

    const page = parseInt(pageStr ?? '0', 10) || 0;
    const limit = parseInt(limitStr ?? '20', 10) || 20;

    // 1. Fetch bundled catalog from gateway RPC
    const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
    let rawList: unknown;
    try {
      rawList = await rpc.call('plugins.list', {}, 30_000);
    } finally {
      rpc.close();
    }

    // 2. Build bundled catalog entries — bundled plugins are always allowed
    const bundledById = new Map<string, PluginCatalogEntry>();
    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        const entryId = (entry.id as string) ?? '';
        if (!entryId) continue;
        bundledById.set(entryId, {
          id: entryId,
          name: (entry.name as string) ?? entryId,
          description: (entry.description as string) ?? '',
          category: (entry.category as string) ?? 'general',
          source: (entry.source as 'bundled' | 'clawhub') ?? 'bundled',
          version: (entry.version as string) ?? '0.0.0',
          requiredCredentials: Array.isArray(entry.requiredCredentials) ? entry.requiredCredentials : [],
          capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
          trustTier: 'bundled' as TrustTier,
          trustDecision: 'allow' as TrustDecision,
          blockReason: undefined,
          trustSignals: undefined,
        });
      }
    }

    // 3. Fetch ClawHub results and evaluate trust per entry
    let hasMore = false;
    const clawHubEntries: PluginCatalogEntry[] = [];
    try {
      const clawHubResult = await searchClawHub(
        instance.controlEndpoint,
        instance.authToken,
        { query: search, category, kind: 'plugin', offset: page * limit, limit },
      );
      hasMore = clawHubResult.hasMore;

      for (const chEntry of clawHubResult.entries) {
        // Skip if bundled already has this id (bundled wins)
        if (bundledById.has(chEntry.id)) continue;

        const evaluation = await evaluateTrustPolicy(
          instance.id,
          chEntry.id,
          'plugin',
          { type: 'clawhub', spec: chEntry.id },
          chEntry.trustSignals,
        );

        clawHubEntries.push({
          id: chEntry.id,
          name: chEntry.name,
          description: chEntry.description,
          category: chEntry.category,
          source: 'clawhub',
          version: chEntry.version,
          requiredCredentials: chEntry.requiredCredentials,
          capabilities: chEntry.capabilities ?? [],
          trustSignals: chEntry.trustSignals,
          trustTier: evaluation.tier,
          trustDecision: evaluation.decision,
          blockReason: evaluation.blockReason ?? undefined,
        });
      }
    } catch (clawHubErr: unknown) {
      // Soft-log: ClawHub unavailable — return bundled results only
      console.warn(
        '[plugins] ClawHub catalog fetch failed (graceful degradation):',
        clawHubErr instanceof Error ? clawHubErr.message : String(clawHubErr),
      );
    }

    // 4. Merge: bundled first, then ClawHub (bundled wins on conflict — already filtered above)
    let catalog: PluginCatalogEntry[] = [...bundledById.values(), ...clawHubEntries];

    // 5. Apply optional search and category filters to bundled results
    // (ClawHub search was already filtered server-side via query params)
    if (search) {
      const searchLower = search.toLowerCase();
      catalog = catalog.filter(
        p =>
          p.source !== 'clawhub' &&
            (p.name.toLowerCase().includes(searchLower) || p.description.toLowerCase().includes(searchLower))
          || p.source === 'clawhub',
      );
    }
    if (category) {
      catalog = catalog.filter(p => p.source === 'clawhub' || p.category === category);
    }

    res.json({ ok: true, data: { catalog, hasMore } } satisfies ApiResponse<{ catalog: PluginCatalogEntry[]; hasMore: boolean }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── GET /:id/plugins/:pluginId ───────────────────────────────────────────────
// Single plugin read — used by RestartBanner polling to track operation status.
// No lock required — this is a read-only operation.

router.get('/:id/plugins/:pluginId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const plugin = await getPluginById(instance.id, pluginId);

    if (!plugin) {
      res.status(404).json({ ok: false, error: 'Plugin not found' } satisfies ApiResponse);
      return;
    }

    res.json({ ok: true, data: plugin } satisfies ApiResponse<InstancePlugin>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── POST /:id/plugins/install ────────────────────────────────────────────────
// Install a plugin artifact from a source (bundled, clawhub, npm).
// Server-side trust enforcement: non-bundled sources are checked via evaluateTrustPolicy.

const VALID_PLUGIN_SOURCE_TYPES = ['bundled', 'clawhub', 'npm'] as const;

router.post('/:id/plugins/install', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { pluginId, source } = req.body as { pluginId: unknown; source: unknown };

    if (!pluginId || typeof pluginId !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing or invalid pluginId' } satisfies ApiResponse);
      return;
    }
    if (!source || typeof source !== 'object') {
      res.status(400).json({ ok: false, error: 'Missing or invalid source — must be an object with a type field' } satisfies ApiResponse);
      return;
    }

    const sourceObj = source as Record<string, unknown>;
    if (!sourceObj.type || !VALID_PLUGIN_SOURCE_TYPES.includes(sourceObj.type as typeof VALID_PLUGIN_SOURCE_TYPES[number])) {
      res.status(400).json({
        ok: false,
        error: `Invalid source.type. Must be one of: ${VALID_PLUGIN_SOURCE_TYPES.join(', ')}`,
      } satisfies ApiResponse);
      return;
    }

    const pluginSource = source as PluginSource;
    const userId = req.auth!.userId;

    // (A) Server-side trust enforcement: block non-bundled installs that fail trust policy
    if (pluginSource.type !== 'bundled') {
      // Fetch ClawHub metadata for trust signals (soft-fails if unavailable)
      let clawHubInfo = null;
      if (instance.controlEndpoint) {
        clawHubInfo = await getClawHubExtensionInfo(
          instance.controlEndpoint,
          instance.authToken,
          pluginId,
          'plugin',
        );
      }
      const signals = clawHubInfo?.trustSignals ?? null;
      const evaluation = await evaluateTrustPolicy(instance.id, pluginId, 'plugin', pluginSource, signals);
      if (evaluation.decision === 'block') {
        res.status(403).json({
          ok: false,
          error: evaluation.blockReason ?? 'Extension blocked by trust policy',
        } satisfies ApiResponse);
        return;
      }
    }

    const { plugin, requiredCredentials } = await installPlugin(
      instance.id,
      pluginId,
      pluginSource,
      userId,
    );

    res.json({
      ok: true,
      data: { plugin, requiredCredentials },
    } satisfies ApiResponse<{ plugin: InstancePlugin; requiredCredentials: typeof requiredCredentials }>);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── POST /:id/plugins/:pluginId/activate ─────────────────────────────────────
// Activate an installed plugin (triggers gateway restart).

router.post('/:id/plugins/:pluginId/activate', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const userId = req.auth!.userId;

    const plugin = await activatePlugin(instance.id, pluginId, userId);

    res.json({ ok: true, data: plugin } satisfies ApiResponse<InstancePlugin>);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── PUT /:id/plugins/:pluginId/upgrade ───────────────────────────────────────
// Upgrade a plugin to the latest ClawHub version.
// Supports dryRun=true for version comparison without installing.
// IMPORTANT: Defined BEFORE /:id/plugins/:pluginId to prevent route capture.

router.put('/:id/plugins/:pluginId/upgrade', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running to upgrade plugins' } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const { dryRun } = req.body as { dryRun?: unknown };
    const isDryRun = dryRun === true;

    const plugin = await getPluginById(instance.id, pluginId);
    if (!plugin) {
      res.status(404).json({ ok: false, error: 'Plugin not found' } satisfies ApiResponse);
      return;
    }

    const allowedStatuses = ['active', 'installed', 'disabled'] as const;
    if (!allowedStatuses.includes(plugin.status as typeof allowedStatuses[number])) {
      res.status(400).json({
        ok: false,
        error: `Plugin "${pluginId}" cannot be upgraded from status "${plugin.status}"`,
      } satisfies ApiResponse);
      return;
    }

    // Fetch latest version info from ClawHub
    const clawHubInfo = await getClawHubExtensionInfo(
      instance.controlEndpoint,
      instance.authToken,
      pluginId,
      'plugin',
    );

    // No ClawHub info or already on latest
    if (!clawHubInfo || clawHubInfo.version === plugin.lockedVersion) {
      res.json({
        ok: true,
        data: { upToDate: true, currentVersion: plugin.lockedVersion },
      } satisfies ApiResponse<{ upToDate: boolean; currentVersion: string | null }>);
      return;
    }

    // dryRun: return version comparison without installing
    if (isDryRun) {
      res.json({
        ok: true,
        data: {
          upToDate: false,
          currentVersion: plugin.lockedVersion,
          newVersion: clawHubInfo.version,
        },
      } satisfies ApiResponse<{ upToDate: boolean; currentVersion: string | null; newVersion: string }>);
      return;
    }

    // Perform upgrade: install new version via RPC, update locked_version and integrity_hash
    const { db } = await import('../db/index.js');
    const { acquireLock, releaseLock } = await import('../services/extension-lock.js');
    const { getAdapter } = await import('../db/adapter.js');
    const { config } = await import('../config.js');

    const { fencingToken, operationId } = await acquireLock(instance.id, 'upgrade', pluginId, 'plugin');
    const previousVersion = plugin.lockedVersion;
    let upgradedPlugin: InstancePlugin | null = null;

    try {
      const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
      let installResult: unknown;
      try {
        installResult = await rpc.call(
          'plugins.install',
          { pluginId, source: plugin.source, version: clawHubInfo.version },
          300_000,
        );
      } finally {
        rpc.close();
      }

      // Update locked_version and integrity_hash
      const resultObj = (typeof installResult === 'object' && installResult !== null)
        ? installResult as Record<string, unknown>
        : {};
      const newIntegrityHash = typeof resultObj.integrityHash === 'string' ? resultObj.integrityHash : null;

      await db('instance_plugins')
        .where({ instance_id: instance.id, plugin_id: pluginId })
        .update({
          locked_version: clawHubInfo.version,
          integrity_hash: newIntegrityHash,
          updated_at: db.fn.now(),
        });

      upgradedPlugin = await getPluginById(instance.id, pluginId);
    } finally {
      await releaseLock(operationId, fencingToken, 'success');
    }

    // If plugin was active, trigger re-activation (restart with new version)
    if (plugin.status === 'active' && upgradedPlugin) {
      const userId = req.auth!.userId;
      try {
        await activatePlugin(instance.id, pluginId, userId);
        upgradedPlugin = await getPluginById(instance.id, pluginId);
      } catch (activateErr: unknown) {
        console.warn(
          `[plugins] upgrade restart failed for "${pluginId}":`,
          activateErr instanceof Error ? activateErr.message : String(activateErr),
        );
      }
    }

    res.json({
      ok: true,
      data: {
        upToDate: false,
        previousVersion,
        newVersion: clawHubInfo.version,
        plugin: upgradedPlugin,
      },
    } satisfies ApiResponse<{
      upToDate: boolean;
      previousVersion: string | null;
      newVersion: string;
      plugin: InstancePlugin | null;
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

// ─── PUT /:id/plugins/:pluginId ───────────────────────────────────────────────
// Toggle enable/disable of an installed plugin.

router.put('/:id/plugins/:pluginId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { enabled } = req.body as { enabled: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'Missing or invalid enabled — must be a boolean' } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const userId = req.auth!.userId;

    const plugin = enabled
      ? await enablePlugin(instance.id, pluginId, userId)
      : await disablePlugin(instance.id, pluginId, userId);

    res.json({ ok: true, data: plugin } satisfies ApiResponse<InstancePlugin>);
  } catch (err: unknown) {
    if (err instanceof LockConflictError) {
      res.status(409).json({ ok: false, error: err.message, activeOperation: err.activeOperation } as ApiResponse);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ─── DELETE /:id/plugins/:pluginId ────────────────────────────────────────────
// Uninstall a plugin from an instance.

router.delete('/:id/plugins/:pluginId', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { pluginId } = req.params;
    const userId = req.auth!.userId;

    await uninstallPlugin(instance.id, pluginId, userId);

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
