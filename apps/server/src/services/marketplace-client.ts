import { config } from '../config.js';
import type { ClawHubCatalogEntry, TrustSignals, ExtensionKind, ExtensionCredentialRequirement } from '@aquarium/shared';

// ─── Built-in Registry (CE catalog fallback) ────────────────────────────────

const BUILTIN_REGISTRY: ClawHubCatalogEntry[] = [
  {
    id: 'web-search',
    name: 'Web Search',
    description: 'Search the web using DuckDuckGo or Google. Enables the agent to find current information, articles, and documentation.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'search',
    trustSignals: { verifiedPublisher: true, downloadCount: 12400, ageInDays: 180, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: 'web-browse',
    name: 'Web Browser',
    description: 'Fetch and read web pages, extract content from URLs. Enables the agent to browse documentation, articles, and online resources.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'search',
    trustSignals: { verifiedPublisher: true, downloadCount: 9800, ageInDays: 160, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: 'code-interpreter',
    name: 'Code Interpreter',
    description: 'Execute Python code in a sandboxed environment. Run scripts, analyze data, generate charts, and process files.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'development',
    trustSignals: { verifiedPublisher: true, downloadCount: 15200, ageInDays: 200, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: ['python3'],
  },
  {
    id: 'file-manager',
    name: 'File Manager',
    description: 'Read, write, and manage files in the agent workspace. Supports text, JSON, CSV, and binary files.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'utility',
    trustSignals: { verifiedPublisher: true, downloadCount: 11000, ageInDays: 190, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: 'image-generation',
    name: 'Image Generation',
    description: 'Generate images from text prompts using OpenAI DALL-E or Stability AI. Create illustrations, diagrams, and visual content.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'media',
    trustSignals: { verifiedPublisher: true, downloadCount: 7600, ageInDays: 140, virusTotalPassed: true },
    requiredCredentials: [
      { field: 'openai_api_key', label: 'OpenAI API Key', type: 'api_key', required: true, description: 'API key for DALL-E image generation' },
    ],
    requiredBinaries: [],
  },
  {
    id: 'spreadsheet',
    name: 'Spreadsheet',
    description: 'Read and write Excel (.xlsx) and CSV files. Analyze tabular data, create reports, and manipulate spreadsheets.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'data',
    trustSignals: { verifiedPublisher: true, downloadCount: 5400, ageInDays: 120, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: ['python3'],
    hasScripts: true,
  },
  {
    id: 'email-sender',
    name: 'Email Sender',
    description: 'Send emails via SMTP or API. Supports HTML content, attachments, and template-based emails.',
    version: '1.0.0',
    kind: 'skill',
    publisher: 'openclaw',
    category: 'communication',
    trustSignals: { verifiedPublisher: true, downloadCount: 4200, ageInDays: 100, virusTotalPassed: true },
    requiredCredentials: [
      { field: 'smtp_password', label: 'SMTP Password', type: 'api_key', required: true, description: 'SMTP server password or app-specific password' },
    ],
    requiredBinaries: [],
  },
  {
    id: 'webhook-plugin',
    name: 'Webhook Integration',
    description: 'Receive and process incoming webhooks. Trigger agent actions from external services like GitHub, Stripe, or Zapier.',
    version: '1.0.0',
    kind: 'plugin',
    publisher: 'openclaw',
    category: 'integration',
    trustSignals: { verifiedPublisher: true, downloadCount: 6300, ageInDays: 150, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ['webhook-receiver', 'event-trigger'],
  },
  {
    id: 'scheduler-plugin',
    name: 'Task Scheduler',
    description: 'Schedule recurring tasks and cron jobs for the agent. Automate periodic checks, reports, and maintenance.',
    version: '1.0.0',
    kind: 'plugin',
    publisher: 'openclaw',
    category: 'automation',
    trustSignals: { verifiedPublisher: true, downloadCount: 4800, ageInDays: 130, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ['cron-scheduler', 'task-queue'],
  },
  {
    id: 'knowledge-base-plugin',
    name: 'Knowledge Base',
    description: 'Index and search documents for RAG (Retrieval-Augmented Generation). Upload PDFs, docs, and text files to build a searchable knowledge base.',
    version: '1.0.0',
    kind: 'plugin',
    publisher: 'openclaw',
    category: 'data',
    trustSignals: { verifiedPublisher: true, downloadCount: 8900, ageInDays: 170, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ['document-index', 'vector-search', 'rag'],
  },
  {
    id: 'api-connector-plugin',
    name: 'API Connector',
    description: 'Connect to external REST APIs with configurable authentication. Define custom API endpoints the agent can call.',
    version: '1.0.0',
    kind: 'plugin',
    publisher: 'openclaw',
    category: 'integration',
    trustSignals: { verifiedPublisher: true, downloadCount: 7100, ageInDays: 155, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ['rest-client', 'oauth-flow', 'api-proxy'],
  },
];

// ─── ClawHub HTTP Helper ─────────────────────────────────────────────────────

async function fetchClawHub(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
  if (!config.clawHubApiUrl) return null;
  const url = new URL(endpoint, config.clawHubApiUrl);
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate a raw ClawHub catalog entry from an API response.
 * Returns null if the shape is invalid (defensive against API changes).
 */
function parseClawHubEntry(raw: unknown): ClawHubCatalogEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    console.warn('[marketplace-client] parseClawHubEntry: expected object, got', typeof raw);
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Validate required string fields
  const requiredStrings: Array<keyof ClawHubCatalogEntry> = ['id', 'name', 'description', 'version', 'kind', 'publisher'];
  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
      console.warn(`[marketplace-client] parseClawHubEntry: missing or invalid field "${field}"`);
      return null;
    }
  }

  // Validate kind is a valid ExtensionKind
  const kind = obj.kind as string;
  if (kind !== 'plugin' && kind !== 'skill') {
    console.warn(`[marketplace-client] parseClawHubEntry: invalid kind "${kind}"`);
    return null;
  }

  // category may be missing — default to empty string
  const category = typeof obj.category === 'string' ? obj.category : '';

  // Parse trustSignals sub-object
  const rawSignals = obj.trustSignals;
  let trustSignals: TrustSignals;
  if (typeof rawSignals === 'object' && rawSignals !== null) {
    const s = rawSignals as Record<string, unknown>;
    trustSignals = {
      verifiedPublisher: typeof s.verifiedPublisher === 'boolean' ? s.verifiedPublisher : false,
      downloadCount: typeof s.downloadCount === 'number' ? s.downloadCount : 0,
      ageInDays: typeof s.ageInDays === 'number' ? s.ageInDays : 0,
      virusTotalPassed:
        typeof s.virusTotalPassed === 'boolean' ? s.virusTotalPassed : null,
    };
  } else {
    // No trust signals in response — default to conservative unscanned values
    trustSignals = {
      verifiedPublisher: false,
      downloadCount: 0,
      ageInDays: 0,
      virusTotalPassed: null,
    };
  }

  // Parse requiredCredentials array
  let requiredCredentials: ExtensionCredentialRequirement[] = [];
  if (Array.isArray(obj.requiredCredentials)) {
    requiredCredentials = (obj.requiredCredentials as unknown[])
      .filter((c): c is ExtensionCredentialRequirement => {
        if (typeof c !== 'object' || c === null) return false;
        const cr = c as Record<string, unknown>;
        return (
          typeof cr.field === 'string' &&
          typeof cr.label === 'string' &&
          typeof cr.type === 'string' &&
          typeof cr.required === 'boolean'
        );
      });
  }

  // Optional fields
  const capabilities = Array.isArray(obj.capabilities)
    ? (obj.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
    : undefined;

  const requiredBinaries = Array.isArray(obj.requiredBinaries)
    ? (obj.requiredBinaries as unknown[]).filter((b): b is string => typeof b === 'string')
    : undefined;

  const hasScripts = typeof obj.hasScripts === 'boolean' ? obj.hasScripts : undefined;

  const entry: ClawHubCatalogEntry = {
    id: obj.id as string,
    name: obj.name as string,
    description: obj.description as string,
    category,
    version: obj.version as string,
    kind: kind as ExtensionKind,
    publisher: obj.publisher as string,
    trustSignals,
    requiredCredentials,
  };

  if (capabilities !== undefined) entry.capabilities = capabilities;
  if (requiredBinaries !== undefined) entry.requiredBinaries = requiredBinaries;
  if (hasScripts !== undefined) entry.hasScripts = hasScripts;

  return entry;
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Search the ClawHub marketplace via direct HTTP.
 *
 * Tries the remote ClawHub API first; falls back to BUILTIN_REGISTRY on failure.
 * Default limit: 20 (per CONTEXT.md "load first 20 results").
 */
export async function searchClawHub(
  params: {
    query?: string;
    category?: string;
    kind?: ExtensionKind;
    offset?: number;
    limit?: number;
  },
): Promise<{ entries: ClawHubCatalogEntry[]; total: number; hasMore: boolean }> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const rpcParams: Record<string, unknown> = { limit, offset };
  if (params.query !== undefined) rpcParams.query = params.query;
  if (params.category !== undefined) rpcParams.category = params.category;
  if (params.kind !== undefined) rpcParams.kind = params.kind;

  // Try remote ClawHub API first
  try {
    const raw = await fetchClawHub('/api/search', rpcParams);
    if (typeof raw === 'object' && raw !== null) {
      const result = raw as Record<string, unknown>;
      const rawEntries = Array.isArray(result.entries) ? result.entries : [];
      const total = typeof result.total === 'number' ? result.total : rawEntries.length;

      const entries: ClawHubCatalogEntry[] = [];
      for (const rawEntry of rawEntries) {
        const parsed = parseClawHubEntry(rawEntry);
        if (parsed !== null) {
          entries.push(parsed);
        }
      }

      const hasMore = offset + entries.length < total;
      return { entries, total, hasMore };
    }
  } catch (err: unknown) {
    console.warn('[marketplace-client] ClawHub API search failed, falling back to built-in registry:', err instanceof Error ? err.message : String(err));
  }

  // Fallback: filter BUILTIN_REGISTRY in-memory
  let filtered = BUILTIN_REGISTRY.filter((e) => {
    if (params.kind && e.kind !== params.kind) return false;
    if (params.category && e.category !== params.category) return false;
    if (params.query) {
      const q = params.query.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const total = filtered.length;
  filtered = filtered.slice(offset, offset + limit);
  const hasMore = offset + filtered.length < total;

  return { entries: filtered, total, hasMore };
}

/**
 * Get detailed info for a single ClawHub extension via direct HTTP.
 *
 * Tries the remote ClawHub API first; falls back to BUILTIN_REGISTRY on failure.
 */
export async function getClawHubExtensionInfo(
  extensionId: string,
  kind: ExtensionKind,
): Promise<ClawHubCatalogEntry | null> {
  // Try remote ClawHub API first
  try {
    const raw = await fetchClawHub('/api/info', { extensionId, kind });
    if (raw !== null) {
      const parsed = parseClawHubEntry(raw);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch (err: unknown) {
    console.warn('[marketplace-client] ClawHub API info failed, falling back to built-in registry:', err instanceof Error ? err.message : String(err));
  }

  // Fallback: look up in BUILTIN_REGISTRY
  return BUILTIN_REGISTRY.find(e => e.id === extensionId && (!kind || e.kind === kind)) ?? null;
}
