import { db } from '../db/index.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import { broadcast } from '../ws/index.js';
import { syncWorkspaceFromContainer, syncGatewayState, stopInstance } from './instance-manager.js';
import { createNotification } from './notification-store.js';
import { getAgentType } from '../agent-types/registry.js';
import { gatewayCall } from '../agent-types/openclaw/gateway-rpc.js';
import type { DeploymentTarget, InstanceStatus } from '@aquarium/shared';

// ── Disk usage monitoring constants ──
const VOLUME_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2Gi from manifest defaultSize
const DISK_WARN_THRESHOLD = 0.8;  // 80% — broadcast warning
const DISK_STOP_THRESHOLD = 0.95; // 95% — auto-stop instance

// ── Security audit tracking ──
const AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const lastSecurityAudit = new Map<string, number>();
const skillPluginBaseline = new Map<string, string[]>();

let fastIntervalId: ReturnType<typeof setInterval> | null = null;
let slowIntervalId: ReturnType<typeof setInterval> | null = null;

async function checkDiskUsage(): Promise<void> {
  try {
    const rows = await db('instances').where({ status: 'running' });

    for (const row of rows) {
      if (!row.runtime_id) continue;

      try {
        const engine = getRuntimeEngine(row.deployment_target as DeploymentTarget);
        if (!engine.exec) continue;

        const result = await engine.exec(row.runtime_id, ['du', '-s', '/home/node/.openclaw'], { timeout: 10_000 });
        if (result.exitCode !== 0) continue;

        const usedKB = parseInt(result.stdout.split('\t')[0], 10);
        if (isNaN(usedKB)) continue;

        const usedBytes = usedKB * 1024;
        const usageRatio = usedBytes / VOLUME_LIMIT_BYTES;

        if (usageRatio >= DISK_STOP_THRESHOLD) {
          console.warn(`[health-monitor] disk usage critical for ${row.id} (${row.name}): ${(usageRatio * 100).toFixed(1)}% — auto-stopping`);
          await db('instance_events').insert({
            instance_id: row.id,
            event_type: 'disk_quota_exceeded',
            metadata: JSON.stringify({ usedBytes, limitBytes: VOLUME_LIMIT_BYTES, usagePercent: (usageRatio * 100).toFixed(1) }),
          });
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: 'stopping', statusMessage: `Disk usage exceeded 95% (${(usageRatio * 100).toFixed(1)}%) — auto-stopping` },
          });
          stopInstance(row.id, row.user_id).catch(err =>
            console.error(`[health-monitor] disk auto-stop failed for ${row.id}:`, err),
          );
        } else if (usageRatio >= DISK_WARN_THRESHOLD) {
          console.warn(`[health-monitor] disk usage warning for ${row.id} (${row.name}): ${(usageRatio * 100).toFixed(1)}%`);
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: 'running', statusMessage: `Disk usage warning: ${(usageRatio * 100).toFixed(1)}% of 2Gi limit` },
          });
        }
      } catch {
        // Skip this instance on exec error
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

async function checkInstances(statusFilter: InstanceStatus[]): Promise<void> {
  try {
    const rows = await db('instances').whereIn('status', statusFilter);

    for (const row of rows) {
      if (!row.runtime_id) continue;

      // Skip "restarting" instances -- they have their own 60s timeout in PersistentGatewayClient
      if (row.status === 'restarting') continue;

      try {
        const engine = getRuntimeEngine(row.deployment_target as DeploymentTarget);
        const status = await engine.getStatus(row.runtime_id);

        if (status.phase === 'running' && row.status === 'starting') {
          // Pod became ready — transition to running, clear statusMessage
          await db('instances').where({ id: row.id }).update({
            status: 'running',
            status_message: null,
            updated_at: db.fn.now(),
          });
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: 'running', statusMessage: null },
          });
          // Sync workspace files from container back to DB (fire-and-forget)
          syncWorkspaceFromContainer(row.id).catch(err =>
            console.error(`[health-monitor] syncWorkspace failed for ${row.id}:`, err),
          );
        } else if (status.phase === 'running' && row.status === 'error') {
          // Pod recovered after crash-loop — flip back to running
          console.log(`[health-monitor] auto-recovery: ${row.id} (${row.name}) pod stabilized, flipping error → running`);
          await db('instances').where({ id: row.id }).update({
            status: 'running',
            status_message: null,
            updated_at: db.fn.now(),
          });
          await db('instance_events').insert({
            instance_id: row.id,
            event_type: 'auto_recovered',
            metadata: JSON.stringify({ previousStatus: 'error', message: 'Pod stabilized after crash-loop' }),
          });
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: 'running', statusMessage: null },
          });
          syncGatewayState(row.id).catch(err =>
            console.error(`[health-monitor] syncGatewayState failed for ${row.id}:`, err),
          );
        } else if (status.phase === 'starting' && row.status === 'starting') {
          // Still starting — broadcast statusMessage so frontend shows progress
          const statusMessage = status.message || 'Starting...';
          if (statusMessage !== row.status_message) {
            await db('instances').where({ id: row.id }).update({
              status_message: statusMessage,
              updated_at: db.fn.now(),
            });
          }
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: 'starting', statusMessage },
          });
        } else if (!status.running && status.phase !== 'starting') {
          const newStatus = status.phase === 'error' ? 'error' as InstanceStatus : 'stopped' as InstanceStatus;
          const extra: Record<string, unknown> = { updated_at: db.fn.now(), status_message: null };
          if (newStatus === 'stopped') {
            extra.runtime_id = null;
            extra.control_endpoint = null;
          }
          await db('instances').where({ id: row.id }).update({
            status: newStatus,
            ...extra,
          });
          await db('instance_events').insert({
            instance_id: row.id,
            event_type: 'health_check_failed',
            metadata: JSON.stringify({ phase: status.phase, message: status.message }),
          });
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: { status: newStatus, statusMessage: null },
          });
        }
      } catch {
        // Skip this instance on error
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

// §7.1 — Gateway security audit (daily per instance)
async function checkSecurityAudit(): Promise<void> {
  try {
    const rows = await db('instances').where({ status: 'running' });
    const now = Date.now();

    for (const row of rows) {
      if (!row.runtime_id) continue;

      const lastRun = lastSecurityAudit.get(row.id) ?? 0;
      if (now - lastRun < AUDIT_INTERVAL_MS) continue;

      try {
        const engine = getRuntimeEngine(row.deployment_target as DeploymentTarget);
        if (!engine.exec) continue;

        const result = await engine.exec(
          row.runtime_id,
          ['openclaw', 'security', 'audit', '--deep', '--json'],
          { timeout: 60_000 },
        );

        lastSecurityAudit.set(row.id, now);

        if (result.exitCode !== 0) {
          // openclaw CLI may not be available — skip silently
          continue;
        }

        let auditResult: Record<string, unknown>;
        try {
          auditResult = JSON.parse(result.stdout) as Record<string, unknown>;
        } catch {
          continue;
        }

        const findings = auditResult.findings as Array<Record<string, unknown>> | undefined;
        if (!findings || findings.length === 0) continue;

        await db('instance_events').insert({
          instance_id: row.id,
          event_type: 'security_audit',
          metadata: JSON.stringify({ findingCount: findings.length, findings: findings.slice(0, 20) }),
        });

        const severities = findings.map(f => f.severity as string);
        const hasCritical = severities.includes('critical') || severities.includes('high');

        await createNotification({
          userId: row.user_id,
          instanceId: row.id,
          type: 'security_audit',
          severity: hasCritical ? 'critical' : 'warn',
          title: `Security audit found ${findings.length} issue(s)`,
          body: `Gateway security audit detected ${findings.length} finding(s) in instance "${row.name}".`,
        });

        console.log(`[health-monitor] security audit for ${row.id}: ${findings.length} finding(s)`);
      } catch {
        // Skip this instance
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

// §7.2a — Gateway HTTP /ready polling (every slow loop)
async function checkGatewayHealth(): Promise<void> {
  try {
    const rows = await db('instances')
      .where({ status: 'running' })
      .whereNotNull('control_endpoint');

    for (const row of rows) {
      try {
        // Derive HTTP URL from WS control_endpoint
        // "ws://localhost:19001" -> "http://localhost:19001/ready"
        const url = new URL(row.control_endpoint as string);
        url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        url.pathname = '/ready';

        const res = await fetch(url.toString(), {
          signal: AbortSignal.timeout(5_000),
        });

        const body = await res.json() as {
          ready: boolean;
          failing?: string[];
          uptimeMs?: number;
        };

        if (!body.ready) {
          const failingList = body.failing?.join(', ') || 'unknown';
          console.warn(`[health-monitor] gateway not ready for ${row.id} (${row.name}): failing=[${failingList}]`);

          // Broadcast degraded status to dashboard
          broadcast(row.id, {
            type: 'instance:status',
            instanceId: row.id,
            payload: {
              status: 'running',
              statusMessage: `Gateway degraded: ${failingList}`,
            },
          });
        }
      } catch {
        // Gateway HTTP unreachable — skip (Docker status check handles container health)
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

// §7.2b — Config integrity check via gateway-authoritative hash (every slow loop)
async function checkConfigIntegrity(): Promise<void> {
  try {
    const rows = await db('instances')
      .where({ status: 'running' })
      .whereNotNull('config_hash')
      .whereNotNull('control_endpoint');

    for (const row of rows) {
      try {
        const result = await gatewayCall(row.id, 'config.get', {}, 10_000) as {
          hash?: string;
        };
        if (!result?.hash) continue;

        const gatewayHash = result.hash;
        const dbHash = row.config_hash as string;

        if (gatewayHash === dbHash) continue;

        // Gateway's hash is authoritative — update DB to match
        await db('instances').where({ id: row.id }).update({
          config_hash: gatewayHash,
          updated_at: db.fn.now(),
        });
        console.log(`[health-monitor] config hash synced for ${row.id}: DB ${dbHash.slice(0, 8)}... -> gateway ${gatewayHash.slice(0, 8)}...`);
      } catch {
        // Gateway unreachable or RPC failed — skip
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

// §7.3 — Skill/Plugin change detection (every slow loop)
async function checkSkillPluginChanges(): Promise<void> {
  try {
    const rows = await db('instances').where({ status: 'running' });

    for (const row of rows) {
      if (!row.runtime_id) continue;

      try {
        const engine = getRuntimeEngine(row.deployment_target as DeploymentTarget);
        if (!engine.listFiles) continue;

        const { manifest } = getAgentType(row.agent_type as string);
        const volumeMountPath = manifest.volumes[0]?.mountPath || '/home/node/.openclaw';

        const skillFiles = await engine.listFiles(row.runtime_id, `${volumeMountPath}/skills`).catch(() => [] as string[]);
        const pluginFiles = await engine.listFiles(row.runtime_id, `${volumeMountPath}/plugins`).catch(() => [] as string[]);

        const currentFiles = [...skillFiles.map(f => `skills/${f}`), ...pluginFiles.map(f => `plugins/${f}`)].sort();
        const currentKey = currentFiles.join('|');

        const baselineKey = row.id as string;
        const previousFiles = skillPluginBaseline.get(baselineKey);

        if (previousFiles === undefined) {
          // First scan — establish baseline
          skillPluginBaseline.set(baselineKey, currentFiles);
          continue;
        }

        const previousKey = previousFiles.join('|');
        if (currentKey === previousKey) continue;

        skillPluginBaseline.set(baselineKey, currentFiles);

        const added = currentFiles.filter(f => !previousFiles.includes(f));
        const removed = previousFiles.filter(f => !currentFiles.includes(f));

        console.log(`[health-monitor] skill/plugin change for ${row.id}: +${added.length} -${removed.length}`);

        await db('instance_events').insert({
          instance_id: row.id,
          event_type: 'skill_plugin_change',
          metadata: JSON.stringify({ added, removed, current: currentFiles }),
        });

        await createNotification({
          userId: row.user_id,
          instanceId: row.id,
          type: 'skill_plugin_change',
          severity: 'info',
          title: 'Skill/plugin changes detected',
          body: `Instance "${row.name}": ${added.length} added, ${removed.length} removed.`,
        });
      } catch {
        // Skip this instance
      }
    }
  } catch {
    // DB query failed — skip this cycle
  }
}

export function startHealthMonitor(fastMs = 5_000, slowMs = 30_000): void {
  if (fastIntervalId || slowIntervalId) return;

  // Fast loop: check 'starting' instances every 5s
  fastIntervalId = setInterval(() => checkInstances(['starting']), fastMs);

  // Slow loop: check 'running' and 'error' instances every 30s (includes auto-recovery + disk usage + security checks)
  slowIntervalId = setInterval(() => {
    checkInstances(['running', 'error']);
    checkDiskUsage();
    checkSecurityAudit();
    checkGatewayHealth();
    checkConfigIntegrity();
    checkSkillPluginChanges();
  }, slowMs);
}

export function stopHealthMonitor(): void {
  if (fastIntervalId) {
    clearInterval(fastIntervalId);
    fastIntervalId = null;
  }
  if (slowIntervalId) {
    clearInterval(slowIntervalId);
    slowIntervalId = null;
  }

  lastSecurityAudit.clear();
  skillPluginBaseline.clear();
}
