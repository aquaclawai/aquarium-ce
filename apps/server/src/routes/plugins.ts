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
import type {
  ApiResponse,
  InstancePlugin,
  PluginCatalogEntry,
  GatewayExtensionInfo,
  PluginSource,
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
// Browse the full catalog of available plugins from the gateway.
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

    const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
    let rawList: unknown;
    try {
      rawList = await rpc.call('plugins.list', {}, 30_000);
    } finally {
      rpc.close();
    }

    const { search, category } = req.query as { search?: string; category?: string };

    let catalog: PluginCatalogEntry[] = [];
    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        catalog.push({
          id: (entry.id as string) ?? '',
          name: (entry.name as string) ?? (entry.id as string) ?? '',
          description: (entry.description as string) ?? '',
          category: (entry.category as string) ?? 'general',
          source: (entry.source as 'bundled' | 'clawhub') ?? 'bundled',
          version: (entry.version as string) ?? '0.0.0',
          requiredCredentials: Array.isArray(entry.requiredCredentials) ? entry.requiredCredentials : [],
          capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
        });
      }
    }

    // Apply optional search and category filters
    if (search) {
      const searchLower = search.toLowerCase();
      catalog = catalog.filter(
        p => p.name.toLowerCase().includes(searchLower) || p.description.toLowerCase().includes(searchLower),
      );
    }
    if (category) {
      catalog = catalog.filter(p => p.category === category);
    }

    res.json({ ok: true, data: catalog } satisfies ApiResponse<PluginCatalogEntry[]>);
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
