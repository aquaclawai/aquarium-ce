---
phase: 22
plan: 03
subsystem: daemon
tags: [opencode-backend, openclaw-backend, ndjson, backend-03, t-22-10, t-22-11, t-22-12, wave-3, shape-a-assumption]
one-liner: "OpenCode (`opencode run --format json <prompt>`) and OpenClaw (`openclaw agent -m <msg> --json --agent <id>`) NDJSON backends — 5-event OpenCode mapper (verified shape A2) + 5-event Shape-A OpenClaw mapper (assumption A3, single-point-of-update), T-22-11 no-session-flag regression, ALL_BACKENDS registry now 4 entries"
requires:
  - apps/server/src/daemon/backend.ts (Plan 22-01 — Backend / BackendRunDeps / BackendRunResult interfaces)
  - apps/server/src/daemon/backends/env.ts (Plan 22-01 — buildChildEnv + sanitizeCustomEnv; PM7/T-22-10)
  - apps/server/src/daemon/ndjson-parser.ts (Plan 21-01 — parseNdjson with inactivity watchdog and PG7/PG8/PG9/PG10 coverage)
  - apps/server/tests/unit/fixtures/opencode-stream-sample.ndjson (Plan 22-01 — 5-line fixture + 1 malformed tail for PG10)
  - apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson (Plan 22-01 — Shape A placeholder, 4 valid + 1 malformed)
  - packages/shared/src/v14-types.ts (AgentMessage union, ClaimedTask, RuntimeProvider)
provides:
  - opencodeBackend (apps/server/src/daemon/backends/opencode.ts) — Backend conforming export
  - spawnOpenCode, runOpenCodeTask, mapOpencodeEventToAgentMessage
  - detectOpencode (apps/server/src/daemon/backends/detect-opencode.ts) — PATH + fallbacks probe, no strict subcommand check
  - openclawBackend (apps/server/src/daemon/backends/openclaw.ts) — Backend conforming export
  - spawnOpenclaw, runOpenclawTask, mapOpenclawEventToAgentMessage
  - detectOpenclaw (apps/server/src/daemon/backends/detect-openclaw.ts) — PATH + fallbacks probe
  - ALL_BACKENDS registry — now 4 entries (claude, codex, opencode, openclaw); hermes slot reserved for Plan 22-04
affects:
  - apps/server/src/daemon/backends/index.ts (registry — opencodeBackend + openclawBackend appended; Plan 22-04 dispatch rewrite picks them up automatically)
  - apps/server/src/daemon/main.ts (no change — Plan 22-04 owns the dispatch switch)
tech-stack:
  added: []
  patterns:
    - One-shot NDJSON spawn (OpenCode + OpenClaw share the pattern): execa with `shell:false`, `detached` POSIX-only, `cancelSignal`, `forceKillAfterDelay`; stdin closed immediately because the prompt rides on argv (PM4).
    - Pure mapper + wire-adapter split, matching codex.ts — `mapOpencodeEventToAgentMessage` / `mapOpenclawEventToAgentMessage` are pure functions returning AgentMessage[]; a per-backend `toPendingTaskMessage(am, ctx)` adapter converts to PendingTaskMessageWire at the emission site.
    - T-22-11 ("no session-resume flags") regression: argv grep-tested to NEVER contain `-s` / `-c` / `--share`; opencode creates a fresh session per task so prior context cannot leak. Session resume is deferred to SESS-01 (v1.5).
    - Shape A assumption for OpenClaw: a single `mapOpenclawEventToAgentMessage` function narrows input with typed unions + type guards, returning `[]` for `done` (bookkeeping) and unknown `type` strings. Documented as "single point of update if a live capture reveals Shape B."
    - Fixture round-trip unit tests: pipe the exact `opencode-stream-sample.ndjson` / `openclaw-stream-sample.ndjson` body (including the deliberately malformed trailing line) through a PassThrough stdout and assert the ordered `PendingTaskMessageWire` sequence the wire layer would observe. PG10 carry-forward: the malformed line is silently dropped (parseNdjson per-line try/catch) and doesn't break the stream.
key-files:
  created:
    - apps/server/src/daemon/backends/opencode.ts
    - apps/server/src/daemon/backends/detect-opencode.ts
    - apps/server/src/daemon/backends/openclaw.ts
    - apps/server/src/daemon/backends/detect-openclaw.ts
    - apps/server/tests/unit/opencode-backend.test.ts
    - apps/server/tests/unit/openclaw-backend.test.ts
  modified:
    - apps/server/src/daemon/backends/index.ts
decisions:
  - "OpenCode argv — `['run', '--format', 'json', '--dir', workDir, ...customArgs, prompt]`: daemon-owned flags appear FIRST so operator `customArgs` (e.g. `--model`, `--agent`, `--thinking`) cannot override `--format json`. Prompt is the final positional argument per opencode CLI contract."
  - "OpenCode stdin closed immediately via `child.stdin?.end()` inside `runOpenCodeTask` (not `spawnOpenCode`). The spawn helper returns a `Subprocess` with a piped stdin (per PM1 safety contract); the orchestrator closes it because `opencode run` reads its prompt from argv, not stdin. Keeping stdin open would pin the child waiting for EOF."
  - "OpenClaw session argument: when `task.sessionId` is null (the v1.4 case) → `--agent <agent.id>` for per-agent session scoping; when `task.sessionId` is set (forward-compat for SESS-01 in v1.5) → `--session-id <id>` with no `--agent` flag. Both paths unit-tested."
  - "OpenClaw Shape A assumed (A3) — `{type: 'text'|'tool_use'|'tool_result'|'error'|'done', ...}` following OpenCode's discriminator. openclaw is NOT installed on the execution machine, so no live capture was possible. The fixture from Plan 22-01 drives the unit suite. Documented as a single-point-of-update: if a future execution captures Shape B, update `mapOpenclawEventToAgentMessage` AND `openclaw-stream-sample.ndjson` together — the Backend interface does not change."
  - "`mapOpenclawEventToAgentMessage` handles both string and object `error` payloads (`{type:'error', error:'msg'}` vs `{type:'error', error:{message:'msg'}}`) — the CLI docs don't pin the shape, so accepting both is cheap insurance against Shape-A drift."
  - "Unrecognised event `type` returns `[]` in both mappers (PG10 / T-22-12 mitigation). Paired with `parseNdjson`'s per-line try/catch drop, the stream is resilient to garbage and unknown event types introduced by future CLI releases."
  - "`detectOpencode` fallback order: `~/.opencode/bin/opencode` first (where research machine had it), then homebrew + /usr/local. `detectOpenclaw` fallback: homebrew first, then /usr/local, then `~/.openclaw/bin/openclaw`. Both use the same cross-platform `whichCrossPlatform` helper as `detect-codex`."
  - "No strict subcommand probe in either detect module — unlike codex (which rejects binaries lacking `app-server --help`), opencode and openclaw expose stable top-level entry points (`run` / `agent`) that every recent release ships. Adding a probe would risk false negatives on new versions without buying much; if a bad binary ships, the inactivity watchdog (BACKEND-06) catches the hang."
  - "`runOpenCodeTask` and `runOpenclawTask` accept the full `BackendRunDeps` interface directly (no internal adapter) — unlike claude.ts + codex.ts which wrap a legacy `runClaudeTask`/`runCodexTask` signature in a `runAs...AsBackend` shim. The wrappers were historical compatibility; 22-03 adopts `BackendRunDeps` natively since these backends have no existing consumers."
metrics:
  tasks_completed: 2
  tests_added: 30
  tests_passing_before: 268
  tests_passing_after: 298
  duration: ~7m
  date_completed: 2026-04-17
---

# Phase 22 Plan 03: OpenCode + OpenClaw Backends Summary

## What Shipped

- **detectOpencode** (`apps/server/src/daemon/backends/detect-opencode.ts`, 88 LOC): PATH probe via cross-platform `which`, then fallbacks `[~/.opencode/bin/opencode, /opt/homebrew/bin/opencode, /usr/local/bin/opencode]`. Each candidate runs `--version` (5 s timeout, `/(\d+\.\d+\.\d+)/` regex). Returns `null` on exhaustion; never throws (PG2 contract).

- **OpenCode backend** (`apps/server/src/daemon/backends/opencode.ts`, 322 LOC). Four exports:
  - `opencodeBackend: Backend` — provider `'opencode'`, detect via `detectOpencode`, run via `runOpenCodeTask`.
  - `spawnOpenCode(opts)` — execa spawn of `opencode run --format json [--dir <workDir>] [...customArgs] <prompt>` with `shell:false`, `detached` POSIX, `cancelSignal`, `forceKillAfterDelay`, env built via `buildChildEnv` (PM1/PM3/PM7/T-22-10). Argv grep-verified: includes `'run'`/`'--format'`/`'json'`; excludes `-s`/`-c`/`--share` (T-22-11).
  - `runOpenCodeTask(deps)` — the orchestrator. Closes child stdin immediately (prompt is on argv), consumes stdout via `parseNdjson`, maps each event via `mapOpencodeEventToAgentMessage`, emits every message to `deps.onAgentMessage`. Awaits child exit for the authoritative exit code + cancelled flag.
  - `mapOpencodeEventToAgentMessage(ev)` — pure function mapping:
    - `text` → `[{kind:'text', text: part.text}]`
    - `tool_use` → TWO messages: `tool_use` + `tool_result` (isError derived from `state.status !== 'completed'`; non-string `state.output` serialised via `JSON.stringify`)
    - `error` → `[{kind:'error', error: ev.error.data.message ?? 'opencode error'}]`
    - `step_start` / `step_finish` / unknown → `[]`

- **detectOpenclaw** (`apps/server/src/daemon/backends/detect-openclaw.ts`, 84 LOC): PATH probe + fallbacks `[/opt/homebrew/bin/openclaw, /usr/local/bin/openclaw, ~/.openclaw/bin/openclaw]`. Same version regex and PG2 contract as detect-opencode.

- **OpenClaw backend** (`apps/server/src/daemon/backends/openclaw.ts`, 308 LOC). Same four-export shape as OpenCode:
  - `openclawBackend: Backend` — provider `'openclaw'`.
  - `spawnOpenclaw(opts)` — execa spawn of `openclaw agent -m <prompt> --json [--session-id <sid> | --agent <agentId>] [...customArgs]`. Session arg resolution: `task.sessionId` set → `--session-id <id>` (forward-compat for SESS-01); else → `--agent <agent.id>` for per-agent session scoping.
  - `runOpenclawTask(deps)` — orchestrator mirroring `runOpenCodeTask`: closes stdin immediately, consumes stdout via `parseNdjson`, maps events, awaits child exit.
  - `mapOpenclawEventToAgentMessage(ev)` — Shape A mapper (ASSUMPTION A3):
    - `text` → `[{kind:'text', text}]`
    - `tool_use` → `[{kind:'tool_use', toolUseId, toolName, input}]` (single message — OpenClaw emits tool_use and tool_result as separate events, unlike OpenCode's merged shape)
    - `tool_result` → `[{kind:'tool_result', toolUseId, content, isError}]` (accepts both string and non-string content — non-string is `JSON.stringify`'d)
    - `error` → `[{kind:'error', error}]` — accepts both string error and `{message: string}` shapes
    - `done` / unknown → `[]` (bookkeeping / PG10)

- **Registry** (`apps/server/src/daemon/backends/index.ts`): `opencodeBackend` and `openclawBackend` appended to `ALL_BACKENDS` in order `[claude, codex, opencode, openclaw]`. Plan 22-04's `main.ts` dispatch rewrite picks these up automatically via the `Map<runtimeId, Backend>` construction.

- **Unit tests** — 30 new tests, all green:
  - **`opencode-backend.test.ts`** (433 LOC, 16 tests)
    - `mapOpencodeEventToAgentMessage` (8): text, tool_use completed (2-msg emit), tool_use failed (isError=true), tool_use non-string output (JSON.stringify), error happy path, error missing message (fallback), step_start/step_finish → [], unknown → [].
    - `detectOpencode` (2): happy path (PATH + version parse), miss.
    - `spawnOpenCode argv` (3): `['run','--format','json','--dir','/tmp',prompt]` when workDir set, `['run','--format','json',prompt]` when workDir null, T-22-11 regression (no `-s`/`-c`/`--share`).
    - `runOpenCodeTask` (3): stdin.end() called immediately, fixture round-trip (text → tool_use → tool_result → text, malformed dropped), cancelled=true on isCanceled.
  - **`openclaw-backend.test.ts`** (356 LOC, 14 tests)
    - `mapOpenclawEventToAgentMessage` (8): text, tool_use, tool_result (isError=false default), tool_result (isError preserved), error (string), error (object with .message), done → [], unknown → [].
    - `detectOpenclaw` (2): happy path, miss.
    - `spawnOpenclaw argv` (2): `['agent','-m',prompt,'--json','--agent',agentId]` default, `['agent','-m',prompt,'--json','--session-id',sessionId]` forward-compat.
    - `runOpenclawTask` (2): fixture round-trip (text → tool_use → tool_result, done + malformed dropped), cancelled=true on isCanceled.

## Verification

- `npm run build -w @aquarium/shared` — clean (no changes needed).
- `npm run typecheck -w @aquaclawai/aquarium` — clean.
- `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/opencode-backend.test.ts apps/server/tests/unit/openclaw-backend.test.ts` — 30/30 pass, 215 ms.
- `npm run test:unit -w @aquaclawai/aquarium` — 298/298 pass (up from 268; +30 new tests, no regression in any existing suite), 5.87 s.
- Grep aggregate: `grep -c "delete env.AQUARIUM_" apps/server/src/daemon/backends/*.ts` → 2 lines in env.ts + 2 in claude.ts (legacy re-export); opencode.ts and openclaw.ts both rely on `buildChildEnv` (no duplicate token-strip logic). Each new backend file contains ≥ 1 `buildChildEnv(` call (verified).
- `grep -cE "(claude|codex|opencode|openclaw)Backend" apps/server/src/daemon/backends/index.ts` → 8 (4 imports + 4 array entries); meets plan's `>= 8` criterion.
- No new npm dependencies — `git diff` on `package.json` / `apps/server/package.json` is empty.

## Key Decisions

1. **OpenCode argv ordering** — daemon-owned `['run', '--format', 'json', '--dir', workDir]` appears FIRST; operator `customArgs` are appended before the prompt positional. This means `customArgs` can supply additional flags (`--model`, `--agent`, `--thinking`) but cannot override `--format json` or the `--dir` path. The prompt is the mandatory last positional per opencode CLI contract.

2. **Fresh-session-per-task (T-22-11 mitigation)** — opencode argv NEVER contains `-s`, `-c`, or `--share`. Every `opencode run` invocation creates a new session; previous task context cannot leak across boundaries. Session resume is deferred to SESS-01 (v1.5). The regression is codified in a dedicated unit test (`spawnOpenCode argv DOES NOT contain session-resume flags`).

3. **OpenClaw session-arg resolution** — when `task.sessionId` is null (the v1.4 default), `--agent <agent.id>` is used so openclaw scopes by agent without persisting. When `task.sessionId` is set (a SESS-01 forward-compat path), `--session-id <id>` is used and `--agent` is omitted. Both branches are unit-tested.

4. **Shape A assumption for OpenClaw (A3)** — openclaw is NOT installed on this execution machine, so no live capture was possible. The research-assumed Shape A (OpenCode-like: text / tool_use / tool_result / error / done) drives the mapper and is verified against the Plan 22-01 placeholder fixture. If a future execution captures Shape B, the documented path is: update `mapOpenclawEventToAgentMessage` AND `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson` together. The `Backend` interface does not change. The assumption is flagged in the file header, the test file header, and in a unit-test comment.

5. **Error payload flexibility in OpenClaw mapper** — accepts both string and object error shapes (`error: 'msg'` vs `error: {message: 'msg'}`) because the docs don't pin the exact shape. Two dedicated unit tests cover both paths. Cheap insurance against Shape-A drift that costs nothing at runtime.

6. **No strict subcommand probe in detect modules** — unlike `detect-codex` which REJECTS binaries lacking `app-server --help`, `detect-opencode` and `detect-openclaw` accept any binary whose `--version` returns a parseable string. Reason: `opencode run` and `openclaw agent` are stable top-level entry points on every recent release; a probe would risk false negatives without buying much protection. If a bad binary ships, BACKEND-06's inactivity watchdog catches any hang.

7. **Native `BackendRunDeps` acceptance** — `runOpenCodeTask` and `runOpenclawTask` take `BackendRunDeps` directly (no internal adapter shim). Claude.ts and codex.ts wrap legacy `RunClaudeTaskDeps`/`RunCodexTaskDeps` signatures in a `runAs*AsBackend` adapter for back-compat; the new backends have no existing consumers so they adopt the uniform `BackendRunDeps` shape natively.

## Deviations from Plan

### Auto-fixed Issues

None. The plan executed exactly as written.

### OpenClaw Live-Capture Outcome

- **Attempted:** `which openclaw` — binary NOT present on the execution machine (Plan 22-03 `<action>` Step A fallback path).
- **Result:** No live-capture replacement of `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson`; the Plan 22-01 Shape-A placeholder fixture stands unchanged.
- **Assumption stance:** Proceeded with Shape A per the plan's documented fallback path. `mapOpenclawEventToAgentMessage` + fixture are the single point of update if a future execution captures Shape B. ASSUMPTION A3 is explicitly flagged in `openclaw.ts` file header, `openclaw-backend.test.ts` file header, and the fixture round-trip test comment.
- **No architectural impact:** The `Backend` interface (`provider`, `detect`, `run`) does not reference event shapes; Shape B adaptation would be a local edit inside `openclaw.ts` + `openclaw-stream-sample.ndjson`.

## Threat Flags

None. Both backends stay within the existing trust boundaries (daemon → NDJSON child; env via `buildChildEnv`; no new network endpoints or schema changes at trust boundaries). The new threat register entries in the plan's `<threat_model>` (T-22-10, T-22-11, T-22-12) are all mitigated inline and covered by unit tests.

## Self-Check

- [x] `apps/server/src/daemon/backends/opencode.ts` exists — FOUND
- [x] `apps/server/src/daemon/backends/openclaw.ts` exists — FOUND
- [x] `apps/server/src/daemon/backends/detect-opencode.ts` exists — FOUND
- [x] `apps/server/src/daemon/backends/detect-openclaw.ts` exists — FOUND
- [x] `apps/server/tests/unit/opencode-backend.test.ts` exists (433 LOC, 16 tests) — FOUND
- [x] `apps/server/tests/unit/openclaw-backend.test.ts` exists (356 LOC, 14 tests) — FOUND
- [x] `apps/server/src/daemon/backends/index.ts` registers 4 backends (grep count 8 matches `(claude|codex|opencode|openclaw)Backend`) — FOUND
- [x] Commits `899634f`, `3ed5de2`, `2800cc7`, `d4a502a` present — FOUND
- [x] `npm run typecheck -w @aquaclawai/aquarium` — PASS
- [x] `npm run test:unit -w @aquaclawai/aquarium` — 298/298 PASS

## Self-Check: PASSED
