import { getAgentType } from '../agent-types/registry.js';
import { listCredentials } from './credential-store.js';
import type { Instance, GatewayModel, InstanceModelsResponse } from '@aquarium/shared';

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
