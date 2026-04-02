import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawMetadata } from '@aquarium/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached: OpenClawMetadata | null = null;

const EMPTY_METADATA: OpenClawMetadata = {
  version: 'unknown',
  extractedAt: '',
  providers: [],
  channels: [],
};

export function getMetadata(): OpenClawMetadata {
  if (cached) return cached;

  // Production: dist/services/ -> ../../data/
  // Development: src/services/ -> ../data/
  const candidates = [
    join(__dirname, '../../data/openclaw-metadata.json'),
    join(__dirname, '../data/openclaw-metadata.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf-8');
      cached = JSON.parse(raw) as OpenClawMetadata;
      console.log(`[metadata-store] Loaded metadata from ${candidate}`);
      console.log(
        `[metadata-store] ${cached.providers.length} providers, ${cached.channels.length} channels (v${cached.version})`,
      );
      return cached;
    }
  }

  console.warn('[metadata-store] openclaw-metadata.json not found; using empty metadata');
  cached = EMPTY_METADATA;
  return cached;
}
