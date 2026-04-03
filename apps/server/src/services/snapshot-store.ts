// apps/server/src/services/snapshot-store.ts
import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import { getAgentType } from '../agent-types/registry.js';
import { restartInstance } from './instance-manager.js';
import { broadcast } from '../ws/index.js';
import type { Snapshot, SnapshotSummary, SnapshotDiff, SnapshotDiffEntry, PaginatedResponse, DeploymentTarget, ConfigChangeSummary } from '@aquarium/shared';
import { computeChangeSummary } from './config-diff.js';

// ── row mappers ──

function toSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    userId: row.user_id as string,
    configSnapshot: row.config_snapshot as Record<string, unknown>,
    workspaceFiles: row.workspace_files as Record<string, string>,
    credentialRefs: row.credential_refs as Array<{ provider: string; type: string }>,
    description: (row.description as string) || null,
    triggerType: row.trigger_type as Snapshot['triggerType'],
    triggerDetail: (row.trigger_detail as string) || null,
    instanceStatus: (row.instance_status as string) || null,
    totalSizeBytes: (row.total_size_bytes as number) || null,
    createdAt: String(row.created_at),
  };
}

function toSnapshotSummary(
  row: Record<string, unknown>,
  version?: string,
  changeSummary?: ConfigChangeSummary[],
  changeCount?: number
): SnapshotSummary {
  return {
    id: row.id as string,
    description: (row.description as string) || null,
    triggerType: row.trigger_type as SnapshotSummary['triggerType'],
    triggerDetail: (row.trigger_detail as string) || null,
    instanceStatus: (row.instance_status as string) || null,
    totalSizeBytes: (row.total_size_bytes as number) || null,
    createdAt: String(row.created_at),
    version,
    changeSummary,
    changeCount,
    createdById: (row.user_id as string) || null,
  };
}

// ── workspace file collection ──

async function collectWorkspaceFiles(instanceId: string): Promise<Record<string, string>> {
  const instance = await db('instances').where({ id: instanceId }).first();
  if (!instance?.runtime_id || instance.status !== 'running') {
    return {}; // Non-running instances can't read container files
  }

  const engine = getRuntimeEngine(instance.deployment_target as DeploymentTarget);
  if (!engine.listFiles || !engine.readFile) {
    return {}; // Runtime doesn't support file operations
  }

  const { manifest } = getAgentType(instance.agent_type);
  const volumeMountPath = (manifest.volumes[0]?.mountPath || '/home/node/.openclaw').replace(/\/$/, '');

  const files = await engine.listFiles(instance.runtime_id, volumeMountPath + '/');
  const result: Record<string, string> = {};

  const SENSITIVE_FILE_PATTERN = /(?:^|\/|\\)auth-profiles\.json$/;

  for (const fileName of files) {
    if (SENSITIVE_FILE_PATTERN.test(fileName)) continue;

    const content = await engine.readFile(instance.runtime_id, `${volumeMountPath}/${fileName}`);
    if (content !== null) {
      result[fileName] = content;
    }
  }

  return result;
}

// ── CRUD operations ──

export async function createSnapshot(
  instanceId: string,
  userId: string,
  options: {
    description?: string;
    triggerType: 'manual' | 'pre_operation' | 'daily';
    triggerDetail?: string;
  }
): Promise<Snapshot> {
  // 1. Read config from DB
  const instance = await db('instances').where({ id: instanceId }).first();
  if (!instance) throw new Error('Instance not found');

  const rawConfig = instance.config;
  const configSnapshot = (typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig) || {};

  // 2. Read workspace files from container (only for running instances)
  const workspaceFiles = await collectWorkspaceFiles(instanceId);

  // 3. Read credential metadata (no encrypted values)
  const credRows = await db('instance_credentials')
    .where({ instance_id: instanceId })
    .select('provider', 'credential_type');
  const credentialRefs = credRows.map((r: Record<string, unknown>) => ({
    provider: r.provider as string,
    type: r.credential_type as string,
  }));

  // 4. Calculate total size
  const configSize = Buffer.byteLength(JSON.stringify(configSnapshot), 'utf8');
  const workspaceSize = Buffer.byteLength(JSON.stringify(workspaceFiles), 'utf8');
  const totalSizeBytes = configSize + workspaceSize;

  // 5. Insert snapshot
  const [row] = await db('snapshots')
    .insert({
      id: randomUUID(),
      instance_id: instanceId,
      user_id: userId,
      config_snapshot: JSON.stringify(configSnapshot),
      workspace_files: JSON.stringify(workspaceFiles),
      credential_refs: JSON.stringify(credentialRefs),
      description: options.description || null,
      trigger_type: options.triggerType,
      trigger_detail: options.triggerDetail || null,
      instance_status: instance.status || null,
      total_size_bytes: totalSizeBytes,
    })
    .returning('*');

  return toSnapshot(row);
}

export async function listSnapshots(
  instanceId: string,
  pagination: { page: number; limit: number }
): Promise<PaginatedResponse<SnapshotSummary>> {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;

  const totalResult = await db('snapshots')
    .where({ instance_id: instanceId })
    .count('id as count')
    .first();
  const total = Number(totalResult?.count ?? 0);

  const rows = await db('snapshots')
    .where({ instance_id: instanceId })
    .orderBy('created_at', 'desc')
    .offset(offset)
    .limit(limit)
    .select('id', 'user_id', 'description', 'trigger_type', 'trigger_detail', 'instance_status', 'total_size_bytes', 'created_at', 'config_snapshot');

  const items: SnapshotSummary[] = rows.map((row, idx) => {
    const globalIndex = offset + idx;
    const versionNumber = total - globalIndex;
    const version = `v${versionNumber}`;

    const currConfig = row.config_snapshot as Record<string, unknown> | null;
    const prevRow = rows[idx + 1];
    const prevConfig = prevRow ? (prevRow.config_snapshot as Record<string, unknown> | null) : null;

    let changeSummary: ConfigChangeSummary[] | undefined;
    let changeCount: number | undefined;

    if (idx < rows.length - 1 && prevConfig) {
      changeSummary = computeChangeSummary(prevConfig, currConfig);
      changeCount = changeSummary.length;
    } else if (globalIndex === total - 1) {
      changeSummary = computeChangeSummary(null, currConfig);
      changeCount = changeSummary.length;
    }

    return toSnapshotSummary(row, version, changeSummary, changeCount);
  });

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSnapshot(snapshotId: string): Promise<Snapshot> {
  const row = await db('snapshots').where({ id: snapshotId }).first();
  if (!row) throw new Error('Snapshot not found');
  return toSnapshot(row);
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const deleted = await db('snapshots').where({ id: snapshotId }).del();
  if (!deleted) throw new Error('Snapshot not found');
}

// ── restore ──

export async function restoreSnapshot(snapshotId: string, userId: string): Promise<void> {
  const snapshot = await db('snapshots').where({ id: snapshotId }).first();
  if (!snapshot) throw new Error('Snapshot not found');

  const instance = await db('instances').where({ id: snapshot.instance_id }).first();
  if (!instance) throw new Error('Instance not found');

  // 1. Pre-restore safety snapshot
  await createSnapshot(instance.id, userId, {
    triggerType: 'pre_operation',
    triggerDetail: `恢复前自动快照: 恢复到 ${snapshot.created_at}`,
  });

  // 2. Write config to DB
  await db('instances')
    .where({ id: instance.id })
    .update({ config: snapshot.config_snapshot });

  // 3. If running, reseed + RPC hot-reload
  if (instance.status === 'running' && instance.runtime_id) {
    const engine = getRuntimeEngine(instance.deployment_target as DeploymentTarget);
    const { manifest, adapter } = getAgentType(instance.agent_type);
    const volumeMountPath = (manifest.volumes[0]?.mountPath || '/home/node/.openclaw').replace(/\/$/, '');

    // Reseed workspace files into container
    if (engine.writeFiles) {
      const filesMap = new Map(Object.entries(snapshot.workspace_files as Record<string, string>));
      await engine.writeFiles(instance.runtime_id, volumeMountPath + '/', filesMap);
    }

    // config.patch RPC (hot reload)
    try {
      if (adapter?.translateRPC) {
        await adapter.translateRPC({
          method: 'config.patch',
          params: {
            patch: snapshot.config_snapshot,
            note: 'Snapshot restore',
            restartDelayMs: 2000,
          },
          endpoint: instance.control_endpoint,
          token: instance.auth_token,
          instanceId: instance.id,
        });
      } else {
        // No RPC capability → restart to apply config changes
        await restartInstance(instance.id, userId);
      }
    } catch {
      // RPC failed → restart instance
      await restartInstance(instance.id, userId);
    }
  }

  // 4. Broadcast restore event via WebSocket
  broadcast(instance.id, {
    type: 'instance:snapshot_restored',
    instanceId: instance.id,
    payload: { snapshotId, restoredAt: new Date().toISOString() },
  });

  // 5. Cleanup old snapshots
  await cleanupOldSnapshots(instance.id);
}

// ── diff ──

export async function diffSnapshot(snapshotId: string, instanceId: string): Promise<SnapshotDiff> {
  const snapshot = await db('snapshots').where({ id: snapshotId }).first();
  if (!snapshot) throw new Error('Snapshot not found');

  if (snapshot.instance_id !== instanceId) {
    throw new Error('Snapshot does not belong to this instance');
  }

  const instance = await db('instances').where({ id: instanceId }).first();
  if (!instance) throw new Error('Instance not found');

  const snapshotConfig = snapshot.config_snapshot as Record<string, string>;
  const currentConfig = (instance.config || {}) as Record<string, string>;

  // Collect all file keys from both configs
  const allFiles = new Set([...Object.keys(snapshotConfig), ...Object.keys(currentConfig)]);
  const changes: SnapshotDiffEntry[] = [];

  for (const file of allFiles) {
    const snapshotContent = snapshotConfig[file];
    const currentContent = currentConfig[file];

    if (snapshotContent !== undefined && currentContent !== undefined) {
      if (snapshotContent === currentContent) {
        changes.push({ file, type: 'unchanged' });
      } else {
        changes.push({ file, type: 'modified', snapshotContent, currentContent });
      }
    } else if (snapshotContent !== undefined && currentContent === undefined) {
      changes.push({ file, type: 'removed', snapshotContent });
    } else if (snapshotContent === undefined && currentContent !== undefined) {
      changes.push({ file, type: 'added', currentContent });
    }
  }

  return {
    snapshotId: snapshot.id,
    snapshotCreatedAt: String(snapshot.created_at),
    changes,
  };
}

// ── cleanup ──

export async function cleanupOldSnapshots(instanceId: string): Promise<number> {
  let deletedCount = 0;

  // Rule 1: Delete auto-snapshots older than 90 days
  const expiredRows = await db('snapshots')
    .where({ instance_id: instanceId })
    .whereIn('trigger_type', ['daily', 'pre_operation'])
    .where('created_at', '<', getAdapter().intervalAgo(db, 90, 'days'))
    .del();
  deletedCount += expiredRows;

  // Rule 2: If over 50 snapshots, delete oldest auto-snapshots first (preserve manual)
  const totalResult = await db('snapshots').where({ instance_id: instanceId }).count('id as count').first();
  const count = Number(totalResult?.count ?? 0);

  if (count > 50) {
    const excess = count - 50;
    const toDelete: Array<{ id: string }> = await db('snapshots')
      .where({ instance_id: instanceId })
      .whereIn('trigger_type', ['daily', 'pre_operation'])
      .orderBy('created_at', 'asc')
      .limit(excess)
      .select('id');

    if (toDelete.length > 0) {
      const deleted = await db('snapshots')
        .whereIn('id', toDelete.map(r => r.id))
        .del();
      deletedCount += deleted;
    }
  }

  return deletedCount;
}

// ── auto-snapshot helpers (exported for instance-manager) ──

export async function safeAutoSnapshot(
  instanceId: string,
  userId: string,
  triggerDetail: string
): Promise<void> {
  try {
    await createSnapshot(instanceId, userId, {
      triggerType: 'pre_operation',
      triggerDetail,
    });
  } catch (err) {
    console.error(`Auto-snapshot failed for instance ${instanceId}:`, err);
    // Do NOT throw — auto-snapshot failure must not block the original operation
  }
}

// ── daily scheduler (exported for index.ts) ──

export async function runDailySnapshots(): Promise<{ created: number; failed: number }> {
  const runningInstances = await db('instances').where({ status: 'running' });

  let created = 0;
  let failed = 0;

  for (const instance of runningInstances) {
    try {
      await createSnapshot(instance.id, instance.user_id, {
        triggerType: 'daily',
        triggerDetail: '每日自动快照',
      });
      created++;
    } catch (err) {
      console.error(`Daily snapshot failed for instance ${instance.id}:`, err);
      failed++;
    }
  }

  // Cleanup for each instance
  for (const instance of runningInstances) {
    try {
      await cleanupOldSnapshots(instance.id);
    } catch (err) {
      console.error(`Snapshot cleanup failed for instance ${instance.id}:`, err);
    }
  }

  return { created, failed };
}
