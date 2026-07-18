# Server Unit Tests — `node --test`

Runs with `tsx` (already a devDependency — see `apps/server/package.json`).

## Run

```bash
# One file
npx tsx --test apps/server/tests/unit/task-queue.test.ts

# All files
npx tsx --test 'apps/server/tests/unit/**/*.test.ts'
```

## Conventions (Phase 18 + Phase 21 BACKEND-07)

- **Framework:** built-in `node:test` (zero dependencies). No Jest, no Vitest.
- **DB fixture:** `test-db.ts` exports `setupTestDb()` / `teardownTestDb()`. Each
  test gets an isolated SQLite file in `os.tmpdir()` with boot PRAGMAs applied
  (WAL, busy_timeout=5000, foreign_keys=ON) and all migrations run. The default
  `'AQ'` workspace is always seeded by migration 003.
- **Service dependency injection:** Services that write to the DB accept an
  optional `Knex` / `Knex.Transaction` parameter (Phase 17 convention — see
  `task-queue-store.ts`). Tests pass `ctx.db`; production code passes nothing and
  falls back to the app singleton.
- **Isolation:** no test depends on the file ordering or on state from a prior
  test. Every `test()` sets up its own DB and tears it down.
- **Speed:** full unit suite targets < 15 seconds. If a single file takes > 5 s,
  open a tracking item.

## Adding a new test file

1. `apps/server/tests/unit/<feature>.test.ts`
2. Import from `node:test` + `node:assert/strict`.
3. Import `setupTestDb` / `teardownTestDb` from `./test-db.ts`.
4. Seed with the helpers (`seedRuntime`, `seedAgent`, `seedIssue`, `seedTask`).
5. Pass `ctx.db` into every service call that supports the `trx` / `db` param.
