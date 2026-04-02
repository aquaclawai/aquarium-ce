/**
 * Cached OpenRouter model list fetcher.
 * Used by both the agent-types route (wizard UI) and the adapter (gateway config).
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  /** Supported input modalities, e.g. ["text"] or ["text", "image"]. */
  input?: string[];
}

let cachedModels: OpenRouterModel[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 min

export const FALLBACK_MODELS: OpenRouterModel[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', input: ['text', 'image'] },
  { id: 'anthropic/claude-haiku-3.5', name: 'Claude 3.5 Haiku', input: ['text', 'image'] },
  { id: 'openai/gpt-4o', name: 'GPT-4o', input: ['text', 'image'] },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', input: ['text', 'image'] },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', input: ['text', 'image'] },
];

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (cachedModels && now < cacheExpiry) {
    return cachedModels;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = await res.json() as {
        data?: {
          id: string;
          name?: string;
          architecture?: { input_modalities?: string[] };
        }[];
      };
      const models = (body.data ?? []).map((m) => {
        const entry: OpenRouterModel = {
          id: m.id,
          name: m.name || m.id,
        };
        const ALLOWED_MODALITIES = new Set(['text', 'image']);
        const modalities = m.architecture?.input_modalities?.filter(
          (v: string) => ALLOWED_MODALITIES.has(v)
        );
        if (Array.isArray(modalities) && modalities.length > 0) {
          entry.input = modalities;
        }
        return entry;
      });
      cachedModels = models;
      cacheExpiry = now + CACHE_TTL_MS;
      return models;
    }
  } catch { /* OpenRouter unavailable */ }

  return cachedModels ?? FALLBACK_MODELS;
}
