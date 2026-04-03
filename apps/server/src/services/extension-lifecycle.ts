import { db } from '../db/index.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { cleanupOrphanedOperations } from './extension-lock.js';
import { getSkillsForInstance, updateSkillStatus } from './skill-store.js';
import type { InstanceSkill } from '@aquarium/shared';

// ─── RPC Response Types ───────────────────────────────────────────────────────

interface GatewaySkillInfo {
  skillId: string;
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
  const orphanedPending = await db('instance_skills')
    .whereNotNull('pending_owner')
    .where('status', 'pending')
    .count('* as cnt')
    .first() as Record<string, unknown> | undefined;

  const orphanedPendingCount = Number(orphanedPending?.cnt ?? 0);
  if (orphanedPendingCount > 0) {
    console.log(
      `[extension-lifecycle] Found ${orphanedPendingCount} pending extension(s) from previous sessions — will reconcile on instance boot`
    );
  }
}

/**
 * Phase 2 reconciliation: compare gateway skills.list with DB state and
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

  // Fetch current gateway skill state
  const rpc = new GatewayRPCClient(controlEndpoint, authToken);
  let rpcResult: unknown;
  try {
    rpcResult = await rpc.call('skills.list', {}, 15_000);
  } finally {
    rpc.close();
  }

  if (!isSkillsListResult(rpcResult)) {
    throw new Error(`Unexpected skills.list RPC response: ${JSON.stringify(rpcResult)}`);
  }

  // Build gateway skills map: skillId -> gatewaySkillInfo
  const gatewaySkills = new Map<string, GatewaySkillInfo>();
  for (const skill of rpcResult.skills ?? []) {
    if (skill.skillId) {
      gatewaySkills.set(skill.skillId, skill);
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

  console.log(
    `[extension-lifecycle] Reconciliation for ${instanceId}: promoted=${promoted.length}, demoted=${demoted.length}, unchanged=${unchanged.length}`
  );

  return { promoted, demoted, unchanged };
}

/**
 * Phase 3 input: get all pending extensions for replay.
 * Returns skills whose install was interrupted and need to be retried.
 */
export async function getPendingExtensionsForReplay(instanceId: string): Promise<InstanceSkill[]> {
  const rows = await db('instance_skills')
    .where({ instance_id: instanceId, status: 'pending' })
    .select('*') as Array<Record<string, unknown>>;

  // Inline row mapping (mirrors mapSkillRow from skill-store.ts)
  return rows.map((row) => ({
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
}
