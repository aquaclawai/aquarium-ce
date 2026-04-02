import type { ConfigChangeSummary } from '@aquarium/shared';

export interface ConfigFieldMeta {
  key: string;
  label: string;
  labelKey: string; // i18n key for frontend
  category: ConfigChangeSummary['category'];
  valueFormatter?: (value: unknown) => string;
}

/**
 * Registry of all tracked config fields for openclaw agent type.
 * Maps config JSON keys to human-readable labels and categories.
 */
export const CONFIG_FIELD_META: ConfigFieldMeta[] = [
  // ── Core Settings ──
  {
    key: 'defaultProvider',
    label: 'Default Provider',
    labelKey: 'configFields.defaultProvider',
    category: 'core',
  },
  {
    key: 'defaultModel',
    label: 'Default Model',
    labelKey: 'configFields.defaultModel',
    category: 'core',
  },
  {
    key: 'agentName',
    label: 'Agent Name',
    labelKey: 'configFields.agentName',
    category: 'core',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    labelKey: 'configFields.temperature',
    category: 'core',
    valueFormatter: (v) => {
      if (typeof v === 'number') {
        if (v <= 0.3) return `工作模式 (${v})`;
        if (v >= 0.7) return `生活模式 (${v})`;
        return `平衡模式 (${v})`;
      }
      return String(v ?? '—');
    },
  },
  {
    key: 'customPrinciples',
    label: 'Custom Principles',
    labelKey: 'configFields.customPrinciples',
    category: 'core',
    valueFormatter: (v) => {
      if (Array.isArray(v)) return `共 ${v.length} 条原则`;
      return String(v ?? '—');
    },
  },

  // ── Workspace Files ──
  {
    key: 'agentsmd',
    label: 'AGENTS.md',
    labelKey: 'configFields.agentsmd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'soulmd',
    label: 'SOUL.md',
    labelKey: 'configFields.soulmd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'identitymd',
    label: 'IDENTITY.md',
    labelKey: 'configFields.identitymd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'usermd',
    label: 'USER.md',
    labelKey: 'configFields.usermd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'toolsmd',
    label: 'TOOLS.md',
    labelKey: 'configFields.toolsmd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'bootstrapmd',
    label: 'BOOTSTRAP.md',
    labelKey: 'configFields.bootstrapmd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'heartbeatmd',
    label: 'HEARTBEAT.md',
    labelKey: 'configFields.heartbeatmd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },
  {
    key: 'memorymd',
    label: 'MEMORY.md',
    labelKey: 'configFields.memorymd',
    category: 'workspace',
    valueFormatter: formatFileSize,
  },

  // ── Channels ──
  {
    key: 'enableWhatsApp',
    label: 'WhatsApp',
    labelKey: 'configFields.enableWhatsApp',
    category: 'channel',
    valueFormatter: (v) => (v ? '已启用' : '未启用'),
  },
  {
    key: 'enableTelegram',
    label: 'Telegram',
    labelKey: 'configFields.enableTelegram',
    category: 'channel',
    valueFormatter: (v) => (v ? '已启用' : '未启用'),
  },

  // ── Tools ──
  {
    key: 'toolPermissions',
    label: 'Tool Permissions',
    labelKey: 'configFields.toolPermissions',
    category: 'tool',
    valueFormatter: (v) => {
      if (typeof v === 'object' && v !== null) {
        const count = Object.keys(v).length;
        return `${count} 个工具权限`;
      }
      return String(v ?? '—');
    },
  },

  // ── MCP ──
  {
    key: 'mcpServers',
    label: 'MCP Servers',
    labelKey: 'configFields.mcpServers',
    category: 'mcp',
    valueFormatter: (v) => {
      if (typeof v === 'object' && v !== null) {
        const count = Object.keys(v).length;
        return `${count} 个 MCP 服务`;
      }
      return String(v ?? '—');
    },
  },
];

/**
 * Get field metadata by key
 */
export function getFieldMeta(key: string): ConfigFieldMeta | undefined {
  return CONFIG_FIELD_META.find((f) => f.key === key);
}

/**
 * Get all tracked field keys
 */
export function getTrackedFieldKeys(): string[] {
  return CONFIG_FIELD_META.map((f) => f.key);
}

// ── Helpers ──

function formatFileSize(v: unknown): string {
  if (typeof v === 'string') {
    const bytes = Buffer.byteLength(v, 'utf8');
    if (bytes === 0) return '（空）';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return String(v ?? '（空）');
}
