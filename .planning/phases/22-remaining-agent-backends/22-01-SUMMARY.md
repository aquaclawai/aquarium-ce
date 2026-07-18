---
phase: 22
plan: 01
subsystem: daemon
tags: [backend-interface, backend-registry, buildChildEnv, pm7, t-22-01, wave-0]
one-liner: "Extracts Backend contract, lifts PM7 AQUARIUM_*TOKEN strip into shared buildChildEnv, ships detectBackends registry, refactors claude.ts to conform, and stages 3 NDJSON fixtures + 3 fake binaries for Plans 22-02/22-03/22-04"
requires:
  - Phase 21 baseline (runClaudeTask, spawnClaude, sanitizeCustomEnv, claudeBackend bare-object)
  - apps/server/src/daemon/detect.ts (detectClaude)
  - packages/shared/src/v14-types.ts (RuntimeProvider, ClaimedTask)
provides:
  - Backend / BackendRunDeps / BackendRunResult interface (apps/server/src/daemon/backend.ts)
  - buildChildEnv + sanitizeCustomEnv single source of truth (apps/server/src/daemon/backends/env.ts)
  - ALL_BACKENDS + detectBackends registry (apps/server/src/daemon/backends/index.ts)
  - claudeBackend: Backend conforming object (apps/server/src/daemon/backends/claude.ts)
  - 3 NDJSON stream fixtures for later-wave unit tests
  - 3 fake-binary Node scripts for later-wave integration tests
affects:
  - apps/server/src/daemon/backends/claude.ts (refactored — uses buildChildEnv, still exports sanitizeCustomEnv via re-export)
  - apps/server/src/daemon/main.ts (no change; future 22-04 rewrite will dispatch via ALL_BACKENDS)
tech-stack:
  added: []
  patterns:
    - per-backend Backend interface with test seams (_execa, _spawn) typed as `unknown`
    - PG2 detectBackends probe isolation (try/catch per backend, sync + async throws caught)
    - PM7 defence-in-depth (sanitizeCustomEnv strips AQUARIUM_ prefix before merge; buildChildEnv deletes AQUARIUM_*TOKEN after merge)
    - NDJSON fixture convention with 1 intentional malformed PG10 line per file
    - Fake-binary scripts mirroring fake-claude.js: --version, --hang (SIGTERM→143), --delay-ms, --exit-code
key-files:
  created:
    - apps/server/src/daemon/backend.ts
    - apps/server/src/daemon/backends/env.ts
    - apps/server/src/daemon/backends/index.ts
    - apps/server/tests/unit/backend-env.test.ts
    - apps/server/tests/unit/detect-backends.test.ts
    - apps/server/tests/unit/fixtures/codex-stream-sample.ndjson
    - apps/server/tests/unit/fixtures/opencode-stream-sample.ndjson
    - apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson
    - apps/server/tests/unit/fixtures/openclaw-stream-sample.README.md
    - apps/server/tests/unit/fixtures/fake-codex.js
    - apps/server/tests/unit/fixtures/fake-opencode.js
    - apps/server/tests/unit/fixtures/fake-openclaw.js
  modified:
    - apps/server/src/daemon/backends/claude.ts
decisions:
  - NDJSON strict-JSON-per-line forbids comments; placeholder note for openclaw moved to sidecar README file, preserving parseNdjson's `malformed=1` contract while keeping the research breadcrumb visible.
  - `sanitizeCustomEnv` hoisted to env.ts (owner) and re-exported from claude.ts (back-compat shim) instead of removed — preserves the existing 16-test claude-control-request.test.ts suite verbatim.
  - `BackendRunDeps._execa` / `._spawn` typed as `unknown` (not `typeof execa`) to decouple the interface module from execa-version coupling; each backend casts per its spawn helper.
  - Provider type narrowed to `Exclude<RuntimeProvider,'hosted'>` — `'hosted'` is Aquarium-native Docker and never crosses the daemon-backend boundary.
  - claudeBackend.run adapts BackendRunDeps → runClaudeTask deps by defaulting `allow` to `['*']` when unset, matching Plan 21-03's existing claude-config shape.
metrics:
  tasks_completed: 2
  tests_added: 14
  tests_passing_before: 228
  tests_passing_after: 242
  duration: ~20m
  date_completed: 2026-04-17
---

# Phase 22 Plan 01: Backend Interface + Wave 0 Fixtures Summary

## What Shipped

- **Backend contract** (`apps/server/src/daemon/backend.ts`): `Backend`, `BackendRunDeps`, `BackendRunResult` interfaces. Provider constrained to `Exclude<RuntimeProvider, 'hosted'>`. Test seams `_execa` and `_spawn` typed as `unknown`.
- **Shared child-env builder** (`apps/server/src/daemon/backends/env.ts`): `buildChildEnv({ customEnv })` prepends `path.dirname(process.execPath)` to PATH (PM3 / BACKEND-05), merges `sanitizeCustomEnv(customEnv)`, then hard-deletes `AQUARIUM_DAEMON_TOKEN` + `AQUARIUM_TOKEN` (T-22-01 / PM7). `sanitizeCustomEnv` is the new single source of truth; `claude.ts` re-exports it.
- **Backend registry** (`apps/server/src/daemon/backends/index.ts`): `ALL_BACKENDS` (currently `[claudeBackend]`) + `detectBackends(backends?)` that probes each backend with per-backend try/catch (PG2). Synchronous and asynchronous throws are both caught; null results are skipped; returned order matches input order.
- **Refactored claude backend** (`apps/server/src/daemon/backends/claude.ts`): now imports `buildChildEnv` + re-exports `sanitizeCustomEnv` from `env.ts`; adds `claudeBackend: Backend` with `provider: 'claude'`, `detect: () => detectClaude()`, and `run: runClaudeAsBackend`. All 7 existing exports preserved (`runClaudeTask`, `spawnClaude`, `buildControlResponse`, `mapClaudeMessageToAgentMessage`, `toPendingTaskMessage`, `sanitizeCustomEnv`, `claudeBackend`) — zero test regressions.
- **Wave 0 fixtures + fakes**: 3 hand-authored NDJSON transcripts (codex JSON-RPC, opencode NDJSON, openclaw Shape A placeholder) each with exactly 1 malformed PG10 line; 3 ESM Node scripts (`fake-codex.js`, `fake-opencode.js`, `fake-openclaw.js`) mirroring the `fake-claude.js` contract — `--version`, `--hang` with SIGTERM→143, `--delay-ms`, `--exit-code`, and their respective command routing (`app-server --listen stdio://`, `run --format json`, `agent [--json]`).

## Verification

- **Unit**: 14 new tests green (backend-env 8, detect-backends 6). Full suite 242/242 green (228 baseline + 14 new). Typecheck clean. Grep assertions all pass (`export interface Backend` ≥ 1, `delete env.AQUARIUM_` ≥ 2 in env.ts, `claudeBackend: Backend` ≥ 1, `path.dirname(process.execPath)` present in env.ts).
- **Back-compat regression guard**: `claude-control-request.test.ts` (16 tests including `spawnClaude` env-shape + `sanitizeCustomEnv` strip + end-to-end `runClaudeTask` with control_request handshake) all pass unchanged.
- **Fixture round-trip**: Each NDJSON file yields exactly `malformed=1` through `parseNdjson`, confirming the intentional PG10 coverage line is the only parse failure.
- **Fake binary smoke**: All three `--version` probes exit 0 with the expected version string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Design conflict] NDJSON fixture header comments**
- **Found during:** Task 2 Step C
- **Issue:** Plan instructed "add a prominent header comment at the top" of `openclaw-stream-sample.ndjson`, but NDJSON is strictly one-JSON-value-per-line; any `//` or `#` line would either fail `JSON.parse` (breaking `parseNdjson`'s `malformed=1` contract asserted in Step G) or require bespoke fixture-loader logic downstream.
- **Fix:** Placed the research-breadcrumb note in a sidecar `openclaw-stream-sample.README.md` alongside the fixture. The note documents the placeholder status, the Shape A hypothesis, and the rationale for the sidecar location.
- **Files modified:** `apps/server/tests/unit/fixtures/openclaw-stream-sample.README.md` (new)
- **Commit:** d156db3

### Auth gates: none.

### Rule 4 checkpoints: none — all changes were behaviour-preserving interface extraction + scaffolding.

## Known Stubs

None. The `openclaw-stream-sample.ndjson` fixture IS a hand-authored placeholder (Assumption A3 MEDIUM confidence), but it is explicitly labelled as such in its sidecar README and in Plan 22-03's charter; it is not a silent stub but a documented one with a defined replacement path.

## Self-Check: PASSED

- apps/server/src/daemon/backend.ts — FOUND
- apps/server/src/daemon/backends/env.ts — FOUND
- apps/server/src/daemon/backends/index.ts — FOUND
- apps/server/tests/unit/backend-env.test.ts — FOUND
- apps/server/tests/unit/detect-backends.test.ts — FOUND
- apps/server/tests/unit/fixtures/codex-stream-sample.ndjson — FOUND
- apps/server/tests/unit/fixtures/opencode-stream-sample.ndjson — FOUND
- apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson — FOUND
- apps/server/tests/unit/fixtures/fake-codex.js — FOUND (0755)
- apps/server/tests/unit/fixtures/fake-opencode.js — FOUND (0755)
- apps/server/tests/unit/fixtures/fake-openclaw.js — FOUND (0755)
- Commit 3dd3b40 — FOUND (RED)
- Commit bbd1f4e — FOUND (GREEN)
- Commit d156db3 — FOUND (fixtures)
