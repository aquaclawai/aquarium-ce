import type { Instance } from '@aquarium/shared';

export interface WizardProvider {
  name: string;           // provider group id, e.g. 'anthropic'
  displayName: string;    // e.g. 'Anthropic'
  authMethods: Array<{ value: string; label: string; hint?: string; type: string }>;
  models: Array<{ id: string; displayName: string; isDefault?: boolean }>;
}

export interface WizardConfigField {
  key: string;
  label: string;
  type: 'string' | 'boolean' | 'number' | 'textarea';
  default?: unknown;
  description?: string;
}

export interface WizardConfig {
  providers: WizardProvider[];
  defaultProvider?: string;
  defaultModel?: string;
  platformModels?: Array<{ id: string; displayName: string; isDefault?: boolean }>;
  channelSupport: { enabled: boolean; channels?: string[] };
  configFields?: WizardConfigField[];
  defaultPrinciples?: string[];
  identityTemplates?: string[];
  temperaturePresets?: Array<{ key: string; label: string; value: number }>;
  chatSuggestions?: string[];
}

export interface WebUIConfig {
  port: number;
  basePath: string;
  authMethod: 'header' | 'query' | 'cookie';
  iframeAllowed: boolean;
}

export interface UsageTrackingConfig {
  method: 'rpc' | 'http' | 'none';
  rpcMethod?: string;
  pollIntervalMs?: number;
}

export interface AgentTypeManifest {
  id: string;
  name: string;
  description: string;
  version: string;

  image: {
    repository: string;
    defaultTag: string;
    availableTags?: string[];
    registry?: string;
  };

  ports: Array<{
    name: string;
    containerPort: number;
    protocol: 'tcp' | 'udp';
    purpose: 'rpc' | 'http' | 'ui';
  }>;

  volumes: Array<{
    name: string;
    mountPath: string;
    purpose: 'config' | 'data' | 'workspace';
    defaultSize: string;
  }>;

  healthCheck: {
    type: 'http' | 'tcp' | 'exec';
    port?: number;
    path?: string;
    command?: string[];
    initialDelaySeconds: number;
    periodSeconds: number;
  };

  configSchema?: Record<string, unknown>;

  capabilities: {
    hasWebUI: boolean;
    webUIPort?: string;
    hasRPC: boolean;
    rpcPort?: string;
    rpcProtocol?: 'websocket' | 'http' | 'grpc';
    supportsConfigRead: boolean;
    supportsConfigWrite: boolean;
    supportsModelSelection: boolean;
    supportsOAuth: boolean;
    supportsChannels: boolean;
    channelTypes?: string[];
  };

  env: Array<{
    name: string;
    description: string;
    required: boolean;
    secret: boolean;
    source: 'platform' | 'user' | 'generated';
    generator?: 'uuid' | 'token';
  }>;

  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };

  securityContext?: {
    runAsUser?: number;
    runAsGroup?: number;
    fsGroup?: number;
  };

  wizard?: WizardConfig;
  webUI?: WebUIConfig;
  usageTracking?: UsageTrackingConfig;
}

export interface CredentialSet {
  provider: string;
  credentialType: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigFileCategories {
  alwaysOverwrite: Map<string, string>;
  seedIfAbsent: Map<string, string>;
}

export interface AgentTypeAdapter {
  seedConfig?(params: {
    instance: Instance;
    userConfig: Record<string, unknown>;
    credentials: CredentialSet[];
    litellmKey?: string;
  }): Promise<Map<string, string>>;

  categorizeConfigFiles?(files: Map<string, string>): ConfigFileCategories;

  translateRPC?(params: {
    method: string;
    params: Record<string, unknown>;
    endpoint: string;
    token: string;
    instanceId?: string;
  }): Promise<unknown>;

  resolveEnv?(params: {
    instance: Instance;
    credentials: CredentialSet[];
    litellmKey?: string;
  }): Promise<Record<string, string>>;

  checkReady?(params: {
    instance: Instance;
    endpoint: string;
  }): Promise<boolean>;
}

export interface RegisteredAgentType {
  manifest: AgentTypeManifest;
  adapter?: AgentTypeAdapter;
}
