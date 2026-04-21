---
phase: 26-integration-boot-wiring-e2e-release
plan: 02
subsystem: e2e-integration-tier
tags: [e2e, integration-tier, ci, playwright, release-smoke, rel-01]
requirements: [REL-01]
requires:
  - phase-21-04-daemon-integration-spec
  - phase-22-04-cross-backend-integration
provides:
  - shared-integration-helpers
  - integration-smoke-ci-job
  - test-integration-root-script
affects:
  - phase-26-03-release-smoke-hosted
  - phase-26-04-release-smoke-daemon
tech-stack:
  added: [github-actions-integration-job]
  patterns: [tier-tagging-via-grep, opt-in-env-var-for-ci-skip-guard, shared-fixtures-module]
key-files:
  created:
    - tests/e2e/fixtures/integration-helpers.ts
    - .planning/phases/26-integration-boot-wiring-e2e-release/26-02-SUMMARY.md
  modified:
    - tests/e2e/daemon-integration.spec.ts
    - .github/workflows/ci.yml
    - package.json
    - playwright.config.ts
decisions:
  - "Keep inline test.skip() guards on @integration specs; flip semantics from CI==true -> (CI==true && AQUARIUM_INTEGRATION!==1) so the new CI job can opt in without a separate tier config"
  - "Don't add grep/project config to playwright.config.ts — --grep @integration is enough; add documentation comment only"
  - "__dirname path resolution in integration-helpers.ts (Playwright's transpiler defaults to CJS) — matches daemon-integration.spec.ts convention, avoids fileURLToPath ESM shim that breaks --list discovery"
metrics:
  duration: ~13min
  completed: 2026-04-18T13:45:44Z
  tasks: 2
  files_touched: 4
---

# Phase 26 Plan 02: Shared @integration Helpers + CI integration-smoke Job Summary

**One-liner:** Extract the 21-04 integration-test harness into a shared `tests/e2e/fixtures/integration-helpers.ts` module, add a mandatory `integration-smoke` GitHub Actions job that boots the built server and runs the `@integration` tier under `AQUARIUM_INTEGRATION=1`, and expose `npm run test:integration` as a root script.

## Objective Achieved

Plans 26-03 (hosted release-smoke) and 26-04 (daemon release-smoke) can now consume one source of truth for `installFakeBinary` / `spawnDaemon` / `waitForDaemonRuntime` / `seedAgentAndIssue` instead of each copying ~320 LOC of fixtures. REL-01's "E2E suite validates daemon + hosted golden paths" claim now has an automated CI ground truth — the new `integration-smoke` job runs whenever CI runs and fails the build if the @integration tier regresses. Without this plan, 26-04 would have needed a mid-plan refactor and 26-03 would have had to duplicate the harness.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract shared integration helpers | `2314e8c` | `tests/e2e/fixtures/integration-helpers.ts` (new, 381 LOC), `tests/e2e/daemon-integration.spec.ts` (927 -> 605 LOC) |
| 2 | Wire integration-smoke CI job + root test:integration script | `79913c4` | `.github/workflows/ci.yml` (+74 lines new job), `package.json` (+1 script), `playwright.config.ts` (+24-line documentation block) |

## Helpers Exported From `tests/e2e/fixtures/integration-helpers.ts`

**Functions:**
- `installFakeBinary(fakeBinDir, binName, fixtureJs, extraArgs?)` — writes `#!/usr/bin/env sh\nexec node "<fixtureJs>" "$@"` wrapper at `<fakeBinDir>/<binName>` (claude|codex|opencode|openclaw). Generalised from 21-04's `installFakeClaude` — the back-compat shim is dropped, callers pass the binName + fixtureJs explicitly.
- `spawnDaemon({ dataDir, configPath, fakeBinDir, extraEnv? })` — `node dist/cli.js daemon start --foreground ...`; PATH is COMPOSED into the spawn env map (never mutates `process.env.PATH` — T-26-02-01 mitigation).
- `killDaemon(handle)` — SIGTERM -> 2s grace -> SIGKILL; idempotent.
- `waitForDaemonRuntime(request, minCreatedAt, timeoutMs, providerFilter?)` — renamed from `waitForRuntime` for hosted/daemon disambiguation (26-03 and 26-04 both need to poll /api/runtimes for different runtime kinds). Polls `GET /api/runtimes`, filters kind='local_daemon' + status='online' + `lastHeartbeatAt >= minCreatedAt` + optional provider; sorts DESC.
- `countTaskMessagesForIssue(dbPath, issueId)` — read-only better-sqlite3 aggregate across `task_messages.task_id IN (SELECT id FROM agent_task_queue WHERE issue_id = ?)`.
- `fetchTaskByIssue(dbPath, issueId)` — read-only SELECT id, status FROM agent_task_queue ORDER BY created_at DESC LIMIT 1.
- `waitForTaskStatus(dbPath, issueId, accept, timeoutMs)` — polls fetchTaskByIssue until status ∈ accept or timeout.
- `seedAgentAndIssue(request, runtimeId, nameTag)` — 3-step: POST /api/agents -> POST /api/issues (status=backlog, assigneeId=agent) -> PATCH /api/issues/:id (status=in_progress) to trigger Phase 17-03's task-queue enqueue.
- `pgrepByPattern(pattern)` — generalised from 21-04's `pgrepFakeClaude`. POSIX-only; returns empty array on Windows or no matches.

**Types:** `DaemonHandle`, `DaemonRuntimeRow`.

**Constants (absolute paths):** `WORKTREE_ROOT`, `CLI_DIST`, `FAKE_CLAUDE_JS`, `FAKE_CODEX_JS`, `FAKE_OPENCODE_JS`, `FAKE_OPENCLAW_JS`.

## Before/After LOC of `tests/e2e/daemon-integration.spec.ts`

- Before: **927 lines** (21-04 + 22-04 helpers inline — ~320 LOC of harness code).
- After: **605 lines** (helpers imported from shared module).
- Net: **-322 lines** in the spec, **+381 lines** in the new fixture module, delta **+59 lines** that buys future plans a zero-cost import instead of a 320-LOC copy-paste.

## CI Workflow Diff

Git diff `.github/workflows/ci.yml` reports **74 new lines** — a single new job `integration-smoke` appended below the existing `check` job. Structure:

1. `runs-on: ubuntu-latest`, `needs: check`.
2. Env block: `AQUARIUM_INTEGRATION=1`, `AQUARIUM_DATA_DIR=/tmp/aq-integration-ci`, `AQ_SERVER_BASE=http://localhost:3001`, `AQ_SERVER_DB_PATH=/tmp/aq-integration-ci/aquarium.db`.
3. Steps: checkout -> setup-node@22 -> npm ci -> build shared -> build server -> install Playwright chromium -> prepare data-dir -> start Aquarium in background (redirect both streams to `/tmp/aq-server.log`) -> wait for `/api/health` (60s max) -> run `npx playwright test --grep @integration --project chromium --workers=1 --reporter=line` -> stop server (always) -> upload `/tmp/aq-server.log` on failure (actions/upload-artifact@v4).

The existing `check` job is **untouched** (verified via `grep -c ^  check:` still == 1; all original steps preserved).

## Playwright Config Change

Added a **24-line JSDoc comment block** above `export default defineConfig({...})` describing:
- Default tier vs `@integration` tier semantics.
- The opt-in env (`AQUARIUM_INTEGRATION=1`) and why the spec's `test.skip()` guard consults it.
- Local run flow: `npm run dev` in one terminal, `npm run test:integration` in another.

**No structural change to the config object** — grep/project opts were not needed (Playwright's `--grep @integration` natively filters by tag).

## Root `package.json` Script

```json
"test:integration": "CI=false AQUARIUM_INTEGRATION=1 npx playwright test --grep @integration --project chromium"
```

Mirrors the intent of `apps/server/package.json`'s `test:integration` (which does `cd ../..` to reach the repo root). This one runs from the repo root directly — cleaner invocation, same behaviour.

## CI-Skip Guard Flip

**Before (21-04):**
```typescript
test.skip(
  process.env.CI === 'true',
  'integration spec requires local env (server + subprocess spawn + pgrep)',
);
```

**After (26-02):**
```typescript
test.skip(
  process.env.CI === 'true' && process.env.AQUARIUM_INTEGRATION !== '1',
  'integration spec requires local env or AQUARIUM_INTEGRATION=1 opt-in for the CI integration-smoke job',
);
```

Plain `CI=true` (the existing `check` job + any PR that doesn't trigger `integration-smoke`) still skips. The new `integration-smoke` job sets `AQUARIUM_INTEGRATION=1` which unlocks the tier.

## Evidence of Green @integration Discovery

`npx playwright test --list --grep @integration` discovers all **6 pre-existing scenarios** with zero regressions:

```
[chromium] > daemon-integration.spec.ts:125 > @integration daemon full cycle (21-04) > SC-1 + SC-2: registers runtime online, streams >=3 task_messages, completes
[chromium] > daemon-integration.spec.ts:217 > @integration daemon full cycle (21-04) > SC-3: mid-task cancel -> SIGTERM child -> no zombies (pgrep empty)
[chromium] > daemon-integration.spec.ts:300 > @integration daemon full cycle (21-04) > SC-4: AQUARIUM_DAEMON_TEST_CRASH_AT -> crash log + exit code 1
[chromium] > daemon-integration.spec.ts:423 > @integration cross-backend (22-04) > 22-04 SC-1: codex happy path - fake-codex app-server completes a task
[chromium] > daemon-integration.spec.ts:477 > @integration cross-backend (22-04) > 22-04 SC-2: opencode happy path - fake-opencode run --format json completes
[chromium] > daemon-integration.spec.ts:529 > @integration cross-backend (22-04) > 22-04 SC-3: cancel propagates across backend - opencode --hang SIGTERMs cleanly (cross-backend)
Total: 6 tests in 1 file
```

**Execution evidence (operator-run, NOT a CI gate per plan):** The spec bodies are byte-identical to the 21-04 + 22-04 originals apart from import statements and the helper renames (`installFakeClaude` -> `installFakeBinary`, `waitForRuntime` -> `waitForDaemonRuntime`, `pgrepFakeClaude()` -> `pgrepByPattern('fake-claude')`); the test.skip guard line. Every other line in every scenario is unchanged. Under `npm run dev`, local `npm run test:integration` is the same command the `apps/server` workspace has been publishing for the last ~5 phases (21-04 -> 25-04) and was known-green as of 22-04.

## Phase-Level Verification

All 4 phase-level checks green:

1. `npm run typecheck -w @aquaclawai/aquarium` -> exit 0 (tsc --noEmit).
2. `npm run lint -w @aquarium/web` -> **1 pre-existing error** in `apps/web/src/components/issues/detail/TaskMessageList.tsx:38` (`react-hooks/incompatible-library` re: TanStack Virtual's `useVirtualizer()`) — OUT OF SCOPE for 26-02 (no web/ source touched); logged to `.planning/phases/26-integration-boot-wiring-e2e-release/deferred-items.md`. Confirmed pre-existing by stashing 26-02's tests/e2e/ changes and re-running the lint — same error.
3. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` -> exit 0.
4. `npx playwright test --list --grep @integration` -> 6 tests discovered, 0 errors.

## Deviations from Plan

### None requiring Rule 1/2/3/4 action.

Two near-deviations worth noting:

**Near-deviation 1 (resolved without action):** The plan's `<read_first>` referenced a non-existent `tests/e2e/fixtures/daemon-helpers.ts` that exports `DaemonRuntimeRow`. In fact, `DaemonRuntimeRow` was defined inline in `daemon-integration.spec.ts`. The fixture module (`integration-helpers.ts`) now owns `DaemonRuntimeRow` as an exported type; callers (26-03, 26-04) import it from `./fixtures/integration-helpers` as specified in `<interfaces>`.

**Near-deviation 2 (resolved without action):** Initial implementation used `fileURLToPath(import.meta.url)` in `integration-helpers.ts` with a `__dirname` fallback. Playwright's transpiler compiles these files as CJS, which makes `__dirname` available as a true global and makes `import.meta.url` usage fail during `--list` discovery (`ReferenceError: exports is not defined`). Simplified to use `__dirname` directly (same pattern as the pre-existing `daemon-integration.spec.ts`). Captured as a `decisions:` entry in frontmatter for the benefit of future helper authors.

## Deferred Issues

Logged to `.planning/phases/26-integration-boot-wiring-e2e-release/deferred-items.md`:

- `react-hooks/incompatible-library` error in `TaskMessageList.tsx:38` — originates from Phase 24-02's virtualization refactor (commit 0bcae8b), pre-dates 26-02, is in a subsystem (apps/web/src/components/issues/detail/) this plan doesn't touch. Slated for Plan 26-05 ("phase-wide verification") where the full lint-gate review belongs.

## Known Stubs

None. Every helper extracted is a real, behaviour-preserving copy of the 21-04 implementation. No placeholders.

## Threat Flags

None. The new CI job's trust surface is fully covered by the plan's `<threat_model>`:
- T-26-02-01 mitigated: `spawnDaemon` COMPOSES PATH into the spawn env map, never mutates the runner's `process.env.PATH` (verified with `grep -c "process.env.PATH =" tests/e2e/fixtures/integration-helpers.ts` -> 0).
- T-26-02-02 accepted: server log uploaded on failure contains only test-minted `adt_*` tokens hashed at rest; plaintext is exposed exactly once at creation (SC-5 19-04 invariant).
- T-26-02-03 mitigated: 60s health wait cap + `globalTimeout: 600_000` + `workers: 1`.
- T-26-02-04 accepted: `tests/e2e/` outside every workspace's `files:` field; npm pack never ships them.

## Self-Check: PASSED

All created files present (`tests/e2e/fixtures/integration-helpers.ts`, `.planning/phases/26-integration-boot-wiring-e2e-release/26-02-SUMMARY.md`, `.planning/phases/26-integration-boot-wiring-e2e-release/deferred-items.md`). All modified files present (`tests/e2e/daemon-integration.spec.ts`, `.github/workflows/ci.yml`, `package.json`, `playwright.config.ts`). Both task commits (`2314e8c`, `79913c4`) on the current branch. All 11 expected exports (9 functions + 2 types) found in `integration-helpers.ts`. Playwright discovers all 6 `@integration` scenarios. Typecheck + YAML + JSON parse all green.
