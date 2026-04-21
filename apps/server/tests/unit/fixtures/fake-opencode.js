// Scripted `opencode run --format json` stub for Phase 22 unit + integration tests.
//
// Honours:
//   --version                 : print "1.2.3 (fake-opencode)" and exit 0
//   --hang                    : sleep forever; 143 on SIGTERM, 130 on SIGINT
//   --delay-ms N              : delay between NDJSON lines (default 20)
//   --exit-code N             : final exit code (default 0)
//   run --format json [...]  : stream opencode-stream-sample.ndjson (minus
//                              the malformed line) to stdout and exit.
//
// PM7 note: this stub NEVER reads tokens from argv.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const hang = args.includes('--hang');
const delayIdx = args.indexOf('--delay-ms');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1] ?? '20', 10) : 20;
const exitIdx = args.indexOf('--exit-code');
const exitCode = exitIdx >= 0 ? parseInt(args[exitIdx + 1] ?? '0', 10) : 0;

if (args.includes('--version')) {
  console.log('1.2.3 (fake-opencode)');
  process.exit(0);
}

if (hang) {
  const keepAlive = setInterval(() => {}, 1_000_000);
  process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(143); });
  process.on('SIGINT',  () => { clearInterval(keepAlive); process.exit(130); });
  await new Promise(() => {});
}

// Drain stdin but don't block on it.
process.stdin.on('data', () => {});
process.stdin.on('end', () => {});
process.stdin.resume();

if (args[0] !== 'run') {
  console.error(`fake-opencode: unrecognised command: ${args.join(' ')}`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'opencode-stream-sample.ndjson');
const body = await readFile(fixturePath, 'utf8');
const lines = body.split('\n').filter((l) => {
  const t = l.trim();
  if (!t) return false;
  try { JSON.parse(t); return true; } catch { return false; }
});

for (const line of lines) {
  process.stdout.write(line + '\n');
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

process.exit(exitCode);
