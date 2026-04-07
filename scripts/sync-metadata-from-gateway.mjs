#!/usr/bin/env node

/**
 * Sync openclaw-metadata.json from a running gateway.
 *
 * The metadata file is used as a *fallback* provider catalog when the gateway
 * isn't reachable (e.g. instance stopped). This script queries a live gateway
 * via the aquarium server's /instances/:id/providers endpoint and updates the
 * bundled metadata file, preserving existing auth methods and envVars
 * (the gateway API does not expose those).
 *
 * Usage:
 *   node scripts/sync-metadata-from-gateway.mjs \
 *     --instance <instanceId> \
 *     --cookie /tmp/aq-cookies.txt \
 *     [--server http://localhost:3001] \
 *     [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METADATA_PATH = join(__dirname, '../apps/server/src/data/openclaw-metadata.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { server: 'http://localhost:3001', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--instance') opts.instance = args[++i];
    else if (a === '--cookie') opts.cookie = args[++i];
    else if (a === '--server') opts.server = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf-8').split('/**')[1].split('*/')[0]);
      process.exit(0);
    }
  }
  if (!opts.instance) throw new Error('--instance <instanceId> is required');
  return opts;
}

async function main() {
  const { instance, cookie, server, dryRun } = parseArgs();

  const headers = {};
  if (cookie) {
    // Accept either a raw Cookie header string or a file path
    try {
      const content = readFileSync(cookie, 'utf-8');
      const cookieHeader = content
        .split('\n')
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.split('\t'))
        .filter(parts => parts.length >= 7)
        .map(parts => `${parts[5]}=${parts[6]}`)
        .join('; ');
      headers['Cookie'] = cookieHeader;
    } catch {
      headers['Cookie'] = cookie;
    }
  }

  const url = `${server}/api/instances/${instance}/providers`;
  console.log(`Fetching ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.ok) throw new Error(`API error: ${body.error}`);

  const gatewayProviders = body.data.providers;
  console.log(`Received ${gatewayProviders.length} providers (source: ${body.data.source})`);
  if (body.data.source !== 'gateway') {
    console.error('❌ Response came from metadata fallback, not the gateway. Is the instance running?');
    process.exit(1);
  }

  const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf-8'));
  // Alias map: old metadata stub id → live gateway provider id.
  // Lets us merge auth methods from the stub into the gateway entry and drop
  // the stub so the wizard doesn't show two entries for the same provider.
  const STUB_ALIASES = {
    'ai-gateway': 'vercel-ai-gateway',
    'copilot': 'github-copilot',
  };
  const normalizeId = (id) => STUB_ALIASES[id] ?? id;
  const existingById = new Map(metadata.providers.map(p => [normalizeId(p.id), p]));
  const now = new Date().toISOString();

  const merged = gatewayProviders.map(gp => {
    const existing = existingById.get(gp.name);
    // Preserve auth methods and envVars from the existing metadata entry;
    // overwrite display name, models, and hint with gateway data.
    return {
      id: gp.name,
      name: existing?.name ?? gp.displayName,
      hint: existing?.hint ?? '',
      authMethods: existing?.authMethods ?? [],
      models: gp.models.map(m => {
        // Only set `recommended` when the model is explicitly a default.
        // The wizard filters with `m.recommended !== false`, so leaving it
        // undefined lets all gateway models show up in the wizard.
        const entry = {
          id: m.id,
          name: m.displayName,
          contextWindow: m.contextWindow,
        };
        if (m.isDefault) entry.recommended = true;
        return entry;
      }),
      envVars: existing?.envVars ?? [],
    };
  });

  // Keep metadata-only providers (stubs with 0 models) that aren't in the gateway,
  // so we don't accidentally drop providers that users might configure offline.
  // Alias-aware: a stub whose aliased id matches a gateway provider is dropped.
  const gatewayIds = new Set(gatewayProviders.map(p => p.name));
  const stubs = metadata.providers.filter(p => !gatewayIds.has(normalizeId(p.id)));
  if (stubs.length > 0) {
    console.log(`Preserving ${stubs.length} metadata-only stub providers (${stubs.map(s => s.id).join(', ')})`);
  }

  const newMetadata = {
    ...metadata,
    extractedAt: now,
    providers: [...merged, ...stubs].sort((a, b) => a.id.localeCompare(b.id)),
  };

  const newModelCount = merged.reduce((sum, p) => sum + p.models.length, 0);
  const oldModelCount = metadata.providers.reduce((sum, p) => sum + p.models.length, 0);
  console.log(`Providers: ${metadata.providers.length} → ${newMetadata.providers.length}`);
  console.log(`Models: ${oldModelCount} → ${newModelCount + stubs.reduce((s, p) => s + p.models.length, 0)}`);

  const added = merged.filter(p => !existingById.has(p.id));
  if (added.length > 0) {
    console.log(`\nNew providers added:`);
    for (const p of added) {
      console.log(`  + ${p.id} (${p.name}) — ${p.models.length} models`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: not writing metadata file');
    return;
  }

  writeFileSync(METADATA_PATH, JSON.stringify(newMetadata, null, 2) + '\n', 'utf-8');
  console.log(`\n✅ Wrote ${METADATA_PATH}`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
