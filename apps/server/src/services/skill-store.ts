import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { config } from '../config.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import {
  acquireLock,
  releaseLock,
  checkCancelRequested,
} from './extension-lock.js';
import type {
  InstanceSkill,
  ExtensionSkillSource,
  ExtensionCredentialRequirement,
  ExtensionStatus,
} from '@aquarium/shared';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

function mapSkillRow(row: Record<string, unknown>): InstanceSkill {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    skillId: row.skill_id as string,
    source: adapter.parseJson<ExtensionSkillSource>(row.source),
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

interface InstallRPCResult {
  requiredCredentials?: ExtensionCredentialRequirement[];
  version?: string;
  integrityHash?: string;
}

function isInstallRPCResult(val: unknown): val is InstallRPCResult {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if ('requiredCredentials' in obj) {
    if (!Array.isArray(obj.requiredCredentials)) return false;
  }
  if ('version' in obj && obj.version !== undefined && typeof obj.version !== 'string') return false;
  if ('integrityHash' in obj && obj.integrityHash !== undefined && typeof obj.integrityHash !== 'string') return false;
  return true;
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Get all skills installed on an instance, ordered newest first.
 */
export async function getSkillsForInstance(instanceId: string): Promise<InstanceSkill[]> {
  const rows = await db('instance_skills')
    .where({ instance_id: instanceId })
    .orderBy('installed_at', 'desc')
    .select('*') as Array<Record<string, unknown>>;

  return rows.map(mapSkillRow);
}

/**
 * Get a single skill by instance + skill ID.
 */
export async function getSkillById(
  instanceId: string,
  skillId: string,
): Promise<InstanceSkill | null> {
  const row = await db('instance_skills')
    .where({ instance_id: instanceId, skill_id: skillId })
    .first() as Record<string, unknown> | undefined;

  return row ? mapSkillRow(row) : null;
}

/**
 * Install a skill on an instance.
 *
 * Flow:
 * 1. Acquire per-instance mutation lock
 * 2. INSERT a pending record
 * 3. Call skills.install RPC (3-min deadline per INFRA-07)
 * 4. If RPC returns no requiredCredentials → promote to 'active'
 *    If RPC returns credentials needed → leave at 'installed' (user must supply)
 * 5. Release lock (always, via finally)
 *
 * Returns the resulting skill row and any credential requirements.
 */
export async function installSkill(
  instanceId: string,
  skillId: string,
  source: ExtensionSkillSource,
  controlEndpoint: string,
  authToken: string,
): Promise<{ skill: InstanceSkill; requiredCredentials: ExtensionCredentialRequirement[] }> {
  const adapter = getAdapter();
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'install',
    skillId,
    'skill',
  );

  const rowId = adapter.generateId();

  // Read existing skill row before acquiring state — used for reinstall integrity check
  const existingSkill = await getSkillById(instanceId, skillId);

  try {
    // 1. Insert pending record
    await db('instance_skills').insert({
      id: rowId,
      instance_id: instanceId,
      skill_id: skillId,
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

    // 2. Check cancel before making the network call
    if (await checkCancelRequested(operationId)) {
      await db('instance_skills')
        .where({ instance_id: instanceId, skill_id: skillId })
        .update({ status: 'failed', error_message: 'Cancelled before install RPC', updated_at: db.fn.now() });
      await releaseLock(operationId, fencingToken, 'cancelled');
      const skill = await getSkillById(instanceId, skillId);
      return { skill: skill!, requiredCredentials: [] };
    }

    // 3. Call gateway RPC: skills.install (3-min deadline per INFRA-07)
    const rpcSourceParam =
      source.type === 'bundled'
        ? 'bundled'
        : source.type === 'clawhub'
          ? source.spec
          : source.url;

    const rpc = new GatewayRPCClient(controlEndpoint, authToken);
    let rpcResult: unknown;
    try {
      rpcResult = await rpc.call(
        'skills.install',
        { skillId, source: rpcSourceParam },
        180_000,
      );
    } finally {
      rpc.close();
    }

    // 4. Parse response
    if (!isInstallRPCResult(rpcResult)) {
      throw new Error(`Unexpected skills.install RPC response: ${JSON.stringify(rpcResult)}`);
    }

    const requiredCredentials: ExtensionCredentialRequirement[] =
      rpcResult.requiredCredentials ?? [];

    // TRUST-06: Integrity verification on same-version reinstall
    // If the existing row has both a locked_version and integrity_hash, and the RPC
    // returns the same version with a different hash, reject as supply-chain tampering.
    if (
      existingSkill !== null &&
      existingSkill.lockedVersion !== null &&
      existingSkill.integrityHash !== null &&
      rpcResult.version !== undefined &&
      rpcResult.version === existingSkill.lockedVersion &&
      rpcResult.integrityHash !== undefined &&
      rpcResult.integrityHash !== existingSkill.integrityHash
    ) {
      const lockedVersion = existingSkill.lockedVersion;
      throw new Error(
        `Integrity mismatch -- registry returned different artifact for v${lockedVersion}. Possible supply-chain tampering. Contact the extension publisher.`
      );
    }

    const newStatus: ExtensionStatus =
      requiredCredentials.length === 0 ? 'active' : 'installed';

    // TRUST-05: Pin locked_version and integrity_hash from RPC response
    const versionUpdate: Record<string, unknown> = {
      status: newStatus,
      pending_owner: null,
      updated_at: db.fn.now(),
    };
    if (rpcResult.version !== undefined) {
      versionUpdate.version = rpcResult.version;
      versionUpdate.locked_version = rpcResult.version;
    }
    if (rpcResult.integrityHash !== undefined) {
      versionUpdate.integrity_hash = rpcResult.integrityHash;
    }

    await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: skillId })
      .update(versionUpdate);

    await releaseLock(operationId, fencingToken, 'success');

    const skill = await getSkillById(instanceId, skillId);
    return { skill: skill!, requiredCredentials };
  } catch (err: unknown) {
    // On failure: mark failed and release lock
    await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: skillId })
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
 * Enable a previously disabled skill.
 * Verifies skill is in 'disabled' state before proceeding.
 */
export async function enableSkill(
  instanceId: string,
  skillId: string,
  controlEndpoint: string,
  authToken: string,
): Promise<InstanceSkill> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'enable',
    skillId,
    'skill',
  );

  try {
    const existing = await getSkillById(instanceId, skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found on instance ${instanceId}`);
    }
    if (existing.status !== 'disabled') {
      throw new Error(`Skill "${skillId}" is not disabled (current status: ${existing.status})`);
    }

    // Call RPC: skills.update (30s deadline per INFRA-07)
    const rpc = new GatewayRPCClient(controlEndpoint, authToken);
    try {
      await rpc.call('skills.update', { skillId, enabled: true }, 30_000);
    } finally {
      rpc.close();
    }

    await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: skillId })
      .update({ enabled: 1, status: 'active', updated_at: db.fn.now() });

    await releaseLock(operationId, fencingToken, 'success');

    const skill = await getSkillById(instanceId, skillId);
    return skill!;
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
 * Disable an active skill.
 * Verifies skill is in 'active' or 'degraded' state before proceeding.
 */
export async function disableSkill(
  instanceId: string,
  skillId: string,
  controlEndpoint: string,
  authToken: string,
): Promise<InstanceSkill> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'disable',
    skillId,
    'skill',
  );

  try {
    const existing = await getSkillById(instanceId, skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found on instance ${instanceId}`);
    }
    if (existing.status !== 'active' && existing.status !== 'degraded') {
      throw new Error(
        `Skill "${skillId}" cannot be disabled from status "${existing.status}" (must be active or degraded)`
      );
    }

    // Call RPC: skills.update (30s deadline per INFRA-07)
    const rpc = new GatewayRPCClient(controlEndpoint, authToken);
    try {
      await rpc.call('skills.update', { skillId, enabled: false }, 30_000);
    } finally {
      rpc.close();
    }

    await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: skillId })
      .update({ enabled: 0, status: 'disabled', updated_at: db.fn.now() });

    await releaseLock(operationId, fencingToken, 'success');

    const skill = await getSkillById(instanceId, skillId);
    return skill!;
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
 * Uninstall a skill from an instance.
 * Calls the gateway RPC then deletes the DB row.
 */
export async function uninstallSkill(
  instanceId: string,
  skillId: string,
  controlEndpoint: string,
  authToken: string,
): Promise<void> {
  const { fencingToken, operationId } = await acquireLock(
    instanceId,
    'uninstall',
    skillId,
    'skill',
  );

  try {
    const existing = await getSkillById(instanceId, skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found on instance ${instanceId}`);
    }

    // Check cancel before making the 3-min network call
    if (await checkCancelRequested(operationId)) {
      await releaseLock(operationId, fencingToken, 'cancelled');
      return;
    }

    // Call RPC: skills.uninstall (3-min deadline per INFRA-07)
    const rpc = new GatewayRPCClient(controlEndpoint, authToken);
    try {
      await rpc.call('skills.uninstall', { skillId }, 180_000);
    } finally {
      rpc.close();
    }

    await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: skillId })
      .delete();

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
 * Update a skill's status directly (no lock required).
 * Used internally by reconciliation processes — not for user-initiated mutations.
 */
export async function updateSkillStatus(
  instanceId: string,
  skillId: string,
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

  await db('instance_skills')
    .where({ instance_id: instanceId, skill_id: skillId })
    .update(update);
}
