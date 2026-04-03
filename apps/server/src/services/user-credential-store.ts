import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { encrypt, decrypt } from './credential-store.js';
import { logCredentialAudit, type CredentialAuditSource } from './credential-audit.js';
import type { UserCredential, UserCredentialExtended, CredentialType, CredentialRole, CredentialStatus } from '@aquarium/shared';

export interface UserCredentialAuditContext {
  source: CredentialAuditSource;
  ipAddress?: string | null;
}

interface StoredUserCredential {
  id: string;
  user_id: string;
  provider: string;
  credential_type: string;
  encrypted_value: string;
  display_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  role: string;
  status: string;
  usage_count: number;
}

function toUserCredential(row: StoredUserCredential): UserCredential {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    credentialType: row.credential_type as CredentialType,
    displayName: row.display_name,
    metadata: row.metadata ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function maskCredentialValue(encryptedValue: string): string {
  try {
    const raw = decrypt(encryptedValue);
    if (raw.length <= 8) return '****';
    return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
  } catch {
    return '****';
  }
}

function toUserCredentialExtended(row: StoredUserCredential): UserCredentialExtended {
  return {
    ...toUserCredential(row),
    role: (row.role ?? 'default') as CredentialRole,
    status: (row.status ?? 'active') as CredentialStatus,
    usageCount: row.usage_count ?? 0,
    maskedValue: maskCredentialValue(row.encrypted_value),
  };
}

export async function listUserCredentials(userId: string): Promise<UserCredentialExtended[]> {
  const rows: StoredUserCredential[] = await db('user_credentials')
    .where({ user_id: userId })
    .orderBy('provider');
  return rows.map(toUserCredentialExtended);
}

export async function addUserCredential(
  userId: string,
  provider: string,
  credentialType: string,
  value: string,
  displayName?: string,
  metadata: Record<string, unknown> = {},
  audit?: UserCredentialAuditContext,
): Promise<UserCredentialExtended> {
  const encryptedValue = encrypt(value);

  const [row]: StoredUserCredential[] = await db('user_credentials')
    .insert({
      id: randomUUID(),
      user_id: userId,
      provider,
      credential_type: credentialType,
      encrypted_value: encryptedValue,
      display_name: displayName ?? null,
      metadata: JSON.stringify(metadata),
    })
    .onConflict(['user_id', 'provider', 'credential_type'])
    .merge({
      encrypted_value: encryptedValue,
      display_name: displayName ?? null,
      metadata: JSON.stringify(metadata),
      updated_at: db.fn.now(),
    })
    .returning('*');

  if (audit) {
    logCredentialAudit({
      action: 'create',
      userId,
      provider,
      credentialType,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return toUserCredentialExtended(row);
}

export async function updateUserCredential(
  credentialId: string,
  userId: string,
  updates: { value?: string; displayName?: string; metadata?: Record<string, unknown>; role?: CredentialRole; status?: CredentialStatus },
  audit?: UserCredentialAuditContext,
): Promise<UserCredentialExtended | null> {
  const patch: Record<string, unknown> = { updated_at: db.fn.now() };
  if (updates.value !== undefined) {
    patch.encrypted_value = encrypt(updates.value);
  }
  if (updates.displayName !== undefined) {
    patch.display_name = updates.displayName;
  }
  if (updates.metadata !== undefined) {
    patch.metadata = JSON.stringify(updates.metadata);
  }
  if (updates.role !== undefined) {
    patch.role = updates.role;
  }
  if (updates.status !== undefined) {
    patch.status = updates.status;
  }

  const [row]: StoredUserCredential[] = await db('user_credentials')
    .where({ id: credentialId, user_id: userId })
    .update(patch)
    .returning('*');

  if (row && audit) {
    logCredentialAudit({
      action: 'update',
      userId,
      provider: row.provider,
      credentialType: row.credential_type,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return row ? toUserCredentialExtended(row) : null;
}

export async function deleteUserCredential(credentialId: string, userId: string, audit?: UserCredentialAuditContext): Promise<boolean> {
  let provider = '';
  let credentialType = '';
  if (audit) {
    const existing = await db('user_credentials').where({ id: credentialId, user_id: userId }).first();
    if (existing) {
      provider = existing.provider;
      credentialType = existing.credential_type;
    }
  }

  const count = await db('user_credentials')
    .where({ id: credentialId, user_id: userId })
    .delete();

  if (count > 0 && audit && provider) {
    logCredentialAudit({
      action: 'delete',
      userId,
      provider,
      credentialType,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return count > 0;
}

export async function updateCredentialStatus(
  credentialId: string,
  userId: string,
  status: CredentialStatus,
  audit?: UserCredentialAuditContext,
): Promise<UserCredentialExtended | null> {
  const [row]: StoredUserCredential[] = await db('user_credentials')
    .where({ id: credentialId, user_id: userId })
    .update({ status, updated_at: db.fn.now() })
    .returning('*');

  if (row && audit) {
    logCredentialAudit({
      action: 'update',
      userId,
      provider: row.provider,
      credentialType: row.credential_type,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return row ? toUserCredentialExtended(row) : null;
}

const CREDENTIAL_PLACEHOLDER_RE = /\$\{CREDENTIAL:([^:}]+):([^:}]+)\}/g;

export async function resolveCredential(
  instanceId: string,
  userId: string,
  provider: string,
  credentialType: string,
  audit?: UserCredentialAuditContext,
): Promise<string> {
  if (instanceId) {
    const instanceCred = await db('instance_credentials')
      .where({ instance_id: instanceId, provider, credential_type: credentialType })
      .first();
    if (instanceCred) {
      if (audit) {
        logCredentialAudit({
          action: 'resolve',
          userId,
          instanceId,
          provider,
          credentialType,
          source: audit.source,
          ipAddress: audit.ipAddress,
        });
      }
      return decrypt(instanceCred.encrypted_value);
    }
  }

  const userCred = await db('user_credentials')
    .where({ user_id: userId, provider, credential_type: credentialType })
    .first();
  if (userCred) {
    if (audit) {
      logCredentialAudit({
        action: 'resolve',
        userId,
        instanceId,
        provider,
        credentialType,
        source: audit.source,
        ipAddress: audit.ipAddress,
      });
    }
    return decrypt(userCred.encrypted_value);
  }

  throw new Error(`Missing credential: ${provider}/${credentialType}. Configure it in instance or user settings.`);
}

export async function resolveCredentialPlaceholders(
  mcpServers: Record<string, unknown>,
  instanceId: string,
  userId: string,
  audit?: UserCredentialAuditContext,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  async function resolveValue(value: string): Promise<string> {
    const matches: { full: string; provider: string; credType: string }[] = [];
    let m: RegExpExecArray | null;
    // Reset lastIndex since the regex is global
    CREDENTIAL_PLACEHOLDER_RE.lastIndex = 0;
    while ((m = CREDENTIAL_PLACEHOLDER_RE.exec(value)) !== null) {
      matches.push({ full: m[0], provider: m[1], credType: m[2] });
    }
    if (matches.length === 0) return value;

    let result = value;
    for (const { full, provider, credType } of matches) {
      const secret = await resolveCredential(instanceId, userId, provider, credType, audit);
      result = result.replace(full, secret);
    }
    return result;
  }

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      resolved[serverName] = serverConfig;
      continue;
    }

    const cfg = serverConfig as Record<string, unknown>;
    const resolvedCfg = { ...cfg };

    // Resolve credential placeholders in args (e.g. for mcp-remote --header values)
    const args = cfg.args as string[] | undefined;
    if (Array.isArray(args)) {
      const resolvedArgs: string[] = [];
      for (const arg of args) {
        resolvedArgs.push(typeof arg === 'string' ? await resolveValue(arg) : arg);
      }
      resolvedCfg.args = resolvedArgs;
    }

    const env = cfg.env as Record<string, string> | undefined;
    if (env && typeof env === 'object') {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        resolvedEnv[key] = await resolveValue(value);
      }
      resolvedCfg.env = resolvedEnv;
    }

    const headers = cfg.headers as Record<string, string> | undefined;
    if (headers && typeof headers === 'object') {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        resolvedHeaders[key] = await resolveValue(value);
      }
      resolvedCfg.headers = resolvedHeaders;
    }

    resolved[serverName] = resolvedCfg;
  }

  return resolved;
}
