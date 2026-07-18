# Technology Stack: v1.4 Task Delegation Platform

**Project:** Aquarium CE v1.4 — Multica-style Issue/Task/Agent/Runtime delegation
**Researched:** 2026-04-16
**Overall Confidence:** HIGH
**Scope:** Only additions needed for v1.4 on top of the existing Express/React/SQLite/Docker stack. All existing libs (Express, Knex, better-sqlite3, ws, Vite, React 19, CSS variables, Playwright) are reused unchanged.

---

## Executive Summary

v1.4 adds **five** targeted dependencies and **zero** runtime replacements. The existing stack already covers the transport (ws), persistence (better-sqlite3/Knex), and UI framework (React 19 + Radix primitives). The gaps are narrow:

1. **Subprocess orchestration** for user-installed agent CLIs (Claude Code, Codex, OpenClaw, OpenCode, Hermes) → **`execa@9.6.1`** + built-in `node:readline` for NDJSON line framing.
2. **Kanban drag-and-drop** → **`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` + `@dnd-kit/utilities@3.2.2`** (exact multica match).
3. **Daemon CLI subcommands** → **`commander@14.0.3`** (replaces the current hand-rolled `getFlag()` arg parser in `apps/server/src/cli.ts`).
4. **Daemon token ID generation** → **`nanoid@5.1.9`** for token secrets; `node:crypto` built-ins (`timingSafeEqual`, `createHash('sha256')`) for verification.
5. **Nothing new for streaming to the client.** Existing `ws` + existing `WebSocketContext` handle 500ms-batched task message flushes via a tiny in-process emitter using `node:events` built-in.

The `@anthropic-ai/claude-agent-sdk` exists and is tempting, but we **reject it** for v1.4 (see Anti-Recommendations) because the multica architecture deliberately spawns user-installed CLIs so the user's local auth, config, and working directory are honored.

Stream-json framing is confirmed as **newline-delimited JSON (NDJSON)** by multica's source (`bufio.NewScanner` over stdout, one JSON object per line, 10 MB per-line buffer). Ref: `/tmp/multica/server/pkg/agent/claude.go:101-104`.

---

## Additions Required

| # | Package | Version | Surface | Why It's Needed |
|---|---------|---------|---------|-----------------|
| 1 | `execa` | `9.6.1` | server | Ergonomic cross-platform child process with proper stream handling, timeout + kill semantics, signal forwarding |
| 2 | `@dnd-kit/core` | `6.3.1` | web | Kanban column/card drag-and-drop for issue board (mirrors multica exactly) |
| 3 | `@dnd-kit/sortable` | `10.0.0` | web | Sortable preset for within-column reorder |
| 4 | `@dnd-kit/utilities` | `3.2.2` | web | CSS helpers (`CSS.Transform.toString`) used by sortable items |
| 5 | `commander` | `14.0.3` | server | Subcommand routing for `aquarium daemon start`, `aquarium daemon token`, future subcommands |
| 6 | `nanoid` | `5.1.9` | server | URL-safe, collision-resistant random IDs for daemon tokens and task IDs (drop-in for `crypto.randomBytes(...).toString('hex')` when URL-safety matters) |

**Total bundle impact on web:** ~18 KB gzipped for @dnd-kit (core 10 KB + sortable 6 KB + utilities 2 KB). All three are already in multica's production frontend shipping to thousands of users — the performance/accessibility work is done.

**Total bundle impact on server:** zero (server is Node.js; dependencies are resolved at runtime, no bundling).

No React DnD wrapper, no `split2`/`ndjson`/`readable-stream`, no SSE library, no JWT-in-memory signing library (the existing cookie JWT pathway covers user auth — daemon tokens are a separate lookup-by-hash scheme).

---

## Version-Pinned Recommendations

### 1. Subprocess spawning — `execa@9.6.1`

**Rationale (why execa over raw `node:child_process`):**
- Raw `child_process.spawn` requires ~40 lines of boilerplate to handle: stream error propagation, `kill()` on timeout, exit code normalization, stderr logging, Windows `.cmd` shim resolution, and environment merging with key filtering. Multica implements this in Go; we'd reimplement it in TypeScript for every agent backend (Claude, Codex, OpenClaw, OpenCode, Hermes = 5× duplication).
- execa is **ESM-native** (matches our `"type": "module"` + NodeNext setup), ships TypeScript types, requires Node 18.19+/20.5+ (we're on Node 22+).
- Provides `subprocess.stdout`, `subprocess.stdin`, `subprocess.kill('SIGTERM', { forceKillAfterTimeout })` out of the box — matches multica's `cmd.WaitDelay = 10 * time.Second` pattern.
- Battle-tested: used by pnpm, Turbo, tsx, lint-staged, AVA.

**Stream framing:** Use the built-in `node:readline` module, **not** a third-party lib.

```typescript
// Pseudocode matching multica's bufio.Scanner loop
import { execa } from 'execa';
import { createInterface } from 'node:readline';

const subprocess = execa('claude', ['-p', '--output-format', 'stream-json', ...]);
const rl = createInterface({ input: subprocess.stdout!, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line) as ClaudeStreamMessage; // see types below
  handleMessage(msg);
}
await subprocess; // waits for exit
```

`readline.createInterface()` with `crlfDelay: Infinity` + async iterator gives exactly multica's semantics: one JSON object per line, empty lines skipped, backpressure-aware, no external dep. **Zero installs for line framing.**

**Alternatives considered:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `node:child_process` raw | Rejected | 5× boilerplate duplication across agent backends; Windows edge cases; manual timeout/kill orchestration |
| `split2@4.2.0` | Rejected | Extra dep, CJS-only (our server is ESM NodeNext, interop works but unnecessary), and `node:readline` covers the exact use case |
| `ndjson@2.0.0` | Rejected | Last published 2020, CJS-only, bundles both split2 + JSON.parse; we want control over malformed-line handling (skip, not throw — matches multica line 111: `if err := json.Unmarshal...; err != nil { continue }`) |
| `@anthropic-ai/claude-agent-sdk` | Rejected for v1.4 (see Anti-Recommendations) | Calls Anthropic API directly rather than spawning user-installed `claude` binary; breaks the "use your installed CLI's auth" architectural premise |

**Stream-json framing confirmation (HIGH confidence):**
- multica `claude.go:101-104`: `scanner := bufio.NewScanner(stdout); scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)` — 10 MB per-line cap, newline-delimited.
- Hardcoded flags at `claude.go:357-363`: `"-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--strict-mcp-config", "--permission-mode", "bypassPermissions"`.
- Observed message `type` values: `system` | `assistant` | `user` | `result` | `log` | `control_request` (claude.go:115-145, 240-276). We **must** handle `control_request` by writing a `control_response` with `behavior: "allow"` back to stdin (auto-approve in daemon mode) — see claude.go:254-265.
- Codex uses JSON-RPC 2.0 over the same NDJSON framing (`codex.go:44`: `codex app-server --listen stdio://`). Framing identical; protocol is JSON-RPC (`initialize`, `turn/start`, notifications) rather than free-form messages.

### 2. Kanban drag-and-drop — `@dnd-kit/core + sortable + utilities`

**Versions (exact multica match):**
- `@dnd-kit/core@6.3.1` — DnD primitives (DndContext, useDraggable, useDroppable)
- `@dnd-kit/sortable@10.0.0` — sortable preset (SortableContext, useSortable, arrayMove)
- `@dnd-kit/utilities@3.2.2` — `CSS.Transform.toString()` helper

**Rationale:**
- **Multica uses these exact versions** (`/tmp/multica/apps/web/package.json:16-18`). Copying the kanban target means copying the DnD library.
- **Works without Tailwind.** `@dnd-kit` is styling-agnostic; it provides transform + transition CSS strings that we pipe into inline `style={{}}` or CSS variables. No utility-class dependency (unlike `shadcn/ui + Tailwind` kanban examples online).
- **React 19 compatible.** Peer dep is `react@">=16.8.0"` — works with our React 19.2.
- **Accessibility built-in:** Full keyboard support (Tab, Space to pick up, arrow keys to move, Esc to cancel) and screen-reader announcements out of the box. Multica ships this to enterprise customers who care about a11y.
- **Actively maintained** (core v6.3.1 published Dec 2024). Alternatives (`react-beautiful-dnd`) are dead; `@hello-pangea/dnd` is in maintenance mode with only 1 active contributor.

**Note on `@dnd-kit/react@0.4.x`:** A newer rewrite exists (`@dnd-kit/react`, distinct from `@dnd-kit/core`). It is pre-1.0 (v0.4.0, Feb 2025) and the migration path from `core` is non-trivial. **Do not use for v1.4.** Revisit post-1.0 release (likely v1.5+).

**Alternatives considered:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `react-beautiful-dnd` | Rejected | Abandoned by Atlassian (archived 2022); no React 18/19 support upstream |
| `@hello-pangea/dnd@17` | Rejected | Maintenance-only fork; original maintainer stepped away; declining contributor activity per 2026 audits |
| `framer-motion` Reorder | Rejected | Framer's Reorder is list-only — doesn't model column-to-column kanban drops without manual orchestration; adds ~40 KB of animation runtime we don't need |
| Home-rolled with HTML5 DnD API | Rejected | No a11y, no touch support on mobile, no autoscroll during drag, no drag preview customization. All of these are solved problems we'd regress on |
| `@dnd-kit/react@0.4.0` (new API) | Defer to v1.5+ | Pre-1.0, no migration plateau reached, multica didn't adopt it — we'd diverge from the copy target for no gain |

### 3. Daemon CLI subcommands — `commander@14.0.3`

**Rationale:**
- Current `apps/server/src/cli.ts` is a hand-rolled `getFlag()`/`hasFlag()` parser (lines 11-25). It handles `--port`, `--data-dir`, `--host`, `--open` as top-level flags, but there are **no subcommands** and adding `aquarium daemon start` / `aquarium daemon token issue` requires real subcommand dispatch.
- `commander@14.0.3` requires Node ≥ 20 (we're on 22+), is dual-module (ESM + CJS via `./esm.mjs`), ships TypeScript types, and has the smallest surface area of the three major CLI frameworks.
- v14 is the current major (v14.0.3, Nov 2025). No v15 preview.

**Migration path for existing code:**
- `apps/server/src/cli.ts` top-level flag handling (lines 11-25, 28, 43-50) migrates to a default root command. Env-var side effects (`process.env.AQUARIUM_DB_PATH = ...` at line 41) must happen **before** any `@aquaclawai/aquarium` internal import — preserve the current "Phase 1: parse then set env, Phase 2: dynamic import" structure. Commander allows this: you can parse args synchronously before dynamic-importing the server.
- Add a subcommand: `aquarium daemon start [--server URL] [--token TOKEN] [--workspace-id UUID]`.
- Add a subcommand: `aquarium daemon token issue --name NAME` (server-side admin command that inserts into the `daemon_token` table and prints `mdt_...`).

**Alternatives considered:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `yargs@17` | Rejected | Larger API surface, heavier (~110 KB vs commander's ~60 KB); our needs are simple subcommand routing + typed options |
| `oclif@4` | Rejected | Plugin architecture is overkill; enforces a directory-per-command convention that fights our single-entry npm package (`"bin": {"aquarium": "./dist/cli.js"}`) |
| Extend hand-rolled parser | Rejected | Subcommand detection + `--help` generation + typed option validation is exactly what commander gives us for 60 KB |

### 4. Daemon token generation & verification

**Recommendation:** `mdt_<32 chars from nanoid>` for the visible token; store `sha256(token)` as bytes in SQLite; verify with `crypto.timingSafeEqual`.

**Format rationale (HIGH confidence, exact multica match):**
- Multica uses `mdt_` prefix + 40 hex chars (20 bytes from `crypto/rand.Read`): `/tmp/multica/server/internal/auth/jwt.go:40-47`.
- GitHub uses similar schemes (`ghp_`, `ghs_`, `gho_`); the prefix enables secret-scanning tools to detect leaked tokens in public repos. **Aquarium should use `adt_` (aquarium daemon token)** to avoid colliding with multica's `mdt_` in mixed environments.
- Server verification: `const hash = crypto.createHash('sha256').update(token).digest(); const stored = rows[0].token_hash; return crypto.timingSafeEqual(hash, stored);` — see multica `jwt.go:49-52` (`HashToken` via `sha256.Sum256`).

**Generation:** `nanoid@5.1.9` with a custom alphabet of URL-safe chars, 32 characters of entropy.
- 32 chars from a 64-char alphabet = 192 bits of entropy, well above the 128-bit floor. (20 random bytes = 160 bits — multica's choice — is also fine; we pick 32 nanoid chars for clean URL-safe output without hex padding.)
- nanoid is **ESM-only** (matches our setup), tiny (130 bytes gzipped), and has been audited. Uses `crypto.getRandomValues` internally — cryptographically secure.

**Alternatives considered:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `crypto.randomBytes(32).toString('hex')` (zero-dep) | Acceptable fallback | Works fine but hex is 2× longer than needed (64 chars vs 32) and less URL-friendly; use this **if we want to avoid a new dep** — the only cost is uglier token output |
| `uuid@11` v4 | Rejected | UUIDs are 128-bit; tokens should be at least 128 bits of **secret** entropy — UUIDs include 6 fixed bits for version/variant, reducing entropy. Also formatted with dashes, awkward for copy/paste |
| `jose`/`jsonwebtoken` JWTs for daemon auth | Rejected | We don't need claims; we need an opaque capability token that proves "bearer can talk to this workspace". Hashed-token-in-DB is simpler, revocable instantly (DELETE FROM daemon_token WHERE id = ?), and doesn't leak metadata |
| `crypto.timingSafeEqual` for comparison | **Required** | Prevents timing attacks on token comparison. String equality (`a === b`) short-circuits and leaks byte-position info. This is a stdlib primitive — zero dep |

### 5. Streaming server → client task messages (500 ms batching)

**Recommendation:** Use **existing `ws` library** + a per-task in-memory buffer using `node:events` built-in. **Zero new dependencies.**

**Rationale:**
- Multica uses Go channels + a 500 ms ticker to batch task messages before flushing to the server: `/tmp/multica/server/internal/daemon/daemon.go:1126` (`ticker := time.NewTicker(500 * time.Millisecond)`). The equivalent in Node is a `setInterval(flush, 500)` inside the per-task streaming coroutine, guarded by a `Map<taskId, MessageBatch>` buffer.
- For **daemon → server**: the daemon already posts batches over HTTP (`d.client.ReportTaskMessages(...)` at daemon.go:1119). We mirror this — daemon calls `POST /api/daemon/tasks/:id/messages` with an array. HTTP is simpler than WebSocket for daemon→server (firewalls, retry, well-understood). No new lib.
- For **server → web browser**: we reuse the existing `WebSocketContext` in `apps/web/src/contexts/WebSocketContext.tsx` and the existing `/ws` endpoint. Add a new subscription channel (`task:<taskId>` or `issue:<issueId>`). The server-side task-message handler calls `wsServer.broadcastToSubscribers(issueId, {type: 'task-message', batch})` — this pattern already exists for instance events.
- For **intra-server pub/sub** (task-runner emits → websocket relay consumes): `node:events` `EventEmitter` with generic typing. No `mitt`, no `tiny-emitter`. Rationale: we're already server-side (no bundle-size pressure), `EventEmitter` is zero-dep, and we can type it: `class TaskEventBus extends EventEmitter<TaskEventMap> {}`.

**Explicit non-recommendations:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `EventSource`/SSE (browser-side) | Rejected | We already have `ws` open and authenticated. Adding SSE means second auth flow, second reconnect logic, second client abstraction. Multica uses WebSocket too |
| `mitt@3.0.1` / `tiny-emitter` | Rejected (server) | Server doesn't need a 200-byte emitter; `node:events` is already loaded |
| `mitt` (web) | Not needed | Existing `WebSocketContext` provides subscribe/unsubscribe per channel already |
| `rxjs` | Rejected | Dependency weight (~40 KB gzipped minimum) for a single batched stream; no other Observable needs in the app |

### 6. Stream-json type definitions

**Recommendation:** Hand-write the TypeScript types in `packages/shared/src/agent-stream.ts`, modeled after multica's Go structs. Do **not** depend on `@anthropic-ai/claude-agent-sdk` just for types.

**Rationale:**
- `@anthropic-ai/claude-agent-sdk@0.2.110` ships types (`SDKUserMessage`, `SDKSystemMessage`, `SDKResultSuccess`, `SDKResultError`), but the package is large (pulls in `@anthropic-ai/sdk`, network code, agent loop logic). Importing just the types risks bundler confusion and couples us to an SDK we don't use at runtime.
- The messages we care about are well-defined and small — ~50 lines of TS. Multica's Go struct definitions (`claude.go:280-333`) are a 1:1 translation target:

```typescript
// packages/shared/src/agent-stream.ts (sketch)
export type ClaudeStreamMessage =
  | { type: 'system'; session_id?: string; subtype?: string }
  | { type: 'assistant'; message: ClaudeMessageContent }
  | { type: 'user'; message: ClaudeMessageContent }
  | { type: 'result'; session_id?: string; result?: string; is_error?: boolean; duration_ms?: number }
  | { type: 'log'; log: { level: string; message: string } }
  | { type: 'control_request'; request_id: string; request: { subtype: string; tool_name?: string; input?: unknown } };

export interface ClaudeMessageContent {
  role: string;
  model?: string;
  content: ClaudeContentBlock[];
  usage?: ClaudeUsage;
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };
```

- **Codex** is JSON-RPC 2.0, not free-form — use a light `JsonRpcMessage` discriminated union. No npm dep needed; JSON-RPC 2.0 is stable and simple.
- **Validation:** reuse the already-installed `ajv@8.18.0` (in `apps/server/package.json:27`) to validate incoming stream messages against minimal JSON schemas. This is what we already use for config.patch validation.

**Alternatives considered:**

| Option | Verdict | Reason |
|--------|---------|--------|
| `@anthropic-ai/claude-agent-sdk` types | Rejected | Heavy dep just for types; types are trivial to hand-write; keeps our codebase compatible even if Anthropic renames symbols |
| `@openai/codex-sdk@0.121.0` | Rejected (for now) | Abstracts stdio JSON-RPC but doesn't expose the granular `tool_use`/`tool_result` streaming events we need for live UI updates. See Anti-Recommendations |
| `zod`-based parsing | Rejected | We already have ajv; adding zod (12 KB gzipped) duplicates a capability |

---

## Integration Points with Existing Aquarium Code

| New piece | Existing code touched | Change |
|-----------|----------------------|--------|
| `execa` subprocess pattern | `apps/server/src/cli.ts:64-69` (`execSync('docker info')`), `apps/server/src/cli.ts:80-88` (`exec(browserOpen)`), `apps/server/src/routes/skills.ts:158` (`execSync`) | **Do not migrate.** These are one-shot exec calls; execa's value is in streaming/long-running processes. Leave as `execSync`/`exec` — no regression, no churn |
| `execa` subprocess pattern | NEW: `apps/server/src/agent-types/claude-code/adapter.ts`, `codex/adapter.ts`, `opencode/adapter.ts`, `hermes/adapter.ts` | All new files; no existing adapter uses child_process |
| `commander` | `apps/server/src/cli.ts` (full rewrite of arg parsing) | Preserve Phase 1/Phase 2 split: parse + set env before `await import('./index.ce.js')`. Route `daemon` subcommand to a new file that does NOT import the server (`apps/server/src/daemon/cli.ts`) |
| `@dnd-kit/*` | `apps/web/src/pages/*` (new IssueBoardPage, IssueDetailPage) | All new; no existing drag-and-drop code in the repo (grep `useDraggable`/`drag-and-drop`: zero hits) |
| `nanoid` | NEW: `apps/server/src/services/daemon-token.ts` | Brand-new service; nanoid replaces what would otherwise be `crypto.randomBytes(...).toString('hex')` |
| `node:events` typed emitter | NEW: `apps/server/src/services/task-event-bus.ts` | Emits → consumed by existing `apps/server/src/ws/broadcast.ts` pattern. Existing WS server already has `broadcastToSubscribers(topic, payload)` — reuse |
| Daemon HTTP endpoints | NEW: `apps/server/src/routes/daemon/*.ts` | 10 new route files mirroring multica's `/api/daemon/*`. Mounted in `apps/server/src/server-core.ts` alongside existing routers |
| `daemon-token` middleware | NEW: `apps/server/src/middleware/daemon-auth.ts`, coexists with existing `apps/server/src/middleware/auth.ts` | Order: cookie-JWT auth (existing) OR daemon-token auth (new). The daemon routes use `requireDaemonAuth`; web routes use `requireAuth` |
| Shared types | `packages/shared/src/types.ts` | Add `ClaudeStreamMessage`, `CodexJsonRpcMessage`, `TaskMessage`, `IssueStatus`, `TaskStatus`, `DaemonTokenRecord`. Existing `ApiResponse<T>` wrapper reused for all new routes |
| i18n | `apps/web/src/i18n/locales/*.json` (6 files) | Add Issues, Agents, Runtimes, Daemon sections to all 6 locales (en, zh, fr, de, es, it) — per existing convention in CLAUDE.md |
| WebSocket subscribe | `apps/web/src/contexts/WebSocketContext.tsx` | Add `subscribe('task:<id>', handler)` and `subscribe('issue:<id>', handler)` topics. Pattern already in place; no new lib |

**ESM `.js` extension rule** applies to all new server imports (CLAUDE.md lines 105-112). execa, commander, nanoid all publish valid ESM — tested via the fact that multica (also ESM) uses them.

---

## Anti-Recommendations (What NOT to Add)

### `@anthropic-ai/claude-agent-sdk@0.2.110`

**Why not:** The SDK calls the Anthropic API directly (requires `ANTHROPIC_API_KEY` in the server process) and implements its own agent loop. This **bypasses the user's installed Claude Code CLI**, which means:

1. User's `~/.claude.json` config, authenticated sessions, and OAuth are ignored.
2. User's custom MCP servers (`claude mcp add ...`) aren't loaded.
3. We'd need to handle Anthropic API billing, rate-limiting, and model lifecycle — things the user's local `claude` binary already handles.
4. Architectural misalignment: v1.4's entire premise is "daemon auto-detects user's local CLIs and registers each as a Runtime." If we go through the SDK, the daemon becomes redundant for Claude.

Multica made the same call for the same reason: spawn the CLI, let the CLI handle auth/config, parse its stream-json. We follow.

**Revisit:** v1.6+ if we add a "cloud Aquarium" tier where the server has its own Anthropic account. Not v1.4.

### `@openai/codex-sdk@0.121.0`

**Why not (for v1.4):** Similar reasoning to claude-agent-sdk, plus:
- The SDK's public API (`codex.startThread().run(prompt)`) returns final results, not a streaming `tool_use`/`tool_result` iterator (per OpenAI's developer docs).
- We need granular per-event streaming to drive the live task message UI. Multica handles this by speaking JSON-RPC 2.0 to `codex app-server --listen stdio://` directly (`codex.go:44`) — which bypasses the SDK.
- If we want an escape hatch later (v1.5+), we can swap the home-rolled JSON-RPC client for the SDK without changing any downstream types.

**Revisit:** When OpenAI publishes a documented streaming events API on the SDK. As of 0.121.0 the docs explicitly show only the non-streaming `.run()` method.

### `split2`, `ndjson`, `readable-stream`

**Why not:** `node:readline.createInterface({ input: stream, crlfDelay: Infinity })` with async iterator (`for await (const line of rl)`) is a zero-dep drop-in for line framing. Only reason to pull these in would be if we needed `Transform` stream composition — we don't; we have a single reader per subprocess.

### `react-beautiful-dnd`, `@hello-pangea/dnd`, `framer-motion` Reorder

**Why not:** `react-beautiful-dnd` is archived (Atlassian, 2022); `@hello-pangea/dnd` is maintenance-only with critically low contributor activity; `framer-motion` Reorder is list-only and adds ~40 KB for animations we don't need. Multica chose `@dnd-kit` — same choice applies.

### `mitt`, `tiny-emitter`, `rxjs`

**Why not:** Server already has `node:events`; web already has `WebSocketContext`. No new pub/sub primitive needed.

### `uuid@11` for daemon tokens

**Why not:** UUIDs are designed for uniqueness, not secrecy. They include 6 bits of fixed version/variant metadata, reducing effective entropy from 128 to 122 bits. They also don't carry a recognizable prefix — useful for secret-scanners. Use nanoid (or `crypto.randomBytes`) + `adt_` prefix.

### `zod` for schema validation

**Why not:** `ajv@8.18.0` is already installed and used for config.patch validation (`apps/server/src/agent-types/openclaw/adapter.ts` area). Adding zod duplicates a capability. One schema library.

### `winston`, `pino`, `bunyan` for logging

**Why not:** The existing server uses `console.log` + a custom log-redaction layer (`apps/server/src/log-redact.ts`, referenced in CLI). Adding a structured logger is a v1.5+ quality-of-life task, not v1.4 functionality.

---

## Open Questions for Architecture / Pitfalls Research

Flagged for the architecture and pitfalls researchers in this milestone (handed off for deeper inspection):

1. **Control-request auto-approval security model.** Multica's `claude.go:240-276` blindly writes `{behavior: "allow"}` for every `control_request`. In a daemon that runs under the user's shell, this is safe (user consented by running the daemon). But if we later host Claude execution server-side (hosted runtime mode for existing Aquarium instances), we need a different policy — probably a per-agent `allowed_tools` allowlist. → **Pitfalls research: "autonomous agent tool approval in shared infrastructure."**

2. **Subprocess sandboxing / working-directory isolation.** Multica builds a per-task `execenv` directory (`daemon.go:883-920`) with repo checkouts, skill injection, and Codex home isolation. For v1.4 we need a minimal equivalent in `apps/server/src/daemon/execenv.ts`. Scope: just a temp working directory per task? Or a full injected skills layer? → **Architecture research: "task execution environment shape."**

3. **Task-message ordering under batching.** Multica uses `seq atomic.Int32` to tag each message before 500 ms flush (`daemon.go:1086-1116`). If we implement the same buffer in Node, we need to guarantee that concurrent emit() calls increment the counter atomically even though Node is single-threaded per event loop — `let seq = 0; seq += 1` inside a synchronous emit handler is atomic by definition, but we should verify there are no `await` points inside the emit path. → **Pitfalls research: "stream-json ordering under batching."**

4. **Session resume vs fresh start failure recovery.** Multica detects "session resume failed because server GC'd the thread" and falls back to fresh session (`daemon.go:1004-1016`). Our task schema needs `prior_session_id` storage + a fallback path. → **Architecture research: "task resume state machine."**

5. **CLI auto-detection reliability.** Multica's daemon enumerates `claude`, `codex`, `openclaw`, `opencode`, `hermes` on PATH via `exec.LookPath` and reports versions via `--version` invocation. On Windows, `.cmd` shims mean `execa('claude')` may or may not find the binary depending on PATHEXT handling. → **Pitfalls research: "Windows CLI detection for daemon."**

6. **Daemon token rotation & revocation UX.** Multica has `daemon_token` with `workspace_id` + hash. On revocation, active daemons return 401 on next heartbeat and must re-authenticate. Our CE is single-user, but we need the revocation path (delete + re-issue) in the UI from day one. → **Features research or pitfalls: already captured in FEATURES.md — cross-reference.**

7. **Bundle size of @dnd-kit across the 3 imports.** Stated as ~18 KB gzipped above, but the actual number depends on tree-shaking; verify with a post-phase-1 `vite build --mode analyze` or `rollup-plugin-visualizer` run. → Not blocking, but track.

---

## Sources

**Authoritative (HIGH confidence):**
- Multica source code at `/tmp/multica/` (ground truth for v1.4 copy target):
  - `/tmp/multica/server/pkg/agent/claude.go` (lines 101-104, 115-145, 240-276, 280-333, 357-363)
  - `/tmp/multica/server/pkg/agent/codex.go` (lines 44, 106-113)
  - `/tmp/multica/server/internal/daemon/daemon.go` (lines 1086-1116, 1126, 1004-1016)
  - `/tmp/multica/server/internal/auth/jwt.go` (lines 32-52, `mdt_` prefix and sha256 hashing)
  - `/tmp/multica/server/internal/middleware/daemon_auth.go` (lines 42-85, middleware pattern)
  - `/tmp/multica/apps/web/package.json` (lines 16-18, @dnd-kit pinning)
- npm registry (live, queried 2026-04-16):
  - execa 9.6.1, commander 14.0.3, nanoid 5.1.9
  - @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2
  - @anthropic-ai/claude-agent-sdk 0.2.110, @openai/codex-sdk 0.121.0
- Existing Aquarium codebase:
  - `apps/server/package.json` (current deps)
  - `apps/web/package.json` (current deps)
  - `apps/server/src/cli.ts` (current hand-rolled arg parser)
  - `.planning/PROJECT.md` (v1.4 goals)

**Supporting (MEDIUM confidence):**
- [Top 5 Drag-and-Drop Libraries for React in 2026 (Puck)](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — @dnd-kit as default in 2026
- [dnd-kit vs react-beautiful-dnd vs Pragmatic DnD 2026 (PkgPulse)](https://www.pkgpulse.com/blog/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026)
- [Claude Agent SDK TypeScript — official CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) — SDK exists but not our path
- [OpenAI Codex SDK docs](https://developers.openai.com/codex/sdk) — confirmed non-streaming `.run()` surface
- [OpenAI Codex App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — confirms `stdio://` transport used by multica
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — `--output-format stream-json` flag
- [Node.js readline module](https://nodejs.org/api/readline.html) — `createInterface().[Symbol.asyncIterator]` stable since Node 11.4

**Undocumented / reverse-engineered (LOW confidence, validated by multica runtime):**
- Claude Code `control_request` / `control_response` protocol for stdin tool approval. Upstream GitHub issue [anthropics/claude-code#24594](https://github.com/anthropics/claude-code/issues/24594) confirms the docs are missing; multica source is the working reference.
