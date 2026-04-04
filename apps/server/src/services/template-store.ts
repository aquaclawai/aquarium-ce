import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { createInstance } from './instance-manager.js';
import { addCredential } from './credential-store.js';
import { addUserCredential, resolveCredential } from './user-credential-store.js';
import { evaluateTrustPolicy } from './trust-store.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import { reverseAdaptFromContainer } from '../agent-types/openclaw/reverse-adapter.js';
import type { DeploymentTarget } from '@aquarium/shared';
import type {
  TemplateManifest,
  TemplateContent,
  TemplateCategory,
  TemplateLicense,
  BillingMode,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  InstantiateTemplateRequest,
  InstantiateTemplateResponse,
  ExportTemplateResponse,
  SecurityWarning,
  PaginatedResponse,
  Instance,
  SetupCommand,
  SecurityProfile,
  TemplateSecurityConfig,
  PluginDependency,
  SkillDeclaration,
  McpServerDeclaration,
  TemplateExtensionDeclaration,
  ExtensionStatus,
  ExtensionKind,
  PluginSource,
  ExtensionSkillSource,
} from '@aquarium/shared';

interface TemplateRow {
  id: string;
  slug: string;
  version: string;
  is_latest: boolean;
  name: string;
  description: string | null;
  category: string;
  tags: unknown;
  locale: string;
  author_id: string;
  author_name: string | null;
  license: string;
  trust_level: string;
  min_image_tag: string | null;
  agent_type: string;
  billing_mode: string | null;
  required_credentials: unknown;
  mcp_servers: unknown;
  skills: unknown;
  plugin_dependencies: unknown;
  suggested_channels: unknown;
  forked_from: string | null;
  install_count: number;
  fork_count: number;
  rating: number;
  usage_count: number;
  security_score: number;
  featured: boolean;
  created_at: string;
  updated_at: string;
}

interface ContentRow {
  id: string;
  template_id: string;
  workspace_files: unknown;
  mcp_server_configs: unknown;
  inline_skills: unknown;
  openclaw_config: unknown;
  plugin_dependencies: unknown;
  setup_commands: unknown;
  custom_image: unknown;
  security: unknown;
  created_at: string;
}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return (value as T) ?? fallback;
}

/** Ensures a value is a JSON string for PostgreSQL JSONB insert. Knex returns JSONB columns as parsed objects. */
function stringifyJsonb(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null);
}

const SECURITY_PROFILE_SCORES: Record<string, number> = {
  strict: 30,
  standard: 20,
  developer: 10,
  unrestricted: 0,
};

function computeSecurityScore(
  security: TemplateSecurityConfig | null,
  mcpServers: Record<string, unknown>,
): number {
  if (!security) return 0;

  let score = 0;

  const profileScore = SECURITY_PROFILE_SCORES[security.minSecurityProfile ?? ''];
  score += profileScore ?? 0;

  if (security.includeTrustLevels) score += 15;

  const neverDoCount = security.customNeverDoRules?.length ?? 0;
  score += Math.min(neverDoCount * 5, 20);

  const patternCount = security.customSuspiciousPatterns?.length ?? 0;
  score += Math.min(patternCount * 5, 15);

  const serverCount = Object.keys(mcpServers).length;
  if (serverCount === 0) {
    score += 20;
  } else if (serverCount <= 3) {
    score += 10;
  }

  return Math.min(score, 100);
}

async function computeAndPersistScore(
  trx: typeof db,
  templateId: string,
  contentSecurity: TemplateSecurityConfig | null,
  mcpServers: Record<string, unknown>,
): Promise<number> {
  const score = computeSecurityScore(contentSecurity, mcpServers);
  await trx('templates').where({ id: templateId }).update({ security_score: score });
  return score;
}

function toManifest(row: TemplateRow): TemplateManifest {
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    isLatest: row.is_latest,
    name: row.name,
    description: row.description,
    category: row.category as TemplateCategory,
    tags: parseJsonb<string[]>(row.tags, []),
    locale: row.locale,
    authorId: row.author_id,
    authorName: row.author_name,
    license: row.license as TemplateLicense,
    trustLevel: row.trust_level as TemplateManifest['trustLevel'],
    minImageTag: row.min_image_tag,
    agentType: row.agent_type,
    billingMode: (row.billing_mode as BillingMode) ?? null,
    requiredCredentials: parseJsonb(row.required_credentials, []),
    mcpServers: parseJsonb(row.mcp_servers, {}),
    skills: parseJsonb(row.skills, []),
    pluginDependencies: parseJsonb<PluginDependency[]>(row.plugin_dependencies, []),
    suggestedChannels: parseJsonb(row.suggested_channels, []),
    forkedFrom: row.forked_from,
    installCount: row.install_count,
    forkCount: row.fork_count,
    rating: Number(row.rating),
    featured: row.featured,
    usageCount: row.usage_count,
    securityScore: row.security_score,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toContent(row: ContentRow): TemplateContent {
  const security = parseJsonb<TemplateSecurityConfig | null>(row.security, null);
  return {
    id: row.id,
    templateId: row.template_id,
    workspaceFiles: parseJsonb(row.workspace_files, {}),
    mcpServerConfigs: parseJsonb(row.mcp_server_configs, {}),
    inlineSkills: parseJsonb(row.inline_skills, {}),
    openclawConfig: parseJsonb(row.openclaw_config, {}),
    pluginDependencies: parseJsonb<PluginDependency[]>(row.plugin_dependencies, []),
    setupCommands: parseJsonb<SetupCommand[]>(row.setup_commands, []),
    customImage: (row.custom_image as string) ?? null,
    ...(security ? { security } : {}),
    createdAt: String(row.created_at),
  };
}

export async function listTemplates(filters: {
  category?: TemplateCategory;
  tags?: string[];
  search?: string;
  license?: TemplateLicense;
  trustLevel?: string;
  authorId?: string;
  featured?: boolean;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<TemplateManifest>> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  let query = db('templates').where({ is_latest: true });
  let countQuery = db('templates').where({ is_latest: true });

  if (filters.category) {
    query = query.where({ category: filters.category });
    countQuery = countQuery.where({ category: filters.category });
  }
  if (filters.license) {
    query = query.where({ license: filters.license });
    countQuery = countQuery.where({ license: filters.license });
  }
  if (filters.trustLevel) {
    query = query.where({ trust_level: filters.trustLevel });
    countQuery = countQuery.where({ trust_level: filters.trustLevel });
  }
  if (filters.authorId) {
    query = query.where({ author_id: filters.authorId });
    countQuery = countQuery.where({ author_id: filters.authorId });
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.where(function () {
      this.whereILike('name', term).orWhereILike('description', term);
    });
    countQuery = countQuery.where(function () {
      this.whereILike('name', term).orWhereILike('description', term);
    });
  }
  if (filters.tags && filters.tags.length > 0) {
    query = query.whereRaw('tags \\?| ?', [filters.tags]);
    countQuery = countQuery.whereRaw('tags \\?| ?', [filters.tags]);
  }
  if (filters.featured !== undefined) {
    query = query.where({ featured: filters.featured });
    countQuery = countQuery.where({ featured: filters.featured });
  }

  const [{ count: totalRaw }] = await countQuery.count('* as count');
  const total = Number(totalRaw);

  const rows: TemplateRow[] = await query
    .orderBy('featured', 'desc')
    .orderBy('install_count', 'desc')
    .offset(offset)
    .limit(limit);

  return {
    items: rows.map(toManifest),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTemplate(idOrSlug: string): Promise<TemplateManifest | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

  let row: TemplateRow | undefined;
  if (isUuid) {
    row = await db('templates').where({ id: idOrSlug }).first();
  } else {
    row = await db('templates').where({ slug: idOrSlug, is_latest: true }).first();
  }

  return row ? toManifest(row) : null;
}

export async function getTemplateContent(templateId: string): Promise<TemplateContent | null> {
  const row: ContentRow | undefined = await db('template_contents').where({ template_id: templateId }).first();
  return row ? toContent(row) : null;
}

export async function createTemplate(
  userId: string,
  authorName: string | null,
  req: CreateTemplateRequest,
): Promise<TemplateManifest> {
  return db.transaction(async (trx) => {
    const [templateRow]: TemplateRow[] = await trx('templates')
      .insert({
        id: randomUUID(),
        slug: req.slug,
        name: req.name,
        description: req.description ?? null,
        category: req.category ?? 'custom',
        tags: JSON.stringify(req.tags ?? []),
        locale: req.locale ?? 'en-US',
        author_id: userId,
        author_name: authorName,
        license: req.license ?? 'private',
        min_image_tag: req.minImageTag ?? null,
        agent_type: req.agentType ?? 'openclaw',
        billing_mode: req.billingMode ?? null,
        required_credentials: JSON.stringify(req.requiredCredentials ?? []),
        mcp_servers: JSON.stringify(req.mcpServers ?? {}),
        skills: JSON.stringify(req.skills ?? []),
        plugin_dependencies: JSON.stringify(req.pluginDependencies ?? []),
        suggested_channels: JSON.stringify(req.suggestedChannels ?? []),
      })
      .returning('*');

    await trx('template_contents').insert({
      template_id: templateRow.id,
      workspace_files: JSON.stringify(req.content.workspaceFiles ?? {}),
      mcp_server_configs: JSON.stringify(req.content.mcpServerConfigs ?? {}),
      inline_skills: JSON.stringify(req.content.inlineSkills ?? {}),
      openclaw_config: JSON.stringify(req.content.openclawConfig ?? {}),
      setup_commands: JSON.stringify(req.content.setupCommands ?? []),
      plugin_dependencies: JSON.stringify(req.content.pluginDependencies ?? []),
      custom_image: req.content.customImage ?? null,
      security: req.content.security ? JSON.stringify(req.content.security) : null,
    });

    const score = await computeAndPersistScore(
      trx,
      templateRow.id,
      req.content.security ?? null,
      req.mcpServers ?? {},
    );

    return toManifest({ ...templateRow, security_score: score });
  });
}

export async function updateTemplate(
  templateId: string,
  userId: string,
  updates: UpdateTemplateRequest,
): Promise<TemplateManifest> {
  const existing = await db('templates').where({ id: templateId }).first() as TemplateRow | undefined;
  if (!existing) throw new Error('Template not found');
  if (existing.author_id !== userId) throw new Error('Only the author can update this template');

  return db.transaction(async (trx) => {
    const latestRow = await trx('templates')
      .where({ slug: existing.slug, is_latest: true })
      .first() as TemplateRow | undefined;
    const newVersion = bumpVersion((latestRow ?? existing).version);

    await trx('templates').where({ slug: existing.slug, is_latest: true }).update({ is_latest: false });

    const patch: Record<string, unknown> = {
      id: randomUUID(),
      slug: existing.slug,
      version: newVersion,
      is_latest: true,
      author_id: existing.author_id,
      author_name: existing.author_name,
      agent_type: existing.agent_type,
      forked_from: existing.forked_from,
      install_count: existing.install_count,
      fork_count: existing.fork_count,
      rating: existing.rating,
    };

    if (updates.name !== undefined) patch.name = updates.name; else patch.name = existing.name;
    if (updates.description !== undefined) patch.description = updates.description; else patch.description = existing.description;
    if (updates.category !== undefined) patch.category = updates.category; else patch.category = existing.category;
    if (updates.tags !== undefined) patch.tags = JSON.stringify(updates.tags); else patch.tags = stringifyJsonb(existing.tags);
    if (updates.locale !== undefined) patch.locale = updates.locale; else patch.locale = existing.locale;
    if (updates.license !== undefined) patch.license = updates.license; else patch.license = existing.license;
    if (updates.minImageTag !== undefined) patch.min_image_tag = updates.minImageTag; else patch.min_image_tag = existing.min_image_tag;
    if (updates.requiredCredentials !== undefined) patch.required_credentials = JSON.stringify(updates.requiredCredentials); else patch.required_credentials = stringifyJsonb(existing.required_credentials);
    if (updates.mcpServers !== undefined) patch.mcp_servers = JSON.stringify(updates.mcpServers); else patch.mcp_servers = stringifyJsonb(existing.mcp_servers);
    if (updates.skills !== undefined) patch.skills = JSON.stringify(updates.skills); else patch.skills = stringifyJsonb(existing.skills);
    if (updates.pluginDependencies !== undefined) patch.plugin_dependencies = JSON.stringify(updates.pluginDependencies); else patch.plugin_dependencies = stringifyJsonb(existing.plugin_dependencies);
    if (updates.suggestedChannels !== undefined) patch.suggested_channels = JSON.stringify(updates.suggestedChannels); else patch.suggested_channels = stringifyJsonb(existing.suggested_channels);
    if (updates.billingMode !== undefined) patch.billing_mode = updates.billingMode; else patch.billing_mode = existing.billing_mode;

    const [newRow]: TemplateRow[] = await trx('templates').insert(patch).returning('*');

    const existingContent = await trx('template_contents').where({ template_id: templateId }).first() as ContentRow | undefined;
    const contentPatch = {
      template_id: newRow.id,
      workspace_files: JSON.stringify(updates.content?.workspaceFiles ?? parseJsonb(existingContent?.workspace_files, {})),
      mcp_server_configs: JSON.stringify(updates.content?.mcpServerConfigs ?? parseJsonb(existingContent?.mcp_server_configs, {})),
      inline_skills: JSON.stringify(updates.content?.inlineSkills ?? parseJsonb(existingContent?.inline_skills, {})),
      openclaw_config: JSON.stringify(updates.content?.openclawConfig ?? parseJsonb(existingContent?.openclaw_config, {})),
      setup_commands: JSON.stringify(updates.content?.setupCommands ?? parseJsonb(existingContent?.setup_commands, [])),
      plugin_dependencies: JSON.stringify(updates.content?.pluginDependencies ?? parseJsonb(existingContent?.plugin_dependencies, [])),
      custom_image: updates.content?.customImage ?? (existingContent?.custom_image as string) ?? null,
      security: updates.content !== undefined
        ? (updates.content.security ? JSON.stringify(updates.content.security) : null)
        : existingContent?.security
          ? stringifyJsonb(existingContent.security)
          : null,
    };
    await trx('template_contents').insert(contentPatch);

    const resolvedSecurity = updates.content?.security
      ?? parseJsonb<TemplateSecurityConfig | null>(existingContent?.security, null);
    const resolvedMcpServers = updates.mcpServers
      ?? parseJsonb<Record<string, unknown>>(existing.mcp_servers, {});
    const score = await computeAndPersistScore(trx, newRow.id, resolvedSecurity, resolvedMcpServers);

    return toManifest({ ...newRow, security_score: score });
  });
}

export async function deleteTemplate(templateId: string, userId: string, isAdmin = false): Promise<boolean> {
  const existing = await db('templates').where({ id: templateId }).first() as TemplateRow | undefined;
  if (!existing) return false;
  if (existing.author_id !== userId && !isAdmin) throw new Error('Only the author or an admin can delete this template');

  const count = await db('templates').where({ slug: existing.slug }).delete();
  return count > 0;
}

export async function forkTemplate(templateId: string, userId: string, authorName: string | null): Promise<TemplateManifest> {
  const original = await db('templates').where({ id: templateId }).first() as TemplateRow | undefined;
  if (!original) throw new Error('Template not found');

  const content = await db('template_contents').where({ template_id: templateId }).first() as ContentRow | undefined;

  return db.transaction(async (trx) => {
    const slug = `${original.slug}-fork-${Date.now().toString(36)}`;

    const [forked]: TemplateRow[] = await trx('templates')
      .insert({
        id: randomUUID(),
        slug,
        name: `${original.name} (Fork)`,
        description: original.description,
        category: original.category,
        tags: stringifyJsonb(original.tags),
        locale: original.locale,
        author_id: userId,
        author_name: authorName,
        license: 'private',
        min_image_tag: original.min_image_tag,
        agent_type: original.agent_type,
        billing_mode: original.billing_mode,
        required_credentials: stringifyJsonb(original.required_credentials),
        mcp_servers: stringifyJsonb(original.mcp_servers),
        skills: stringifyJsonb(original.skills),
        plugin_dependencies: stringifyJsonb(original.plugin_dependencies),
        suggested_channels: stringifyJsonb(original.suggested_channels),
        forked_from: templateId,
      })
      .returning('*');

    if (content) {
      await trx('template_contents').insert({
        template_id: forked.id,
        workspace_files: stringifyJsonb(content.workspace_files),
        mcp_server_configs: stringifyJsonb(content.mcp_server_configs),
        inline_skills: stringifyJsonb(content.inline_skills),
        openclaw_config: stringifyJsonb(content.openclaw_config),
        setup_commands: stringifyJsonb(content.setup_commands),
        plugin_dependencies: stringifyJsonb(content.plugin_dependencies),
        custom_image: (content.custom_image as string) ?? null,
        security: content.security ? stringifyJsonb(content.security) : null,
      });
    }

    await trx('templates').where({ id: templateId }).increment('fork_count', 1);

    return toManifest(forked);
  });
}

const SENSITIVE_PATTERNS = [
  { re: /^sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI API key' },
  { re: /^hapi-[a-zA-Z0-9-]+/, label: 'HubSpot API key' },
  { re: /^xoxb-[a-zA-Z0-9-]+/, label: 'Slack bot token' },
  { re: /^ghp_[a-zA-Z0-9]+/, label: 'GitHub PAT' },
  { re: /^gsk_[a-zA-Z0-9]+/, label: 'Groq API key' },
  { re: /^AIza[a-zA-Z0-9_-]+/, label: 'Google API key' },
];

function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export async function exportFromInstance(
  instanceId: string,
  userId: string,
): Promise<ExportTemplateResponse> {
  const instance = await db('instances').where({ id: instanceId, user_id: userId }).first();
  if (!instance) throw new Error('Instance not found');

  // If instance is running, try reverse adapter for live extraction.
  // runtime_id may be NULL (e.g. dev env reconciliation gap) — fall back to container name.
  if (instance.status === 'running') {
    try {
      const deployTarget = (instance.deployment_target as DeploymentTarget) || 'docker';
      const engine = getRuntimeEngine(deployTarget);
      if (engine.readFile) {
        // Resolve runtimeId: use stored value, or construct container name from convention
        const runtimeId = (instance.runtime_id as string | null)
          || `${instance.agent_type || 'openclaw'}-${instanceId.slice(0, 8)}`;
        const credentials = await db('instance_credentials')
          .where({ instance_id: instanceId })
          .select('provider', 'credential_type');
        return await reverseAdaptFromContainer(
          engine,
          runtimeId,
          instance as Instance,
          credentials,
        );
      }
    } catch {
      // Fall through to DB-only export
    }
  }

  // DB-only fallback: parse config JSON (may be corrupt in dev environments)
  let config: Record<string, unknown>;
  try {
    config = typeof instance.config === 'string' ? JSON.parse(instance.config) : (instance.config ?? {});
  } catch {
    config = {};
  }
  const warnings: SecurityWarning[] = [];

  const workspaceFiles: Record<string, string> = {};
  const workspaceKeys = ['agentsmd', 'soulmd', 'identitymd', 'usermd', 'toolsmd', 'bootstrapmd', 'heartbeatmd', 'memorymd'] as const;
  for (const key of workspaceKeys) {
    const displayKey = CONFIG_KEY_TO_DISPLAY[key] ?? key;
    if (config[key]) {
      workspaceFiles[displayKey] = config[key] as string;
    } else if (config[displayKey]) {
      workspaceFiles[displayKey] = config[displayKey] as string;
    }
  }

  const mcpServerConfigs = (config.mcpServers ?? {}) as Record<string, unknown>;
  const sanitizedMcpConfigs: Record<string, unknown> = {};

  for (const [name, serverConfig] of Object.entries(mcpServerConfigs)) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      sanitizedMcpConfigs[name] = serverConfig;
      continue;
    }

    const cfg = { ...(serverConfig as Record<string, unknown>) };

    const env = cfg.env as Record<string, string> | undefined;
    if (env && typeof env === 'object') {
      const sanitizedEnv: Record<string, string> = {};
      for (const [envKey, envValue] of Object.entries(env)) {
        let isSensitive = false;
        for (const { re } of SENSITIVE_PATTERNS) {
          if (re.test(envValue)) {
            isSensitive = true;
            warnings.push({
              type: 'possible_hardcoded_key',
              location: `mcpServers.${name}.env.${envKey}`,
              pattern: maskValue(envValue),
              suggestion: `Replace with \${CREDENTIAL:${name}:api_key}`,
            });
            sanitizedEnv[envKey] = `\${CREDENTIAL:${name}:api_key}`;
            break;
          }
        }
        if (!isSensitive) {
          sanitizedEnv[envKey] = envValue;
        }
      }
      cfg.env = sanitizedEnv;
    }

    const headers = cfg.headers as Record<string, string> | undefined;
    if (headers && typeof headers === 'object') {
      const sanitizedHeaders: Record<string, string> = {};
      for (const [headerKey, headerValue] of Object.entries(headers)) {
        let isSensitive = false;
        for (const { re } of SENSITIVE_PATTERNS) {
          if (re.test(headerValue)) {
            isSensitive = true;
            warnings.push({
              type: 'possible_hardcoded_key',
              location: `mcpServers.${name}.headers.${headerKey}`,
              pattern: maskValue(headerValue),
              suggestion: `Replace with \${CREDENTIAL:${name}:api_key}`,
            });
            sanitizedHeaders[headerKey] = `\${CREDENTIAL:${name}:api_key}`;
            break;
          }
        }
        if (!isSensitive) {
          sanitizedHeaders[headerKey] = headerValue;
        }
      }
      cfg.headers = sanitizedHeaders;
    }

    sanitizedMcpConfigs[name] = cfg;
  }

  // Read extension lifecycle tables (TMPL-01, TMPL-02)
  const EXPORTABLE_STATUSES: ExtensionStatus[] = ['active', 'installed', 'disabled', 'degraded'];
  const extensions: TemplateExtensionDeclaration[] = [];

  const pluginRows = await db('instance_plugins')
    .where({ instance_id: instanceId })
    .whereIn('status', EXPORTABLE_STATUSES);

  const skillRows = await db('instance_skills')
    .where({ instance_id: instanceId })
    .whereIn('status', EXPORTABLE_STATUSES);

  // Build a Set of extension IDs that have OAuth credentials (oauth_token sentinel rows).
  // These rows are written by oauth-proxy.ts callback after successful token exchange.
  // Without this detection, requiresReAuth would never be set on export.
  const instanceCreds = await db('instance_credentials')
    .where({ instance_id: instanceId })
    .select('provider', 'credential_type', 'metadata');

  const oauthExtensionIds = new Set<string>();
  for (const cred of instanceCreds) {
    if (cred.credential_type === 'oauth_token') {
      const meta = typeof cred.metadata === 'string'
        ? JSON.parse(cred.metadata) as Record<string, unknown>
        : ((cred.metadata as Record<string, unknown>) ?? {});
      if (meta.extensionId && typeof meta.extensionId === 'string') {
        oauthExtensionIds.add(meta.extensionId);
      }
      // Also add by provider name as fallback (provider may match extensionId for extension-scoped creds)
      if (typeof cred.provider === 'string') {
        oauthExtensionIds.add(cred.provider);
      }
    }
  }

  if (pluginRows.length > 0 || skillRows.length > 0) {
    for (const row of pluginRows) {
      const status = row.status as ExtensionStatus;
      const pluginId = row.plugin_id as string;
      const isOAuth = oauthExtensionIds.has(pluginId);
      const baseConfig = parseJsonb<Record<string, unknown>>(row.config, {});
      extensions.push({
        id: pluginId,
        kind: 'plugin',
        source: parseJsonb<TemplateExtensionDeclaration['source']>(row.source, { type: 'bundled' }),
        lockedVersion: (row.locked_version as string | null) ?? null,
        integrityHash: (row.integrity_hash as string | null) ?? null,
        enabled: status !== 'disabled',
        needsCredentials: isOAuth ? true : status === 'installed',
        ...(isOAuth ? { requiresReAuth: true } : {}),
        // For OAuth extensions, clear any OAuth-specific config to prevent token leakage
        config: isOAuth ? {} : baseConfig,
      });
    }

    for (const row of skillRows) {
      const status = row.status as ExtensionStatus;
      const skillId = row.skill_id as string;
      const isOAuth = oauthExtensionIds.has(skillId);
      const baseConfig = parseJsonb<Record<string, unknown>>(row.config, {});
      extensions.push({
        id: skillId,
        kind: 'skill',
        source: parseJsonb<TemplateExtensionDeclaration['source']>(row.source, { type: 'bundled' }),
        lockedVersion: (row.locked_version as string | null) ?? null,
        integrityHash: (row.integrity_hash as string | null) ?? null,
        enabled: status !== 'disabled',
        needsCredentials: isOAuth ? true : status === 'installed',
        ...(isOAuth ? { requiresReAuth: true } : {}),
        // For OAuth extensions, clear any OAuth-specific config to prevent token leakage
        config: isOAuth ? {} : baseConfig,
      });
    }
  } else {
    // Legacy fallback: instance_plugins/instance_skills tables empty — use plugin_dependencies from template_contents
    // (pre-migration instances that pre-date lifecycle table tracking)
    const templateContent = instance.template_id
      ? await db('template_contents').where({ template_id: instance.template_id }).first()
      : null;

    if (templateContent) {
      const legacyPlugins = parseJsonb<PluginDependency[]>(templateContent.plugin_dependencies, []);
      for (const plugin of legacyPlugins) {
        extensions.push({
          id: plugin.id,
          kind: 'plugin',
          source: { type: 'bundled' },
          lockedVersion: null,
          integrityHash: null,
          enabled: true,
          needsCredentials: !!(plugin.credentialKeys && plugin.credentialKeys.length > 0),
          config: plugin.config ?? {},
        });
      }
    }
  }

  // Scrub OpenClaw config credential fields (TMPL-03)
  const openclawConfig: Record<string, unknown> = {};

  const rawPlugins = config.plugins as Record<string, unknown> | undefined;
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

  const rawSkills = config.skills as Record<string, unknown> | undefined;
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
          let scrubbed = false;
          for (const { re } of SENSITIVE_PATTERNS) {
            if (re.test(fieldValue)) {
              entryCopy[sensitiveField] = `\${CREDENTIAL:${skillId}:${sensitiveField}}`;
              warnings.push({
                type: 'possible_hardcoded_key',
                location: `skills.entries.${skillId}.${sensitiveField}`,
                pattern: maskValue(fieldValue),
                suggestion: `Replace with \${CREDENTIAL:${skillId}:${sensitiveField}}`,
              });
              scrubbed = true;
              break;
            }
          }
          if (scrubbed) continue;
        }
      }
      scrubbedSkillEntries[skillId] = entryCopy;
    }
    openclawConfig.skills = { ...rawSkills, entries: scrubbedSkillEntries };
  }

  const rawProviders = config.providers as Record<string, unknown> | undefined;
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
        let scrubbed = false;
        for (const { re } of SENSITIVE_PATTERNS) {
          if (re.test(apiKey)) {
            pCfgCopy.api_key = `\${CREDENTIAL:${providerName}:api_key}`;
            warnings.push({
              type: 'possible_hardcoded_key',
              location: `providers.${providerName}.api_key`,
              pattern: maskValue(apiKey),
              suggestion: `Replace with \${CREDENTIAL:${providerName}:api_key}`,
            });
            scrubbed = true;
            break;
          }
        }
        if (scrubbed) {
          scrubbedProviders[providerName] = pCfgCopy;
          continue;
        }
      }
      scrubbedProviders[providerName] = pCfgCopy;
    }
    openclawConfig.providers = scrubbedProviders;
  }

  return {
    draft: {
      slug: slugify(instance.name as string),
      name: instance.name as string,
      description: `Exported from instance "${instance.name as string}"`,
      category: 'custom',
      tags: [],
      agentType: instance.agent_type as string,
      minImageTag: instance.image_tag as string,
      billingMode: (instance.billing_mode as BillingMode) ?? undefined,
    },
    content: {
      workspaceFiles,
      mcpServerConfigs: sanitizedMcpConfigs,
      inlineSkills: {},
      openclawConfig,
      setupCommands: [],
      customImage: null,
      extensions,
    },
    securityWarnings: warnings,
  };
}

function generateDependencySetupCommands(
  skills: SkillDeclaration[],
  pluginDeps: PluginDependency[],
  mcpServers: Record<string, McpServerDeclaration>,
): SetupCommand[] {
  const commands: SetupCommand[] = [];
  const npmPackages: string[] = [];

  for (const skill of skills) {
    if (skill.source?.type === 'npm' && skill.source.spec) {
      npmPackages.push(skill.source.spec);
    } else if (skill.source?.type === 'clawhub' && skill.source.slug) {
      const spec = skill.source.version
        ? `@openclaw/skill-${skill.source.slug}@${skill.source.version}`
        : `@openclaw/skill-${skill.source.slug}`;
      npmPackages.push(spec);
    }
  }

  for (const plugin of pluginDeps) {
    if (plugin.npmSpec) {
      npmPackages.push(plugin.npmSpec);
    }
  }

  if (npmPackages.length > 0) {
    commands.push({
      command: ['npm', 'install', '--save', ...npmPackages],
      description: `Install ${npmPackages.length} package(s): ${npmPackages.join(', ')}`,
      timeout: 120_000,
    });
  }

  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.url) continue;

    if (server.installCommand && server.installCommand.length > 0) {
      commands.push({
        command: server.installCommand,
        description: `Install MCP server: ${name}`,
        timeout: 120_000,
      });
    } else if (server.installSpec) {
      const runtime = server.runtime ?? 'node';
      if (runtime === 'node') {
        commands.push({
          command: ['npm', 'install', '--save', server.installSpec],
          description: `Install MCP server: ${name} (${server.installSpec})`,
          timeout: 120_000,
        });
      } else if (runtime === 'python') {
        commands.push({
          command: ['pip', 'install', server.installSpec],
          description: `Install MCP server: ${name} (${server.installSpec})`,
          timeout: 120_000,
        });
      }
    }
  }

  return commands;
}

export async function instantiateTemplate(
  templateId: string,
  userId: string,
  req: InstantiateTemplateRequest,
): Promise<InstantiateTemplateResponse> {
  const template = await db('templates').where({ id: templateId }).first() as TemplateRow | undefined;
  if (!template) throw new Error('Template not found');

  const content = await db('template_contents').where({ template_id: templateId }).first() as ContentRow | undefined;

  const credentialStatus: Record<string, 'provided' | 'from_vault' | 'missing'> = {};
  const credentialsToStore: Array<{ provider: string; credentialType: string; value: string }> = [];

  const requiredCreds = parseJsonb<Array<{ provider: string; credentialType: string; required: boolean }>>(template.required_credentials, []);

  for (const cred of requiredCreds) {
    const key = `${cred.provider}:${cred.credentialType}`;
    const providedValue = req.credentials?.[key];

    if (providedValue) {
      credentialStatus[key] = 'provided';
      credentialsToStore.push({ provider: cred.provider, credentialType: cred.credentialType, value: providedValue });

      if (req.saveToVault?.includes(key)) {
        await addUserCredential(userId, cred.provider, cred.credentialType, providedValue);
      }
    } else if (providedValue === null) {
      try {
        const vaultValue = await resolveCredential('', userId, cred.provider, cred.credentialType);
        credentialStatus[key] = 'from_vault';
        credentialsToStore.push({ provider: cred.provider, credentialType: cred.credentialType, value: vaultValue });
      } catch {
        if (cred.required) {
          credentialStatus[key] = 'missing';
        }
      }
    } else {
      try {
        const vaultValue = await resolveCredential('', userId, cred.provider, cred.credentialType);
        credentialStatus[key] = 'from_vault';
        credentialsToStore.push({ provider: cred.provider, credentialType: cred.credentialType, value: vaultValue });
      } catch {
        if (cred.required) {
          credentialStatus[key] = 'missing';
        }
      }
    }
  }

  const missingRequired = Object.entries(credentialStatus)
    .filter(([, status]) => status === 'missing')
    .map(([key]) => key);

  if (missingRequired.length > 0) {
    throw new Error(`Missing required credentials: ${missingRequired.join(', ')}`);
  }

  const workspaceFiles = content ? parseJsonb<Record<string, string>>(content.workspace_files, {}) : {};
  const mcpServerConfigs = content ? parseJsonb<Record<string, unknown>>(content.mcp_server_configs, {}) : {};
  const openclawConfig = content ? parseJsonb<Record<string, unknown>>(content.openclaw_config, {}) : {};
  const explicitSetupCommands = content ? parseJsonb<SetupCommand[]>(content.setup_commands, []) : [];
  const customImage = content ? ((content.custom_image as string) ?? null) : null;
  const templateSecurity = content ? parseJsonb<TemplateSecurityConfig | null>(content.security, null) : null;

  // Discriminate between new TemplateExtensionDeclaration[] (has 'kind' field) and legacy PluginDependency[].
  // New templates exported after Plan 04-01 store TemplateExtensionDeclaration[] in content.plugin_dependencies.
  // Legacy templates store PluginDependency[] and are handled by generateDependencySetupCommands below.
  const rawExtData = content
    ? parseJsonb<unknown[]>(content.plugin_dependencies, [])
    : [];
  const templateExtensions: TemplateExtensionDeclaration[] = rawExtData
    .filter((item): item is TemplateExtensionDeclaration =>
      typeof item === 'object' && item !== null && 'kind' in item);

  const autoSetupCommands = templateExtensions.length > 0
    // New format: lifecycle rows handle plugin/skill installation; only generate MCP server setup commands
    ? generateDependencySetupCommands([], [], parseJsonb<Record<string, McpServerDeclaration>>(template.mcp_servers, {}))
    // Legacy format: generate setup commands for skills and plugin dependencies as before
    : generateDependencySetupCommands(
        parseJsonb<SkillDeclaration[]>(template.skills, []),
        parseJsonb<PluginDependency[]>(template.plugin_dependencies, []),
        parseJsonb<Record<string, McpServerDeclaration>>(template.mcp_servers, {}),
      );

  const setupCommands = [...autoSetupCommands, ...explicitSetupCommands];

  const resolvedSecurityProfile = req.securityProfile ?? 'standard';

  if (templateSecurity?.minSecurityProfile) {
    const profileOrder: SecurityProfile[] = ['strict', 'standard', 'developer', 'unrestricted'];
    const templateLevel = profileOrder.indexOf(templateSecurity.minSecurityProfile);
    const instanceLevel = profileOrder.indexOf(resolvedSecurityProfile);

    if (instanceLevel > templateLevel) {
      throw new Error(
        `Template requires ${templateSecurity.minSecurityProfile} security level, ` +
        `but instance is ${resolvedSecurityProfile}`
      );
    }
  }

  const instanceConfig: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(workspaceFiles)) {
    const configKey = DISPLAY_TO_CONFIG_KEY[key] ?? key;
    instanceConfig[configKey] = value;
  }

  if (Object.keys(mcpServerConfigs).length > 0) {
    instanceConfig.mcpServers = mcpServerConfigs;
  }

  for (const [key, value] of Object.entries(openclawConfig)) {
    instanceConfig[key] = value;
  }

  // Store setup commands so instance-manager can execute them post-start
  if (setupCommands.length > 0) {
    instanceConfig.__setupCommands = setupCommands;
  }

  // Store template security config so adapter can inject custom rules into SOUL.md
  if (templateSecurity) {
    instanceConfig.__templateSecurity = templateSecurity;
  }

  // Use custom image from template content, or fall back to manifest min_image_tag, then request imageTag
  const resolvedImageTag = customImage ?? req.imageTag ?? template.min_image_tag ?? undefined;

  // Resolve billing mode: request override → template default → 'byok' fallback
  const resolvedBillingMode = req.billingMode ?? (template.billing_mode as BillingMode | null) ?? 'byok';

  const instance = await createInstance(userId, {
    name: req.instanceName,
    agentType: template.agent_type,
    imageTag: resolvedImageTag,
    deploymentTarget: req.deploymentTarget,
    billingMode: resolvedBillingMode,
    securityProfile: resolvedSecurityProfile,
    config: instanceConfig,
  });

  await db('instances').where({ id: instance.id }).update({
    template_id: templateId,
    template_version: template.version,
  });

  // ─── Trust Re-evaluation and Lifecycle Row Insertion ─────────────────────────
  // For each extension in the template (new format only), evaluate trust policy
  // synchronously at import time. Only extensions that pass get lifecycle rows.
  const blockedExtensions: Array<{ id: string; kind: ExtensionKind; reason: string }> = [];
  const requiresTrustOverride: Array<{ id: string; kind: ExtensionKind; source: PluginSource | ExtensionSkillSource; reason: string }> = [];
  let extensionsImported = 0;

  for (const ext of templateExtensions) {
    // evaluateTrustPolicy with null signals (no gateway running at import time):
    //   bundled   → allow (tier=bundled)
    //   non-bundled + null signals → tier=unscanned → block
    //   community with existing DB override → allow
    //   community without override → block (returned in requiresTrustOverride[])
    const evaluation = await evaluateTrustPolicy(
      instance.id,
      ext.id,
      ext.kind,
      ext.source,
      null, // No gateway running at import time — no ClawHub signals available
    );

    if (evaluation.decision === 'block') {
      if (evaluation.tier === 'community') {
        // Community extension without admin override on this instance
        requiresTrustOverride.push({
          id: ext.id,
          kind: ext.kind,
          source: ext.source,
          reason: evaluation.blockReason ?? 'Community extension requires admin trust override',
        });
      } else {
        // unscanned / scan-failed → hard block per trust policy: cannot instantiate
        blockedExtensions.push({
          id: ext.id,
          kind: ext.kind,
          reason: evaluation.blockReason ?? 'Extension blocked by trust policy',
        });
      }
      continue; // Do NOT insert lifecycle row for blocked extensions
    }

    // evaluation.decision === 'allow' → insert lifecycle row
    // If requiresReAuth=true, force 'installed' status so the extension waits
    // for user re-authentication via OAuth before being loaded by seedConfig.
    const now = new Date().toISOString();
    const initialStatus = ext.requiresReAuth
      ? 'installed'
      : (ext.enabled ? 'pending' : 'disabled');

    if (ext.kind === 'plugin') {
      await db('instance_plugins').insert({
        id: randomUUID(),
        instance_id: instance.id,
        plugin_id: ext.id,
        source: JSON.stringify(ext.source),
        locked_version: ext.lockedVersion,
        integrity_hash: ext.integrityHash,
        enabled: ext.enabled,
        config: JSON.stringify(ext.config ?? {}),
        status: initialStatus,
        installed_at: now,
        updated_at: now,
      });
    } else {
      // kind === 'skill'
      await db('instance_skills').insert({
        id: randomUUID(),
        instance_id: instance.id,
        skill_id: ext.id,
        source: JSON.stringify(ext.source),
        locked_version: ext.lockedVersion,
        integrity_hash: ext.integrityHash,
        enabled: ext.enabled,
        config: JSON.stringify(ext.config ?? {}),
        status: initialStatus,
        installed_at: now,
        updated_at: now,
      });
    }
    extensionsImported += 1;
  }

  for (const cred of credentialsToStore) {
    await addCredential(instance.id, cred.provider, cred.credentialType, cred.value);
  }

  await db('templates').where({ id: templateId }).increment('install_count', 1);

  return {
    instance: { ...instance, templateId, templateVersion: template.version } as unknown as Instance,
    credentialStatus,
    blockedExtensions: blockedExtensions.length > 0 ? blockedExtensions : undefined,
    requiresTrustOverride: requiresTrustOverride.length > 0 ? requiresTrustOverride : undefined,
    extensionsImported: extensionsImported > 0 ? extensionsImported : undefined,
  };
}

function bumpVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length === 3) {
    parts[2] += 1;
    return parts.join('.');
  }
  return `${current}.1`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128) || 'template';
}

const DISPLAY_TO_CONFIG_KEY: Record<string, string> = {
  'AGENTS.md': 'agentsmd',
  'SOUL.md': 'soulmd',
  'IDENTITY.md': 'identitymd',
  'USER.md': 'usermd',
  'TOOLS.md': 'toolsmd',
  'BOOTSTRAP.md': 'bootstrapmd',
  'HEARTBEAT.md': 'heartbeatmd',
  'MEMORY.md': 'memorymd',
};

const CONFIG_KEY_TO_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_TO_CONFIG_KEY).map(([k, v]) => [v, k]),
);
