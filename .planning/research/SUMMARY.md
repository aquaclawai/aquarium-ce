# v1.4 Task Delegation — Research Synthesis

**Project:** Aquarium CE v1.4 — Task Delegation Platform
**Synthesized:** 2026-04-16
**Confidence:** HIGH (3 MEDIUM flags tracked in Open Questions)

## TL;DR

- **Copy multica's schema + lifecycle verbatim** (with six deletions — see *Feature Scope*); the only genuinely novel piece is the `hosted_instance` runtime driver that reuses Aquarium's existing `gatewayCall()` / `waitForChatCompletion()` facade. All three runtime kinds unify at a single `agent_task_queue` table; they differ only in *who claims the task* (external daemon via REST vs in-process `HostedTaskWorker` via SQLite transaction).
- **Six small npm additions, zero replacements:** `execa@9.6.1`, `commander@14.0.3`, `nanoid@5.1.9`, `@dnd-kit/core@6.3.1` + `sortable@10.0.0` + `utilities@3.2.2`. Explicitly rejected: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `split2`/`ndjson`, `react-beautiful-dnd`, `zod`, `mitt`, `uuid`, any structured logger.
- **SQLite concurrency ceiling is fine** (~2–3k claim txns/sec headroom, ~400× what CE needs). Atomicity via `BEGIN IMMEDIATE` + `SELECT ... NOT EXISTS ... LIMIT 1` + conditional `UPDATE WHERE status='queued'`. WAL mode + `busy_timeout=5000` are mandatory PRAGMAs.
- **Long-polling over HTTP for daemon↔server, WebSocket only for browser↔server.** Matches multica; avoids corporate-proxy hostility and a third protocol surface. Daemon auth is a DB-backed opaque-token scheme (`adt_` prefix), completely disjoint from cookie-JWT user auth.
- **Single riskiest phase is Agent Backend** (10 pitfalls, 4 HARD: unbounded async leaks, unhandled rejections, SIGTERM→zombie escalation, stdout backpressure). Merits a carve-out unit-test harness using `node --test` — the only exception to "Playwright only" in CLAUDE.md. **Recommend splitting into G1 (claude-code happy path + concurrency primitives + unit tests) and G2 (codex/openclaw/opencode/hermes + full error/cancel).**

## Stack Additions (version-pinned)

| Pkg | Version | Surface | Rationale |
|---|---|---|---|
| `execa` | `9.6.1` | server (daemon-side) | Subprocess orchestration; ESM-native, Node 22+, handles timeout/kill/signal cross-platform. 5× less boilerplate than raw `child_process` across 5 agent backends. |
| `commander` | `14.0.3` | server | Subcommand routing for `aquarium daemon start|stop|status|token`; replaces hand-rolled `getFlag()`/`hasFlag()` in `apps/server/src/cli.ts`. Preserve Phase-1/Phase-2 parse-then-import order. |
| `nanoid` | `5.1.9` | server | 32 chars × 64-char alphabet = 192 bits entropy for daemon tokens. 130 B gzipped. `crypto.randomBytes().toString('hex')` is acceptable zero-dep fallback. |
| `@dnd-kit/core` | `6.3.1` | web | Kanban DnD; exact multica version match. React 19 compatible. ~10 KB gzipped. |
| `@dnd-kit/sortable` | `10.0.0` | web | Sortable preset. ~6 KB gzipped. |
| `@dnd-kit/utilities` | `3.2.2` | web | `CSS.Transform.toString()`. ~2 KB gzipped. |

**Total web bundle impact:** ~18 KB gzipped for @dnd-kit trio. **Server:** zero.

**Zero-dep built-ins used instead of libraries:** `node:readline` (`crlfDelay: Infinity` + `for await`), `node:events` (typed in-process pub/sub), `node:crypto` (`timingSafeEqual`, `createHash('sha256')`, `randomUUID()`), `AbortController`, `ajv@8.18.0` (already installed — stream-message schema validation).

**Rejections with rationale:** `@anthropic-ai/claude-agent-sdk` (bypasses user's installed `claude` CLI), `@openai/codex-sdk` (no streaming event API, only `.run()`), `split2`/`ndjson` (redundant with `node:readline`), `react-beautiful-dnd` (archived 2022), `zod` (duplicates ajv), `mitt`/`tiny-emitter` (stdlib sufficient), `uuid` (for uniqueness not secrecy), `winston`/`pino` (existing `console.log` sufficient).

## Feature Scope

### Table Stakes (12 must-haves)

1. **Workspace** (single `default`, `issue_prefix='AQ'`, monotonic `issue_counter`). All new tables FK to `workspace_id` for EE.
2. **Agent** with `instructions`, `custom_env`, `custom_args`, `max_concurrent_tasks DEFAULT 6 CHECK 1..16`, `visibility`, `status`, `archived_at/by`. Drop multica's `runtime_mode` — kind lives on the runtime.
3. **Runtime** with three kinds: `local_daemon | external_cloud_daemon | hosted_instance`. Single table with discriminator + CHECK.
4. **Issue** with **six** statuses (drop `in_review`): `backlog | todo | in_progress | done | blocked | cancelled`. Priority + `position FLOAT` for kanban.
5. **Task** (`agent_task_queue`) with `queued | dispatched | running | completed | failed | cancelled`. **Partial unique index** `(issue_id, agent_id) WHERE status IN ('queued','dispatched')` for coalescing (multica mig 037). **No auto-retry.**
6. **`trigger_comment_id`** on tasks — thread-aware replies + duplicate-suppression. One nullable UUID, huge UX payoff.
7. **Comment** with `type IN ('comment','status_change','progress_update','system')` and `parent_id`. Drives timeline; replaces `activity_log` (deferred).
8. **Task message** stream (`task_message(task_id, seq, type, tool, content, input, output)` with `(task_id, seq)` index). Two ingestion paths: daemon POST + hosted-instance gateway-event translator.
9. **Daemon REST API** (9 endpoints: register/heartbeat/deregister/claim/start/progress/messages/complete/fail) + daemon-token middleware. Tokens `adt_<32 nanoid chars>` stored as SHA-256.
10. **`max_concurrent_tasks`** enforcement in `ClaimTask`.
11. **Heartbeat sweeper** with multica defaults: 15s heartbeat, 45s offline (3 missed), 30s sweep tick, 5m dispatch timeout, 2.5h running timeout, 7d offline GC.
12. **Hosted-instance driver** — the Aquarium-specific piece.

### Differentiators (ship in v1.4 if schedule holds)

- **D3 — Custom env/args per agent** (ship): users need `ANTHROPIC_BASE_URL` / `OPENAI_API_KEY` per agent immediately.
- **D4 — Agent archival** (ship): soft delete; FK cascades on hard delete painful.
- **D6 — `issue.position` FLOAT** (ship): fractional indexing; retrofitting later needs data migration.
- **D1 — Chat-on-issue** (nice-to-have): reuses task-message stream. Defer if tight.
- **D2 — Skills schema** (ship tables only, UI v1.5): avoids schema bump when templates need skill fields.

### Deferred (v1.5+)

activity_log (dropped — comment drives timeline), inbox (single-user), issue dependencies / parent_issue_id, **session-resume daemon logic** (persist `session_id`, don't resume yet), Autopilots, Projects, Attachments, reactions, workspace invitations/members, @-mention-triggered tasks on non-assignees, pgvector search (SQLite uses LIKE), PATs, skill UI, daemon self-update.

### Anti-features (won't reconsider)

`runtime_usage` billing (multica dropped at mig 046), daemon OAuth/QR pairing (dropped at 029), workspace email verification, issue-scoped git repos (dropped at 007), pinned items, workspace context, `in_review` status, agent `custom_env` encryption at rest (redaction at API boundary sufficient for v1.4).

## Architecture Decisions

### Runtime unification — single `runtimes` table + `kind` discriminator + CHECK

```sql
CREATE TABLE runtimes (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('local_daemon','external_cloud_daemon','hosted_instance')),
    provider         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','error')),
    daemon_id        TEXT,
    device_info      TEXT,
    last_heartbeat_at DATETIME,
    instance_id      TEXT REFERENCES instances(id) ON DELETE CASCADE,
    metadata         TEXT NOT NULL DEFAULT '{}',
    owner_user_id    TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, daemon_id, provider),
    CHECK (
      (kind IN ('local_daemon','external_cloud_daemon') AND daemon_id IS NOT NULL AND instance_id IS NULL)
      OR
      (kind = 'hosted_instance' AND instance_id IS NOT NULL AND daemon_id IS NULL)
    )
);
```

`agent_task_queue.runtime_id` is a single FK to `runtimes.id`. Dispatcher reads `runtimes.kind` to route.

### SQLite claim pattern (BEGIN IMMEDIATE + NOT EXISTS)

```sql
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

UPDATE agent_task_queue
   SET status='dispatched', dispatched_at=CURRENT_TIMESTAMP
 WHERE id = :picked_id AND status='queued';
```

Retry once if UPDATE affects 0 rows. **Mandatory boot PRAGMAs:** `journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000;`.

### Hosted-instance worker (Aquarium-specific glue)

`apps/server/src/task-dispatch/hosted-worker.ts` — in-process singleton, `setInterval` per online hosted runtime at 2s cadence. Per tick:

1. Skip silently if `isGatewayConnected(instanceId) === false`.
2. Claim one task via BEGIN IMMEDIATE path.
3. Verify `instance.status === 'running'`; else fail `"instance offline"`.
4. Compose prompt from agent instructions + issue + trigger comment.
5. `gatewayCall(instanceId, 'chat.send', {...}, 120_000)` + `waitForChatCompletion`.
6. Translate gateway parts → `task_message` rows:

| Gateway part | `task_message.type` | Fields |
|---|---|---|
| `text` | `text` | `content = part.text` |
| `toolCall` | `tool_use` | `tool = part.name`, `input = part.arguments` |
| `toolResult` | `tool_result` | `output = part.output`, `tool = part.toolName` |
| `thinking` | `thinking` | `content = part.text` |

**Hosted does NOT support**: session resume, custom `work_dir`, custom `custom_args` (log warning), custom `custom_env` (log warning).

### Auth — cookie-JWT (users) disjoint from daemon token (daemons)

Two middleware, no shared code:
- `requireAuth` — cookie JWT only, rejects `Authorization: Bearer …`.
- `requireDaemonAuth` — `Authorization: Bearer adt_…` only, rejects cookies.

`daemon_tokens(id, token_hash UNIQUE, workspace_id FK, daemon_id, expires_at, created_at, last_used_at, revoked_at)`. Verify with `crypto.timingSafeEqual`. Revocation = DELETE. Rate limit per-token (~1000/min). Issuance returns plaintext ONCE.

### Boot sequence

```
1.  db.migrate.latest()
... (unchanged 2-9)
9.  startGatewayEventRelay()
9a. runtimeBridge.reconcileFromInstances()    -- mirror running instances → hosted runtimes
9b. failInFlightHostedTasksOnBoot()           -- fail in-process hosted tasks post-restart
9c. taskQueueSweeper.start()                  -- 60s: stale dispatched >5m + orphan running
9d. hostedTaskWorker.start()                  -- 2s per hosted runtime
9e. runtimeRegistryOfflineSweeper.start()     -- 30s: daemon runtimes offline after 90s
10. onBeforeListen()
11. server.listen()
```

Daemon tasks **survive** server restart. Hosted tasks **don't** — 9b fails them fast.

### File layout

```
apps/server/src/
├── cli.ts                              (rewrite with commander)
├── cli/{server.ts, daemon.ts, help.ts}
├── daemon/                             (NEW: local daemon module)
├── agent-backends/                     (NEW: CLI executors, daemon-only)
├── routes/{daemon,issues,comments,agents,runtimes,tasks}.ts (NEW)
├── services/{runtime-registry,task-queue,task-messages,agent-store,issue-service,comment-service,daemon-tokens}.ts (NEW)
├── task-dispatch/{hosted-worker,runtime-bridge,sweepers}.ts (NEW)
├── middleware/daemon-auth.ts (NEW)
└── db/migrations/003_* through 007_* (NEW — sequential from 003)

apps/web/src/
├── pages/{issues,agents,runtimes,daemon-tokens}/ (NEW)
├── components/issues/{IssueCard,IssueStatusBadge,TaskMessageStream,ToolCallBubble}.tsx (NEW)
└── i18n/locales/{en,zh,fr,de,es,it}.json (extend all 6 — HARD CONSTRAINT)

apps/server/tests/unit/ (NEW — node --test carve-out)
```

**Lint requirement:** daemon/agent-backends code must NOT import from `db/`, `services/`, `middleware/`, `routes/`, `runtime/`. Use `services/agent-store.ts` not `services/agents.ts` to avoid collision with `agent-types/`.

### Shared types

`packages/shared/src/types.ts` — `Issue`, `IssueStatus`, `IssuePriority`, `Agent`, `AgentStatus`, `Runtime`, `RuntimeKind`, `AgentTask`, `TaskStatus`, `TaskMessage`, `TaskMessageType`, `Comment`, `TaskEventType`, `TaskMessagePayload`, `DaemonRegisterRequest/Response`, `ClaimedTask`.

`packages/shared/src/agent-stream.ts` — hand-written stream-json discriminated unions for claude-code and codex.

## Highest-Risk Pitfalls with Prevention (top 10, **H** = HARD CONSTRAINT)

1. **SQ1 — No `FOR UPDATE SKIP LOCKED` on SQLite** *(H, Schema + Task-service)* — `db.transaction(fn)` defaults to BEGIN IMMEDIATE. WAL + `busy_timeout=5000` mandatory. No in-process JS mutex.

2. **PG1 — Go goroutines → unbounded Node async leak** *(H, Daemon CLI)* — Bounded-concurrency helper (`const release = await sem.acquire(); try{…}finally{release();}`). Poll loop awaits next iteration.

3. **PG2 — Unhandled promise rejection kills the daemon** *(H, Daemon CLI)* — Every top-level async `.catch(logAndReport)`. `process.on('unhandledRejection'|'uncaughtException')` marks in-flight tasks failed.

4. **PM1 — SIGTERM→zombie on child processes** *(H, Agent-backend)* — Helper `killWithEscalation(child, { graceMs: 10_000 })`. Never `{ shell: true }`. Linux/macOS process group kill via `{ detached: true }` + `process.kill(-pid, sig)`. Windows: `taskkill /F /T /PID`.

5. **AUTH1 — Daemon-token privilege confusion** *(H, Daemon REST API)* — Two completely separate middleware, no shared code. `adt_` prefix checked before JWT parsing. Test matrix: every user endpoint with daemon token → 401/403; every daemon endpoint with cookie → 401.

6. **PG7/PG8 — Readline iteration + stdout backpressure** *(H, Agent-backend)* — `for await (const line of rl)`, not event handler. `crlfDelay: Infinity`. `child.stdout.setEncoding('utf8')`. Kill if no line in 60s.

7. **PG5 — AbortSignal ≠ Go context.WithCancel** *(H, Cross-cutting)* — Pass `{ signal }` to every async boundary. Central `createTaskContext(taskId)` helper threads signal through.

8. **ST1 — Instance status vs runtime status drift** *(H, Hosted driver)* — For `kind='hosted_instance'`, `runtime.status` is derived from `instance.status` via JOIN, not stored. `InstanceManager` remains only writer.

9. **UX1 — Kanban DnD + WebSocket reorder conflict** *(H, Issue-board UI)* — Optimistic local reorder → fractional server position. On WS reorder from others, apply if not dragging, else queue.

10. **CE1 — workspace_id enforcement** *(H, Schema + Task-service)* — Every query on workspace-scoped tables MUST filter by `workspace_id`, even in CE. Services read `req.workspaceId`, never hardcoded `'default'`.

**Non-HARD but expensive if missed:** PG3 (timer leaks — `PeriodicTask` helper), SQ4 (stale task reaper), ST2 (WS reconnect replay via `lastSeq`), ST3 (background-tab pile-up — `useTransition` + virtualize), UX6 (task-message XSS — never `dangerouslySetInnerHTML`; truncate 16 KB), PM5 (cancel-race — `completeTask` returns `{ discarded: true }` not 400), PM3 (PATH inheritance).

## Recommended Phase Decomposition (A–K, refined)

- **A — Schema + Shared Types** (no deps): 5 migrations, WAL PRAGMAs, shared types.
- **B — Runtime Registry + Runtime-Bridge** (A): InstanceManager event hooks.
- **C — Agent + Issue + Comment Services** (A, parallel with B): 6-status machine, auto-enqueue.
- **D — Task Queue + Reaper** (B, C): BEGIN IMMEDIATE claim, 500ms-batched ingest, stale-task reaper. **NEEDS RESEARCH**: knex+better-sqlite3 transaction pool semantics.
- **E — Daemon REST API + daemon-auth middleware** (D, parallel with F): 9 `/api/daemon/*` routes, per-token rate limiter. **LIGHT RESEARCH**: rate-limiter exemption.
- **F — Hosted-Instance Driver** (D, parallel with E): `hosted-worker.ts`, gateway→task_message translator. **NEEDS RESEARCH**: OpenClaw gateway WS v3 cancel frame.
- **G1 — Daemon CLI + claude-code happy path + unit harness** (E): commander, `daemon/` module, claude-code backend, `node --test` harness, concurrency primitives. **NEEDS RESEARCH**: Windows daemon strategy, Claude Code `control_request` protocol.
- **G2 — Remaining agent backends** (G1): codex / openclaw / opencode / hermes with full stream-json + error/cancel. **LIGHT RESEARCH**: per-CLI stream-json dialect.
- **H — Issue Board UI** (D): @dnd-kit kanban with fractional `position`, WS-reorder, virtualize >100. **LIGHT RESEARCH**: virtualized-dnd reference.
- **I — Issue Detail UI + Task Message Streaming** (D, H): WS `subscribe_issue`/`subscribe_task` with `lastSeq` replay.
- **J — Management UIs** (B, C, E): Agents / Runtimes (unified list) / Daemon Tokens. i18n 6 locales.
- **K — Integration, Boot, E2E, Release** (all): boot wiring, `failInFlightHostedTasksOnBoot`, Playwright E2E + one `@integration` daemon-spawn smoke, i18n CI check, docs, version bump.

### Phase graph

```
A ──┬──► B ──┐
    │        ├──► D ──┬──► E ──► G1 ──► G2
    └──► C ──┘        └──► F ────────────┐
                                          │
                      D ──► H ──► I       │
                      │         │         │
                      └─► J ◄───┘         │
                                          │
                    all ──► K ◄───────────┘
```

## Resolved Decisions (authoritative for downstream)

1. **Daemon token prefix `adt_`** — avoids multica `mdt_` collision; enables secret-scanner recognition. (*STACK over ARCHITECTURE.*)
2. **Runtime kinds `local_daemon | external_cloud_daemon | hosted_instance`** (snake_case).
3. **Issue statuses: 6 not 7** — drop `in_review`.
4. **Daemon↔server: HTTP long-poll, not WebSocket.**
5. **Two disjoint auth middleware** — no shared code.
6. **SQLite claim: BEGIN IMMEDIATE + NOT EXISTS + conditional UPDATE.** WAL + busy_timeout=5000 mandatory.
7. **`runtime.status` for `hosted_instance`: derived, not stored.**
8. **Skills: tables in v1.4, UI v1.5.**
9. **Session-resume: persist `session_id`/`work_dir` in v1.4; daemon `--resume` logic is v1.5.**
10. **`position FLOAT` ships in v1.4.**
11. **`custom_env` / `custom_args` ship in v1.4.**
12. **Agent archival ships in v1.4.**
13. **Migrations sequential from 003, all v1.4 in one PR.**
14. **Hand-write stream-json types in shared** — don't import SDKs.
15. **Unit-test carve-out at `apps/server/tests/unit/` (node --test)**.
16. **Daemon bundles in `@aquaclawai/aquarium`** — single npm package, subcommand router.
17. **`RuntimeDriver { dispatch, cancel, getStatus }` interface** with factory by `kind`.
18. **`custom_env` redacted at API boundary**; encryption-at-rest deferred to v1.5.

## Open Questions for Planning

**Phase A:** (1) Lowercase-UUID normalization helper; (2) knex SQLite DSL for partial unique index.

**Phase D:** (3) knex + better-sqlite3 transaction pool — does `db.transaction(async trx => …)` serialize through one connection? (4) Stale-task threshold tuning (5min dispatch / 2.5h running may kill long Codex sessions). (5) Enqueue→archive race for in-flight tasks.

**Phase E:** (6) `created_by_user_id` on daemon_tokens for audit. (7) Rate-limit bucket sizing (~1000/min/token).

**Phase F:** (8) **Does OpenClaw gateway WS protocol v3 have a cancel frame?** If no, cancel closes subscription and gateway runs silently. (9) Back-pressure semaphore on hosted dispatch. (10) Hosted-instance deletion mid-task — hook instance events.

**Phase G1/G2:** (11) Windows daemon background-process story — best-effort or foreground-only? (12) Claude Code `control_request` auto-approval posture. (13) PATH resolution for npm-shim CLIs.

**Phase H:** (14) Finalize z-index token values in `index.css` before components land.

**Phase I:** (15) `task_messages` GC cadence and retention window (default 30 days).

**Phase K:** (16) Daemon self-update deferred to v1.5. (17) Post-H bundle-size analysis to verify @dnd-kit ~18 KB after tree-shaking.

## Confidence

**Overall: HIGH.** Three MEDIUM areas (transport choice, SQLite QPS extrapolation, Windows daemon story) are bounded and tracked in Open Questions — all resolvable during their phases without structural redesign.
