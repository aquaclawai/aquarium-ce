# Phase 21: Daemon CLI + Claude-Code Backend + Unit Harness — Research

**Researched:** 2026-04-17
**Domain:** Node.js daemon CLI (commander subcommand) + child-process spawn + NDJSON stream-json parsing + bounded concurrency + `node:test` unit harness over existing Phase 19 daemon REST contract.
**Confidence:** HIGH (codebase verified, npm versions verified, multica reference verified, Claude Code control protocol verified via official docs + community reverse-engineering)
**Research gate (from ROADMAP):** NEEDS RESEARCH — (a) Windows daemon background-process strategy; (b) Claude Code `control_request` / `control_response` auto-approval posture.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | `npx @aquaclawai/aquarium daemon start` auto-detects `claude`/`codex`/`openclaw`/`opencode`/`hermes` on PATH and registers each as a runtime | §CLI Entry-Point + §Auto-Detecting `claude` CLI |
| CLI-02 | `aquarium daemon` subcommands (`start`, `stop`, `status`, `token`) via commander with `--server`/`--token`/`--device-name` options | §CLI Entry-Point (commander 14.0.3) |
| CLI-03 | Daemon reads config from `~/.aquarium/daemon.json`; CLI flags > env > file | §Daemon Config Resolution |
| CLI-04 | Claim loop uses a bounded concurrency semaphore (default 10) | §Bounded Semaphore |
| CLI-05 | Unhandled rejection/exception marks in-flight tasks failed, writes `~/.aquarium/daemon.crash.log`, exits cleanly | §Crash Handling & Graceful Death |
| CLI-06 | Server-side cancellation detected within 5 s via polling `/api/daemon/tasks/:id/status`; propagates via AbortSignal | §Cancel-Propagation Loop |
| BACKEND-01 | Claude backend spawns `claude --output-format stream-json` and emits unified `AgentMessage{text\|thinking\|tool_use\|tool_result\|error}` | §NDJSON Stream-JSON Parser + §Claude Backend Spawn |
| BACKEND-04 | Child killed via SIGTERM → SIGKILL escalation (10 s grace), process-group kill | §Kill Escalation |
| BACKEND-05 | Daemon prepends its own binary dir to PATH so child resolves `aquarium` | §PATH Inheritance (PM3) |
| BACKEND-06 | Stream-json parsers use `node:readline` (`crlfDelay: Infinity`, `setEncoding('utf8')`) + 60 s inactivity watchdog | §NDJSON Stream-JSON Parser |
| BACKEND-07 | Unit tests under `apps/server/tests/unit/` cover stream-json parsing, kill escalation, bounded semaphore via `node --test` | §Unit Harness (Validation Architecture) |

## Summary

Phase 21 ships the first external runtime: a Node.js daemon that lives inside the same `@aquaclawai/aquarium` npm package, launched via a new `aquarium daemon start` subcommand. It dials back into Phase 19's `/api/daemon/*` REST surface, advertises itself as a `local_daemon` runtime with `provider='claude'`, and executes claimed tasks by spawning the user's installed `claude` CLI with `--output-format stream-json` and streaming NDJSON back into the server as `task_message` rows.

Everything the daemon NEEDS on the server side is already shipped (Phase 15–20): the `daemon_tokens` table, the 10 daemon REST endpoints with per-token rate-limit bucket and plaintext-once token issuance, the 500 ms `task-message-batcher` with monotonic `seq`, the stale-task reaper, the `isTaskCancelled` poll endpoint, and the `{ discarded: true }` TASK-06 idempotency contract for complete/fail-of-cancelled. Phase 21 is the first external consumer of this surface; the engineering problem is entirely on the daemon side. [VERIFIED: `apps/server/src/routes/daemon.ts`, `apps/server/src/services/task-queue-store.ts`, `apps/server/src/services/daemon-token-store.ts`]

The engineering shape splits cleanly into seven small, test-reachable modules: (1) `cli.ts` gains a commander subcommand dispatch BEFORE any server-module import; (2) a `daemon/` directory ships the config resolver, HTTP client, auto-detect routine, poll loop, dispatcher, backend registry, and lifecycle orchestrator; (3) a `daemon/backends/claude.ts` owns spawn + NDJSON parse + control_request handling; (4) three reusable primitives (`semaphore.ts`, `kill-escalation.ts`, `ndjson-parser.ts`) live under `daemon/` so unit tests can exercise them in isolation. All four HARD pitfalls (PG1, PG2, PG5, PG7, PG8, PM1) gate on these primitives; every primitive has a named unit test.

Two open research questions are settled in this document:

- **(a) Windows daemon posture for v1.4:** Accept **foreground-only / best-effort** on Windows. The daemon starts as a normal foreground Node process on Windows; users who want a background service can wrap it with `nssm`/`sc create` themselves. Document in `aquarium daemon start --help` and in `aquarium daemon start` stdout. Rationale: a clean Node-native Windows-service story requires `node-windows`/`nssm`/a launcher binary (all introduce build complexity or a secondary install path), and the user base for v1.4 is overwhelmingly macOS/Linux. Deferred gracefully to v1.5+.
- **(b) Claude Code `control_request` auto-approval posture:** Auto-approve all tool-use approval requests by default, with an optional configurable allow-list (`daemonConfig.tools.allow`) that restricts which tool names may be approved. All auto-approval decisions are logged as `task_message` rows with `type='thinking'` and `content='[auto-approve] tool=<name>'` so they appear in the issue timeline for audit. For v1.4 default, `allow='*'` (approve everything). Users who want deny-by-default can set `allow=[...]`. The alternative (`--permission-mode bypassPermissions` flag from multica) is also acceptable but leaves no audit trail. [CITED: code.claude.com/docs/en/permissions, multica `claude.go:101-104, 254-265`]

**Primary recommendation:** Do NOT add `@anthropic-ai/claude-agent-sdk`, `split2`, `ndjson`, `p-limit`, `nanoid`, or `zod`. Add exactly **two** new npm dependencies: `execa@9.6.1` (battle-tested subprocess wrapper with clean `forceKillAfterTimeout`) and `commander@14.0.3` (subcommand dispatch). The rest is `node:crypto` + `node:readline` + hand-rolled semaphore. This matches the explicit STACK.md recommendations and keeps the unit-test story tight (handwritten primitives = testable primitives).

## User Constraints

No CONTEXT.md file exists for Phase 21. The ROADMAP Phase 21 block, the REQUIREMENTS.md CLI-01..06 + BACKEND-01, BACKEND-04..07 rows, and the Phase 21 owned pitfalls (PG1–PG10, PM1–PM4, T1–T2) constitute the constraint set. All are reproduced verbatim where used below.

## Project Constraints (from CLAUDE.md)

- **ESM `.js` extension mandatory** in all new server `.ts` imports. Every new daemon file (`apps/server/src/daemon/*.ts`) adds `.js` extensions: `import { spawnClaude } from './backends/claude.js'`. [CITED: CLAUDE.md lines 105–112]
- **No `any`, no `@ts-ignore`, no `@ts-expect-error`.** Stream-json message types are a discriminated union over `type`. The `unknown` → parsed-message boundary uses type guards, never `as any`. [CITED: CLAUDE.md §Code Style]
- **Routes → Services → Runtime/DB.** Daemon CLI lives adjacent to the server code but never imports routes or instantiates the Express app — the CLI subcommand dispatch BRANCHES at `cli.ts` so the daemon process does NOT boot the HTTP server. [CITED: apps/server/src/AGENTS.md]
- **Config only in `config.ts`** — but the daemon runs in a DIFFERENT process than the server. The daemon has its OWN config loader (`daemon/config.ts`) that reads `~/.aquarium/daemon.json` + env + CLI flags. This is an intentional, documented fork from the server's `config.ts` pattern — they don't share a process.
- **Knex parameterized queries only.** Daemon does NOT touch the DB directly; it calls HTTP endpoints. The DB-discipline rule applies on the server side only.
- **Never update `instances.status` directly.** N/A — Phase 21 is daemon code, no instance-manager surface.
- **Files kebab-case for server `.ts`.** `daemon/poll-loop.ts`, `daemon/backends/claude.ts`, `daemon/semaphore.ts`. [CITED: CLAUDE.md §Naming]
- **`npx tsx --test` via `node:test` is the server unit-test framework** (confirmed by the existing README: `apps/server/tests/unit/README.md`). Phase 21 adds unit files to the same directory with the same conventions (throwaway SQLite via `test-db.ts`, `NODE_OPTIONS=--no-experimental-require-module`).
- **Every bug fix needs a regression test** (user-global CLAUDE.md). Phase 21 establishes unit tests for the primitives precisely because subsequent bug-fixes MUST have test coverage — BACKEND-07 is the enabler.
- **Build shared first.** `packages/shared` must be built before server typecheck. Any new shared types (`AgentMessage`, `DaemonConfig`, `BackendSpec`) land in `packages/shared/src/v14-types.ts` and get built first. [CITED: CLAUDE.md §Common Pitfalls]

## Standard Stack

### Core additions (two new npm deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `execa` | `9.6.1` | Subprocess spawn + `forceKillAfterTimeout` + ESM-native typed API | Used by pnpm, Turbo, tsx, lint-staged, AVA. Saves ~40 LOC of `node:child_process` boilerplate per backend. `forceKillAfterTimeout` implements SIGTERM→SIGKILL-10s exactly — PM1 mitigation [VERIFIED: `npm view execa version` → 9.6.1] |
| `commander` | `14.0.3` | Subcommand dispatch (`aquarium daemon start/stop/status/token`) + typed options | Smallest surface of the big-3 CLI libs (commander/yargs/oclif); ESM + CJS dual-module; TypeScript types. Replaces the hand-rolled `getFlag()` parser cleanly. [VERIFIED: `npm view commander version` → 14.0.3] |

### Supporting (already installed — zero additions)

| Library | Version | Purpose | When Used |
|---------|---------|---------|-----------|
| `node:readline` | built-in (Node 22+) | NDJSON line framing via `createInterface({ input, crlfDelay: Infinity }) + for await` | Claude stream-json parser, Codex JSON-RPC parser [VERIFIED: Node 22 docs] |
| `node:test` + `node:assert/strict` | built-in | Unit-test framework (via `tsx --test`) | BACKEND-07 coverage. Matches Phase 18/19 existing test suite. [VERIFIED: `apps/server/tests/unit/README.md`] |
| `node:crypto` | built-in | `randomUUID()` for daemonId / idempotency keys | Daemon startup + task claim fingerprinting |
| `tsx` | `4.19+` (already devDep) | Runs the daemon directly in dev; runs unit tests | Daemon dev UX + test runner [VERIFIED: `apps/server/package.json:51`] |
| `@aquarium/shared` | workspace | `DaemonRegisterRequest`, `ClaimedTask`, `TaskMessageType`, new `AgentMessage` union (added this phase) | Wire-type source of truth [VERIFIED: `packages/shared/src/v14-types.ts`] |

### Alternatives Considered (REJECTED)

| Instead of | Could Use | Why NOT |
|------------|-----------|---------|
| `execa` | Raw `node:child_process.spawn` | 5× boilerplate per backend; reimplementing SIGTERM-grace is where PM1 bugs live. [CITED: STACK.md §1] |
| `commander` | Extend hand-rolled `getFlag()` | Subcommand dispatch + `--help` generation + typed option validation is exactly what commander provides for 60 KB. [CITED: STACK.md §3] |
| Handwritten semaphore | `p-limit@5.0.0` | BACKEND-07 explicitly mandates unit tests for `acquire`/`release` ordering. A handwritten semaphore is 25 LOC + ~5 unit tests. `p-limit` is a black box to our tests and we lose visibility into the invariants we care about (FIFO acquire, release-wakeup-order). [CITED: PG1 HARD + BACKEND-07] |
| `@anthropic-ai/claude-agent-sdk@0.2.110` | Wire Claude the "official" way | SDK calls the Anthropic API directly, bypassing the user's installed `claude` CLI auth. Breaks the "use your installed CLI's auth" premise of the daemon. Explicitly flagged Out of Scope in REQUIREMENTS.md line 198. |
| `split2` / `ndjson` | Custom line buffering | `node:readline` already handles CRLF + `setEncoding('utf8')` + backpressure via `for await`. Adding a CJS-only lib for zero gain. [CITED: STACK.md §1] |
| `nanoid` | Token generation | Tokens are already minted server-side via `daemon-token-store.generateDaemonTokenPlaintext()` (Phase 19-01 — `randomBytes(24).toString('base64url')`). The daemon NEVER generates tokens; it reads one from config. |
| `zod` | NDJSON message validation | Existing codebase uses hand-written type guards + optional `ajv` for config-patch validation. Adding zod for one phase violates the "one validator lib" principle and costs 12 KB gzipped. |
| `node-windows` / `nssm` wrapper | Native Windows service | Adds a mandatory post-install step for an OS that represents a minority of the v1.4 target audience. Document foreground-only as a known limitation; users who want autostart can wrap with `nssm`/`sc create` themselves. (Settled research gate (a).) |

### Installation

```bash
# From apps/server (npm workspaces propagates the dep)
npm install -w @aquaclawai/aquarium execa@9.6.1 commander@14.0.3
```

**Version verification (performed 2026-04-17):**
```bash
$ npm view execa version       → 9.6.1       [VERIFIED 2026-04-17]
$ npm view commander version   → 14.0.3      [VERIFIED 2026-04-17]
```

## CLI Entry-Point Shape

**Settled:** the existing `cli.ts` gains commander-based subcommand dispatch. The daemon subcommand is a separate code path that does NOT boot the HTTP server. The default command (no subcommand) preserves today's behaviour (`aquarium --port 3001 --open`).

### File shape

Today's `apps/server/src/cli.ts` (89 lines) is a two-phase script: (1) parse flags → set `process.env.*`; (2) `await import('./index.ce.js')` triggers the server. The Phase-21 rewrite keeps both phases for the default command and adds a second branch.

```typescript
// apps/server/src/cli.ts (Phase 21 rewrite — conceptual)
import { Command } from 'commander';
const program = new Command();

program.name('aquarium').version(readPackageVersion());

// DEFAULT COMMAND (today's behaviour — starts the server)
program
  .option('--port <p>', 'server port', '3001')
  .option('--data-dir <path>', 'data directory')
  .option('--host <h>', 'bind host')
  .option('--open', 'open browser')
  .action(async (opts) => {
    // Phase 1: parse + set env (identical to today's lines 27-50)
    // Phase 2: `await import('./index.ce.js')` (today's line 76)
  });

// DAEMON SUBCOMMAND (new)
program
  .command('daemon')
  .description('External daemon — connects to an Aquarium server and claims tasks')
  .addCommand(new Command('start')
    .option('--server <url>', 'server URL (default: reads daemon.json)')
    .option('--token <t>', 'daemon token (default: reads daemon.json)')
    .option('--device-name <n>', 'device label')
    .option('--data-dir <path>', '~/.aquarium override')
    .action(async (opts) => {
      // NO import of ./index.ce.js — daemon does NOT boot the server.
      const { startDaemon } = await import('./daemon/main.js');
      await startDaemon(opts);
    }))
  .addCommand(new Command('stop').action(async () => { /* PID-file kill */ }))
  .addCommand(new Command('status').action(async () => { /* PID-file + HTTP ping */ }))
  .addCommand(new Command('token')
    .addCommand(new Command('list').action(...))
    .addCommand(new Command('revoke <id>').action(...)));
    // `token issue` intentionally absent at CLI level — tokens are minted via the web UI
    // (Phase 19-03 POST /api/daemon-tokens). The CLI can't mint without cookie auth.

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

**Key invariant:** the `daemon` subcommand MUST NOT transitively import `./index.ce.js`, `./server-core.js`, or any `./db/index.js`. This is because (a) the daemon is a separate process that connects to a remote server, (b) importing the server singleton would try to open `~/.aquarium/aquarium.db` which the daemon has no business touching, and (c) a stray import would bind the daemon to DB migration state it doesn't need. Enforce with an acceptance-check grep in the plan: `grep -c "from '.*index.ce\\|from '.*server-core\\|from '.*db/index" apps/server/src/daemon/main.ts` must return 0.

**Source:** [VERIFIED: existing `apps/server/src/cli.ts` lines 1-89 + STACK.md §3 commander 14.0.3 migration path]

## Daemon Config Resolution (CLI-03)

**Precedence (highest wins):**

1. CLI flags (`--server`, `--token`, `--device-name`, `--max-concurrent-tasks`, `--data-dir`, `--log-level`, `--foreground`)
2. Environment variables (`AQUARIUM_DAEMON_SERVER`, `AQUARIUM_DAEMON_TOKEN`, `AQUARIUM_DAEMON_DEVICE_NAME`, `AQUARIUM_DAEMON_MAX_CONCURRENT_TASKS`, `AQUARIUM_DATA_DIR`, `AQUARIUM_DAEMON_LOG_LEVEL`)
3. Config file `~/.aquarium/daemon.json` (or `$AQUARIUM_DATA_DIR/daemon.json`)
4. Built-in defaults

### `~/.aquarium/daemon.json` schema

```typescript
// packages/shared/src/v14-types.ts — append this
export interface DaemonConfigFile {
  server?: string;                                // e.g. "http://localhost:3001"
  token?: string;                                 // e.g. "adt_abc123..."
  deviceName?: string;                            // e.g. "shuai-mbp"
  maxConcurrentTasks?: number;                    // 1..16; default 10
  pollIntervalMs?: number;                        // default 2_000 (matches HOSTED-01)
  heartbeatIntervalMs?: number;                   // default 15_000
  cancelPollIntervalMs?: number;                  // default 5_000 (CLI-06 budget)
  messageFlushIntervalMs?: number;                // default 500 (matches TASK-03)
  inactivityKillMs?: number;                      // default 60_000 (BACKEND-06 watchdog)
  gracefulKillMs?: number;                        // default 10_000 (BACKEND-04 PM1)
  logLevel?: 'debug'|'info'|'warn'|'error';       // default 'info'
  backends?: Record<string, { allow?: string[] }>;// e.g. { claude: { allow: ['Read','Edit','Bash'] } }
}
```

**`DaemonConfig`** (resolved object handed to every module): same fields but all required after resolution.

### Built-in defaults

| Field | Default | Source |
|-------|---------|--------|
| `server` | `http://localhost:3001` | assumption (user runs server locally) |
| `token` | — (ERROR — no default) | must be set; daemon exits with `aquarium-daemon: no token — mint one in the web UI (Daemon Tokens) and save to ~/.aquarium/daemon.json, or pass --token` |
| `deviceName` | `os.hostname()` | Node.js `os` module |
| `maxConcurrentTasks` | `10` | CLI-04 default |
| `pollIntervalMs` | `2000` | Matches HOSTED-01 hosted worker tick rate |
| `heartbeatIntervalMs` | `15000` | Server-side offline sweep at 90 s (Phase 16 offline-sweeper); 15 s gives 6× margin |
| `cancelPollIntervalMs` | `5000` | CLI-06 says "within 5 s" — poll every 5 s hits p99 ~5 s, p50 ~2.5 s |
| `messageFlushIntervalMs` | `500` | Matches Phase 18 server-side batcher (TASK-03) |
| `inactivityKillMs` | `60000` | BACKEND-06 literal |
| `gracefulKillMs` | `10000` | BACKEND-04 literal; matches multica `cmd.WaitDelay = 10 * time.Second` |
| `logLevel` | `'info'` | — |
| `backends` | `{ claude: { allow: ['*'] } }` | Research-gate (b) default: auto-approve all |

**Implementation hint:** a tiny `loadDaemonConfig(cliOpts): Promise<DaemonConfig>` in `daemon/config.ts`. Reads the file if present, overlays env vars, overlays CLI opts; validates required fields (`token`); exits with a helpful error when a required field is missing.

**Config-file creation flow:** On first launch, if no config file exists, the daemon writes a starter file:
```json
{ "server": "http://localhost:3001", "token": "" }
```
…and prints `Created ~/.aquarium/daemon.json. Add your token (web UI → Daemon Tokens → Create) and re-run.` Exit code 0. (Don't crash on first-run UX.)

### Workspace scoping

The daemon does NOT need to know its workspace — the token embeds it (Phase 19-01: `req.daemonAuth.workspaceId` is derived from the DB row). The daemon just passes its token; the server routes everything to that workspace.

**Source:** [VERIFIED: Phase 19-01 `daemon-auth.ts` + `daemon-token-store.ts` — `token_hash → workspace_id` is the sole linkage]

## Task Claim Protocol (server endpoints — what the daemon calls)

The server-side surface is 100% shipped in Phase 19. The daemon is just an HTTP client. This section is a one-stop reference so the planner can wire straight in.

### Server endpoints the daemon uses

[VERIFIED against `apps/server/src/routes/daemon.ts` — all endpoints present and tested by Phase 19-04 E2E.]

| # | Method | Path | Request body | Response body | Daemon calls this on… |
|---|--------|------|--------------|---------------|----------------------|
| 1 | POST | `/api/daemon/register` | `DaemonRegisterRequest` | `{ ok: true, data: { runtimes: Runtime[] } }` | Startup (after CLI auto-detection) |
| 2 | POST | `/api/daemon/heartbeat` | `{ runtimeIds: string[] }` | `{ ok: true, data: { pendingPings, pendingUpdates } }` | Every 15 s (DaemonConfig.heartbeatIntervalMs) |
| 3 | POST | `/api/daemon/deregister` | `{ runtimeIds: string[] }` | `{ ok: true, data: { ok: true } }` | Graceful shutdown (SIGTERM received) |
| 4 | POST | `/api/daemon/runtimes/:id/tasks/claim` | (empty) | `{ ok: true, data: { task: ClaimedTask\|null } }` | Every 2 s per runtime (DaemonConfig.pollIntervalMs); only if semaphore has capacity |
| 5 | POST | `/api/daemon/tasks/:id/start` | (empty) | `{ ok: true, data: { started, status } }` | Immediately after successful claim, before spawning child |
| 6 | POST | `/api/daemon/tasks/:id/progress` | `{ progress?, note? }` | `{ ok: true, data: { ok: true } }` | Not used in v1.4 by the Claude backend (optional for other backends that can report %). |
| 7 | POST | `/api/daemon/tasks/:id/messages` | `{ messages: PendingTaskMessage[] }` (max 100 items / 64 KB) | `{ ok: true, data: { accepted } }` | Every 500 ms flush (DaemonConfig.messageFlushIntervalMs) |
| 8 | POST | `/api/daemon/tasks/:id/complete` | `{ result? }` | `{ ok: true, data: TerminalResult }` (200 even when `discarded: true`) | Child exits successfully |
| 9 | POST | `/api/daemon/tasks/:id/fail` | `{ error? }` | `{ ok: true, data: TerminalResult }` | Child exits with error OR spawn fails |
| 10 | GET | `/api/daemon/tasks/:id/status` | — | `{ ok: true, data: { status, cancelled } }` | Every 5 s per in-flight task (CLI-06 cancel detection) |

### Auth shape

Every request MUST carry `Authorization: Bearer adt_<32>`. No cookie. No other header. The token comes from `~/.aquarium/daemon.json` → env → CLI flag (CLI-03 precedence).

### Idempotency & discarded semantics

Phase 18 / Phase 19 already implement `{ discarded: true, status: 'cancelled' }` on complete/fail of an already-cancelled task. The daemon's response handler MUST treat `discarded: true` as a success (log + move on — do NOT retry or mark the daemon-local record as failed). [VERIFIED: `apps/server/src/services/task-queue-store.ts:626`, `apps/server/src/routes/daemon.ts:340-351`, `.planning/research/PITFALLS.md §PM5`]

### Messages endpoint payload shape

`PendingTaskMessage` (the server-side type the batcher ingests) is:

```typescript
// apps/server/src/task-dispatch/task-message-batcher.ts:37
export interface PendingTaskMessage {
  type: TaskMessageType;          // 'text'|'thinking'|'tool_use'|'tool_result'|'error'
  tool: string | null;
  content: string | null;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  workspaceId: string;            // daemon passes this; route validates
  issueId: string;                // daemon passes this; route re-reads via task lookup (defence-in-depth)
}
```

Daemon fills `workspaceId` from `DaemonConfig` and `issueId` from the `ClaimedTask.issue.id` returned by `/tasks/claim`. One batch per 500 ms, max 100 items OR 64 KB per call (413 on overflow).

### Source file references (planner: wire straight in)

- `apps/server/src/routes/daemon.ts` — all 10 endpoints
- `apps/server/src/middleware/daemon-auth.ts` — bearer parsing
- `apps/server/src/services/task-queue-store.ts` — `claimTask`/`startTask`/`completeTask`/`failTask`/`isTaskCancelled`
- `apps/server/src/task-dispatch/task-message-batcher.ts` — `appendTaskMessage`, `PendingTaskMessage` type
- `apps/server/src/services/runtime-registry.ts` — `upsertDaemonRuntime`, `updateHeartbeat`, `setRuntimeOffline`
- `packages/shared/src/v14-types.ts` — `DaemonRegisterRequest`, `ClaimedTask`, `Runtime`, `RuntimeProvider`

## NDJSON Stream-JSON Parser (BACKEND-06)

**Recommended approach:** `node:readline` + `for await` over `child.stdout` with explicit `setEncoding('utf8')` and `crlfDelay: Infinity` + per-line `try { JSON.parse } catch { continue + counter }` + a module-local 60 s inactivity watchdog that escalates to kill.

### Exact implementation skeleton

```typescript
// apps/server/src/daemon/ndjson-parser.ts
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export interface NdjsonParseResult<T> {
  messages: AsyncIterable<T>;     // yielded per-line after JSON.parse
  stats: {
    linesProcessed: number;
    parseErrors: number;
    bytesProcessed: number;
  };
}

export async function* parseNdjson<T = unknown>(
  stream: Readable,
  opts?: {
    isValid?: (msg: unknown) => msg is T;   // optional narrowing
    onParseError?: (line: string, err: Error) => void;
    inactivityMs?: number;                  // default 60_000 (BACKEND-06)
    onInactive?: () => void;                // fired when no line for inactivityMs (host fires kill)
  },
): AsyncGenerator<T, void, void> {
  stream.setEncoding('utf8');                                 // PG9 mitigation
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // Inactivity watchdog — reset on every line.
  let watchdog: NodeJS.Timeout | null = null;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    if (opts?.inactivityMs && opts.inactivityMs > 0) {
      watchdog = setTimeout(() => opts.onInactive?.(), opts.inactivityMs);
      watchdog.unref();
    }
  };
  resetWatchdog();

  try {
    for await (const line of rl) {                            // PG7 mandatory pattern
      resetWatchdog();
      const trimmed = line.trim();
      if (!trimmed) continue;                                 // empty line → skip
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);                         // PG10 per-line try/catch
      } catch (err) {
        opts?.onParseError?.(trimmed, err as Error);
        continue;                                             // skip, do not propagate (mirrors multica's `if err { continue }`)
      }
      if (opts?.isValid && !opts.isValid(parsed)) continue;   // optional schema guard
      yield parsed as T;
    }
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}
```

### Why this exact shape

- **PG7 (readline async-iter — HARD):** `for await (const line of rl)` preserves ordering and backpressure. Never use `rl.on('line', asyncHandler)`. [CITED: PITFALLS.md PG7]
- **PG8 (stdout backpressure — HARD):** `for await` naturally backpressures the child; we always consume to completion. The inactivity watchdog catches the "abandoned pipe" case. [CITED: PITFALLS.md PG8]
- **PG9 (UTF-8 boundaries):** `stream.setEncoding('utf8')` attaches a stateful decoder. Multi-byte chars split across chunks are handled correctly. Unit test: emoji round-trip. [CITED: PITFALLS.md PG9]
- **PG10 (partial lines):** Per-line `try { JSON.parse } catch { continue }` matches multica's Go pattern. Counter feeds `opts.onParseError` so the daemon can log a WARN on drift. [CITED: PITFALLS.md PG10, multica `claude.go:111`]
- **BACKEND-06 60 s watchdog:** `setTimeout` reset on every line; on fire, caller invokes kill-escalation. `.unref()` so the watchdog itself doesn't hold the event loop.
- **No `split2`/`ndjson` dep:** `node:readline` covers all of the above natively. [CITED: STACK.md §1]

### Unit tests (BACKEND-07)

- Happy path: feed 3 well-formed lines → yield 3 parsed objects, parseErrors=0.
- Malformed middle line: 3 lines, middle is `{"type":"assist` → yields 2, parseErrors=1, no throw.
- Emoji tool name: line contains `"name":"🔍Search"` → parsed intact (PG9).
- Empty-line handling: `"\n\n{...}\n\n"` → yields 1, no extra iterations.
- Inactivity watchdog: no line for 1.2s with `inactivityMs=1000` → `onInactive` called exactly once.
- Stream close: stream emits `end` → iterator resolves cleanly, watchdog cleared.
- CRLF: line ends with `\r\n` → parsed correctly (crlfDelay: Infinity).

**Source:** [VERIFIED against Node 22 `readline` docs + multica `claude.go:101-148`]

## Claude Code Backend (BACKEND-01)

### Spawn arguments (verified from multica + official docs)

```typescript
// apps/server/src/daemon/backends/claude.ts
import { execa } from 'execa';

export function spawnClaude(opts: {
  prompt: string;
  workDir: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  claudePath: string;     // resolved by detectClaude()
  abortSignal: AbortSignal;
  gracefulKillMs: number; // 10_000
}) {
  const env = {
    ...process.env,
    // PM3 HARD — prepend daemon binary dir to PATH so spawned claude can call `aquarium ...`
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''),
    // Merge agent.customEnv LAST (so it can override for testing) but BLOCK
    // PATH / AQUARIUM_* overrides to prevent user-shadowed credentials (AUTH5 + PM7).
    ...sanitizeCustomEnv(opts.customEnv),
  };

  return execa(opts.claudePath, [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',                       // required for stream-json to emit non-terminal frames
    '--permission-prompt-tool', 'stdio', // enables control_request/control_response handshake
    ...opts.customArgs,                // agent.custom_args pass-through (last)
  ], {
    cwd: opts.workDir ?? process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,                      // PM1 HARD — never true
    detached: process.platform !== 'win32',  // PM1 — enables process-group kill on POSIX
    cancelSignal: opts.abortSignal,    // execa 9 threads signal into the child
    forceKillAfterDelay: opts.gracefulKillMs, // SIGTERM → SIGKILL after 10 s (PM1)
  });
}
```

**Decisions locked above:**

1. **Use `--permission-prompt-tool stdio`** (NOT `--permission-mode bypassPermissions`). This preserves the control_request/control_response handshake so every tool use is logged in the issue timeline. multica uses `--permission-mode bypassPermissions` to skip the handshake entirely; we choose the audited path for v1.4. [CITED: code.claude.com/docs/en/permissions, STACK.md §1]
2. **`shell: false`**: PM1 HARD. Kill-escalation doesn't work against a shell wrapper. [CITED: PITFALLS.md PM1]
3. **`detached: true` on POSIX**: allows `process.kill(-pid, signal)` to kill the whole process group — catches grandchildren spawned by Claude (e.g., its Node helper processes). On Windows, `detached: false` (default) because Windows has no process groups — use `taskkill /F /T /PID` via execa's `forceKillAfterDelay` path. [CITED: PITFALLS.md PM1]
4. **`cancelSignal` + `forceKillAfterDelay`**: execa 9's native PM1-mitigation API — threads AbortSignal to the child and escalates SIGTERM→SIGKILL after the delay. Replaces the entire `killWithEscalation` helper multica hand-rolls. [VERIFIED: execa 9.6.1 docs]
5. **PATH prepend (BACKEND-05 / PM3 HARD)**: `path.dirname(process.execPath)` is where `node` lives; in an npx install, `aquarium` is a sibling bin there. Adding a `--bin-override` escape hatch lets CI tests inject a mock. [CITED: PITFALLS.md PM3]
6. **No `AQUARIUM_TOKEN` passed to child** in v1.4. AUTH5 owns this decision for a future phase — today the Claude backend doesn't call back to Aquarium from inside itself.

### Prompt construction (stdin JSON message)

Claude stream-json input format expects one JSON-per-line message. For a single-turn task:

```typescript
// Write exactly one user message, then close stdin (PM4 HARD).
const userMessage = {
  type: 'user',
  message: { role: 'user', content: opts.prompt },
};
child.stdin!.write(JSON.stringify(userMessage) + '\n');
child.stdin!.end();                   // PM4 — forgetting this hangs forever
```

### Output parsing (stream-json → AgentMessage)

The NDJSON parser yields `ClaudeStreamMessage` objects with 6 top-level `type` values: `system` | `assistant` | `user` | `result` | `log` | `control_request`. Phase 21 translates the subset that produces user-visible content into the shared `AgentMessage` union:

```typescript
// packages/shared/src/v14-types.ts — append this
export type AgentMessage =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | { kind: 'tool_use'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'error'; error: string };
```

**Mapping rules (BACKEND-01):**

| Claude `type` / content block | `AgentMessage` kind | `PendingTaskMessage` shape |
|-------------------------------|---------------------|---------------------------|
| `type: 'assistant'` with `content[{type:'text', text}]` | `text` | `type='text'`, `content=text` |
| `type: 'assistant'` with `content[{type:'thinking', thinking}]` | `thinking` | `type='thinking'`, `content=thinking` |
| `type: 'assistant'` with `content[{type:'tool_use', id, name, input}]` | `tool_use` | `type='tool_use'`, `tool=name`, `input=input`, `metadata.toolUseId=id` |
| `type: 'user'` with `content[{type:'tool_result', tool_use_id, content, is_error}]` | `tool_result` | `type='tool_result'`, `tool=<lookup from id→name map>`, `output=content`, `metadata.isError=is_error`, `metadata.toolUseId=tool_use_id` |
| `type: 'result'` with `is_error=true` | `error` | `type='error'`, `content=result.result ?? 'agent failed'` |
| `type: 'result'` with `is_error=false` | (none — child exits; task completion is the HTTP call) | N/A |
| `type: 'control_request'` with `subtype='can_use_tool'` | auto-approval side-effect (see §Control Protocol) | emits an audit `PendingTaskMessage` with `type='thinking'` and `content='[auto-approve] tool=<name>'` |
| `type: 'system'` | (ignored) | N/A |
| `type: 'log'` | (ignored or routed to daemon console at debug level) | N/A |

The `tool_use` → `tool_result` name lookup is a per-task Map<toolUseId, toolName>; filled on each `tool_use`, read on each `tool_result`. Never crashes if the id is missing (emits `tool='unknown'`).

**[VERIFIED] Content truncation:** server-side truncates at 16 KB per message (UI-07 / UX6), but the daemon does NOT pre-truncate — the batcher/route layer is authoritative. Lower-bound: ship the daemon keeping full content. Multica truncates at 8 KB; Aquarium's 16 KB is more generous. [CITED: REQUIREMENTS.md UI-07 + PITFALLS.md UX6]

## Claude Control Protocol (research-gate (b))

### Background

Claude Code's stream-json output includes `control_request` frames asking the host to approve tool usage. When running with `--permission-prompt-tool stdio`, Claude expects a `control_response` JSON frame written back to stdin; without a response within a few seconds, the request times out and tools fail. [CITED: code.claude.com/docs/en/permissions + community reverse-engineering via Lobehub and SmartScope]

### Request/response shape (verified against multica + public community docs)

```typescript
// Incoming on child stdout (parsed by ndjson-parser.ts)
interface ControlRequest {
  type: 'control_request';
  request_id: string;          // echo back verbatim in response
  request: {
    subtype: 'can_use_tool';
    tool_name: string;         // e.g. 'Read', 'Edit', 'Bash', 'WebFetch'
    input?: unknown;
    tool_use_id?: string;
  };
}

// Outgoing on child stdin (one line, JSON-per-line)
interface ControlResponse {
  type: 'control_response';
  response: {
    request_id: string;
    subtype: 'can_use_tool_response';
    behavior: 'allow' | 'deny';
    message?: string;           // shown to the agent if behavior='deny'
    updatedInput?: unknown;     // optional: rewrite the tool input before execution
  };
}
```

### Auto-approval policy (Phase 21 default)

**Settled (research-gate b):** Auto-approve all tool use by default. Configurable via `daemonConfig.backends.claude.allow` array — if set to `['Read','Edit','Bash']`, deny any other tool. `allow: ['*']` (or absent) → approve everything.

### Policy implementation

```typescript
// apps/server/src/daemon/backends/claude.ts (sketch)
function buildControlResponse(req: ControlRequest, allow: string[] | undefined): ControlResponse {
  const allowed =
    !allow ||                                   // no allow list → approve all
    allow.includes('*') ||                      // explicit wildcard
    allow.includes(req.request.tool_name);      // exact match
  return {
    type: 'control_response',
    response: {
      request_id: req.request_id,
      subtype: 'can_use_tool_response',
      behavior: allowed ? 'allow' : 'deny',
      message: allowed ? undefined : `Tool '${req.request.tool_name}' not in daemon allow-list`,
    },
  };
}
```

### Audit trail

**Every control_request response is also emitted as a `PendingTaskMessage`** with:
- `type: 'thinking'`
- `content: '[auto-approve] tool=<name> → allow'` (or `'[deny] tool=<name> — not in allow-list'`)

This guarantees the issue timeline shows every tool-approval decision even though the Claude CLI otherwise hides the handshake. Mitigates the "silent auto-yes" UX risk from the research gate.

### Why NOT `--permission-mode bypassPermissions`

Multica uses `--permission-mode bypassPermissions` (claude.go:357-363) which SKIPS the control_request handshake entirely. Pro: one less moving part. Con: no audit trail for tool decisions; a future "deny list" feature becomes a breaking change.

For v1.4 we choose `--permission-prompt-tool stdio` with auto-approve-with-allow-list. Migration path is clean: if we ever need to change, the backend is ~30 LOC of response logic that a single plan can flip.

### Unit tests (BACKEND-07)

- `buildControlResponse` with `allow=undefined` → behavior='allow' for any tool.
- `buildControlResponse` with `allow=['*']` → behavior='allow' for any tool.
- `buildControlResponse` with `allow=['Read','Edit']` → allow for 'Read', deny for 'WebFetch'.
- Round-trip test: spawn a mock `claude` that emits a `control_request` → daemon responds → mock records the response payload and asserts shape.

**[CITED: code.claude.com/docs/en/permissions, platform.claude.com/docs/en/agent-sdk/permissions, multica claude.go:115-145 & 240-276, STACK.md §Phase G1]**

**[ASSUMED]:** The exact wire keys (`request_id`, `subtype: 'can_use_tool'`, `subtype: 'can_use_tool_response'`, `behavior: 'allow'|'deny'`) are reverse-engineered from multica's Go source and community documentation — Anthropic has not published a formal spec at time of research. The planner should validate by running `claude --output-format stream-json --permission-prompt-tool stdio` against a simple prompt and capturing a real `control_request` frame. If the shape has drifted since multica's 2025 implementation, the ~30 LOC response builder is the only code to change.

## Auto-Detecting `claude` CLI (CLI-01)

### Detection routine

```typescript
// apps/server/src/daemon/detect.ts
import { execa } from 'execa';
import { which } from './which.js'; // small wrapper over node:child_process or existsSync

const FALLBACK_PATHS = [
  path.join(os.homedir(), '.claude', 'local', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',  // Apple Silicon Homebrew
  'C:\\Program Files\\Claude\\claude.exe',  // Windows best-effort
];

export async function detectClaude(): Promise<{ path: string; version: string } | null> {
  // 1. Try PATH first
  const onPath = await which('claude');         // cross-platform version
  const candidates = onPath ? [onPath, ...FALLBACK_PATHS] : FALLBACK_PATHS;

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const { stdout } = await execa(p, ['--version'], { timeout: 5_000 });
      const match = /^(?:\S+\s+)?(\d+\.\d+\.\d+)/.exec(stdout);
      if (match) return { path: p, version: match[1] };
      // version output didn't parse — still register but with version='unknown'
      return { path: p, version: 'unknown' };
    } catch {
      // try next candidate
    }
  }
  return null;
}
```

**Design notes:**

- **PATH first, fallbacks after:** common case wins. PATH hit verified today on the researcher's machine: `which claude → /Users/shuai/.local/bin/claude`, `claude --version → 2.1.112 (Claude Code)`.
- **`~/.claude/local/claude` fallback:** Claude Code's installer puts a binary there even when PATH is unconfigured (common on macOS).
- **`--version` timeout of 5 s:** Claude is usually fast; if it hangs, we'd block daemon startup. 5 s is generous enough for cold-launch + slow disk.
- **Version-parse failure → `version='unknown'`:** don't crash the daemon if Claude changes its `--version` format. Register with a sentinel.
- **Return `null` → don't register Claude backend:** daemon still starts; user sees `[daemon] claude: not found — skipping` in stdout.

### Platform-specific concerns

- **macOS ARM + Rosetta:** `claude --version` works natively on both; no rosetta fallback needed.
- **Windows `.cmd` shims:** `which claude` may return `claude.cmd` on Windows. execa handles `.cmd` shims natively (was a pain in Node 12; fine in Node 22). Still, the fallback Windows path ensures we don't miss an installer-path install. [CITED: STACK.md §Open Questions 5]
- **Corporate proxies / VPNs:** `claude --version` doesn't make network calls, so proxy misconfigurations don't break detection.

### Unit tests (BACKEND-07)

- Mock `which` + `fs.existsSync` + `execa`: happy path returns `{ path, version }`.
- Mock all fallbacks missing: returns `null`.
- Mock `--version` hanging > timeout: moves to next candidate.
- Mock `--version` output as "2.1.112 (Claude Code)" → parses as '2.1.112'.
- Mock `--version` output as "Claude-Code 99.0" → parses as '99.0.0' or returns 'unknown' depending on regex strictness — TEST THE EXACT STRING.

## Kill Escalation (BACKEND-04 / PM1)

### Primary mechanism: execa 9's native `forceKillAfterDelay`

```typescript
const child = execa(claudePath, args, {
  cancelSignal: abortController.signal,
  forceKillAfterDelay: 10_000,   // SIGTERM on abort; SIGKILL 10 s later if still alive
  detached: process.platform !== 'win32',
  shell: false,
});
```

**Contract:** when `abortController.abort()` fires:
1. execa sends SIGTERM to the child (SIGKILL on Windows — execa auto-maps).
2. execa waits 10 s; if the child has not exited, sends SIGKILL.
3. execa awaits the exit regardless — promise resolves with `isCanceled: true` + stderr/stdout captured.

### Backstop: process-group kill on POSIX

When `detached: true`, the child is the leader of its own process group. If execa's signal propagation misses a grandchild (shouldn't with execa 9, but belt-and-braces), we can do:

```typescript
// Inside the watchdog's onInactive handler OR the cancel handler:
if (process.platform !== 'win32' && child.pid) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already dead */ }
}
```

### Why NOT hand-roll the escalation

The plan could hand-write `killWithEscalation(child, 10_000)`:

```typescript
// Hand-rolled version (BAD — don't do this)
function killWithEscalation(child: ChildProcess, graceMs: number) {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
  child.once('exit', () => clearTimeout(timer));
}
```

…but this has known holes: doesn't kill the process group on POSIX; doesn't handle Windows' SIGTERM-ignored behaviour; doesn't await exit; doesn't deal with `.pid` being undefined on spawn failure. execa 9 solves all of these. **Use the library for PM1; hand-roll for tests.**

### Unit test hook: test-only extractable timer

For BACKEND-07 we still need a unit test that proves 10 s escalation timing without running a real 10 s test. Solution: extract the escalation into a tiny helper that accepts a `clock` (default = global timers) and a `kill` function (default = `child.kill`). The unit test injects `@sinonjs/fake-timers` (zero new dep — ships with `tsx` transitively? NO, `@sinonjs/fake-timers` IS a new dep). **Alternative:** use `node:test`'s `mock.timers.enable()` (built-in since Node 20.4, available in Node 22) — ZERO new deps. [VERIFIED: Node 22 `node:test` mock.timers API exists]

```typescript
// apps/server/src/daemon/kill-escalation.ts (test seam)
export interface KillEscalationDeps {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export function escalateKill(
  child: { kill: (sig?: string) => boolean; once: (evt: string, fn: () => void) => void },
  graceMs: number,
  deps: KillEscalationDeps = { setTimeout, clearTimeout },
): void {
  child.kill('SIGTERM');
  const timer = deps.setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, graceMs);
  child.once('exit', () => deps.clearTimeout(timer));
}
```

### Unit tests (BACKEND-07)

- **Timing test:** `mock.timers.enable()`, spawn fake child → escalate → advance 10_000 ms → assert SIGKILL fired.
- **Exit-before-grace test:** escalate → fake child emits 'exit' at 2_000 ms → advance 10_000 ms → assert SIGKILL was NOT fired.
- **Signal sequence:** SIGTERM always fires synchronously before the scheduled timer.

## Bounded Semaphore (CLI-04 / PG1)

### Design

A handwritten async semaphore with a FIFO waiter queue. 25 LOC, zero deps, unit-testable in isolation.

```typescript
// apps/server/src/daemon/semaphore.ts
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be >= 1');
    this.available = max;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return this.release.bind(this);
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(this.release.bind(this)));
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Next waiter grabs the slot — we do NOT bump available.
      next();
    } else {
      this.available++;
    }
  }

  stats(): { available: number; waiters: number } {
    return { available: this.available, waiters: this.waiters.length };
  }
}
```

### Contract / invariants

- `acquire()` resolves with a `release` function; caller MUST call it exactly once (typically in `finally`).
- `release()` is idempotent — calling twice is a bug; unit tests assert it only.
- Waiters are served FIFO (first-acquired, first-served). [Verified by unit test 3 below.]
- `stats()` exposes {available, waiters} for observability; debug logs print it every poll cycle.

### Usage at call site

```typescript
// apps/server/src/daemon/poll-loop.ts (sketch)
const sem = new Semaphore(config.maxConcurrentTasks);
while (!stopSignal.aborted) {
  const task = await pollForTask();
  if (!task) { await sleep(config.pollIntervalMs); continue; }
  const release = await sem.acquire();
  // Fire-and-forget, but with error handler (PG2) and release guarantee:
  runTask(task).finally(release).catch(logTaskError);
  // ^^ NO await — we let the task run in the background while the loop
  //    goes back to polling. The semaphore is the only backpressure.
}
```

Key PG1 mitigation: the `await sem.acquire()` BEFORE the fire-and-forget dispatch. The loop cannot launch task N+1 until task N releases. Unbounded leak impossible.

### Unit tests (BACKEND-07)

1. `acquire` returns immediately when `available > 0`.
2. Second `acquire` with `max=1` queues; `release` resolves it.
3. FIFO order: acquire A, B, C (all queued); release → A resolves first, then B, then C.
4. Double release is caught (throws or is idempotent — pick one and test).
5. `new Semaphore(0)` throws RangeError.
6. `stats()` reflects waiters correctly across acquire/release interleaving.
7. 100 concurrent `acquire()` calls with `max=3`: at any point ≤ 3 are resolved, rest are queued; after all are released, available=3 and waiters=0.

### Why NOT `p-limit`

`p-limit` is a valid option that wraps the same primitive. But:
- BACKEND-07 explicitly calls out "bounded semaphore" as a unit-test target. We'd test an imported black-box; test value is lower.
- 25 LOC < adding a dep (+package-lock churn, +1 more publishable file in `dist/`).
- The primitive is an educational cornerstone of PG1 — mentors can read the daemon code and SEE the mitigation.

## Cancel-Propagation Loop (CLI-06)

### Shape

For every in-flight task (every `runTask(task)` invocation):

```typescript
// apps/server/src/daemon/cancel-poller.ts (per-task)
export function startCancelPoller(
  taskId: string,
  onCancel: () => void,             // calls abortController.abort()
  opts: { intervalMs: number; httpClient: DaemonHttpClient; signal: AbortSignal },
): () => void {
  let handle: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (opts.signal.aborted) return;  // task completed already — stop polling
    try {
      const { cancelled } = await opts.httpClient.getTaskStatus(taskId);
      if (cancelled) {
        onCancel();
        return;                       // one-shot — stop polling
      }
    } catch (err) {
      // Network error, 401, etc. Log at warn; retry next tick.
      // A 401 means the token was revoked — daemon-wide death handled elsewhere.
      console.warn(`[cancel-poller] ${taskId}: ${(err as Error).message}`);
    }
    handle = setTimeout(tick, opts.intervalMs).unref();
  };
  handle = setTimeout(tick, opts.intervalMs).unref();
  return () => { if (handle) clearTimeout(handle); };
}
```

### Design notes

- **One poller per in-flight task** (not one global poller iterating all tasks). Reason: simple, cancellation detected at p99 = intervalMs, per-task teardown is trivial. For `max_concurrent_tasks=10` that's 10 pollers → 10 HTTP reqs per 5 s = 2 req/s sustained. Server's per-token rate limit is 1000 req/min = 16.7 req/s (Phase 19-02 `daemonBucket`) — well within budget.
- **`.unref()`**: pollers don't block process exit. Graceful shutdown sequence clears them explicitly anyway.
- **`onCancel()` only fires once** — after that the handle is null and no reschedule happens.
- **Interaction with AbortController**: when `onCancel` fires, it calls `abortController.abort()` which:
  1. Triggers execa's `cancelSignal` → SIGTERM → (10 s) → SIGKILL.
  2. Notifies the NDJSON parser's `opts.onInactive` (through closure).
  3. Releases the semaphore (once the child exits) via the `finally` in `runTask`.

### PG5 checkpoint (context vs AbortSignal)

PG5 warns that Node's AbortSignal does NOT auto-propagate like Go's context. Phase 21 MUST thread `abortController.signal` through EVERY await point:

| Boundary | Threaded | How |
|----------|----------|-----|
| HTTP `fetch()` (undici under the hood) | yes | Pass `{ signal: ac.signal }` to every `fetch` call in `DaemonHttpClient` |
| execa child spawn | yes | `cancelSignal: ac.signal` + `forceKillAfterDelay` |
| `for await` NDJSON parser loop | yes (implicit) | Child exit breaks the iterator; explicit `if (ac.signal.aborted) break;` inside the loop as belt-and-braces |
| Flush ticker (500 ms) | yes | `setInterval` is cleared in `finally`; also wrap `flushNow()` with `if (ac.signal.aborted) return` |
| Cancel poller | yes | `if (opts.signal.aborted) return` in `tick()` (see above) |
| Heartbeat loop | semi (global, not per-task) | Uses daemon-wide shutdownAc.signal; individual task abort doesn't touch it |

**[CITED: PITFALLS.md PG5 HARD]**

## Crash Handling & Graceful Death (CLI-05)

### Process-level handlers

```typescript
// apps/server/src/daemon/main.ts (sketch of startDaemon)
const crashLog = path.join(config.dataDir, 'daemon.crash.log');

process.on('unhandledRejection', async (err) => {
  await handleFatal(err, 'unhandledRejection');
});
process.on('uncaughtException', async (err) => {
  await handleFatal(err, 'uncaughtException');
});
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => void gracefulShutdown('SIGINT'));

async function handleFatal(err: unknown, source: string): Promise<never> {
  const line = `${new Date().toISOString()}\t${source}\t${errorToString(err)}\n`;
  try { fs.appendFileSync(crashLog, line); } catch { /* don't cascade */ }

  // Best-effort: mark all in-flight tasks failed (max 2 s per task, fire-and-forget over Promise.all).
  const bestEffortTasks = Array.from(inFlight.values()).map(async (t) => {
    try {
      await httpClient.failTask(t.taskId, `daemon ${source}: ${errorToString(err)}`);
    } catch { /* server unreachable — we're dying anyway */ }
  });
  await Promise.race([
    Promise.allSettled(bestEffortTasks),
    new Promise((r) => setTimeout(r, 2_000).unref()),
  ]);

  process.exit(1);
}

async function gracefulShutdown(signal: string): Promise<void> {
  shutdownAc.abort();                             // stop poll loop, cancel pollers, abort children
  // Wait for in-flight tasks to drain up to gracefulShutdownMs (default 15 s)
  // …then exit 0.
  await Promise.race([
    drainInFlight(),
    new Promise((r) => setTimeout(r, 15_000).unref()),
  ]);
  await httpClient.deregister(registeredRuntimeIds).catch(() => {});
  process.exit(0);
}
```

### Ordering (CLI-05 explicit)

1. Append to `~/.aquarium/daemon.crash.log` FIRST (synchronous `appendFileSync`). This is the one thing that MUST succeed even if everything else is broken. We tolerate the event-loop block because we're dying.
2. Best-effort `failTask` over HTTP for each in-flight task, capped at 2 s total.
3. `process.exit(1)`.

**"Best-effort" vs "guaranteed":** the crash log is guaranteed; the `failTask` calls are best-effort. This matches multica's fail-over-HTTP pattern. The server-side task-reaper (Phase 18) will fail any tasks we miss within 5 min.

### PG2 mitigation (HARD)

Every top-level async function launched by the poll loop, heartbeat loop, cancel poller, and flush ticker MUST wrap its body in `try { … } catch (err) { logAndContinue(err); }`. Unhandled rejections that DO reach `process.on('unhandledRejection')` are escape-hatches, not the primary defence. The primary defence is per-loop try/catch.

### Unit test strategy (BACKEND-07)

`unhandledRejection` is hard to unit-test without forking a real process. The plan should ship:
- A unit test for the `errorToString(err)` helper (plain objects, Error subclasses, strings).
- A unit test that `handleFatal` writes to a tempfile and calls `httpClient.failTask` for each in-flight task.
- An integration test (Playwright or dedicated) that spawns the daemon, injects an unhandled rejection via a test hook, and asserts the crash log is written before exit.

**[CITED: PITFALLS.md PG2 HARD, PG3, PM2]**

## Runtime State Inventory

Phase 21 is a greenfield module (the daemon is new code in a new directory), not a rename or refactor. This section is therefore minimal — no pre-existing runtime state is being renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — daemon is a new subsystem; its only persistent state is `~/.aquarium/daemon.json` (config, created fresh on first run) | None |
| Live service config | None — no Datadog/Cloudflare/Tailscale ACL changes | None |
| OS-registered state | None in v1.4 — Windows service wrappers are deferred (see research-gate (a)). The daemon relies on PID-file in `~/.aquarium/daemon.pid` for `aquarium daemon stop`/`status` but it's created fresh on each start | None |
| Secrets/env vars | NEW env vars: `AQUARIUM_DAEMON_SERVER`, `AQUARIUM_DAEMON_TOKEN`, `AQUARIUM_DAEMON_DEVICE_NAME`, `AQUARIUM_DAEMON_MAX_CONCURRENT_TASKS`, `AQUARIUM_DAEMON_LOG_LEVEL`. Daemon tokens (`adt_*`) are generated server-side (Phase 19-03); users copy them into `~/.aquarium/daemon.json` | None — all greenfield |
| Build artifacts | The published `dist/cli.js` and new `dist/daemon/*.js` paths. `prepublishOnly` script in `apps/server/package.json` already copies everything under `dist/`. No changes needed | Verify `npm run build` captures `apps/server/src/daemon/` output (tsc does this automatically — confirm in plan) |

**Nothing found in category:** State explicitly — no existing runtime embeds "daemon" in a way that needs migrating.

## Environment Availability

Phase 21 depends on `claude` being installed on the user's machine at test time. For server-side unit tests (`node:test`), the daemon code is exercised WITHOUT a real Claude binary — every spawn is mocked via a fake `execa` or a controlled script. For the integration smoke test, a stub `claude` script is shipped in `apps/server/tests/fixtures/fake-claude.js` (see §Validation Architecture).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | CLI-01 runtime detection + BACKEND-01 spawn | ✓ (research machine) | `2.1.112 (Claude Code)` (verified at `/Users/shuai/.local/bin/claude`) | Detection returns `null` → skip claude backend → daemon starts with 0 runtimes registered, prints WARN, keeps running |
| `node` 22+ | daemon (ESM, node:test mock.timers, `for await of rl`) | ✓ (project standard) | — | Block: Phase 15 already requires Node 22+ |
| `npm install` access | `execa`/`commander` install | ✓ | 9.6.1 / 14.0.3 | None — registry access is assumed |
| stub `claude` for integration tests | §Validation Architecture integration tier | ✓ (ships as `tests/fixtures/fake-claude.js`) | N/A | — |
| `sinon` fake timers (if we chose that path) | NOT NEEDED — use `node:test`'s built-in `mock.timers` | N/A | — | — |

**Missing dependencies with no fallback:** None — every external dep has a fallback or is mocked.

**Missing dependencies with fallback:**
- `claude` on end-user machine: daemon gracefully skips the claude backend and continues running (useful for users on Windows or users testing before installing Claude).

## Common Pitfalls (the OWNED set — every one has an explicit mitigation)

Phase 21 owns PG1, PG2, PG3, PG4, PG5, PG6, PG7, PG8, PG9, PG10, PM1, PM2, PM3, PM4, T1, T2. Each is listed with the exact line in the plan where the mitigation lives.

| Pitfall | Classification | Mitigation in Phase 21 |
|---------|----------------|------------------------|
| **PG1** Goroutine → unbounded async leak (HARD) | Port bug | `Semaphore.acquire()` BEFORE fire-and-forget `runTask(task)` in `poll-loop.ts`. Unit test §7 proves FIFO + bounding. |
| **PG2** Unhandled promise rejection (HARD) | Port bug | Per-loop `try/catch` in poll/heartbeat/cancel/flush loops + `process.on('unhandledRejection')` + `process.on('uncaughtException')` in `main.ts` that writes `~/.aquarium/daemon.crash.log` before exit. |
| **PG3** Timer/interval leaks | Port bug | All `setInterval` / `setTimeout` owned by a lifecycle object that iterates and clears on `gracefulShutdown`. `.unref()` on pollers/watchdogs so they don't block exit. |
| **PG4** Channel-full drop semantics | Port bug | Claude stream messages are BUFFERED per-task (500 ms flush, max-100-per-batch at the HTTP boundary). Text/thinking are accumulated reliably until flush; NEVER dropped silently. If flush batch is full, we hold the next batch — no drop. Backend-specific PendingTaskMessage construction in `backends/claude.ts`. |
| **PG5** Context vs AbortSignal (HARD) | Port bug | `AbortController` threaded through every await — documented matrix in §Cancel-Propagation Loop. Fetch calls, execa spawn, for-await loops, timers all receive the same signal. |
| **PG6** await-in-loop vs Promise.all | Port bug | Heartbeat is sequential (small N — ≤5 runtimes). Message batches POST once per 500 ms (no parallelism). Documented in each loop's leading comment citing the multica Go original. |
| **PG7** readline iteration pattern (HARD) | Port bug | `for await (const line of rl)` in `ndjson-parser.ts`. `crlfDelay: Infinity`. Unit test: CRLF round-trip. |
| **PG8** stdout backpressure (HARD) | Port bug | `for await` naturally backpressures. Inactivity watchdog (60 s) catches abandoned-pipe case. On cancel, explicit `child.stdout.resume(); child.stdout.destroy();` before awaiting `subprocess.on('exit')`. |
| **PG9** UTF-8 boundary corruption | Port bug | `stream.setEncoding('utf8')` in `parseNdjson`. Unit test: emoji tool name round-trip. |
| **PG10** JSON.parse on partial lines | Port bug | Per-line try/catch in `parseNdjson`; drop-and-continue; counter feeds `onParseError` log. Unit test: truncated middle line. |
| **PM1** SIGTERM → zombie (HARD) | Greenfield | execa 9 `cancelSignal` + `forceKillAfterDelay: 10_000` + `detached: process.platform !== 'win32'` + `shell: false`. Unit test: mocked kill timing with `node:test`'s `mock.timers`. |
| **PM2** Daemon crash → orphan children | Greenfield | Children spawned without `detached: true` on Windows (default parent-death propagation). POSIX children spawned `detached: true` + process-group kill path. `~/.aquarium/daemon.state.json` writes `{taskId, pid, startedAt}` atomically on spawn; daemon start reads the file and SIGKILLs any live pids left from a previous crash. |
| **PM3** PATH inheritance (HARD) | Port bug | `env.PATH = path.dirname(process.execPath) + path.delimiter + process.env.PATH` in `spawnClaude`. `sanitizeCustomEnv` strips `PATH` / `AQUARIUM_*` from agent.customEnv overrides. |
| **PM4** stdin not closed | Port bug | `writeAndClose(child.stdin, msg)` helper always calls `.end()`. Unit test: assert `child.stdin.destroyed === true` after helper returns. |
| **T1** Child-process spawn untestable in CI | Greenfield | BACKEND-07 ships `apps/server/tests/unit/*.test.ts` with `node:test`. Primitives (semaphore, kill-escalation, ndjson-parser) tested in full isolation. Claude backend tested with a stub `tests/fixtures/fake-claude.js` that emits scripted stream-json. |
| **T2** E2E daemon awkwardness | Greenfield | Two-tier strategy: (1) unit tests for primitives — fast, hermetic; (2) ONE integration smoke test that spawns `aquarium daemon start --foreground --server …` against a pre-started server with a seeded token, uses the stub `fake-claude`, and asserts a full claim→stream→complete cycle in < 10 s. Marked `@integration`; CI-skipped by default, runs on demand or in nightly. |

## State of the Art

| Old Approach (multica Go) | Phase 21 Approach (Node) | Why Different | Impact |
|---------------------------|--------------------------|---------------|--------|
| `bufio.Scanner` with 10 MB buffer | `node:readline` `for await` with `crlfDelay: Infinity` | Node idiom + zero deps + backpressure-aware | No size cap issues because `readline` streams incrementally; 10 MB-per-line is a hypothetical attack vector not observed from real Claude output |
| `exec.CommandContext + cmd.WaitDelay=10s` | `execa@9` with `cancelSignal + forceKillAfterDelay: 10_000` | Idiomatic Node + library that's already battle-tested | Byte-identical behaviour; less bespoke code |
| `sem := make(chan struct{}, d.cfg.MaxConcurrentTasks)` (Go channel semaphore) | Handwritten `Semaphore` class with FIFO Promise queue | Node has no goroutines/channels; we need a primitive we can unit-test | 25 LOC; zero deps; explicit FIFO invariant visible in source |
| `context.WithCancel(parent)` — auto-cascading | `AbortController` threaded manually through every await | PG5 HARD — AbortSignal in Node has NO auto-propagation | Phase 21 code is more verbose but invariants are visible; easier to audit |
| MULTICA_DAEMON_PORT — daemon-local HTTP (AUTH5) | NOT IMPLEMENTED in v1.4 | AUTH5 owner is "a future phase"; v1.4 Claude backend doesn't call back | No secondary credential surface in v1.4; agent CLIs talk to child's stdin only |
| `--permission-mode bypassPermissions` | `--permission-prompt-tool stdio` + auto-approve-with-allow-list | Audit trail in issue timeline | One extra control_request handshake per tool call; negligible latency; big audit win |

**Deprecated/outdated:**

- `react-beautiful-dnd` — abandoned 2022; NOT USED in this phase (that's Phase 23).
- `@anthropic-ai/claude-agent-sdk` — modern (2025) but bypasses user's `claude` install; rejected by Phase 21 for architectural reasons (REQUIREMENTS.md line 198 Out-of-Scope).
- Hand-rolled `getFlag()` parser in `cli.ts` — replaced by commander 14.0.3.

## Open Questions (Assumption Log handoff)

See §Assumptions Log below for the formal list. Here's the narrative:

1. **Claude Code `control_request` wire format drift.** The exact keys (`request_id`, `subtype='can_use_tool'`, `behavior='allow'|'deny'`) are reverse-engineered from multica (2025 Go source) and community reverse-engineering. Anthropic has not published a formal spec. MITIGATION: ship a manual capture step in the plan — run `claude --output-format stream-json --permission-prompt-tool stdio` against a trivial prompt and capture a real `control_request` frame before finalising the parser. If shape has drifted, the ~30 LOC response builder is the only code to change. Integration smoke test will catch this on first run.
2. **Windows `.cmd` shim resolution.** execa 9.6.1 handles `.cmd` shims natively, but corporate Windows setups with unusual PATHEXT orderings may trip detection. Phase 21 flags Windows as "best-effort / foreground-only" and logs clearly. v1.5 can pick up a `node-windows`/`nssm` service wrapper as a follow-up.
3. **Daemon graceful-shutdown timeout on large in-flight backlogs.** 15 s `gracefulShutdownMs` is a guess. If a user routinely runs 10 long-lived Claude tasks, SIGTERM → 15 s → SIGKILL may prematurely cut off in-flight work. MITIGATION: make the graceful-shutdown timeout configurable (`daemonConfig.gracefulShutdownMs`, default 15_000).
4. **Token revocation mid-task.** If the user revokes the daemon token while a task is running, subsequent `/api/daemon/tasks/:id/messages` calls return 401. Daemon behaviour: log, STOP polling, mark in-flight tasks failed locally (server-side reaper will handle the DB-side). Do NOT retry — prevents the "stolen-token DDoS" scenario. This is partially covered by Phase 19 AUTH3; Phase 21 just honours the 401 correctly.
5. **Heartbeat on intermittent network.** 15 s heartbeat + 90 s offline-sweep threshold gives a 6× margin. A laptop that sleeps for 90 s+ will be marked offline; on wake, daemon re-registers and the runtime flips back to `online`. No action needed — the existing server surface handles this.
6. **Multi-daemon on one machine.** Not explicitly supported. Two `aquarium daemon start` calls would both try to bind the same PID file and fail the second. Acceptable for v1.4. A `--pid-file` override can be added in v1.5 for advanced users.

## Validation Architecture

> Required by Nyquist. `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is MANDATORY.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` via `tsx` — MATCHES Phase 18/19 convention (existing `apps/server/tests/unit/README.md`) |
| Config file | none (CLI-driven) |
| Quick run command | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/<file>.test.ts` |
| Full unit run | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test 'apps/server/tests/unit/**/*.test.ts'` |
| Integration smoke | (new) `tests/e2e/daemon-integration.spec.ts` — Playwright-driven, marked `@integration`, CI-skipped by default |
| Pre-push gate | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | Auto-detect `claude` CLI on PATH + fallback paths | unit (mocked fs/execa) | `npx tsx --test apps/server/tests/unit/daemon-detect.test.ts` | ❌ Wave 0 |
| CLI-02 | Commander subcommand routing: `daemon start/stop/status/token list` | unit (no-exec probe: parse argv; assert dispatch target) | `npx tsx --test apps/server/tests/unit/daemon-cli.test.ts` | ❌ Wave 0 |
| CLI-03 | Config precedence flags > env > file > defaults | unit | `npx tsx --test apps/server/tests/unit/daemon-config.test.ts` | ❌ Wave 0 |
| CLI-04 | Bounded semaphore FIFO + capacity enforcement | unit | `npx tsx --test apps/server/tests/unit/daemon-semaphore.test.ts` | ❌ Wave 0 |
| CLI-05 | Crash log + graceful death (fatal handler) | unit + integration | `npx tsx --test apps/server/tests/unit/daemon-crash.test.ts` + `@integration` spec | ❌ Wave 0 |
| CLI-06 | Cancel poll every 5 s → propagates to AbortSignal | unit (mock.timers advances 5s; assert abort called) | `npx tsx --test apps/server/tests/unit/daemon-cancel-poller.test.ts` | ❌ Wave 0 |
| BACKEND-01 | Claude stream-json parsed into `AgentMessage` union; `control_request` auto-approved | unit (fake stream) + integration (stub `fake-claude`) | `npx tsx --test apps/server/tests/unit/backend-claude.test.ts` + integration | ❌ Wave 0 |
| BACKEND-04 | SIGTERM → 10s → SIGKILL escalation; process group on POSIX | unit (mock.timers + mock child) | `npx tsx --test apps/server/tests/unit/kill-escalation.test.ts` | ❌ Wave 0 |
| BACKEND-05 | PATH prepended with daemon binary dir | unit (inspect env passed to execa mock) | `npx tsx --test apps/server/tests/unit/backend-claude.test.ts::path-injection` | ❌ Wave 0 |
| BACKEND-06 | readline with `crlfDelay: Infinity`, setEncoding('utf8'), 60s watchdog | unit (parseNdjson fed scripted stream) | `npx tsx --test apps/server/tests/unit/ndjson-parser.test.ts` | ❌ Wave 0 |
| BACKEND-07 | Unit tests live under `apps/server/tests/unit/` — `node --test` | meta-assertion: `grep -l "node:test" apps/server/tests/unit/*.test.ts` has the new files | shell check + the above | ❌ Wave 0 |
| SC-1 (ROADMAP) | Register produces one `local_daemon` runtime with `provider='claude'` + version + `status='online'` | integration | `@integration` spec: spawn daemon, POST /api/daemon/register, assert DB row shape | ❌ Wave 0 |
| SC-2 (ROADMAP) | Task assigned → claimed in one poll → streamed → completed | integration (stub fake-claude) | `@integration` spec | ❌ Wave 0 |
| SC-3 (ROADMAP) | Cancel propagates SIGTERM → SIGKILL; no zombies (verified by `pgrep`) | integration | `@integration` spec: mid-task revoke, `exec('pgrep -f fake-claude')` post-cancel returns empty | ❌ Wave 0 |
| SC-4 (ROADMAP) | Unhandled rejection → in-flight tasks failed over wire + crash log written + exit 1 | integration | `@integration` spec with a test-hook that throws inside a task | ❌ Wave 0 |
| SC-5 (ROADMAP) | Unit coverage for NDJSON parsing, kill escalation, semaphore, token hashing + timing-safe equality | unit (meta: assert test file presence + count) | shell check: all 4 test files exist | ❌ Wave 0 |

Note on "token hashing + timing-safe equality" in SC-5: this is phase 19-01's `daemon-token-store.ts` + `daemon-auth.ts`, and its unit coverage is already shipped (`daemon-token-store.test.ts` 11 tests + `daemon-auth.test.ts` 10 tests). Phase 21's BACKEND-07 responsibility is to ensure those tests continue to pass under `node:test` and to add any missing coverage for the `hashDaemonToken` / `timingSafeEqual` round-trip — which the Phase 19 tests already have (`Roundtrip: generated plaintext → hash → DB insert → hashDaemonToken(plaintext) → equal` per the 19-01 summary).

### Integration Tier — `@integration` Playwright Spec

New file: `tests/e2e/daemon-integration.spec.ts`. Pattern matches Phase 19-04's `tests/e2e/daemon-rest.spec.ts` but adds a daemon subprocess.

```typescript
// Sketch
test.describe('@integration daemon full cycle', () => {
  let daemon: ChildProcess;

  test.beforeAll(async ({ request }) => {
    // 1. Create user, mint daemon token
    // 2. Write ~/.aquarium-test/daemon.json with the token
    // 3. Spawn `aquarium daemon start --foreground --data-dir /tmp/...` as a subprocess
    //    with a fake-claude shim on PATH
    daemon = spawn('node', ['dist/cli.js', 'daemon', 'start', '--foreground', ...], {
      env: { ...process.env, PATH: fakeClaudeDir + path.delimiter + process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForDaemonRegister();
  });
  test.afterAll(async () => {
    daemon.kill('SIGTERM');
  });

  test('SC-1..SC-5 single happy path + cancel', async ({ request }) => {
    // Create agent + issue + assign; wait for claim; wait for complete; assert.
  });
});
```

`fake-claude` (`apps/server/tests/fixtures/fake-claude.js`) is a tiny Node script that reads one `user` message from stdin, emits 3 scripted `assistant` frames + 1 `result` frame on stdout, then exits 0. For cancel testing, it also has a `--hang` flag that makes it sleep forever so we can test SIGTERM → SIGKILL.

### Property / Fuzz (optional stretch)

Stretch goal — not required for phase completion but easy win:
- **NDJSON fuzz**: feed 100 random malformed lines interleaved with valid ones; assert parser never throws, drops malformed, yields all valid. Uses `node:test`'s built-in random seed + a tiny generator.

### Sampling Rate

- **Per task commit (during implementation):** `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/<touched-file>.test.ts`
- **Per wave merge:** full unit suite (`apps/server/tests/unit/*.test.ts`) — ~15 s
- **Phase gate:** full unit + integration smoke (running a real Aquarium server with a fake-claude stub) + `npm run typecheck` + `npm run build -w @aquarium/shared`

### Wave 0 Gaps

- [ ] `apps/server/tests/unit/daemon-semaphore.test.ts` — covers CLI-04
- [ ] `apps/server/tests/unit/kill-escalation.test.ts` — covers BACKEND-04 / PM1
- [ ] `apps/server/tests/unit/ndjson-parser.test.ts` — covers BACKEND-06 / PG7, PG8, PG9, PG10
- [ ] `apps/server/tests/unit/backend-claude.test.ts` — covers BACKEND-01 + control_request handling
- [ ] `apps/server/tests/unit/daemon-detect.test.ts` — covers CLI-01
- [ ] `apps/server/tests/unit/daemon-cli.test.ts` — covers CLI-02 (commander dispatch)
- [ ] `apps/server/tests/unit/daemon-config.test.ts` — covers CLI-03
- [ ] `apps/server/tests/unit/daemon-cancel-poller.test.ts` — covers CLI-06
- [ ] `apps/server/tests/unit/daemon-crash.test.ts` — covers CLI-05 (with `appendFileSync` temp-file assertion)
- [ ] `apps/server/tests/fixtures/fake-claude.js` — scripted stream-json stub for integration tier
- [ ] `tests/e2e/daemon-integration.spec.ts` — `@integration` full-cycle smoke
- [ ] Shared type additions: `AgentMessage`, `DaemonConfigFile` in `packages/shared/src/v14-types.ts`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer-token auth on every outbound HTTP request (`Authorization: Bearer adt_*`); no other auth path |
| V3 Session Management | partial | Long-lived bearer (no session); server-side `expires_at` + `revoked_at` on `daemon_tokens` (Phase 19) |
| V4 Access Control | yes | Daemon token is workspace-scoped server-side; daemon itself doesn't enforce (server is sole authority) |
| V5 Input Validation | yes | NDJSON parser drops malformed lines (PG10); config loader validates DaemonConfigFile shape before use |
| V6 Cryptography | yes | `node:crypto` randomUUID for daemonId; `node:crypto` timingSafeEqual on server-side token verify (Phase 19) — daemon never handles crypto itself |
| V7 Errors & Logging | yes | Crash log is `~/.aquarium/daemon.crash.log`; redact `Authorization` header in any log output (PM7 / AUTH2) |
| V14 Configuration | yes | `~/.aquarium/daemon.json` contains the plaintext token; file mode 0600 on POSIX (child of MUST-do checklist) |

### Known Threat Patterns for `Node child_process + stream-json + bearer HTTP`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leakage via `ps aux` (child-process env) | Information Disclosure | Do NOT pass token to child via env; only daemon process holds it. Child `claude` has no access to `adt_*`. [CITED: PM7] |
| Token leakage via `~/.aquarium/daemon.json` file permissions | Information Disclosure | `fs.chmodSync(path, 0o600)` on every write to `daemon.json`; check permissions on read and WARN if > 0644 |
| Malicious `~/.aquarium/daemon.json` inject (e.g. attacker writes `server: http://evil/`) | Spoofing | Daemon treats the config file as trusted — same threat model as any local file. Document in v1.5 that shared `~/.aquarium` dirs on multi-user machines are unsafe. |
| Child process spawned with attacker-controlled arg (e.g. agent.customArgs injected from compromised server) | Elevation | Daemon accepts customArgs from server but runs claude in `shell: false` mode — arg-injection is impossible; the only risk is misuse (not privilege escalation). Daemon is same UID as the user. |
| Server MITM on `http://localhost` | Tampering | Accept — localhost is trusted. For remote servers, HTTPS + cert-pinning would be a v1.5 concern. |
| Child CLI writes arbitrary files as daemon's UID | Elevation | Accepted — the daemon IS the user's shell. Users who want sandboxing should sandbox the `aquarium daemon start` process. |
| Log injection via `control_request.tool_name` | Log Forging | `[auto-approve] tool=<name>` audit message truncates at 200 chars and strips control chars before logging. |
| Heap growth from unbounded buffer on runaway child stdout | DoS | `readline` + `for await` naturally backpressures. No custom buffer accumulator. Inactivity watchdog is 60 s — if the child is producing output faster than we can consume, the pipe backpressure pauses the child. |
| Stolen daemon token used to DDoS server | DoS | Server-side per-token rate-limit bucket (Phase 19-02 `daemonBucket`: 1000 req / 60 s). Daemon-side respects `429` responses by backing off exponentially. |

## Code Examples

Verified patterns ready for the planner to reference in plans.

### 1. Top-of-file in `apps/server/src/daemon/main.ts`

```typescript
// Source: PITFALLS.md PG2 + PG5 + PG1 + Phase 19-02 DaemonRegisterRequest shape
import { execa } from 'execa';
import { loadDaemonConfig } from './config.js';
import { detectClaude } from './detect.js';
import { Semaphore } from './semaphore.js';
import { DaemonHttpClient } from './http-client.js';
import { startPollLoop } from './poll-loop.js';
import { writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export async function startDaemon(cliOpts: CliOpts): Promise<void> {
  const config = await loadDaemonConfig(cliOpts);
  const daemonId = randomUUID();
  const shutdownAc = new AbortController();

  const http = new DaemonHttpClient({
    server: config.server,
    token: config.token,
    signal: shutdownAc.signal,
  });

  // Detect backends (claude only in Phase 21; codex/etc. added in Phase 22).
  const claude = await detectClaude();
  if (!claude) {
    console.warn('[daemon] claude not found on PATH — no backends registered');
    // Continue — user may have other backends later.
  }

  // Register with server (CLI-01).
  const registerReq = {
    workspaceId: '',                // server uses the token's workspace
    daemonId,
    deviceName: config.deviceName,
    cliVersion: '1.4.0',            // TODO: read from package.json
    launchedBy: os.userInfo().username,
    runtimes: claude ? [{
      name: `${config.deviceName}-claude`,
      provider: 'claude' as const,
      version: claude.version,
      status: 'online' as const,
    }] : [],
  };
  const { runtimes } = await http.register(registerReq);
  // …

  // Wire process-level handlers FIRST (PG2 HARD).
  process.on('unhandledRejection', (err) => void handleFatal(err, 'unhandledRejection'));
  process.on('uncaughtException',  (err) => void handleFatal(err, 'uncaughtException'));
  process.on('SIGTERM', () => void gracefulShutdown());
  process.on('SIGINT',  () => void gracefulShutdown());

  const semaphore = new Semaphore(config.maxConcurrentTasks);
  startPollLoop({ runtimes, config, http, semaphore, claude, shutdownAc });
  startHeartbeatLoop({ runtimes, config, http, shutdownAc });
  // …block forever.
}
```

### 2. `spawnClaude` pattern

(See §Claude Code Backend for the full block — reproduced here with the essential lines for easy reference.)

```typescript
// Source: Phase 21 §Claude Code Backend + PITFALLS.md PM1 HARD + PM3 HARD
return execa(claudePath, [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio',
  ...customArgs,
], {
  cwd: workDir ?? process.cwd(),
  env: {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
    ...sanitizeCustomEnv(customEnv),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  detached: process.platform !== 'win32',
  cancelSignal: abortController.signal,
  forceKillAfterDelay: 10_000,
});
```

### 3. NDJSON consumption + control_request response

```typescript
// Source: Phase 21 §NDJSON Stream-JSON Parser + §Claude Control Protocol + PITFALLS.md PG7/PG8/PG9/PG10
for await (const msg of parseNdjson<ClaudeStreamMessage>(child.stdout!, {
  onParseError: (line, err) => {
    parseErrorCount++;
    if (parseErrorCount > 5) {
      console.warn(`[claude] >5 parse errors — sample: ${line.slice(0, 120)}`);
    }
  },
  inactivityMs: 60_000,
  onInactive: () => {
    console.warn(`[claude] 60s inactivity — killing`);
    abortController.abort();
  },
})) {
  if (msg.type === 'control_request') {
    const response = buildControlResponse(msg, config.backends?.claude?.allow);
    child.stdin!.write(JSON.stringify(response) + '\n');
    // Emit audit trail (see §Claude Control Protocol).
    batcher.push({ type: 'thinking', content: `[auto-approve] tool=${msg.request.tool_name}`, ... });
    continue;
  }
  // …map to AgentMessage and push into batcher…
}
```

## Assumptions Log

> Planner and discuss-phase use this to identify decisions needing user confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code `control_request` wire format uses exactly the keys `{ type, request_id, request: { subtype: 'can_use_tool', tool_name, ... } }` and expects `{ type: 'control_response', response: { request_id, subtype: 'can_use_tool_response', behavior: 'allow'\|'deny' } }` back. Reverse-engineered from multica claude.go:240-276 + community docs; Anthropic has not published a formal spec. | §Claude Control Protocol | MEDIUM — if Anthropic has changed the shape since multica's 2025 work, tool use will fail silently. Integration smoke test catches this on first real run. Fix is localised: ~30 LOC in `buildControlResponse`. |
| A2 | `execa@9.6.1`'s `forceKillAfterDelay` escalates SIGTERM→SIGKILL without additional hooks; this replaces a hand-rolled `killWithEscalation` helper. | §Kill Escalation | LOW — execa is widely used (pnpm, turbo, tsx); the behaviour is documented. Unit test covers the timing via `node:test`'s `mock.timers`. |
| A3 | `node:test`'s `mock.timers.enable()` (Node 20.4+) is stable and safe to use for kill-escalation / watchdog timing tests without adding a `sinon`-style dep. | §Kill Escalation unit tests + §NDJSON Parser tests | LOW — Node 22 is the baseline (CLAUDE.md Node 22+). API has been stable since 20.4. |
| A4 | `--permission-prompt-tool stdio` emits `control_request` frames in the stream-json output (vs the alternative `--permission-mode bypassPermissions` which skips the handshake). | §Claude Backend spawn | MEDIUM — verified by community docs; not in an official Anthropic spec. Integration test exercises the real binary if available locally. |
| A5 | The daemon can reliably use `path.dirname(process.execPath)` as the "directory of the `aquarium` binary" for PATH prepend. For npx-launched CE this is the directory where node is — which is also where the `aquarium` bin symlink lives in an npm install. | §PATH Inheritance (PM3) | MEDIUM — npm bin resolution can vary on Windows (PATHEXT) and Yarn PnP setups. Add an `AQUARIUM_BIN_OVERRIDE` env for edge cases; document in the CLI `--help`. |
| A6 | Windows daemon is acceptable as "foreground-only / best-effort" in v1.4. Users who want autostart can wrap with `nssm`/`sc create` themselves. | §CLI Entry-Point | LOW — v1.4 user base is overwhelmingly macOS/Linux (evidenced by CLAUDE.md's Docker-centric tech stack). Deferred gracefully to v1.5+. |
| A7 | `daemonConfig.gracefulShutdownMs = 15_000` default is enough to drain in-flight tasks on SIGTERM. | §Crash Handling | LOW — users with long tasks can raise it via config file. Timeout racing is a Node-idiomatic pattern and the worst case is one task failing unnecessarily (server-side reaper will catch it in 5 min). |
| A8 | The 500 ms message-flush batch + 100-messages-or-64KB HTTP cap is adequate for a Claude task's realistic message rate. Multica uses the same 500 ms flush. | §Bounded Semaphore + §Task Claim Protocol | LOW — realistic rates observed are <20 msgs/sec even during tool loops; 100 per 500 ms is 200 msgs/sec headroom. If hit, batcher splits into sequential batches; no data loss. |
| A9 | Heartbeat every 15 s with 90 s server-side offline threshold gives enough margin for typical laptop sleep/wake. | §Daemon Config Resolution | LOW — users who sleep machines for > 90 s will see a short "offline" blink on wake. Cosmetic only; re-register is automatic. |
| A10 | `node:readline` with `setEncoding('utf8')` and `crlfDelay: Infinity` handles all Claude stream-json output correctly. | §NDJSON Stream-JSON Parser | LOW — verified against Node 22 docs; same pattern multica uses via Go's `bufio.Scanner`. |

## Open Questions

1. **CLI `token issue` subcommand.** Phase 19-03 scoped token issuance to the web UI (cookie-authed POST `/api/daemon-tokens`). Should the daemon CLI also offer `aquarium daemon token issue --name NAME` as a server-side admin subcommand? If yes, it would need `--as-user <email>` authentication — adds an auth dimension. **Recommendation:** DEFER to Phase 25 (Management UIs). The CLI in Phase 21 exposes `aquarium daemon token list` + `aquarium daemon token revoke <id>` over cookie auth from the daemon's own machine, but NOT `issue` (forces the UX of "mint token in browser, paste into daemon.json" which is the established flow).
2. **Hot-reload of `~/.aquarium/daemon.json`.** Should the daemon re-read config on SIGHUP? Multica does. **Recommendation:** DEFER. Adds complexity; common case is `aquarium daemon stop && edit && aquarium daemon start`.
3. **Custom backends directory.** Should the daemon scan `~/.aquarium/backends/` for user-defined NDJSON-speaking backends? **Recommendation:** DEFER to Phase 22+. Phase 21 ships Claude-only.
4. **Structured logging.** Should the daemon emit JSON logs on stdout for easy parsing by `logrotate` / `journalctl`? **Recommendation:** Phase 21 uses simple `console.log` with a prefix; upgrade to structured logs is a follow-up.
5. **`workspaceId` in DaemonRegisterRequest.** Phase 19-02 Plan 2 says it's validated against the token's workspace (400 on mismatch). Daemon sends empty string (server overrides from token). Confirm the current Phase 19 route accepts empty string OR skip-sending. [ACTION for planner: test this before first integration run.]

## Sources

### Primary (HIGH confidence — verified against installed files / live dependency / official docs)

- `apps/server/src/cli.ts` (current 89-line hand-rolled parser) — [VERIFIED]
- `apps/server/src/index.ce.ts` (entry point post-flag-parse) — [VERIFIED]
- `apps/server/src/routes/daemon.ts` (10 daemon endpoints, rate-limit topology) — [VERIFIED]
- `apps/server/src/middleware/daemon-auth.ts` (bearer parsing + timingSafeEqual) — [VERIFIED via 19-01-SUMMARY.md]
- `apps/server/src/services/daemon-token-store.ts` (token generation + hash + workspace scoping) — [VERIFIED]
- `apps/server/src/services/task-queue-store.ts` (claim/start/complete/fail/isCancelled, discarded semantics) — [VERIFIED]
- `apps/server/src/services/runtime-registry.ts` (upsertDaemonRuntime, updateHeartbeat, setRuntimeOffline, getById) — [VERIFIED]
- `apps/server/src/task-dispatch/task-message-batcher.ts` (500 ms flush, BUFFER_SOFT_CAP=500) — [VERIFIED]
- `packages/shared/src/v14-types.ts` (DaemonRegisterRequest, ClaimedTask, Runtime, TaskMessageType) — [VERIFIED]
- `apps/server/tests/unit/README.md` (node:test conventions) — [VERIFIED]
- `.planning/research/PITFALLS.md` PG1–PG10, PM1–PM7, T1–T2 — [CITED VERBATIM]
- `.planning/research/STACK.md` §1 execa, §3 commander, §6 stream-json types — [CITED]
- `.planning/phases/19-daemon-rest-api-auth/19-RESEARCH.md` — rate-limit topology + bearer auth + CE privilege-confusion fix — [VERIFIED]
- `.planning/phases/20-hosted-instance-driver/20-RESEARCH.md` — gateway cancel semantics (for parallel comparison) — [VERIFIED]
- `npm view execa version` → 9.6.1 — [VERIFIED 2026-04-17]
- `npm view commander version` → 14.0.3 — [VERIFIED 2026-04-17]
- Node 22 `readline` docs (for/await + crlfDelay) — [CITED: nodejs.org/api/readline.html]
- Node 22 `node:test` `mock.timers` API — [CITED: nodejs.org/api/test.html#mocktimers]
- Claude installation verification on research machine: `which claude` → `/Users/shuai/.local/bin/claude`, `claude --version` → `2.1.112 (Claude Code)` — [VERIFIED 2026-04-17]

### Secondary (MEDIUM confidence — official docs with some community gaps)

- Claude Code permissions documentation — [CITED: code.claude.com/docs/en/permissions]
- Claude Code Agent SDK permissions — [CITED: platform.claude.com/docs/en/agent-sdk/permissions]
- `--permission-prompt-tool stdio` flag semantics — [CITED: SmartScope community writeup on claude-code auto-mode, 2026]

### Tertiary (LOW confidence — reverse-engineered)

- Exact `control_request` / `control_response` wire format — [ASSUMED: multica Go source + community reverse-engineering; Anthropic has not published a formal spec]
- Lobehub / Stackademic / SmartScope community blogs on the NDJSON control protocol — [CITED: community sources]

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Server-side surface (endpoints / types / services) | HIGH | All Phase 19 artifacts VERIFIED against installed files |
| Standard stack (execa / commander / node:readline / node:test) | HIGH | Versions pinned via `npm view`; existing STACK.md recommendations; zero speculation |
| NDJSON parser + control protocol | HIGH shape / MEDIUM wire-format | Design verified against Node docs + multica; exact keys ASSUMED from reverse-engineering (A1, A4) |
| Kill escalation (PM1) | HIGH | execa 9 ships the primitive natively; unit-testable via `node:test mock.timers` (A2, A3) |
| Bounded semaphore (PG1) | HIGH | 25 LOC handwritten primitive; trivially testable |
| Cancel propagation (CLI-06) | HIGH | 5 s poll against Phase 19's `GET /api/daemon/tasks/:id/status`; well within rate-limit budget |
| Windows posture (research gate a) | HIGH for "accept limitation" | Explicit deferral to v1.5; documented boundary (A6) |
| Claude auto-approval posture (research gate b) | HIGH for the policy (auto-approve + allow-list) / MEDIUM for wire format | Policy matches multica's conservative path; wire format ASSUMED until integration test proves it |
| Validation architecture | HIGH | Builds directly on Phase 18/19's `apps/server/tests/unit/` conventions — no new framework |
| Pitfalls coverage | HIGH | Every OWNED pitfall has a named mitigation + a named test file |

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stable deps, Node 22 stable, Claude Code wire protocol may drift so flag A1/A4 for re-verification then)

## RESEARCH COMPLETE

**Phase:** 21 — Daemon CLI + Claude-Code Backend + Unit Harness
**Confidence:** HIGH

### Key Findings

- Add exactly **two** new npm deps: `execa@9.6.1` (subprocess + SIGTERM→SIGKILL escalation via `forceKillAfterDelay`) and `commander@14.0.3` (subcommand dispatch). Everything else is `node:crypto`, `node:readline`, `node:test`, and a 25-LOC handwritten semaphore.
- Server-side surface is 100% shipped (Phase 19). Daemon is a pure HTTP client against 10 endpoints under `/api/daemon/*` with bearer `adt_*` auth. `{ discarded: true }` idempotency already honoured server-side.
- Research gate (a) — **Windows: accept "foreground-only / best-effort" for v1.4.** Users needing autostart wrap with `nssm`/`sc create` themselves. Deferred cleanly to v1.5+.
- Research gate (b) — **Claude control_request auto-approval: `--permission-prompt-tool stdio` + auto-approve-with-allow-list.** Every decision also emits a `type='thinking'` audit message to the issue timeline. Wire format reverse-engineered from multica + community docs (A1/A4 — flagged for integration-run verification).
- All 16 OWNED pitfalls (PG1–10, PM1–4, T1–2) have named mitigations + named test files. BACKEND-07 unit harness (`node:test` via `tsx`) establishes the testing primitives Phase 22 extends.
- NDJSON parser uses `node:readline` + `for await` + `setEncoding('utf8')` + `crlfDelay: Infinity` + per-line try/catch + 60 s inactivity watchdog. Zero 3rd-party line-framing deps.
- Bounded semaphore is handwritten (25 LOC, FIFO waiter queue) precisely BECAUSE BACKEND-07 needs to unit-test acquire/release ordering — a black-box `p-limit` dep would cost visibility.
- Token hashing + timing-safe equality already tested by Phase 19-01 (`daemon-token-store.test.ts`, `daemon-auth.test.ts`); SC-5 coverage is carried forward automatically.

### File Created

`.planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard stack | HIGH | `npm view` verified; existing STACK.md recommendations honoured |
| Server-side surface | HIGH | All endpoints + services VERIFIED against installed code |
| NDJSON parser | HIGH design, MEDIUM control-protocol wire format (A1/A4) | Node docs + multica parity; Anthropic hasn't published spec |
| Kill escalation | HIGH | execa 9 native; `node:test mock.timers` tests timing deterministically |
| Semaphore | HIGH | 25 LOC; trivially testable |
| Pitfalls | HIGH | Every OWNED pitfall has a named mitigation + named test file |
| Validation | HIGH | Builds directly on Phase 18/19 `apps/server/tests/unit/` conventions |

### Open Questions

See §Open Questions section — 5 items, all narrow (CLI `token issue` deferral, SIGHUP hot-reload, custom backends dir, structured logging, empty-string workspaceId behaviour in register).

### Ready for Planning

Research complete. Estimated scope: **4 plans** (mirroring Phase 19's shape — foundation / routes / user-facing / E2E).

- **21-01:** Shared types (`AgentMessage`, `DaemonConfigFile`) + primitives (`semaphore.ts`, `kill-escalation.ts`, `ndjson-parser.ts`) + their unit tests. Pure TDD; zero cross-cutting deps.
- **21-02:** `daemon/config.ts` + `daemon/detect.ts` + `daemon/http-client.ts` + their unit tests. Adds `execa` + `commander` npm deps; rewrites `cli.ts` with commander subcommand dispatch (default command preserves today's behaviour).
- **21-03:** `daemon/backends/claude.ts` (spawn + NDJSON consumption + control_request handling + audit trail) + `daemon/poll-loop.ts` + `daemon/cancel-poller.ts` + `daemon/main.ts` orchestrator + unit tests for each. The Claude backend end-to-end.
- **21-04:** Integration smoke test `tests/e2e/daemon-integration.spec.ts` + `tests/fixtures/fake-claude.js` + any typecheck/lint cleanup. Marked `@integration`; CI-skipped by default; proves SC-1..SC-5 against a real spawned daemon.
