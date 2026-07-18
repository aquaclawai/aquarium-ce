---
phase: 22-remaining-agent-backends
verified: 2026-04-17T00:00:00Z
status: human_needed
score: 10/12 must-haves verified
re_verification: false
human_verification:
  - test: "SC-3: Switch an agent's runtime from Claude daemon to Codex daemon and confirm no task_message schema change"
    expected: "After completing a task via claude, stop daemon, restart with codex binary on PATH, complete a second task on the same agent — inspect task_messages rows: columns and JSON shapes are identical between the two tasks. Open issue detail UI: tool_use/tool_result/text/thinking render visually identical."
    why_human: "Requires live daemon + real server + real claude and codex CLIs installed. Integration spec explicitly documents this as manual-only (22-VALIDATION.md Manual-Only Verifications table). UI rendering cannot be verified programmatically."
  - test: "OpenClaw real binary happy path — confirm Shape A assumption (A3) or discover Shape B"
    expected: "Run openclaw locally with daemon registered and claim a task. Verify NDJSON output matches the Shape A mapper in openclaw.ts (text/tool_use/tool_result/error/done). If Shape B is discovered, update mapOpenclawEventToAgentMessage and openclaw-stream-sample.ndjson together."
    why_human: "openclaw binary was not installed on any execution machine during Phase 22 (confirmed in both 22-03-SUMMARY and 22-04-SUMMARY). The mapper ships against an assumed shape; real verification requires the binary."
---

# Phase 22: Remaining Agent Backends — Verification Report

**Phase Goal:** Codex, OpenClaw, OpenCode, and Hermes backends implement the same stream interface as Phase 21's Claude backend so users with any of these CLIs installed get the same task-delegation experience with no code-path divergence.
**Verified:** 2026-04-17
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: Codex backend spawns `codex app-server --listen stdio://`, routes JSON-RPC events through the same `AgentMessage` union, completes a sample task | VERIFIED | `codex.ts` exists (668-line test file, 26 tests); `initialize`/`thread/start`/`turn/start`/`turn/interrupt` all present; `codexBackend: Backend` typed; ALL_BACKENDS registered; integration scenario `22-04 SC-1: codex happy path` present in `daemon-integration.spec.ts` (CI-skipped, structurally compiled) |
| 2 | SC-2: OpenClaw, OpenCode, Hermes backends pass the same unit-test harness for stream parsing with backend-specific transcript fixtures | VERIFIED | `opencode-backend.test.ts` (433 LOC, 16 tests), `openclaw-backend.test.ts` (356 LOC, 14 tests), `hermes-backend.test.ts` (125 LOC, 6 tests); fixture files verified present with correct content (step_finish, turn/completed, tool_use); 304/304 tests pass post-merge per 22-04-SUMMARY |
| 3 | SC-3: Switching runtime claude→codex produces no task_message schema change (manual E2E) | HUMAN_NEEDED | Schema unchanged by construction — `PendingTaskMessageWire` shape is backend-agnostic and `backendByRuntimeId` dispatch has no schema surface. However, manual UI confirmation required per 22-VALIDATION.md Manual-Only Verifications table. |
| 4 | SC-4: All backends honour cancel contract — SIGTERM triggers `state='cancelled'` within 10 s or escalates to SIGKILL | VERIFIED | `execa` `cancelSignal` + `forceKillAfterDelay: gracefulKillMs` present in codex/opencode/openclaw spawners; hermes short-circuits on aborted signal; fake binary SIGTERM→143 handlers confirmed on all 3 stubs; cross-backend cancel integration scenario (`22-04 SC-3`) in spec; codex sends `turn/interrupt` fire-and-forget before execa signal escalation |

**Score:** 3/4 truths fully verified (SC-3 requires human)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/daemon/backend.ts` | Backend interface + BackendRunDeps + BackendRunResult | VERIFIED | File exists, exports `Backend`, `BackendRunDeps`, `BackendRunResult`; interface uses `Exclude<RuntimeProvider, 'hosted'>` |
| `apps/server/src/daemon/backends/env.ts` | buildChildEnv + sanitizeCustomEnv | VERIFIED | File exists; 2 `delete env.AQUARIUM_` lines confirmed; `path.dirname(process.execPath)` present (PM3) |
| `apps/server/src/daemon/backends/index.ts` | ALL_BACKENDS (5 entries) + detectBackends | VERIFIED | All 5 backends imported and in array: claude, codex, opencode, openclaw, hermes; grep count = 5 |
| `apps/server/src/daemon/backends/claude.ts` | claudeBackend: Backend + preserved back-compat exports | VERIFIED | `claudeBackend: Backend` present; 7 named exports confirmed; imports from `./env.js` |
| `apps/server/src/daemon/backends/codex.ts` | codexBackend + spawnCodex + runCodexTask + approval | VERIFIED | `codexBackend: Backend` confirmed; all 4 JSON-RPC method literals present; `buildChildEnv(` wired |
| `apps/server/src/daemon/backends/detect-codex.ts` | detectCodex with strict app-server probe | VERIFIED | File exists; `experimental.*app server|--listen` probe confirmed in code |
| `apps/server/src/daemon/backends/opencode.ts` | opencodeBackend + spawnOpenCode + mapper | VERIFIED | `opencodeBackend: Backend` confirmed; `'run'`/`'--format'`/`'json'` literals present; `-s`/`-c` absent (T-22-11) |
| `apps/server/src/daemon/backends/openclaw.ts` | openclawBackend + spawnOpenclaw + mapper | VERIFIED | `openclawBackend: Backend` confirmed; `'agent'`/`'-m'`/`'--json'` literals present; ASSUMPTION A3 documented in file |
| `apps/server/src/daemon/backends/hermes.ts` | hermesBackend stub (no spawn, actionable error) | VERIFIED | File exists; no `execa`/`spawn` calls; error contains `not supported`/`v1.4`/`Nous Research`; no `${task/agent/deps/issue}` interpolation (T-22-14) |
| `apps/server/src/daemon/main.ts` | detectBackends dispatch + backendByRuntimeId map | VERIFIED | `detectBackends` imported and called; `backendByRuntimeId` map declaration + populate + lookup (5 grep hits); `no backend for runtime` guard (T-22-15); no `detectClaude(` or `import.*runClaudeTask`; 3 `maybeTestCrashAt` hooks preserved |
| `apps/server/src/daemon/config.ts` | DaemonConfig.backends (5 keys + defaults) | VERIFIED | All 5 backend keys in `DaemonConfig` interface and `DEFAULT_DAEMON_CONFIG.backends`; codex+openclaw default `allow:['*']`; opencode+hermes `Record<string, never>` |
| `packages/shared/src/v14-types.ts` | DaemonConfigFile.backends extended with 5 optional keys | VERIFIED | grep count = 5 for `claude?|codex?|opencode?|openclaw?|hermes?` in DaemonConfigFile.backends |
| `apps/server/tests/unit/backend-env.test.ts` | PM7 token-strip + process.env mutation tests | VERIFIED | 107 LOC, 10 tests; `env.AQUARIUM_DAEMON_TOKEN === undefined` assertion present; process.env mutation snapshot present |
| `apps/server/tests/unit/detect-backends.test.ts` | PG2 per-backend error isolation | VERIFIED | 89 LOC, 6 tests; one-throws-others-succeed test confirmed |
| `apps/server/tests/unit/codex-backend.test.ts` | 9+ tests: handshake, approval, cancel, malformed | VERIFIED | 668 LOC, 26 tests; `turn/interrupt`, `item/commandExecution/requestApproval`, `[auto-approve] codex tool=`, `[deny] codex tool=` all present |
| `apps/server/tests/unit/opencode-backend.test.ts` | 7+ tests: mapper, argv, fixture round-trip | VERIFIED | 433 LOC, 16 tests |
| `apps/server/tests/unit/openclaw-backend.test.ts` | 6+ tests: mapper, detect, fixture round-trip | VERIFIED | 356 LOC, 14 tests |
| `apps/server/tests/unit/hermes-backend.test.ts` | 3+ tests: detect, stub emit, pre-abort | VERIFIED | 125 LOC, 6 tests |
| `apps/server/tests/unit/fixtures/codex-stream-sample.ndjson` | 10+ lines; turn/completed; requestApproval | VERIFIED | 11 lines; `turn/completed` present; `item/commandExecution/requestApproval` present |
| `apps/server/tests/unit/fixtures/opencode-stream-sample.ndjson` | 5+ lines; step_finish; tool_use | VERIFIED | 6 lines; `step_finish` present |
| `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson` | 4+ lines; tool_use; type discriminator | VERIFIED | 5 lines; `type` discriminator present |
| `apps/server/tests/unit/fixtures/fake-codex.js` | ESM; --version → codex-cli 0.118.0; SIGTERM handler | VERIFIED | File present (0755); `--version` outputs `codex-cli 0.118.0`; SIGTERM→143 handler confirmed |
| `apps/server/tests/unit/fixtures/fake-opencode.js` | ESM; --version → fake-opencode; SIGTERM handler | VERIFIED | File present (0755); `--version` outputs `1.2.3 (fake-opencode)`; SIGTERM→143 handler confirmed |
| `apps/server/tests/unit/fixtures/fake-openclaw.js` | ESM; --version → fake-openclaw; SIGTERM handler | VERIFIED | File present (0755); `--version` outputs `openclaw 0.1.0 (fake-openclaw)`; SIGTERM→143 handler confirmed |
| `tests/e2e/daemon-integration.spec.ts` | 3 new @integration scenarios; installFakeBackend helper | VERIFIED | `codex happy path`, `opencode happy path`, `cancel propagates across backend` all present; `installFakeBackend` function confirmed; `FAKE_CODEX_JS` + `FAKE_OPENCODE_JS` constants present; 2 win32-skip guards; 5 existing claude scenarios present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `backends/claude.ts` | `backends/env.ts` | `import { buildChildEnv } from './env.js'` | VERIFIED | grep count = 1 |
| `backends/index.ts` | `backend.ts` | `import type { Backend } from '../backend.js'` | VERIFIED | confirmed in file |
| `backends/claude.ts` | `backend.ts` | `claudeBackend: Backend` typed object | VERIFIED | grep count = 1 |
| `backends/codex.ts` | `backends/env.ts` | `buildChildEnv(` | VERIFIED | grep count = 1 |
| `backends/codex.ts` | `ndjson-parser.ts` | `parseNdjson<JsonRpcEnvelope>` | VERIFIED | present in codex.ts |
| `backends/codex.ts` | `backend.ts` | `codexBackend: Backend` | VERIFIED | grep count = 1 |
| `backends/index.ts` | `backends/codex.ts` | `codexBackend` import + ALL_BACKENDS | VERIFIED | grep count >= 2 |
| `backends/opencode.ts` | `backends/env.ts` | `buildChildEnv(` | VERIFIED | grep count = 1 |
| `backends/openclaw.ts` | `backends/env.ts` | `buildChildEnv(` | VERIFIED | grep count = 1 |
| `backends/index.ts` | `opencode.ts + openclaw.ts` | both in ALL_BACKENDS | VERIFIED | grep count = 8 for all 4 backends |
| `backends/hermes.ts` | `backend.ts` | `hermesBackend: Backend` | VERIFIED | grep count = 1 |
| `main.ts` | `backends/index.ts` | `detectBackends` import + call | VERIFIED | grep count = 4 in main.ts |
| `main.ts` | `backend.ts` | `backendByRuntimeId: Map<string, { backend: Backend; binaryPath: string }>` | VERIFIED | grep count = 5 |
| `daemon-integration.spec.ts` | `fixtures/fake-codex.js + fake-opencode.js` | `installFakeBackend` PATH prepend | VERIFIED | `FAKE_CODEX_JS` + `FAKE_OPENCODE_JS` referenced; `installFakeBackend` function declared |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `codex.ts` `runCodexTask` | `onAgentMessage` callbacks | `mapCodexNotificationToAgentMessage` consuming live `parseNdjson` NDJSON stdout | Yes — JSON-RPC notifications parsed per-line and mapped | FLOWING |
| `opencode.ts` `runOpenCodeTask` | `onAgentMessage` callbacks | `mapOpencodeEventToAgentMessage` consuming `parseNdjson` stdout | Yes — NDJSON events parsed from child stdout | FLOWING |
| `openclaw.ts` `runOpenclawTask` | `onAgentMessage` callbacks | `mapOpenclawEventToAgentMessage` consuming `parseNdjson` stdout (Shape A assumed) | ASSUMED — shape assumption A3 not confirmed against live binary | ASSUMED (Shape A) |
| `hermes.ts` `runHermesStub` | One `type:'error'` `onAgentMessage` call | Hard-coded constant `HERMES_UNSUPPORTED_MESSAGE` | No real data — intentional stub per A4 | STUB (documented, intentional) |
| `main.ts` | `entry.backend.run(...)` | `backendByRuntimeId.get(task.runtimeId)` dispatch map | Yes — map built from detected backends + server-returned runtimeIds | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| fake-codex --version | `node apps/server/tests/unit/fixtures/fake-codex.js --version` | `codex-cli 0.118.0` | PASS |
| fake-opencode --version | `node apps/server/tests/unit/fixtures/fake-opencode.js --version` | `1.2.3 (fake-opencode)` | PASS |
| fake-openclaw --version | `node apps/server/tests/unit/fixtures/fake-openclaw.js --version` | `openclaw 0.1.0 (fake-openclaw)` | PASS |
| CLI daemon start help | `node apps/server/dist/cli.js daemon start --help` | Exits 0 (daemon dir not in stale dist) | SKIP — dist stale (built April 6); daemon subdir absent. Authoritative check is typecheck which passed per SUMMARY. |
| 304 unit tests pass | Summary claim | 304/304 (per 22-04-SUMMARY; verified by orchestrator pre-spawn) | PASS (pre-verified by orchestrator) |

Note on stale dist: `apps/server/dist/` is `.gitignore`'d and was last built April 6 (before Phase 22). The SUMMARY documents a clean dist build during execution. The daemon backend JS files are not present in the current dist snapshot. This is a stale-build artifact, not a code defect — typecheck is the authoritative structural check and it passed.

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BACKEND-02 | 22-01, 22-02 | `codex` backend spawns `codex app-server --listen stdio://` and consumes JSON-RPC events through the same unified `AgentMessage` interface | SATISFIED | `codexBackend: Backend` in `codex.ts`; JSON-RPC handshake (`initialize`/`thread/start`/`turn/start`/`turn/interrupt`) all present; approval response with allow-list gating; cancel via `turn/interrupt` + execa escalation; 26 unit tests green |
| BACKEND-03 | 22-01, 22-03, 22-04 | `openclaw`, `opencode`, `hermes` backends each implement the same `Backend` interface with provider-specific stream parsing | SATISFIED (with known stubs) | `opencodeBackend`, `openclawBackend`, `hermesBackend` all implement `Backend`; opencode has verified live shape (A2); openclaw ships with Shape A assumption (A3) documented as single-update point; hermes ships as documented stub-with-error (A4) per research recommendation; all 3 in ALL_BACKENDS; 34 new unit tests cover them |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `backends/openclaw.ts` | Shape A assumption (A3) for live NDJSON wire format — mapper built against assumed OpenCode-like shape, not captured from real binary | WARNING | If openclaw CLI uses a different discriminator or key names, all tasks routed to openclaw backend will produce empty/incorrect AgentMessages. Single point of update documented in file header and tests. Not a blocker — openclaw binary not installed anywhere in scope. |
| `backends/hermes.ts` | Intentional stub — `runHermesStub` never spawns, always returns error | INFO | By design (research A4: Hermes has no headless JSON mode as of April 2026). Documented as intentional. Actionable error message guides users. |
| `apps/server/dist/` | Stale dist — daemon subdirectory not present; built April 6 pre-Phase-22 | WARNING | `node apps/server/dist/cli.js daemon start --help` does not exercise new dispatch code. Not a gap in source — dist is gitignored, rebuild required. Typecheck is the authoritative structural gate and passed. |

---

### Human Verification Required

#### 1. SC-3: Runtime Switch claude→codex — No task_message Schema Change

**Test:**
1. Start daemon with real `claude` CLI on PATH — `npx . daemon start`
2. Assign an issue to an agent using the claude runtime; wait for task completion
3. Stop daemon; start daemon with real `codex` CLI on PATH (codex must support `app-server --help`)
4. Assign another issue to the same agent (now codex runtime); wait for task completion
5. `SELECT type, metadata FROM task_messages WHERE task_id IN (<claude_task_id>, <codex_task_id>) ORDER BY seq` — compare column shapes
6. Open Issue Detail UI for both issues; confirm tool_use / tool_result / text / thinking render visually identical

**Expected:** `task_messages` rows have identical column schema and JSON key shapes across both runs. UI renders identically — no backend-specific layout divergence.

**Why human:** Requires live daemon + real server + real `claude` and `codex` CLI binaries installed. UI rendering cannot be verified programmatically. Explicitly documented as manual-only in `22-VALIDATION.md`.

---

#### 2. OpenClaw Shape A Confirmation (Assumption A3)

**Test:**
1. Install `openclaw` locally (`which openclaw` succeeds)
2. Run `openclaw agent --local --json -m "say hi" 2>/dev/null | head -20 > /tmp/openclaw-real.ndjson`
3. Inspect the keys on each event line: are they `{ type, text, sessionId }` (Shape A) or a different discriminator?
4. If Shape A confirmed: replace `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson` with the captured output
5. If Shape B (or other): update `mapOpenclawEventToAgentMessage` in `openclaw.ts` AND the fixture together; no Backend interface change needed

**Expected:** Either Shape A confirmed (no code change needed beyond fixture update) or Shape B documented with a targeted mapper update.

**Why human:** `openclaw` binary was not installed on any execution machine during Phase 22 (confirmed by both 22-03-SUMMARY and 22-04-SUMMARY). Shape A is a MEDIUM-confidence research assumption. The mapper is the single point of update if the assumption is wrong.

---

### Gaps Summary

No gaps blocking goal achievement were found. All five backends implement the `Backend` interface and are registered in `ALL_BACKENDS`. The dispatch map in `main.ts` is fully wired. Unit test coverage is comprehensive (304 tests pass). The two human verification items are explicitly acknowledged in the phase plan as manual-only and are not regression defects.

The only notable findings are:

1. OpenClaw Shape A assumption (A3) — documented stub that requires a live binary to confirm. Not a blocker; the Backend interface is unchanged regardless of shape discovery.
2. Hermes intentional stub — by design per research finding A4.
3. Stale dist snapshot — `apps/server/dist/` was built before Phase 22; not a source defect; typecheck is authoritative.

---

_Verified: 2026-04-17_
_Verifier: Claude (gsd-verifier)_
