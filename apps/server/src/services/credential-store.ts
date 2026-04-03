import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logCredentialAudit, type CredentialAuditSource } from './credential-audit.js';

export interface CredentialAuditContext {
  userId: string;
  source: CredentialAuditSource;
  ipAddress?: string | null;
}

const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  // Pad or hash the encryption key to 32 bytes
  const key = Buffer.alloc(32);
  Buffer.from(config.encryptionKey).copy(key);
  return key;
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, dataHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export interface StoredCredential {
  id: string;
  instance_id: string;
  provider: string;
  credential_type: string;
  encrypted_value: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function addCredential(
  instanceId: string,
  provider: string,
  credentialType: string,
  value: string,
  metadata: Record<string, unknown> = {},
  audit?: CredentialAuditContext,
): Promise<StoredCredential> {
  const encrypted = encrypt(value);

  const [row] = await db('instance_credentials')
    .insert({
      id: randomUUID(),
      instance_id: instanceId,
      provider,
      credential_type: credentialType,
      encrypted_value: encrypted,
      metadata: JSON.stringify(metadata),
    })
    .onConflict(['instance_id', 'provider', 'credential_type'])
    .merge({
      encrypted_value: encrypted,
      metadata: JSON.stringify(metadata),
      updated_at: db.fn.now(),
    })
    .returning('*');

  if (audit) {
    logCredentialAudit({
      action: 'create',
      userId: audit.userId,
      instanceId,
      provider,
      credentialType,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return row;
}

export async function listCredentials(instanceId: string): Promise<StoredCredential[]> {
  return db('instance_credentials').where({ instance_id: instanceId }).orderBy('provider');
}

export async function getDecryptedCredentials(instanceId: string): Promise<Array<{ provider: string; credentialType: string; value: string; metadata?: Record<string, unknown> }>> {
  const rows = await listCredentials(instanceId);
  return rows.map(r => ({
    provider: r.provider,
    credentialType: r.credential_type,
    value: decrypt(r.encrypted_value),
    metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : undefined,
  }));
}

export async function deleteCredential(credentialId: string, instanceId: string, audit?: CredentialAuditContext): Promise<boolean> {
  let provider = '';
  let credentialType = '';
  if (audit) {
    const existing = await db('instance_credentials').where({ id: credentialId, instance_id: instanceId }).first();
    if (existing) {
      provider = existing.provider;
      credentialType = existing.credential_type;
    }
  }

  const count = await db('instance_credentials')
    .where({ id: credentialId, instance_id: instanceId })
    .delete();

  if (count > 0 && audit && provider) {
    logCredentialAudit({
      action: 'delete',
      userId: audit.userId,
      instanceId,
      provider,
      credentialType,
      source: audit.source,
      ipAddress: audit.ipAddress,
    });
  }

  return count > 0;
}
