---
phase: 21
slug: daemon-cli-claude-code-backend-unit-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (node:test, Node 22+) |
| **Config file** | none — ships as native Node test runner, wired via `npm test` in `apps/server/package.json` |
| **Quick run command** | `npm --workspace @aquaclawai/aquarium test -- --test-only apps/server/tests/unit/<file>` |
| **Full suite command** | `npm --workspace @aquaclawai/aquarium run test:unit` (runs `tsx --test apps/server/tests/unit/**/*.test.ts`) |
| **Typecheck command** | `npm run typecheck -w @aquaclawai/aquarium` |
| **Lint command** | n/a for server (no linter); run `npm run lint` only if web files touched |
| **Estimated runtime** | ~8–15 s for full unit suite (no child-process spawns except in integration) |

Wave 0 deliverable: `tests/fixtures/claude-stream-sample.ndjson` plus `apps/server/package.json` `scripts.test:unit` entry. See Wave 0 Requirements.

---

## Sampling Rate

- **After every task commit:** Run the per-task quick command from the Verification Map (usually one `*.test.ts` file).
- **After every plan wave:** Run full unit suite (`npm run test:unit -w @aquaclawai/aquarium`) AND typecheck.
- **Before `/gsd-verify-work`:** Full unit suite green + typecheck clean + manual integration spec (`daemon-integration.spec.ts`) executed once locally with real `claude` CLI on PATH.
- **Max feedback latency:** 15 s for quick command, 20 s for full suite.

---

## Per-Task Verification Map

> Task IDs use the form `{phase}-{plan}-{task}` matching what the planner emits. Commands use the workspace flag so they work from repo root. Replace file paths if the planner names tasks differently.

### Plan 21-01 — Primitives + shared types (Wave 1)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | BACKEND-07 | — | Shared `AgentMessage` + `DaemonConfigFile` types compile | typecheck | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` | ❌ W0 | ⬜ pending |
| 21-01-02 | 01 | 1 | BACKEND-07 / PG1 | — | FIFO bounded semaphore acquire/release ordering verified | unit | `npx tsx --test apps/server/tests/unit/semaphore.test.ts` | ❌ W0 | ⬜ pending |
| 21-01-03 | 01 | 1 | BACKEND-06 / PM1, PG3, PG4 | — | Kill escalator sends SIGTERM, escalates to SIGKILL after 10 s using `node:test` mock timers | unit | `npx tsx --test apps/server/tests/unit/kill-escalation.test.ts` | ❌ W0 | ⬜ pending |
| 21-01-04 | 01 | 1 | BACKEND-04 / T1, PG7 | — | NDJSON parser handles CRLF, UTF-8 multi-byte, malformed lines without crashing; 60 s watchdog triggers | unit | `npx tsx --test apps/server/tests/unit/ndjson-parser.test.ts` | ❌ W0 | ⬜ pending |

### Plan 21-02 — CLI entry + daemon config + detection + HTTP client (Wave 2)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-02-01 | 02 | 2 | CLI-01 | — | `npx @aquaclawai/aquarium daemon start` dispatches via commander; default subcommand preserves pre-21 CLI behavior | unit | `npx tsx --test apps/server/tests/unit/cli-dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 21-02-02 | 02 | 2 | CLI-03 / PG8 | T-21-02 (token-on-disk perms) | Config loader reads `~/.aquarium/daemon.json`, creates with 0600 perms, rejects world-readable tokens with clear error | unit | `npx tsx --test apps/server/tests/unit/daemon-config.test.ts` | ❌ W0 | ⬜ pending |
| 21-02-03 | 02 | 2 | CLI-04 / BACKEND-01 | — | `detectClaude()` resolves `claude` from PATH + fallback paths, parses `--version`, returns `{ path, version }` or null | unit | `npx tsx --test apps/server/tests/unit/detect-claude.test.ts` | ❌ W0 | ⬜ pending |
| 21-02-04 | 02 | 2 | CLI-02, BACKEND-05 / PG2, PG9 | T-21-01 (bearer token in header, never query) | HTTP client attaches `Authorization: Bearer adt_…`, retries with backoff on 5xx, surfaces `{ discarded: true }` idempotency | unit | `npx tsx --test apps/server/tests/unit/daemon-http-client.test.ts` | ❌ W0 | ⬜ pending |

### Plan 21-03 — Claude backend + poll loop + cancel poller + main orchestrator (Wave 3)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-03-01 | 03 | 3 | BACKEND-04 / T2, PG7 | — | Stream batcher buffers `task_message` rows and flushes every 500 ms or on child exit; final flush never drops tail | unit | `npx tsx --test apps/server/tests/unit/stream-batcher.test.ts` | ❌ W0 | ⬜ pending |
| 21-03-02 | 03 | 3 | BACKEND-04, CLI-05 / A1, A4 | T-21-03 (auto-approval policy) | `control_request` → allow-listed tools auto-approved, others denied; every decision emits `type='thinking'` audit message | unit | `npx tsx --test apps/server/tests/unit/claude-control-request.test.ts` | ❌ W0 | ⬜ pending |
| 21-03-03 | 03 | 3 | BACKEND-06 / PM2, PM3, PM4 | — | `onUnhandledRejection` + `onUncaughtException` mark in-flight task failed over HTTP (best-effort), append to `~/.aquarium/daemon.crash.log`, exit 1 | unit | `npx tsx --test apps/server/tests/unit/daemon-crash-handler.test.ts` | ❌ W0 | ⬜ pending |
| 21-03-04 | 03 | 3 | CLI-06, BACKEND-05 / PG5, PG6 | — | Poll loop respects concurrency cap (semaphore), cancels polled tokens, exits cleanly on SIGTERM (flushes pending batches first) | unit | `npx tsx --test apps/server/tests/unit/poll-loop.test.ts` | ❌ W0 | ⬜ pending |

### Plan 21-04 — Integration harness + package wiring (Wave 4, CI-skipped)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-04-01 | 04 | 4 | BACKEND-07 / PG10 | — | `scripts.test:unit` in `apps/server/package.json` runs full unit suite; typecheck green | typecheck | `npm run typecheck -w @aquaclawai/aquarium && npm run test:unit -w @aquaclawai/aquarium` | ❌ W0 | ⬜ pending |
| 21-04-02 | 04 | 4 | SC-1..SC-5 | T-21-04 (end-to-end flow) | Fake `claude` stub emits scripted NDJSON; full claim→stream→complete cycle passes against localhost server | integration | `CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep @integration` | ❌ W0 | ⬜ pending |
| 21-04-03 | 04 | 4 | SC-3 | — | `pgrep -f claude` is empty 2 s after cancel (no zombie children) | integration | same as 21-04-02, asserts inside spec | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 scaffolding must land in Plan 21-01 (or earlier) so every downstream task has a failing test to turn green:

- [ ] `apps/server/tests/unit/` directory exists with `tsconfig.json` (extends server's; `include: ["**/*.test.ts"]`)
- [ ] `apps/server/tests/unit/fixtures/claude-stream-sample.ndjson` — minimal scripted NDJSON (5–10 lines: assistant text, tool_use, tool_result, control_request, result)
- [ ] `apps/server/tests/unit/fixtures/fake-claude.js` — Node script that echoes the fixture to stdout with configurable delays and exits 0 (reused in 21-04 integration)
- [ ] `apps/server/package.json` `scripts.test:unit` → `tsx --test apps/server/tests/unit/**/*.test.ts`
- [ ] `packages/shared/src/types.ts` extended with `AgentMessage` + `DaemonConfigFile` type stubs (TDD seed — real shapes land in 21-01-01)
- [ ] `tests/e2e/daemon-integration.spec.ts` stub with `test.skip` tag `@integration`, unskipped by 21-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx @aquaclawai/aquarium daemon start` on fresh macOS/Linux machine produces one `local_daemon` runtime row with `provider='claude'`, `status='online'` | SC-1 | Requires real `claude` CLI on PATH + real server; CI has neither | 1. Install `@anthropic-ai/claude-code`; 2. `npx @aquaclawai/aquarium daemon start`; 3. `curl localhost:3001/api/runtimes` shows `local_daemon` with version + `status='online'` |
| Full claim→stream→complete cycle against real `claude` CLI | SC-2 | Depends on Anthropic API quota + network | Create task targeting local_daemon; observe `task_message` rows at ~500 ms cadence in DB/UI; task completes with exit 0 |
| Windows posture acceptance | Research gate (a) | v1.4 accepts foreground-only best effort | Start daemon in foreground PowerShell; document in `daemon start --help`; closing terminal stops daemon (expected) |
| `control_request` wire format matches real Claude Code emission | A1, A4 | Reverse-engineered from community docs, not Anthropic-published | Run integration spec against real `claude`; verify allow-listed tool auto-approved, non-listed tool denied, audit message visible in issue timeline |

---

## Validation Sign-Off

- [ ] All 14 tasks have `<automated>` verify commands mapped above
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [ ] Wave 0 covers all MISSING references (fixture files, package.json script, shared types seed)
- [ ] No watch-mode flags (all commands one-shot; `tsx --test` exits on completion)
- [ ] Feedback latency < 20 s (unit suite target ~15 s)
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 ships

**Approval:** pending
