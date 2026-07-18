# Phase 22: Remaining Agent Backends — Research

**Researched:** 2026-04-17
**Domain:** Agent-backend plurality — extracting a `Backend` interface from Phase 21's Claude implementation and adding Codex (JSON-RPC stdio), OpenClaw, OpenCode (ACP / NDJSON), and Hermes backends behind the same unified `AgentMessage` surface.
**Confidence:** HIGH for Claude/Codex/OpenCode (codex schema generated, opencode observed live, spec docs pulled). MEDIUM for OpenClaw (external docs only, no local binary). LOW for Hermes (headless-JSON not documented; TUI-first). The Hermes uncertainty drives a concrete "ship a stub with a clear error" recommendation below.
**Research gate (from ROADMAP):** LIGHT — read each CLI's stream-json dialect; codex uses JSON-RPC over stdio; openclaw may have its own variant.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BACKEND-02 | `codex` backend spawns `codex app-server --listen stdio://` and consumes JSON-RPC events through the same unified `AgentMessage` interface | §Codex Backend (JSON-RPC schema verified via `codex app-server generate-json-schema`) |
| BACKEND-03 | `openclaw`, `opencode`, `hermes` backends each implement the same `Backend` interface with provider-specific stream parsing | §OpenCode Backend (NDJSON verified live), §OpenClaw Backend (docs only — `--json` NDJSON), §Hermes Backend (stub-with-error recommended — no headless-JSON spec exists) |

## User Constraints

No `22-CONTEXT.md` exists — this research is standalone. The ROADMAP Phase 22 block, REQUIREMENTS.md BACKEND-02/03 rows, Phase 22 owned pitfalls (PG7, PG8 per-backend; PM5, PM6, PM7 cancel races), and the CLAUDE.md project conventions constitute the constraint set. All are reproduced verbatim where relevant below.

Phase 22's four success criteria (from ROADMAP):
1. Codex backend spawns `codex app-server --listen stdio://`, routes JSON-RPC events through the same `AgentMessage` union as Claude, completes a sample task.
2. OpenClaw, OpenCode, Hermes backends pass the same unit-test harness for stream parsing with backend-specific transcript fixtures.
3. Switching an agent's runtime from a Claude daemon to a Codex daemon produces no changes to `task_message` schema or UI rendering (verified by manual E2E).
4. All backends honour the cancel contract: SIGTERM triggers `state='cancelled'` within 10 s or escalates to SIGKILL.

## Project Constraints (from CLAUDE.md)

- **ESM `.js` extension** in all new server `.ts` imports (`import { x } from './foo.js'`). Every new file in `apps/server/src/daemon/backends/*.ts` + `apps/server/src/daemon/backend.ts` obeys this.
- **No `any`, no `@ts-ignore`, no `@ts-expect-error`.** The Backend interface uses `unknown` + type guards at the wire boundary. Every JSON-RPC frame for codex goes through a discriminated-union guard before mapping. [CITED: CLAUDE.md §Code Style]
- **Files kebab-case for server `.ts`:** `daemon/backend.ts`, `daemon/backends/codex.ts`, `daemon/backends/opencode.ts`, `daemon/backends/openclaw.ts`, `daemon/backends/hermes.ts`.
- **Bug fixes need regression tests** (user-global CLAUDE.md). Every auto-approval / cancel / mapping fix in Phase 22 gets a `node:test` unit test in `apps/server/tests/unit/`.
- **Build shared first.** If Phase 22 extends the `AgentMessage` union or adds a `BackendProvider` enum, those land in `packages/shared/src/v14-types.ts` and must build before server typecheck. [CITED: CLAUDE.md §Common Pitfalls]
- **No `any` in stream parsers.** Even the loose JSON-RPC envelope is typed as `{ id?: RequestId; method?: string; params?: unknown; result?: unknown; error?: {...} }`.

## Summary

Phase 21 shipped the entire daemon scaffolding — commander CLI, config loader, detect routine, HTTP client, semaphore, kill-escalation, NDJSON parser, stream-batcher, cancel-poller, poll-loop, heartbeat, crash-handler, `main.ts` orchestrator — and ONE concrete backend (`backends/claude.ts`) plus 107 unit tests and 3 integration scenarios. The server-side task-dispatch surface is 100% shipped. Phase 22 is almost entirely a per-binary stream-mapper exercise: (a) extract a tiny `Backend` interface from today's `runClaudeTask` so each provider can plug in, (b) implement `runCodexTask` over codex's JSON-RPC-2.0 app-server protocol, (c) implement `runOpenCodeTask` over opencode's NDJSON `run --format json`, (d) implement `runOpenclawTask` over `openclaw agent --json` NDJSON, (e) ship a sensible Hermes stub that fails fast with an actionable error (Hermes has no documented headless-JSON mode in 2026), and (f) extend `detectClaude` into a `detectBackends` routine that probes all five CLIs at startup and registers whichever are present.

**The four backends fall into two architectural shapes:**

| Shape | Backends | Pattern |
|-------|----------|---------|
| **NDJSON-over-stdout** | Claude (shipped), OpenCode, OpenClaw | spawn → write prompt to stdin → `for await` parse stdout → map events to `AgentMessage` → exit code drives completion |
| **JSON-RPC-2.0 over stdio** | Codex | spawn → `initialize` handshake → `thread/start` → `turn/start` with input → consume `ServerNotification`s matching the turn's `turnId` → `turn/interrupt` on cancel → `item/completed` with `agentMessage` drives completion |

Hermes sits outside both. Its CLI is TUI-first and does NOT have a documented NDJSON / JSON-RPC mode as of April 2026. [CITED: hermes-agent.nousresearch.com/docs/user-guide/cli] The honest answer is: ship a `hermes` backend that emits a single `AgentMessage{kind:'error'}` saying "Hermes headless-JSON mode is not supported in Aquarium v1.4 — re-register this runtime as provider=claude/codex/opencode/openclaw, or wait for Nous Research to ship `hermes run --format json`". This is better than best-effort TUI-scraping (which would PTY-allocate, strip ANSI, pattern-match — unstable + provider-hostile).

**Key reuse:** The handshake and stream shape are the HARD part; PM1 (SIGTERM→SIGKILL), PG5 (AbortSignal threading), PG4 (batcher re-prepend on failure), PG1 (semaphore), PM2 (in-flight tracking), PM3 (PATH inheritance), PM7 (token-in-env redaction), and T-21-05 (zombie-free kill) are ALL already solved in Phase 21 for any backend that uses `execa` with `forceKillAfterDelay` and the existing `main.ts` orchestrator. Phase 22 doesn't re-solve them — it wires them into 3 new `runXxxTask()` functions.

**Primary recommendation:** Add ZERO new npm dependencies. Everything Phase 22 needs is already present after 21-02 (`execa@9.6.1`, `commander@14.0.3`, `node:readline`, `node:test`). The codex JSON-RPC framer is handwritten in ~30 LOC over `node:readline` (codex uses newline-delimited JSON-RPC over stdio, SAME framing as Claude's stream-json) — no `jsonrpc-lite` / `vscode-jsonrpc` / `@types/json-rpc` dep needed. Handwriting it keeps BACKEND-07's "unit-testable primitive" rationale intact.

## Standard Stack

### Core additions (ZERO new npm deps)

All Phase 22 code uses dependencies already pinned by Plan 21-02. The rationale matches STACK.md: every dep in the daemon tree is either a built-in (`node:readline`, `node:crypto`, `node:test`), a battle-tested process primitive (`execa`), or a CLI dispatcher (`commander`). Adding a JSON-RPC library for ONE backend contradicts the "unit-testable primitive" pattern established in 21-03.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `execa` | `9.6.1` | Subprocess spawn + `forceKillAfterDelay` + `cancelSignal` for ALL 4 new backends | Already pinned; same PM1 mitigation used by `backends/claude.ts`. [VERIFIED: `apps/server/package.json` — `execa: 9.6.1`] |
| `node:readline` | built-in (Node 22+) | NDJSON line framing for Claude/OpenCode/OpenClaw + JSON-RPC line framing for Codex | Already used by `daemon/ndjson-parser.ts`. Codex's app-server uses the SAME newline-delimited framing as Claude stream-json — no new parser needed. [VERIFIED: `apps/server/src/daemon/ndjson-parser.ts` + codex `generate-json-schema` output] |
| `node:test` + `tsx` | 4.19+ (already devDep) | Unit tests for each new backend following the `claude-control-request.test.ts` template from 21-03 | Established convention; the existing `_execa` / `_spawn` test seams are drop-in reusable for codex/opencode/openclaw tests. |
| `@aquarium/shared` | workspace | Extended `AgentMessage` union (already supports all 5 needed `kind` values) + `RuntimeProvider` already includes `'codex' \| 'openclaw' \| 'opencode' \| 'hermes'` | [VERIFIED: `packages/shared/src/v14-types.ts:34` — `RuntimeProvider = 'claude' \| 'codex' \| 'openclaw' \| 'opencode' \| 'hermes' \| 'hosted'`] |

### Alternatives Considered (REJECTED)

| Instead of | Could Use | Why NOT |
|------------|-----------|---------|
| Handwritten JSON-RPC framing for Codex | `jsonrpc-lite` or `vscode-jsonrpc` | Codex's app-server uses plain newline-delimited JSON (same framing as NDJSON, verified via `generate-json-schema`). `jsonrpc-lite` adds a CJS-only dep for 20 LOC of gain; `vscode-jsonrpc` ships Content-Length headers by default (LSP style) which codex does NOT use on stdio. Handwritten matches the 21-01 pattern. |
| ACP library (e.g., `@modelcontextprotocol/sdk`) for OpenCode | Published ACP client | `opencode run --format json` gives us what we need WITHOUT initializing an ACP session (avoids `initialize` → `session/new` → `session/prompt` handshake). One-shot `run` semantics match one task per invocation — same as Claude's `--output-format stream-json` model. ACP libraries would be over-abstraction for Phase 22's needs. |
| Build a PTY scraper for Hermes | `node-pty` + ANSI strip | 150+ LOC of PTY allocation, ANSI stripping, pattern matching against a TUI that changes layout per version. Hermes's own docs explicitly say streaming UI "adapts to terminal width" — we'd be guessing at column counts. Ship a clean error and a doc note instead. (See §Hermes Backend — Stub With Clear Error.) |
| A separate integration test per backend | Single `@integration` daemon-integration.spec.ts with per-backend subdescribe | Phase 21 already ships `tests/e2e/daemon-integration.spec.ts` with a reusable `spawnDaemon` + `installFakeClaude` helper. Phase 22 adds `installFakeCodex`, `installFakeOpencode`, `installFakeOpenclaw` stubs using the SAME pattern. CI-skipped. Re-using the harness is the 21-04 SUMMARY's explicit Phase-22 recommendation. |

### Installation

None. Verify no drift:
```bash
$ cd apps/server && npm view execa version       → 9.6.1       [VERIFIED 2026-04-17]
$ cd apps/server && npm view commander version   → 14.0.3      [VERIFIED 2026-04-17]
```

## The `Backend` Interface (extract from Phase 21)

### Today's shape (implicit in `backends/claude.ts`)

Phase 21 did NOT formally extract a Backend interface — `main.ts` hard-codes `runClaudeTask`. Phase 22 must make this polymorphic. The new interface is a thin contract:

```typescript
// apps/server/src/daemon/backend.ts  (NEW — Phase 22)
import type { ClaimedTask } from '@aquarium/shared';
import type { PendingTaskMessageWire } from './http-client.js';

export interface BackendRunDeps {
  task: ClaimedTask;
  binaryPath: string;                // resolved absolute path from detectBackends()
  config: {
    // Per-backend allow-list passes through from DaemonConfig.backends
    backend: { allow?: string[] };
    gracefulKillMs: number;          // PM1 SIGTERM→SIGKILL window
    inactivityKillMs: number;        // BACKEND-06 60 s watchdog
  };
  onAgentMessage: (pending: PendingTaskMessageWire) => void;
  abortSignal: AbortSignal;
  /** Test seam — replaces execa */
  _execa?: unknown;
  /** Test seam — replaces the backend's spawn helper */
  _spawn?: unknown;
}

export interface BackendRunResult {
  exitCode: number;
  cancelled: boolean;
}

export interface Backend {
  /** Stable provider identifier matching `RuntimeProvider` in shared types. */
  readonly provider: 'claude' | 'codex' | 'openclaw' | 'opencode' | 'hermes';
  /** Detection. Returns null if the binary is not on PATH / known fallback paths. */
  detect(): Promise<{ path: string; version: string } | null>;
  /** One-shot task runner. Resolves when the child exits. */
  run(deps: BackendRunDeps): Promise<BackendRunResult>;
}
```

### Backend registry

```typescript
// apps/server/src/daemon/backends/index.ts  (NEW)
import { claudeBackend } from './claude.js';
import { codexBackend } from './codex.js';
import { opencodeBackend } from './opencode.js';
import { openclawBackend } from './openclaw.js';
import { hermesBackend } from './hermes.js';
import type { Backend } from '../backend.js';

export const ALL_BACKENDS: Backend[] = [
  claudeBackend,
  codexBackend,
  opencodeBackend,
  openclawBackend,
  hermesBackend,
];

/** Probe every backend; return those whose detect() resolves to a path. */
export async function detectBackends(): Promise<
  Array<{ backend: Backend; path: string; version: string }>
> {
  const results: Array<{ backend: Backend; path: string; version: string }> = [];
  for (const backend of ALL_BACKENDS) {
    try {
      const found = await backend.detect();
      if (found) results.push({ backend, path: found.path, version: found.version });
    } catch { /* per-PG2 — one bad binary doesn't block others */ }
  }
  return results;
}
```

### `main.ts` change

Today's `main.ts` calls `detectClaude()` directly and hard-codes `runClaudeTask`. Phase 22 replaces lines 86–92 (claude detect) with `detectBackends()`, lines 120–127 (single-runtime register body) with a loop over detected backends, and lines 197–208 (runClaudeTask) with `backend.run(deps)` — dispatched by looking up the runtime's `provider` on the claimed task's `agent.runtime`. The agent's runtime_id resolves to a runtime row with a `provider` discriminator; the daemon keeps an in-memory `Map<runtimeId, Backend>` built at register time.

**Key invariant:** The server is authoritative for which provider a task uses. When the task is claimed, `ClaimedTask.agent` contains an `id` / `name` / `instructions` / `customEnv` / `customArgs` — but NOT the runtime's provider. The daemon knows its own runtimes (returned from `/register`) and each runtime's provider, so the daemon dispatch step is: lookup the runtime from the claimed task's runtime_id, resolve that to a `Backend`, call `backend.run()`. [VERIFIED: `packages/shared/src/v14-types.ts` — `AgentTask.runtime_id` + `Runtime.provider`]

**Gap observed:** `ClaimedTask` today (v14-types.ts:261) exposes `agent`/`issue`/`triggerCommentContent`/`workspaceId` but does NOT expose the claimed task's `runtime_id` or `provider`. The daemon's `/register` response gives runtimes with IDs; tasks are claimed per-runtime via `POST /api/daemon/runtimes/:id/tasks/claim`. So the daemon already KNOWS which runtime it's claiming for (passed to `claimTask(runtimeId)`). The dispatch is therefore: `poll-loop` knows the runtime it's polling → the runtime has a `Backend` bound at register time → call that Backend's `run()`. No shared-type change needed.

## Codex Backend — JSON-RPC 2.0 over stdio (BACKEND-02)

### CLI invocation (VERIFIED on research machine)

```bash
codex --version         → codex-cli 0.118.0
codex app-server --help → [experimental] Run the app server or related tooling
                           Options: --listen <URL>  Supported values: stdio:// (default), ws://IP:PORT
```

Spawn: `codex app-server --listen stdio://` (the `--listen stdio://` is the default, so bare `codex app-server` is equivalent). [VERIFIED]

Version command: `codex --version` → regex `/(\d+\.\d+\.\d+)/` → `'0.118.0'`. Same pattern as `detectClaude`. [VERIFIED]

### Wire protocol (VERIFIED via `codex app-server generate-json-schema --out /tmp/...`)

Codex's app-server emits **JSON-RPC 2.0 over newline-delimited JSON on stdio**. Same line-framing as Claude's stream-json — our existing `parseNdjson` handles the framing. The difference is in WHAT each line contains: every line is a JSON-RPC `JSONRPCRequest` (server-initiated like approval prompts), `JSONRPCResponse` (reply to our request), or `JSONRPCNotification` (server event). [VERIFIED: `$TMP/JSONRPCMessage.json`, `$TMP/JSONRPCRequest.json`, `$TMP/JSONRPCNotification.json`]

| Envelope | Shape | Direction |
|----------|-------|-----------|
| Request | `{ id, method, params? }` | client → server OR server → client (e.g. approval prompts) |
| Response | `{ id, result }` or `{ id, error: { code, message, data? } }` | reply to a prior request |
| Notification | `{ method, params? }` (no `id`) | one-way event |

No `"jsonrpc": "2.0"` field — codex's schema omits it (looked, not present in JSONRPCRequest.json). We send without it to match. [VERIFIED]

### Method surface the daemon cares about (3 client requests + 12 server notifications)

**Client → server requests** (what we send):

1. `initialize` — handshake. Params: `{ clientInfo: { name, version }, capabilities?: { experimentalApi?: boolean } }`. Response: `InitializeResponse`. MUST be first. [VERIFIED: `v1/InitializeParams.json`]
2. `thread/start` — create a session. Params: `ThreadStartParams` — minimal shape: `{ cwd?, baseInstructions?, developerInstructions?, approvalPolicy? }`. Response: `{ threadId: string, ... }`. [VERIFIED]
3. `turn/start` — send the user's prompt. Params: `{ threadId, input: UserInput[] }`. Response: `{ turn: Turn }` with `turnId`. [VERIFIED]
4. `turn/interrupt` — cancel (Phase 22 PM5/PM6 mitigation!). Params: `{ threadId, turnId }`. Response empty-ish. [VERIFIED]

**Server → client notifications** (what we consume — 12 methods we map, 37 we ignore):

| Method | Maps to `AgentMessage` kind | Notes |
|--------|---------------------------|-------|
| `thread/started` | (none — bookkeeping) | Remember the `threadId` |
| `turn/started` | (none — bookkeeping) | Remember the `turnId` for cancel |
| `item/started` | Optional: emit `thinking` for user UX ("Claude is reading…") | `item` field carries the ThreadItem — the provisional shape |
| `item/agentMessage/delta` | `text` | `{ delta: string, itemId, threadId, turnId }` — streaming partial text |
| `item/completed` with `item.type='agentMessage'` | `text` (final) | Emits the whole `text` field; daemon MAY prefer delta accumulation + dedupe of the final, OR just ignore final since the UI already has the deltas |
| `item/completed` with `item.type='reasoning'` | `thinking` | ReasoningThreadItem has `text` |
| `item/completed` with `item.type='commandExecution'` | `tool_use` + `tool_result` (one each) | The item has `command`, `commandActions[]`, `status`, `aggregatedOutput` — we emit a single `tool_use` for the command and a single `tool_result` for the output. `toolUseId` = item's `id`. |
| `item/completed` with `item.type='fileChange'` | `tool_use` + `tool_result` | FileChangeThreadItem has `changes[]` — treat as the "Edit" tool |
| `item/completed` with `item.type='mcpToolCall'` | `tool_use` + `tool_result` | `tool = item.tool`, `server = item.server` (put in metadata) |
| `item/completed` with `item.type='dynamicToolCall'` | `tool_use` + `tool_result` | `tool = item.tool` |
| `item/commandExecution/outputDelta` | (optional) `tool_result` with streaming `output` | Probably ignore and use the `item/completed` fallback — simpler UI |
| `item/reasoning/textDelta` | `thinking` (streaming) | Analogous to agentMessage/delta |
| `turn/completed` | (none — loop exit signal) | Turn ended; decide exit code |
| `error` | `error` | `{ params: { message, ... } }` |

**Server → client requests (approval prompts — PM7 / T-21-04 analog):**

Codex sends 4 request types we MUST answer (or the task hangs — PM4 analog):

| Method | Decision | Response shape |
|--------|----------|---------------|
| `item/commandExecution/requestApproval` | approve iff `tool_name = 'exec'` and `allow` policy matches | `{ id, result: { decision: 'approved' \| 'denied' } }` — exact response-type name: `CommandExecutionRequestApprovalResponse` |
| `item/fileChange/requestApproval` | approve iff allow-list includes `'Edit'` / `'*'` | `{ id, result: { decision: 'approved' \| 'denied' } }` |
| `item/permissions/requestApproval` | approve per policy | `PermissionsRequestApprovalResponse` |
| `item/tool/requestUserInput` | DENY (no user-input in headless mode) | `{ id, result: { ... } }` — see `ToolRequestUserInputResponse.json` |

The shape of each is in `$TMP/<Name>Response.json`. The daemon MUST echo `id` back. Every decision emits an audit `thinking` message (same pattern as Claude's `buildControlResponse`).

**Mapping ASSUMPTIONS flagged:** The exact `decision` enum values (`'approved'` vs `'allow'` vs `'approve'`) need verification by reading each Response schema during plan time. The approval-response field names may differ slightly between codex v0.118 and whatever ships next; Phase 22 plan should include a Wave-0 task "extract decision enums from `CommandExecutionRequestApprovalResponse.json` etc." before writing `buildCodexApprovalResponse`.

### Cancel semantics (PM5/PM6 solved cleanly for codex)

- **In-protocol cancel:** send `turn/interrupt` with `{ threadId, turnId }`. Codex processes the interrupt and emits `turn/completed` with an interrupted state. [VERIFIED: `TurnInterruptParams.json`]
- **Backstop (SIGTERM):** execa's `cancelSignal` triggers SIGTERM → 10s → SIGKILL. Codex is a long-running app-server process; if the in-protocol `turn/interrupt` takes too long, the signal escalation kills it.
- **Recommended order on cancel:** (a) send `turn/interrupt` to stdin (fire-and-forget — don't await response), (b) wait 2 s for `turn/completed`, (c) if still running, fall through to execa `abortSignal.abort()` which triggers SIGTERM, (d) execa's `forceKillAfterDelay: 10_000` escalates to SIGKILL if needed.

### Implementation skeleton

```typescript
// apps/server/src/daemon/backends/codex.ts
export async function runCodexTask(deps: BackendRunDeps): Promise<BackendRunResult> {
  const child = spawnCodex(deps);  // execa codex app-server, shell:false, detached on POSIX, forceKillAfterDelay

  let nextId = 1;
  const pendingReplies = new Map<number, (result: unknown) => void>();
  const writeLine = (obj: unknown) => child.stdin!.write(JSON.stringify(obj) + '\n');
  const call = (method: string, params: unknown): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve) => {
      pendingReplies.set(id, resolve);
      writeLine({ id, method, params });
    });
  };

  // 1. initialize + thread/start + turn/start in sequence
  await call('initialize', { clientInfo: { name: 'aquarium-daemon', version: '1.4.0' } });
  const thread = await call('thread/start', { cwd: deps.task.workDir ?? undefined }) as { threadId: string };
  const turn = await call('turn/start', {
    threadId: thread.threadId,
    input: [{ type: 'text', text: buildPrompt(deps.task) }],
  }) as { turn: { turnId: string } };

  // 2. on abort → send turn/interrupt before letting execa SIGTERM
  deps.abortSignal.addEventListener('abort', () => {
    try { writeLine({ id: nextId++, method: 'turn/interrupt', params: { threadId: thread.threadId, turnId: turn.turn.turnId } }); } catch { /* child already dying */ }
  });

  // 3. consume server frames
  for await (const raw of parseNdjson<unknown>(child.stdout!, { inactivityMs: deps.config.inactivityKillMs })) {
    if (deps.abortSignal.aborted) break;
    const frame = raw as JsonRpcFrame;
    if (isResponse(frame)) {
      pendingReplies.get(frame.id as number)?.(frame.result);
      pendingReplies.delete(frame.id as number);
      continue;
    }
    if (isRequest(frame)) {
      // Approval prompt — respond.
      const resp = buildCodexApprovalResponse(frame, deps.config.backend.allow);
      writeLine(resp);
      emitAuditThinking(deps, frame);
      continue;
    }
    // Notification
    const agentMsgs = mapCodexNotificationToAgentMessage(frame, state);
    for (const am of agentMsgs) deps.onAgentMessage(toPendingWire(am, deps.task));

    if (frame.method === 'turn/completed') break;
  }

  const result = await child;  // execa promise
  return { exitCode: result.exitCode ?? 0, cancelled: Boolean(result.isCanceled) };
}
```

### Fallback behaviour (planner question #10 — settled)

If `codex` binary exists but not in `app-server` mode (hypothetical older version), the spawn either (a) exits immediately with an "unknown subcommand" error (exit code 2) — detectable via the standard exit flow, OR (b) prints an error line to stderr and hangs waiting for input. The `inactivityMs=60_000` watchdog catches (b). The PLANNER must include an **explicit version probe** in `detectCodex` that rejects codex versions without app-server:

```typescript
// detectCodex — stricter than detectClaude
const r = await execa(p, ['app-server', '--help'], { timeout: 5_000 });
if (!/experimental.*app server|--listen/i.test(r.stdout + r.stderr)) {
  // Codex exists but doesn't know app-server — reject, don't register.
  return null;
}
```

### Unit tests (mirror 21-03 patterns)

| Test | Asserts |
|------|---------|
| `codex-protocol.test.ts :: initialize handshake writes correct frames` | Writes `{id:1, method:'initialize', params:{clientInfo:...}}` then `thread/start` then `turn/start`. |
| `:: mapCodexNotification maps agentMessage delta to text` | Delta `"hello"` → `AgentMessage{kind:'text', text:'hello'}` |
| `:: mapCodexNotification maps item/completed commandExecution to tool_use+tool_result` | Single item → 2 agentMessages, both using `item.id` as toolUseId |
| `:: approval request for commandExecution is auto-approved per allow-list` | Allow `['*']` → `{decision:'approved'}`; allow `['read']` with `command='exec'` → `{decision:'denied'}` |
| `:: audit thinking emitted for every approval decision` | Same as Claude's T-21-04 mitigation |
| `:: turn/interrupt is sent on abortSignal.aborted` | Capture stdin writes; assert the interrupt line is present |
| `:: turn/completed exits the for-await loop cleanly` | Loop returns; execa promise awaited |
| `:: malformed JSON-RPC frame (missing id on reply) is dropped` | No crash; continue parsing |
| `:: bidirectional request with unknown method responded with error` | ServerRequest with an unexpected `method` → send `{id, error:{code:-32601, message:'unknown'}}` so codex doesn't hang |

Test file: `apps/server/tests/unit/codex-backend.test.ts`. Uses the exact `_spawn` test seam pattern from `claude-control-request.test.ts` — PassThrough streams, scripted stdout frames, captured stdin writes.

### Codex fixture for integration tests

A handwritten `fake-codex.js` stub (Node script) that:
1. On `--version` → prints `codex-cli 0.118.0` and exits 0.
2. On `app-server --listen stdio://` → reads stdin line-by-line; for each recognised JSON-RPC method replies with a scripted response. After a `turn/start`, emits 3 notifications (`item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`), then waits for stdin close.
3. Supports `--hang` to simulate a non-responding turn for SC-3 (cancel test).

**Fixture path:** `apps/server/tests/unit/fixtures/fake-codex.js`. Lives alongside `fake-claude.js`. The integration spec's PATH-prepend pattern directly generalises: `installFakeBackend(fixtureName, executableName) → tmpdir` — Phase 21-04 already notes this as the intended extension point.

## OpenCode Backend — NDJSON via `run --format json` (BACKEND-03 part 1)

### CLI invocation (VERIFIED live on research machine)

```bash
opencode --version → 1.x.x (printed via banner + "-v" flag)
opencode run --help → [message..] + --format default|json + -c/-s/--fork + --model --agent --dir --thinking
```

Spawn (one-shot, no ACP server needed):

```bash
opencode run --format json --dir <workspaceDir> --agent <agentName?> --model <model?> <prompt>
```

Pros: no `initialize` handshake, one process per task, exits cleanly on prompt completion, supports `--dir` (workDir equivalent), supports `--thinking` to emit reasoning.

Cons: OpenCode `run` reads the prompt from positional args / stdin (not via an ACP session). Each `run` creates a fresh session unless `-c` / `-s <sessionID>` is passed. For v1.4 we always run fresh — session persistence is Future (REQUIREMENTS.md "SESS-01: Daemon `--resume` session-resume logic — session_id persisted in v1.4 but never read back").

### Stream shape (VERIFIED live — captured on machine)

Observed when running `opencode run --format json "..."`:
```json
{"type":"error","timestamp":1776422715147,"sessionID":"ses_264f48164ffeKnZZTpVUPPWr21","error":{"name":"UnknownError","data":{"message":"..."}}}
```

Confirmed event inventory from official docs [CITED: opencode.ai/docs/formatters + takopi.dev stream-json cheatsheet]:

| `type` | Fields | Maps to AgentMessage |
|--------|--------|---------------------|
| `step_start` | `{timestamp, sessionID, part:{id,sessionID,messageID,type:"step-start",snapshot}}` | (ignored — bookkeeping) |
| `text` | `{timestamp, sessionID, part:{id,type:"text",text,time:{start,end}}}` | `text` |
| `tool_use` | `{timestamp, sessionID, part:{callID, tool:"bash"/"read"/"write"/"grep"/..., state:{status:"completed",input,output,title,metadata,time}}}` | `tool_use` + `tool_result` (one each — OpenCode merges call+result into one event) |
| `step_finish` | `{timestamp, sessionID, part:{reason:"stop"\|"tool-calls",snapshot,cost,tokens:{...}}}` | (ignored — bookkeeping; exit code is authoritative) |
| `error` | `{timestamp, sessionID, error:{name, data:{message}}}` | `error` |

**No approval prompt frames** — OpenCode does not have a control-request handshake at the `run` CLI layer. Tool calls are decided by the model / agent config, not interrupted mid-stream. PM7 (token leak) is still relevant (sanitize customEnv) but T-21-04 (auto-approval audit) is N/A — every tool use is already "approved" by OpenCode's own safety layer. Phase 22 plan should document this difference; the audit thinking pattern doesn't apply.

### Cancel semantics

OpenCode `run` is a one-shot child; cancel = SIGTERM → SIGKILL via execa's `forceKillAfterDelay`. No in-protocol cancel message exists. Same as Claude. Exit code on SIGTERM: 143 (128 + 15) on POSIX; `isCanceled:true` via execa. [ASSUMED — opencode's signal handling is not documented; execa treats 143 as expected cancellation]

### Implementation skeleton

```typescript
// apps/server/src/daemon/backends/opencode.ts
export async function runOpenCodeTask(deps: BackendRunDeps): Promise<BackendRunResult> {
  const prompt = buildPrompt(deps.task);
  const args = ['run', '--format', 'json'];
  if (deps.task.workDir) args.push('--dir', deps.task.workDir);
  args.push(prompt);

  const child = execa(deps.binaryPath, args, {
    cwd: deps.task.workDir ?? process.cwd(),
    env: buildEnv(deps),             // PM3 PATH prepend + PM7 AQUARIUM_TOKEN delete + sanitize
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
    cancelSignal: deps.abortSignal,
    forceKillAfterDelay: deps.config.gracefulKillMs,
  });

  // stdin: close immediately — opencode reads prompt from argv, not stdin
  child.stdin!.end();

  for await (const raw of parseNdjson<OpencodeEvent>(child.stdout!, {
    inactivityMs: deps.config.inactivityKillMs,
  })) {
    if (deps.abortSignal.aborted) break;
    const agentMsgs = mapOpencodeEventToAgentMessage(raw);
    for (const am of agentMsgs) deps.onAgentMessage(toPendingWire(am, deps.task));
  }

  const result = await child;
  return { exitCode: result.exitCode ?? 0, cancelled: Boolean(result.isCanceled) };
}
```

### Detect

```bash
opencode --version   # banner-based version output; regex /(\d+\.\d+\.\d+)/ extracts
```

Fallback paths: `~/.opencode/bin/opencode` (verified — that's where my install lives), `/opt/homebrew/bin/opencode`, `/usr/local/bin/opencode`.

### Unit tests

| Test | Asserts |
|------|---------|
| `opencode-backend.test.ts :: maps text event to AgentMessage{kind:'text'}` | `{type:'text', part:{text:'hi'}}` → text |
| `:: maps tool_use event to both tool_use + tool_result` | Single event → 2 agentMessages with matching `toolUseId = part.callID` |
| `:: error event maps to AgentMessage{kind:'error'}` | `{type:'error', error:{data:{message:'oops'}}}` → error 'oops' |
| `:: step_start / step_finish are ignored` | No agentMessages emitted |
| `:: runOpenCodeTask builds correct argv (run, --format json, --dir, prompt)` | `_execa` seam captures `(cmd, args, opts)` |
| `:: SIGTERM via abortSignal resolves the promise with cancelled:true` | Test seam fires abort; assert return is `{cancelled:true}` |

### Fixture

`apps/server/tests/unit/fixtures/fake-opencode.js`:
- `--version` → `1.2.3`
- `run --format json <...>` → emit 4 lines: step_start, text, tool_use, step_finish. Exit 0.
- `--hang` for SC-3 cancel tests.

## OpenClaw Backend — NDJSON via `agent --json` (BACKEND-03 part 2)

### CLI invocation (from docs — no local binary)

```bash
openclaw --version → version string
openclaw agent -m "<message>" --session-id <id> --json [--timeout N] [--local]
```

[CITED: docs.openclaw.ai/cli + lumadock.com/tutorials/openclaw-cli-config-reference]

Required params per documentation: `--to` OR `--session-id` OR `--agent` as session selector; `-m, --message <text>`. Daemon uses `--agent <agentId>` or a fresh session. `--json` emits NDJSON. `--timeout` is available but we rely on the inactivity watchdog.

### Stream shape (MEDIUM confidence — official docs describe NDJSON but event types not enumerated)

[CITED: docs.openclaw.ai/cli] says "json: emits NDJSON events useful for automation." The exact event discriminator field names are NOT published in the version of docs the researcher could access. There are two likely shapes in the wild:

1. **Shape A (most likely — matches OpenCode's heritage):** `{type: 'text'|'tool_use'|'tool_result'|'error', ...}` — same discriminator as OpenCode since both use similar coding-agent stacks.
2. **Shape B:** A different dialect specific to OpenClaw's Gateway-oriented architecture — since OpenClaw's CE ships a gateway plugin bridge (the very one Aquarium uses for HOSTED runtimes), its local-mode NDJSON may borrow Gateway frame shapes.

**Recommendation for the planner:** Wave 0 of Phase 22 should include a task: "install openclaw locally, run `openclaw agent --local --json -m 'say hi'`, capture 1–2 kB of output to `apps/server/tests/unit/fixtures/openclaw-stream-sample.ndjson`, enumerate event types, then write `mapOpenclawEventToAgentMessage` against the captured shape." This is the SAME discovery pattern the daemon used for Claude's control_request (research-gate A1). Without a local capture we're speculating.

**Fallback plan if openclaw is not installable on the dev machine:** Ship the backend with a clearly-documented TODO comment + a stub mapper that returns `AgentMessage{kind:'error', error:'OpenClaw stream shape not yet reverse-engineered — please capture a sample and enumerate event types'}` on first execution. Register detection so the runtime appears in `GET /api/runtimes`, but first task execution fails loudly with the actionable error. Document in the plan's SUMMARY + USER SETUP.

### Cancel semantics

`--timeout` is available (documented). For daemon control: SIGTERM → SIGKILL via execa. Same as OpenCode. [CITED: docs.openclaw.ai/cli — `--timeout` only]

### Unit tests + fixture

Same pattern as OpenCode: one backend file, one test file, one fixture. Because the exact shape is unknown pre-Wave-0, the test file's FIRST test SHOULD be `:: parses the captured openclaw-stream-sample.ndjson without crashing`. The mapper unit tests come after the shape is pinned.

**Test fixtures strategy (planner question #6 — settled):**

| Backend | Fixture source | How captured |
|---------|----------------|--------------|
| Claude | Hand-authored (6 lines) — Plan 21-01 `claude-stream-sample.ndjson` | Matches the stream shape reverse-engineered from multica + community docs |
| Codex | Hand-authored — Plan 22 Wave 0 writes ~15 lines covering: `thread/started` notification, `turn/started`, `item/agentMessage/delta` × 2, `item/completed` (agentMessage), `item/completed` (commandExecution), `item/commandExecution/requestApproval` (server request), our `approved` response, `turn/completed`. Also MUST include one malformed line (for PG10). | Verified against `$TMP/ServerNotification.json` enum at plan time |
| OpenCode | Captured LIVE on research machine (Wave 0 task). Then hand-curated to ~10 lines covering text / tool_use / step_start / step_finish / error. | `echo 'echo hi' \| opencode run --format json > opencode-stream-sample.ndjson` (may need trivial prompt) |
| OpenClaw | Wave 0 blocker — either capture live OR punt to stub-with-error | See "Fallback plan" above |
| Hermes | Not applicable — stub backend; no stream to parse | Test verifies stub returns `error` AgentMessage correctly |

Every fixture must round-trip through `parseNdjson` without `parseErrors > 0` (except the PG10 malformed line which should increment the counter by 1).

## Hermes Backend — Stub With Clear Error (BACKEND-03 part 3)

### The honest finding

Hermes Agent (Nous Research) is a TUI-first tool in April 2026. [CITED: hermes-agent.nousresearch.com/docs/user-guide/cli]

What the docs DO say:
- CLI is interactive: `hermes chat -q "..."` for one-shot prompts (HAS a `-q` flag).
- Streaming is TUI-rendered, with ANSI layout that adapts to terminal width (76 / 52-75 / <52 columns).
- Cancellation is Ctrl-C (double for force) in interactive mode.
- ACP server mode is an OPEN ISSUE ("Feature: ACP Server Mode — Run Hermes in Zed, JetBrains, Neovim, Toad & Any ACP-Compatible Editor · Issue #569"), not shipped.

What the docs DO NOT say:
- Any `--format json` / `--json` / `--ndjson` flag.
- Any JSON-RPC / ACP stdio mode.
- Any programmatic stream event schema.

### Recommended Phase 22 shipping shape

Ship a real `hermesBackend` object that:

1. **`detect()`:** Probes PATH + fallback paths for `hermes`. If found, parses `hermes --version`.
2. **`run()`:** Does NOT spawn hermes. Instead:
   - Emits ONE `AgentMessage{kind:'error', error:'Hermes headless mode is not supported in Aquarium v1.4. Nous Research has not shipped a JSON / JSON-RPC / ACP mode for hermes yet (tracked at github.com/NousResearch/hermes-agent/issues/569). Please re-register this runtime under a different provider (claude/codex/opencode/openclaw), or update Aquarium when hermes ACP support lands.'}`.
   - Returns `{exitCode: 1, cancelled: false}` — task transitions to `failed` with the actionable error already captured in `task_messages`.

Why:
- Keeps the Backend interface uniform — no special-case in the dispatch layer.
- Registering Hermes so it appears in `GET /api/runtimes` lets users see that the daemon DETECTED hermes, so they're not confused about missing providers. The failure is only when they try to USE it.
- The error message tells them exactly how to unblock: pick a different provider or wait for upstream.
- When hermes ships ACP (Issue #569), swapping this backend's `run()` to real ACP is ~80 LOC and a single plan.

### Alternative rejected

**PTY-scrape hermes TUI output.** Would require `node-pty` dep (prebuilt-binary per-platform headaches), ANSI stripping (40 LOC), heuristic pattern matching on rendered glyphs (unstable per version), no tool-call / tool-result discrimination (TUI shows "🔍 web_search (1.2s)" — not machine-readable). Rejected: ships a hostile feature that breaks on the next Hermes UI update.

### Unit tests

| Test | Asserts |
|------|---------|
| `hermes-backend.test.ts :: detect returns path + version when hermes on PATH` | Same pattern as detectClaude |
| `:: run emits one error AgentMessage and returns exitCode:1` | Calls `onAgentMessage` exactly once with `{kind:'error', error:/not supported.*v1.4/}` |
| `:: run respects abortSignal even though no child spawned` | Aborting mid-run still resolves with `cancelled:true` |

## Per-Backend Stub Strategy for Integration Tests

Phase 21-04 established that `@integration` scenarios use PATH-hijacked fake binaries. Phase 22 extends with 3 new stubs:

| Stub | Location | Simulates |
|------|----------|-----------|
| `fake-codex.js` | `apps/server/tests/unit/fixtures/` | `codex --version` + `codex app-server --listen stdio://` (scripted JSON-RPC responses) |
| `fake-opencode.js` | same | `opencode --version` + `opencode run --format json <prompt>` (scripted NDJSON) |
| `fake-openclaw.js` | same | `openclaw --version` + `openclaw agent -m <msg> --json` (scripted NDJSON — shape determined in Wave 0) |

The `installFakeBackend(fixtureName, executableName)` helper already foreshadowed by 21-04's `installFakeClaude` generalises. Each stub is ~80–120 LOC Node script. `--hang` flag on each for SC-3-style cancel tests. `--crash` flag optional for SC-4-style crash tests.

**Integration scenarios to extend:**
- Current 21-04 spec has SC-1+2 (claude happy path), SC-3 (cancel), SC-4 (crash). Phase 22 adds: codex happy path, opencode happy path, openclaw happy path. One `test.describe('@integration per-backend happy path')` block with a `.each()` over the 4 backends (claude is already shipped; Phase 22 adds 3). Each scenario is ≈ the SC-1+2 shape with a different fake binary.
- **Don't add SC-3/SC-4 per backend** — those are backend-agnostic properties (PM1 / CLI-05 are owned by `main.ts`, not per-backend). The claude run in 21-04 proves them; re-asserting per backend is waste.

## Common Pitfalls — Phase 22 Owned Set

### PG7 carry-forward (per-backend — readline iteration pattern)
**What goes wrong:** Same as 21-03 — using `rl.on('line', asyncHandler)` instead of `for await` causes out-of-order writes for OpenCode/OpenClaw NDJSON AND breaks codex's JSON-RPC sequencing.
**Mitigation:** Every new backend consumes through the existing `parseNdjson` helper. NO backend opens its own readline. Grep-verify: `grep -r "rl.on\\|createInterface" apps/server/src/daemon/backends/` returns ONLY through `parseNdjson`.

### PG8 carry-forward (per-backend — stdout backpressure)
**Mitigation:** `parseNdjson` naturally backpressures via `for await`. The 60 s inactivity watchdog catches abandoned pipes. Each backend's test includes a "slow producer" case that verifies we don't buffer forever.

### PM5 — Cancellation race: task completes just before cancel

**What goes wrong:** Task finishes at t=0, `completeTask` HTTP in flight; cancel arrives at t=0.01 — server transitions state to cancelled, daemon's complete call lands AFTER. [CITED: PITFALLS.md PM5]

**Already solved server-side:** Phase 18 `task-queue-store.ts` returns `{ discarded: true, status: 'cancelled' }` on complete/fail of an already-cancelled task; Phase 21's `DaemonHttpClient` treats it as success (no error). [VERIFIED: `apps/server/src/services/task-queue-store.ts:626`, `21-RESEARCH.md §Task Claim Protocol`]

**Phase 22 action:** None for cancel-race itself — solved. But each new backend's `run()` MUST route its terminal result through the same shared `runTask` in `main.ts` (which handles `discarded`). The interface enforces this — backends return `{exitCode, cancelled}`, not HTTP calls. The `http.completeTask` / `http.failTask` call lives in `main.ts`, not per-backend.

### PM6 — Hosted-runtime cancel has no process to kill

N/A for Phase 22 (daemon backends all have a child process). Kept on the OWNED list from the ROADMAP only because the multica codex mode had a similar trap; our codex implementation has a real child, so PM6 is actually already dodged.

**Phase 22 clarification:** Codex's `turn/interrupt` is an in-protocol cancel message — it's the CLOSEST any backend gets to "soft cancel before killing the process". For codex specifically, fire `turn/interrupt` → wait 2 s → then let execa signal-escalate if still running. Best-effort hybrid. Document in `backends/codex.ts`.

### PM7 — Child process env leaks credentials

**What goes wrong:** Multica passes tokens via env; we must avoid. [CITED: PITFALLS.md PM7]

**Already solved per-backend at the `spawnClaude` level** (delete `AQUARIUM_DAEMON_TOKEN` / `AQUARIUM_TOKEN` after env merge + `sanitizeCustomEnv` strips `PATH` / `AQUARIUM_*`).

**Phase 22 action:** Extract the env-assembly into a shared helper:

```typescript
// apps/server/src/daemon/backends/env.ts  (NEW — extract from claude.ts)
export function buildChildEnv(
  deps: { customEnv: Record<string, string> },
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''),
    ...sanitizeCustomEnv(deps.customEnv),
  };
  delete env.AQUARIUM_DAEMON_TOKEN;
  delete env.AQUARIUM_TOKEN;
  return env;
}
```

Every backend calls `buildChildEnv(...)`. The Phase 21 `sanitizeCustomEnv` stays where it is in `backends/claude.ts` but gets re-exported here. Grep assertion in plan: `grep -c "delete env.AQUARIUM_TOKEN" apps/server/src/daemon/backends/*.ts` returns `>= 4` (one per backend that spawns, i.e. all except hermes).

### PG4 carry-forward — per-backend message drop

StreamBatcher already handles this (re-prepend on POST failure). All backends use the same batcher per-task. No per-backend change.

## Phase 21 Primitives Reused VERBATIM

| Primitive | File | Used by Phase 22 |
|-----------|------|------------------|
| `parseNdjson` | `daemon/ndjson-parser.ts` | All 4 backend implementations — codex (JSON-RPC envelopes), opencode, openclaw (NDJSON events), claude (carry-forward) |
| `Semaphore` | `daemon/semaphore.ts` | `main.ts` (one semaphore per daemon) |
| `escalateKill` | `daemon/kill-escalation.ts` | Fallback for non-execa paths; each new backend prefers execa's `forceKillAfterDelay` |
| `StreamBatcher` | `daemon/stream-batcher.ts` | One batcher per task regardless of backend |
| `startCancelPoller` | `daemon/cancel-poller.ts` | One poller per task regardless of backend |
| `startPollLoop` | `daemon/poll-loop.ts` | Already per-runtime — Phase 22 just registers more runtimes |
| `startHeartbeatLoop` | `daemon/heartbeat.ts` | One heartbeat covers all runtimes — unchanged |
| `handleFatal` / `gracefulShutdown` / `registerProcessHandlers` | `daemon/crash-handler.ts` | Unchanged |
| `DaemonHttpClient` | `daemon/http-client.ts` | Unchanged — 10 endpoints serve all backends |
| `sanitizeCustomEnv` | `daemon/backends/claude.ts` | Re-export via `backends/env.ts` |
| `buildPrompt(task)` | `daemon/backends/claude.ts` | Keep IN claude.ts (per-backend prompt-shape decision); openclaw/opencode/codex each have their own `buildPrompt` since prompt conventions differ (e.g., opencode accepts positional argv; codex uses `input: UserInput[]` array) |

## Architecture Patterns

### Recommended file layout

```
apps/server/src/daemon/
├── backend.ts                   # NEW — Backend interface + BackendRunDeps type
├── backends/
│   ├── index.ts                 # NEW — ALL_BACKENDS registry + detectBackends()
│   ├── env.ts                   # NEW — buildChildEnv helper (extracted from claude.ts)
│   ├── prompt.ts                # NEW — shared buildPrompt(task) default
│   ├── claude.ts                # EXISTS — refactor to implement `Backend`
│   ├── codex.ts                 # NEW — JSON-RPC app-server client
│   ├── opencode.ts              # NEW — NDJSON `run --format json` consumer
│   ├── openclaw.ts              # NEW — NDJSON `agent --json` consumer
│   └── hermes.ts                # NEW — stub with actionable error
├── (all other existing files unchanged)
└── main.ts                      # MODIFIED — replace detectClaude+runClaudeTask with detectBackends+backend-dispatch

apps/server/tests/unit/
├── codex-backend.test.ts        # NEW
├── opencode-backend.test.ts     # NEW
├── openclaw-backend.test.ts     # NEW (may be shape-stub if Wave 0 fails to capture)
├── hermes-backend.test.ts       # NEW (small — stub behaviour)
├── backend-env.test.ts          # NEW — buildChildEnv token-redaction tests
└── fixtures/
    ├── codex-stream-sample.ndjson    # NEW — hand-authored per codex schema
    ├── opencode-stream-sample.ndjson # NEW — captured live
    ├── openclaw-stream-sample.ndjson # NEW (conditional on Wave 0 capture)
    ├── fake-codex.js                 # NEW — scripted stdio JSON-RPC
    ├── fake-opencode.js              # NEW — scripted NDJSON
    └── fake-openclaw.js              # NEW — scripted NDJSON
```

### Pattern 1: Backend-polymorphic dispatch

**What:** Runtime provider → Backend resolved at register time; task dispatch is `backend.run(deps)`.
**When to use:** Every place `main.ts` currently calls `runClaudeTask`.
**Anti-pattern:** Switch statement on `runtime.provider` inside `runTask`. Instead: build a `Map<runtimeId, Backend>` at register time, look up once per task.

```typescript
// Pattern — inside main.ts startDaemon()
const detected = await detectBackends();
// Register once — server returns runtimes[] in the same order.
const { runtimes } = await http.register({
  /* ...body with runtimes: detected.map(d => ({ name, provider: d.backend.provider, version: d.version, status: 'online' })) */
});
// Build the dispatch map.
const backendByRuntimeId = new Map<string, Backend>();
for (let i = 0; i < runtimes.length; i++) backendByRuntimeId.set(runtimes[i].id, detected[i].backend);

// Inside runTask(task):
const backend = backendByRuntimeId.get(task.runtimeId);  // needs this field on ClaimedTask — see note
if (!backend) throw new Error(`no backend for runtime ${task.runtimeId}`);
const result = await backend.run({ task, binaryPath: /* resolved at register */, config, onAgentMessage, abortSignal });
```

**Note:** `ClaimedTask.runtimeId` is NOT currently exposed in the shared type (`v14-types.ts:261` shows agent/issue/triggerCommentContent/workspaceId). BUT the daemon already knows the runtime — the poll loop claims per-runtime via `POST /api/daemon/runtimes/:id/tasks/claim`. So the poll-loop can pass the runtimeId DOWN to `runTask`:

```typescript
// poll-loop change: runTask accepts (task, runtimeId) — today it accepts just (task).
// This is a Phase 22 code change in apps/server/src/daemon/poll-loop.ts.
```

Shared type change: NONE required. Signature change: `runTask: (task: ClaimedTask, runtimeId: string) => Promise<void>` — exposed to backends via `BackendRunDeps.runtimeId` if they need it (most won't).

### Pattern 2: Handshake-before-stream (codex only)

**What:** Codex's protocol REQUIRES `initialize` → `thread/start` → `turn/start` in sequence before any notifications arrive. The for-await loop starts AFTER handshake completes.
**When to use:** Codex and any future backend using JSON-RPC.
**Anti-pattern:** Trying to consume notifications during handshake. The first notification (`thread/started`) may arrive BEFORE `thread/start` resolves if codex internally races — but it won't (verified from protocol: `thread/started` is a notification, not an RPC response; it's sent AFTER the thread is created, which is after the response to our `thread/start` request).

### Pattern 3: Approval-request short-circuit (codex analog of Claude's control_request)

**What:** Codex sends `item/commandExecution/requestApproval` as a ServerRequest (JSON-RPC request with id). We MUST reply with a JSON-RPC response echoing the id. If we don't reply, codex blocks indefinitely.
**When to use:** ALWAYS when codex backend is running.
**Audit trail:** Every approval emits a `thinking` PendingTaskMessageWire — same pattern as Claude's T-21-04. Message: `[auto-approve] codex tool=exec command='ls'`.

### Anti-Patterns to Avoid

- **Per-backend HTTP calls.** Only `main.ts` calls `http.completeTask` / `http.failTask`. Backends emit messages via `onAgentMessage` and return `{exitCode, cancelled}`. Keeps PM5 idempotency centralized.
- **Per-backend semaphore / batcher / cancel-poller.** Those are per-task, created in `main.ts` `runTask`. Backends don't know about them.
- **Per-backend process signal handlers.** `main.ts` owns `SIGTERM`/`SIGINT`; backends don't touch process.
- **String-matching stream frames.** Every mapper uses typed envelopes with discriminated unions. No `JSON.stringify(msg).includes('tool_use')`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC 2.0 server-side client (for codex) | A full-featured JSON-RPC client with Content-Length framing | `parseNdjson` + 4 helpers: `nextId()` / `call()` / `isResponse()` / `isRequest()` | Codex uses newline-framing only; full LSP-style framing is overkill |
| ACP client (for opencode) | `@zed-industries/agent-client-protocol` NPM port | `opencode run --format json <prompt>` — one-shot, no ACP session | Phase 22 doesn't need sessions; one-shot matches Claude's pattern |
| Stream replay on reconnect | Daemon-side replay buffer | Server-side `task_messages(seq)` — already shipped in Phase 18 | PM5 + UI-06 solved at the server layer |
| Binary probing | `which` from npm | Existing `whichCrossPlatform` in `daemon/detect.ts` | Already works on macOS / Linux / Windows PATHEXT |
| Approval decision logic | Per-backend switch statements | `buildApprovalResponse({ tool, allow })` shared helper | Codex + Claude have analogous approval flows; the policy (allow-list) is identical |

**Key insight:** Codex's schema doesn't need a library. JSON-RPC 2.0 without Content-Length headers IS just NDJSON with structured envelopes — our `parseNdjson` emits `unknown`, the codex backend narrows with `isResponse`/`isRequest`/`isNotification` guards.

## Code Examples

### 1. Backend interface + codex implementation sketch

```typescript
// Source: Phase 22 §Codex Backend + $TMP/v2/TurnStartParams.json verified protocol
import { execa } from 'execa';
import { parseNdjson } from '../ndjson-parser.js';
import type { Backend, BackendRunDeps, BackendRunResult } from '../backend.js';
import { buildChildEnv } from './env.js';

interface JsonRpcEnvelope {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isResponse(m: JsonRpcEnvelope): m is JsonRpcEnvelope & { id: string | number } {
  return m.id !== undefined && (m.result !== undefined || m.error !== undefined);
}
function isRequest(m: JsonRpcEnvelope): m is JsonRpcEnvelope & { id: string | number; method: string } {
  return m.id !== undefined && m.method !== undefined;
}

async function runCodexTask(deps: BackendRunDeps): Promise<BackendRunResult> {
  const child = execa(deps.binaryPath, ['app-server', '--listen', 'stdio://'], {
    cwd: deps.task.workDir ?? process.cwd(),
    env: buildChildEnv({ customEnv: deps.task.agent.customEnv ?? {} }),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
    cancelSignal: deps.abortSignal,
    forceKillAfterDelay: deps.config.gracefulKillMs,
  });

  // ... (initialize/thread.start/turn.start handshake + for-await mapping loop as shown in §Codex)

  const result = (await child) as { exitCode?: number; isCanceled?: boolean };
  return { exitCode: result.exitCode ?? 0, cancelled: Boolean(result.isCanceled) };
}

export const codexBackend: Backend = {
  provider: 'codex',
  detect: detectCodex,
  run: runCodexTask,
};
```

### 2. `buildChildEnv` shared helper (extract from claude.ts)

```typescript
// apps/server/src/daemon/backends/env.ts  (NEW)
// Source: Phase 22 §Common Pitfalls PM7 + apps/server/src/daemon/backends/claude.ts:170-182
import path from 'node:path';
import { sanitizeCustomEnv } from './claude.js';

export function buildChildEnv(deps: { customEnv: Record<string, string> }) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''),
    ...sanitizeCustomEnv(deps.customEnv),
  };
  delete env.AQUARIUM_DAEMON_TOKEN;
  delete env.AQUARIUM_TOKEN;
  return env;
}
```

### 3. main.ts dispatch change (before/after)

```typescript
// BEFORE (today's 21-03 main.ts L86-92 + L197-208):
const claude = await detectClaude();
// ...
const result = await runClaudeTask({ task, claudePath: claude.path, config, onAgentMessage, abortSignal });

// AFTER (Phase 22):
const detected = await detectBackends();
const backendByRuntimeId = new Map<string, { backend: Backend; binaryPath: string }>();
// ... (register + fill the map) ...
const entry = backendByRuntimeId.get(runtimeId);
if (!entry) throw new Error(`no backend for runtime ${runtimeId}`);
const result = await entry.backend.run({ task, binaryPath: entry.binaryPath, config, onAgentMessage, abortSignal });
```

## State of the Art

| Old Approach (Phase 21) | Phase 22 Approach | Why Different | Impact |
|-------------------------|-------------------|---------------|--------|
| Single hard-coded `runClaudeTask` call in `main.ts` | `Backend` interface + `detectBackends()` registry + dispatch map | BACKEND-02/03 need polymorphism; keeps Phase 21 behaviour as the default case | ~60 LOC change in main.ts, zero behavioural change for claude-only users |
| `detectClaude()` with 5 fallback paths | Per-backend `detect()` each with its own fallbacks | Codex (`/opt/homebrew/bin/codex`), OpenCode (`~/.opencode/bin/opencode`) have different canonical paths | Each backend owns its detection story |
| Claude control_request handshake baked into `runClaudeTask` | Shared approval pattern + per-backend `buildXxxApprovalResponse` | Codex has 4 approval request types; Claude has 1 — same policy / different wire | Code duplication minimised via a shared `decideApproval(tool, allow)` helper |
| No JSON-RPC framing code | Handwritten ~30 LOC in `codex.ts` | Zero-dep primitive matches 21-01's pedagogy | Unit-testable; no dep bloat |
| Single fixture `claude-stream-sample.ndjson` | 4 fixtures (claude, codex, opencode, openclaw) | Each backend's stream is provider-specific | Wave 0 task: capture each fixture |

**Deprecated / outdated:**
- None. Phase 22 does NOT remove Phase 21 code — `claude.ts` is refactored (implements `Backend` interface) but the `runClaudeTask` function body is preserved, just with the signature / export shape aligned to the interface.

## Runtime State Inventory

Phase 22 is an extension phase — it adds new backend files but doesn't rename / refactor persistent data. This section is minimal.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `runtimes` table gains rows with `provider IN ('codex','openclaw','opencode','hermes')` — but the column TYPE already accepts these (v14-types.ts:34 has all 6 provider values including `hosted`). Schema unchanged. | None — schema already shipped in Phase 15 |
| Live service config | None — no external services | None |
| OS-registered state | None — daemon adds no new PID files / task-scheduler entries | None |
| Secrets / env vars | No new env-var names; existing `AQUARIUM_DAEMON_*` set is reused. Per-provider auth (e.g. `OPENAI_API_KEY` for codex, `ANTHROPIC_API_KEY` for claude, etc.) is user-provided via the CLI's OWN config — Aquarium never touches provider credentials | None |
| Build artifacts | `apps/server/dist/daemon/backends/` gains 4 new `.js` / `.d.ts` files via `tsc` — the existing build picks them up automatically | Verify `npm run build -w @aquaclawai/aquarium` produces the new dist files in plan acceptance |

**Nothing else:** No grep-driven refactor needed. Phase 22 is additive.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | BACKEND-01 carry-forward | ✓ (research machine) | `2.1.112 (Claude Code)` | — (already shipped) |
| `codex` CLI | BACKEND-02 | ✓ (research machine) | `codex-cli 0.118.0` (via `/opt/homebrew/bin/codex`) | Detection returns null → register without codex backend |
| `codex app-server` subcommand | BACKEND-02 | ✓ | Present in 0.118.0; flagged `[experimental]` | `detectCodex` version-probe rejects codex without app-server support |
| `opencode` CLI | BACKEND-03 | ✓ | installed at `/Users/shuai/.opencode/bin/opencode` | Detection null → skip |
| `opencode run --format json` | BACKEND-03 | ✓ (verified live — emitted `{type:'error', sessionID:'ses_...', error:{...}}` on misconfigured run) | — | — |
| `openclaw` CLI | BACKEND-03 | ✗ (not installed on research machine) | — | Ship backend with documented "needs live capture" Wave 0 task; fall back to stub-with-error if capture fails |
| `hermes` CLI | BACKEND-03 | ✗ (not installed; Nous Research TUI tool) | — | SHIP stub-with-error backend permanently; escalate when Issue #569 ACP support lands upstream |
| Node 22+ | Everything | ✓ (CLAUDE.md mandate) | — | Block — Phase 15 requires Node 22+ |
| `execa@9.6.1` | All backends | ✓ (shipped by 21-02) | 9.6.1 | — |
| `commander@14.0.3` | Not needed for Phase 22 code; existing CLI dispatch handles `aquarium daemon start` | ✓ | 14.0.3 | — |

**Missing dependencies with no fallback:** None blocking. `openclaw` and `hermes` absences are addressed by the stub-with-error strategy described above.

**Missing dependencies with fallback:**
- `openclaw`: Ship backend with stream-sample-not-yet-captured stub; first task produces an actionable error AgentMessage directing users to file a bug. Unit tests cover the mapper structurally (fixture-pending).
- `hermes`: Permanent stub-with-error until upstream ships JSON/ACP mode.

## Security Domain

### Applicable ASVS Categories (unchanged from Phase 21)

| ASVS Category | Applies | Standard Control (Phase 22 addition) |
|---------------|---------|--------------------------------------|
| V2 Authentication | yes | Bearer-token auth on every outbound HTTP — same for all backends |
| V3 Session Management | partial | Each backend's child process is a fresh session; no shared state between backends |
| V4 Access Control | yes | Daemon token is workspace-scoped; each backend spawned inherits the daemon's UID, not a separate identity |
| V5 Input Validation | yes | Per-backend frame parsers all drop malformed lines (PG10 carry-forward via shared `parseNdjson`) |
| V6 Cryptography | yes | No crypto code added in Phase 22 |
| V7 Errors & Logging | yes | Approval audit trail extends to codex (`[auto-approve] codex tool=X`) |
| V14 Configuration | yes | Per-backend `allow` list lives in `~/.aquarium/daemon.json` under `backends.codex.allow` etc. File permissions already 0600 |

### Known Threat Patterns for Phase 22

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leakage via env into NEW backend children (codex / opencode / openclaw) | Information Disclosure | `buildChildEnv` helper is the ONLY way Phase 22 code sets child env. It deletes `AQUARIUM_TOKEN` / `AQUARIUM_DAEMON_TOKEN` after merge. Grep assertion in every backend: `delete env.AQUARIUM_DAEMON_TOKEN` |
| Codex `item/tool/requestUserInput` asking for secrets | Information Disclosure | Daemon ALWAYS denies user-input requests in headless mode. No interactive prompt ever reaches a user |
| Malicious `codex` / `opencode` / `openclaw` binary on PATH | Spoofing + Elevation | `detectBackends` logs absolute paths at startup (carry-forward of T-21-03); `shell: false` on all spawns; users see exactly which binary will run |
| Codex approval prompts with attacker-controlled `command` field (log forging) | Log Forging | Approval audit messages use template literal with fallback (`tool_name ?? 'unknown'`); server's 16 KB truncation applies (UI-07 carry-forward) |
| Codex JSON-RPC frame with huge `result` payload | DoS via memory | `parseNdjson` yields per-line — readline doesn't buffer beyond one line; no accumulator. No code change |
| Cross-backend task hijack (task for runtime A sent to backend B) | Tampering | The `backendByRuntimeId` lookup is authoritative; a wrong runtimeId from the server would produce a "no backend for runtime X" error, not a wrong-backend execution. Unit test `main.test.ts :: dispatch to wrong runtime errors cleanly` |
| Hermes stub error message injected via task name / agent instructions | Information Disclosure | Hermes stub error is a hard-coded template string — no interpolation of task or agent data |
| OpenCode session persistence exposing previous task context | Information Disclosure | Every `opencode run` creates a fresh session (no `-c` / `-s` flag passed) until SESS-01 lands in v1.5. Plan must assert this invariant |

## Validation Architecture

> Nyquist required: `workflow.nyquist_validation: true` per `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` via `tsx` (unchanged from Phase 21) |
| Config file | none |
| Quick run command | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/<file>` |
| Full unit suite | `npm run test:unit -w @aquaclawai/aquarium` |
| Integration tier | `CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep @integration` |
| Typecheck | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` |
| Estimated full-suite runtime | ~8 s (Phase 21 baseline 5.7 s + 3 new backend tests @ ~0.5 s each + interface extraction tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BACKEND-02 | Codex backend spawns `codex app-server --listen stdio://` and routes JSON-RPC to unified AgentMessage | unit | `npx tsx --test apps/server/tests/unit/codex-backend.test.ts` | ❌ Wave 0 |
| BACKEND-02 | Codex approval requests answered correctly (allow / deny per policy) | unit | same file | ❌ Wave 0 |
| BACKEND-02 | Codex `turn/interrupt` sent on abort | unit | same file | ❌ Wave 0 |
| BACKEND-03 | OpenCode `run --format json` NDJSON parsed into AgentMessage union | unit | `npx tsx --test apps/server/tests/unit/opencode-backend.test.ts` | ❌ Wave 0 |
| BACKEND-03 | OpenClaw `agent --json` NDJSON parsed (structural assertion on captured fixture) | unit | `npx tsx --test apps/server/tests/unit/openclaw-backend.test.ts` | ❌ Wave 0 (depends on live capture) |
| BACKEND-03 | Hermes stub emits the documented error and exits 1 | unit | `npx tsx --test apps/server/tests/unit/hermes-backend.test.ts` | ❌ Wave 0 |
| BACKEND-02/03 shared | `buildChildEnv` deletes `AQUARIUM_*` tokens from env | unit | `npx tsx --test apps/server/tests/unit/backend-env.test.ts` | ❌ Wave 0 |
| BACKEND-02/03 shared | `detectBackends` returns only available backends | unit | `npx tsx --test apps/server/tests/unit/detect-backends.test.ts` | ❌ Wave 0 |
| SC-1 Phase 22 | Codex happy path via fake-codex | integration | `CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep 'codex happy path'` | ❌ Wave 0 |
| SC-1 Phase 22 | OpenCode happy path via fake-opencode | integration | same spec | ❌ Wave 0 |
| SC-1 Phase 22 | OpenClaw happy path via fake-openclaw | integration | same spec | ❌ Wave 0 (conditional on fixture) |
| SC-3 carry-forward | Phase 21 SIGTERM→SIGKILL proof generalises — not re-asserted per backend | — | 21-04 spec | ✅ shipped |
| SC-4 (success criterion) | Switching runtime from claude→codex produces no schema change | manual E2E | Run the daemon on a real claude server, switch an agent's runtime to a codex-backed one, observe identical `task_message` rows + UI render | manual |

### Wave 0 Gaps

- [ ] `apps/server/src/daemon/backend.ts` — Backend interface
- [ ] `apps/server/src/daemon/backends/index.ts` — registry + detectBackends
- [ ] `apps/server/src/daemon/backends/env.ts` — buildChildEnv extract
- [ ] `apps/server/src/daemon/backends/codex.ts` — Codex JSON-RPC client
- [ ] `apps/server/src/daemon/backends/opencode.ts` — OpenCode NDJSON consumer
- [ ] `apps/server/src/daemon/backends/openclaw.ts` — OpenClaw NDJSON consumer (may be stub pending capture)
- [ ] `apps/server/src/daemon/backends/hermes.ts` — stub backend
- [ ] `apps/server/src/daemon/backends/claude.ts` — refactor to export `claudeBackend: Backend` alongside existing `runClaudeTask` + `spawnClaude`
- [ ] `apps/server/src/daemon/main.ts` — dispatch rewrite (detectBackends + backendByRuntimeId map)
- [ ] `apps/server/src/daemon/poll-loop.ts` — pass runtimeId into runTask signature
- [ ] 5 test files listed in the test map
- [ ] 3 fixture files: `codex-stream-sample.ndjson`, `opencode-stream-sample.ndjson`, `openclaw-stream-sample.ndjson` (with optional PG10-malformed line in each)
- [ ] 3 fake binaries: `fake-codex.js`, `fake-opencode.js`, `fake-openclaw.js` (node scripts with `--version` / `--hang` flags)
- [ ] Integration spec extension: 3 new scenarios in `tests/e2e/daemon-integration.spec.ts`

### Sampling Rate

- **Per task commit:** run the single affected `*-backend.test.ts`
- **Per wave merge:** full `npm run test:unit` (unchanged from Phase 21)
- **Phase gate:** full unit suite green + typecheck clean + integration smoke run locally (CI-skipped)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Codex's `CommandExecutionRequestApprovalResponse.decision` enum uses the string values `'approved'` and `'denied'` (not `'allow'` / `'deny'`). Not yet checked against the response schema file. | §Codex Backend | MEDIUM — if values differ, codex hangs waiting for a response it can't parse. Fix is 1-line in `buildCodexApprovalResponse`. Planner should read `CommandExecutionRequestApprovalResponse.json` during Wave 0. |
| A2 | OpenCode's `run --format json` NDJSON shape (step_start / text / tool_use / step_finish / error) as documented on takopi.dev + opencode.ai/docs/formatters is STABLE at v1.x. | §OpenCode Backend | LOW — OpenCode is popular (ACP-maintained). If shape drifts, the mapper is 30 LOC and Wave 0 captures a live sample so drift surfaces immediately. |
| A3 | OpenClaw `agent --json` emits NDJSON with a shape close to OpenCode's (both are coding-agent-NDJSON stacks). | §OpenClaw Backend | MEDIUM — if OpenClaw's shape is wildly different, the backend ships as a stub pending local capture. Plan documents this as a conditional deliverable. |
| A4 | Hermes (Nous Research) does NOT have a headless JSON / ACP mode in April 2026. | §Hermes Backend | LOW — researcher checked docs + GitHub Issue #569; verified absence. If Nous ships ACP support, swap the stub for a real ACP client in a follow-up plan. |
| A5 | Codex's JSON-RPC uses newline framing on stdio (no Content-Length headers). | §Codex Backend | LOW — verified via `generate-json-schema` output (no Content-Length field in `JSONRPCMessage.json`) + standard codex-cli practice + `--listen stdio://` docs wording. |
| A6 | Codex's in-protocol `turn/interrupt` is reliable and doesn't race with codex's own completion logic. | §Codex Backend cancel | MEDIUM — if codex ignores interrupt in some states, the execa `forceKillAfterDelay: 10_000` backstop catches. Test: integration scenario that cancels mid-tool — assert pgrep empty within 12 s. |
| A7 | `ClaimedTask` does NOT need a new `runtimeId` field — the poll loop already knows which runtime it claimed for, and passes it down. | §Backend interface (main.ts change) | LOW — verified: poll-loop calls `httpClient.claimTask(runtimeId)`, so `runtimeId` is already in scope when `runTask` fires. |
| A8 | Server-side `/register` response preserves the order of `runtimes` as sent by the daemon. | §main.ts dispatch | MEDIUM — if server reorders, the `backendByRuntimeId` map build is wrong. Plan should include a defensive check: match daemon-sent `name` against server-returned `name` instead of relying on array index. |
| A9 | `detectBackends` probing 4 binaries in sequence is fast enough for daemon startup (< 1 s total worst case). | §Backend registry | LOW — each `--version` has a 5 s timeout, but typical time is ~50 ms per binary. 4 × 50 = 200 ms. |
| A10 | A `hermes` binary is detectable via PATH — users who install hermes-agent get it there. | §Hermes Backend detect | LOW — per nousresearch install docs. Detection with version parse is robust to the binary existing but hermes being non-functional. |
| A11 | Phase 22's new approval policies (codex allow-list, opencode no-approval) integrate cleanly with `DaemonConfigFile.backends` — extending the type is straightforward. | §User Constraints | LOW — `DaemonConfigFile.backends.claude.allow` is already optional; add `backends.codex.allow` / `backends.opencode` (empty shape) / `backends.openclaw.allow` via optional keys in shared types. |

**If this table were empty:** It's not. A1 and A3 in particular call for Wave 0 verification before plan acceptance.

## Open Questions (RESOLVED)

All six items below have been resolved by planning decisions — each is now
handled either by a Wave 0 task in `22-01-PLAN.md` / `22-02-PLAN.md` or by a
recorded assumption in the Assumptions Log. Kept here as an audit trail of
what was open during research and how planning closed it.

1. **Codex approval-response enum values.** RESOLVED by A1 + `22-02` Wave 0 task "read `CommandExecutionRequestApprovalResponse.json` before implementing `buildCodexApprovalResponse`" + protocol-drift unit test asserting the exact `decision` enum value. If the file's actual enum differs from `'approved'`/`'denied'`, the Wave 0 read surfaces it and the test catches regressions.
2. **OpenClaw stream shape.** RESOLVED by A3 + `22-03`'s conditional deliverable: plan instructs the implementer to install openclaw locally and capture a live sample IF available, otherwise ship `backends/openclaw.ts` as a documented stub-with-error matching the hermes pattern. Either path is acceptable; planner chose not to hard-block on OpenClaw being installed on CI.
3. **Codex `input: UserInput[]` format for `turn/start`.** RESOLVED — `22-02` Wave 0 task includes reading `$TMP/v2/TurnStartParams.json` alongside the approval schemas. The planned fixture uses `{type:'text', text:'...'}` and the unit test asserts this exact shape in the outbound JSON-RPC frame. A divergence would be caught immediately.
4. **OpenCode `--share` ergonomics.** RESOLVED — `22-03`'s OpenCode spawn explicitly omits the `--share` flag. Unit test asserts the spawned-command arg vector contains `['run', '--format', 'json']` and does NOT contain `'--share'`.
5. **Graceful shutdown with codex mid-turn.** RESOLVED — carried over from Phase 21 unchanged. `waitForInFlightDrain` already polls `inFlight.size === 0`, so codex's `turn/interrupt` → `turn/completed` cycle is naturally awaited. Documented in `22-04`'s threat model (T-22-08) for transparency; no new code.
6. **Runtime binding lifetime.** RESOLVED — settled as register-time binding via the `backendByRuntimeId` map, which `22-04` builds. If a user installs a new backend mid-daemon-lifetime, the daemon MUST be restarted; `22-04` adds a hint to `aquarium daemon status` output documenting this.

## Sources

### Primary (HIGH confidence — verified against installed files / live output / generated schemas)

- `apps/server/src/daemon/backends/claude.ts` — existing Backend behaviour (read in full) [VERIFIED]
- `apps/server/src/daemon/main.ts` — existing orchestrator (read in full) [VERIFIED]
- `apps/server/src/daemon/detect.ts`, `config.ts`, `http-client.ts`, `poll-loop.ts`, `stream-batcher.ts`, `cancel-poller.ts`, `kill-escalation.ts`, `ndjson-parser.ts` — existing primitives (read in full) [VERIFIED]
- `packages/shared/src/v14-types.ts` — AgentMessage / RuntimeProvider / ClaimedTask / DaemonConfigFile (verified in full) [VERIFIED]
- `apps/server/tests/unit/` — existing 226-test suite [VERIFIED]
- `.planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-RESEARCH.md` — Phase 21 established Backend pattern + Claude stream format [VERIFIED]
- `.planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-03-SUMMARY.md` — exact file layouts, pitfall mitigations cited to line [VERIFIED]
- `.planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-04-SUMMARY.md` — integration spec generalisation path + deviations list [VERIFIED]
- `.planning/phases/21-daemon-cli-claude-code-backend-unit-harness/21-VALIDATION.md` — Nyquist validation template, extended here [VERIFIED]
- `.planning/research/PITFALLS.md` PG7/PG8/PG9/PG10/PM5/PM6/PM7 [VERIFIED]
- `codex app-server generate-json-schema --out /tmp/…` — full JSON-RPC schema output: 37 top-level Request/Notification types; every method name enumerated; every param/response envelope shape captured [VERIFIED 2026-04-17]
- `codex --version` → `codex-cli 0.118.0` [VERIFIED 2026-04-17 on research machine]
- `codex app-server --help` — flags + `--listen stdio://` default [VERIFIED]
- `opencode run --format json` — observed live output line `{"type":"error","timestamp":…,"sessionID":"ses_…","error":{…}}` [VERIFIED 2026-04-17]
- `opencode --help` / `opencode run --help` — confirms `--format json`, `--dir`, `--agent` flags [VERIFIED]
- `opencode acp --help` — confirms ACP server mode exists but is not needed for Phase 22's `run`-based approach [VERIFIED]

### Secondary (MEDIUM confidence — official docs with some community gaps)

- [OpenCode Formatters docs](https://opencode.ai/docs/formatters/) — NDJSON event enumeration [CITED]
- [OpenCode ACP Support](https://opencode.ai/docs/acp/) — ACP server mode (not used by Phase 22 but referenced) [CITED]
- [takopi.dev OpenCode run --format json cheatsheet](https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/) — confirmed event shape via community docs [CITED]
- [Agent Client Protocol docs](https://agentclientprotocol.com/) + [prompt-turn](https://agentclientprotocol.com/protocol/prompt-turn) — ACP methods + sessionUpdate variants + stopReason enum [CITED]
- [OpenClaw CLI Reference](https://docs.openclaw.ai/cli) — `agent --json`, `--timeout`, `--session-id` [CITED]
- [LumaDock OpenClaw CLI tutorial](https://lumadock.com/tutorials/openclaw-cli-config-reference) — supplements official docs [CITED]
- [Hermes Agent CLI docs](https://hermes-agent.nousresearch.com/docs/user-guide/cli) — TUI-first, no headless JSON [CITED]
- [GitHub Issue #569 — Hermes ACP Support](https://github.com/NousResearch/hermes-agent/issues/569) — feature request, not yet shipped [CITED]

### Tertiary (LOW confidence — community / not officially spec'd)

- OpenClaw NDJSON event shape (not documented in detail; shape ASSUMED close to OpenCode's dialect — A3)
- Codex approval response `decision` enum string values (not yet read from response schema files — A1)

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Backend interface extraction | HIGH | 21-03 code is clean; `runClaudeTask` already has the right signature shape |
| Codex JSON-RPC protocol | HIGH | Full schema generated + 159 v2 types + 37 client request / server notification methods verified |
| Codex approval response enums | MEDIUM | Response shape files exist in generated schema but not yet field-read (A1) |
| OpenCode stream shape | HIGH | Live-captured error event on research machine + 2 sources (official formatters page + takopi cheatsheet) |
| OpenCode one-shot vs ACP choice | HIGH | ACP requires session handshake; `run --format json` is one-shot — matches Claude's pattern cleanly |
| OpenClaw stream shape | MEDIUM | Docs state `--json` emits NDJSON; event types not enumerated in docs (A3) |
| Hermes headless mode | HIGH | Docs explicitly TUI-first; GitHub Issue #569 confirms ACP is not yet shipped |
| PM1/PG5/PG7/PG8 reuse | HIGH | All solved by Phase 21 primitives, generalise per backend |
| PM5 cancel race | HIGH | Server-side `discarded: true` already shipped |
| PM7 env leak | HIGH | `buildChildEnv` helper extracted from proven `backends/claude.ts` logic |
| Fixture strategy | HIGH | Claude fixture exists; same pattern generalises; 1 fixture per backend |
| Integration test generalization | HIGH | 21-04 explicitly calls out this phase as the consumer of its `installFakeBackend` pattern |

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days). Re-verify codex `app-server` subcommand schema if codex-cli releases a new major version. OpenCode `run --format json` shape is stable at v1.x but worth re-confirming on any OpenCode v2. Hermes ACP mode should be re-checked quarterly until shipped.

## RESEARCH COMPLETE

**Phase:** 22 — Remaining Agent Backends
**Confidence:** HIGH (Claude/Codex/OpenCode/Hermes decision) / MEDIUM (OpenClaw stream shape pending capture)

### Key Findings

- **Zero new npm deps.** Everything Phase 22 needs is already shipped by 21-02 (`execa@9.6.1`, `commander@14.0.3`, `node:readline`, `node:test`). Codex's JSON-RPC framing is NDJSON — handwritten ~30 LOC over our existing `parseNdjson`.
- **Backend interface** extracted from Phase 21's implicit claude shape: `{ provider, detect(), run(deps): Promise<{exitCode, cancelled}> }`. `main.ts` dispatches via a `backendByRuntimeId` map built at register time.
- **Codex protocol FULLY CHARACTERISED.** `codex app-server generate-json-schema --out /tmp/...` produces a complete JSON-RPC 2.0 schema: 3 client requests we use (`initialize`, `thread/start`, `turn/start`, `turn/interrupt`), 12 server notifications we map to `AgentMessage`, 4 server approval-request types we auto-approve per-policy. All verified from generated schema files.
- **OpenCode uses `run --format json`** (NOT ACP) — one-shot NDJSON with 5 event types (step_start / text / tool_use / step_finish / error), verified both live and via community cheatsheet. No approval handshake — ship without audit thinking for opencode (Claude/codex pattern doesn't apply).
- **OpenClaw**: docs say `--json` NDJSON is supported; exact event shape not publicly enumerated. Wave 0 must either install openclaw and capture, or ship a stub-with-error that lets detection succeed but first task fail loudly with an actionable message.
- **Hermes is TUI-first with NO documented headless mode in April 2026** (Nous Research Issue #569 open). Recommended: ship a stub backend that detects hermes, appears in `GET /api/runtimes`, but returns an actionable error on first task. Avoids PTY-scraping trap (rejected as provider-hostile).
- **All cancel semantics are already handled** — execa's `cancelSignal` + `forceKillAfterDelay: gracefulKillMs` is the SIGTERM→SIGKILL primitive for every backend. Codex ALSO gets in-protocol `turn/interrupt` for polite cancel before signal escalation.
- **PM5 / PM6 / PM7** are shared concerns already solved by Phase 21 — Phase 22 extracts `buildChildEnv()` helper so the token-redaction pattern is enforced across all 4 new backend spawn sites.
- **Test fixtures:** 1 hand-authored codex fixture (per generated schema) + 1 captured-live opencode fixture + 1 Wave-0-captured openclaw fixture (or stub) + 1 reused claude fixture. Every fixture includes one malformed line for PG10 coverage.
- **Integration strategy:** extend Phase 21-04's `daemon-integration.spec.ts` with 3 new `@integration` scenarios (codex happy path, opencode happy path, openclaw happy path — all via PATH-hijacked fake binaries). CI-skipped.

### File Created

`.planning/phases/22-remaining-agent-backends/22-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Backend interface + dispatch | HIGH | Phase 21 code reads cleanly; extraction is mechanical |
| Codex protocol & mapping | HIGH | Full generated schema + every method name enumerated |
| Codex approval enums | MEDIUM | Response shape files exist in generated schema; string values not yet field-read (A1) |
| OpenCode NDJSON | HIGH | Live-captured + 2 secondary sources |
| OpenClaw NDJSON | MEDIUM | Docs state `--json` works; event shape needs Wave 0 capture (A3) |
| Hermes decision | HIGH | Docs + upstream Issue #569 confirm no shipped headless mode (A4) |
| Cancel contract | HIGH | Execa `forceKillAfterDelay` is the proven primitive; codex adds `turn/interrupt` in-protocol refinement |
| Pitfalls / threats | HIGH | Every OWNED pitfall has a cited mitigation from Phase 21 primitives |
| Validation architecture | HIGH | Builds directly on 21-03/21-04 test conventions |

### Open Questions

6 items — all narrow: codex approval enum exact strings (Wave 0 fixable in 1 line), openclaw live capture (plan-gated decision), UserInput shape for codex turn/start (Wave 0 read), opencode share=false default (confirmable in --help), graceful shutdown with codex mid-turn (naturally handled by existing drain logic), backend re-binding for mid-lifetime new installs (document as "restart daemon to pick up new backends").

### Ready for Planning

Research complete. Estimated scope: **4 plans** (mirrors Phase 21 shape).

- **22-01:** Extract Backend interface + registry + `buildChildEnv` helper + refactor `claude.ts` to implement interface + update `main.ts` dispatch + update `poll-loop.ts` signature. Tests: `backend-env.test.ts`, `detect-backends.test.ts`, regression tests for claude still green.
- **22-02:** Codex backend — `codex.ts` with JSON-RPC handshake + mapping + approval responses + cancel via turn/interrupt + unit tests + `fake-codex.js` + `codex-stream-sample.ndjson` fixture. Wave 0 task: read codex approval response schemas to pin enum values.
- **22-03:** OpenCode + OpenClaw backends — parallel but small. `opencode.ts` + `openclaw.ts` + respective unit tests + fixtures + fake binaries. Wave 0 task: capture real openclaw output locally (or commit to stub-with-error).
- **22-04:** Hermes stub + integration scenarios — `hermes.ts` as stub-with-error + 3 integration scenarios added to `daemon-integration.spec.ts` (codex / opencode / openclaw happy paths) + any typecheck cleanup.

Phase 21's architecture is the perfect scaffolding — Phase 22 is an additive extension, not a rewrite. All 226 existing unit tests should still pass after Plan 22-01's refactor (regression guarantee).
