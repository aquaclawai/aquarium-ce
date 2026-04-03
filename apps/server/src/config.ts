import os from 'node:os';
import path from 'node:path';
import type { DeploymentTarget } from '@aquarium/shared';

export type Edition = 'ce' | 'ee';

const rawEdition = process.env.EDITION ?? 'ce';
if (rawEdition !== 'ce' && rawEdition !== 'ee') {
  throw new Error(`Invalid EDITION="${rawEdition}". Must be "ce" or "ee".`);
}
const edition = rawEdition as Edition;

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val === 'true';
}

const enableLitellm = parseBoolEnv('ENABLE_LITELLM', edition === 'ee');
const enableBilling = parseBoolEnv('ENABLE_BILLING', edition === 'ee');
const enableAdmin = parseBoolEnv('ENABLE_ADMIN', edition === 'ee');

export function validateEditionConfig(): void {
  if (edition === 'ce') {
    if (enableLitellm) {
      throw new Error('EDITION=ce does not support ENABLE_LITELLM=true. Set EDITION=ee or remove ENABLE_LITELLM.');
    }
    if (enableBilling) {
      throw new Error('EDITION=ce does not support ENABLE_BILLING=true. Set EDITION=ee or remove ENABLE_BILLING.');
    }
    if (enableAdmin) {
      throw new Error('EDITION=ce does not support ENABLE_ADMIN=true. Set EDITION=ee or remove ENABLE_ADMIN.');
    }
  }
}

validateEditionConfig();

export const config = {
  edition,
  isEE: edition === 'ee',
  isCE: edition === 'ce',
  enableLitellm,
  enableBilling,
  enableAdmin,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev-encryption-key-change-!!',
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY || '',
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '',
  },
  defaultDeploymentTarget: (process.env.DEPLOYMENT_TARGET || 'docker') as DeploymentTarget,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'aquarium',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  sqlite: {
    filename: process.env.AQUARIUM_DB_PATH || path.join(os.homedir(), '.aquarium', 'aquarium.db'),
  },
  docker: {
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    networkName: process.env.OPENCLAW_NETWORK || 'openclaw-net',
    portRangeStart: parseInt(process.env.OPENCLAW_PORT_RANGE_START || '19000', 10),
    portRangeEnd: parseInt(process.env.OPENCLAW_PORT_RANGE_END || '19999', 10),
    openclawImage: process.env.OPENCLAW_IMAGE || '',
    /** Container ID of the platform itself — used to connect to per-instance networks.
     *  Leave empty when the platform runs on the host (not inside Docker). */
    platformContainerId: process.env.PLATFORM_CONTAINER_ID || '',
    /** Container name/ID of the LiteLLM proxy — connected to per-instance networks
     *  so platform-mode instances can reach it via Docker DNS.
     *  Leave empty to skip (e.g. when LiteLLM is not used or is externally routable). */
    litellmContainerName: process.env.LITELLM_CONTAINER_NAME || '',
  },
  kubernetes: {
    namespace: process.env.K8S_NAMESPACE || 'aquarium',
    imageRegistry: process.env.K8S_IMAGE_REGISTRY || '',
    serviceAccountName: process.env.K8S_SERVICE_ACCOUNT || 'aquarium-sa',
  },
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  logRedactionEnabled: process.env.LOG_REDACTION_ENABLED !== 'false' && process.env.NODE_ENV === 'production',
  usdToCnyRate: parseFloat(process.env.USD_TO_CNY_RATE || '7.24'),
  /** Public-facing base URL for this aquarium instance (used in agent tool descriptions) */
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:3001',
  litellm: {
    proxyUrl: process.env.LITELLM_PROXY_URL || 'http://localhost:4000',
    /** URL reachable from inside Docker containers (via Docker DNS) */
    proxyInternalUrl: process.env.LITELLM_PROXY_INTERNAL_URL || 'http://openclaw-litellm:4000',
    masterKey: process.env.LITELLM_MASTER_KEY || 'sk-litellm-master-dev',
    defaultBudgetUsd: parseFloat(process.env.LITELLM_DEFAULT_BUDGET_USD || '10'),
    budgetDuration: process.env.LITELLM_BUDGET_DURATION || '30d',
    costMarkupPercent: parseFloat(process.env.LITELLM_COST_MARKUP_PERCENT || '0'),
  },
  salevoice: {
    clientId: process.env.SALEVOICE_CLIENT_ID || '84331702-f494-4d83-8366-740772115c03',
    apiUrl: process.env.SALEVOICE_API_URL || 'https://api.salevoice.ai',
  },
};
