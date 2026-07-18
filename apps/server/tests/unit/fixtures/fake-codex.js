// Scripted `codex` app-server stub for Phase 22 unit + integration tests.
//
// Honours:
//   --version         : print "codex-cli 0.118.0" and exit 0
//   --hang            : sleep forever; exits 143 on SIGTERM, 130 on SIGINT
//   --delay-ms N      : delay between emitted NDJSON lines (default 20)
//   --exit-code N     : final exit code (default 0)
//   app-server --listen stdio://
//                     : read JSON-RPC requests line-by-line on stdin;
//                       reply to initialize / thread/start / turn/start;
//                       AFTER turn/start, stream codex-stream-sample.ndjson
//                       (minus the malformed line) and exit.
//
// PM7 note: this stub NEVER reads tokens from argv. Deterministic simulation
// only — no AQUARIUM_* env dependency.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const hang = args.includes('--hang');
const delayIdx = args.indexOf('--delay-ms');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1] ?? '20', 10) : 20;
const exitIdx = args.indexOf('--exit-code');
const exitCode = exitIdx >= 0 ? parseInt(args[exitIdx + 1] ?? '0', 10) : 0;

// Special-case `--version` for detection unit tests.
if (args.includes('--version')) {
  console.log('codex-cli 0.118.0');
  process.exit(0);
}

if (hang) {
  const keepAlive = setInterval(() => {}, 1_000_000);
  process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(143); });
  process.on('SIGINT',  () => { clearInterval(keepAlive); process.exit(130); });
  await new Promise(() => {});
}

// Must be invoked as `app-server --listen stdio://` (or `app-server ...`).
if (args[0] !== 'app-server') {
  console.error(`fake-codex: unrecognised command: ${args.join(' ')}`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'codex-stream-sample.ndjson');
const body = await readFile(fixturePath, 'utf8');
// Drop the trailing malformed line — the fake binary emits only valid frames.
const emitLines = body.split('\n').filter((l) => {
  const t = l.trim();
  if (!t) return false;
  try { JSON.parse(t); return true; } catch { return false; }
});

// Read JSON-RPC requests on stdin. Reply to initialize / thread/start /
// turn/start synchronously; stream the fixture after we see turn/start.
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

let streamingStarted = false;

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let req;
  try { req = JSON.parse(trimmed); } catch { continue; }
  if (typeof req?.id === 'number' && req?.method === 'initialize') {
    process.stdout.write(JSON.stringify({ id: req.id, result: { serverInfo: { name: 'codex-cli', version: '0.118.0' } } }) + '\n');
    continue;
  }
  if (typeof req?.id === 'number' && req?.method === 'thread/start') {
    process.stdout.write(JSON.stringify({ id: req.id, result: { threadId: 'thread_fake' } }) + '\n');
    continue;
  }
  if (typeof req?.id === 'number' && req?.method === 'turn/start') {
    process.stdout.write(JSON.stringify({ id: req.id, result: { turn: { turnId: 'turn_fake' } } }) + '\n');
    if (!streamingStarted) {
      streamingStarted = true;
      // Emit the fixture notifications (thread/started, turn/started, deltas,
      // approval request, item/completed, turn/completed).
      for (const l of emitLines) {
        // Skip the three initial response frames (they carried ids 1/2/3 in
        // the fixture) — we just emitted fresh responses with the real ids.
        const parsed = JSON.parse(l);
        if (typeof parsed?.id === 'number' && parsed?.result && !parsed?.method) continue;
        process.stdout.write(l + '\n');
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
      // Close stdin so the daemon loop can drain.
      rl.close();
      break;
    }
  }
  // Approval response from daemon → we accept it silently.
  if (req?.id === 100 && req?.result) continue;
}

process.exit(exitCode);
