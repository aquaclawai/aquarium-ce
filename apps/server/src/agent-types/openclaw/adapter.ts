import type { AgentTypeAdapter, ConfigFileCategories } from '../types.js';
import type { ToolPermissions, TemplateSecurityConfig, PluginSource } from '@aquarium/shared';
import { DEFAULT_TOOL_PERMISSIONS } from '@aquarium/shared';
import { GatewayRPCClient } from './gateway-rpc.js';
import { getGatewayClient, connectGateway } from '../../services/gateway-event-relay.js';
import { db } from '../../db/index.js';
import { getAdapter } from '../../db/adapter.js';

/** Recursively deep-merge source into target (objects only; arrays are replaced). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
import { WORKSPACE_TEMPLATES } from './workspace-templates.js';
import { resolveCredentialPlaceholders } from '../../services/user-credential-store.js';
import { ProviderRegistry } from './provider-registry.js';
import { getSecurityConfig, getSecurityParagraph, DEFAULT_TRUST_LEVEL_INDICATORS } from './security-profiles.js';
import { config } from '../../config.js';

// Models available via the openai-codex provider (chatgpt.com backend).
// Used to validate and remap models when the user has an OpenAI OAuth token.
const OPENAI_CODEX_MODELS = [
  'gpt-5.1',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
];

// Best-effort mapping from openai models to their closest openai-codex equivalents.
const OPENAI_TO_CODEX_MODEL_MAP: Record<string, string> = {
  'gpt-5': 'gpt-5.1',
  'gpt-5-mini': 'gpt-5.1-codex-mini',
  'gpt-4.1': 'gpt-5.1',
  'gpt-4.1-mini': 'gpt-5.1-codex-mini',
  'gpt-4.1-nano': 'gpt-5.1-codex-mini',
  'gpt-4o': 'gpt-5.1',
  'gpt-4o-mini': 'gpt-5.1-codex-mini',
  'o3': 'gpt-5.1',
  'o3-mini': 'gpt-5.1-codex-mini',
  'o3-pro': 'gpt-5.1-codex-max',
  'o1': 'gpt-5.1',
  'o1-mini': 'gpt-5.1-codex-mini',
  'codex-mini': 'gpt-5.1-codex-mini',
};

/**
 * Returns true if the given Gateway image tag supports the SecretRef mechanism
 * (keyRef / tokenRef in auth-profiles.json + secrets.providers in openclaw.json).
 * SecretRef was merged in early March 2026; tag 2026.3.13 is confirmed to include it.
 * Older tags (e.g. 2026.3.2-p1) may pre-date the feature and fall back to plaintext.
 */
function supportsSecretRef(imageTag: string): boolean {
  // Strip patch suffix (e.g. "-p1") for comparison
  const base = imageTag.replace(/-p\d+$/, '');
  const parts = base.split('.').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return false;

  const [year, month, day] = parts;
  if (year > 2026) return true;
  if (year === 2026 && month > 3) return true;
  if (year === 2026 && month === 3 && day >= 13) return true;
  return false;
}

const WORKSPACE_FILES = [
  { key: 'agentsmd', filename: 'workspace/AGENTS.md', template: 'AGENTS.md' },
  { key: 'soulmd', filename: 'workspace/SOUL.md', template: 'SOUL.md' },
  { key: 'identitymd', filename: 'workspace/IDENTITY.md', template: 'IDENTITY.md' },
  { key: 'usermd', filename: 'workspace/USER.md', template: 'USER.md' },
  { key: 'toolsmd', filename: 'workspace/TOOLS.md', template: 'TOOLS.md' },
  { key: 'bootstrapmd', filename: 'workspace/BOOTSTRAP.md', template: 'BOOTSTRAP.md' },
  { key: 'heartbeatmd', filename: 'workspace/HEARTBEAT.md', template: 'HEARTBEAT.md' },
  { key: 'memorymd', filename: 'workspace/MEMORY.md', template: 'MEMORY.md' },
] as const;

export const openclawAdapter: AgentTypeAdapter = {

  categorizeConfigFiles(files: Map<string, string>): ConfigFileCategories {
    const alwaysOverwrite = new Map<string, string>();
    const seedIfAbsent = new Map<string, string>();

    for (const [path, content] of files) {
      if (
        path === 'openclaw.json' ||
        path.endsWith('auth-profiles.json') ||
        path === 'workspace/SOUL.md'
      ) {
        alwaysOverwrite.set(path, content);
      } else {
        seedIfAbsent.set(path, content);
      }
    }

    return { alwaysOverwrite, seedIfAbsent };
  },

  async seedConfig({ instance, userConfig, credentials, litellmKey }) {
    const files = new Map<string, string>();

    const cfg: Record<string, unknown> = {};

    const agentDefaults: Record<string, unknown> = {};
    {
      let provider = (userConfig.defaultProvider as string) || (userConfig.provider as string) || 'openrouter';
      let model = (userConfig.defaultModel as string) || (userConfig.model as string) || 'anthropic/claude-sonnet-4';

      // Auto mode: cost-optimized smart routing where LiteLLM picks the best
      // model based on task complexity.  The gateway exposes all available models
      // and the agent/LiteLLM router selects the appropriate tier.
      const isAutoMode = model === 'auto';

      // Platform mode: route through LiteLLM proxy, override provider to 'litellm'
      // so Gateway uses the litellm:default auth profile instead of looking for
      // a provider-specific auth profile (e.g. openrouter) that doesn't exist.
      if (instance.billingMode === 'platform' && litellmKey) {
        // Preserve original provider for building the LiteLLM model ID.
        // LiteLLM model IDs use the format '<original-provider>/<model-name>'
        // (e.g. 'anthropic/claude-sonnet-4-20250514').  The Gateway then routes
        // via 'litellm/<litellm-model-id>'.
        const originalProvider = provider;
        provider = 'litellm';

        if (isAutoMode) {
          // Auto mode: use claude-sonnet-4 as the default primary model (standard tier).
          // The LiteLLM proxy key has no model restrictions, so the agent can use
          // any model.  The gateway exposes all models so the agent (or LiteLLM
          // router) can pick the appropriate tier based on task complexity:
          //   Budget:   openai/gpt-4o-mini       (simple tasks)
          //   Standard: anthropic/claude-sonnet-4 (medium tasks)
          //   Premium:  anthropic/claude-opus-4   (complex tasks)
          model = 'anthropic/claude-sonnet-4';
        } else {
          // Ensure model includes the original provider prefix for LiteLLM routing
          if (!model.includes('/')) {
            model = `${originalProvider}/${model}`;
          }
        }

        // The model name must match exactly what's registered in LiteLLM.
        // Default model ID in LiteLLM typically includes a date suffix
        // (e.g. 'anthropic/claude-sonnet-4-20250514'), but the user config
        // may omit it.  We keep whatever the user/config provides — if the
        // model doesn't exist in LiteLLM the Gateway will surface a clear error.

        // Build models.providers.litellm config block so Gateway knows how
        // to reach the LiteLLM proxy and which models are available.
        const litellmInternalUrl = config.litellm.proxyInternalUrl;

        // Fetch available models from OpenRouter to populate the provider config.
        // LiteLLM uses wildcard routing (openrouter/*) so any model works.
        const { fetchOpenRouterModels } = await import('../../services/openrouter-models.js');
        let litellmModels: { id: string; name: string; input?: string[] }[] = [];
        try {
          litellmModels = await fetchOpenRouterModels();
        } catch (err) {
          console.warn('[adapter] Failed to fetch OpenRouter models, using configured model only:', err);
        }
        if (litellmModels.length === 0) {
          litellmModels = [{ id: model, name: model }];
        }

        // In auto mode, ensure the three routing tiers are always present
        // in the model list so the agent can select any tier.
        if (isAutoMode) {
          const autoTierModels = [
            { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Budget)', input: ['text', 'image'] },
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (Standard)', input: ['text', 'image'] },
            { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4 (Premium)', input: ['text', 'image'] },
          ];
          const existingIds = new Set(litellmModels.map(m => m.id));
          for (const tier of autoTierModels) {
            if (!existingIds.has(tier.id)) {
              litellmModels.push(tier);
            }
          }
        }

        cfg.models = {
          providers: {
            litellm: {
              baseUrl: litellmInternalUrl,
              apiKey: litellmKey,
              api: 'openai-completions',
              models: litellmModels,
            },
          },
        };
      } else {
        // OAuth tokens route through openai-codex provider (chatgpt.com), not openai (api.openai.com)
        const hasOpenAIOAuth = credentials.some(c => c.provider === 'openai' && c.credentialType === 'oauth_token');
        if (provider === 'openai' && hasOpenAIOAuth) {
          provider = 'openai-codex';
          if (!OPENAI_CODEX_MODELS.includes(model)) {
            const remapped = OPENAI_TO_CODEX_MODEL_MAP[model] || 'gpt-5.1-codex-mini';
            console.warn(`[adapter] Model "${model}" unavailable on openai-codex, remapping to "${remapped}"`);
            agentDefaults.model = { primary: `${provider}/${remapped}` };
          } else {
            agentDefaults.model = { primary: `${provider}/${model}` };
          }
        }
      }
      // Set model if not already set by codex remapping above
      if (!agentDefaults.model) {
        agentDefaults.model = { primary: `${provider}/${model}` };
      }
    }
    // Always configure agents section to enable sessions_spawn for MCP skill tools
    // (e.g. jinko-flight). Without agents.list[].subagents.allowAgents, the gateway
    // returns: 'agentId is not allowed for sessions_spawn (allowed: none)'.
    //
    // Schema-valid fields only (additionalProperties: false enforced by gateway):
    //   agents.defaults.subagents: maxConcurrent | archiveAfterMinutes | model | thinking
    //   agents.list[].subagents:   allowAgents | model | thinking
    agentDefaults.subagents = { maxConcurrent: 3 };
    cfg.agents = {
      defaults: agentDefaults,
      list: [
        {
          id: 'main',
          default: true,
          subagents: { allowAgents: ['*'] },
        },
      ],
    };

    // Build tools config: MCP servers + tool permissions
    const toolsCfg: Record<string, unknown> = {};

    if (userConfig.mcpServers) {
      const resolved = await resolveCredentialPlaceholders(
        userConfig.mcpServers as Record<string, unknown>,
        instance.id,
        instance.userId,
        { source: 'seed_config' },
      );

      const sanitized: Record<string, unknown> = {};
      for (const [name, raw] of Object.entries(resolved)) {
        if (!raw || typeof raw !== 'object') {
          sanitized[name] = raw;
          continue;
        }

        const srv = raw as Record<string, unknown>;
        if (typeof srv.url === 'string' && srv.url.length > 0) {
          const entry: Record<string, unknown> = { url: srv.url };
          if (srv.headers && typeof srv.headers === 'object' && Object.keys(srv.headers).length > 0) {
            entry.headers = srv.headers;
          }
          sanitized[name] = entry;
          continue;
        }

        if (typeof srv.command === 'string' && srv.command.length > 0) {
          const entry: Record<string, unknown> = { command: srv.command };
          if (Array.isArray(srv.args) && srv.args.length > 0) {
            entry.args = srv.args;
          }
          if (srv.env && typeof srv.env === 'object' && Object.keys(srv.env).length > 0) {
            entry.env = srv.env;
          }
          sanitized[name] = entry;
          continue;
        }

        sanitized[name] = srv;
      }

      toolsCfg.mcp = sanitized;
    }

    // Apply tool permissions from instance config (default: full access)
    const perms: ToolPermissions = {
      ...DEFAULT_TOOL_PERMISSIONS,
      ...(userConfig.toolPermissions as Partial<ToolPermissions> | undefined),
    };

    if (perms.profile !== 'full') {
      toolsCfg.profile = perms.profile;
    }

    // Build deny list from toggles + custom deny entries
    const denyList: string[] = [...(perms.denyList || [])];
    if (!perms.webSearchEnabled) denyList.push('web_search');
    if (!perms.webFetchEnabled) denyList.push('web_fetch');
    if (!perms.browserEnabled) denyList.push('browser');
    if (denyList.length > 0) {
      toolsCfg.deny = [...new Set(denyList)];
    }

    if (!perms.webSearchEnabled) {
      toolsCfg.web = { ...toolsCfg.web as Record<string, unknown> || {}, search: { enabled: false } };
    }
    if (!perms.webFetchEnabled) {
      const existing = toolsCfg.web as Record<string, unknown> || {};
      toolsCfg.web = { ...existing, fetch: { enabled: false } };
    }

    if (!perms.elevatedEnabled) {
      toolsCfg.elevated = { enabled: false };
    }

    if (Object.keys(toolsCfg).length > 0) {
      cfg.tools = toolsCfg;
    }

    // Enable /mcp command so users can manage MCP servers via chat
    cfg.commands = { mcp: true };

    // Data-driven channel config: maps credential provider to channel config + plugin entry.
    // Standard channels use env var substitution; special channels handled individually below.
    const channelCredMap: Record<string, {
      channelKey: string;
      envVar: string;
      configBuilder: (envRef: string) => Record<string, unknown>;
    }> = {
      telegram: {
        channelKey: 'telegram',
        envVar: 'TELEGRAM_BOT_TOKEN',
        configBuilder: (ref) => ({ enabled: true, botToken: ref, dmPolicy: 'open', allowFrom: ['*'] }),
      },
      discord: {
        channelKey: 'discord',
        envVar: 'DISCORD_BOT_TOKEN',
        configBuilder: (ref) => ({ enabled: true, token: ref, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open' }),
      },
      nostr: {
        channelKey: 'nostr',
        envVar: 'NOSTR_PRIVATE_KEY',
        configBuilder: (ref) => ({
          enabled: true,
          privateKey: ref,
          relays: ['wss://relay.damus.io', 'wss://nos.lol'],
          dmPolicy: 'open',
          allowFrom: ['*'],
          groupPolicy: 'open',
        }),
      },
      msteams: {
        channelKey: 'msteams',
        envVar: 'MSTEAMS_APP_ID',
        configBuilder: (ref) => ({
          enabled: true,
          appId: ref,
          appPassword: '${MSTEAMS_APP_PASSWORD}',
          tenantId: '${MSTEAMS_TENANT_ID}',
          webhook: { port: 3978, path: '/api/messages' },
          dmPolicy: 'pairing',
          allowFrom: ['*'],
          groupPolicy: 'allowlist',
        }),
      },
      zalo: {
        channelKey: 'zalo',
        envVar: 'ZALO_BOT_TOKEN',
        configBuilder: (ref) => ({
          enabled: true,
          botToken: ref,
          dmPolicy: 'pairing',
          allowFrom: ['*'],
        }),
      },
      line: {
        channelKey: 'line',
        envVar: 'LINE_CHANNEL_ACCESS_TOKEN',
        configBuilder: (ref) => ({
          enabled: true,
          channelAccessToken: ref,
          channelSecret: '${LINE_CHANNEL_SECRET}',
          dmPolicy: 'pairing',
          allowFrom: ['*'],
          groupPolicy: 'allowlist',
        }),
      },
    };

    const channels: Record<string, unknown> = {};
    const pluginEntries: Record<string, unknown> = {};

    // WhatsApp: only configure if credentials exist (same pattern as other channels)
    if (credentials.some(c => c.provider === 'whatsapp')) {
      channels.whatsapp = { dmPolicy: 'open', allowFrom: ['*'], groupPolicy: 'open' };
      pluginEntries.whatsapp = { enabled: true };
    }

    // Standard channels: telegram, discord, nostr (env var substitution)
    for (const [credProvider, mapping] of Object.entries(channelCredMap)) {
      if (credentials.some(c => c.provider === credProvider)) {
        channels[mapping.channelKey] = mapping.configBuilder(`\${${mapping.envVar}}`);
        pluginEntries[mapping.channelKey] = { enabled: true };
      }
    }

    // Slack: needs both appToken and botToken for socket mode
    const hasSlackApp = credentials.some(c => c.provider === 'slack_app');
    const hasSlackBot = credentials.some(c => c.provider === 'slack_bot');
    if (hasSlackApp && hasSlackBot) {
      channels.slack = { enabled: true, mode: 'socket', appToken: '${SLACK_APP_TOKEN}', botToken: '${SLACK_BOT_TOKEN}', dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open' };
      pluginEntries.slack = { enabled: true };
    }

    // Signal: phone number stored as credential value (not env var substitution)
    const signalCred = credentials.find(c => c.provider === 'signal');
    if (signalCred) {
      channels.signal = { enabled: true, account: signalCred.value, dmPolicy: 'open', allowFrom: ['*'], groupPolicy: 'open' };
      pluginEntries.signal = { enabled: true };
    }

    // GoogleChat: service account JSON written as file, referenced by path
    const googleChatCred = credentials.find(c => c.provider === 'googlechat');
    if (googleChatCred) {
      files.set('credentials/googlechat-sa.json', googleChatCred.value);
      channels.googlechat = {
        enabled: true,
        serviceAccountFile: '/home/node/.openclaw/credentials/googlechat-sa.json',
        audienceType: 'app-url',
        dm: { policy: 'open', allowFrom: ['*'] },
        groupPolicy: 'open',
      };
      pluginEntries.googlechat = { enabled: true };
    }

    // iMessage: config-only (cliPath, dbPath stored as JSON credential blob)
    const imessageCred = credentials.find(c => c.provider === 'imessage');
    if (imessageCred) {
      try {
        const imConfig = JSON.parse(imessageCred.value) as { cliPath: string; dbPath: string };
        channels.imessage = { enabled: true, cliPath: imConfig.cliPath, dbPath: imConfig.dbPath, dmPolicy: 'open', allowFrom: ['*'], groupPolicy: 'open' };
        pluginEntries.imessage = { enabled: true };
      } catch { /* skip malformed config */ }
    }

    // IRC: server config stored as JSON credential blob
    const ircCred = credentials.find(c => c.provider === 'irc');
    if (ircCred) {
      try {
        const ircConfig = JSON.parse(ircCred.value) as {
          host: string; port?: number; nick: string;
          tls?: boolean; channels?: string[]; password?: string;
        };
        channels.irc = {
          enabled: true,
          host: ircConfig.host,
          port: ircConfig.port || 6667,
          nick: ircConfig.nick,
          tls: ircConfig.tls ?? false,
          channels: ircConfig.channels || [],
          dmPolicy: 'open',
          allowFrom: ['*'],
          groupPolicy: 'open',
        };
        if (ircConfig.password) {
          (channels.irc as Record<string, unknown>).nickserv = { password: ircConfig.password };
        }
        pluginEntries.irc = { enabled: true };
      } catch { /* skip malformed IRC config */ }
    }

    // Matrix: homeserver + accessToken stored as JSON credential blob
    const matrixCred = credentials.find(c => c.provider === 'matrix');
    if (matrixCred) {
      try {
        const matrixConfig = JSON.parse(matrixCred.value) as {
          homeserver: string; accessToken: string; userId?: string;
        };
        channels.matrix = {
          enabled: true,
          homeserver: matrixConfig.homeserver,
          accessToken: matrixConfig.accessToken,
          ...(matrixConfig.userId ? { userId: matrixConfig.userId } : {}),
          dm: { policy: 'open', allowFrom: ['*'] },
          groupPolicy: 'open',
        };
        pluginEntries.matrix = { enabled: true };
      } catch { /* skip malformed config */ }
    }

    // BlueBubbles: serverUrl + password stored as JSON credential blob
    const bluebubblesCred = credentials.find(c => c.provider === 'bluebubbles');
    if (bluebubblesCred) {
      try {
        const bbConfig = JSON.parse(bluebubblesCred.value) as {
          serverUrl: string; password: string;
        };
        channels.bluebubbles = {
          enabled: true,
          serverUrl: bbConfig.serverUrl,
          password: bbConfig.password,
          dmPolicy: 'open',
          allowFrom: ['*'],
        };
        pluginEntries.bluebubbles = { enabled: true };
      } catch { /* skip malformed config */ }
    }

    // Only include channels section if at least one channel is configured.
    // An empty `channels: {}` causes the Gateway Dashboard (v2026.3.13+) to show
    // "Unsupported type: . Use Raw mode." because the schema renderer can't infer
    // field types from an empty object.
    if (Object.keys(channels).length > 0) {
      cfg.channels = channels;
    }

    // Gateway controlUi: when OPENCLAW_GATEWAY_BIND=lan, the gateway requires
    // allowedOrigins or it refuses to start with:
    //   "non-loopback Control UI requires gateway.controlUi.allowedOrigins"
    cfg.gateway = {
      bind: 'lan',
      auth: {
        mode: 'token',
      },
      controlUi: {
        allowedOrigins: ['*'],
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true,
      },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
          responses: { enabled: true },
        },
      },
    };

    // Managed plugins from extension management (Phase 2)
    // Include active and degraded plugins in seedConfig — degraded may still work from cache
    const dbAdapter = getAdapter();
    const managedPlugins = await db('instance_plugins')
      .where({ instance_id: instance.id })
      .whereIn('status', ['active', 'degraded'])
      .select('plugin_id', 'source', 'config', 'enabled') as Array<Record<string, unknown>>;

    for (const mp of managedPlugins) {
      const pluginId = mp.plugin_id as string;
      const pluginConfig = dbAdapter.parseJson<Record<string, unknown>>(mp.config);
      // Only include if enabled (active plugins should always be enabled, but check)
      if (mp.enabled) {
        pluginEntries[pluginId] = { enabled: true, ...pluginConfig };
      }
    }

    // Build dynamic load.paths: platform-bridge (always) + npm-installed managed plugins
    const loadPaths: string[] = ['/opt/openclaw-plugins/platform-bridge'];
    for (const mp of managedPlugins) {
      const pluginId = mp.plugin_id as string;
      const pluginSource = dbAdapter.parseJson<PluginSource>(mp.source);
      // Non-bundled plugins are installed via npm to a plugin-specific path
      if (pluginSource && pluginSource.type !== 'bundled') {
        loadPaths.push(`/home/node/.openclaw/plugins/${pluginId}`);
      }
    }

    // OpenClaw schema: plugins.entries is Record<id, {enabled, config}>, load.paths for external
    const pluginsCfg: Record<string, unknown> = {
      entries: pluginEntries,
      load: { paths: loadPaths },
    };
    cfg.plugins = pluginsCfg;

    const securityCfg = getSecurityConfig(instance.securityProfile ?? 'standard');
    cfg.gateway = deepMerge(cfg.gateway as Record<string, unknown> || {}, securityCfg.gateway as Record<string, unknown>);
    cfg.tools = deepMerge(cfg.tools as Record<string, unknown> || {}, securityCfg.tools as Record<string, unknown>);
    cfg.session = securityCfg.session;
    cfg.discovery = securityCfg.discovery;
    if (securityCfg.plugins) {
      cfg.plugins = deepMerge(cfg.plugins as Record<string, unknown> || {}, securityCfg.plugins as Record<string, unknown>);
    }
    // Ensure platform-bridge plugin is always loadable regardless of security profile.
    // The security profile may set plugins.enabled=false which blocks all plugins
    // including our platform-bridge (needed for platform.ping readiness checks).
    const finalPlugins = cfg.plugins as Record<string, unknown>;
    if (finalPlugins.enabled === false) {
      finalPlugins.enabled = true;
      finalPlugins.allow = [];
    }
    // Preserve load.paths after security deep-merge (security config may overwrite it)
    if (!(finalPlugins.load as Record<string, unknown> | undefined)?.paths) {
      finalPlugins.load = { paths: loadPaths };
    }
    cfg.skills = securityCfg.skills;

    // PLUG-10: Disable chat-based plugin management for managed instances
    // The dashboard is the single writer for extension state — prevents state divergence
    cfg.commands = { ...(cfg.commands as Record<string, unknown> || {}), plugins: false };

    // SecretRef: when the Gateway image supports it, inject a secrets provider
    // so that keyRef/tokenRef entries in auth-profiles.json can resolve env vars.
    const useSecretRef = supportsSecretRef(instance.imageTag);
    if (useSecretRef) {
      cfg.secrets = { providers: { default: { source: 'env' } } };
    }

    files.set('openclaw.json', JSON.stringify(cfg, null, 2));

    // Generate auth-profiles.json (single file, OpenClaw auth store format)
    const authProfiles: Record<string, unknown> = {};
    const secretRef = (envId: string) => ({ source: 'env' as const, provider: 'default', id: envId });

    if (instance.billingMode === 'platform' && litellmKey) {
      // Platform Mode: single litellm:default profile pointing to LiteLLM proxy
      const litellmProfile: Record<string, unknown> = {
        type: 'api_key',
        provider: 'litellm',
        baseUrl: config.litellm.proxyInternalUrl + '/v1',
      };
      if (useSecretRef) {
        litellmProfile.keyRef = secretRef('LITELLM_API_KEY');
      } else {
        litellmProfile.apiKey = litellmKey;
      }
      authProfiles['litellm:default'] = litellmProfile;
    } else {
      // BYOK Mode (or fallback): credential-injection logic
      const registry = new ProviderRegistry();
      for (const cred of credentials) {
        if (cred.credentialType === 'api_key') {
          const profileKey = registry.getProfileKey(cred.provider);
          const profile: Record<string, unknown> = {
            type: 'api_key',
            provider: cred.provider,
          };
          if (useSecretRef) {
            const envVar = registry.getEnvVarName(cred.provider);
            profile.keyRef = secretRef(envVar || `${cred.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`);
          } else {
            profile.apiKey = cred.value;
          }
          authProfiles[profileKey] = profile;
        } else if (cred.credentialType === 'oauth_token') {
          const concreteProvider = registry.resolveAuthProvider(cred.provider, cred.credentialType);
          const profileKey = registry.getProfileKey(concreteProvider);
          if (cred.provider === 'github-copilot') {
            const profile: Record<string, unknown> = {
              type: 'token',
              provider: concreteProvider,
            };
            if (useSecretRef) {
              profile.tokenRef = secretRef('COPILOT_GITHUB_TOKEN');
            } else {
              profile.token = cred.value;
            }
            authProfiles[profileKey] = profile;
          } else {
            // OAuth tokens (e.g., openai device-code flow) — SecretRef unsupported for oauth type
            const metadata = cred.metadata as { refreshToken?: string; expiresIn?: number } | undefined;
            const expiresMs = metadata?.expiresIn
              ? Date.now() + metadata.expiresIn * 1000
              : Date.now() + 864_000_000;
            authProfiles[profileKey] = {
              type: 'oauth',
              provider: concreteProvider,
              access: cred.value,
              refresh: metadata?.refreshToken ?? '',
              expires: expiresMs,
            };
          }
        }
      }
    }
    if (Object.keys(authProfiles).length > 0) {
      const authProfilesJson = JSON.stringify({
        version: 1,
        profiles: authProfiles,
      }, null, 2);
      files.set('auth-profiles.json', authProfilesJson);
      files.set('agents/main/agent/auth-profiles.json', authProfilesJson);
    }

    for (const wf of WORKSPACE_FILES) {
      const userContent = userConfig[wf.key] as string | undefined;
      let content = userContent || WORKSPACE_TEMPLATES[wf.template] || '';

      if (wf.key === 'soulmd' && content) {
        const templateSecurity = userConfig.__templateSecurity as TemplateSecurityConfig | undefined;
        const securityParagraph = getSecurityParagraph(instance.securityProfile ?? "standard", templateSecurity, DEFAULT_TRUST_LEVEL_INDICATORS);
        if (securityParagraph) {
          content = content.replace(/<!-- SECURITY SECTION[\s\S]*?<!-- END SECURITY SECTION -->\n*/g, '');
          content = securityParagraph + '\n\n' + content.trim();
        }
      }

      // Pre-fill agent name in IDENTITY.md if the template placeholder is still present
      if (wf.key === 'identitymd' && content && instance.name) {
        content = content.replace('_(pick something you like)_', instance.name);
      }

      if (content) {
        files.set(wf.filename, content);
      }
    }

    // GEO integration: inject geo-query tool description if user has a GEO credential
    const hasGeoCredential = credentials.some(c => c.provider === 'geo' && c.credentialType === 'api_key');
    if (hasGeoCredential) {
      const geoToolSection = `\n\n## GEO Brand Intelligence Tool\n\nUse this tool to fetch brand data from the GEO platform when the user asks about brand performance, visibility, or analytics.\n\n**Endpoint:** POST ${config.publicAppUrl}/instances/${instance.id}/tools/geo-query\n**Auth:** Bearer <your platform JWT (the same token you use for all platform API calls)>\n\n**Request body (JSON):**\n\`\`\`\n{\n  "type": "brands" | "brand_overview" | "brand_analytics",\n  "workspaceId": <number>,\n  "brandId": <number>  // required for brand_overview and brand_analytics\n}\n\`\`\`\n\n**Examples:**\n- List brands in workspace 42: \`{ "type": "brands", "workspaceId": 42 }\`\n- Get overview for brand 7:   \`{ "type": "brand_overview", "workspaceId": 42, "brandId": 7 }\`\n- Get analytics for brand 7:  \`{ "type": "brand_analytics", "workspaceId": 42, "brandId": 7 }\`\n`;
      const existingTools = files.get('workspace/TOOLS.md') ?? '';
      files.set('workspace/TOOLS.md', existingTools + geoToolSection);
    }

    // Seed memory directory with today's empty daily file so the agent doesn't
    // error on first boot when AGENTS.md instructs it to read memory/YYYY-MM-DD.md.
    files.set('workspace/memory/.gitkeep', '');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    files.set(`workspace/memory/${today}.md`, `# ${today}\n`);

    return files;
  },

  async translateRPC({ method, params, endpoint, token, instanceId }) {
    const timeoutMs = method === 'web.login.wait' ? 180_000 : method.startsWith('web.login.') ? 60_000 : 30_000;

    // Try persistent client first (if instanceId provided and client connected)
    if (instanceId) {
      const persistent = getGatewayClient(instanceId);
      if (persistent) {
        return await persistent.call(method, params, timeoutMs);
      }
    }

    // Fallback to ephemeral connection with retry.
    // The gateway WS server may not be ready yet (takes ~47-150s after container start),
    // so transient connection failures (close code 1006, ECONNREFUSED) are retried.
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 2_000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        // Re-check persistent client — it may have connected during the delay
        if (instanceId) {
          const persistent = getGatewayClient(instanceId);
          if (persistent) {
            return await persistent.call(method, params, timeoutMs);
          }
        }
      }

      const client = new GatewayRPCClient(endpoint, token);
      try {
        const result = await client.call(method, params, timeoutMs);

        // If we reached the gateway via ephemeral but the persistent client isn't
        // connected, force-reconnect it now.  Event-producing RPCs like chat.send
        // need the persistent WebSocket to relay streaming events back to the browser.
        if (instanceId && !getGatewayClient(instanceId)) {
          connectGateway(instanceId, endpoint, token);
        }

        return result;
      } catch (err) {
        client.close();
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on transient connection errors, not on RPC-level errors
        const msg = lastError.message;
        const isTransient = msg.includes('closed unexpectedly') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('socket hang up') ||
          msg.includes('connect failed');
        if (!isTransient) throw lastError;
      }
    }
    throw lastError;
  },

  async resolveEnv({ instance, credentials, litellmKey }) {
    const env: Record<string, string> = {
      OPENCLAW_GATEWAY_TOKEN: instance.authToken,
      OPENCLAW_GATEWAY_BIND: 'lan',
      OPENCLAW_GATEWAY_PORT: '18789',
      NODE_OPTIONS: '--max-old-space-size=3072',
    };

    // Dual-mode: platform mode injects LiteLLM proxy URL only, BYOK injects provider keys
    const registry = new ProviderRegistry();
    if (instance.billingMode === 'platform' && litellmKey) {
      env['LITELLM_PROXY_URL'] = config.litellm.proxyInternalUrl;
      env['LITELLM_API_KEY'] = litellmKey;
    } else {
      // BYOK Mode: inject provider API keys as env vars
      for (const cred of credentials) {
        if (cred.credentialType === 'oauth_token') {
          // github-copilot tokenRef needs its oauth_token as an env var for SecretRef resolution
          if (supportsSecretRef(instance.imageTag) && cred.provider === 'github-copilot') {
            env['COPILOT_GITHUB_TOKEN'] = cred.value;
          }
          continue;
        }

        const envVar = registry.getEnvVarName(cred.provider);
        if (envVar) {
          env[envVar] = cred.value;
        }
      }
    }

    // Always inject non-provider credentials (brave, telegram, etc.)
    // regardless of billing mode — these are tool/channel keys, not AI provider keys.
    for (const cred of credentials) {
      if (registry.isNonProviderCredential(cred.provider)) {
        const envVar = registry.getEnvVarName(cred.provider);
        if (envVar && !(envVar in env)) {
          env[envVar] = cred.value;
        }
      }
    }

    return env;
  },

  async checkReady({ instance, endpoint }) {
    try {
      const persistent = getGatewayClient(instance.id);
      if (persistent) {
        const result = await persistent.call('platform.ping', {}, 5_000);
        return result !== null;
      }
      const client = new GatewayRPCClient(endpoint, instance.authToken);
      const result = await client.call('platform.ping', {});
      client.close();
      return result !== null;
    } catch {
      return false;
    }
  },
};
