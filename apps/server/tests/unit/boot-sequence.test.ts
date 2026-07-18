/**
 * Phase 26 Plan 01 — Boot-sequence regression test (REL-02).
 *
 * Asserts that `apps/server/src/server-core.ts` contains the five v1.4
 * boot-step markers in the correct source order:
 *
 *   [boot] 9a runtime-bridge reconcile complete
 *   [boot] 9b hosted-orphan sweep complete
 *   [boot] 9c task-reaper started
 *   [boot] 9d hosted-task worker started
 *   [boot] 9e offline-sweeper started
 *   server.listen(config.port, …)
 *
 * Rationale (source-order vs runtime capture):
 *   The markers are unconditional `console.log(...)` calls placed between
 *   the five `await`/synchronous calls that make up boot steps 9a-9e. Node
 *   executes them in source order, so asserting source order IS asserting
 *   runtime order. Spawning a real server to capture stdout would
 *   additionally require migrations, a throwaway SQLite DB, a mock docker
 *   engine, and a shutdown protocol — all covered by the @integration
 *   spec in tests/e2e/daemon-integration.spec.ts. This unit test stays
 *   hermetic (no process spawn, no DB open).
 *
 * Known limitation (see T-26-01-06 in plan 26-01): if a future refactor
 * wraps boot steps in Promise.all() or similar concurrent await, source-
 * line order in server-core.ts may diverge from actual execution order.
 * This test will still pass under such a refactor. If parallelization
 * lands, UPGRADE this test to capture server stdout and assert the
 * '[boot] 9X' marker order in the captured output stream, not the source
 * file. That upgrade is out of scope for REL-02 but is the recognized
 * follow-up whenever async boot is introduced.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_CORE = resolve(__dirname, '..', '..', 'src', 'server-core.ts');

function lineOf(src: string, pattern: RegExp): number {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1; // 1-based line numbers for readable errors
    }
  }
  return -1;
}

test('server-core.ts emits [boot] 9a-9e markers in order before server.listen', () => {
  const src = readFileSync(SERVER_CORE, 'utf8');

  // Each regex matches the CONSOLE.LOG line only, not the recap comment.
  const markerA = /console\.log\(\s*['"`]\[boot\] 9a runtime-bridge reconcile complete/;
  const markerB = /console\.log\(\s*['"`]\[boot\] 9b hosted-orphan sweep complete/;
  const markerC = /console\.log\(\s*['"`]\[boot\] 9c task-reaper started/;
  const markerD = /console\.log\(\s*['"`]\[boot\] 9d hosted-task worker started/;
  const markerE = /console\.log\(\s*['"`]\[boot\] 9e offline-sweeper started/;
  const serverListen = /server\.listen\(\s*config\.port/;

  const a = lineOf(src, markerA);
  const b = lineOf(src, markerB);
  const c = lineOf(src, markerC);
  const d = lineOf(src, markerD);
  const e = lineOf(src, markerE);
  const f = lineOf(src, serverListen);

  assert.ok(a > 0, `missing [boot] 9a marker in ${SERVER_CORE}`);
  assert.ok(b > 0, `missing [boot] 9b marker in ${SERVER_CORE}`);
  assert.ok(c > 0, `missing [boot] 9c marker in ${SERVER_CORE}`);
  assert.ok(d > 0, `missing [boot] 9d marker in ${SERVER_CORE}`);
  assert.ok(e > 0, `missing [boot] 9e marker in ${SERVER_CORE}`);
  assert.ok(f > 0, `missing server.listen(config.port, …) call`);

  assert.ok(a < b, `9a (line ${a}) must precede 9b (line ${b})`);
  assert.ok(b < c, `9b (line ${b}) must precede 9c (line ${c})`);
  assert.ok(c < d, `9c (line ${c}) must precede 9d (line ${d})`);
  assert.ok(d < e, `9d (line ${d}) must precede 9e (line ${e})`);
  assert.ok(e < f, `9e (line ${e}) must precede server.listen (line ${f})`);
});

test('each [boot] 9a-9e marker appears exactly once as a console.log (no duplicates, no comment-only occurrences)', () => {
  const src = readFileSync(SERVER_CORE, 'utf8');
  const count = (pat: RegExp): number => (src.match(new RegExp(pat.source, pat.flags + 'g')) ?? []).length;
  assert.equal(count(/console\.log\(\s*['"`]\[boot\] 9a runtime-bridge reconcile complete/), 1);
  assert.equal(count(/console\.log\(\s*['"`]\[boot\] 9b hosted-orphan sweep complete/), 1);
  assert.equal(count(/console\.log\(\s*['"`]\[boot\] 9c task-reaper started/), 1);
  assert.equal(count(/console\.log\(\s*['"`]\[boot\] 9d hosted-task worker started/), 1);
  assert.equal(count(/console\.log\(\s*['"`]\[boot\] 9e offline-sweeper started/), 1);
});
