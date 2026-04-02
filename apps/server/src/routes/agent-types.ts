import { Router } from 'express';
import { listAgentTypes, getAgentType } from '../agent-types/registry.js';
// CE has no LiteLLM — no default platform model
const DEFAULT_MODEL_NAME = '';
import { fetchOpenRouterModels } from '../services/openrouter-models.js';
import { getWizardConfigs, type WizardConfigs } from '../services/wizard-config-store.js';
import type { ApiResponse, AgentTypeInfo } from '@aquarium/shared';

const router = Router();

interface PlatformModel {
  id: string;
  displayName: string;
  isDefault?: boolean;
}

async function fetchPlatformModels(): Promise<PlatformModel[]> {
  const models = await fetchOpenRouterModels();
  return models.map((m) => ({
    id: m.id,
    displayName: m.name,
    isDefault: m.id === DEFAULT_MODEL_NAME,
  }));
}

function parseLocale(acceptLanguage?: string): string {
  if (!acceptLanguage) return 'zh-CN';
  const primary = acceptLanguage.split(',')[0]?.trim();
  if (!primary) return 'zh-CN';
  if (primary.startsWith('en')) return 'en-US';
  if (primary.startsWith('zh')) return 'zh-CN';
  return 'zh-CN';
}

function toInfo(
  reg: ReturnType<typeof getAgentType>,
  platformModels?: PlatformModel[],
  dbConfigs?: WizardConfigs,
): AgentTypeInfo {
  const m = reg.manifest;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    defaultImageTag: m.image.defaultTag,
    availableTags: m.image.availableTags || [m.image.defaultTag],
    implemented: !!reg.adapter,
    capabilities: m.capabilities,
    configSchema: m.configSchema,
    wizard: m.wizard ? {
      providers: m.wizard.providers.map(p => ({
        name: p.name,
        displayName: p.displayName,
        models: p.models,
      })),
      defaultProvider: m.wizard.defaultProvider,
      defaultModel: m.wizard.defaultModel,
      platformModels: platformModels?.length ? platformModels : m.wizard.platformModels,
      channelSupport: m.wizard.channelSupport,
      defaultPrinciples: dbConfigs?.principles.length ? dbConfigs.principles : m.wizard.defaultPrinciples,
      identityTemplates: dbConfigs?.identityTemplates.length ? dbConfigs.identityTemplates : m.wizard.identityTemplates,
      temperaturePresets: dbConfigs?.temperaturePresets.length ? dbConfigs.temperaturePresets : m.wizard.temperaturePresets,
      contextOptions: dbConfigs?.contextOptions,
      chatSuggestions: dbConfigs?.chatSuggestions.length
        ? dbConfigs.chatSuggestions.map(s => s.text)
        : m.wizard.chatSuggestions,
    } : undefined,
    webUI: m.webUI,
    usageTracking: m.usageTracking,
  };
}

router.get('/', async (req, res) => {
  const locale = parseLocale(req.headers['accept-language']);
  const platformModels = await fetchPlatformModels();
  const types = await Promise.all(
    listAgentTypes().map(async reg => {
      const dbConfigs = await getWizardConfigs(reg.manifest.id, locale);
      return toInfo(reg, platformModels, dbConfigs);
    })
  );
  res.json({ ok: true, data: types } satisfies ApiResponse<AgentTypeInfo[]>);
});

router.get('/:typeId', async (req, res) => {
  try {
    const reg = getAgentType(req.params.typeId);
    const locale = parseLocale(req.headers['accept-language']);
    const [platformModels, dbConfigs] = await Promise.all([
      fetchPlatformModels(),
      getWizardConfigs(reg.manifest.id, locale),
    ]);
    res.json({ ok: true, data: toInfo(reg, platformModels, dbConfigs) } satisfies ApiResponse<AgentTypeInfo>);
  } catch {
    res.status(404).json({ ok: false, error: 'Agent type not found' } satisfies ApiResponse);
  }
});

export default router;
