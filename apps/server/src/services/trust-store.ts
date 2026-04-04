import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import type {
  TrustTier,
  TrustSignals,
  TrustOverride,
  TrustDecision,
  TrustEvaluation,
  ExtensionKind,
  PluginSource,
  ExtensionSkillSource,
} from '@aquarium/shared';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

function mapTrustOverrideRow(row: Record<string, unknown>): TrustOverride {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    extensionId: row.extension_id as string,
    extensionKind: row.extension_kind as ExtensionKind,
    action: 'allow',
    reason: row.reason as string,
    userId: row.user_id as string,
    credentialAccessAcknowledged: Boolean(row.credential_access_acknowledged),
    createdAt: row.created_at as string,
  };
}

// ─── Trust Tier Computation ───────────────────────────────────────────────────

/**
 * Compute a trust tier from the extension source and optional ClawHub signals.
 *
 * Tier rules (in priority order):
 *   bundled  — source.type === 'bundled'
 *   unscanned — signals null, virusTotalPassed null, or virusTotalPassed false
 *   verified  — verifiedPublisher && downloads > 100 && age > 90 days && VirusTotal passed
 *   community — everything else
 */
export function computeTrustTier(
  source: PluginSource | ExtensionSkillSource,
  signals: TrustSignals | null
): TrustTier {
  if (source.type === 'bundled') {
    return 'bundled';
  }

  if (signals === null) {
    return 'unscanned';
  }

  if (signals.virusTotalPassed === null || signals.virusTotalPassed === false) {
    return 'unscanned';
  }

  if (
    signals.verifiedPublisher &&
    signals.downloadCount > 100 &&
    signals.ageInDays > 90 &&
    signals.virusTotalPassed === true
  ) {
    return 'verified';
  }

  return 'community';
}

// ─── Policy Enforcement ───────────────────────────────────────────────────────

/**
 * Evaluate trust policy for an extension install attempt.
 *
 * Decision matrix:
 *   bundled   → allow (no ClawHub metadata)
 *   verified  → allow
 *   unscanned → block (no override possible — malware risk)
 *   community → block unless admin override exists
 */
export async function evaluateTrustPolicy(
  instanceId: string,
  extensionId: string,
  extensionKind: ExtensionKind,
  source: PluginSource | ExtensionSkillSource,
  signals: TrustSignals | null
): Promise<TrustEvaluation> {
  const tier = computeTrustTier(source, signals);

  if (tier === 'bundled' || tier === 'verified') {
    return {
      tier,
      decision: 'allow',
      signals: tier === 'bundled' ? null : signals,
      override: null,
      blockReason: null,
    };
  }

  if (tier === 'unscanned') {
    return {
      tier,
      decision: 'block',
      signals,
      override: null,
      blockReason:
        'Security scan not available or failed. This extension cannot be installed.',
    };
  }

  // community tier — check for admin override
  const override = await getTrustOverride(instanceId, extensionId, extensionKind);

  if (override !== null) {
    return {
      tier,
      decision: 'allow',
      signals,
      override,
      blockReason: null,
    };
  }

  return {
    tier,
    decision: 'block',
    signals,
    override: null,
    blockReason:
      'Community extension — not verified. An admin must approve before installation.',
  };
}

// ─── Override CRUD ────────────────────────────────────────────────────────────

/**
 * Create or update (upsert) a trust override for a specific extension+instance.
 * Requires credentialAccessAcknowledged === true — callers must confirm the user
 * understands the extension will have access to instance credentials.
 */
export async function createTrustOverride(
  instanceId: string,
  extensionId: string,
  extensionKind: ExtensionKind,
  reason: string,
  userId: string,
  credentialAccessAcknowledged: boolean
): Promise<TrustOverride> {
  if (!credentialAccessAcknowledged) {
    throw new Error('Credential access acknowledgment required');
  }

  const adapter = getAdapter();
  const id = adapter.generateId();
  const now = new Date().toISOString();

  if (adapter.dialect === 'sqlite') {
    await db.raw(
      `INSERT INTO trust_overrides
        (id, instance_id, extension_id, extension_kind, action, reason, user_id, credential_access_acknowledged, created_at)
       VALUES (?, ?, ?, ?, 'allow', ?, ?, ?, ?)
       ON CONFLICT (instance_id, extension_id, extension_kind)
       DO UPDATE SET reason = excluded.reason, user_id = excluded.user_id,
                     credential_access_acknowledged = excluded.credential_access_acknowledged,
                     created_at = excluded.created_at`,
      [id, instanceId, extensionId, extensionKind, reason, userId, credentialAccessAcknowledged ? 1 : 0, now]
    );
  } else {
    await db.raw(
      `INSERT INTO trust_overrides
        (id, instance_id, extension_id, extension_kind, action, reason, user_id, credential_access_acknowledged, created_at)
       VALUES (?, ?, ?, ?, 'allow', ?, ?, ?, ?)
       ON CONFLICT (instance_id, extension_id, extension_kind)
       DO UPDATE SET reason = EXCLUDED.reason, user_id = EXCLUDED.user_id,
                     credential_access_acknowledged = EXCLUDED.credential_access_acknowledged,
                     created_at = EXCLUDED.created_at`,
      [id, instanceId, extensionId, extensionKind, reason, userId, credentialAccessAcknowledged, now]
    );
  }

  const row = await getTrustOverride(instanceId, extensionId, extensionKind);
  if (row === null) {
    throw new Error('Failed to retrieve trust override after upsert');
  }
  return row;
}

/**
 * Retrieve a specific trust override or null if none exists.
 */
export async function getTrustOverride(
  instanceId: string,
  extensionId: string,
  extensionKind: ExtensionKind
): Promise<TrustOverride | null> {
  const row = await db('trust_overrides')
    .where({ instance_id: instanceId, extension_id: extensionId, extension_kind: extensionKind })
    .first();

  if (!row) return null;
  return mapTrustOverrideRow(row as Record<string, unknown>);
}

/**
 * Retrieve all trust overrides for an instance.
 */
export async function getTrustOverridesForInstance(
  instanceId: string
): Promise<TrustOverride[]> {
  const rows = await db('trust_overrides')
    .where({ instance_id: instanceId })
    .orderBy('created_at', 'desc');

  return (rows as Record<string, unknown>[]).map(mapTrustOverrideRow);
}
