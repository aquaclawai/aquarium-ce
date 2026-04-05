import { db } from '../db/index.js';
import {
  gatewayCall,
  extractPluginPresence,
  extractPluginConfigEntries,
} from '../agent-types/openclaw/gateway-rpc.js';
import type { PluginPresenceInfo, PluginConfigEntry } from '../agent-types/openclaw/gateway-rpc.js';
import { cleanupOrphanedOperations } from './extension-lock.js';
import { getSkillsForInstance, updateSkillStatus, installSkill } from './skill-store.js';
import { getPluginsForInstance, updatePluginStatus, installPlugin } from './plugin-store.js';
import { isArtifactCached, getCachedArtifactPath } from './artifact-cache.js';
import type { InstanceSkill, InstancePlugin, DeploymentTarget } from '@aquarium/shared';

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Retrieve runtimeId and deploymentTarget for an instance without importing
 * getInstance (avoids circular dependency with instance-manager).
 */
async function getInstanceRuntimeInfo(
  instanceId: string,
): Promise<{ runtimeId: string; deploymentTarget: DeploymentTarget } | null> {
  const row = await db('instances')
    .where({ id: instanceId })
    .select('runtime_id', 'deployment_target')
    .first() as Record<string, unknown> | undefined;
  if (!row?.runtime_id) return null;
  return {
    runtimeId: row.runtime_id as string,
    deploymentTarget: ((row.deployment_target as string | undefined) as DeploymentTarget | undefined) ?? 'docker',
  };
}

// ─── RPC Response Types ───────────────────────────────────────────────────────

interface GatewaySkillInfo {
  name: string;
  skillKey?: string;
  status?: string;
  [key: string]: unknown;
}

interface SkillsListResult {
  skills?: GatewaySkillInfo[];
  [key: string]: unknown;
}

function isSkillsListResult(val: unknown): val is SkillsListResult {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if ('skills' in obj) {
    return Array.isArray(obj.skills);
  }
  return true; // no skills key = empty list
}

interface GatewayPluginInfo {
  pluginId: string;
  id?: string; // some gateway versions use 'id' instead of 'pluginId'
  status?: string;
  [key: string]: unknown;
}

interface PluginsListResult {
  plugins?: GatewayPluginInfo[];
  [key: string]: unknown;
}

function isPluginsListResult(val: unknown): val is PluginsListResult {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if ('plugins' in obj) {
    return Array.isArray(obj.plugins);
  }
  return true; // no plugins key = empty list
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Recover orphaned operations and pending extensions from previous crashed sessions.
 * Called once on server startup, before any instances start.
 *
 * - Marks stale-session operations as crashed (via cleanupOrphanedOperations)
 * - Counts skills stuck in 'pending' from other sessions (left for Phase 2 reconciliation)
 */
export async function recoverOrphanedOperations(): Promise<void> {
  const crashedCount = await cleanupOrphanedOperations();
  if (crashedCount > 0) {
    console.log(`[extension-lifecycle] Marked ${crashedCount} orphaned operation(s) as crashed`);
  }

  // Count pending skills from other sessions — these will be reconciled in Phase 2
  // or replayed in Phase 3. We intentionally leave them as 'pending'.
  const orphanedPendingSkills = await db('instance_skills')
    .whereNotNull('pending_owner')
    .where('status', 'pending')
    .count('* as cnt')
    .first() as Record<string, unknown> | undefined;

  const orphanedSkillCount = Number(orphanedPendingSkills?.cnt ?? 0);
  if (orphanedSkillCount > 0) {
    console.log(
      `[extension-lifecycle] Found ${orphanedSkillCount} pending skill(s) from previous sessions — will reconcile on instance boot`
    );
  }

  // Count pending plugins from other sessions — same reconciliation pattern
  const orphanedPendingPlugins = await db('instance_plugins')
    .whereNotNull('pending_owner')
    .where('status', 'pending')
    .count('* as cnt')
    .first() as Record<string, unknown> | undefined;

  const orphanedPluginCount = Number(orphanedPendingPlugins?.cnt ?? 0);
  if (orphanedPluginCount > 0) {
    console.log(
      `[extension-lifecycle] Found ${orphanedPluginCount} pending plugin(s) from previous sessions — will reconcile on instance boot`
    );
  }
}

/**
 * Phase 2 reconciliation: compare gateway skills.status with DB state and
 * promote/demote skills accordingly.
 *
 * Called after the gateway boots successfully (health check passed).
 * Non-blocking — caller should catch errors and continue instance boot.
 *
 * Rules:
 * - active/degraded in DB + present in gateway  → confirmed healthy (promote degraded to active)
 * - active in DB + absent from gateway          → mark failed ("Extension not found after restart")
 * - degraded in DB + absent from gateway        → mark failed ("Extension not recovered after restart")
 * - pending in DB + present in gateway          → promote to active (completed before crash)
 * - pending in DB + absent from gateway         → leave pending for Phase 3 replay
 * - installed/disabled/failed                   → no change
 * - gateway-only (not in DB)                    → skip (returned as gatewayBuiltins by GET /skills)
 */
export async function reconcileExtensions(
  instanceId: string,
  controlEndpoint: string,
  authToken: string,
): Promise<{ promoted: string[]; demoted: string[]; unchanged: string[] }> {
  const promoted: string[] = [];
  const demoted: string[] = [];
  const unchanged: string[] = [];

  // Fetch current gateway skill state via skills.status
  let skillsRpcResult: unknown;
  try {
    skillsRpcResult = await gatewayCall(instanceId, 'skills.status', {}, 15_000);
  } catch (skillListErr: unknown) {
    // skills.status may fail if gateway is in a degraded state — log and skip
    console.warn(
      `[extension-lifecycle] skills.status RPC failed for ${instanceId}:`,
      skillListErr,
    );
    skillsRpcResult = undefined;
  }

  if (skillsRpcResult !== undefined) {
    if (!isSkillsListResult(skillsRpcResult)) {
      console.warn(
        `[extension-lifecycle] Unexpected skills.status RPC response for ${instanceId}: ${JSON.stringify(skillsRpcResult)}`
      );
    } else {
      // Build gateway skills map: name -> gatewaySkillInfo
      const gatewaySkills = new Map<string, GatewaySkillInfo>();
      for (const skill of skillsRpcResult.skills ?? []) {
        if (skill.name) {
          gatewaySkills.set(skill.name, skill);
        }
      }

      // Fetch DB skill state
      const dbSkills = await getSkillsForInstance(instanceId);

      for (const dbSkill of dbSkills) {
        const { skillId, status } = dbSkill;
        const inGateway = gatewaySkills.has(skillId);

        if (status === 'active' && inGateway) {
          // Confirmed healthy — no change
          unchanged.push(skillId);
        } else if (status === 'degraded' && inGateway) {
          // Was degraded but recovered — promote to active
          await updateSkillStatus(instanceId, skillId, 'active');
          promoted.push(skillId);
        } else if (status === 'active' && !inGateway) {
          // Active in DB but missing from gateway — mark failed
          await updateSkillStatus(
            instanceId,
            skillId,
            'failed',
            'Extension not found in gateway after restart',
          );
          demoted.push(skillId);
        } else if (status === 'degraded' && !inGateway) {
          // Degraded in DB and still absent — mark failed
          await updateSkillStatus(
            instanceId,
            skillId,
            'failed',
            'Extension not recovered after restart',
          );
          demoted.push(skillId);
        } else if (status === 'pending' && inGateway) {
          // Install completed before the crash — promote to active and clear pending_owner
          await db('instance_skills')
            .where({ instance_id: instanceId, skill_id: skillId })
            .update({
              status: 'active',
              pending_owner: null,
              updated_at: db.fn.now(),
            });
          promoted.push(skillId);
        } else if (status === 'pending' && !inGateway) {
          // Install was in-flight when server crashed — leave pending for Phase 3 replay
          unchanged.push(skillId);
        } else {
          // installed / disabled / failed — no reconciliation needed
          unchanged.push(skillId);
        }
      }
    }
  }

  // ── Plugin reconciliation ──────────────────────────────────────────────────
  // Fetch current gateway plugin state via tools.catalog + config.get
  let pluginPresenceMap = new Map<string, PluginPresenceInfo>();
  let pluginConfigMap = new Map<string, PluginConfigEntry>();
  try {
    const [catalogResult, configResult] = await Promise.all([
      gatewayCall(instanceId, 'tools.catalog', {}, 30_000),
      gatewayCall(instanceId, 'config.get', {}, 30_000),
    ]);
    pluginPresenceMap = extractPluginPresence(catalogResult);
    pluginConfigMap = extractPluginConfigEntries(configResult);
  } catch (err) {
    console.warn(
      `[extension-lifecycle] tools.catalog/config.get RPC failed for ${instanceId}:`,
      (err as Error).message,
    );
    // Continue with empty maps — graceful degradation
  }

  // Only reconcile if we got data from at least one source
  if (pluginPresenceMap.size > 0 || pluginConfigMap.size > 0) {
    // Fetch DB plugin state
    const dbPlugins = await getPluginsForInstance(instanceId);

    for (const dbPlugin of dbPlugins) {
      const { pluginId, status } = dbPlugin;
      const inPresence = pluginPresenceMap.has(pluginId);
      const configEntry = pluginConfigMap.get(pluginId);
      // A plugin is "in gateway" if it has loaded tools OR appears in config
      const inGateway = inPresence || configEntry !== undefined;

      if (status === 'active' && inGateway) {
        // Confirmed healthy — no change
        unchanged.push(pluginId);
      } else if (status === 'degraded' && inGateway) {
        // Was degraded but recovered — promote to active
        await updatePluginStatus(instanceId, pluginId, 'active');
        promoted.push(pluginId);
      } else if (status === 'active' && !inGateway) {
        // Active in DB but missing from gateway — mark failed
        await updatePluginStatus(
          instanceId,
          pluginId,
          'failed',
          'Plugin not found in gateway after restart',
        );
        demoted.push(pluginId);
      } else if (status === 'degraded' && !inGateway) {
        // Degraded in DB and still absent — mark failed
        await updatePluginStatus(
          instanceId,
          pluginId,
          'failed',
          'Plugin not recovered after restart',
        );
        demoted.push(pluginId);
      } else if (status === 'pending' && inGateway) {
        // Install completed before the crash — promote to active and clear pending_owner
        await db('instance_plugins')
          .where({ instance_id: instanceId, plugin_id: pluginId })
          .update({
            status: 'active',
            pending_owner: null,
            updated_at: db.fn.now(),
          });
        promoted.push(pluginId);
      } else if (status === 'pending' && !inGateway) {
        // Install was in-flight when server crashed — leave pending for Phase 3 replay
        unchanged.push(pluginId);
      } else {
        // installed / disabled / failed — no reconciliation needed
        unchanged.push(pluginId);
      }
    }
  }

  console.log(
    `[extension-lifecycle] Reconciliation for ${instanceId}: promoted=${promoted.length}, demoted=${demoted.length}, unchanged=${unchanged.length}`
  );

  return { promoted, demoted, unchanged };
}

/**
 * Phase 3 input: get all pending extensions for replay.
 * Returns both skills and plugins whose install was interrupted and need to be retried.
 */
export async function getPendingExtensions(instanceId: string): Promise<{
  skills: InstanceSkill[];
  plugins: InstancePlugin[];
}> {
  // Pending skills
  const skillRows = await db('instance_skills')
    .where({ instance_id: instanceId, status: 'pending' })
    .select('*') as Array<Record<string, unknown>>;

  const skills: InstanceSkill[] = skillRows.map((row) => ({
    id: row.id as string,
    instanceId: row.instance_id as string,
    skillId: row.skill_id as string,
    source: typeof row.source === 'string' ? JSON.parse(row.source) : row.source,
    version: (row.version as string | null) ?? null,
    lockedVersion: (row.locked_version as string | null) ?? null,
    integrityHash: (row.integrity_hash as string | null) ?? null,
    enabled: Boolean(row.enabled),
    config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {}),
    status: row.status as InstanceSkill['status'],
    errorMessage: (row.error_message as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    pendingOwner: (row.pending_owner as string | null) ?? null,
    retryCount: (row.retry_count as number) ?? 0,
    installedAt: row.installed_at as string,
    updatedAt: row.updated_at as string,
  }));

  // Pending plugins (mirrors skill row mapping pattern)
  const pluginRows = await db('instance_plugins')
    .where({ instance_id: instanceId, status: 'pending' })
    .select('*') as Array<Record<string, unknown>>;

  const plugins: InstancePlugin[] = pluginRows.map((row) => ({
    id: row.id as string,
    instanceId: row.instance_id as string,
    pluginId: row.plugin_id as string,
    source: typeof row.source === 'string' ? JSON.parse(row.source) : row.source,
    version: (row.version as string | null) ?? null,
    lockedVersion: (row.locked_version as string | null) ?? null,
    integrityHash: (row.integrity_hash as string | null) ?? null,
    enabled: Boolean(row.enabled),
    config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {}),
    status: row.status as InstancePlugin['status'],
    errorMessage: (row.error_message as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    pendingOwner: (row.pending_owner as string | null) ?? null,
    retryCount: (row.retry_count as number) ?? 0,
    installedAt: row.installed_at as string,
    updatedAt: row.updated_at as string,
  }));

  return { skills, plugins };
}

/**
 * @deprecated Use getPendingExtensions instead.
 * Kept for backward compatibility.
 */
export async function getPendingExtensionsForReplay(instanceId: string): Promise<InstanceSkill[]> {
  const { skills } = await getPendingExtensions(instanceId);
  return skills;
}

/**
 * Phase 3: replay pending extensions after gateway boot and reconciliation.
 * Installs each pending skill and plugin, handling failures non-fatally.
 *
 * Extensions in 'pending' state come from template instantiation or crash recovery.
 * Trust was already evaluated at import/instantiation time, so we replay
 * the install as-is (locked_version preserved from import).
 *
 * Returns observability counts for logging.
 */
export async function replayPendingExtensions(
  instanceId: string,
  controlEndpoint: string,
  authToken: string,
  userId: string,
): Promise<{ installed: string[]; failed: string[]; needsCredentials: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];
  const needsCredentials: string[] = [];

  const { skills, plugins } = await getPendingExtensions(instanceId);

  if (skills.length === 0 && plugins.length === 0) {
    return { installed, failed, needsCredentials };
  }

  // Replay pending skills
  for (const skill of skills) {
    try {
      // OFFLINE-02: Prefer cached artifact over registry
      let replaySkillSource = skill.source;
      if (skill.lockedVersion && skill.source.type !== 'bundled') {
        try {
          const rtInfo = await getInstanceRuntimeInfo(instanceId);
          if (rtInfo) {
            const cached = await isArtifactCached('skill', skill.skillId, skill.lockedVersion, rtInfo.runtimeId, rtInfo.deploymentTarget);
            if (cached) {
              const cachePath = getCachedArtifactPath('skill', skill.skillId, skill.lockedVersion);
              replaySkillSource = { type: 'url', url: `file://${cachePath}` };
              console.log(`[extension-lifecycle] Phase 3: using cached artifact for skill ${skill.skillId}@${skill.lockedVersion}`);
            }
          }
        } catch {
          // Cache check failed — fall through to registry
        }
      }

      const { requiredCredentials } = await installSkill(
        instanceId,
        skill.skillId,
        replaySkillSource,
      );
      if (requiredCredentials.length > 0) {
        needsCredentials.push(skill.skillId);
      } else {
        installed.push(skill.skillId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[extension-lifecycle] Phase 3: skill replay failed for ${skill.skillId} on ${instanceId}: ${message}`);
      await updateSkillStatus(instanceId, skill.skillId, 'failed', message);
      failed.push(skill.skillId);
    }
  }

  // Replay pending plugins
  for (const plugin of plugins) {
    try {
      // OFFLINE-02: Prefer cached artifact over registry
      let replayPluginSource = plugin.source;
      if (plugin.lockedVersion && plugin.source.type !== 'bundled') {
        try {
          const rtInfo = await getInstanceRuntimeInfo(instanceId);
          if (rtInfo) {
            const cached = await isArtifactCached('plugin', plugin.pluginId, plugin.lockedVersion, rtInfo.runtimeId, rtInfo.deploymentTarget);
            if (cached) {
              const cachePath = getCachedArtifactPath('plugin', plugin.pluginId, plugin.lockedVersion);
              // npm requires file: prefix for local tarball installs
              replayPluginSource = { type: 'npm', spec: `file:${cachePath}` };
              console.log(`[extension-lifecycle] Phase 3: using cached artifact for plugin ${plugin.pluginId}@${plugin.lockedVersion}`);
            }
          }
        } catch {
          // Cache check failed — fall through to registry
        }
      }

      const { requiredCredentials } = await installPlugin(
        instanceId,
        plugin.pluginId,
        replayPluginSource,
        userId,
      );
      if (requiredCredentials.length > 0) {
        needsCredentials.push(plugin.pluginId);
      } else {
        installed.push(plugin.pluginId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[extension-lifecycle] Phase 3: plugin replay failed for ${plugin.pluginId} on ${instanceId}: ${message}`);
      await updatePluginStatus(instanceId, plugin.pluginId, 'failed', message);
      failed.push(plugin.pluginId);
    }
  }

  return { installed, failed, needsCredentials };
}
