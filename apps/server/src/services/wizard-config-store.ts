import { db } from '../db/index.js';

export type WizardConfigType =
  | 'principles'
  | 'identity_templates'
  | 'temperature_presets'
  | 'context_options'
  | 'chat_suggestions';

export interface WizardConfigRow {
  id: string;
  config_type: WizardConfigType;
  agent_type: string;
  locale: string;
  items: unknown[];
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WizardConfigs {
  principles: string[];
  identityTemplates: string[];
  temperaturePresets: Array<{ key: string; label: string; value: number; description?: string }>;
  contextOptions: Array<{ value: number; label: string; description?: string }>;
  chatSuggestions: Array<{ key: string; text: string }>;
}

const EMPTY_CONFIGS: WizardConfigs = {
  principles: [],
  identityTemplates: [],
  temperaturePresets: [],
  contextOptions: [],
  chatSuggestions: [],
};

const CONFIG_TYPE_TO_KEY: Record<WizardConfigType, keyof WizardConfigs> = {
  principles: 'principles',
  identity_templates: 'identityTemplates',
  temperature_presets: 'temperaturePresets',
  context_options: 'contextOptions',
  chat_suggestions: 'chatSuggestions',
};

export async function getWizardConfigs(
  agentType: string,
  locale: string = 'zh-CN'
): Promise<WizardConfigs> {
  const rows = await db<WizardConfigRow>('wizard_configs')
    .where({ agent_type: agentType, is_active: true })
    .whereIn('locale', [locale, 'en-US'])
    .orderBy('sort_order', 'asc');

  const result: WizardConfigs = { ...EMPTY_CONFIGS };
  const seen = new Set<WizardConfigType>();

  for (const row of rows) {
    const configType = row.config_type as WizardConfigType;
    const key = CONFIG_TYPE_TO_KEY[configType];
    if (!key) continue;

    if (seen.has(configType) && row.locale !== locale) continue;

    (result as unknown as Record<string, unknown[]>)[key] = row.items;
    if (row.locale === locale) seen.add(configType);
  }

  return result;
}

export async function updateWizardConfig(
  id: string,
  items: unknown[]
): Promise<void> {
  await db('wizard_configs')
    .where({ id })
    .update({ items: JSON.stringify(items), updated_at: new Date() });
}

export async function addWizardConfig(
  configType: WizardConfigType,
  agentType: string,
  locale: string,
  items: unknown[]
): Promise<string> {
  const [{ id }] = await db('wizard_configs')
    .insert({
      config_type: configType,
      agent_type: agentType,
      locale,
      items: JSON.stringify(items),
    })
    .returning('id');
  return id;
}

export async function listWizardConfigs(
  agentType?: string,
  locale?: string
): Promise<WizardConfigRow[]> {
  let query = db<WizardConfigRow>('wizard_configs').where('is_active', true);

  if (agentType) {
    query = query.where('agent_type', agentType);
  }
  if (locale) {
    query = query.where('locale', locale);
  }

  return query.orderBy(['config_type', 'locale', 'sort_order']);
}

export async function getWizardConfigById(id: string): Promise<WizardConfigRow | null> {
  const row = await db<WizardConfigRow>('wizard_configs').where({ id }).first();
  return row ?? null;
}

export async function deleteWizardConfig(id: string): Promise<boolean> {
  const deleted = await db('wizard_configs').where({ id }).del();
  return deleted > 0;
}
