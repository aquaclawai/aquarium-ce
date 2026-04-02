import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { broadcast } from '../ws/index.js';
import type {
  SecurityEventType,
  SecurityProfile,
  InstanceEvent,
  PaginatedResponse,
  SecuritySummary,
  InstanceSecuritySummary,
  ProtectionStatus,
} from '@aquarium/shared';

export async function recordSecurityEvent(
  instanceId: string,
  type: SecurityEventType,
  severity: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db('instance_events').insert({
    instance_id: instanceId,
    event_type: type,
    metadata: JSON.stringify({ severity, ...metadata }),
  });

  broadcast(instanceId, {
    type: 'security_event',
    instanceId,
    payload: {
      category: type,
      severity,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
  });
}

export async function querySecurityEvents(
  instanceId: string,
  userId: string,
  opts: { page?: number; limit?: number; severity?: string; type?: string },
): Promise<PaginatedResponse<InstanceEvent>> {
  const ownerCheck = await db('instances').where({ id: instanceId, user_id: userId }).first();
  if (!ownerCheck) throw new Error('Instance not found');

  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;

  let query = db('instance_events')
    .where({ instance_id: instanceId })
    .where('event_type', 'like', 'security:%');

  let countQuery = db('instance_events')
    .where({ instance_id: instanceId })
    .where('event_type', 'like', 'security:%');

  if (opts.type) {
    query = query.where('event_type', opts.type);
    countQuery = countQuery.where('event_type', opts.type);
  }

  if (opts.severity) {
    const _adapter = getAdapter();
    if (_adapter.dialect === 'pg') {
      query = query.whereRaw("metadata->>'severity' = ?", [opts.severity]);
      countQuery = countQuery.whereRaw("metadata->>'severity' = ?", [opts.severity]);
    } else {
      query = query.whereRaw("json_extract(metadata, '$.severity') = ?", [opts.severity]);
      countQuery = countQuery.whereRaw("json_extract(metadata, '$.severity') = ?", [opts.severity]);
    }
  }

  const [{ count }] = await countQuery.count('* as count');
  const total = Number(count);

  const rows = await query
    .orderBy('created_at', 'desc')
    .offset(offset)
    .limit(limit);

  const items: InstanceEvent[] = rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    instanceId: row.instance_id as string,
    eventType: row.event_type as string,
    metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getInstanceSecuritySummary(
  instanceId: string,
  userId: string,
): Promise<InstanceSecuritySummary> {
  const instance = await db('instances')
    .where({ id: instanceId, user_id: userId })
    .select('id', 'security_profile', 'config')
    .first();
  if (!instance) throw new Error('Instance not found');

  const adapter = getAdapter();
  const since = adapter.intervalAgo(db, 1, 'days');
  const severityExpr = adapter.dialect === 'pg'
    ? db.raw("metadata->>'severity' as severity")
    : db.raw("json_extract(metadata, '$.severity') as severity");
  const severityGroup = adapter.dialect === 'pg'
    ? db.raw("metadata->>'severity'")
    : db.raw("json_extract(metadata, '$.severity')");

  const baseQuery = () => db('instance_events')
    .where({ instance_id: instanceId })
    .where('event_type', 'like', 'security:%')
    .where('created_at', '>', since);

  const [typeRows, severityRows, [criticalRow], topRows] = await Promise.all([
    baseQuery()
      .select('event_type')
      .count('* as count')
      .groupBy('event_type') as Promise<Array<{ event_type: string; count: string }>>,
    baseQuery()
      .select(severityExpr)
      .count('* as count')
      .groupBy(severityGroup) as Promise<Array<{ severity: string; count: string }>>,
    adapter.dialect === 'pg'
      ? baseQuery().whereRaw("metadata->>'severity' = 'critical'").count('* as count') as Promise<Array<{ count: string }>>
      : baseQuery().whereRaw("json_extract(metadata, '$.severity') = 'critical'").count('* as count') as Promise<Array<{ count: string }>>,
    db('instance_events')
      .where({ instance_id: instanceId })
      .where('event_type', 'like', 'security:%')
      .orderBy('created_at', 'desc')
      .limit(5) as Promise<Array<Record<string, unknown>>>,
  ]);

  const byType: Record<string, number> = {};
  let totalEvents24h = 0;
  for (const row of typeRows) {
    const c = Number(row.count);
    byType[row.event_type] = c;
    totalEvents24h += c;
  }

  const bySeverity: Record<string, number> = {};
  for (const row of severityRows) {
    bySeverity[row.severity ?? 'unknown'] = Number(row.count);
  }

  const topEvents = topRows.map((row) => ({
    id: row.id as string,
    instanceId: row.instance_id as string,
    eventType: row.event_type as string,
    metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  }));

  const profile = (instance.security_profile as SecurityProfile) || 'standard';
  const config = typeof instance.config === 'string' ? JSON.parse(instance.config) : instance.config;

  const isStrictOrStandard = profile === 'strict' || profile === 'standard';
  const protection: ProtectionStatus = {
    securityProfile: profile,
    trustLayers: isStrictOrStandard,
    injectionDetection: profile === 'strict',
    outputFiltering: isStrictOrStandard,
    dlpScanning: profile === 'strict',
    configIntegrity: Boolean(config?.['openclaw.json']),
  };

  return {
    instanceId,
    totalEvents24h,
    bySeverity,
    byType,
    recentCritical: Number(criticalRow?.count ?? 0),
    protection,
    topEvents,
  };
}

export async function getSecuritySummary(userId: string): Promise<SecuritySummary> {
  const instanceIds = await db('instances')
    .where({ user_id: userId })
    .select('id');

  const ids = instanceIds.map((r: Record<string, unknown>) => r.id as string);
  if (ids.length === 0) {
    return { totalEvents: 0, bySeverity: {}, byType: {}, recentCritical: 0 };
  }

  const adapter2 = getAdapter();
  const severityExpr2 = adapter2.dialect === 'pg'
    ? db.raw("metadata->>'severity' as severity")
    : db.raw("json_extract(metadata, '$.severity') as severity");
  const severityGroup2 = adapter2.dialect === 'pg'
    ? db.raw("metadata->>'severity'")
    : db.raw("json_extract(metadata, '$.severity')");

  const baseQuery = () => db('instance_events')
    .whereIn('instance_id', ids)
    .where('event_type', 'like', 'security:%');

  const [typeRows, severityRows, [criticalRow]] = await Promise.all([
    baseQuery()
      .select('event_type')
      .count('* as count')
      .groupBy('event_type') as Promise<Array<{ event_type: string; count: string }>>,
    baseQuery()
      .select(severityExpr2)
      .count('* as count')
      .groupBy(severityGroup2) as Promise<Array<{ severity: string; count: string }>>,
    adapter2.dialect === 'pg'
      ? baseQuery()
          .whereRaw("metadata->>'severity' = 'critical'")
          .where('created_at', '>', adapter2.intervalAgo(db, 1, 'days'))
          .count('* as count') as Promise<Array<{ count: string }>>
      : baseQuery()
          .whereRaw("json_extract(metadata, '$.severity') = 'critical'")
          .where('created_at', '>', adapter2.intervalAgo(db, 1, 'days'))
          .count('* as count') as Promise<Array<{ count: string }>>,
  ]);

  const byType: Record<string, number> = {};
  let totalEvents = 0;
  for (const row of typeRows) {
    const c = Number(row.count);
    byType[row.event_type] = c;
    totalEvents += c;
  }

  const bySeverity: Record<string, number> = {};
  for (const row of severityRows) {
    bySeverity[row.severity ?? 'unknown'] = Number(row.count);
  }

  return {
    totalEvents,
    bySeverity,
    byType,
    recentCritical: Number(criticalRow?.count ?? 0),
  };
}
