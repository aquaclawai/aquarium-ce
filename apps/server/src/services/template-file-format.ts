import archiver from 'archiver';
import AdmZip from 'adm-zip';
import type {
  TemplateManifest,
  TemplateContent,
  CredentialRequirement,
  McpServerDeclaration,
  SkillDeclaration,
  PluginDependency,
  SetupCommand,
  TemplateSecurityConfig,
  TemplateCategory,
  TemplateLicense,
  BillingMode,
  TemplateExtensionDeclaration,
} from '@aquarium/shared';

export interface ParsedOctemplate {
  manifest: {
    name: string;
    slug: string;
    description?: string;
    category?: TemplateCategory;
    tags?: string[];
    locale?: string;
    license?: TemplateLicense;
    agentType?: string;
    minImageTag?: string;
    billingMode?: BillingMode;
    requiredCredentials?: CredentialRequirement[];
    mcpServers?: Record<string, McpServerDeclaration>;
    skills?: SkillDeclaration[];
    pluginDependencies?: PluginDependency[];
    suggestedChannels?: string[];
  };
  content: {
    workspaceFiles: Record<string, string>;
    mcpServerConfigs?: Record<string, unknown>;
    inlineSkills: Record<string, unknown>;
    openclawConfig?: Record<string, unknown>;
    pluginDependencies?: PluginDependency[];
    setupCommands?: SetupCommand[];
    security?: TemplateSecurityConfig;
    extensions?: TemplateExtensionDeclaration[];
  };
}

interface TemplateJsonSchema {
  version: string;
  name: string;
  slug: string;
  description?: string | null;
  category?: string;
  tags?: string[];
  locale?: string;
  license?: string;
  agentType?: string;
  minImageTag?: string | null;
  billingMode?: string | null;
  credentials?: CredentialRequirement[];
  mcpServers?: Record<string, McpServerDeclaration>;
  plugins?: PluginDependency[];
  skills?: SkillDeclaration[];
  suggestedChannels?: string[];
  openclawConfig?: Record<string, unknown>;
  setupCommands?: SetupCommand[];
  security?: TemplateSecurityConfig;
  extensions?: TemplateExtensionDeclaration[];
}

export async function generateOctemplate(
  manifest: TemplateManifest,
  content: TemplateContent,
): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finalized = new Promise<Buffer>((resolve, reject) => {
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });

  const templateJson: TemplateJsonSchema = {
    version: '1',
    name: manifest.name,
    slug: manifest.slug,
    description: manifest.description,
    category: manifest.category,
    tags: manifest.tags,
    locale: manifest.locale,
    license: manifest.license,
    agentType: manifest.agentType,
    minImageTag: manifest.minImageTag,
    billingMode: manifest.billingMode,
    credentials: manifest.requiredCredentials,
    mcpServers: manifest.mcpServers,
    plugins: manifest.pluginDependencies ?? [],
    skills: manifest.skills,
    suggestedChannels: manifest.suggestedChannels,
    openclawConfig: content.openclawConfig,
    setupCommands: content.setupCommands,
    security: content.security,
    extensions: (content as { extensions?: TemplateExtensionDeclaration[] }).extensions ?? [],
  };

  archive.append(JSON.stringify(templateJson, null, 2), { name: 'template.json' });

  for (const [filename, fileContent] of Object.entries(content.workspaceFiles)) {
    archive.append(fileContent, { name: `workspace/${filename}` });
  }

  for (const [skillId, skillContent] of Object.entries(content.inlineSkills)) {
    if (typeof skillContent === 'string') {
      archive.append(skillContent, { name: `skills/${skillId}/SKILL.md` });
    } else {
      archive.append(JSON.stringify(skillContent, null, 2), { name: `skills/${skillId}/config.json` });
    }
  }

  await archive.finalize();
  return finalized;
}

export async function parseOctemplate(buffer: Buffer): Promise<ParsedOctemplate> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  let templateData: TemplateJsonSchema | null = null;
  const workspaceFiles: Record<string, string> = {};
  const inlineSkills: Record<string, unknown> = {};

  for (const entry of entries) {
    const name = entry.entryName;

    if (name === 'template.json') {
      const raw = entry.getData().toString('utf-8');
      templateData = JSON.parse(raw) as TemplateJsonSchema;
      continue;
    }

    if (name.startsWith('workspace/') && !entry.isDirectory) {
      const filename = name.slice('workspace/'.length);
      if (filename) {
        workspaceFiles[filename] = entry.getData().toString('utf-8');
      }
      continue;
    }

    if (name.startsWith('skills/') && !entry.isDirectory) {
      const parts = name.slice('skills/'.length).split('/');
      if (parts.length === 2) {
        const skillId = parts[0];
        const skillFile = parts[1];
        const raw = entry.getData().toString('utf-8');
        if (skillFile === 'SKILL.md') {
          inlineSkills[skillId] = raw;
        } else if (skillFile === 'config.json') {
          try {
            inlineSkills[skillId] = JSON.parse(raw) as unknown;
          } catch {
            inlineSkills[skillId] = raw;
          }
        }
      }
    }
  }

  if (!templateData) {
    throw new Error('Invalid .octemplate: missing template.json');
  }

  const mcpServerConfigs: Record<string, unknown> = {};
  if (templateData.mcpServers) {
    for (const [name, server] of Object.entries(templateData.mcpServers)) {
      mcpServerConfigs[name] = { ...server };
    }
  }

  return {
    manifest: {
      name: templateData.name,
      slug: templateData.slug,
      description: templateData.description ?? undefined,
      category: templateData.category as TemplateCategory | undefined,
      tags: templateData.tags,
      locale: templateData.locale,
      license: templateData.license as TemplateLicense | undefined,
      agentType: templateData.agentType,
      minImageTag: templateData.minImageTag ?? undefined,
      billingMode: templateData.billingMode as BillingMode | undefined,
      requiredCredentials: templateData.credentials,
      mcpServers: templateData.mcpServers,
      skills: templateData.skills,
      pluginDependencies: templateData.plugins,
      suggestedChannels: templateData.suggestedChannels,
    },
    content: {
      workspaceFiles,
      mcpServerConfigs: Object.keys(mcpServerConfigs).length > 0 ? mcpServerConfigs : undefined,
      inlineSkills,
      openclawConfig: templateData.openclawConfig,
      pluginDependencies: templateData.plugins,
      setupCommands: templateData.setupCommands,
      security: templateData.security,
      extensions: templateData.extensions,
    },
  };
}
