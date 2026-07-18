import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Regression: POST /api/instances with a duplicate (name, userId) must
 * return 409, not 500.
 *
 * SQLite's better-sqlite3 throws `UNIQUE constraint failed: instances.name,
 * instances.user_id` (UPPERCASE 'UNIQUE'). The original error handler in
 * `apps/server/src/routes/instances.ts` used case-sensitive
 * `message.includes('unique')`, so every SQLite duplicate-name insert
 * was misclassified as 500. Postgres throws lowercase 'duplicate key
 * value violates unique constraint …' so EE worked by accident.
 *
 * Fix: normalise to lower case before the substring match. This test
 * asserts the source contract (toLowerCase() call + inclusive match) so
 * a future refactor that re-introduces case-sensitivity fails loudly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(__dirname, '../../src/routes/instances.ts');

test('POST /api/instances duplicate-name handler normalises case before unique/duplicate match', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');

  // Find the POST / handler body
  const postIdx = src.indexOf(`router.post('/', async`);
  assert.ok(postIdx >= 0, 'POST / handler must exist');

  // Find the first catch block after it
  const catchIdx = src.indexOf('} catch', postIdx);
  assert.ok(catchIdx >= 0, 'POST / must have a catch block');

  // Find the next route declaration — ensures we only inspect THIS handler.
  const nextRouteIdx = src.indexOf('router.', catchIdx);
  const block = src.slice(catchIdx, nextRouteIdx > 0 ? nextRouteIdx : src.length);

  assert.match(
    block,
    /\.toLowerCase\(\)/,
    'error-message substring match must normalise to lower case so UPPERCASE SQLite errors are classified correctly',
  );
  assert.match(
    block,
    /\bincludes\(['"]unique['"]\)/,
    'must still match the "unique" keyword (lowercase after normalisation)',
  );
  assert.match(
    block,
    /\bincludes\(['"]duplicate['"]\)/,
    'must still match the Postgres "duplicate" keyword',
  );
  assert.match(
    block,
    /\?\s*409\s*:\s*500/,
    'must map the matched branch to HTTP 409 (conflict) and the fallthrough to 500',
  );
});
