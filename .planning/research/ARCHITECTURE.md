# Architecture — Aquarium v1.4 Task Delegation Platform

**Scope:** Integration architecture for task delegation on top of existing Aquarium CE (Express/SQLite/Docker).
**Mode:** Project Research — Architecture only.
**Confidence:** HIGH for existing code shape, MEDIUM for SQLite concurrency ceiling, MEDIUM for daemon ↔ server transport choice.
**Researched:** 2026-04-16

Reference sources:
- Aquarium CE: repo at `/Users/shuai/workspace/citronetic/aquarium-ce2`
- Multica: repo at `/tmp/multica` (Postgres + Go + chi + Electron)

---

## System Diagrams

### Daemon flow (external runtime — claude-code / codex / opencode CLI on user's machine)

```
┌─────────┐        1. assign issue to Agent        ┌───────────────────────────────┐
│ Browser │───────────────────────────────────────►│  Express / issues.ts         │
└─────────┘                                        │  IssueService.assignAgent()  │
    ▲                                              └────────────────┬──────────────┘
    │ 11. task:message WS                                           │
    │                                                               ▼
    │                                          ┌────────────────────────────────────┐
    │                                          │ TaskService.enqueueForIssue()       │
    │                                          │  INSERT agent_task_queue            │
    │                                          │  status='queued', runtime_id=X      │
    │                                          └────────────────┬───────────────────┘
    │                                                           │
    │              (no push — daemon polls)                     │
    │                                                           ▼
    │                                   ┌─────────────────────────────────────────┐
    │                                   │ aquarium daemon start (separate proc)   │
    │                                   │ — in Node via `aquarium daemon start`   │
    │                                   │                                          │
    │                                   │ 2. POST /api/daemon/register             │
    │                                   │ 3. POST /api/daemon/heartbeat (30s)      │
    │                                   │ 4. POST /api/daemon/runtimes/:id/claim  │◄┐
    │                                   │ 5. spawns CLI: claude code ...           │ │
    │                                   │    stdout JSON-stream parser             │ │
    │                                   │ 6. POST /tasks/:id/start                 │ │
    │                                   │ 7. POST /tasks/:id/messages (batch)──────┤ │
    │                                   │ 8. POST /tasks/:id/progress              │ │
    │                                   │ 9. POST /tasks/:id/complete              │ │
    │                                   └─────────────────────────────────────────┘ │
    │                                                                                │
    │   10. TaskService persists messages + broadcasts task:message ──── WS ─────────┘
    └────────────────────────────────────────────────────────────────────────────────┘
```

### Hosted flow (existing Aquarium Docker instance as runtime)

```
┌─────────┐      1. assign issue → Agent(runtime.kind='hosted')
│ Browser │──────────┐
└─────────┘          ▼
                ┌───────────────────────────────┐
                │ Express / issues.ts           │
                │ IssueService.assignAgent()    │
                └───────────────┬───────────────┘
                                ▼
                ┌──────────────────────────────────┐
                │ TaskService.enqueueForIssue()    │
                │ INSERT agent_task_queue          │
                │ status='queued'                  │
                │ runtime_id → hosted_runtime row  │
                │ which has instance_id=I          │
                └───────────────┬──────────────────┘
                                ▼
                ┌───────────────────────────────────────────────────────┐
                │  HostedTaskWorker (in-process, singleton, setInterval)│
                │  Tick every 2s per runtime:                           │
                │  • SELECT ... claim-one (BEGIN IMMEDIATE)             │
                │  • Look up runtime.instance_id                         │
                │  • Resolve manifest-backed adapter (openclaw /         │
                │    claude-code / opencode)                             │
                │  • gatewayCall(instance_id, 'chat.send', {...})       │
                │    with retryable 30s timeout                          │
                │  • Subscribe via waitForChatCompletion() for          │
                │    streaming events                                    │
                │  • As gateway emits 'toolCall'/'toolResult'/'text' →  │
                │    insert task_message rows, broadcast WS to browser  │
                │  • On 'final' → TaskService.completeTask()            │
                │  • On exception/timeout → TaskService.failTask()      │
                └───────────────────────────────────────────────────────┘
                                ▲                                 │
                                │ (persistent WS)                 │
                                ▼                                 │
                ┌────────────────────────────────────┐            │
                │  OpenClaw gateway container        │            │
                │  (already running via DockerEngine)│            │
                └────────────────────────────────────┘            │
                                                                  ▼
                                        browser receives task:message via WS
```

The two flows are **unified at the `agent_task_queue` table**. The only difference is *who* claims the task: the external daemon via REST, or the in-process `HostedTaskWorker` via a direct SQLite transaction.

---

## Data Model Decisions

### 1. Runtime unification — Option A: single `runtimes` table with `kind` discriminator (recommended)

```sql
CREATE TABLE runtimes (
    id               TEXT PRIMARY KEY,          -- UUID (SqliteAdapter.generateId)
    workspace_id     TEXT NOT NULL,             -- default 'default' in CE
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('daemon-local','daemon-remote','hosted')),
    provider         TEXT NOT NULL,             -- 'claude-code'|'codex'|'openclaw'|'opencode'|'hermes'
    status           TEXT NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online','offline','error')),

    -- daemon-* kinds only
    daemon_id        TEXT,
    device_info      TEXT,
    last_heartbeat_at DATETIME,

    -- hosted kind only
    instance_id      TEXT REFERENCES instances(id) ON DELETE CASCADE,

    metadata         TEXT NOT NULL DEFAULT '{}', -- JSON
    owner_user_id    TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, daemon_id, provider),
    CHECK (
      (kind IN ('daemon-local','daemon-remote') AND daemon_id IS NOT NULL AND instance_id IS NULL)
      OR
      (kind = 'hosted' AND instance_id IS NOT NULL AND daemon_id IS NULL)
    )
);
CREATE INDEX idx_runtimes_workspace_status ON runtimes(workspace_id, status);
CREATE INDEX idx_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL;
```

**Justification vs Options B and C:**

| Option | Pro | Con | Verdict |
|---|---|---|---|
| A — Single table + discriminator | Matches multica schema → future DB-level compat with EE/Postgres migration; claim query is identical for all kinds (`WHERE runtime_id = ?`); one FK target simplifies `agent_task_queue` | Two nullable FKs (`instance_id`, `daemon_id`) require a CHECK constraint | **Chosen.** |
| B — Separate tables (`daemon_runtimes`, `hosted_runtimes`) | Strong typing at schema level | Every query that reads runtimes needs UNION or polymorphic join; `agents.runtime_id` cannot be a single FK; breaks multica schema compat | Rejected — adds complexity for marginal typing benefit. |
| C — Polymorphic JSON `metadata` column only | Fewest columns | Can't index on `instance_id` for reconcile-with-instances queries; CHECK constraints impossible; breaks SQL joins to `instances` | Rejected — SQLite JSON indexing is weak (needs expression indices). |

The CHECK constraint makes the schema self-enforcing: you cannot accidentally create a `hosted` runtime without an `instance_id` or a `daemon-local` runtime with one.

**`agent_task_queue.runtime_id` is a single FK to `runtimes.id`.** The task dispatcher reads `runtimes.kind` to route the task — it does not need a separate column.

### 2. Task queue atomicity on SQLite — BEGIN IMMEDIATE + SELECT + UPDATE (recommended)

Multica uses Postgres `FOR UPDATE SKIP LOCKED`. SQLite has neither row-level locks nor SKIP LOCKED — `better-sqlite3` uses a single-writer model (WAL mode).

**Recommendation:** Use a knex transaction wrapping `BEGIN IMMEDIATE` (not `BEGIN DEFERRED` — immediate acquires the write lock up front, preventing `SQLITE_BUSY` upgrades mid-transaction). Inside:
```sql
-- Pick the next claimable task for a runtime
SELECT id, agent_id, issue_id, priority
  FROM agent_task_queue
 WHERE runtime_id = :rid
   AND status = 'queued'
   AND NOT EXISTS (
         SELECT 1 FROM agent_task_queue active
          WHERE active.agent_id = agent_task_queue.agent_id
            AND active.issue_id = agent_task_queue.issue_id
            AND active.status IN ('dispatched','running'))
 ORDER BY priority DESC, created_at ASC
 LIMIT 1;

-- Immediately transition
UPDATE agent_task_queue SET status='dispatched', dispatched_at=CURRENT_TIMESTAMP
 WHERE id = :picked_id AND status='queued';   -- second predicate is a safety net
```
Commit, return the row. If UPDATE affected 0 rows (race between two racing claims on sibling runtimes pointing to overlapping work), retry once.

**Why this is sufficient:**
- SQLite serializes writers via a single mutex; two concurrent `BEGIN IMMEDIATE` transactions queue, they do not race.
- The `NOT EXISTS` subquery enforces the multica invariant (one active task per agent+issue).
- Identical to what multica does, minus SKIP LOCKED — we don't need SKIP LOCKED because we never have concurrent writers; we have serialized writers.

**Why NOT an in-process JS mutex:** It breaks if `HostedTaskWorker` and the daemon REST handler both claim. The daemon REST path is a request handler, not serialized with the hosted worker's `setInterval` tick. DB-level atomicity is the only correct boundary.

**Why NOT "just trust better-sqlite3":** better-sqlite3's `prepare().run()` is atomic *per statement*. A SELECT-then-UPDATE without a transaction is not atomic — another writer could claim between our SELECT and UPDATE, and both workers end up thinking they own the task.

**QPS ceiling (MEDIUM confidence):**
- better-sqlite3 in WAL mode benchmarks at 5K–15K write txns/sec on SSD for trivial writes. A claim txn is: 1 SELECT, 1 UPDATE, 1 COMMIT — roughly 2–3K txns/sec sustained.
- At a polling cadence of 2s per runtime and ~10 runtimes in CE, we're looking at ~5 claim attempts/sec. **Headroom is ~400×.** No concern for v1.4. Revisit if CE ever supports 100+ runtimes.
- Cancellation polls every 5s per active task (daemon calls `GET /api/daemon/tasks/:id/status`). Also negligible.

### 3. Pending-task uniqueness

Port multica's partial unique index (migration 037), adapted for SQLite:
```sql
CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent
    ON agent_task_queue (issue_id, agent_id)
    WHERE status IN ('queued', 'dispatched');
```
SQLite supports partial indices since 3.8.0 — works on better-sqlite3. This prevents the WebSocket / HTTP frontend from creating duplicate pending tasks if the user double-clicks "assign".

### 4. Task messages

Straight port of multica migration 026: `task_message(task_id, seq, type, tool, content, input, output)` with `(task_id, seq)` index. `input` as JSON text (SQLite), parsed via `SqliteAdapter.parseJson`.

---

## Service Layer Decomposition

### New services (v1.4)

| File | Responsibility | Talks to | Does NOT touch |
|---|---|---|---|
| `services/runtime-registry.ts` | CRUD for `runtimes` table. Heartbeat/deregister. Offline sweeper (setInterval). | db, WS broadcast | InstanceManager (see below re: hosted bridge) |
| `services/task-queue.ts` | `enqueueForIssue`, `enqueueForMention`, `claimForRuntime` (BEGIN IMMEDIATE), `startTask`, `completeTask`, `failTask`, `cancelTask`. Enforces `max_concurrent_tasks` and the partial unique index. Emits task:* WS events. | db, WS broadcast | DockerEngine, gateway RPC |
| `services/task-messages.ts` | Insert task messages with seq; `listSince(taskId, seq)` for browser catch-up after reconnect. | db, WS broadcast | — |
| `services/agents.ts` | Agent CRUD bound to a runtime. Skills, custom_env, custom_args, max_concurrent_tasks. | db | runtime, task-queue |
| `services/issue-service.ts` | Issue CRUD, assignment, mentions. On assignee change → calls `task-queue.enqueueForIssue`. | db, task-queue, WS | — |
| `services/comment-service.ts` | Issue comment CRUD. On agent-mention in comment → calls `task-queue.enqueueForMention`. | db, task-queue, WS | — |
| `services/daemon-tokens.ts` | `mdt_` token issuance + hash lookup + expiry. | db | — |
| `task-dispatch/hosted-worker.ts` | **The glue.** setInterval per online hosted runtime. Claims tasks, invokes gateway RPC, streams messages. Cancellation via `cancelChatCompletion`. | task-queue, gateway-rpc, gateway-event-relay | Docker, k8s, InstanceManager.updateStatus |
| `task-dispatch/runtime-bridge.ts` | Registers one synthetic `runtimes` row per running Aquarium instance at startup/on instance state change. Hooks into existing `broadcast()` on instance status. | runtime-registry, db | gateway, daemon-worker |
| `agent-backends/` (daemon-side only) | CLI executors — claude-code.ts, codex.ts, openclaw.ts, opencode.ts, hermes.ts. Each implements `Backend { execute(prompt, opts) → Session }` with JSON-stream parsing. **Ships in the daemon code path, not the server code path.** | child_process.spawn, daemon HTTP client | db (daemon is stateless w.r.t. server DB) |

### Existing services touched (minimally)

| Service | How v1.4 touches it | Why |
|---|---|---|
| `services/instance-manager.ts` | Event hook: when an instance transitions to `running` / `stopped`, `runtime-bridge.ts` upserts/updates the mirror `hosted` runtime row. **No InstanceManager internals are modified.** | Preserves "only one place transitions instance state" invariant. |
| `services/gateway-event-relay.ts` | Read-only: `HostedTaskWorker` uses existing `gatewayCall(instanceId, method, params)` + `waitForChatCompletion(instanceId, sessionKey)` facade. | Reuses existing persistent WS; no new connection. |
| `ws/index.ts` | Add new subscription type: `subscribe_task` (taskId → receive task:message events). Parallel to existing `subscribe_chat_session`. | Browser issue-detail page subscribes to task stream. |
| `middleware/auth.ts` | **Not modified.** Existing `requireAuth` remains the user middleware. | Daemon routes get a separate middleware (see Auth section). |

### Existing services explicitly NOT touched

- `runtime/types.ts`, `runtime/factory.ts`, `runtime/docker.ts`, `runtime/kubernetes.ts` — Docker/K8s runtime engines are for *container* lifecycle, independent of agent-task runtimes. Do not overload `RuntimeEngine` with task dispatch.
- `agent-types/registry.ts`, `agent-types/openclaw/*` — the existing "agent type" concept (openclaw / opencode / claude-code with manifests) is about *container image + RPC shape*. v1.4's `agents` table is about *task-executing identities*. The two coexist. A single `hosted` agent in v1.4 references an instance whose `agent_type` is (typically) `openclaw`.
- `services/group-chats.ts`, `services/skills.ts` (existing extension skills), `services/plugins.ts` — all unrelated paths.

---

## Auth / Token Model

**Goal:** Daemon authenticates with a workspace-scoped `mdt_*` token; existing cookie-based JWT auth for browser remains untouched; services downstream of middleware see a uniform `req.auth`-equivalent context regardless of which layer authenticated.

### Recommendation: separate `/api/daemon/*` routes with a dedicated `requireDaemonAuth` middleware

**Reasons vs "unified middleware on all routes":**
- Daemon routes accept *only* `mdt_` tokens, never cookie JWTs — reuse across user routes would invite the browser to accidentally call daemon-scoped endpoints without a workspace context.
- Different auth carries different permission models: user auth → `req.auth.userId`; daemon auth → `req.daemon.workspaceId` + `req.daemon.daemonId` (no user). Conflating them complicates every downstream service.
- Multica does the same split — its `/api/daemon/*` route tree uses `DaemonAuth` middleware that permits only daemon tokens (plus PAT fallback for backward compat).

### Middleware stack for daemon routes

```
POST /api/daemon/register
  ↓ cookieParser (shared)
  ↓ requireDaemonAuth                 -- sets req.daemon = { workspaceId, daemonId }
  ↓ requireDaemonWorkspaceAccess(...) -- for routes with :workspaceId / :runtimeId
  ↓ handler
```

```ts
// middleware/daemon-auth.ts
export interface DaemonAuthPayload { workspaceId: string; daemonId: string; tokenId: string; }
declare global { namespace Express { interface Request { daemon?: DaemonAuthPayload } } }

export async function requireDaemonAuth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith('Bearer mdt_')) return res.status(401).json({ ok: false, error: 'daemon token required' });
  const token = hdr.slice(7);
  const hash = sha256(token);
  const row = await db('daemon_tokens').where({ token_hash: hash }).first();
  if (!row || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ ok: false, error: 'invalid or expired token' });
  }
  req.daemon = { workspaceId: row.workspace_id, daemonId: row.daemon_id, tokenId: row.id };
  next();
}
```

### Context propagation

- Services **do not read `req` directly**. Every call passes an explicit `ctx` object: `{ userId?: string; workspaceId: string; daemonId?: string }`. This matches the existing CE pattern where `createInstance(userId, req)` takes `userId` as a first positional arg.
- Route handlers are the only layer that translates either `req.auth.userId` or `req.daemon.workspaceId` into that ctx.
- For CE single-user mode: routes in the daemon namespace that need a `userId` resolve to the workspace's `owner_user_id`. Admin user already exists (see `server-core.ts` line 222-238) and the `runtimes.owner_user_id` column we're adding can reference it.

### Token lifecycle

- Browser UI issues tokens under `POST /api/users/me/daemon-tokens { workspaceId, ttlDays }` → returns plaintext `mdt_<random-48-byte>` exactly once (then we only keep the hash). Matches multica behaviour.
- Migration creates `daemon_tokens(id, token_hash UNIQUE, workspace_id FK, daemon_id, expires_at, created_at, last_used_at)`.
- Revocation = `DELETE FROM daemon_tokens WHERE id = ?`. The next request with that token 401s.

### WebSocket auth

**Recommendation:** keep the existing `/ws` endpoint for browsers only. Do not add WS for the daemon (see next section).

---

## WebSocket Unification

### Recommendation: HTTP long-poll for daemon, WS for browser (matches multica)

#### Rejected: `/ws-daemon` persistent WebSocket

Pros: Lower latency task dispatch (push instead of poll).
Cons, weighted heavy:
- **Corporate proxy hostility.** Long-lived WS through HTTP proxies is a common pain point. Dropped idle connections, aggressive NAT timeouts, interception boxes that mangle upgrade headers.
- **Reconnect complexity.** The daemon must resume task state after every disconnect — retry unclaimed tasks, verify active task status. Polling avoids this class of bug entirely. Multica's poll-every-1s-with-5s-cancellation-tick design is fine for tens of runtimes.
- **Two WS servers.** We already have `/ws` for browser and the backend-to-gateway WS. Adding a third protocol surface for daemons increases test surface with no user-visible benefit.
- **The long-poll path is already hardened** in CE. Existing HTTP routes go through `helmet`, `dynamicCors`, rate limiters. WS needs separate hardening.

#### Chosen: REST polling for daemon

| Endpoint | Cadence | Notes |
|---|---|---|
| `POST /api/daemon/register` | 1× at start | Returns list of `runtime_id` assignments |
| `POST /api/daemon/heartbeat` | 30s | Can piggyback pending-ping + pending-update IDs |
| `POST /api/daemon/runtimes/:id/claim` | 1s (exponential backoff to 5s when idle) | Returns `{ task: ... }` or `{ task: null }` |
| `POST /api/daemon/tasks/:id/start` | on claim | |
| `POST /api/daemon/tasks/:id/messages` | batched every 500ms during execution | Deliberately batched — avoids per-token HTTP roundtrip |
| `POST /api/daemon/tasks/:id/progress` | on agent step | |
| `POST /api/daemon/tasks/:id/complete` / `/fail` | on finish | |
| `GET  /api/daemon/tasks/:id/status` | 5s during active task | Cancellation signal |
| `POST /api/daemon/deregister` | shutdown | |

This maps 1:1 to multica's `internal/handler/daemon.go` surface area and is proven.

### Failure-mode analysis

| Failure | Daemon behaviour | Server behaviour |
|---|---|---|
| Corporate proxy drops idle connection | Next poll re-establishes TCP — no state loss | — |
| Server restarts mid-task | Daemon's in-flight messages 502 → retry with exp-backoff; eventually succeeds after restart | `/tasks/:id/complete` is idempotent (CHECK `status='running'`); `task.status` re-reads from DB |
| Network partition >30s | Heartbeat loop flags runtime as offline after 90s (3 missed heartbeats) → runtime sweeper flips status | `Task.status` stays `running`; no auto-cancel — admin must manually cancel |
| Token rotated mid-task | 401s on next call → daemon must re-auth; tasks already claimed stall and surface as stale-running in UI | — |

The "stale running task" problem is addressed via a sweeper (see Boot Sequence).

### Browser WS additions

Extend `/ws` protocol (in `ws/index.ts`) with:
- `subscribe_issue` / `unsubscribe_issue` → receive `task:dispatch`, `task:message`, `task:completed`, `task:failed`, `task:cancelled`, `comment:created` events scoped to an issue.
- `subscribe_workspace` → receive agent-status and runtime-status updates for the whole workspace (CE = `default`).

No change to auth model (existing `auth` frame with `ce-admin` / `test:<uid>` token continues to work).

---

## Boot Sequence Impact

### Current CE boot order (from `server-core.ts` lines 202–266)

```
1.  db.migrate.latest()
2.  onAfterMigrate()                    — EE hook
3.  CE default user seed
4.  reloadDynamicMiddleware()
5.  recoverOrphanedOperations()         — extension lifecycle
6.  reconcileInstances()                — transitions 'starting' → 'running' / 'error' based on Docker
7.  engine.cleanupOrphanNetworks()
8.  startHealthMonitor()                — per-instance Docker health polling
9.  startGatewayEventRelay()            — persistent WS to gateways, reconciles every 10s
10. onBeforeListen()                    — EE hook
11. server.listen()
```

### v1.4 additions (in dependency order)

```
    ... steps 1–9 unchanged ...

9a. await runtimeBridge.reconcileFromInstances()
        — For every instance in 'running' state, ensure a matching
          runtimes row exists with kind='hosted'.
        — MUST run AFTER reconcileInstances (step 6) and AFTER
          startGatewayEventRelay (step 9) — because:
            • We need reconciled instance state to mirror correctly.
            • HostedTaskWorker depends on gateway RPC being connectable
              within ~10s (the gateway-relay reconcile interval).

9b. taskQueueSweeper.start()
        — setInterval(60s): mark any task stuck in 'dispatched' for >5min
          as 'failed' with error='dispatch timeout';
          mark any task in 'running' whose runtime has been offline for
          >5min as 'failed' with error='runtime offline'.

9c. hostedTaskWorker.start()
        — One setInterval tick per online hosted runtime (polling cadence 2s).
        — Ticks are NO-OPs if no matching gateway client exists yet
          (isGatewayConnected(instanceId) === false) — the worker
          silently skips and retries next tick.

9d. runtimeRegistryOfflineSweeper.start()
        — setInterval(30s): flip runtimes.status='offline' where
          last_heartbeat_at < now()-90s AND kind IN ('daemon-local','daemon-remote').
        — Hosted runtimes don't heartbeat; their status mirrors the
          underlying instance.status.

    ... step 10 (onBeforeListen) ...
    ... step 11 (server.listen) ...
```

### In-flight-task semantics on server restart

- **Daemon tasks:** survive. Daemon reconnects, next poll to `/tasks/:id/status` returns `running`, next `/messages` POST succeeds. Daemon finishes and POSTs `/complete`.
- **Hosted tasks:** do NOT survive. The in-process chat completion promise dies. The persistent gateway client reconnects but has no record of the pending callback. Server-side sweeper (step 9b) times these out at 5min. The user sees "failed: dispatch timeout" and can re-assign.
  - **Mitigation:** on startup, query `SELECT id FROM agent_task_queue WHERE status IN ('dispatched','running') AND runtime.kind='hosted'` and immediately fail these with `error='server restarted; please retry'`. Faster and clearer than 5min timeout.

### Daemon-CLI boot sequence (separate process)

```
aquarium daemon start [--server URL] [--token mdt_...] [--agents claude,codex]
  1. Load config (~/.aquarium/daemon.json)
  2. Resolve token: --token flag > env AQUARIUM_DAEMON_TOKEN > config file
  3. Detect CLIs on PATH: which claude, which codex, which openclaw, which opencode, which hermes
  4. Build runtimes list with {type, version, status:'online'}
  5. POST /api/daemon/register → get runtime_ids, persist mapping
  6. go heartbeatLoop() (30s)
  7. go pollLoop() (claim tasks, spawn CLI, stream messages)
  8. Trap SIGTERM → POST /api/daemon/deregister with 5s timeout
```

Same binary (`@aquaclawai/aquarium`). Subcommand pattern in `cli.ts` — router after the arg parse decides `server` (default — current behaviour) vs `daemon start` / `daemon stop` / `daemon status`.

---

## File Layout Proposal

**Principle:** co-locate v1.4 code into named subsystems within the existing `apps/server/src` tree, rather than a catch-all `apps/server/src/multica/`. The multica namespace would signal a foreign codebase; these are first-class Aquarium concerns now.

```
apps/server/src/
├── cli.ts                              -- existing, modified to dispatch subcommands
├── cli/                                -- NEW: subcommand entry points
│   ├── server.ts                       -- current default behaviour moved here
│   ├── daemon.ts                       -- `aquarium daemon start|stop|status`
│   └── help.ts
├── daemon/                             -- NEW: LOCAL daemon (runs on user's machine)
│   ├── daemon.ts                       -- Daemon class (port of multica daemon.go)
│   ├── config.ts                       -- config load, agent autodetect (which <cli>)
│   ├── http-client.ts                  -- calls back to server /api/daemon/*
│   ├── poll-loop.ts
│   ├── heartbeat-loop.ts
│   └── task-runner.ts                  -- orchestrates backend → stream → post messages
├── agent-backends/                     -- NEW: CLI executors, used ONLY by daemon
│   ├── types.ts                        -- Backend, Session, MessageType, ExecOptions
│   ├── claude-code.ts                  -- spawns `claude`, parses --stream-json
│   ├── codex.ts
│   ├── openclaw-backend.ts             -- (distinct from existing agent-types/openclaw)
│   ├── opencode.ts
│   ├── hermes.ts
│   └── registry.ts
├── routes/
│   ├── daemon.ts                       -- NEW: /api/daemon/* routes (mounted after requireDaemonAuth)
│   ├── issues.ts                       -- NEW: /api/issues/* routes (user auth)
│   ├── comments.ts                     -- NEW: /api/issues/:id/comments (user auth)
│   ├── agents.ts                       -- NEW: /api/agents/* routes
│   ├── runtimes.ts                     -- NEW: /api/runtimes/* (user-visible list)
│   ├── tasks.ts                        -- NEW: /api/tasks/:id/messages (user-visible history)
│   └── ...(existing routes unchanged)
├── services/
│   ├── runtime-registry.ts             -- NEW
│   ├── task-queue.ts                   -- NEW
│   ├── task-messages.ts                -- NEW
│   ├── agents.ts                       -- NEW (agents table, not agent-types)
│   ├── issue-service.ts                -- NEW
│   ├── comment-service.ts              -- NEW
│   ├── daemon-tokens.ts                -- NEW
│   └── ...(existing services unchanged)
├── task-dispatch/                      -- NEW: the glue between task-queue and instance RPC
│   ├── hosted-worker.ts                -- setInterval worker for hosted runtimes
│   ├── runtime-bridge.ts               -- mirrors instances ↔ runtimes
│   └── sweepers.ts                     -- stale task + offline runtime sweepers
├── middleware/
│   └── daemon-auth.ts                  -- NEW: requireDaemonAuth
├── db/
│   └── migrations/
│       ├── 003_workspace_agent_runtime.ts      -- NEW
│       ├── 004_issues_comments_activity.ts     -- NEW
│       ├── 005_agent_task_queue.ts             -- NEW
│       ├── 006_task_messages.ts                -- NEW
│       └── 007_daemon_tokens.ts                -- NEW

apps/web/src/
├── pages/
│   ├── issues/                         -- NEW
│   │   ├── IssueBoardPage.tsx          -- kanban by status
│   │   └── IssueDetailPage.tsx         -- title, description, comments, live task stream
│   ├── agents/
│   │   ├── AgentsPage.tsx
│   │   └── AgentDetailPage.tsx
│   ├── runtimes/
│   │   └── RuntimesPage.tsx            -- daemon runtimes + hosted runtimes in one list
│   └── daemon-tokens/
│       └── DaemonTokensPage.tsx
├── components/
│   ├── issues/
│   │   ├── IssueCard.tsx
│   │   ├── IssueStatusBadge.tsx
│   │   ├── TaskMessageStream.tsx       -- subscribes to subscribe_issue WS
│   │   └── ToolCallBubble.tsx
│   └── ...
└── i18n/locales/{en,zh,fr,de,es,it}.json  -- extend each
```

### Justification vs alternatives

| Alternative | Problem |
|---|---|
| Single `apps/server/src/multica/` dir holding ALL new code | Signals foreign code; creates two parallel patterns (services vs multica-style). Hurts discoverability — a new contributor looking at `/api/issues` would search `routes/` and find nothing. |
| `apps/daemon/` as a new workspace package | Daemon is small (~1.5k LOC ported from multica). A whole workspace adds build overhead (tsconfig, package.json, npm workspace wiring, `@aquarium/daemon` imports) for no gain; it ships in the same npm tarball anyway. |
| Leave `agent-backends/` in `agent-types/` | Conflates "how to format an agent CLI prompt" (daemon-side) with "which Docker image to spawn" (server-side). Two different concerns; must split. |

### Daemon code bundled with server package

- `@aquaclawai/aquarium` stays a single npm package. `bin.aquarium` entry still points to `./dist/cli.js`. The CLI routes to either the server subcommand or the daemon subcommand.
- User installs via `npx @aquaclawai/aquarium` (server) or `npm i -g @aquaclawai/aquarium && aquarium daemon start` (daemon).
- **Pitfall flagged downstream:** daemon code imports `agent-backends/*`, which must NOT import anything from `db/`, `services/`, `middleware/`, `routes/`, `runtime/`. If it does, the daemon will pull in knex + better-sqlite3 + docker-modem and boot time explodes. Enforce via a lint rule or tsc project references.

---

## Shared Types Scope

### Must live in `packages/shared/src/types.ts`

These are used by both server AND the web UI AND (in some cases) the daemon HTTP request bodies:

```ts
// Core domain
export interface Issue { id, workspaceId, title, description, status, priority, assigneeType, assigneeId, creatorType, creatorId, parentIssueId, dueDate, createdAt, updatedAt }
export type IssueStatus = 'backlog'|'todo'|'in_progress'|'in_review'|'done'|'blocked'|'cancelled'
export type IssuePriority = 'urgent'|'high'|'medium'|'low'|'none'
export interface Agent { id, workspaceId, runtimeId, name, avatarUrl, description, instructions, visibility, status, maxConcurrentTasks, customEnv, customArgs, ownerId, archivedAt }
export type AgentStatus = 'idle'|'working'|'blocked'|'error'|'offline'
export interface Runtime { id, workspaceId, name, kind, provider, status, daemonId?, instanceId?, deviceInfo?, metadata, lastHeartbeatAt?, ownerUserId?, createdAt, updatedAt }
export type RuntimeKind = 'daemon-local'|'daemon-remote'|'hosted'
export interface AgentTask { id, agentId, runtimeId, issueId?, chatSessionId?, status, priority, dispatchedAt?, startedAt?, completedAt?, error?, result?, sessionId?, workDir?, triggerCommentId? }
export type TaskStatus = 'queued'|'dispatched'|'running'|'completed'|'failed'|'cancelled'
export interface TaskMessage { id, taskId, seq, type, tool?, content?, input?, output?, createdAt }
export type TaskMessageType = 'tool_use'|'tool_result'|'text'|'thinking'|'error'
export interface Comment { id, issueId, authorType, authorId, content, type, parentId?, createdAt }

// WS events
export type TaskEventType = 'task:dispatch'|'task:progress'|'task:message'|'task:completed'|'task:failed'|'task:cancelled'
export interface TaskMessagePayload { taskId, issueId?, chatSessionId?, seq, type, tool?, content?, input?, output? }

// Daemon API (used by routes/daemon.ts AND daemon/http-client.ts)
export interface DaemonRegisterRequest { workspaceId, daemonId, deviceName, cliVersion, launchedBy, runtimes: Array<{ name, type, version, status }> }
export interface DaemonRegisterResponse { runtimes: Runtime[] }
export interface ClaimedTask extends AgentTask { agent: { id, name, instructions, skills, customEnv, customArgs }, repos: Array<{ url, description }>, workspaceId, priorSessionId?, priorWorkDir?, triggerCommentContent? }
```

### Stays server-only (`apps/server/src/...`)

- DB row types (`DbAgentRow`, `DbTaskRow`) — shape differs from wire types (snake_case, JSON-as-string for SQLite).
- `InstanceSpec`, `RuntimeEngine` (already server-only).
- Gateway RPC internals.

### Stays daemon-only (`apps/server/src/daemon/`, `apps/server/src/agent-backends/`)

- `Backend`, `Session`, `BackendConfig`, `ExecOptions` — these are the CLI-executor contract; the server never sees them.
- Parser state types for stream-json.

### Not shared: DaemonCli ↔ Server wire types are shared; internal daemon types are not

The daemon HTTP client in `daemon/http-client.ts` imports `@aquarium/shared` for request/response shapes. Its internal task-runner types are local.

---

## Build Order (Phase Dependency Sketch)

Downstream planners need concrete sequencing. The dependency graph looks like:

```
                ┌── Phase A: Schema + Types ──┐
                │                              │
                ▼                              ▼
Phase B: Runtime Registry        Phase C: Agent + Issue Services
(+ runtime-bridge hooks)         (agents, issues, comments, activity)
                │                              │
                └──────────┬───────────────────┘
                           ▼
                Phase D: Task Queue (enqueue/claim/lifecycle, BEGIN IMMEDIATE)
                           │
              ┌────────────┴────────────────────┐
              ▼                                  ▼
  Phase E: Daemon Server-Side          Phase F: Hosted Worker + Dispatch
  (routes + auth middleware +           (task-dispatch/hosted-worker using
   daemon_tokens)                        existing gatewayCall + waitForChatCompletion)
              │
              ▼
  Phase G: Daemon CLI + Agent Backends
  (stream-json parsers for claude/codex/openclaw/opencode)
              │
              ▼
  Phase H: Web UI — Issue Board + Issue Detail
              │
              ▼
  Phase I: Web UI — Agents, Runtimes, Daemon Tokens
              │
              ▼
  Phase J: Boot-sequence integration, sweepers, in-flight-task recovery
              │
              ▼
  Phase K: E2E tests + docs + release
```

### Why this order

- **A before everything:** no service can be built without its table + shared types. Running migrations first lets every other phase be merge-independent.
- **B parallel with C:** runtime-registry and agent/issue service don't touch each other's tables directly.
- **D depends on both B + C:** task queue FKs point at runtimes and agents; issue assignment triggers enqueue.
- **E and F parallel:** both consume D. E does not touch the gateway; F does not touch daemon auth.
- **G depends on E:** daemon HTTP client needs server endpoints to exist.
- **H depends on D:** issue board reads tasks.
- **I depends on B, C, E:** agent/runtime/token CRUD UI.
- **J comes late:** sweepers test the "what happens after restart" path — need all earlier phases in place.
- **K is final:** integration tests require the full system.

### Critical path gotchas flagged for pitfalls researcher

1. **Migration number collisions.** Aquarium CE has existing migrations 001–002; multica has 001–046 and duplicates at 020, 026, 027, 029, 032, 040, 041, 043, 046 (merge conflicts not cleaned up). We do NOT port multica's numbering — we pick sequential numbers in our migration dir starting at 003. Note: CLAUDE.md warns "35 migrations with duplicate numbers at 021 and 027" — this is a multi-package reference, ours starts clean.
2. **`reconcileInstances()` → `runtime-bridge` race.** If `startGatewayEventRelay()` (step 9) races with `runtimeBridge.reconcileFromInstances()` (step 9a), the bridge may create a `hosted` runtime row with `status='online'` before its gateway is actually connected. `hostedTaskWorker` tick that sees `isGatewayConnected(instanceId)===false` must silently skip — not fail the task.
3. **Hosted task worker + persistent WS queue semantics.** `gatewayCall` already queues if the persistent client is "disconnected but client exists" (30s timeout). That's a gift for hosted tasks: a brief gateway reconnect blip doesn't fail the task. But it also means `hostedTaskWorker` MUST NOT treat `gatewayCall` timing out as "runtime offline" — it just means "one task failed; runtime is likely still fine".
4. **better-sqlite3 is synchronous; knex wraps it async.** `await db.transaction(async trx => { ... })` still works but the underlying operations are sync — no I/O yield inside the transaction. This is fine for our claim size.
5. **Extension code and v1.4 code share the `services/` dir.** Be careful not to name-collide. Existing: `extension-lifecycle.ts`, `skill-store.ts`, `plugin-store.ts`. New: `agents.ts` (risky — plural of "agent-types"?), consider `agent-store.ts` or `agents-service.ts` to avoid confusion with `agent-types/`.
6. **Daemon CLI shares its binary with server CLI.** The binary name `aquarium` is ambiguous. Make the subcommand split explicit at the top of `cli.ts` — no flag-only detection, always require `aquarium server` or `aquarium daemon start`. For backward compat, `aquarium` (no subcommand) defaults to server mode with a deprecation notice.

### Migration path from existing instances — recommendation: virtual row per running instance

- **Do NOT backfill.** Existing `instances` rows are *not* automatically promoted to a `runtimes` row on migrate.
- Instead, `runtime-bridge.ts` runs at boot (step 9a): for every instance currently `running`, upsert a `runtimes` row with `kind='hosted'`, `instance_id=<that instance>`, `provider=<instance.agent_type>`, `name="<instance.name> (hosted)"`.
- When an instance stops, the bridge marks the mirror runtime `status='offline'` (but doesn't delete — agent references should remain resolvable for UI history).
- When an instance is deleted, ON DELETE CASCADE on `runtimes.instance_id` cleans up.
- Net result: users see all their existing instances in the new "Runtimes" UI without any explicit migration step, but the two tables remain loosely coupled.

This preserves the "InstanceManager is the single place that transitions instance state" invariant — `runtime-bridge` only *mirrors* state, never writes to `instances`.

---

## Open Questions for Pitfalls Research

The pitfalls researcher should focus on these high-risk areas discovered during architecture:

1. **SQLite transaction deadlock surface.** What happens if `hostedTaskWorker` holds `BEGIN IMMEDIATE` and a daemon REST handler tries the same? better-sqlite3 serializes — but does that serialize across Node async ticks correctly under knex? (Investigate: knex's SQLite connection pool size, acquireTimeout defaults.)

2. **Stale-running task zombies.** If a daemon crashes after `/start` but before `/complete`, the task sits in `running` forever until the sweeper. For hosted, the server restart scenario. For daemon, an uncaught exception in the CLI. The sweeper's 5-min timeout is a tradeoff — too short kills legitimately-long tasks (multica's default is 20min). What's the right default?

3. **Gateway RPC timeout vs task duration.** `gatewayCall` default is 30s. Chat completions can take minutes. Existing code passes 120_000ms for `waitForChatCompletion`. The hosted worker must use generous timeouts AND still respect user cancellation. Can cancellation interrupt mid-`waitForChatCompletion`?

4. **Agent-type registry vs agent backends.** Two parallel concepts with the word "agent". High confusion risk for new contributors. Which one does a user mean when they say "my agent"? Naming audit recommended.

5. **Task message ordering under retry.** Daemon batches messages every 500ms. If the batch POST fails, the daemon retries. `seq` is assigned by the daemon monotonically — fine for ordering. But two daemons could never run the same task (claim is unique), so there's no merge problem. Confirm: does the daemon persist `seq` across crashes? Probably not.

6. **Port range for hosted runtimes.** Existing `openclaw-net` uses 19000–19999 for instance containers. Hosted runtimes don't need new ports — they reuse the instance's gateway. Confirm no port clash with new daemon health port (multica uses 47321; we should do the same but document it).

7. **Rate-limiter coverage.** `/api/daemon/*` is under `/api/` which gets the production rate limiter (300 req per 15min per IP). A daemon doing 1s-cadence claim calls = 900 req / 15min. **That exceeds the limit.** The daemon subtree needs its own limiter or exemption. Address in phase E.

8. **Cookie parser + bearer token dual.** Express routes all pass through `cookieParser()`. This is harmless for daemon routes — they ignore cookies — but verify no middleware auto-sets `req.auth` based on a stale cookie header from the daemon process env. The default `requireAuth` pattern (auto-auth as first user) should NOT apply to daemon routes.

9. **Web UI WebSocket fan-out scale.** One browser subscribing to issue detail + opening agent page + looking at runtimes list = 3 subscriptions. Not a problem at CE scale. Flag for EE.

10. **ESM `.js` import hygiene in new dirs.** CLAUDE.md warns about dropping the `.js` extension. With the large number of new files in `daemon/`, `agent-backends/`, `task-dispatch/`, the probability of one missed import causing a runtime crash is high. ESLint rule `import/extensions` set to always-require `.js` on relative imports is mandatory.

11. **DB writer lock-up if a sync better-sqlite3 call inside a transaction does a large JSON parse.** The `task_message.input` column is JSON; for very long agent tool inputs, parsing on claim could pause the writer long enough to block hearts/claims. Consider indexing with `SELECT ... FROM agent_task_queue` avoiding the JSON field during claim, and only fetching full rows outside the transaction.

12. **Daemon binary self-update.** Multica has a brew/download auto-update path (`handleUpdate` in daemon.go). v1.4 should **defer** this — it's ambitious and orthogonal. Users install via `npm i -g` and update via `npm update`. Flag for v1.5.

---

*Confidence notes:* All claims about Aquarium CE internals are HIGH (verified against the code). Claims about multica are HIGH (verified against `/tmp/multica`). The recommendation to use long-polling over WebSocket is MEDIUM (well-reasoned but the alternative is defensible; a spike test of WS through a corporate proxy would upgrade confidence). The SQLite QPS ceiling of ~2–3K claim txns/sec is MEDIUM — extrapolated from public better-sqlite3 benchmarks, not measured on the actual claim query shape.
