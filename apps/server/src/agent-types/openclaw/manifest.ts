import type { AgentTypeManifest, WizardConfig } from '../types.js';
import { getMetadata } from '../../services/metadata-store.js';

function populateWizardConfig(): WizardConfig {
  const metadata = getMetadata();
  return {
    providers: metadata.providers.map(pg => ({
      name: pg.id,
      displayName: pg.name,
      authMethods: pg.authMethods.map(a => ({ value: a.value, label: a.label, hint: a.hint, type: a.type })),
      models: pg.models
        .filter(m => m.recommended !== false)
        .map(m => ({ id: m.id, displayName: m.name, isDefault: m.recommended })),
    })),
    defaultProvider: 'openrouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    channelSupport: {
      enabled: true,
      channels: metadata.channels.map(c => c.id),
    },
    defaultPrinciples: [],
    identityTemplates: [],
    temperaturePresets: [],
    chatSuggestions: [],
  };
}

export const openclawConfigSchema = {
  type: 'object',
  properties: {
    defaultProvider: {
      type: 'string',
      title: 'Default AI Provider',
      description: 'Provider group ID (e.g., anthropic, openai, google). See /api/metadata/providers for all options.',
      default: 'openrouter',
    },
    defaultModel: {
      type: 'string',
      title: 'Default Model',
      description: 'Model identifier (e.g., claude-sonnet-4-20250514, gpt-4o)',
    },
    agentName: {
      type: 'string',
      title: 'Agent Name',
      description: 'Display name for the agent',
      default: 'OpenClaw',
    },
    enableWhatsApp: {
      type: 'boolean',
      title: 'Enable WhatsApp',
      default: false,
      description: 'Enable WhatsApp messaging channel',
    },
    enableTelegram: {
      type: 'boolean',
      title: 'Enable Telegram',
      default: false,
      description: 'Enable Telegram messaging channel (requires bot token in credentials)',
    },
    mcpServers: {
      type: 'object',
      title: 'MCP Servers',
      description: 'MCP server configurations — stdio (command/args/env) or URL-based (url/headers)',
      additionalProperties: {
        type: 'object',
        properties: {
          command: { type: 'string', title: 'Command', description: 'Executable for stdio transport' },
          args: { type: 'array', items: { type: 'string' }, title: 'Arguments' },
          env: { type: 'object', additionalProperties: { type: 'string' }, title: 'Environment Variables' },
          url: { type: 'string', title: 'URL', description: 'Endpoint URL for HTTP/SSE transport' },
          headers: { type: 'object', additionalProperties: { type: 'string' }, title: 'HTTP Headers' },
          transport: {
            type: 'string',
            enum: ['stdio', 'sse'],
            title: 'Transport',
            description: 'Transport type (auto-detected from url vs command if omitted)',
          },
        },
        oneOf: [
          { required: ['command'] },
          { required: ['url'] },
        ],
      },
    },
    agentsmd: {
      type: 'string',
      title: 'AGENTS.md',
      description: 'Agent workspace instructions — memory system, safety rules, heartbeat conventions, group chat etiquette',
      format: 'textarea',
    },
    soulmd: {
      type: 'string',
      title: 'SOUL.md',
      description: 'Agent personality — core truths, boundaries, vibe, continuity philosophy',
      format: 'textarea',
    },
    identitymd: {
      type: 'string',
      title: 'IDENTITY.md',
      description: 'Agent identity — name, creature type, vibe, emoji, avatar',
      format: 'textarea',
    },
    usermd: {
      type: 'string',
      title: 'USER.md',
      description: 'Human profile — name, timezone, preferences, context about the person the agent is helping',
      format: 'textarea',
    },
    toolsmd: {
      type: 'string',
      title: 'TOOLS.md',
      description: 'Local environment notes — camera names, SSH hosts, device nicknames, environment-specific config',
      format: 'textarea',
    },
    bootstrapmd: {
      type: 'string',
      title: 'BOOTSTRAP.md',
      description: 'First-run ritual — guides the agent through initial identity discovery (deleted after first run)',
      format: 'textarea',
    },
    heartbeatmd: {
      type: 'string',
      title: 'HEARTBEAT.md',
      description: 'Periodic task checklist — what the agent checks during heartbeat polls',
      format: 'textarea',
    },
    memorymd: {
      type: 'string',
      title: 'MEMORY.md',
      description: 'Long-term curated memory — significant events, lessons learned, distilled from daily notes',
      format: 'textarea',
    },
  },
} as const;

export const openclawManifest: AgentTypeManifest = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'AI coding agent with multi-provider support, MCP tools, and messaging channels',
  version: '1.0.0',

  image: {
    repository: 'ghcr.io/aquaclawai/openclaw',
    defaultTag: '2026.3.28',
    availableTags: ['2026.3.28'],
  },

  ports: [
    { name: 'gateway', containerPort: 18789, protocol: 'tcp', purpose: 'rpc' },
  ],

  volumes: [
    { name: 'openclaw-data', mountPath: '/home/node/.openclaw', purpose: 'config', defaultSize: '2Gi' },
  ],

  healthCheck: {
    type: 'tcp',
    port: 18789,
    initialDelaySeconds: 5,
    periodSeconds: 10,
  },

  configSchema: openclawConfigSchema,

  capabilities: {
    hasWebUI: true,
    webUIPort: 'gateway',
    hasRPC: true,
    rpcPort: 'gateway',
    rpcProtocol: 'websocket',
    supportsConfigRead: true,
    supportsConfigWrite: true,
    supportsModelSelection: true,
    supportsOAuth: true,
    supportsChannels: true,
    channelTypes: ['whatsapp', 'telegram'],
  },

  env: [
    { name: 'OPENCLAW_GATEWAY_TOKEN', description: 'Token for platform->Gateway auth', required: true, secret: true, source: 'platform' },
    { name: 'OPENCLAW_GATEWAY_BIND', description: 'Gateway network bind mode', required: true, secret: false, source: 'platform' },
    { name: 'OPENCLAW_GATEWAY_PORT', description: 'Gateway listen port', required: true, secret: false, source: 'platform' },
    { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key', required: false, secret: true, source: 'user' },
    { name: 'OPENAI_API_KEY', description: 'OpenAI API key', required: false, secret: true, source: 'user' },
    { name: 'GOOGLE_API_KEY', description: 'Google AI API key', required: false, secret: true, source: 'user' },
    { name: 'TELEGRAM_BOT_TOKEN', description: 'Telegram bot token', required: false, secret: true, source: 'user' },
    { name: 'COPILOT_GITHUB_TOKEN', description: 'GitHub Copilot OAuth token', required: false, secret: true, source: 'user' },
  ],

  resources: {
    requests: { cpu: '250m', memory: '768Mi' },
    limits: { cpu: '1500m', memory: '4Gi' },
  },

  securityContext: {
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,
  },

  wizard: populateWizardConfig(),
  webUI: { port: 18789, basePath: '/', authMethod: 'header' as const, iframeAllowed: true },
  usageTracking: { method: 'rpc' as const, rpcMethod: 'usage.get', pollIntervalMs: 30000 },
};
