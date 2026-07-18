// Scripted `claude` CLI stub for Phase 21 unit + integration tests.
// Honours:
//   --hang        : sleep forever instead of emitting (tests SIGTERM → SIGKILL escalation)
//   --delay-ms N  : delay between lines (default 20)
//   --exit-code N : final exit code (default 0)
// Reads optional stdin (one JSON-per-line `user` message) but ignores content.
//
// PM7 note: this stub NEVER reads tokens from argv. Real daemon token stays in
// env/file per Plan 21-02; this stub is argv-only for deterministic simulation.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const hang = args.includes('--hang');
const delayIdx = args.indexOf('--delay-ms');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1] ?? '20', 10) : 20;
const exitIdx = args.indexOf('--exit-code');
const exitCode = exitIdx >= 0 ? parseInt(args[exitIdx + 1] ?? '0', 10) : 0;

// Drain stdin but do not block on it (stdin may not be piped in some tests).
process.stdin.on('data', () => {});
process.stdin.on('end', () => {});
process.stdin.resume();

if (hang) {
  // Report version if asked — small escape hatch for detect.test.ts
  if (args.includes('--version')) { console.log('0.0.0 (fake-claude)'); process.exit(0); }
  // Never emit; just sleep until killed.
  const keepAlive = setInterval(() => {}, 1_000_000);
  process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(143); });
  process.on('SIGINT', () => { clearInterval(keepAlive); process.exit(130); });
  // Otherwise loop forever
  await new Promise(() => {});
}

// Special-case `--version` for detect.ts unit tests (Plan 21-02).
if (args.includes('--version')) {
  console.log('0.0.0 (fake-claude)');
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'claude-stream-sample.ndjson');
const body = await readFile(fixturePath, 'utf8');
const lines = body.split('\n').filter((l) => l.trim().length > 0);

for (const line of lines) {
  process.stdout.write(line + '\n');
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

process.exit(exitCode);
