import { db } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import { upsertHostedRuntime } from '../services/runtime-registry.js';
import type { Instance } from '@aquarium/shared';

/**
 * Runtime-bridge — mirrors Aquarium `instances` rows into the unified
 * `runtimes` table as `kind='hosted_instance'` rows.
 *
 * Design (from 16-RESEARCH.md):
 *   • Explicit function-call hooks at 4 InstanceManager write sites
 *     (createInstance, cloneInstance, updateInstanceConfig rename,
 *     patchGatewayConfig rename) fire in <50ms — meets the RT-03 "within 2s" SLA.
 *   • reconcileFromInstances() is idempotent (UPSERT on partial UNIQUE(instance_id))
 *     and runs at boot (step 9a in server-core.ts) and every 10s thereafter.
 *   • Instance deletion is NOT hooked here — FK CASCADE on runtimes.instance_id
 *     (migration 004) removes the mirror row automatically.
 *
 * HARD constraints (enforced by grep in plan verification):
 *   • ST1 — this file NEVER writes to `instances.*` (SELECT only). A `grep -n
 *     "db('instances').*update\\|db('instances').*insert\\|db('instances').*delete"`
 *     against this file MUST return zero matches.
 *   • ST1 — this file NEVER writes to `runtimes.status` for hosted rows directly.
 *     All hosted writes go through `upsertHostedRuntime` which itself never updates
 *     `status` post-INSERT (see 16-01 plan acceptance criteria).
 */

const DEFAULT_WORKSPACE_ID = 'AQ';

/**
 * Fired by InstanceManager after a new instances row is inserted.
 * Upserts the mirror runtime and broadcasts a WS `runtime:created` event
 * for Phase 25 UI consumers (safe no-op when no subscriber).
 */
export async function onInstanceCreated(instance: Instance): Promise<void> {
  await upsertHostedRuntime({
    workspaceId: DEFAULT_WORKSPACE_ID,
    instanceId: instance.id,
    name: instance.name,
    ownerUserId: instance.userId,
  });

  // Phase 25 UI-ready broadcast. Uses instance.id as the channel key so
  // existing subscribers to that channel (e.g. dashboard) see it; a dedicated
  // workspace-scoped channel is a Phase 25 concern.
  broadcast(instance.id, {
    type: 'runtime:created',
    instanceId: instance.id,
    payload: { name: instance.name, kind: 'hosted_instance' },
  });
}

/**
 * Fired by InstanceManager AFTER an instance rename has been committed to
 * the DB. `newName` is the post-update name (read from the patch that was
 * already applied). This function is a thin pass-through to the registry;
 * it exists as a hook surface so Phase 20 can later add "also rename the
 * hosted task-worker label" without touching InstanceManager again.
 */
export async function onInstanceRenamed(instanceId: string, newName: string): Promise<void> {
  await upsertHostedRuntime({
    workspaceId: DEFAULT_WORKSPACE_ID,
    instanceId,
    name: newName,
    ownerUserId: null, // unchanged — UPSERT.merge() only touches name + updated_at
  });

  broadcast(instanceId, {
    type: 'runtime:updated',
    instanceId,
    payload: { name: newName },
  });
}

/**
 * Boot step 9a (from server-core.ts wiring in plan 16-03) + 10s safety-net loop.
 *
 * Idempotent: UPSERT keyed on `instance_id` (partial UNIQUE from migration 009).
 * Reads `instances` READ-ONLY (no column updates, no deletes, no inserts against
 * the instances table from this file — ST1 HARD).
 *
 * If a hook missed a write (e.g. future refactor adds a new InstanceManager
 * path without calling onInstanceCreated), this loop reconciles within one
 * tick — maximum drift window is ~10 seconds.
 */
export async function reconcileFromInstances(): Promise<void> {
  // READ ONLY against instances — no .update, no .insert, no .delete.
  const rows = await db('instances').select('id', 'user_id', 'name');

  for (const row of rows) {
    try {
      await upsertHostedRuntime({
        workspaceId: DEFAULT_WORKSPACE_ID,
        instanceId: row.id as string,
        name: row.name as string,
        ownerUserId: (row.user_id as string) ?? null,
      });
    } catch (err) {
      // Do not let one bad row block the whole reconcile. Log and continue.
      console.warn(
        `[runtime-bridge] reconcile failed for instance ${String(row.id)}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
