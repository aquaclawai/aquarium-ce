import type { ChannelRegistryEntry, ChannelRegistryItem, ChannelStatusDetail, PluginSource } from '@aquarium/shared';
import { CHANNEL_REQUIRED_FIELDS } from '../routes/channels.js';
import { listCredentials } from './credential-store.js';
import type { Instance } from '@aquarium/shared';

// Channels with dedicated routes (not in CHANNEL_REQUIRED_FIELDS)
const DEDICATED_ROUTE_CHANNELS = new Set(['telegram', 'whatsapp']);

/**
 * Static UI metadata for all known channels.
 * A channel only appears in the final registry if it also has backend route support
 * (present in CHANNEL_REQUIRED_FIELDS or DEDICATED_ROUTE_CHANNELS).
 */
const CHANNEL_UI_METADATA: ChannelRegistryEntry[] = [
  // ─── Popular ───
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    labelKey: 'channels.whatsapp.label',
    description: 'Connect via QR code — uses your existing WhatsApp account as a linked device.',
    descriptionKey: 'channels.whatsapp.description',
    setupType: 'qr',
    pluginRequired: true,
    pluginInstall: { pluginId: 'whatsapp', source: { type: 'npm', spec: '@openclaw/whatsapp' } as PluginSource },
    category: 'popular',
    order: 1,
    fields: [],
    helpUrl: 'https://docs.openclaw.ai/channels/whatsapp',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: false, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'whatsapp',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    labelKey: 'channels.telegram.label',
    description: 'Create a bot via @BotFather and paste the token.',
    descriptionKey: 'channels.telegram.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'popular',
    order: 2,
    fields: [
      {
        key: 'botToken', label: 'Bot Token', labelKey: 'channels.telegram.fields.botToken',
        type: 'password', placeholder: '123456789:ABCdefGHI...', placeholderKey: 'channels.telegram.fields.botTokenPlaceholder',
        required: true, helpText: 'Get this from @BotFather on Telegram.',
        helpTextKey: 'channels.telegram.fields.botTokenHelp', helpUrl: 'https://t.me/BotFather',
        pattern: '^\\d+:[A-Za-z0-9_-]+$', patternError: 'Token should look like 123456789:ABCdef...',
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/telegram',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'telegram',
    serverValidation: { botToken: { pattern: '^\\d+:[A-Za-z0-9_-]+$', message: 'Invalid Telegram bot token format' } },
  },
  {
    id: 'discord',
    label: 'Discord',
    labelKey: 'channels.discord.label',
    description: 'Create a bot in the Discord Developer Portal.',
    descriptionKey: 'channels.discord.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'popular',
    order: 3,
    fields: [
      {
        key: 'token', label: 'Bot Token', labelKey: 'channels.discord.fields.token',
        type: 'password', required: true,
        helpText: 'From Discord Developer Portal > Bot > Token.',
        helpTextKey: 'channels.discord.fields.tokenHelp',
        helpUrl: 'https://discord.com/developers/applications',
      },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/discord',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'discord',
  },

  // ─── Enterprise ───
  {
    id: 'feishu',
    label: '飞书 / Lark',
    labelKey: 'channels.feishu.label',
    description: 'Connect via Feishu Open Platform enterprise app.',
    descriptionKey: 'channels.feishu.description',
    setupType: 'token',
    pluginRequired: true,
    pluginInstall: { pluginId: 'feishu', source: { type: 'npm', spec: '@openclaw/feishu' } as PluginSource },
    category: 'enterprise',
    order: 10,
    fields: [
      { key: 'appId', label: 'App ID', labelKey: 'channels.feishu.fields.appId', type: 'text', required: true, helpText: 'From Feishu Open Platform console.', helpTextKey: 'channels.feishu.fields.appIdHelp', helpUrl: 'https://open.feishu.cn/app' },
      { key: 'appSecret', label: 'App Secret', labelKey: 'channels.feishu.fields.appSecret', type: 'password', required: true },
      { key: 'domain', label: 'Domain', labelKey: 'channels.feishu.fields.domain', type: 'select', required: false, options: [{ value: 'feishu', label: '飞书 (China)', labelKey: 'channels.feishu.fields.domainFeishu' }, { value: 'lark', label: 'Lark (Global)', labelKey: 'channels.feishu.fields.domainLark' }] },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/feishu',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'feishu',
  },
  {
    id: 'slack',
    label: 'Slack',
    labelKey: 'channels.slack.label',
    description: 'Connect via Slack Socket Mode with a Slack App.',
    descriptionKey: 'channels.slack.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 11,
    fields: [
      { key: 'appToken', label: 'App Token', labelKey: 'channels.slack.fields.appToken', type: 'password', placeholder: 'xapp-...', required: true, helpText: 'App-Level Token (starts with xapp-).', helpTextKey: 'channels.slack.fields.appTokenHelp', helpUrl: 'https://api.slack.com/apps', pattern: '^xapp-', patternError: 'App Token must start with xapp-' },
      { key: 'botToken', label: 'Bot Token', labelKey: 'channels.slack.fields.botToken', type: 'password', placeholder: 'xoxb-...', required: true, helpText: 'Bot User OAuth Token (starts with xoxb-).', helpTextKey: 'channels.slack.fields.botTokenHelp', pattern: '^xoxb-', patternError: 'Bot Token must start with xoxb-' },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/slack',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: true },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'slack',
    serverValidation: {
      appToken: { pattern: '^xapp-', message: 'App Token must start with xapp-' },
      botToken: { pattern: '^xoxb-', message: 'Bot Token must start with xoxb-' },
    },
  },
  {
    id: 'msteams',
    label: 'Microsoft Teams',
    labelKey: 'channels.msteams.label',
    description: 'Connect via Azure Bot Framework.',
    descriptionKey: 'channels.msteams.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 12,
    fields: [
      { key: 'appId', label: 'App ID', labelKey: 'channels.msteams.fields.appId', type: 'text', required: true, helpText: 'Azure Bot Service Application ID.', helpTextKey: 'channels.msteams.fields.appIdHelp', helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps' },
      { key: 'appPassword', label: 'App Password', labelKey: 'channels.msteams.fields.appPassword', type: 'password', required: true },
      { key: 'tenantId', label: 'Tenant ID', labelKey: 'channels.msteams.fields.tenantId', type: 'text', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/msteams',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'msteams',
  },
  {
    id: 'googlechat',
    label: 'Google Chat',
    labelKey: 'channels.googlechat.label',
    description: 'Connect via Google Workspace service account.',
    descriptionKey: 'channels.googlechat.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'enterprise',
    order: 13,
    fields: [
      { key: 'serviceAccountJson', label: 'Service Account JSON', labelKey: 'channels.googlechat.fields.serviceAccountJson', type: 'textarea', required: true, helpText: 'Paste the full JSON key file contents from Google Cloud Console.', helpTextKey: 'channels.googlechat.fields.serviceAccountJsonHelp', helpUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/googlechat',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'googlechat',
  },

  // ─── Community ───
  {
    id: 'qqbot',
    label: 'QQ Bot',
    labelKey: 'channels.qqbot.label',
    description: 'Connect via official QQ Bot API (QQ Open Platform).',
    descriptionKey: 'channels.qqbot.description',
    setupType: 'token',
    pluginRequired: true,
    pluginInstall: { pluginId: 'qqbot', source: { type: 'npm', spec: '@tencent-connect/openclaw-qqbot' } as PluginSource },
    category: 'community',
    order: 20,
    fields: [
      { key: 'appId', label: 'App ID', labelKey: 'channels.qqbot.fields.appId', type: 'text', required: true, helpText: 'From QQ Open Platform developer console.', helpTextKey: 'channels.qqbot.fields.appIdHelp', helpUrl: 'https://q.qq.com/wiki/develop/nodesdk' },
      { key: 'clientSecret', label: 'Client Secret', labelKey: 'channels.qqbot.fields.clientSecret', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/qqbot',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'qqbot',
  },
  {
    id: 'wechat',
    label: 'WeChat',
    labelKey: 'channels.wechat.label',
    description: 'Connect via Tencent iLink Bot plugin (QR code login).',
    descriptionKey: 'channels.wechat.description',
    setupType: 'qr',
    pluginRequired: true,
    pluginInstall: { pluginId: 'wechat', source: { type: 'npm', spec: '@openclaw/wechat' } as PluginSource },
    category: 'community',
    order: 21,
    fields: [],
    helpUrl: 'https://docs.openclaw.ai/channels/wechat',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'wechat',
  },
  {
    id: 'signal',
    label: 'Signal',
    labelKey: 'channels.signal.label',
    description: 'Connect via signal-cli with a registered phone number.',
    descriptionKey: 'channels.signal.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'community',
    order: 22,
    fields: [
      { key: 'account', label: 'Phone Number', labelKey: 'channels.signal.fields.account', type: 'text', placeholder: '+15551234567', required: true, helpText: 'E.164 format phone number registered with signal-cli.', helpTextKey: 'channels.signal.fields.accountHelp', pattern: '^\\+\\d{7,15}$', patternError: 'Must be E.164 format (+country code + number)' },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/signal',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'signal',
    serverValidation: { account: { pattern: '^\\+\\d{7,15}$', message: 'Invalid E.164 phone number' } },
  },
  {
    id: 'line',
    label: 'LINE',
    labelKey: 'channels.line.label',
    description: 'Connect via LINE Messaging API.',
    descriptionKey: 'channels.line.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'community',
    order: 23,
    fields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', labelKey: 'channels.line.fields.channelAccessToken', type: 'password', required: true, helpUrl: 'https://developers.line.biz/console/' },
      { key: 'channelSecret', label: 'Channel Secret', labelKey: 'channels.line.fields.channelSecret', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/line',
    capabilities: { dm: true, groups: true, media: true, reactions: false, threads: false, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: false,
    icon: 'line',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    labelKey: 'channels.matrix.label',
    description: 'Connect to any Matrix homeserver.',
    descriptionKey: 'channels.matrix.description',
    setupType: 'token',
    pluginRequired: false,
    category: 'community',
    order: 24,
    fields: [
      { key: 'homeserver', label: 'Homeserver URL', labelKey: 'channels.matrix.fields.homeserver', type: 'text', placeholder: 'https://matrix.org', required: true },
      { key: 'accessToken', label: 'Access Token', labelKey: 'channels.matrix.fields.accessToken', type: 'password', required: true },
    ],
    helpUrl: 'https://docs.openclaw.ai/channels/matrix',
    capabilities: { dm: true, groups: true, media: true, reactions: true, threads: true, streaming: false },
    supportedDmPolicies: ['pairing', 'allowlist', 'open', 'disabled'],
    supportedGroupPolicies: ['open', 'allowlist', 'disabled'],
    nestedDmPolicy: true,
    icon: 'matrix',
  },
];

/**
 * Build the effective channel registry by intersecting UI metadata
 * with actual backend route support. A channel appears ONLY if it has route support.
 */
export function buildChannelRegistry(): ChannelRegistryEntry[] {
  const supportedIds = new Set([
    ...Object.keys(CHANNEL_REQUIRED_FIELDS),
    ...DEDICATED_ROUTE_CHANNELS,
  ]);
  return CHANNEL_UI_METADATA.filter(entry => supportedIds.has(entry.id));
}

/** All credential provider keys used by a given channel entry. */
function getChannelCredentialProviders(channelId: string): string[] {
  const def = CHANNEL_REQUIRED_FIELDS[channelId];
  if (def) return def.credentialFields.map(cf => cf.provider);
  // Dedicated routes use the channel id as provider
  if (channelId === 'telegram') return ['telegram'];
  if (channelId === 'whatsapp') return ['whatsapp'];
  return [channelId];
}

/**
 * Enrich registry entries with live instance data:
 * - status from gateway RPC
 * - plugin installation state
 * - credential presence
 */
export async function enrichRegistryForInstance(
  instance: Instance,
  statusDetails: ChannelStatusDetail[],
  gatewayBuiltinIds?: string[],
): Promise<ChannelRegistryItem[]> {
  const registry = buildChannelRegistry();
  const credentials = await listCredentials(instance.id);
  const credProviders = new Set(credentials.map(c => c.provider));

  const statusMap = new Map<string, ChannelStatusDetail>();
  for (const detail of statusDetails) {
    statusMap.set(detail.channelId, detail);
  }

  // Gateway builtins = channels already available without plugin install
  const builtins = new Set(gatewayBuiltinIds ?? []);

  // Check managed plugins in DB
  const { db } = await import('../db/index.js');
  const installedPlugins = await db('instance_plugins')
    .where({ instance_id: instance.id })
    .whereIn('status', ['active', 'installed', 'pending'])
    .select('plugin_id');
  const installedPluginIds = new Set(installedPlugins.map((p: { plugin_id: string }) => p.plugin_id));

  return registry.map(entry => {
    const providers = getChannelCredentialProviders(entry.id);
    const hasCredentials = providers.some(p => credProviders.has(p));
    const status = statusMap.get(entry.id) ?? null;

    // Plugin installed if:
    // 1. Not required at all, OR
    // 2. Channel is a gateway builtin (already loaded), OR
    // 3. Plugin is in managed plugins DB with active/installed status, OR
    // 4. Gateway reports it as configured/running (plugin must be loaded)
    let pluginInstalled = !entry.pluginRequired;
    if (entry.pluginRequired) {
      pluginInstalled =
        builtins.has(entry.id) ||
        (entry.pluginInstall ? installedPluginIds.has(entry.pluginInstall.pluginId) : false) ||
        (status?.configured ?? false) ||
        (status?.running ?? false);
    }

    return {
      ...entry,
      status,
      pluginInstalled,
      hasCredentials,
      compatible: true, // v1: all channels assumed compatible
    };
  });
}
