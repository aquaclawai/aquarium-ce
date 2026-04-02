import type { ErrorObject, ValidateFunction } from 'ajv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Ajv = require('ajv').default as new (opts: { allErrors?: boolean; strict?: boolean }) => {
  compile(schema: object): ValidateFunction;
};

const ajv = new Ajv({ allErrors: true, strict: false });

const validatorCache = new Map<string, {
  validate: ValidateFunction;
  cachedAt: number;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearSchemaCache(instanceId: string): void {
  validatorCache.delete(instanceId);
}

// Platform-level fields stored in instance.config but NOT part of the gateway schema.
// These must be stripped before validating against the gateway's JSON schema
// (which uses additionalProperties: false).
const PLATFORM_CONFIG_KEYS = new Set([
  'defaultProvider', 'defaultModel', 'provider', 'model',
  'billingMode', 'imageTag', 'securityProfile',
]);

function stripPlatformFields(config: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!PLATFORM_CONFIG_KEYS.has(key)) {
      stripped[key] = value;
    }
  }
  return stripped;
}

export async function validateConfigPatch(
  instanceId: string,
  mergedConfig: Record<string, unknown>,
  fetchSchema: () => Promise<object | null>,
  options?: { skipFullSchemaValidation?: boolean },
): Promise<{ valid: boolean; errors?: string[] }> {
  // For PATCH operations, skip strict gateway schema validation.
  // The gateway validates on push via config.patch RPC.
  if (options?.skipFullSchemaValidation) {
    return { valid: true };
  }

  let cached = validatorCache.get(instanceId);

  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    let schema: object | null;
    try {
      schema = await fetchSchema();
    } catch {
      // Schema fetch failed -- graceful degradation, allow the patch through
      return { valid: true };
    }

    if (!schema) {
      // No schema available -- skip validation (graceful degradation)
      return { valid: true };
    }

    const validate = ajv.compile(schema);
    cached = { validate, cachedAt: Date.now() };
    validatorCache.set(instanceId, cached);
  }

  // Strip platform-only fields before validating against gateway schema
  const gatewayConfig = stripPlatformFields(mergedConfig);
  const valid = cached.validate(gatewayConfig) as boolean;
  if (!valid) {
    const errors = (cached.validate.errors || []).map(
      (e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`,
    );
    return { valid: false, errors };
  }

  return { valid: true };
}
