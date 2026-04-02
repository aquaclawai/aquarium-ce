import type { AgentTypeManifest } from '../types.js';

export const claudeCodeManifest: AgentTypeManifest = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic Claude Code — agentic coding assistant with terminal access',
  version: '0.1.0',
  image: { repository: 'placeholder/claude-code', defaultTag: 'latest' },
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
    { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key', required: true, secret: true, source: 'user' },
  ],
  resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
  wizard: {
    providers: [
      {
        name: 'anthropic',
        displayName: 'Anthropic',
        authMethods: [{ value: 'apiKey', label: 'API Key', type: 'api-key' }],
        models: [
          { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', isDefault: true },
          { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
        ],
      },
    ],
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    channelSupport: { enabled: false },
  },
  usageTracking: { method: 'none' },
};
