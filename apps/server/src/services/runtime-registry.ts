import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import type { Runtime, RuntimeKind, RuntimeProvider, RuntimeDeviceInfo } from '@aquarium/shared';

/**
 * Runtime registry service — read + write for the `runtimes` table.
 *
 * Responsibilities (Phase 16):
 *   • listAll(workspaceId)        — unified hosted + daemon list with derived status (RT-01, RT-04)
 *   • getById(id)                 — stub for Phase 25 detail UI
 *   • upsertHostedRuntime(...)    — hosted mirror write path (plan 16-02)
 *   • upsertDaemonRuntime(...)    — daemon register write path (Phase 19; shape frozen now)
 *   • updateHeartbeat(id)         — Phase 19 heartbeat path (shape frozen now)
 *   • setRuntimeOffline(id)       — plan 16-03 offline sweeper per-row transition
 *
 * HARD constraints enforced here:
 *   • RT-04 / ST1 — listAll derives runtime.status for kind='hosted_instance' via
 *     LEFT JOIN on instances (CASE WHEN i.status='running' THEN 'online' ...).
 *     `r.status` is NEVER projected for hosted rows. Writes to `r.status` for
 *     hosted rows are prohibited (the only hosted write path is INSERT-with-placeholder
 *     inside upsertHostedRuntime; there is NO hosted UPDATE of r.status).
 *   • CE1 — listAll filters by workspace_id (CE passes 'AQ'; EE passes req.auth.workspaceId).
 */

function toRuntime(row: Record<string, unknown>): Runtime {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    kind: row.kind as RuntimeKind,
    provider: row.provider as RuntimeProvider,
    status: row.status as Runtime['status'],
    daemonId: (row.daemon_id as string) ?? null,
    deviceInfo: row.device_info
      ? (adapter.parseJson<RuntimeDeviceInfo>(row.device_info) ?? null)
      : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    instanceId: (row.instance_id as string) ?? null,
    metadata: row.metadata
      ? (adapter.parseJson<Record<string, unknown>>(row.metadata) ?? {})
      : {},
    ownerUserId: (row.owner_user_id as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * List all runtimes for a workspace with kind-aware derived status.
 *
 * hosted_instance rows: status is derived from the joined `instances.status`.
 * daemon rows: status uses the stored `runtimes.status` column verbatim.
 *
 * The CASE expression is identical on SQLite 3.38+ and Postgres 12+; no
 * dialect branching is needed. The LEFT JOIN preserves daemon rows where
 * instance_id IS NULL (the join matches nothing, CASE falls through).
 */
export async function listAll(workspaceId: string): Promise<Runtime[]> {
  const rows = await db('runtimes as r')
    .leftJoin('instances as i', 'r.instance_id', 'i.id')
    .where('r.workspace_id', workspaceId)
    .select(
      'r.id',
      'r.workspace_id',
      'r.name',
      'r.kind',
      'r.provider',
      'r.daemon_id',
      'r.device_info',
      'r.last_heartbeat_at',
      'r.instance_id',
      'r.metadata',
      'r.owner_user_id',
      'r.created_at',
      'r.updated_at',
      db.raw(`
        CASE
          WHEN r.kind = 'hosted_instance' THEN
            CASE
              WHEN i.status = 'running' THEN 'online'
              WHEN i.status = 'error' THEN 'error'
              ELSE 'offline'
            END
          ELSE r.status
        END as status
      `),
    )
    .orderBy('r.created_at', 'desc');

  return rows.map((row: Record<string, unknown>) => toRuntime(row));
}

/** Fetch a single runtime by id (workspace-scoped) with derived status. Used by Phase 25. */
export async function getById(workspaceId: string, id: string): Promise<Runtime | null> {
  const row = await db('runtimes as r')
    .leftJoin('instances as i', 'r.instance_id', 'i.id')
    .where('r.workspace_id', workspaceId)
    .andWhere('r.id', id)
    .select(
      'r.id',
      'r.workspace_id',
      'r.name',
      'r.kind',
      'r.provider',
      'r.daemon_id',
      'r.device_info',
      'r.last_heartbeat_at',
      'r.instance_id',
      'r.metadata',
      'r.owner_user_id',
      'r.created_at',
      'r.updated_at',
      db.raw(`
        CASE
          WHEN r.kind = 'hosted_instance' THEN
            CASE
              WHEN i.status = 'running' THEN 'online'
              WHEN i.status = 'error' THEN 'error'
              ELSE 'offline'
            END
          ELSE r.status
        END as status
      `),
    )
    .first();
  return row ? toRuntime(row as Record<string, unknown>) : null;
}

export interface UpsertHostedRuntimeArgs {
  workspaceId: string;
  instanceId: string;
  name: string;
  ownerUserId: string | null;
}

/**
 * Idempotent mirror-runtime write for a hosted Aquarium instance.
 *
 * - INSERT sets `status='offline'` placeholder (migration 004 default); this column
 *   is NEVER READ for hosted rows (listAll uses the JOIN-derived CASE WHEN).
 * - ON CONFLICT (instance_id) updates `name` + `updated_at` only; never touches
 *   `status`, preserving the ST1 HARD constraint ("InstanceManager is the only
 *   writer of instance-derived status").
 * - The UNIQUE(instance_id) partial index from migration 009 makes this safe
 *   under concurrent boot-reconcile + create-hook races.
 */
export async function upsertHostedRuntime(args: UpsertHostedRuntimeArgs): Promise<void> {
  const adapter = getAdapter();
  // SQLite does not support `ON CONFLICT(instance_id)` against a *partial*
  // UNIQUE index unless the conflict target's WHERE predicate is supplied —
  // and knex does not expose that option. We achieve idempotency with a
  // transactional UPDATE-then-INSERT instead: the UPDATE touches only
  // `name` + `updated_at` (never `status`, preserving ST1 HARD), and the
  // partial UNIQUE(instance_id) from migration 009 still guarantees at-most-one
  // hosted mirror per instance under concurrent callers (second INSERT fails
  // the UNIQUE and is handled inside the transaction).
  await db.transaction(async (trx) => {
    const existing = await trx('runtimes')
      .where({ instance_id: args.instanceId })
      .first('id');
    if (existing) {
      await trx('runtimes')
        .where({ id: existing.id as string })
        .update({ name: args.name, updated_at: db.fn.now() });
      return;
    }
    await trx('runtimes').insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name,
      kind: 'hosted_instance',
      provider: 'hosted',
      status: 'offline', // placeholder; never projected for hosted rows (see listAll CASE)
      daemon_id: null,
      device_info: null,
      last_heartbeat_at: null,
      instance_id: args.instanceId,
      metadata: adapter.jsonValue({}),
      owner_user_id: args.ownerUserId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  });
}

export interface UpsertDaemonRuntimeArgs {
  workspaceId: string;
  daemonId: string;
  provider: RuntimeProvider;
  name: string;
  deviceInfo: RuntimeDeviceInfo | null;
  ownerUserId: string | null;
  kind: Extract<RuntimeKind, 'local_daemon' | 'external_cloud_daemon'>;
}

/**
 * Idempotent write for a daemon runtime.
 *
 * Uses the existing UNIQUE(workspace_id, daemon_id, provider) from migration 004.
 * Called by Phase 19's /api/daemon/register — body shape frozen in Phase 16 so
 * Phase 19 has no contract drift. Heartbeat is set to NOW() on every call.
 */
export async function upsertDaemonRuntime(args: UpsertDaemonRuntimeArgs): Promise<string> {
  const adapter = getAdapter();
  const id = randomUUID();
  const now = new Date().toISOString();

  await db('runtimes')
    .insert({
      id,
      workspace_id: args.workspaceId,
      name: args.name,
      kind: args.kind,
      provider: args.provider,
      status: 'online',
      daemon_id: args.daemonId,
      device_info: args.deviceInfo ? adapter.jsonValue(args.deviceInfo) : null,
      last_heartbeat_at: now,
      instance_id: null,
      metadata: adapter.jsonValue({}),
      owner_user_id: args.ownerUserId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['workspace_id', 'daemon_id', 'provider'])
    .merge({
      name: args.name,
      device_info: args.deviceInfo ? adapter.jsonValue(args.deviceInfo) : null,
      status: 'online',
      last_heartbeat_at: now,
      updated_at: db.fn.now(),
    });

  // Read back the canonical row id (the one we just inserted OR the pre-existing one).
  const row = await db('runtimes')
    .where({
      workspace_id: args.workspaceId,
      daemon_id: args.daemonId,
      provider: args.provider,
    })
    .first();
  return row ? (row.id as string) : id;
}

/**
 * Touch last_heartbeat_at for a daemon runtime — Phase 19 heartbeat target.
 * Does NOT alter kind / provider / device_info. If the row is marked offline
 * but starts heartbeating again, flip status back to 'online' (a daemon can
 * come back after the sweeper marked it offline).
 */
export async function updateHeartbeat(id: string): Promise<void> {
  await db('runtimes')
    .where({ id })
    .whereIn('kind', ['local_daemon', 'external_cloud_daemon'])
    .update({
      last_heartbeat_at: new Date().toISOString(),
      status: 'online',
      updated_at: db.fn.now(),
    });
}

/**
 * Plan 16-03 offline sweeper target — transition a daemon runtime to offline.
 * The `whereIn('kind', [...daemon kinds only])` guard is defence-in-depth:
 * the sweeper query already filters by kind, but this guard ensures a caller
 * cannot accidentally flip a hosted_instance runtime's `r.status` (violating ST1).
 */
export async function setRuntimeOffline(id: string): Promise<void> {
  await db('runtimes')
    .where({ id })
    .whereIn('kind', ['local_daemon', 'external_cloud_daemon'])
    .update({
      status: 'offline',
      updated_at: db.fn.now(),
    });
}
