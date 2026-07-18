---
phase: 22
plan: 04
subsystem: daemon
tags: [hermes-backend, main-dispatch, backend-registry, backend-03, t-22-14, t-22-15, t-22-18, wave-4]
one-liner: "Hermes stub backend (detect + hard-coded actionable error on run, no spawn) + main.ts dispatch rewrite to Map<runtimeId,{backend,binaryPath}> with name-first server-reorder defence + 3 new cross-backend integration scenarios — Phase 22 fully wired end-to-end"
requires:
  - apps/server/src/daemon/backend.ts (Plan 22-01)
  - apps/server/src/daemon/backends/env.ts (Plan 22-01 — buildChildEnv)
  - apps/server/src/daemon/backends/{claude,codex,opencode,openclaw}.ts (Plans 22-01/02/03)
  - apps/server/tests/unit/fixtures/{fake-codex,fake-opencode}.js (Plan 22-01)
  - Phase 21-03 main.ts orchestrator (section-level surgical rewrite)
provides:
  - hermesBackend (apps/server/src/daemon/backends/hermes.ts) — Backend conforming stub
  - detectHermes (apps/server/src/daemon/backends/detect-hermes.ts) — PATH + fallback probe
  - HERMES_UNSUPPORTED_MESSAGE — hard-coded actionable error template (no interpolation)
  - ALL_BACKENDS finalised to 5 entries (claude, codex, opencode, openclaw, hermes)
  - DaemonConfigFile.backends accepts per-backend shapes (shared type extension)
  - DaemonConfig.backends mirrors with concrete DEFAULT_DAEMON_CONFIG
  - main.ts backendByRuntimeId Map dispatch (name-match lookup — T-22-18)
  - main.ts T-22-15 guard: `no backend for runtime ${runtimeId}` throw before spawn
  - installFakeBackend helper in integration spec (generalisation of 21-04's installFakeClaude)
  - 3 new @integration scenarios: codex happy path, opencode happy path, cross-backend cancel
affects:
  - apps/server/src/daemon/backends/index.ts (ALL_BACKENDS includes hermes)
  - apps/server/src/daemon/main.ts (3 sections rewritten; everything else verbatim)
  - apps/server/src/daemon/config.ts (DaemonConfig.backends extended, loader resolves 3 allow-lists)
  - packages/shared/src/v14-types.ts (DaemonConfigFile.backends accepts 5 keys)
  - tests/e2e/daemon-integration.spec.ts (3 new scenarios in a new describe block; existing 3 unchanged)
tech-stack:
  added: []
  patterns:
    - Detect-and-stub-on-run (hermes) — Backend interface uniform; spawn never happens
    - Hard-coded error template — runtime data NEVER interpolated into the message body (T-22-14 log-forging mitigation)
    - Name-first dispatch map build (T-22-18 / A8 defence against server reordering)
    - Per-backend allow-list with per-key defaults; opencode + hermes reserve `Record<string, never>` for future extension
    - installFakeBackend helper + optional providerFilter on waitForRuntime — integration spec scales to 4 provider fakes with no boilerplate divergence
key-files:
  created:
    - apps/server/src/daemon/backends/hermes.ts
    - apps/server/src/daemon/backends/detect-hermes.ts
    - apps/server/tests/unit/hermes-backend.test.ts
    - .planning/phases/22-remaining-agent-backends/22-04-SUMMARY.md
  modified:
    - apps/server/src/daemon/backends/index.ts
    - apps/server/src/daemon/main.ts
    - apps/server/src/daemon/config.ts
    - packages/shared/src/v14-types.ts
    - tests/e2e/daemon-integration.spec.ts
decisions:
  - Hermes error message is a literal template with NO interpolation — T-22-14 log-forging defence. Runtime data (workspaceId + issueId) rides on the AgentMessage envelope metadata, never inside `content`. The grep assertion `grep -cE '\\$\\{(task|agent|deps|issue)' apps/server/src/daemon/backends/hermes.ts` returns 0 (confirmed post-comment-rewrite).
  - Dispatch map keyed by runtimeId, built by walking the server's returned `runtimes[]` and matching each row's `name` field against the daemon-sent `${deviceName}-${provider}` name. Pure array-index binding would have been a T-22-18 gap (assumption A8) — this switches to name-match at effectively zero cost.
  - `DaemonConfig.backends.codex.allow` + `openclaw.allow` default to `['*']` (approve-all, matching claude). `opencode` + `hermes` hold `Record<string, never>` — no approval protocol on their wire in v1.4, so no allow-list surface to configure. Plan 22-04 chose to materialise the empty objects at the top level rather than making the backend keys optional, so `config.backends[provider]` is always addressable.
  - Integration scenario for openclaw INTENTIONALLY NOT SHIPPED. OpenClaw's live NDJSON wire shape is still Assumption A3 (not captured in 22-03 — binary not installed on execution machine). An integration scenario built on the Plan 22-01 Shape-A placeholder fixture would either falsely reinforce the assumption or fail in a way indistinguishable from a harness bug. Covered by a MANUAL verification line in `22-VALIDATION.md :: Manual-Only Verifications`.
  - `installFakeClaude` was preserved as a back-compat shim that delegates to the new `installFakeBackend` — the 3 existing claude scenarios (21-04 SC-1+2 / SC-3 / SC-4) are byte-identical post-rewrite, so regression risk is purely structural (type-check, which passes).
metrics:
  tasks_completed: 3
  commits: 4
  files_created: 3
  files_modified: 5
  tests_added: 6
  tests_added_integration: 3
  tests_passing_before: 298
  tests_passing_after: 304
  duration: ~18m
  date_completed: 2026-04-17
---

# Phase 22 Plan 04: Hermes Stub + main.ts Dispatch Rewrite + Cross-Backend Integration Summary

## What Shipped

**Task 1 — Hermes stub backend (TDD RED → GREEN)**

- `apps/server/src/daemon/backends/detect-hermes.ts` (86 LOC): PATH probe + fallbacks `[~/.hermes/bin, /opt/homebrew/bin, /usr/local/bin]`. Version regex `/(\d+\.\d+\.\d+)/`. PG2 contract — never throws; returns null on exhaustion. Structurally identical to `detect-opencode.ts`.
- `apps/server/src/daemon/backends/hermes.ts` (68 LOC): `hermesBackend: Backend` with `provider: 'hermes'`, `detect: detectHermes`, `run: runHermesStub`. The `runHermesStub` function does NOT spawn a child process — it short-circuits on a pre-aborted signal, otherwise emits ONE `PendingTaskMessageWire{type:'error'}` carrying the hard-coded `HERMES_UNSUPPORTED_MESSAGE`, then returns `{exitCode: 1, cancelled: false}`. The `workspaceId` + `issueId` + `{hermesStub: true}` metadata ride on the envelope, never inside the message body (T-22-14 log-forging mitigation).
- `apps/server/tests/unit/hermes-backend.test.ts` (125 LOC, 6 tests): `detectHermes` happy / miss / unparseable-version; `runHermesStub` emits-one-error / pre-aborted-silent / Backend conformance.

**Task 2 — main.ts dispatch rewrite + per-backend config**

- `apps/server/src/daemon/backends/index.ts`: `ALL_BACKENDS` finalised from 4 → 5 entries; hermesBackend import + array member.
- `packages/shared/src/v14-types.ts`: `DaemonConfigFile.backends` accepts `claude? | codex? | opencode? | openclaw? | hermes?` keys (back-compat — all optional).
- `apps/server/src/daemon/config.ts`: `DaemonConfig.backends` mirrors with concrete defaults. `DEFAULT_DAEMON_CONFIG.backends = { claude: {allow:['*']}, codex: {allow:['*']}, opencode: {}, openclaw: {allow:['*']}, hermes: {} }`. Loader resolves 3 separate allow-lists from fileConfig + falls back to defaults.
- `apps/server/src/daemon/main.ts` — surgical 3-section rewrite preserving ALL lifecycle code:
  - Section 1 (was `detectClaude`): now `const detected = await detectBackends()`. Audit-log loop prints `[daemon] ${provider}=${path} (v${version})` for EACH detected backend (T-21-03 / T-22-16 generalised).
  - Section 2 (was single-claude `registerBody`): now `runtimes: detected.map(d => ({ name: \`${deviceName}-${provider}\`, provider, version, status: 'online' }))`. Post-register, builds `backendByRuntimeId: Map<string, {backend, binaryPath}>` by walking server-returned `runtimes[]` and matching on NAME (not array index — T-22-18 / A8 defence). Name-mismatch logs a warning and skips (unused runtime).
  - Section 3 (was hard-coded `runClaudeTask`): now `const entry = backendByRuntimeId.get(task.runtimeId); if (!entry) throw new Error(\`no backend for runtime ${task.runtimeId}\`)` (T-22-15 guard, fires BEFORE any spawn). Dispatches via `entry.backend.run({ task, binaryPath: entry.binaryPath, config: { backend: { allow }, ...}, onAgentMessage, abortSignal })`. The `allow` resolution is runtime-typed against `config.backends[provider]`; backends with `Record<string, never>` config (opencode, hermes) surface `allow=undefined`, which every backend treats as approve-all.
  - `import { runClaudeTask }` REMOVED (grep count = 0). All 3 `maybeTestCrashAt('after-register'|'before-poll'|'mid-task')` hooks preserved. PID file, crash handlers, heartbeat, poll loop, inFlight tracking, 5 exported functions (`startDaemon`, `stopDaemon`, `daemonStatus`, `listTokens`, `revokeToken`) all unchanged.

**Task 3 — Integration spec extension**

- `tests/e2e/daemon-integration.spec.ts` gains 3 new `@integration` scenarios under a new `test.describe('@integration cross-backend (22-04)')` block. Existing 3 claude scenarios live in the original `test.describe('@integration daemon full cycle (21-04)')` block, byte-identical.
  - **22-04 SC-1 (codex happy path):** installFakeBackend(codex, FAKE_CODEX_JS) → daemon registers → `GET /api/runtimes` shows `provider:'codex', name:/-codex$/, status:'online'` → issue assigned → task reaches `completed` within 30 s → ≥2 task_messages.
  - **22-04 SC-2 (opencode happy path):** installFakeBackend(opencode, FAKE_OPENCODE_JS) → same shape, filter on `provider='opencode'`.
  - **22-04 SC-3 (cross-backend cancel):** installFakeBackend(opencode, FAKE_OPENCODE_JS, ['--hang']) → `PATCH /api/issues/:id status=cancelled` → `pgrep -f fake-opencode` empty within 8 s (POSIX-only; win32-skipped).
- Helpers generalised:
  - `installFakeBackend(fakeBinDir, binName, fixtureJs, extraArgs)` takes the provider name explicitly so the same helper provisions any of the 4 fake backends.
  - `installFakeClaude(fakeBinDir, extraArgs)` preserved as a shim delegating to `installFakeBackend(fakeBinDir, 'claude', FAKE_CLAUDE_JS, extraArgs)` — zero diff for the existing scenarios.
  - `waitForRuntime(..., providerFilter?)` takes an optional provider filter so 22-04 scenarios bind to their own runtime row and don't accidentally pick up a stale claude row from a sibling run.
  - `pgrepByPattern(pattern)` helper; `pgrepFakeClaude()` now delegates to it.

## Verification

- `npm run build -w @aquarium/shared` — clean.
- `npm run typecheck -w @aquaclawai/aquarium` — clean.
- `npm run test:unit -w @aquaclawai/aquarium` — **304/304 pass** (298 baseline + 6 hermes; 5.7 s).
- `npm run build -w @aquaclawai/aquarium` — clean. All 5 backend dist files present:
  - `apps/server/dist/daemon/backends/codex.js` ✓
  - `apps/server/dist/daemon/backends/opencode.js` ✓
  - `apps/server/dist/daemon/backends/openclaw.js` ✓
  - `apps/server/dist/daemon/backends/hermes.js` ✓
  - `apps/server/dist/daemon/backends/detect-hermes.js` ✓
- `node apps/server/dist/cli.js daemon start --help` — exits 0, prints expected flags.
- Integration scenarios — structural compile clean (`tsc --noEmit` on the spec file passes in standalone mode). **Manual local execution not performed this run** (requires `npm run dev` in a second terminal); the 3 new scenarios are CI-skipped along with the existing 3 via the `process.env.CI === 'true'` top-of-file guard. Local smoke run command is documented at the top of the spec file.
- Grep acceptance criteria (all pass):
  - `grep -cE "claudeBackend,|codexBackend,|opencodeBackend,|openclawBackend,|hermesBackend," apps/server/src/daemon/backends/index.ts` = 5 ✓
  - `grep -cE '^\s+(claude|codex|opencode|openclaw|hermes)\?:' packages/shared/src/v14-types.ts` = 5 (one per DaemonConfigFile backend key) ✓
  - `grep -c "detectBackends" apps/server/src/daemon/main.ts` = 4 ✓
  - `grep -c "detectClaude(" apps/server/src/daemon/main.ts` = 0 ✓
  - `grep -c "backendByRuntimeId" apps/server/src/daemon/main.ts` = 5 ✓
  - `grep -c "no backend for runtime" apps/server/src/daemon/main.ts` = 1 ✓
  - `grep -c "import.*runClaudeTask" apps/server/src/daemon/main.ts` = 0 ✓
  - `grep -c "maybeTestCrashAt" apps/server/src/daemon/main.ts` = 5 ✓
  - `grep -cE '\\$\\{(task|agent|deps|issue)' apps/server/src/daemon/backends/hermes.ts` = 0 (T-22-14 mitigation verified) ✓
  - `grep -cE "execa|spawn|child_process" apps/server/src/daemon/backends/hermes.ts` = 0 ✓
  - `grep -c "hermesBackend: Backend" apps/server/src/daemon/backends/hermes.ts` = 1 ✓
  - `grep -c "codex happy path\\|opencode happy path" tests/e2e/daemon-integration.spec.ts` = 2 ✓
  - `grep -cE "cross-backend|cancel propagates across backend" tests/e2e/daemon-integration.spec.ts` ≥ 1 ✓
  - `grep -cE "installFakeBackend|FAKE_CODEX_JS|FAKE_OPENCODE_JS" tests/e2e/daemon-integration.spec.ts` ≥ 2 ✓
  - `grep -c "process\\.platform === 'win32'" tests/e2e/daemon-integration.spec.ts` = 2 (SC-3 + cross-backend cancel) ✓

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Doc-comment shadowing grep assertion] Header comment in hermes.ts contained the literal strings `${task...}` and `${agent...}` as examples inside a documentation block, causing the plan's grep acceptance `grep -cE '\\$\\{(task|agent|deps|issue)' apps/server/src/daemon/backends/hermes.ts` to return 2 instead of the intended 0.**
- **Found during:** Task 1 acceptance grep after GREEN
- **Issue:** The T-22-14 mitigation note used ES-template-literal syntax (`\`${task...}\``) to describe the forbidden pattern, which the grep couldn't distinguish from real interpolation.
- **Fix:** Rewrote the comment to describe the mitigation in plain English ("NO interpolation of runtime data into the message body") and replaced `child process spawned` with `subprocess launch path` so the secondary grep `grep -cE "execa|spawn|child_process"` also returns 0. Runtime behaviour unchanged.
- **Files modified:** `apps/server/src/daemon/backends/hermes.ts` (comment-only)
- **Commit:** 02df311 (folded into the GREEN commit)

**2. [Rule 3 — Worktree type-resolution] npm workspaces resolved `@aquarium/shared` from the main repo's node_modules symlink instead of the worktree's newly built package, so typecheck saw the OLD `DaemonConfigFile` shape.**
- **Found during:** Task 2 after shared rebuild — typecheck reported `Property 'openclaw' does not exist on type '{ claude?: { allow?: string[] | undefined; } | undefined; }'`.
- **Issue:** Worktree has no own `node_modules`; resolution walks up to the main repo's `node_modules/@aquarium/shared` which symlinks to the MAIN repo's `packages/shared` (not the worktree's).
- **Fix:** Created a worktree-local symlink: `mkdir -p node_modules/@aquarium && ln -sf ../../packages/shared node_modules/@aquarium/shared`. This is a local environment fix only — `node_modules/` is gitignored so no file change enters git. The orchestrator's merge back into main will make the main repo's `packages/shared/src` match the worktree's, after which `npm install` at main will regenerate the correct symlink naturally.
- **Files modified:** none (environment-only)
- **Commit:** n/a

### Auth gates

None — this plan is unit + integration (CI-skipped) only; no external services.

### Rule 4 checkpoints

None — all changes followed the plan structure; no architectural decisions required.

## OpenClaw Live-Capture Outcome

- **Attempted (22-03):** `which openclaw` — binary NOT present on the execution machine.
- **Propagated state (22-04):** Shape A assumption stands; no integration scenario added for openclaw.
- **Covered by:** `22-VALIDATION.md :: Manual-Only Verifications :: OpenClaw real binary happy path`. Operators running with an installed openclaw binary and encountering a shape mismatch update `apps/server/src/daemon/backends/openclaw.ts` `mapOpenclawEventToAgentMessage` + `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson` together; no other code changes required.

## Codex Approval-Response Enum Finding

- **Attempted:** No live codex run happened this plan — the `fake-codex.js` fixture does not validate the `approved` / `denied` enum values because its scripted path returns OK to all daemon responses regardless. 22-02 unit tests assert the enum shape but not end-to-end binding to a live codex binary.
- **Propagated state (22-04):** Assumption A1 (`'approved'` / `'denied'`) stands. If a live run surfaces a mismatch, the single-point-of-update is `buildCodexApprovalResponse` in `apps/server/src/daemon/backends/codex.ts` — a one-line change.

## Integration Scenario Execution Scope

- **Ran locally this session:** NO (requires a pre-running `npm run dev` server; scope of this executor is unit + structural-compile only).
- **CI skip guard:** intact — `test.skip(process.env.CI === 'true', ...)` at the top of the spec covers ALL 6 scenarios, both legacy and new. CI behaviour unchanged.
- **Manual run command** (for operators):
  ```bash
  # Terminal 1:
  npm run dev
  # Terminal 2:
  npm run build -w @aquarium/shared && npm run build -w @aquaclawai/aquarium
  CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep @integration
  ```

## Known Stubs

- `hermesBackend` itself is the documented stub for BACKEND-03 hermes. This is intentional — see plan 22-04 objective. The swap path when Nous Research Issue #569 ships is a single-file rewrite of `hermes.ts` + a fixture addition; no wider surface change.
- Openclaw Shape A assumption (A3) carries forward from 22-03 with no new stub surface added here.

## Threat Flags

None. All Plan 22-04 changes sit inside existing trust boundaries. The plan's threat register (T-22-14, T-22-15, T-22-16, T-22-17, T-22-18) is fully mitigated inline:

- T-22-14 — hermes error message is hard-coded; grep assertion = 0
- T-22-15 — `no backend for runtime ${runtimeId}` throw in `main.ts runTask` — verified by grep
- T-22-16 — audit log iterates EVERY detected backend path — verified by grep
- T-22-17 — accepted (no PII in `hermes --version`)
- T-22-18 — backendByRuntimeId built by NAME match, not index — code-verified

## Self-Check: PASSED

- apps/server/src/daemon/backends/hermes.ts — FOUND
- apps/server/src/daemon/backends/detect-hermes.ts — FOUND
- apps/server/src/daemon/backends/index.ts (5 entries) — FOUND
- apps/server/src/daemon/main.ts (dispatch rewrite) — FOUND
- apps/server/src/daemon/config.ts (5-key backends) — FOUND
- packages/shared/src/v14-types.ts (5-key DaemonConfigFile) — FOUND
- apps/server/tests/unit/hermes-backend.test.ts (6 tests, 125 LOC) — FOUND
- tests/e2e/daemon-integration.spec.ts (3 new + 3 existing scenarios) — FOUND
- apps/server/dist/daemon/backends/{codex,opencode,openclaw,hermes}.js — FOUND
- Commit 5577749 (RED) — FOUND
- Commit 02df311 (GREEN hermes) — FOUND
- Commit c770da0 (dispatch rewrite) — FOUND
- Commit 7b32fa0 (integration spec) — FOUND
- `npm run typecheck -w @aquaclawai/aquarium` — PASS
- `npm run test:unit -w @aquaclawai/aquarium` — 304/304 PASS
- `npm run build -w @aquaclawai/aquarium` — PASS
- `node apps/server/dist/cli.js daemon start --help` — PASS
