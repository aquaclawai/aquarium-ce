import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';
import type { DaemonToken, DaemonTokenCreatedResponse } from '@aquarium/shared';

/**
 * Daemon token service — Phase 19-01.
 *
 * Responsibilities:
 *   • generateDaemonTokenPlaintext() — random `adt_<32 base64url>` (36 chars, 192-bit entropy)
 *   • hashDaemonToken(plaintext)     — sha256 hex (64 chars) of the FULL plaintext (incl. prefix)
 *   • issueDaemonToken(args)         — persist hash, return { token, plaintext } once
 *   • listDaemonTokens(workspaceId)  — workspace-scoped projection (no hash, no plaintext)
 *   • revokeDaemonToken(id, ws)      — soft delete via `revoked_at`; idempotent (false on repeat)
 *
 * Plaintext is only ever returned from `issueDaemonToken`. Everything else
 * returns the `DaemonToken` projection with zero leakage of `token_hash`.
 *
 * DAEMON-09 / AUTH3 / AUTH4 reference — see 19-RESEARCH §Token Generator & Storage Contract.
 */

const PREFIX = 'adt_';

export function generateDaemonTokenPlaintext(): string {
  return PREFIX + randomBytes(24).toString('base64url');
}

export function hashDaemonToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function rowToDaemonToken(row: Record<string, unknown>): DaemonToken {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    daemonId: (row.daemon_id as string) ?? null,
    createdByUserId: (row.created_by_user_id as string) ?? null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface IssueDaemonTokenArgs {
  workspaceId: string;
  name: string;
  expiresAt?: string | null;
  createdByUserId: string | null;
}

export async function issueDaemonToken(
  args: IssueDaemonTokenArgs,
  dbOverride?: Knex,
): Promise<DaemonTokenCreatedResponse> {
  const kx = dbOverride ?? defaultDb;
  const plaintext = generateDaemonTokenPlaintext();
  const tokenHash = hashDaemonToken(plaintext);
  const id = randomUUID();
  const now = new Date().toISOString();
  await kx('daemon_tokens').insert({
    id,
    workspace_id: args.workspaceId,
    token_hash: tokenHash,
    name: args.name,
    daemon_id: null,
    created_by_user_id: args.createdByUserId,
    expires_at: args.expiresAt ?? null,
    last_used_at: null,
    revoked_at: null,
    created_at: now,
    updated_at: now,
  });
  const row = await kx('daemon_tokens').where({ id }).first();
  if (!row) {
    throw new Error('issueDaemonToken: insert did not produce a row');
  }
  return { token: rowToDaemonToken(row), plaintext };
}

export async function listDaemonTokens(
  workspaceId: string,
  dbOverride?: Knex,
): Promise<DaemonToken[]> {
  const kx = dbOverride ?? defaultDb;
  const rows = await kx('daemon_tokens')
    .where({ workspace_id: workspaceId })
    .orderBy('created_at', 'desc');
  return rows.map((r: Record<string, unknown>) => rowToDaemonToken(r));
}

export async function revokeDaemonToken(
  id: string,
  workspaceId: string,
  dbOverride?: Knex,
): Promise<boolean> {
  const kx = dbOverride ?? defaultDb;
  const now = new Date().toISOString();
  const affected = await kx('daemon_tokens')
    .where({ id, workspace_id: workspaceId })
    .whereNull('revoked_at')
    .update({ revoked_at: now, updated_at: now });
  return affected > 0;
}
