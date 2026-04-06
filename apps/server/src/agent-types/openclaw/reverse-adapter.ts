import { db } from '../../db/index.js';
import type { RuntimeEngine } from '../../runtime/types.js';
import type {
  Instance,
  CredentialRequirement,
  SecurityWarning,
  ExportTemplateResponse,
  PluginDependency,
  SkillDeclaration,
  ToolPermissions,
  ToolProfile,
  BillingMode,
  McpServerDeclaration,
  TemplateExtensionDeclaration,
  ExtensionStatus,
} from '@aquarium/shared';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128) || 'template';
}

type OpenClawConfig = Record<string, unknown>;

// Deny items injected by security-profiles.ts — must be filtered during reverse adaptation
const SECURITY_PROFILE_DENY_ITEMS = new Set([
  'group:automation', 'group:runtime', 'group:gateway',
]);

// Credential detection patterns — used for both MCP config scrubbing and workspace file scanning
export const SENSITIVE_PATTERNS = [
  { re: /^sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI API key' },
  { re: /^hapi-[a-zA-Z0-9-]+/, label: 'HubSpot API key' },
  { re: /^xoxb-[a-zA-Z0-9-]+/, label: 'Slack bot token' },
  { re: /^ghp_[a-zA-Z0-9]+/, label: 'GitHub PAT' },
  { re: /^gsk_[a-zA-Z0-9]+/, label: 'Groq API key' },
  { re: /AIza[a-zA-Z0-9_-]+/, label: 'Google API key' },
];

export function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

const CHANNEL_CREDENTIAL_MAP: Record<string, CredentialRequirement[]> = {
  telegram: [{ provider: 'telegram', credentialType: 'api_key', description: 'Telegram Bot Token', required: true }],
  discord: [{ provider: 'discord', credentialType: 'api_key', description: 'Discord Bot Token', required: true }],
  whatsapp: [{ provider: 'whatsapp', credentialType: 'api_key', description: 'WhatsApp Configuration', required: false }],
  nostr: [{ provider: 'nostr', credentialType: 'api_key', description: 'Nostr Private Key', required: true }],
  msteams: [
    { provider: 'msteams_app', credentialType: 'api_key', description: 'MS Teams App ID', required: true },
    { provider: 'msteams_password', credentialType: 'api_key', description: 'MS Teams App Password', required: true },
    { provider: 'msteams_tenant', credentialType: 'api_key', description: 'MS Teams Tenant ID', required: true },
  ],
  zalo: [{ provider: 'zalo', credentialType: 'api_key', description: 'Zalo Bot Token', required: true }],
  line: [
    { provider: 'line_token', credentialType: 'api_key', description: 'LINE Channel Access Token', required: true },
    { provider: 'line_secret', credentialType: 'api_key', description: 'LINE Channel Secret', required: true },
  ],
};

// Inverse of adapter.ts channelCredMap — maps env var names to credential provider:type
const ENV_VAR_TO_CREDENTIAL: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: 'telegram:api_key',
  DISCORD_BOT_TOKEN: 'discord:api_key',
  NOSTR_PRIVATE_KEY: 'nostr:api_key',
  MSTEAMS_APP_ID: 'msteams_app:api_key',
  MSTEAMS_APP_PASSWORD: 'msteams_password:api_key',
  MSTEAMS_TENANT_ID: 'msteams_tenant:api_key',
  ZALO_BOT_TOKEN: 'zalo:api_key',
  LINE_CHANNEL_ACCESS_TOKEN: 'line_token:api_key',
  LINE_CHANNEL_SECRET: 'line_secret:api_key',
};

const CREDENTIAL_PLACEHOLDER_RE = /\$\{CREDENTIAL:([^:]+):([^}]+)\}/;

function resolveEnvReferenceToCredential(value: string): string | null {
  const envRef = value.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!envRef) return null;
  return ENV_VAR_TO_CREDENTIAL[envRef[1]] ?? null;
}

const WORKSPACE_ALLOWLIST = [
  'AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'BOOTSTRAP.md',
  'HEARTBEAT.md', 'MEMORY.md',
] as const;

function extractModelConfig(cfg: OpenClawConfig): {
  suggestedModel?: string;
  suggestedProvider?: string;
} {
  const agents = cfg.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const modelCfg = defaults?.model as Record<string, unknown> | undefined;
  const primary = modelCfg?.primary as string | undefined;
  if (!primary) return {};

  // "litellm/anthropic/claude-sonnet-4" → "anthropic/claude-sonnet-4"
  const cleaned = primary.replace(/^litellm\//, '');
  const slashIdx = cleaned.indexOf('/');
  if (slashIdx === -1) {
    return { suggestedModel: cleaned };
  }

  return {
    suggestedProvider: cleaned.slice(0, slashIdx),
    suggestedModel: cleaned,
  };
}

function extractToolPermissions(cfg: OpenClawConfig): ToolPermissions {
  const tools = (cfg.tools ?? {}) as Record<string, unknown>;
  const deny = (tools.deny as string[]) ?? [];

  const profile = (tools.profile as ToolProfile) ?? 'full';
  const webCfg = tools.web as Record<string, unknown> | undefined;
  const searchCfg = webCfg?.search as Record<string, unknown> | undefined;
  const fetchCfg = webCfg?.fetch as Record<string, unknown> | undefined;
  const elevatedCfg = tools.elevated as Record<string, unknown> | undefined;

  const webSearchEnabled = !deny.includes('web_search') && searchCfg?.enabled !== false;
  const webFetchEnabled = !deny.includes('web_fetch') && fetchCfg?.enabled !== false;
  const browserEnabled = !deny.includes('browser');
  const elevatedEnabled = elevatedCfg?.enabled !== false;

  // Filter out security-profile injected deny items (group:automation, group:runtime, etc.)
  const customDeny = deny.filter(
    d => !SECURITY_PROFILE_DENY_ITEMS.has(d) &&
         !['web_search', 'web_fetch', 'browser'].includes(d),
  );

  return {
    profile,
    webSearchEnabled,
    webFetchEnabled,
    browserEnabled,
    elevatedEnabled,
    denyList: customDeny,
  };
}

function inferCredentialRequirements(
  cfg: OpenClawConfig,
  existingCredentials: Array<{ provider: string; credentialType: string }>,
): CredentialRequirement[] {
  const requirements: CredentialRequirement[] = [];

  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  for (const channelType of Object.keys(channels)) {
    const mapping = CHANNEL_CREDENTIAL_MAP[channelType];
    if (mapping) {
      requirements.push(...mapping);
    }
  }

  const mcpServers = getMcpServers(cfg);
  for (const [serverId, serverCfg] of Object.entries(mcpServers)) {
    const scfg = serverCfg as Record<string, unknown> | undefined;
    // Scan env values for credential placeholders
    const env = scfg?.env as Record<string, string> | undefined;
    if (env) {
      for (const [envKey, envValue] of Object.entries(env)) {
        const match = String(envValue).match(CREDENTIAL_PLACEHOLDER_RE);
        if (match) {
          requirements.push({
            provider: match[1],
            credentialType: match[2] as 'api_key' | 'oauth_token',
            description: `${serverId} - ${envKey}`,
            required: true,
          });
        }
      }
    }
    // Scan headers values for credential placeholders (HTTP MCP servers)
    const headers = scfg?.headers as Record<string, string> | undefined;
    if (headers) {
      for (const [headerKey, headerValue] of Object.entries(headers)) {
        const match = String(headerValue).match(CREDENTIAL_PLACEHOLDER_RE);
        if (match) {
          requirements.push({
            provider: match[1],
            credentialType: match[2] as 'api_key' | 'oauth_token',
            description: `${serverId} - ${headerKey}`,
            required: true,
          });
        }
      }
    }
  }

  for (const cred of existingCredentials) {
    const credType = (cred.credentialType || (cred as unknown as Record<string, string>).credential_type || 'api_key') as 'api_key' | 'oauth_token';
    if (!requirements.some(r => r.provider === cred.provider && r.credentialType === credType)) {
      requirements.push({
        provider: cred.provider,
        credentialType: credType,
        description: `${cred.provider} credential`,
        required: true,
      });
    }
  }

  return deduplicateRequirements(requirements);
}

function deduplicateRequirements(reqs: CredentialRequirement[]): CredentialRequirement[] {
  const seen = new Set<string>();
  const result: CredentialRequirement[] = [];
  for (const req of reqs) {
    const key = `${req.provider}:${req.credentialType}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(req);
    }
  }
  return result;
}

function sanitizeMcpConfigs(
  mcpServers: Record<string, unknown>,
  knownCredentialValues: Map<string, string>,
): { sanitized: Record<string, unknown>; warnings: SecurityWarning[] } {
  const warnings: SecurityWarning[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const [serverId, serverCfg] of Object.entries(mcpServers)) {
    if (!serverCfg || typeof serverCfg !== 'object') {
      sanitized[serverId] = serverCfg;
      continue;
    }

    const cfg = { ...(serverCfg as Record<string, unknown>) };
    const env = { ...((cfg.env as Record<string, string>) ?? {}) };

    for (const [envKey, envValue] of Object.entries(env)) {
      if (envValue.startsWith('${CREDENTIAL:')) continue;

      const envVarCred = ENV_VAR_TO_CREDENTIAL[envKey];
      if (envVarCred) {
        env[envKey] = `\${CREDENTIAL:${envVarCred.replace(':', ':')}}`;
        continue;
      }

      const credKey = knownCredentialValues.get(envValue);
      if (credKey) {
        env[envKey] = `\${CREDENTIAL:${credKey}}`;
        continue;
      }

      for (const { re } of SENSITIVE_PATTERNS) {
        if (re.test(envValue)) {
          warnings.push({
            type: 'possible_hardcoded_key',
            location: `mcpServers.${serverId}.env.${envKey}`,
            pattern: maskValue(envValue),
            suggestion: `Replace with \${CREDENTIAL:${serverId}:api_key}`,
          });
          env[envKey] = `\${CREDENTIAL:${serverId}:api_key}`;
          break;
        }
      }
    }

    const headers = { ...((cfg.headers as Record<string, string>) ?? {}) };

    for (const [headerKey, headerValue] of Object.entries(headers)) {
      if (headerValue.startsWith('${CREDENTIAL:')) continue;

      const envRefCred = resolveEnvReferenceToCredential(headerValue);
      if (envRefCred) {
        headers[headerKey] = `\${CREDENTIAL:${envRefCred}}`;
        continue;
      }

      const credKey = knownCredentialValues.get(headerValue);
      if (credKey) {
        headers[headerKey] = `\${CREDENTIAL:${credKey}}`;
        continue;
      }

      for (const { re } of SENSITIVE_PATTERNS) {
        if (re.test(headerValue)) {
          warnings.push({
            type: 'possible_hardcoded_key',
            location: `mcpServers.${serverId}.headers.${headerKey}`,
            pattern: maskValue(headerValue),
            suggestion: `Replace with \${CREDENTIAL:${serverId}:api_key}`,
          });
          headers[headerKey] = `\${CREDENTIAL:${serverId}:api_key}`;
          break;
        }
      }

      const bearerMatch = headerValue.match(/^Bearer\s+(.+)$/);
      if (bearerMatch) {
        const token = bearerMatch[1];
        for (const { re } of SENSITIVE_PATTERNS) {
          if (re.test(token)) {
            warnings.push({
              type: 'possible_hardcoded_key',
              location: `mcpServers.${serverId}.headers.${headerKey}`,
              pattern: maskValue(headerValue),
              suggestion: `Replace with Bearer \${CREDENTIAL:${serverId}:api_key}`,
            });
            headers[headerKey] = `Bearer \${CREDENTIAL:${serverId}:api_key}`;
            break;
          }
        }
      }
    }

    sanitized[serverId] = { ...cfg, env, headers };
  }

  return { sanitized, warnings };
}

function stripSecurityParagraph(soulMd: string): string {
  return soulMd
    .replace(/<!-- SECURITY SECTION[\s\S]*?<!-- END SECURITY SECTION -->\n*/g, '')
    .trimEnd();
}

async function extractPluginDependencies(
  engine: RuntimeEngine,
  runtimeId: string,
  basePath: string,
  openclawPluginEntries: Record<string, unknown>,
): Promise<PluginDependency[]> {
  if (!engine.listFiles || !engine.readFile) return [];

  const extensionsPath = `${basePath}/extensions`;
  let pluginDirs: string[];
  try {
    pluginDirs = await engine.listFiles(runtimeId, extensionsPath);
  } catch {
    return [];
  }

  const deps: PluginDependency[] = [];
  for (const dir of pluginDirs) {
    const manifestRaw = await engine.readFile(runtimeId, `${extensionsPath}/${dir}/openclaw.plugin.json`);
    if (!manifestRaw) continue;

    try {
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

      const pkgRaw = await engine.readFile(runtimeId, `${extensionsPath}/${dir}/package.json`);
      const pkg = pkgRaw ? JSON.parse(pkgRaw) as Record<string, unknown> : null;

      const pluginId = manifest.id as string ?? dir;

      const entryConfig = openclawPluginEntries[pluginId] as Record<string, unknown> | undefined;
      const config = entryConfig?.config as Record<string, unknown> | undefined;

      deps.push({
        id: pluginId,
        npmSpec: pkg ? `${pkg.name as string}@${pkg.version as string}` : pluginId,
        config: config ?? undefined,
        required: true,
      });
    } catch {
    }
  }

  return deps;
}

async function extractWorkspaceSkills(
  engine: RuntimeEngine,
  runtimeId: string,
  basePath: string,
): Promise<{ inlineSkills: Record<string, string>; skillDeclarations: SkillDeclaration[] }> {
  if (!engine.listFiles || !engine.readFile) return { inlineSkills: {}, skillDeclarations: [] };

  const skillsPath = `${basePath}/workspace/skills`;
  let skillDirs: string[];
  try {
    skillDirs = await engine.listFiles(runtimeId, skillsPath);
  } catch {
    return { inlineSkills: {}, skillDeclarations: [] };
  }

  const inlineSkills: Record<string, string> = {};
  const skillDeclarations: SkillDeclaration[] = [];

  for (const dir of skillDirs) {
    const skillMd = await engine.readFile(runtimeId, `${skillsPath}/${dir}/SKILL.md`);
    if (!skillMd) continue;

    const hasPkg = await engine.readFile(runtimeId, `${skillsPath}/${dir}/package.json`);
    const hasClawHub = await engine.readFile(runtimeId, `${skillsPath}/${dir}/.clawhub`);

    if (hasPkg) {
      try {
        const pkg = JSON.parse(hasPkg) as Record<string, unknown>;
        skillDeclarations.push({
          id: dir,
          name: (pkg.name as string) ?? dir,
          description: (pkg.description as string) ?? '',
          source: { type: 'npm', spec: `${pkg.name as string}@${pkg.version as string}` },
        });
      } catch {
        inlineSkills[dir] = skillMd;
        skillDeclarations.push({ id: dir, name: dir, description: extractSkillDescription(skillMd), source: { type: 'inline' } });
      }
    } else if (hasClawHub) {
      try {
        const meta = JSON.parse(hasClawHub) as Record<string, unknown>;
        skillDeclarations.push({
          id: dir,
          name: (meta.name as string) ?? dir,
          description: (meta.description as string) ?? '',
          source: { type: 'clawhub', slug: (meta.slug as string) ?? dir, version: meta.version as string | undefined },
        });
      } catch {
        inlineSkills[dir] = skillMd;
        skillDeclarations.push({ id: dir, name: dir, description: extractSkillDescription(skillMd), source: { type: 'inline' } });
      }
    } else {
      inlineSkills[dir] = skillMd;
      skillDeclarations.push({
        id: dir,
        name: dir,
        description: extractSkillDescription(skillMd),
        source: { type: 'inline' },
      });
    }
  }

  return { inlineSkills, skillDeclarations };
}

function extractSkillDescription(skillMd: string): string {
  const match = skillMd.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---/);
  return match?.[1]?.trim() ?? '';
}

function getMcpServers(cfg: OpenClawConfig): Record<string, unknown> {
  const tools = cfg.tools as Record<string, unknown> | undefined;
  if (tools?.mcp && typeof tools.mcp === 'object') {
    return tools.mcp as Record<string, unknown>;
  }
  const mcp = cfg.mcp as Record<string, unknown> | undefined;
  if (mcp?.servers && typeof mcp.servers === 'object') {
    return mcp.servers as Record<string, unknown>;
  }
  return {};
}

function extractOpenclawConfig(cfg: OpenClawConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const agents = cfg.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  if (defaults) {
    if (defaults.subagents !== undefined) result.subagents = defaults.subagents;
    if (defaults.thinkingDefault !== undefined) result.thinkingDefault = defaults.thinkingDefault;
  }

  if (agents?.list) result.agentList = agents.list;

  const skills = cfg.skills as Record<string, unknown> | undefined;
  if (skills) {
    if (skills.allowBundled !== undefined) result.allowBundledSkills = skills.allowBundled;
    if (skills.entries !== undefined) result.skillEntries = skills.entries;
  }

  if (cfg.bindings) result.bindings = cfg.bindings;

  const ui = cfg.ui as Record<string, unknown> | undefined;
  if (ui?.assistant) result.uiAssistant = ui.assistant;

  const session = cfg.session as Record<string, unknown> | undefined;
  if (session) {
    const { ...sessionCopy } = session;
    if (Object.keys(sessionCopy).length > 0) {
      result.session = sessionCopy;
    }
  }

  return result;
}

const OPENCLAW_HOME = '/home/node/.openclaw';

export async function reverseAdaptFromContainer(
  engine: RuntimeEngine,
  runtimeId: string,
  instance: Instance,
  credentials: Array<{ provider: string; credentialType: string }>,
): Promise<ExportTemplateResponse> {
  const warnings: SecurityWarning[] = [];

  if (!engine.readFile) {
    throw new Error('Runtime engine does not support readFile — cannot export from running container');
  }

  const rawOpenclawJson = await engine.readFile(runtimeId, `${OPENCLAW_HOME}/openclaw.json`);
  if (!rawOpenclawJson) {
    throw new Error('Could not read openclaw.json from container');
  }

  const cfg = JSON.parse(rawOpenclawJson) as OpenClawConfig;

  // 2. Read workspace files through allowlist (TMPL-04)
  // First check local skills for scripts/ or assets/ directories (TMPL-05) — fail fast
  const workspaceSkillsPath = `${OPENCLAW_HOME}/workspace/skills`;
  let skillDirsForCheck: string[] = [];
  if (engine.listFiles) {
    try {
      skillDirsForCheck = await engine.listFiles(runtimeId, workspaceSkillsPath);
    } catch {
      skillDirsForCheck = [];
    }
  }

  for (const skillDir of skillDirsForCheck) {
    if (!engine.listFiles) break;
    let skillEntries: string[];
    try {
      skillEntries = await engine.listFiles(runtimeId, `${workspaceSkillsPath}/${skillDir}`);
    } catch {
      continue;
    }
    if (skillEntries.includes('scripts') || skillEntries.includes('assets')) {
      throw new Error(
        `Skill '${skillDir}' contains executable scripts and cannot be exported. ` +
        `Install it from ClawHub or remove scripts to make it portable.`,
      );
    }
  }

  // Read fixed allowlist files
  const workspaceFiles: Record<string, string> = {};
  for (const filename of WORKSPACE_ALLOWLIST) {
    const content = await engine.readFile(runtimeId, `${OPENCLAW_HOME}/workspace/${filename}`);
    if (content) {
      workspaceFiles[filename] = content;
    }
  }

  // Read skills/*/SKILL.md files
  for (const skillDir of skillDirsForCheck) {
    const skillMd = await engine.readFile(runtimeId, `${workspaceSkillsPath}/${skillDir}/SKILL.md`);
    if (skillMd) {
      workspaceFiles[`skills/${skillDir}/SKILL.md`] = skillMd;
    }
  }

  // 3. Strip security paragraph from SOUL.md
  if (workspaceFiles['SOUL.md']) {
    workspaceFiles['SOUL.md'] = stripSecurityParagraph(workspaceFiles['SOUL.md']);
  }

  // 4. Extract model config
  const modelConfig = extractModelConfig(cfg);

  // 5. Extract tool permissions
  const toolPermissions = extractToolPermissions(cfg);

  // 6. Sanitize MCP configs — replace credential values with placeholders
  const mcpServers = getMcpServers(cfg);

  // Build known credential values map from env var references
  // adapter.ts uses ${ENV_VAR} format in channel configs — these are the values we know
  const knownCredValues = new Map<string, string>();
  // We don't have access to raw credential values here (security), so we rely on
  // pattern matching and env var name mapping only.

  const { sanitized: sanitizedMcpConfigs, warnings: mcpWarnings } = sanitizeMcpConfigs(
    mcpServers,
    knownCredValues,
  );
  warnings.push(...mcpWarnings);

  // 7. Infer credential requirements from channels + MCP + existing credentials
  const requiredCredentials = inferCredentialRequirements(cfg, credentials);

  // 8. Extract plugin dependencies from container
  const pluginEntries = getPluginEntries(cfg);
  const pluginDependencies = await extractPluginDependencies(
    engine, runtimeId, OPENCLAW_HOME, pluginEntries,
  );

  // 9. Extract workspace skills from container
  const { inlineSkills, skillDeclarations } = await extractWorkspaceSkills(
    engine, runtimeId, OPENCLAW_HOME,
  );

  // 10. Extract openclaw-specific config (includes model + tool permissions for round-trip)
  const openclawConfig = extractOpenclawConfig(cfg);
  if (modelConfig.suggestedModel) openclawConfig.defaultModel = modelConfig.suggestedModel;
  if (modelConfig.suggestedProvider) openclawConfig.defaultProvider = modelConfig.suggestedProvider;
  openclawConfig.toolPermissions = toolPermissions;

  // 10a. Scrub OpenClaw config credential fields (TMPL-03)
  scrubOpenclawConfigCredentials(cfg, openclawConfig, warnings);

  // 11. Scan workspace files for hardcoded credentials — redact (not just warn) (TMPL-04)
  for (const [filename, fileContent] of Object.entries(workspaceFiles)) {
    let scanned = fileContent;
    for (const { re, label } of SENSITIVE_PATTERNS) {
      const match = scanned.match(re);
      if (match) {
        const masked = maskValue(match[0]);
        scanned = scanned.replace(re, '[REDACTED]');
        warnings.push({
          type: 'redacted_secret',
          location: `workspaceFiles.${filename}`,
          pattern: masked,
          suggestion: `Found ${label} in ${filename} — value has been redacted`,
        });
      }
    }
    workspaceFiles[filename] = scanned;
  }

  // 12. Determine suggested channels from config
  const channels = (cfg.channels ?? {}) as Record<string, unknown>;
  const suggestedChannels = Object.keys(channels).filter(ch => {
    const chCfg = channels[ch] as Record<string, unknown> | undefined;
    return chCfg?.enabled !== false;
  });

  // 13. Read extension lifecycle tables (TMPL-01, TMPL-02)
  const extensions: TemplateExtensionDeclaration[] = [];
  const EXPORTABLE_STATUSES: ExtensionStatus[] = ['active', 'installed', 'disabled', 'degraded'];

  const pluginRows = await db('instance_plugins')
    .where({ instance_id: instance.id })
    .whereIn('status', EXPORTABLE_STATUSES);

  const skillRows = await db('instance_skills')
    .where({ instance_id: instance.id })
    .whereIn('status', EXPORTABLE_STATUSES);

  function parseJsonb<T>(value: unknown, fallback: T): T {
    if (typeof value === 'string') {
      try { return JSON.parse(value) as T; } catch { return fallback; }
    }
    return (value as T) ?? fallback;
  }

  for (const row of pluginRows) {
    const status = row.status as ExtensionStatus;
    extensions.push({
      id: row.plugin_id as string,
      kind: 'plugin',
      source: parseJsonb<TemplateExtensionDeclaration['source']>(row.source, { type: 'bundled' }),
      lockedVersion: (row.locked_version as string | null) ?? null,
      integrityHash: (row.integrity_hash as string | null) ?? null,
      enabled: status !== 'disabled',
      needsCredentials: status === 'installed',
      config: parseJsonb<Record<string, unknown>>(row.config, {}),
    });
  }

  for (const row of skillRows) {
    const status = row.status as ExtensionStatus;
    extensions.push({
      id: row.skill_id as string,
      kind: 'skill',
      source: parseJsonb<TemplateExtensionDeclaration['source']>(row.source, { type: 'bundled' }),
      lockedVersion: (row.locked_version as string | null) ?? null,
      integrityHash: (row.integrity_hash as string | null) ?? null,
      enabled: status !== 'disabled',
      needsCredentials: status === 'installed',
      config: parseJsonb<Record<string, unknown>>(row.config, {}),
    });
  }

  // 14. Assemble export response
  return {
    draft: {
      slug: slugify(instance.name),
      name: instance.name,
      description: `Exported from instance "${instance.name}"`,
      category: 'custom',
      tags: [],
      agentType: instance.agentType ?? 'openclaw',
      minImageTag: instance.imageTag,
      billingMode: (instance.billingMode as BillingMode) ?? undefined,
      requiredCredentials,
      mcpServers: Object.fromEntries(
        Object.entries(sanitizedMcpConfigs).map(([name, serverCfg]) => {
          const scfg = serverCfg as Record<string, unknown>;
          const decl: McpServerDeclaration = {
            name,
            description: (scfg.description as string) ?? `MCP Server: ${name}`,
            env: (scfg.env as Record<string, string>) ?? {},
          };
          if (scfg.url) decl.url = scfg.url as string;
          if (scfg.headers) decl.headers = scfg.headers as Record<string, string>;
          if (scfg.transport) decl.transport = scfg.transport as 'stdio' | 'sse';
          return [name, decl];
        }),
      ),
      skills: skillDeclarations,
      pluginDependencies,
      suggestedChannels,
    },
    content: {
      workspaceFiles,
      mcpServerConfigs: sanitizedMcpConfigs,
      inlineSkills,
      openclawConfig,
      setupCommands: [],
      customImage: null,
      extensions,
    },
    securityWarnings: warnings,
  };
}

/**
 * Scrub credential fields from OpenClaw config sections:
 * plugins.entries.*.config, skills.entries.*, providers.*
 * Detected values are replaced with ${CREDENTIAL:...} placeholders.
 */
function scrubOpenclawConfigCredentials(
  cfg: OpenClawConfig,
  openclawConfig: Record<string, unknown>,
  warnings: SecurityWarning[],
): void {
  // Scrub plugins.entries.*.config
  const rawPlugins = cfg.plugins as Record<string, unknown> | undefined;
  const rawPluginEntries = rawPlugins?.entries as Record<string, unknown> | undefined;
  if (rawPluginEntries) {
    const scrubbedEntries: Record<string, unknown> = {};
    for (const [pluginId, entryRaw] of Object.entries(rawPluginEntries)) {
      const entry = entryRaw as Record<string, unknown> | null;
      if (!entry || typeof entry !== 'object') {
        scrubbedEntries[pluginId] = entry;
        continue;
      }
      const entryCopy = { ...entry };
      const entryConfig = entryCopy.config as Record<string, unknown> | undefined;
      if (entryConfig && typeof entryConfig === 'object') {
        const scrubbedConfig: Record<string, unknown> = {};
        for (const [fieldName, fieldValue] of Object.entries(entryConfig)) {
          if (typeof fieldValue === 'string') {
            let scrubbed = false;
            for (const { re } of SENSITIVE_PATTERNS) {
              if (re.test(fieldValue)) {
                scrubbedConfig[fieldName] = `\${CREDENTIAL:${pluginId}:${fieldName}}`;
                warnings.push({
                  type: 'possible_hardcoded_key',
                  location: `plugins.entries.${pluginId}.config.${fieldName}`,
                  pattern: maskValue(fieldValue),
                  suggestion: `Replace with \${CREDENTIAL:${pluginId}:${fieldName}}`,
                });
                scrubbed = true;
                break;
              }
            }
            if (!scrubbed) scrubbedConfig[fieldName] = fieldValue;
          } else {
            scrubbedConfig[fieldName] = fieldValue;
          }
        }
        entryCopy.config = scrubbedConfig;
      }
      scrubbedEntries[pluginId] = entryCopy;
    }
    openclawConfig.plugins = { ...rawPlugins, entries: scrubbedEntries };
  }

  // Scrub skills.entries.*.env and .apiKey
  const rawSkills = cfg.skills as Record<string, unknown> | undefined;
  const rawSkillEntries = rawSkills?.entries as Record<string, unknown> | undefined;
  if (rawSkillEntries) {
    const scrubbedSkillEntries: Record<string, unknown> = {};
    for (const [skillId, entryRaw] of Object.entries(rawSkillEntries)) {
      const entry = entryRaw as Record<string, unknown> | null;
      if (!entry || typeof entry !== 'object') {
        scrubbedSkillEntries[skillId] = entry;
        continue;
      }
      const entryCopy = { ...entry };
      for (const sensitiveField of ['env', 'apiKey']) {
        const fieldValue = entryCopy[sensitiveField];
        if (typeof fieldValue === 'string') {
          for (const { re } of SENSITIVE_PATTERNS) {
            if (re.test(fieldValue)) {
              entryCopy[sensitiveField] = `\${CREDENTIAL:${skillId}:${sensitiveField}}`;
              warnings.push({
                type: 'possible_hardcoded_key',
                location: `skills.entries.${skillId}.${sensitiveField}`,
                pattern: maskValue(fieldValue),
                suggestion: `Replace with \${CREDENTIAL:${skillId}:${sensitiveField}}`,
              });
              break;
            }
          }
        }
      }
      scrubbedSkillEntries[skillId] = entryCopy;
    }
    openclawConfig.skills = { ...rawSkills, entries: scrubbedSkillEntries };
  }

  // Scrub providers.*.api_key
  const rawProviders = cfg.providers as Record<string, unknown> | undefined;
  if (rawProviders && typeof rawProviders === 'object') {
    const scrubbedProviders: Record<string, unknown> = {};
    for (const [providerName, providerCfg] of Object.entries(rawProviders)) {
      const pCfg = providerCfg as Record<string, unknown> | null;
      if (!pCfg || typeof pCfg !== 'object') {
        scrubbedProviders[providerName] = pCfg;
        continue;
      }
      const pCfgCopy = { ...pCfg };
      const apiKey = pCfgCopy.api_key;
      if (typeof apiKey === 'string') {
        for (const { re } of SENSITIVE_PATTERNS) {
          if (re.test(apiKey)) {
            pCfgCopy.api_key = `\${CREDENTIAL:${providerName}:api_key}`;
            warnings.push({
              type: 'possible_hardcoded_key',
              location: `providers.${providerName}.api_key`,
              pattern: maskValue(apiKey),
              suggestion: `Replace with \${CREDENTIAL:${providerName}:api_key}`,
            });
            break;
          }
        }
      }
      scrubbedProviders[providerName] = pCfgCopy;
    }
    openclawConfig.providers = scrubbedProviders;
  }
}

function getPluginEntries(cfg: OpenClawConfig): Record<string, unknown> {
  const plugins = cfg.plugins as Record<string, unknown> | undefined;
  if (!plugins?.entries || typeof plugins.entries !== 'object') return {};
  return plugins.entries as Record<string, unknown>;
}
