// === OpenClaw Metadata Types ===
// Type definitions for the build-time extracted metadata JSON.
// The extraction script (scripts/extract-openclaw-metadata.mjs) produces JSON
// conforming to these types. Consumed by Phase 3 API endpoints and Phase 4 wizard UI.

export type AuthMethodType = 'api-key' | 'oauth' | 'setup-token' | 'custom-endpoint';

export interface AuthMethod {
  value: string;       // e.g., "openai-codex", "apiKey", "gemini-api-key"
  label: string;       // e.g., "OpenAI Codex (ChatGPT OAuth)"
  hint?: string;       // e.g., "Uses GitHub device flow"
  type: AuthMethodType; // Classified by extraction script
}

export interface ProviderModel {
  id: string;           // e.g., "claude-sonnet-4-20250514"
  name: string;         // e.g., "Claude Sonnet 4"
  contextWindow?: number; // e.g., 200000
  reasoning?: boolean;  // true for reasoning models
  recommended?: boolean; // true for top 3-8 models per provider
}

export interface ProviderGroup {
  id: string;           // group identifier (e.g., "anthropic")
  name: string;         // display name (e.g., "Anthropic")
  hint: string;         // e.g., "setup-token + API key"
  authMethods: AuthMethod[];
  models: ProviderModel[];
  envVars: string[];    // e.g., ["ANTHROPIC_API_KEY"]
}

export interface ChannelOption {
  id: string;           // e.g., "discord"
  name: string;         // e.g., "Discord" (derived from id)
}

export interface OpenClawMetadata {
  version: string;      // OpenClaw version (e.g., "2026.3.2")
  extractedAt: string;  // ISO timestamp
  providers: ProviderGroup[];
  channels: ChannelOption[];
}
