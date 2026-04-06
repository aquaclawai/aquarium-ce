import { config } from '../config.js';
import type { ClawHubCatalogEntry, TrustSignals, ExtensionKind, ExtensionCredentialRequirement } from '@aquarium/shared';

// No built-in registry — catalog results come from ClawHub API only.
// When CLAWHUB_API_URL is not configured, catalog sections show an empty state.

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
    console.warn('[marketplace-client] ClawHub API search failed:', err instanceof Error ? err.message : String(err));
  }

  // No fallback — return empty when ClawHub is unavailable
  return { entries: [], total: 0, hasMore: false };
}

/**
 * Get detailed info for a single ClawHub extension via direct HTTP.
 *
 * Returns null when ClawHub is unavailable.
 */
export async function getClawHubExtensionInfo(
  extensionId: string,
  kind: ExtensionKind,
): Promise<ClawHubCatalogEntry | null> {
  try {
    const raw = await fetchClawHub('/api/info', { extensionId, kind });
    if (raw !== null) {
      const parsed = parseClawHubEntry(raw);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch (err: unknown) {
    console.warn('[marketplace-client] ClawHub API info failed:', err instanceof Error ? err.message : String(err));
  }

  return null;
}
