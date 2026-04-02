import { db } from '../db/index.js';

export type CredentialAuditAction = 'create' | 'read' | 'update' | 'delete' | 'resolve' | 'inject';
export type CredentialAuditSource = 'api' | 'seed_config' | 'reseed';

export interface CredentialAuditEntry {
  action: CredentialAuditAction;
  userId: string;
  instanceId?: string | null;
  provider: string;
  credentialType: string;
  source: CredentialAuditSource;
  ipAddress?: string | null;
}

export async function logCredentialAudit(entry: CredentialAuditEntry): Promise<void> {
  try {
    await db('credential_audit_log').insert({
      action: entry.action,
      user_id: entry.userId,
      instance_id: entry.instanceId ?? null,
      provider: entry.provider,
      credential_type: entry.credentialType,
      source: entry.source,
      ip_address: entry.ipAddress ?? null,
    });
  } catch {
    // Audit logging must never break the main flow
  }
}
