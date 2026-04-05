import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { config } from '../config.js';
import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
import { getInstance, patchGatewayConfig } from './instance-manager.js';
import { waitForReconnect } from './gateway-event-relay.js';
import {
  acquireLock,
  releaseLock,
  checkCancelRequested,
} from './extension-lock.js';
import { cacheArtifact } from './artifact-cache.js';
import type {
  InstancePlugin,
  PluginSource,
  ExtensionCredentialRequirement,
  ExtensionStatus,
} from '@aquarium/shared';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

function mapPluginRow(row: Record<string, unknown>): InstancePlugin {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    pluginId: row.plugin_id as string,
    source: adapter.parseJson<PluginSource>(row.source),
    version: (row.version as string | null) ?? null,
    lockedVersion: (row.locked_version as string | null) ?? null,
    integrityHash: (row.integrity_hash as string | null) ?? null,
    enabled: Boolean(row.enabled),
    config: adapter.parseJson<Record<string, unknown>>(row.config),
    status: row.status as ExtensionStatus,
    errorMessage: (row.error_message as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    pendingOwner: (row.pending_owner as string | null) ?? null,
    retryCount: (row.retry_count as number) ?? 0,
    installedAt: row.installed_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── RPC Response Types ───────────────────────────────────────────────────────

interface InstallPluginRPCResult {
  version?: string;
  integrityHash?: string;
  requiredCredentials?: ExtensionCredentialRequirement[];
}

function isInstallPluginRPCResult(val: unknown): val is InstallPluginRPCResult {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if ('requiredCredentials' in obj) {
    if (!Array.isArray(obj.requiredCredentials)) return false;
  }
  if ('version' in obj && obj.version !== undefined && typeof obj.version !== 'string') return false;
  if ('integrityHash' in obj && obj.integrityHash !== undefined && typeof obj.integrityHash !== 'string') return false;
  return true;
}

// ─── Config Merge-Patch Builders ─────────────────────────────────────────────

function buildPluginAddPatch(
  pluginId: string,
  pluginConfig: Record<string, unknown>,
  currentLoadPaths: string[],
): Record<string, unknown> {
  const loadPath = `/home/node/.openclaw/plugins/${pluginId}`;
  return {
    plugins: {
      entries: {
        [pluginId]: { enabled: true, ...pluginConfig },
      },
      load: {
        paths: currentLoadPaths.includes(loadPath)
          ? currentLoadPaths
          : [...currentLoadPaths, loadPath],
      },
    },
  };
}

function buildPluginRemovePatch(
  pluginId: string,
  currentLoadPaths: string[],
): Record<string, unknown> {
  const loadPath = `/home/node/.openclaw/plugins/${pluginId}`;
  return {
    plugins: {
      entries: {
        [pluginId]: null, // RFC 7396: null deletes the key
      },
      load: {
        paths: currentLoadPaths.filter(p => p !== loadPath),
      },
    },
  };
}

function buildPluginTogglePatch(
  pluginId: string,
  enabled: boolean,
  currentLoadPaths: string[],
): Record<string, unknown> {
  const loadPath = `/home/node/.openclaw/plugins/${pluginId}`;
  const patch: Record<string, unknown> = {
    plugins: {
      entries: {
        [pluginId]: { enabled },
      },
      load: {
        // When enabling, ensure load path is present. When disabling, keep load path
        // (plugin artifact stays on disk; enabled flag controls loading).
        paths: enabled && !currentLoadPaths.includes(loadPath)
          ? [...currentLoadPaths, loadPath]
          : currentLoadPaths,
      },
    },
  };
  return patch;
}

async function getCurrentLoadPaths(instanceId: string): Promise<string[]> {
  const cfgResult = await gatewayCall(instanceId, 'config.get', {}) as {
    config?: { plugins?: { load?: { paths?: string[] } } };
  } | null;
  return cfgResult?.config?.plugins?.load?.paths ?? [];
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Get all plugins installed on an instance, ordered newest first.
 */
export async function getPluginsForInstance(instanceId: string): Promise<InstancePlugin[]> {
  const rows = await db('instance_plugins')
    .where({ instance_id: instanceId })
    .orderBy('installed_at', 'desc')
    .select('*') as Array<Record<string, unknown>>;

  return rows.map(mapPluginRow);
}

/**
 * Get a single plugin by instance + plugin ID.
 */
export async function getPluginById(
  instanceId: string,
  pluginId: string,
): Promise<InstancePlugin | null> {
  const row = await db('instance_plugins')
    .where({ instance_id: instanceId, plugin_id: pluginId })
    .first() as Record<string, unknown> | undefined;

  return row ? mapPluginRow(row) : null;
}

/**
 * Internal: Activate a plugin within an existing lock hold.
 *
 * PLUG-06: Verifies artifact exists; reinstalls from lockedVersion if missing.
 * PLUG-07: On health check failure, rolls back config and marks plugin failed.
 *
 * Revised flow (gateway-first via config.patch):
 * 1. UPDATE status -> 'active' in DB
 * 2. config.patch to add plugin entry (triggers SIGUSR1 restart)
 * 3. waitForReconnect (syncGatewayState runs reconcileExtensions)
 * 4. ON SUCCESS: done (status already 'active')
 * 5. ON FAILURE: single rollback config.patch to remove entry
 */
async function _activatePluginWithLock(
  instanceId: string,
  pluginId: string,
  userId: string,
  fencingToken: string,
  operationId: string,
): Promise<InstancePlugin> {
  const adapter = getAdapter();

  // Read plugin row — verify status is installable
  const existing = await getPluginById(instanceId, pluginId);
  if (!existing) {
    throw new Error(`Plugin "${pluginId}" not found on instance ${instanceId}`);
  }
  if (existing.status !== 'installed' && existing.status !== 'pending') {
    throw new Error(
      `Plugin "${pluginId}" cannot be activated from status "${existing.status}" (must be installed or pending)`
    );
  }

  // PLUG-06: Verify artifact exists — if lockedVersion is set and artifact is missing, reinstall
  if (existing.lockedVersion) {
    const instance = await getInstance(instanceId, userId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);

    if (instance.controlEndpoint) {
      // Try a quick ping-style check. If plugins.install is needed, do it.
      // We reinstall proactively when lockedVersion is set, to ensure artifact is present.
      let reinstallResult: unknown;
      try {
        reinstallResult = await gatewayCall(
          instanceId,
          'plugins.install',
          { pluginId, source: existing.source, version: existing.lockedVersion },
          300_000,
        );
      } catch (reinstallErr: unknown) {
        // Reinstall failed — mark failed and re-throw
        await db('instance_plugins')
          .where({ instance_id: instanceId, plugin_id: pluginId })
          .update({
            status: 'failed',
            error_message: `Artifact reinstall failed: ${reinstallErr instanceof Error ? reinstallErr.message : String(reinstallErr)}`,
            failed_at: db.fn.now(),
            updated_at: db.fn.now(),
          });
        throw reinstallErr;
      }

      // TRUST-06: Integrity verification on reinstall
      // If existing row has an integrity_hash, verify the reinstalled artifact matches.
      if (existing.integrityHash !== null && isInstallPluginRPCResult(reinstallResult)) {
        const newHash = reinstallResult.integrityHash;
        if (
          newHash !== undefined &&
          newHash !== existing.integrityHash
        ) {
          const lockedVersion = existing.lockedVersion;
          const integrityError = `Integrity mismatch -- registry returned different artifact for v${lockedVersion}. Possible supply-chain tampering. Contact the extension publisher.`;
          await db('instance_plugins')
            .where({ instance_id: instanceId, plugin_id: pluginId })
            .update({
              status: 'failed',
              error_message: integrityError,
              failed_at: db.fn.now(),
              updated_at: db.fn.now(),
            });
          throw new Error(integrityError);
        }
      }
    }
  }

  // Check cancel before restart (long operation)
  if (await checkCancelRequested(operationId)) {
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .update({
        status: 'failed',
        error_message: 'Cancelled before activation',
        failed_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    throw new Error('Operation cancelled before activation');
  }

  // DB-first: update status to 'active' so seedConfig picks up the plugin on restart
  await db('instance_plugins')
    .where({ instance_id: instanceId, plugin_id: pluginId })
    .update({
      status: 'active',
      enabled: 1,
      pending_owner: null,
      updated_at: db.fn.now(),
    });

  // Get current load paths from gateway for merge-patch
  const currentLoadPaths = await getCurrentLoadPaths(instanceId);
  const pluginConfig = existing.config || {};
  const patch = buildPluginAddPatch(pluginId, pluginConfig, currentLoadPaths);

  // Gateway-first config.patch (triggers SIGUSR1 restart)
  await patchGatewayConfig(instanceId, userId, patch, `Activate plugin: ${pluginId}`);

  // Wait for gateway restart + reconnect + syncGatewayState (includes reconcileExtensions)
  await waitForReconnect(instanceId, 60_000);

  // Verify: re-read DB status (reconcileExtensions may have demoted to 'failed')
  const updatedPlugin = await getPluginById(instanceId, pluginId);
  if (updatedPlugin?.status === 'failed') {
    // EXT-05: Single rollback config.patch to remove the failed entry
    try {
      const rollbackPatch = buildPluginRemovePatch(pluginId, currentLoadPaths);
      await patchGatewayConfig(instanceId, userId, rollbackPatch, `Rollback plugin: ${pluginId}`);
      await waitForReconnect(instanceId, 60_000);
    } catch (rollbackErr: unknown) {
      // Rollback failed (rate limit, network error) -- mark failed, user retries manually
      console.error(`[plugin-store] Rollback config.patch failed for ${pluginId} on ${instanceId}:`, rollbackErr);
    }
    await releaseLock(operationId, fencingToken, 'rolled-back', updatedPlugin.errorMessage ?? 'Plugin failed to load');
    throw new Error(`Plugin activation failed and was rolled back: ${updatedPlugin.errorMessage ?? 'Plugin not found in gateway after restart'}`);
  }

  const plugin = await getPluginById(instanceId, pluginId);
  return plugin!;
}

/**
 * Install a plugin on an instance.
 *
 * Flow (PLUG-02, PLUG-03):
 * 1. Acquire per-instance mutation lock
 * 2. INSERT a pending record
 * 3. checkCancelRequested before long npm install
 * 4. Call plugins.install RPC (5-min deadline per INFRA-07) — stages artifact on disk, no config change
 * 5. Parse response for version, requiredCredentials
 * 6. If no requiredCredentials → auto-activate within same lock hold (PLUG-03)
 *    If requiredCredentials → leave at 'installed', return credential requirements
 * 7. Release lock (always, via finally)
 */
export async function installPlugin(
  instanceId: string,
  pluginId: string,
  source: PluginSource,
  userId: string,
): Promise<{ plugin: InstancePlugin; requiredCredentials: ExtensionCredentialRequirement[] }> {
  const adapter = getAdapter();

  const instance = await getInstance(instanceId, userId);
  if (!instance) throw new Error(`Instance ${instanceId} not found`);

  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'install',
    pluginId,
    'plugin',
  );

  const rowId = adapter.generateId();

  try {
    // 1. Insert pending record
    await db('instance_plugins').insert({
      id: rowId,
      instance_id: instanceId,
      plugin_id: pluginId,
      source: adapter.jsonValue(source),
      version: null,
      locked_version: null,
      integrity_hash: null,
      enabled: 1,
      config: adapter.jsonValue({}),
      status: 'pending',
      error_message: null,
      failed_at: null,
      pending_owner: config.serverSessionId,
      retry_count: 0,
      // installed_at / updated_at use column defaults
    });

    // 2. Check cancel before long npm install
    if (await checkCancelRequested(operationId)) {
      await db('instance_plugins')
        .where({ instance_id: instanceId, plugin_id: pluginId })
        .update({
          status: 'failed',
          error_message: 'Cancelled before install RPC',
          updated_at: db.fn.now(),
        });
      await releaseLock(operationId, fencingToken, 'cancelled');
      const plugin = await getPluginById(instanceId, pluginId);
      return { plugin: plugin!, requiredCredentials: [] };
    }

    // 3. Call gateway RPC: plugins.install (5-min deadline per INFRA-07)
    // This stages the artifact on disk — does NOT touch gateway config
    let rpcResult: unknown;
    if (instance.controlEndpoint) {
      rpcResult = await gatewayCall(
        instance.id,
        'plugins.install',
        { pluginId, source },
        300_000,
      );
    }

    // 4. Parse response
    if (rpcResult !== undefined && !isInstallPluginRPCResult(rpcResult)) {
      throw new Error(`Unexpected plugins.install RPC response: ${JSON.stringify(rpcResult)}`);
    }

    const result = rpcResult as InstallPluginRPCResult | undefined;
    const requiredCredentials: ExtensionCredentialRequirement[] =
      result?.requiredCredentials ?? [];
    const version = result?.version ?? null;
    const integrityHash = result?.integrityHash ?? null;

    // TRUST-05: Pin locked_version and integrity_hash from RPC response
    if (version) {
      const versionUpdate: Record<string, unknown> = {
        version,
        locked_version: version,
        updated_at: db.fn.now(),
      };
      if (integrityHash !== null) {
        versionUpdate.integrity_hash = integrityHash;
      }
      await db('instance_plugins')
        .where({ instance_id: instanceId, plugin_id: pluginId })
        .update(versionUpdate);
    }

    // OFFLINE-01: Cache artifact for offline rebuild (fire-and-forget)
    if (version && source.type !== 'bundled' && instance.runtimeId) {
      // Cache failure must never block install — fire-and-forget
      cacheArtifact('plugin', pluginId, version, instance.runtimeId, instance.deploymentTarget).catch(() => {});
    }

    // 5. PLUG-03: No credentials needed → auto-activate within same lock hold
    if (requiredCredentials.length === 0) {
      // Update status to 'installed' so _activatePluginWithLock accepts it
      await db('instance_plugins')
        .where({ instance_id: instanceId, plugin_id: pluginId })
        .update({ status: 'installed', updated_at: db.fn.now() });

      // Activate within same lock hold (passes existing operationId/fencingToken)
      const plugin = await _activatePluginWithLock(
        instanceId,
        pluginId,
        userId,
        fencingToken,
        operationId,
      );

      // releaseLock called inside _activatePluginWithLock on rollback path;
      // call it here on success path
      await releaseLock(operationId, fencingToken, 'success');
      return { plugin, requiredCredentials: [] };
    }

    // Credentials needed → leave at 'installed', clear pending_owner
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .update({
        status: 'installed',
        pending_owner: null,
        updated_at: db.fn.now(),
      });

    await releaseLock(operationId, fencingToken, 'success');

    const plugin = await getPluginById(instanceId, pluginId);
    return { plugin: plugin!, requiredCredentials };
  } catch (err: unknown) {
    // On failure: mark failed and release lock
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
        failed_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .catch(() => {}); // best-effort

    await releaseLock(
      operationId,
      fencingToken,
      'failed',
      err instanceof Error ? err.message : String(err),
    );

    throw err;
  }
}

/**
 * Activate a plugin that has been installed but not yet active.
 * Requires plugin status to be 'installed' (credentials have been supplied).
 *
 * Flow (PLUG-06, PLUG-07):
 * - Acquire lock, delegate to _activatePluginWithLock, release lock
 */
export async function activatePlugin(
  instanceId: string,
  pluginId: string,
  userId: string,
): Promise<InstancePlugin> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'activate',
    pluginId,
    'plugin',
  );

  try {
    const plugin = await _activatePluginWithLock(
      instanceId,
      pluginId,
      userId,
      fencingToken,
      operationId,
    );

    // If _activatePluginWithLock didn't throw, activation succeeded
    await releaseLock(operationId, fencingToken, 'success');
    return plugin;
  } catch (err: unknown) {
    // If _activatePluginWithLock threw after releaseLock (rollback path), this is a no-op
    await releaseLock(
      operationId,
      fencingToken,
      'failed',
      err instanceof Error ? err.message : String(err),
    ).catch(() => {}); // no-op if already released in rollback

    throw err;
  }
}

/**
 * Enable a previously disabled plugin.
 * Updates DB and sends config.patch to toggle the plugin on.
 */
export async function enablePlugin(
  instanceId: string,
  pluginId: string,
  userId: string,
): Promise<InstancePlugin> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'enable',
    pluginId,
    'plugin',
  );

  try {
    const existing = await getPluginById(instanceId, pluginId);
    if (!existing) {
      throw new Error(`Plugin "${pluginId}" not found on instance ${instanceId}`);
    }
    if (existing.status !== 'disabled') {
      throw new Error(
        `Plugin "${pluginId}" is not disabled (current status: ${existing.status})`
      );
    }

    // Check cancel before restart
    if (await checkCancelRequested(operationId)) {
      await releaseLock(operationId, fencingToken, 'cancelled');
      return existing;
    }

    // DB-first: update so seedConfig picks up the enabled plugin
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .update({ enabled: 1, status: 'active', updated_at: db.fn.now() });

    // Config.patch: toggle enabled flag in gateway config
    const currentLoadPaths = await getCurrentLoadPaths(instanceId);
    const patch = buildPluginTogglePatch(pluginId, true, currentLoadPaths);
    await patchGatewayConfig(instanceId, userId, patch, `Enable plugin: ${pluginId}`);
    // Plugin enable triggers SIGUSR1 -- wait for reconnect + reconciliation
    await waitForReconnect(instanceId, 60_000);

    await releaseLock(operationId, fencingToken, 'success');

    const plugin = await getPluginById(instanceId, pluginId);
    return plugin!;
  } catch (err: unknown) {
    await releaseLock(
      operationId,
      fencingToken,
      'failed',
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Disable an active plugin.
 * Updates DB and sends config.patch to toggle the plugin off.
 */
export async function disablePlugin(
  instanceId: string,
  pluginId: string,
  userId: string,
): Promise<InstancePlugin> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'disable',
    pluginId,
    'plugin',
  );

  try {
    const existing = await getPluginById(instanceId, pluginId);
    if (!existing) {
      throw new Error(`Plugin "${pluginId}" not found on instance ${instanceId}`);
    }
    if (existing.status !== 'active' && existing.status !== 'degraded') {
      throw new Error(
        `Plugin "${pluginId}" cannot be disabled from status "${existing.status}" (must be active or degraded)`
      );
    }

    // Check cancel before restart
    if (await checkCancelRequested(operationId)) {
      await releaseLock(operationId, fencingToken, 'cancelled');
      return existing;
    }

    // DB-first: update so reconciliation sees disabled status
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .update({ enabled: 0, status: 'disabled', updated_at: db.fn.now() });

    // Config.patch: toggle enabled flag off in gateway config
    const currentLoadPaths = await getCurrentLoadPaths(instanceId);
    const patch = buildPluginTogglePatch(pluginId, false, currentLoadPaths);
    await patchGatewayConfig(instanceId, userId, patch, `Disable plugin: ${pluginId}`);
    // Plugin disable triggers SIGUSR1 -- wait for reconnect + reconciliation
    await waitForReconnect(instanceId, 60_000);

    await releaseLock(operationId, fencingToken, 'success');

    const plugin = await getPluginById(instanceId, pluginId);
    return plugin!;
  } catch (err: unknown) {
    await releaseLock(
      operationId,
      fencingToken,
      'failed',
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Uninstall a plugin from an instance.
 * Deletes the DB row and sends config.patch to remove the plugin from gateway config.
 */
export async function uninstallPlugin(
  instanceId: string,
  pluginId: string,
  userId: string,
): Promise<void> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'uninstall',
    pluginId,
    'plugin',
  );

  try {
    const existing = await getPluginById(instanceId, pluginId);
    if (!existing) {
      throw new Error(`Plugin "${pluginId}" not found on instance ${instanceId}`);
    }

    // Check cancel before long operation
    if (await checkCancelRequested(operationId)) {
      await releaseLock(operationId, fencingToken, 'cancelled');
      return;
    }

    // Get current load paths BEFORE delete for merge-patch building
    const currentLoadPaths = await getCurrentLoadPaths(instanceId);

    // Delete from DB
    await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: pluginId })
      .delete();

    // Remove plugin from gateway config via config.patch
    const patch = buildPluginRemovePatch(pluginId, currentLoadPaths);
    await patchGatewayConfig(instanceId, userId, patch, `Uninstall plugin: ${pluginId}`);
    // Plugin removal triggers SIGUSR1 -- wait for reconnect
    await waitForReconnect(instanceId, 60_000);

    await releaseLock(operationId, fencingToken, 'success');
  } catch (err: unknown) {
    await releaseLock(
      operationId,
      fencingToken,
      'failed',
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Update a plugin's status directly (no lock required).
 * Used internally by reconciliation processes — not for user-initiated mutations.
 */
export async function updatePluginStatus(
  instanceId: string,
  pluginId: string,
  status: ExtensionStatus,
  errorMessage?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: db.fn.now(),
  };

  if (errorMessage !== undefined) {
    update.error_message = errorMessage;
  }

  if (status === 'failed') {
    update.failed_at = db.fn.now();
  }

  await db('instance_plugins')
    .where({ instance_id: instanceId, plugin_id: pluginId })
    .update(update);
}
