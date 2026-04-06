#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// --- Phase 1: Parse CLI args and set env vars (before any app imports) ---

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      return args[i + 1];
    }
    if (args[i]?.startsWith(`--${name}=`)) {
      return args[i]!.split('=').slice(1).join('=');
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

// Data directory: --data-dir flag > AQUARIUM_DATA_DIR env > ~/.aquarium/
const dataDir = getFlag('data-dir') ?? process.env.AQUARIUM_DATA_DIR ?? join(homedir(), '.aquarium');
const dbPath = join(dataDir, 'aquarium.db');

// Ensure data directory exists
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log(`Created data directory at ${dataDir}`);
}

// Set env vars BEFORE config.ts is imported (transitively via index.ce.ts).
// config.ts reads process.env at module evaluation time, so these must be set
// before the dynamic import in Phase 2 triggers that module graph.
process.env.EDITION = 'ce';
process.env.AQUARIUM_DB_PATH = dbPath;

const portFlag = getFlag('port');
if (portFlag !== undefined) {
  process.env.PORT = portFlag;
}
const hostFlag = getFlag('host');
if (hostFlag !== undefined) {
  process.env.HOST = hostFlag;
}

// Print startup banner before server starts
const port = portFlag ?? process.env.PORT ?? '3001';

console.log('');
console.log('  Aquarium CE');
console.log('  -----------');
console.log(`  Data:   ${dataDir}`);
console.log(`  DB:     ${dbPath}`);
console.log(`  Server: http://localhost:${port}`);
console.log('');

// Check Docker availability
try {
  const { execSync } = await import('node:child_process');
  execSync('docker info', { stdio: 'ignore' });
  console.log('  Docker: connected');
} catch {
  console.log('  Docker: not found (required for agent instances)');
}
console.log('');

// --- Phase 2: Import and start CE server ---
// Dynamic import so env vars are set before config.ts module-level reads.
// index.ce.ts handles: log redaction install, createApp, proxy routes, startServer.
await import('./index.ce.js');

// Handle --open flag (open browser after server starts)
if (hasFlag('open')) {
  const url = `http://localhost:${port}`;
  const { exec } = await import('node:child_process');
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`);
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} ${url}`);
  }
}
