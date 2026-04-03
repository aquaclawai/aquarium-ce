import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { config } from '../config.js';
import type { ExtensionKind, ExtensionOperation } from '@aquarium/shared';

// ─── Custom Error ────────────────────────────────────────────────────────────

export class LockConflictError extends Error {
  readonly status = 409 as const;
  readonly activeOperation: ExtensionOperation;

  constructor(activeOperation: ExtensionOperation) {
    super(
      `Instance ${activeOperation.instanceId} already has an active ${activeOperation.operationType} operation on "${activeOperation.targetExtension}"`
    );
    this.name = 'LockConflictError';
    this.activeOperation = activeOperation;
  }
}

// ─── Row Mapping ─────────────────────────────────────────────────────────────

function mapOperationRow(row: Record<string, unknown>): ExtensionOperation {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    fencingToken: row.fencing_token as string,
    operationType: row.operation_type as string,
    targetExtension: row.target_extension as string,
    extensionKind: row.extension_kind as ExtensionKind,
    pendingOwner: row.pending_owner as string,
    cancelRequested: Boolean(row.cancel_requested),
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    result: (row.result as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  };
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Acquire the per-instance mutation lock by INSERTing into extension_operations.
 * The partial unique index `idx_one_active_op` (instance_id WHERE completed_at IS NULL)
 * enforces that only one active operation can exist per instance at a time.
 *
 * Returns { fencingToken, operationId } on success.
 * Throws LockConflictError (status 409) if another operation is already active.
 */
export async function acquireLock(
  instanceId: string,
  operationType: string,
  targetExtension: string,
  extensionKind: ExtensionKind,
): Promise<{ fencingToken: string; operationId: string }> {
  const adapter = getAdapter();
  const operationId = adapter.generateId();
  const fencingToken = randomUUID();

  try {
    await db('extension_operations').insert({
      id: operationId,
      instance_id: instanceId,
      fencing_token: fencingToken,
      operation_type: operationType,
      target_extension: targetExtension,
      extension_kind: extensionKind,
      pending_owner: config.serverSessionId,
      cancel_requested: 0,
      // started_at uses the column default (knex.fn.now())
      completed_at: null,
      result: null,
      error_message: null,
    });
  } catch (err: unknown) {
    const isUnique =
      (err instanceof Error &&
        (err.message.includes('UNIQUE constraint failed') ||
          err.message.includes('unique constraint') ||
          (err as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_UNIQUE')) ||
      ((err as Record<string, unknown>).code === 'SQLITE_CONSTRAINT_UNIQUE');

    if (isUnique) {
      // Query the existing active operation for the conflict payload
      const existing = await db('extension_operations')
        .where({ instance_id: instanceId })
        .whereNull('completed_at')
        .first() as Record<string, unknown> | undefined;

      if (existing) {
        throw new LockConflictError(mapOperationRow(existing));
      }
      // Extremely rare: the conflict row disappeared between INSERT and SELECT
      throw new LockConflictError({
        id: 'unknown',
        instanceId,
        fencingToken: 'unknown',
        operationType: 'unknown',
        targetExtension: 'unknown',
        extensionKind: 'skill',
        pendingOwner: 'unknown',
        cancelRequested: false,
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        errorMessage: null,
      });
    }

    throw err;
  }

  return { fencingToken, operationId };
}

/**
 * Release the lock by marking the operation complete.
 * Uses fencing token to prevent stale releases (wrong token → no-op + warning).
 */
export async function releaseLock(
  operationId: string,
  fencingToken: string,
  result: 'success' | 'failed' | 'rolled-back' | 'cancelled' | 'crashed',
  errorMessage?: string,
): Promise<void> {
  const count = await db('extension_operations')
    .where({ id: operationId, fencing_token: fencingToken })
    .whereNull('completed_at')
    .update({
      completed_at: db.fn.now(),
      result,
      error_message: errorMessage ?? null,
    });

  if (count === 0) {
    console.warn(
      `[extension-lock] releaseLock no-op: operationId=${operationId} (stale token or already released)`
    );
  }
}

/**
 * Check whether a cancel has been requested for this operation.
 * Called at RPC checkpoints inside long-running operations.
 */
export async function checkCancelRequested(operationId: string): Promise<boolean> {
  const row = await db('extension_operations')
    .select('cancel_requested')
    .where({ id: operationId })
    .first() as Record<string, unknown> | undefined;

  return Boolean(row?.cancel_requested);
}

/**
 * Request cancellation of an in-flight operation.
 * The operation's executor polls checkCancelRequested() to honor it.
 * Returns true if the operation was found and flagged, false if already complete.
 */
export async function requestCancel(operationId: string): Promise<boolean> {
  const count = await db('extension_operations')
    .where({ id: operationId })
    .whereNull('completed_at')
    .update({ cancel_requested: 1 });

  return count > 0;
}

/**
 * Get the currently active (incomplete) operation for an instance, if any.
 */
export async function getActiveOperation(instanceId: string): Promise<ExtensionOperation | null> {
  const row = await db('extension_operations')
    .where({ instance_id: instanceId })
    .whereNull('completed_at')
    .first() as Record<string, unknown> | undefined;

  return row ? mapOperationRow(row) : null;
}

/**
 * Mark operations owned by other server sessions as crashed.
 * Called at server startup to clean up orphaned locks from previous crashes.
 * Returns the count of affected rows.
 */
export async function cleanupOrphanedOperations(): Promise<number> {
  // First, fetch the orphaned ops for logging
  const orphans = await db('extension_operations')
    .whereNull('completed_at')
    .where('pending_owner', '!=', config.serverSessionId)
    .select('id', 'instance_id', 'operation_type', 'target_extension', 'pending_owner') as Array<Record<string, unknown>>;

  for (const op of orphans) {
    console.warn(
      `[extension-lock] Marking orphaned operation as crashed: id=${op.id} instance=${op.instance_id} type=${op.operation_type} owner=${op.pending_owner}`
    );
  }

  const count = await db('extension_operations')
    .whereNull('completed_at')
    .where('pending_owner', '!=', config.serverSessionId)
    .update({
      completed_at: db.fn.now(),
      result: 'crashed',
    });

  return count;
}
