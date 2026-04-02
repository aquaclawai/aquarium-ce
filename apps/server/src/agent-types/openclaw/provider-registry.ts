import { getMetadata } from '../../services/metadata-store.js';
import type { ProviderGroup, AuthMethodType } from '@aquarium/shared';

/**
 * Credentials that are NOT provider groups in metadata but need env var mapping.
 * These are non-AI-provider credentials (channels, tools) that the adapter
 * injects as environment variables into the gateway container.
 */
const NON_PROVIDER_ENV_MAP: Record<string, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  fal_ai: 'FAL_KEY',
  brave: 'BRAVE_API_KEY',
  discord: 'DISCORD_BOT_TOKEN',
  slack_app: 'SLACK_APP_TOKEN',
  slack_bot: 'SLACK_BOT_TOKEN',
  signal: 'SIGNAL_ACCOUNT',
  googlechat: 'GOOGLE_CHAT_SA_JSON',
  nostr: 'NOSTR_PRIVATE_KEY',
  msteams_app: 'MSTEAMS_APP_ID',
  msteams_password: 'MSTEAMS_APP_PASSWORD',
  msteams_tenant: 'MSTEAMS_TENANT_ID',
  zalo: 'ZALO_BOT_TOKEN',
  line_token: 'LINE_CHANNEL_ACCESS_TOKEN',
  line_secret: 'LINE_CHANNEL_SECRET',
  // matrix: JSON blob, no env var needed
  // bluebubbles: JSON blob, no env var needed
  // imessage: config-only, no env var needed
};

/**
 * Maps `credentialProvider:credentialType` to the concrete provider ID
 * used in auth-profiles.json. Handles cases where the OAuth token routes
 * through a different provider than the credential's nominal provider.
 */
const OAUTH_PROVIDER_OVERRIDES: Record<string, string> = {
  'openai:oauth_token': 'openai-codex',
  'qwen:oauth_token': 'qwen-portal',
  'google-gemini-cli:oauth_token': 'google-gemini-cli',
};

/**
 * Maps provider ID to a custom auth-profile key suffix instead of "default".
 * Used when the gateway expects a specific profile key format.
 */
const AUTH_PROFILE_KEY_OVERRIDES: Record<string, string> = {
  'github-copilot': 'github',
};

/**
 * Data-driven registry that derives env-var and auth-profile mappings from
 * build-time extracted metadata. Replaces hardcoded switch/if-else chains
 * in the adapter with metadata-driven dispatch plus small override maps
 * for known special cases.
 */
export class ProviderRegistry {
  private groups: Map<string, ProviderGroup>;

  constructor() {
    const metadata = getMetadata();
    this.groups = new Map(metadata.providers.map(p => [p.id, p]));
  }

  /**
   * Returns the canonical environment variable name for a provider or
   * non-provider credential. Checks NON_PROVIDER_ENV_MAP first (for
   * telegram, fal_ai, etc.), then looks up the first envVar from metadata.
   * Returns null if the provider is unknown.
   */
  getEnvVarName(provider: string): string | null {
    if (provider in NON_PROVIDER_ENV_MAP) {
      return NON_PROVIDER_ENV_MAP[provider];
    }
    return this.groups.get(provider)?.envVars[0] ?? null;
  }

  /**
   * Returns the primary auth method type for a provider from metadata.
   * Returns null if the provider is not found or has no auth methods.
   */
  getPrimaryAuthType(provider: string): AuthMethodType | null {
    return this.groups.get(provider)?.authMethods[0]?.type ?? null;
  }

  /**
   * Resolves the concrete provider ID for auth-profiles.json.
   * Checks OAUTH_PROVIDER_OVERRIDES for special-case mappings
   * (e.g., openai:oauth_token -> openai-codex), falls back to credProvider.
   */
  resolveAuthProvider(credProvider: string, credType: string): string {
    const key = `${credProvider}:${credType}`;
    return OAUTH_PROVIDER_OVERRIDES[key] ?? credProvider;
  }

  /**
   * Returns the auth-profile key in the format `{provider}:{suffix}`.
   * Uses AUTH_PROFILE_KEY_OVERRIDES for known special cases
   * (e.g., github-copilot -> github-copilot:github), defaults to
   * `{provider}:default`.
   */
  getProfileKey(provider: string): string {
    const suffix = AUTH_PROFILE_KEY_OVERRIDES[provider] ?? 'default';
    return `${provider}:${suffix}`;
  }

  /**
   * Returns true if the provider exists in the metadata provider groups.
   */
  hasProvider(provider: string): boolean {
    return this.groups.has(provider);
  }

  /**
   * Returns true if the provider is a non-AI credential (telegram, fal_ai)
   * that needs env var injection but is not a metadata provider group.
   */
  isNonProviderCredential(provider: string): boolean {
    return provider in NON_PROVIDER_ENV_MAP;
  }
}
