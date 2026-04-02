import type { AgentTypeManifest } from '../types.js';

export const opencodeManifest: AgentTypeManifest = {
  id: 'opencode',
  name: 'OpenCode',
  description: 'Open-source AI coding agent with multi-provider support',
  version: '0.1.0',
  image: { repository: 'placeholder/opencode', defaultTag: 'latest' },
  ports: [
    { name: 'http', containerPort: 8080, protocol: 'tcp', purpose: 'http' },
  ],
  volumes: [
    { name: 'workspace', mountPath: '/workspace', purpose: 'workspace', defaultSize: '5Gi' },
  ],
  healthCheck: { type: 'http', port: 8080, path: '/health', initialDelaySeconds: 30, periodSeconds: 10 },
  capabilities: {
    hasWebUI: false,
    hasRPC: false,
    supportsConfigRead: false,
    supportsConfigWrite: false,
    supportsModelSelection: true,
    supportsOAuth: false,
    supportsChannels: false,
  },
  env: [
    { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key', required: false, secret: true, source: 'user' },
    { name: 'OPENAI_API_KEY', description: 'OpenAI API key', required: false, secret: true, source: 'user' },
  ],
  resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
  wizard: {
    providers: [
      {
        name: 'openrouter',
        displayName: 'OpenRouter',
        authMethods: [{ value: 'apiKey', label: 'API Key', type: 'api-key' }],
        models: [
          { id: 'anthropic/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', isDefault: true },
          { id: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4' },
          { id: 'openai/gpt-4o', displayName: 'GPT-4o' },
        ],
      },
      {
        name: 'anthropic',
        displayName: 'Anthropic',
        authMethods: [{ value: 'apiKey', label: 'API Key', type: 'api-key' }],
        models: [
          { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', isDefault: true },
        ],
      },
      {
        name: 'openai',
        displayName: 'OpenAI',
        authMethods: [{ value: 'apiKey', label: 'API Key', type: 'api-key' }],
        models: [
          { id: 'gpt-4o', displayName: 'GPT-4o', isDefault: true },
        ],
      },
    ],
    defaultProvider: 'openrouter',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    channelSupport: { enabled: false },
  },
  usageTracking: { method: 'none' },
};
