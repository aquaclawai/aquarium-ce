import { getAgentType } from '../agent-types/registry.js';
import { listCredentials } from './credential-store.js';
import { getMetadata } from './metadata-store.js';
import type {
  Instance,
  GatewayModel,
  InstanceModelsResponse,
  InstanceProvider,
  InstanceProvidersResponse,
} from '@aquarium/shared';

interface RawGatewayModel {
  id?: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

function isModelsResult(v: unknown): v is { models?: RawGatewayModel[] } {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return !obj.models || Array.isArray(obj.models);
}

export async function getInstanceModels(instance: Instance): Promise<InstanceModelsResponse> {
  const agentType = getAgentType(instance.agentType);
  if (!agentType?.adapter?.translateRPC || !instance.controlEndpoint) {
    return { models: [], configuredProviders: [] };
  }

  const raw = await agentType.adapter.translateRPC({
    method: 'models.list',
    params: {},
    endpoint: instance.controlEndpoint,
    token: instance.authToken,
    instanceId: instance.id,
  });

  if (!isModelsResult(raw)) {
    return { models: [], configuredProviders: [] };
  }

  const credentials = await listCredentials(instance.id);
  const configuredProviders = [...new Set(credentials.map(c => c.provider))];
  const providerSet = new Set(configuredProviders);

  const models: GatewayModel[] = (raw.models ?? [])
    .filter((m): m is RawGatewayModel & { id: string } => typeof m.id === 'string')
    .map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: m.provider ?? '',
      contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
      reasoning: typeof m.reasoning === 'boolean' ? m.reasoning : undefined,
      usable: m.provider ? providerSet.has(m.provider) : false,
    }));

  return { models, configuredProviders };
}

/** Convert a provider id like 'google-vertex' into 'Google Vertex'. */
function prettifyProviderId(id: string): string {
  return id
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Returns providers grouped with their models for an instance.
 * Prefers live data from the running gateway (models.list RPC); falls back to the
 * bundled openclaw-metadata.json when the gateway is unreachable or returns nothing.
 * Auth methods always come from the metadata file (gateway does not expose them).
 */
export async function getInstanceProviders(instance: Instance): Promise<InstanceProvidersResponse> {
  const metadata = getMetadata();
  const credentials = await listCredentials(instance.id).catch(() => []);
  const configuredProviders = [...new Set(credentials.map(c => c.provider))];

  const buildMetadataProviders = (): InstanceProvider[] =>
    metadata.providers.map(pg => ({
      name: pg.id,
      displayName: pg.name,
      authMethods: pg.authMethods.map(a => ({ value: a.value, label: a.label, hint: a.hint, type: a.type })),
      models: pg.models
        .filter(m => m.recommended !== false)
        .map(m => ({ id: m.id, displayName: m.name, isDefault: m.recommended, contextWindow: m.contextWindow })),
    }));

  const agentType = getAgentType(instance.agentType);
  const canCallGateway =
    agentType?.adapter?.translateRPC &&
    instance.controlEndpoint &&
    instance.status === 'running';

  if (!canCallGateway) {
    return { providers: buildMetadataProviders(), configuredProviders, source: 'metadata' };
  }

  try {
    const raw = await agentType!.adapter!.translateRPC!({
      method: 'models.list',
      params: {},
      endpoint: instance.controlEndpoint!,
      token: instance.authToken,
      instanceId: instance.id,
    });

    if (!isModelsResult(raw) || !raw.models || raw.models.length === 0) {
      return { providers: buildMetadataProviders(), configuredProviders, source: 'metadata' };
    }

    // Group gateway models by provider; enrich with metadata where available
    const providerMap = new Map<string, InstanceProvider>();
    for (const m of raw.models) {
      if (!m.id || !m.provider) continue;
      const providerId = m.provider;
      let entry = providerMap.get(providerId);
      if (!entry) {
        const meta = metadata.providers.find(p => p.id === providerId);
        entry = {
          name: providerId,
          displayName: meta?.name ?? prettifyProviderId(providerId),
          authMethods: meta?.authMethods.map(a => ({ value: a.value, label: a.label, hint: a.hint, type: a.type })),
          models: [],
        };
        providerMap.set(providerId, entry);
      }
      const metaModel = metadata.providers
        .find(p => p.id === providerId)
        ?.models.find(mm => mm.id === m.id);
      entry.models.push({
        id: m.id,
        displayName: m.name ?? m.id,
        isDefault: metaModel?.recommended,
        contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
      });
    }

    const providers = [...providerMap.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    return { providers, configuredProviders, source: 'gateway' };
  } catch (err) {
    console.warn('[instance-providers] Gateway fetch failed, using metadata fallback:', err);
    return { providers: buildMetadataProviders(), configuredProviders, source: 'metadata' };
  }
}
