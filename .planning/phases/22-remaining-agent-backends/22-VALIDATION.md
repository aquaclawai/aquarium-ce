---
phase: 22
slug: remaining-agent-backends
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nyquist required: `workflow.nyquist_validation: true` per `.planning/config.json`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` via `tsx` (unchanged from Phase 21) |
| **Config file** | none — native Node test runner wired via `npm test:unit -w @aquaclawai/aquarium` |
| **Quick run command** | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/<file>` |
| **Full suite command** | `npm run test:unit -w @aquaclawai/aquarium` |
| **Integration tier** | `CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep @integration` |
| **Typecheck command** | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` |
| **Lint command** | n/a for server (no linter); run `npm run lint` only if web files touched |
| **Estimated runtime** | ~8 s for full unit suite (Phase 21 baseline 5.7 s + 3 new backend tests + interface extraction) |

---

## Sampling Rate

- **After every task commit:** Run the per-task quick command from the Verification Map (usually one `*.test.ts` file).
- **After every plan wave:** Run full unit suite (`npm run test:unit -w @aquaclawai/aquarium`) AND typecheck.
- **Before `/gsd-verify-work`:** Full unit suite green + typecheck clean + integration smoke (codex + opencode scenarios) executed once locally with at least the fake-backend fixtures.
- **Max feedback latency:** 15 s for quick command, 20 s for full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 0 | BACKEND-02/03 (interface) | — | AQUARIUM_* tokens stripped from child env | unit | `npx tsx --test apps/server/tests/unit/backend-env.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-01-02 | 01 | 0 | BACKEND-02/03 (interface) | — | Only available backends registered (detect probe) | unit | `npx tsx --test apps/server/tests/unit/detect-backends.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-01-03 | 01 | 1 | BACKEND-02/03 (interface) | — | Claude backend refactored behind `Backend` interface; no behaviour drift | unit | `npx tsx --test apps/server/tests/unit/claude-control-request.test.ts` | ✅ shipped (extend) | ⬜ pending |
| 22-02-01 | 02 | 2 | BACKEND-02 | — | Codex JSON-RPC init/thread/turn happy path → AgentMessage union | unit | `npx tsx --test apps/server/tests/unit/codex-backend.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-02-02 | 02 | 2 | BACKEND-02 | T-22-02 | Codex approval requests answered with correct enum (approved/denied per allow-list) | unit | same file | ❌ Wave 0 | ⬜ pending |
| 22-02-03 | 02 | 2 | BACKEND-02 | — | Codex `turn/interrupt` sent on AbortSignal within 10 s | unit | same file | ❌ Wave 0 | ⬜ pending |
| 22-03-01 | 03 | 2 | BACKEND-03 (opencode) | — | OpenCode `run --format json` NDJSON parsed into AgentMessage union | unit | `npx tsx --test apps/server/tests/unit/opencode-backend.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-03-02 | 03 | 2 | BACKEND-03 (openclaw) | — | OpenClaw `agent --json` NDJSON structurally parsed (real fixture OR stub-with-error) | unit | `npx tsx --test apps/server/tests/unit/openclaw-backend.test.ts` | ❌ Wave 0 (conditional on live capture) | ⬜ pending |
| 22-04-01 | 04 | 2 | BACKEND-03 (hermes) | — | Hermes stub backend emits actionable error AgentMessage and exits non-zero | unit | `npx tsx --test apps/server/tests/unit/hermes-backend.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-04-02 | 04 | 3 | SC-1 Phase 22 | — | Codex happy path via fake-codex binary (register → claim → stream → complete) | integration | `CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep 'codex happy path'` | ❌ Wave 0 | ⬜ pending |
| 22-04-03 | 04 | 3 | SC-1 Phase 22 | — | OpenCode happy path via fake-opencode binary | integration | same spec, `--grep 'opencode happy path'` | ❌ Wave 0 | ⬜ pending |
| 22-04-04 | 04 | 3 | SC-4 carry-forward | PM5/PM6/PM7 | Cancel propagation under all backends: SIGTERM → state='cancelled' within 10 s | integration | same spec, `--grep 'cancel cross-backend'` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/src/daemon/backends/` directory scaffold
- [ ] `apps/server/src/daemon/backend.ts` — Backend interface + AgentMessage re-export + buildChildEnv signature
- [ ] `apps/server/src/daemon/backends/index.ts` — registry + detectBackends
- [ ] `apps/server/src/daemon/backends/env.ts` — buildChildEnv extraction (AQUARIUM_* strip)
- [ ] `apps/server/tests/unit/backend-env.test.ts` — stub failing tests for AQUARIUM_* env strip
- [ ] `apps/server/tests/unit/detect-backends.test.ts` — stub failing tests for detectBackends
- [ ] `apps/server/tests/fixtures/codex-stream-sample.ndjson` — captured codex JSON-RPC fixture (init + thread/start + turn/start + notifications + turn/completed)
- [ ] `apps/server/tests/fixtures/opencode-stream-sample.ndjson` — captured OpenCode NDJSON fixture (step_start + text + tool_use + step_finish)
- [ ] `apps/server/tests/fixtures/openclaw-stream-sample.ndjson` — captured OR hand-authored OpenClaw fixture (conditional on local capture)
- [ ] `apps/server/tests/fixtures/fake-codex.js` — executable Node script mirroring codex app-server stdio
- [ ] `apps/server/tests/fixtures/fake-opencode.js` — executable Node script mirroring `opencode run --format json`
- [ ] `apps/server/tests/fixtures/fake-openclaw.js` — executable Node script mirroring openclaw `agent --json` (optional if openclaw ships as stub)
- [ ] Integration spec extension: 3 new scenarios in `tests/e2e/daemon-integration.spec.ts` (codex happy path, opencode happy path, cross-backend cancel)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Runtime switch (claude → codex) produces no `task_message` schema change, UI renders identically | SC-3 | Requires live daemon + server + real UI | 1) Run daemon with real `claude` CLI → complete a task 2) Stop daemon 3) Run daemon with real `codex` CLI registered as the same agent's runtime 4) Complete a task 5) Inspect `task_messages` table: rows must have identical columns + JSON shape 6) Open issue detail UI: tool-use/tool-result/text/thinking render visually identical |
| OpenClaw real binary happy path | BACKEND-03 (openclaw) | OpenClaw stream shape not fully specified — live capture required | 1) Install openclaw locally 2) Register daemon with openclaw on PATH 3) Claim a task 4) Verify output streams as AgentMessage; if stub-with-error, confirm error is actionable and documented in UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (interface + 4 backends + 3 fixtures + 3 fakes + integration scenarios)
- [ ] No watch-mode flags
- [ ] Feedback latency < 20 s full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner confirms

**Approval:** pending
