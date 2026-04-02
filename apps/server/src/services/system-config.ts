import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import type { SystemConfig, PlatformApiKey, RateLimitConfig, UserRole } from '@aquarium/shared';

interface SettingRow {
  id: string;
  key: string;
  value: unknown;
  updated_at: string;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'platformName',
  'platformDescription',
  'timezone',
  'language',
  'enableUserRegistration',
  'rateLimitGeneral',
  'rateLimitLogin',
  'rateLimitCredentials',
  'corsOrigins',
  'webhookUrl',
  'apiKeys',
  'dataRetentionEventsDays',
  'dataRetentionAuthEventsDays',
  'dataRetentionAuditLogDays',
  'dataAutoCleanupEnabled',
  'defaultUserRole',
  'instanceQuotaPerUser',
]);

const COMPLEX_KEYS: ReadonlySet<string> = new Set([
  'rateLimitGeneral',
  'rateLimitLogin',
  'rateLimitCredentials',
  'corsOrigins',
  'apiKeys',
]);

export async function getConfig(): Promise<SystemConfig> {
  const rows: SettingRow[] = await db('system_settings').select('*');
  const config: Record<string, unknown> = {};
  for (const row of rows) {
    if (ALLOWED_KEYS.has(row.key)) {
      config[row.key] = row.value;
    }
  }
  return config as SystemConfig;
}

export async function updateConfig(settings: Partial<SystemConfig>): Promise<SystemConfig> {
  for (const [key, value] of Object.entries(settings)) {
    if (!ALLOWED_KEYS.has(key)) continue;

    await db('system_settings')
      .insert({
        key,
        value: JSON.stringify(value),
        updated_at: db.fn.now(),
      })
      .onConflict('key')
      .merge({
        value: JSON.stringify(value),
        updated_at: db.fn.now(),
      });
  }
  return getConfig();
}

export interface ApiRateLimits {
  general: RateLimitConfig;
  login: RateLimitConfig;
  credentials: RateLimitConfig;
}

const DEFAULT_RATE_LIMITS: ApiRateLimits = {
  general: { windowMs: 15 * 60 * 1000, max: 300 },
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  credentials: { windowMs: 60 * 1000, max: 30 },
};

export async function getApiRateLimits(): Promise<ApiRateLimits> {
  const cfg = await getConfig();
  return {
    general: cfg.rateLimitGeneral ?? DEFAULT_RATE_LIMITS.general,
    login: cfg.rateLimitLogin ?? DEFAULT_RATE_LIMITS.login,
    credentials: cfg.rateLimitCredentials ?? DEFAULT_RATE_LIMITS.credentials,
  };
}

export async function getCorsOrigins(): Promise<string[]> {
  const cfg = await getConfig();
  return cfg.corsOrigins ?? [];
}

export function generateApiKey(): { key: string; prefix: string } {
  const raw = randomBytes(32).toString('base64url');
  const key = `ocp_${raw}`;
  const prefix = key.slice(0, 12);
  return { key, prefix };
}
