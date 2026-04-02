#!/usr/bin/env node

/**
 * OpenClaw Metadata Extraction Script
 *
 * Runs inside the gateway Docker image at build time to extract provider groups,
 * auth methods, model catalogs, and channel options from the OpenClaw package.
 *
 * Usage:
 *   node extract-openclaw-metadata.mjs --output /tmp/openclaw-metadata.json
 *
 * Requires: Node.js 22+, OpenClaw globally installed at /usr/local/lib/node_modules/openclaw
 */

import { readdirSync, writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Support both official image layout (/app/) and legacy global install (/usr/local/lib/node_modules/openclaw/)
import { existsSync } from 'node:fs';
const OPENCLAW_ROOT = existsSync('/app/dist') ? '/app' : '/usr/local/lib/node_modules/openclaw';
const OPENCLAW_DIST = `${OPENCLAW_ROOT}/dist`;
const PI_PKG = `${OPENCLAW_ROOT}/node_modules/@mariozechner/pi-coding-agent`;

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let output = '/tmp/openclaw-metadata.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }
  return { output };
}

// ─── Chunk Resolution ────────────────────────────────────────────────────────

/**
 * Resolves content-hashed chunk filenames by prefix.
 * OpenClaw's dist/ uses filenames like `auth-choice-options-B11tx3rT.js`.
 * Hashes change per build, so we resolve dynamically.
 */
function resolveChunk(baseName) {
  const files = readdirSync(OPENCLAW_DIST);
  const matches = files.filter(f => f.startsWith(baseName + '-') && f.endsWith('.js'));
  if (matches.length === 0) {
    throw new Error(`No chunk found for prefix: ${baseName}`);
  }
  return matches.map(f => join(OPENCLAW_DIST, f));
}

/**
 * Try each chunk candidate and return the first export that passes the validator.
 * Handles the case where multiple chunks share a prefix but only one has the
 * expected export (e.g., two auth-choice-options files, only one has buildAuthChoiceGroups).
 */
function requireChunkExport(baseName, exportKey, validator) {
  const candidates = resolveChunk(baseName);
  const errors = [];
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod[exportKey] !== undefined && (!validator || validator(mod[exportKey]))) {
        return mod[exportKey];
      }
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(
    `Export '${exportKey}' not found in any ${baseName} chunk.\n` +
    `Candidates: ${candidates.join(', ')}\n` +
    `Errors: ${errors.join('; ')}`
  );
}

// ─── Auth Type Classification ────────────────────────────────────────────────

const OAUTH_AUTH_CHOICES = new Set([
  'openai-codex', 'chutes', 'minimax-portal', 'qwen-portal',
  'google-gemini-cli', 'github-copilot'
]);

const SETUP_TOKEN_AUTH_CHOICES = new Set(['token']);

const CUSTOM_ENDPOINT_AUTH_CHOICES = new Set(['vllm', 'copilot-proxy', 'custom-api-key']);

function classifyAuthType(choiceValue) {
  if (OAUTH_AUTH_CHOICES.has(choiceValue)) return 'oauth';
  if (SETUP_TOKEN_AUTH_CHOICES.has(choiceValue)) return 'setup-token';
  if (CUSTOM_ENDPOINT_AUTH_CHOICES.has(choiceValue)) return 'custom-endpoint';
  if (choiceValue.endsWith('-api-key') || choiceValue === 'apiKey') return 'api-key';
  return 'api-key'; // default fallback
}

// ─── Channel Display Names ───────────────────────────────────────────────────

const CHANNEL_DISPLAY_NAMES = {
  'googlechat': 'Google Chat',
  'imessage': 'iMessage',
  'msteams': 'Microsoft Teams',
  'bluebubbles': 'BlueBubbles',
  'nextcloud-talk': 'Nextcloud Talk',
  'synology-chat': 'Synology Chat',
  'whatsapp': 'WhatsApp',
  'irc': 'IRC',
};

function channelDisplayName(id) {
  if (CHANNEL_DISPLAY_NAMES[id]) return CHANNEL_DISPLAY_NAMES[id];
  // Default: capitalize first letter
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// ─── Recommended Models ──────────────────────────────────────────────────────
// Seeded from apps/web/src/constants/models.ts MODEL_SUGGESTIONS.
// Keys are provider group IDs. Used to set recommended: true on matching model IDs.

const RECOMMENDED_MODELS = {
  'anthropic': new Set(['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-20250514', 'claude-haiku-3-20250414']),
  'openai': new Set(['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o3-pro', 'o1', 'o1-mini', 'codex-mini',
    'gpt-5.1-codex-mini', 'gpt-5.1', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']),
  'google': new Set(['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash']),
  'openrouter': new Set(['anthropic/claude-opus-4-6', 'anthropic/claude-sonnet-4-20250514', 'openai/gpt-5', 'openai/gpt-4.1', 'google/gemini-3-pro', 'google/gemini-2.5-pro']),
  'copilot': new Set(['claude-sonnet-4-20250514', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5-mini', 'o3-mini', 'o1', 'o1-mini']),
  'xai': new Set(['grok-3', 'grok-3-mini', 'grok-2']),
  'together': new Set(['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct-Turbo']),
  'venice': new Set(['llama-3.3-70b', 'deepseek-r1-671b']),
  'groq': new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']),
  'mistral': new Set(['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest']),
  'moonshot': new Set(['kimi-k2.5', 'moonshot-v1-128k']),
  'minimax': new Set(['MiniMax-M2.1', 'MiniMax-VL-01']),
  'litellm': new Set(['gpt-4o', 'claude-sonnet-4-20250514']),
  'huggingface': new Set(['deepseek-chat', 'deepseek-reasoner']),
  'moonshot': new Set(['kimi-k2.5', 'moonshot-v1-128k']),
};

// ─── Source 1: Auth Choice Groups ────────────────────────────────────────────

function extractAuthChoiceGroups() {
  console.log('[Source 1] Extracting auth choice groups...');
  const buildAuthChoiceGroups = requireChunkExport(
    'auth-choice-options',
    't',
    fn => typeof fn === 'function'
  );
  const result = buildAuthChoiceGroups({});
  const groups = result.groups || result;
  if (!Array.isArray(groups)) {
    throw new Error('buildAuthChoiceGroups did not return groups array');
  }
  console.log(`  Found ${groups.length} auth choice groups`);
  return groups;
}

// ─── Source 2: Pi-Native Models ──────────────────────────────────────────────

function extractPiNativeModels() {
  console.log('[Source 2] Extracting pi-native models...');
  let tmpDir;
  try {
    const pi = require(PI_PKG);
    tmpDir = mkdtempSync(join(tmpdir(), 'meta-'));
    const agentDir = join(tmpDir, '.openclaw');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: {} }));

    const authBackend = new pi.InMemoryAuthStorageBackend();
    const auth = pi.AuthStorage.fromStorage(authBackend);
    const registry = new pi.ModelRegistry(auth, join(agentDir, 'models.json'));
    const allModels = registry.getAll();

    // Group by provider
    const modelsByProvider = {};
    for (const model of allModels) {
      const provider = model.provider || 'unknown';
      if (!modelsByProvider[provider]) {
        modelsByProvider[provider] = [];
      }
      modelsByProvider[provider].push({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow || undefined,
        reasoning: model.reasoning || undefined,
      });
    }

    console.log(`  Found ${allModels.length} models across ${Object.keys(modelsByProvider).length} providers`);
    return modelsByProvider;
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ─── Source 3: Provider Env Vars ─────────────────────────────────────────────

function extractProviderEnvVars() {
  console.log('[Source 3] Extracting provider env vars...');
  try {
    const envVars = requireChunkExport(
      'provider-env-vars',
      't',
      obj => typeof obj === 'object' && !Array.isArray(obj)
    );
    console.log(`  Found env vars for ${Object.keys(envVars).length} providers`);
    return envVars;
  } catch (err) {
    console.warn(`  Warning: Could not extract provider env vars: ${err.message}`);
    return {};
  }
}

// ─── Source 4: Channel Options ───────────────────────────────────────────────

function extractChannelOptions() {
  console.log('[Source 4] Extracting channel options...');
  try {
    const resolveCliChannelOptions = requireChunkExport(
      'channel-options',
      'n',
      fn => typeof fn === 'function'
    );
    const channels = resolveCliChannelOptions();
    if (!Array.isArray(channels)) {
      throw new Error('resolveCliChannelOptions did not return an array');
    }
    console.log(`  Found ${channels.length} channels`);
    return channels.map(id => ({ id, name: channelDisplayName(id) }));
  } catch (err) {
    console.warn(`  Warning: Could not extract channels: ${err.message}`);
    return [];
  }
}

// ─── Source 5: Auth Choice to Provider ID Mapping ────────────────────────────

function extractAuthChoiceToProviderMap() {
  console.log('[Source 5] Extracting auth-choice-to-provider mapping...');
  try {
    // Try exported as 'n' (resolvePreferredProvider function)
    const resolvePreferredProvider = requireChunkExport(
      'auth-choice',
      'n',
      fn => typeof fn === 'function'
    );
    return resolvePreferredProvider;
  } catch (err) {
    console.warn(`  Warning: Could not extract preferred provider map: ${err.message}`);
    // Fallback: use auth choice value directly as provider ID
    return (choiceValue) => choiceValue;
  }
}

// ─── Non-Pi Provider Model Extraction ────────────────────────────────────────

/**
 * The model-selection chunk has minified exports and triggers side effects
 * (like resolveSecretRefValue) that crash without proper options. Instead of
 * calling builder functions, we skip the chunk and rely on:
 *   1. Pi-native models as the primary source (757 models)
 *   2. RECOMMENDED_MODELS as fallback for providers not in pi-native catalog
 * This is Approach B from the research -- acceptable since the wizard shows
 * recommended models by default with a "Show all" toggle.
 */
function extractNonPiModels() {
  console.log('[Source 6] Non-pi models: using RECOMMENDED_MODELS fallback (model-selection chunk has side effects)');
  return {};
}

// ─── Merge Strategy ──────────────────────────────────────────────────────────

function buildProviderGroups(authGroups, piModels, nonPiModels, envVarsMap, resolvePreferredProvider) {
  console.log('\n[Merge] Building provider groups...');

  return authGroups.map(group => {
    const groupId = group.value;
    const options = group.options || [];

    // Build auth methods from options
    const authMethods = options.map(opt => ({
      value: opt.value,
      label: opt.label,
      hint: opt.hint || undefined,
      type: classifyAuthType(opt.value),
    }));

    // Collect all provider IDs for this group via auth choices
    const providerIds = new Set();
    const choices = group.choices || options.map(o => o.value);
    for (const choice of choices) {
      try {
        const providerId = resolvePreferredProvider(choice);
        if (providerId) providerIds.add(providerId);
      } catch {
        // If resolvePreferredProvider fails, use the choice value directly
        providerIds.add(choice);
      }
    }
    // Always include the group ID itself as a provider ID
    providerIds.add(groupId);

    // Also include pi-native providers whose ID starts with the group ID
    // (e.g., "google-vertex", "google-antigravity" belong to the "google" group)
    for (const piProviderId of Object.keys(piModels)) {
      if (piProviderId.startsWith(groupId + '-') && !providerIds.has(piProviderId)) {
        providerIds.add(piProviderId);
      }
    }

    // Collect models from all provider IDs (pi-native first, then non-pi)
    const modelMap = new Map(); // dedup by model ID
    for (const pid of providerIds) {
      // Pi-native models (primary source)
      const piProviderModels = piModels[pid] || [];
      for (const model of piProviderModels) {
        if (!modelMap.has(model.id)) {
          modelMap.set(model.id, { ...model });
        }
      }

      // Non-pi models (secondary, only if not already from pi)
      const npModels = nonPiModels[pid] || [];
      for (const model of npModels) {
        if (!modelMap.has(model.id)) {
          modelMap.set(model.id, { ...model });
        }
      }
    }

    // Set recommended flag
    const recommendedSet = RECOMMENDED_MODELS[groupId];
    if (recommendedSet) {
      for (const [modelId, model] of modelMap) {
        if (recommendedSet.has(modelId)) {
          model.recommended = true;
        }
      }
    }

    // If we have NO models but DO have recommended entries, add them as fallback
    if (modelMap.size === 0 && recommendedSet) {
      for (const modelId of recommendedSet) {
        modelMap.set(modelId, {
          id: modelId,
          name: modelId,
          recommended: true,
        });
      }
    }

    // Collect env vars from all provider IDs
    const envVarsSet = new Set();
    for (const pid of providerIds) {
      const vars = envVarsMap[pid];
      if (Array.isArray(vars)) {
        for (const v of vars) envVarsSet.add(v);
      }
    }

    // Clean up model objects -- remove undefined fields
    const models = Array.from(modelMap.values()).map(m => {
      const clean = { id: m.id, name: m.name };
      if (m.contextWindow !== undefined) clean.contextWindow = m.contextWindow;
      if (m.reasoning !== undefined) clean.reasoning = m.reasoning;
      if (m.recommended !== undefined) clean.recommended = m.recommended;
      return clean;
    });

    return {
      id: groupId,
      name: group.label,
      hint: group.hint || '',
      authMethods,
      models,
      envVars: Array.from(envVarsSet),
    };
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { output } = parseArgs();

  console.log('=== OpenClaw Metadata Extraction ===\n');

  // Get OpenClaw version
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync('/usr/local/lib/node_modules/openclaw/package.json', 'utf8'));
    version = pkg.version;
    console.log(`OpenClaw version: ${version}\n`);
  } catch (err) {
    console.warn(`Warning: Could not read OpenClaw version: ${err.message}`);
  }

  // Extract from all sources
  const authGroups = extractAuthChoiceGroups();
  const piModels = extractPiNativeModels();
  const envVarsMap = extractProviderEnvVars();
  const channels = extractChannelOptions();
  const resolvePreferredProvider = extractAuthChoiceToProviderMap();
  const nonPiModels = extractNonPiModels();

  // Merge into provider groups
  const providers = buildProviderGroups(authGroups, piModels, nonPiModels, envVarsMap, resolvePreferredProvider);

  // Build final metadata object
  const metadata = {
    version,
    extractedAt: new Date().toISOString(),
    providers,
    channels,
  };

  // Write output
  writeFileSync(output, JSON.stringify(metadata, null, 2));

  // Print summary stats
  const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0);
  const recommendedModels = providers.reduce((sum, p) => sum + p.models.filter(m => m.recommended).length, 0);
  const zeroModelProviders = providers.filter(p => p.models.length === 0);

  console.log('\n=== Summary ===');
  console.log(`Provider groups: ${providers.length}`);
  console.log(`Total models: ${totalModels}`);
  console.log(`Recommended models: ${recommendedModels}`);
  console.log(`Providers with 0 models: ${zeroModelProviders.length} (${zeroModelProviders.map(p => p.id).join(', ') || 'none'})`);
  console.log(`Channels: ${channels.length}`);
  console.log(`Output: ${output}`);
  console.log('\nDone.');
}

// Suppress unhandled rejections from OpenClaw chunk side effects (e.g.,
// resolveSecretRefValue deferred errors from model-selection chunk loading)
process.on('unhandledRejection', (err) => {
  // Only log at debug level -- these are from chunk side effects, not our code
  if (process.env.DEBUG) {
    console.warn(`[debug] Suppressed unhandled rejection: ${err?.message || err}`);
  }
});

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
