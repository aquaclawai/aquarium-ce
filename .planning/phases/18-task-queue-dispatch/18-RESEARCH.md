# Phase 18: Task Queue & Dispatch — Research

**Researched:** 2026-04-16
**Domain:** SQLite task-queue design under knex+better-sqlite3 (single-writer), lifecycle state machine, reaper, streaming seq, cancellation propagation
**Confidence:** HIGH (codebase + PITFALLS.md audit + source-verified Knex/better-sqlite3 semantics)

## Summary

Phase 18 extends the Phase-17 `task-queue-store.ts` slice (enqueue + cancel) into the full task lifecycle — `claimTask`, `startTask`, `progressTask`, `completeTask`, `failTask`, `reapStaleTasks`, `cancelTask` — plus a streaming seq ingester and a periodic reaper. The core technical risk flagged by the roadmap ("confirm knex+better-sqlite3 transaction pool serializes through one writer") resolves decisively: **the CE Knex config uses `pool: { min: 1, max: 1 }` (`apps/server/src/db/knexfile.ts:15`)**, meaning every query in the process runs through a single shared better-sqlite3 connection. `db.transaction()` simply acquires that sole connection; there is no in-process race. The remaining serialisation gap is the **Knex default `BEGIN` (= DEFERRED)** — a deferred txn that upgrades read→write mid-transaction bypasses `busy_timeout` and throws `SQLITE_BUSY` immediately. Phase 18's claim path MUST wrap its work in an explicit `BEGIN IMMEDIATE`.

Phase 15's migration 007 already installed the partial-unique index `idx_one_pending_task_per_issue_agent` and the 6-state CHECK triggers — the schema backstop is in place. Phase 17 shipped `enqueueTaskForIssue` / `cancelPendingTasksForIssueAgent` / `cancelAllTasksForIssue` with a top-of-file JSDoc explicitly reserving the Phase-18 extension surface. Phase 16's `offline-sweeper.ts` is the exact template for the reaper (30 s tick, per-tick `.catch`, idempotent start/stop).

**Primary recommendation:** Build `claimTask` on `db.transaction(async trx => { await trx.raw('BEGIN IMMEDIATE'); ... })` OR — cleaner — use `knex.raw('BEGIN IMMEDIATE')` at the top of an explicit transaction block, with the whole claim being a single `UPDATE agent_task_queue SET status='dispatched' WHERE id = (SELECT id FROM agent_task_queue WHERE runtime_id=? AND status='queued' AND NOT EXISTS (... max_concurrent_tasks guard ...) ORDER BY priority DESC, created_at ASC LIMIT 1) RETURNING *`. The pool=1 constraint means no other Node code runs during that txn — correctness flows from serialisation, not from clever SQL.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for Phase 18. All decisions are Claude's discretion within the roadmap + requirements boundaries.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TASK-01 | Atomic claim via `BEGIN IMMEDIATE` + `NOT EXISTS` subquery for per-(agent, issue) coalescing | §Claim Query Design, §SQLite Concurrency Model |
| TASK-02 | Lifecycle `queued → dispatched → running → completed\|failed\|cancelled` with one transition per call | §Lifecycle State Machine |
| TASK-03 | `task_messages` appended in seq order (monotonic `seq` per task), batched at 500 ms | §Monotonic seq for task_messages |
| TASK-04 | Reaper fails `dispatched > 5 min` and `running > 2.5 h` (configurable) | §Reaper Design |
| TASK-05 | User cancel propagates to daemon (next poll) or hosted worker (AbortController) | §Cancellation Propagation |
| TASK-06 | complete/fail on already-cancelled task → `{ discarded: true }` (no error) | §Discarded Completion Semantics |

## Project Constraints (from CLAUDE.md)

- **ESM import rule (HARD):** all server `.ts → .ts` imports MUST use `.js` extension. Applies to every new file in this phase.
- **No `any`, no `@ts-ignore`, no `@ts-expect-error`** (HARD).
- **Routes are thin controllers** — `task-queue-store.ts` holds all business logic; routes/tasks.ts just parses HTTP and returns `ApiResponse<T>`.
- **Shared types in `packages/shared/src/v14-types.ts`** — `AgentTask`, `TaskStatus`, `TaskMessage`, `TaskMessageType`, `TaskEventType`, `TaskEventPayload` are ALREADY exported (verified against source). No new shared types needed; this phase consumes them.
- **DB column convention:** `snake_case` (never `snake_case` and `camelCase` mixed); column shape in `agent_task_queue` / `task_messages` is frozen at migration 007.
- **Single writer through InstanceManager** — not directly relevant here (tasks don't touch `instances.status`) but reinforces that runtime-status cascades flow ONLY through runtime-bridge and offline-sweeper.
- **Build shared first** before typecheck: `npm run build -w @aquarium/shared`.
- **Every bug fix gets a regression test** (user global rule).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `knex` | already-installed | Query builder + transaction API | Used across the entire CE codebase `[VERIFIED: apps/server/src/db/index.ts]` |
| `better-sqlite3` | already-installed | Synchronous SQLite driver | CE DB engine; synchronous = single-writer serialisation `[VERIFIED: knexfile.ts:11]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` — `randomUUID()` | native | Generate task IDs | Matches existing Phase-17 pattern in task-queue-store.ts `[VERIFIED]` |
| Existing `ws/index.ts` `broadcast(instanceId, msg)` | local | Send `task:*` events to UI | Phase-17 reserved the `task:*` WS namespace for this phase `[VERIFIED: 17-03-SUMMARY.md decision #4]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `knex.raw('BEGIN IMMEDIATE')` inside `db.transaction()` | Raw better-sqlite3 `db.transaction.immediate(fn)` | Raw API bypasses Knex's connection management + tx registration. Keeping Knex means tests + hooks stay consistent. |
| setInterval for batch flush | async queue + `Promise.race(timer, close)` | setInterval is boring and already the proven pattern in offline-sweeper. Don't reinvent. |
| Per-task in-memory buffer | Direct per-insert writes | Roadmap says "batched ingest at 500 ms" — SC-3 is the hard spec. One buffer per task eliminates cross-task interference. |
| AbortController for hosted cancel | Close the gateway WS | `[ASSUMED]` — OpenClaw gateway protocol v3 cancel frame availability is Phase 20's research gate, not 18's. Phase 18 ships the DB-state-flip; runtime-side propagation is in 19/20. |

**No new packages to install** — this phase is pure logic on top of the existing stack.

**Version verification:** N/A — no new dependencies.

## Architecture Patterns

### Recommended File Structure
```
apps/server/src/
├── services/
│   └── task-queue-store.ts          # EXTEND — add claim/start/progress/complete/fail/cancel/reap
├── task-dispatch/
│   ├── offline-sweeper.ts           # UNCHANGED — template for the reaper
│   ├── runtime-bridge.ts            # UNCHANGED — ownership reference for hook pattern
│   ├── task-reaper.ts               # NEW — periodic stale-task reaper (30 s tick, 5 min / 2.5 h thresholds)
│   └── task-message-batcher.ts      # NEW — in-memory buffer per task, 500 ms flush
├── routes/
│   └── tasks.ts                     # NEW — thin HTTP surface for admin / cancel / inspection
├── server-core.ts                   # MODIFY — add Step 9c: startTaskReaper() between 9a (runtime-bridge) and 9e (offline-sweeper)
└── ws/index.ts                      # UNCHANGED — reuses broadcast() for task:* events
```

### Pattern 1: BEGIN IMMEDIATE inside db.transaction
**What:** Explicitly open a write-lock immediately, not on first write (which deadlocks under contention).
**When to use:** Any Knex transaction whose FIRST statement might be a read (SELECT) but which WILL later issue a write. The claim query is the canonical example: `SELECT candidate → UPDATE dispatched`.
**Example:**
```typescript
// Source: SQLite docs + PITFALLS.md §SQ1 + https://sqlite.org/lang_transaction.html
await db.transaction(async (trx) => {
  await trx.raw('BEGIN IMMEDIATE');          // [CITED: sqlite.org/lang_transaction.html]
  // ... reads + writes now run under the exclusive write lock;
  // busy_timeout=5000 auto-retries SQLITE_BUSY on acquire, not mid-txn.
});
```
Note: under `pool: {min:1, max:1}` the `BEGIN IMMEDIATE` is technically redundant for intra-process serialisation (the sole connection is already serialised by Knex's pool queue), but it is MANDATORY to avoid the deferred-upgrade trap the moment a second connection is ever introduced (a future EE worker, or a `better-sqlite3` reader in a Worker thread — see PITFALLS §SQ2). Ship it now as a safety belt.

### Pattern 2: Single UPDATE-from-subquery for atomic claim
**What:** The entire claim is one SQL statement executed under BEGIN IMMEDIATE.
**Example:**
```sql
-- Source: PITFALLS §SQ1 "UPDATE ... RETURNING pattern" + multica's ClaimAgentTask port
UPDATE agent_task_queue
   SET status        = 'dispatched',
       dispatched_at = CURRENT_TIMESTAMP,
       updated_at    = CURRENT_TIMESTAMP
 WHERE id = (
   SELECT q.id FROM agent_task_queue AS q
     JOIN agents AS a ON a.id = q.agent_id
    WHERE q.runtime_id = ?
      AND q.status     = 'queued'
      AND a.archived_at IS NULL
      AND (
        SELECT COUNT(*) FROM agent_task_queue AS c
         WHERE c.agent_id = q.agent_id
           AND c.status IN ('dispatched','running')
      ) < a.max_concurrent_tasks
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT 1
 )
RETURNING *;
```
The `NOT EXISTS` semantic required by TASK-01 is expressed here as a `COUNT(*) < max_concurrent_tasks` — conceptually "no dispatch beyond the cap". The **per-(issue, agent) coalescing** property (SC-2) is ALREADY enforced at schema level by `idx_one_pending_task_per_issue_agent` (partial UNIQUE): the queue can never HOLD two pending rows for the same pair, so the claim can never return two either.

### Pattern 3: Reaper as standalone module matching offline-sweeper
**What:** `task-reaper.ts` exports `startTaskReaper()` / `stopTaskReaper()`, runs `sweepOnce()` every 30 s, initial sweep on boot, per-tick `.catch`.
**When to use:** This is the proven Phase-16 pattern — clone it for consistency. Use the exact same file header comments, start/stop idempotency, and initial-sweep-on-start logic.
**Example:**
```typescript
// Source: apps/server/src/task-dispatch/offline-sweeper.ts (exact template)
const SWEEP_INTERVAL_MS = 30_000;
const DISPATCH_STALE_MS = 5 * 60_000;      // TASK-04 default
const RUNNING_STALE_MS  = 2.5 * 60 * 60_000;

async function reapOnce(): Promise<{ dispatched: number; running: number }> {
  const dispatchCut = new Date(Date.now() - DISPATCH_STALE_MS).toISOString();
  const runningCut  = new Date(Date.now() - RUNNING_STALE_MS).toISOString();
  // Two batched UPDATEs — status='failed', error='stale-reaper'.
}
```

### Pattern 4: Per-task in-memory buffer + 500 ms flush timer
**What:** One `Map<taskId, PendingMessage[]>` plus a single `setInterval(flushAll, 500)`. On flush, acquire next seq per task via `SELECT COALESCE(MAX(seq),0)+1 FROM task_messages WHERE task_id=?` inside the same BEGIN IMMEDIATE txn, then bulk-insert.
**When to use:** When daemon or hosted worker posts messages via `POST /api/tasks/:id/messages` (Phase 19 / 20). The batcher lives on the SERVER side, not daemon side — daemon can also batch locally, but server-side batching is required by SC-3 regardless of client behaviour.

### Anti-Patterns to Avoid
- **Don't generate `seq` in memory outside the txn.** Two concurrent flushes for the same task would read the same MAX → compute the same next-seq → insert duplicates. The `(task_id, seq)` UNIQUE index from migration 007 catches it, but throws SQLITE_CONSTRAINT rather than producing a clean ordering.
- **Don't lean on Knex's default `BEGIN`.** Plain `db.transaction()` issues `BEGIN;` which maps to DEFERRED — a read-then-write txn inside it will throw SQLITE_BUSY if any other write is pending, ignoring busy_timeout. PITFALLS §SQ1 is explicit.
- **Don't do network I/O inside `db.transaction()`.** PITFALLS §SQ5: transactions must be < 10 ms. The batcher's DB flush is fine; any WS broadcast or RPC call goes AFTER commit.
- **Don't write runtime-side cancel here.** Phase 18 ships the DB-state-flip and the `isCancelled(taskId)` read side of the contract. Actual SIGTERM / AbortController / gateway-RPC-abort lives in Phase 19 / Phase 20.
- **Don't expose `task:*` WS events for half-baked states.** Only emit `task:dispatch`, `task:progress`, `task:message`, `task:completed`, `task:failed`, `task:cancelled` — the union in v14-types.ts is already frozen.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-(issue, agent) coalescing | Application-level lock / mutex / queue | Migration 007's `idx_one_pending_task_per_issue_agent` (already shipped) | DB partial-UNIQUE is race-free, schema-enforced, survives restarts |
| Monotonic seq per task | Counter in Redis / in-memory / app-level atomic int | `SELECT COALESCE(MAX(seq),0)+1` inside BEGIN IMMEDIATE + `(task_id, seq) UNIQUE` | Index is the backstop; Redis adds a whole new failure mode |
| Stale-task detection | Bespoke scheduler / cron library / worker | setInterval + batched UPDATE (offline-sweeper template) | Phase-16 proven; zero dependencies; already understood by the team |
| Task lifecycle enum validation | Service-layer if/else ladder | Migration 007's `trg_atq_status_check` + 6-state CHECK trigger | DB rejects typos; SQ3 pitfall already mitigated at schema level |
| WS fan-out to subscribers | Custom subscription manager | Existing `broadcast(instanceId, msg)` in `ws/index.ts` | Phase-17 already uses it for `issue:*`; `task:*` namespace reserved |
| AbortController propagation to Docker | Keep per-task AbortController map | `[DEFERRED to Phase 20]` — Phase 18 just flips DB state; Phase 20 owns hosted cancel | Explicit roadmap split: "Phase 18 ships the abstraction; Phase 19 and 20 consume" |

**Key insight:** Phase 18's value is in the **contract** — state machine, seq monotonicity, reaper, cancel-detection API — not in novel infrastructure. Every piece of infra it needs already exists. Execute by extending `task-queue-store.ts` and cloning `offline-sweeper.ts`.

## Runtime State Inventory

> Not a rename/refactor phase — section omitted per template rules.

## SQLite Concurrency Model

### What knex+better-sqlite3 actually does (verified)

| Layer | Behaviour | Evidence |
|-------|-----------|----------|
| Knex pool | `pool: { min: 1, max: 1 }` — all queries share ONE better-sqlite3 connection | `apps/server/src/db/knexfile.ts:15` `[VERIFIED]` |
| better-sqlite3 driver | Synchronous C binding; every `stmt.run()` blocks the event loop until SQLite returns | `[VERIFIED: npmjs.com/better-sqlite3 + PITFALLS §SQ2]` |
| Knex transaction | `db.transaction(fn)` emits `BEGIN;` — which SQLite interprets as DEFERRED | `[CITED: knex/knex issue 5097 + sqlite.org/lang_transaction]` |
| SQLite journal | WAL mode (boot PRAGMA, verified at startup by `applyBootPragmas`) | `apps/server/src/db/sqlite-adapter.ts:57-98` `[VERIFIED]` |
| SQLite busy timeout | 5000 ms (boot PRAGMA, verified) | same `[VERIFIED]` |
| SQLite foreign keys | ON (boot PRAGMA, verified) | same `[VERIFIED]` |

### Implications for Phase 18

1. **Intra-process serialisation is already free.** With `pool: 1`, two simultaneous HTTP requests hitting `claimTask` will queue through Knex's pool — one acquires the lone connection, runs to completion, releases, the other acquires. There is NO way for two Node async tasks to interleave DB statements on the same table. The 20-simulated-daemons success criterion (SC-1) is trivially satisfied by pool geometry alone.

2. **BEGIN IMMEDIATE is still mandatory.** Three reasons:
   - **Future-proofing:** any future read-worker (Worker thread with a second better-sqlite3 connection, or a separate reader pool) would break the pool=1 invariant. The explicit IMMEDIATE survives that change.
   - **SQLITE_BUSY handling:** if the Node process is ever competing with an external reader (e.g., a debug `sqlite3 ~/.aquarium/aquarium.db` shell), deferred-then-upgrade skips `busy_timeout` and throws. IMMEDIATE respects busy_timeout.
   - **Documentation:** the code reads as intentional serialisation; "just works because pool=1" is hostile to reviewers and future maintainers.

3. **Transactions must be fast (< 10 ms target, PITFALLS §SQ5).** Every millisecond inside a transaction blocks every other query in the process. The claim query and batch flush MUST stay DB-only. WS broadcast, HTTP response formatting, logging — all happen AFTER commit.

4. **Readers are cheap in WAL.** `SELECT` from outside a write txn does not block and is not blocked by the writer (`[CITED: sqlite.org/wal.html]`). List endpoints for the UI can run freely.

### The two writer-upgrade scenarios

| Scenario | Default `BEGIN;` behaviour | With `BEGIN IMMEDIATE` |
|----------|---------------------------|------------------------|
| Txn A starts read, then writes; Txn B is also writing | A hits SQLITE_BUSY on upgrade — busy_timeout IGNORED (docs call this out explicitly) | A waits up to 5000 ms for B to release, then acquires |
| Txn A starts read-only; Txn B writes | A never upgrades; both succeed under WAL | Same — IMMEDIATE only affects write-intent txns |
| Single connection (pool=1) | No other writer possible in-process | No-op improvement in-process; safety belt for future |

**Reference (`[CITED: sqlite.org/lang_transaction.html §Deferred, Immediate, Exclusive Transactions]`):** *"After a BEGIN IMMEDIATE, no other database connection will be able to write to the database or do a BEGIN IMMEDIATE or BEGIN EXCLUSIVE. Other processes can continue to read from the database, however."*

## Claim Query Design

### Exact SQL (SQLite dialect, Knex-raw friendly)

```sql
UPDATE agent_task_queue
   SET status        = 'dispatched',
       dispatched_at = CURRENT_TIMESTAMP,
       updated_at    = CURRENT_TIMESTAMP
 WHERE id = (
   SELECT q.id
     FROM agent_task_queue AS q
     JOIN agents           AS a ON a.id = q.agent_id
    WHERE q.runtime_id   = ?
      AND q.status       = 'queued'
      AND a.archived_at IS NULL
      AND (
        SELECT COUNT(*)
          FROM agent_task_queue AS c
         WHERE c.agent_id = q.agent_id
           AND c.status IN ('dispatched','running')
      ) < a.max_concurrent_tasks
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT 1
 )
RETURNING *;
```

### Indexes used

| Index | Defined in | Rows filtered |
|-------|-----------|---------------|
| `idx_atq_claim` on `(runtime_id, status, priority, created_at)` | migration 007 | inner SELECT — perfect match for `WHERE runtime_id=? AND status='queued' ORDER BY priority DESC, created_at ASC` |
| `idx_atq_agent_status` on `(agent_id, status)` | migration 007 | the `COUNT(*) ... c.agent_id=?` concurrency subquery |
| `idx_one_pending_task_per_issue_agent` (partial UNIQUE) on `(issue_id, agent_id) WHERE status IN ('queued','dispatched')` | migration 007 | **schema-level coalescing guarantee** — cannot HOLD two pending rows per pair |
| Primary key on `id` | migration 007 | outer UPDATE `WHERE id = (...)` |

### Coalescing guarantee (SC-2)

The roadmap's SC-2 says "per-(issue_id, agent_id) coalescing prevents duplicate dispatch even if enqueued twice". Two layers enforce this:

1. **Enqueue layer (Phase 17, shipped):** `enqueueTaskForIssue` runs `getPendingTaskForIssueAgent` first inside its txn; if a pending row exists for that pair, returns the existing row without inserting.
2. **Schema layer (migration 007):** `idx_one_pending_task_per_issue_agent` is a partial UNIQUE. Any attempt to insert a second `(issue_id, agent_id)` pair while the first is still queued/dispatched throws `SQLITE_CONSTRAINT: UNIQUE constraint failed`.

Claim therefore cannot return two pending rows for the same (issue, agent) pair because only one can exist in the DB at any instant.

### Concurrency property under pool=1 (SC-1 proof)

With 20 Promise.all callers all hitting `claimTask(runtimeId)` simultaneously:

```
t=0   Callers 1..20 all call claimTask(); Knex pool has 1 connection.
t=0+  Caller 1 acquires connection; BEGIN IMMEDIATE; SELECT candidate; UPDATE dispatched;
      RETURNING row_A; COMMIT; releases connection.
t=1+  Caller 2 acquires connection; BEGIN IMMEDIATE; candidate query finds row_B (row_A is now dispatched); UPDATE; ...
...
```

At no point can caller 1 and caller 2 both see row_A as `queued`. The invariant "at most one UPDATE … status='dispatched' per row" flows from the single shared connection plus the UPDATE's atomicity. The test to prove this: run `claimTask` in `Promise.all` from 20 pollers and assert row count with `status='dispatched'` equals `min(20, number_of_queued_rows)`.

### Max-concurrent-tasks enforcement (AGENT-02)

The `COUNT(*) ... < a.max_concurrent_tasks` subquery enforces AGENT-02 at claim time. If an agent with `max_concurrent_tasks=6` already has 6 tasks in `('dispatched','running')`, the inner SELECT returns no rows → outer UPDATE matches zero rows → `claimTask` returns null. The next claim attempt re-evaluates after a running task completes or fails.

## Lifecycle State Machine

### Allowed transitions

```
           claimTask          startTask            completeTask
   queued ────────────▶ dispatched ────────────▶ running ────────────▶ completed
     │                     │                        │                 (terminal)
     │                     │                        │ failTask
     │                     │                        └──────────────▶ failed
     │                     │                                         (terminal)
     │   cancelTask /      │ cancelTask /          │ cancelTask /
     │   cancelPending…/   │ cancelPending…/       │ cancelAll…
     │   cancelAll…        │ cancelAll…            │
     ▼                     ▼                        ▼
  cancelled             cancelled                cancelled
  (terminal)            (terminal)               (terminal)
```

Terminal states: `completed | failed | cancelled`. No state transitions OUT of terminal.

### Validation layer

**Service layer (where transitions happen):** Every transition function (`claimTask`, `startTask`, `completeTask`, `failTask`, `cancelTask`) wraps its UPDATE in a guard predicate:

```typescript
// startTask example
const affected = await trx('agent_task_queue')
  .where({ id: taskId })
  .andWhere('status', 'dispatched')      // guard: only from dispatched
  .update({ status: 'running', started_at: db.fn.now(), updated_at: db.fn.now() });
// affected=0 means the task was NOT in the expected state
```

**Why service-layer and not DB trigger:**
- Triggers can validate enum membership (migration 007 already does this via `trg_atq_status_check`) but cannot express transition rules like "dispatched → running is legal; running → dispatched is not" without knowing the prior state. SQLite triggers see NEW.status but not OLD.status in a natural way for BEFORE UPDATE OF status.
- Service-layer guards collapse into the same SQL (`WHERE status=<expected>`) and produce a clean `affected=0` signal that callers inspect.
- The existing Phase-17 `cancelPendingTasksForIssueAgent` already uses this pattern (`whereIn('status', ['queued','dispatched']).update({ status: 'cancelled' })`) — we follow suit.

### "One explicit state transition per call" (TASK-02)

This means: every service function causes AT MOST one status transition. `claimTask` does `queued→dispatched` and nothing else. `startTask` does `dispatched→running`. No function is allowed to chain (e.g., "claim and immediately mark running" in one HTTP handler). The reason: auditability — each transition corresponds to a real-world event (claimed by worker, started, completed) — and WS clients receiving one event per transition keeps `task:*` events sequenced cleanly.

### Integration with Phase-17's cancel paths

Phase 17 shipped `cancelPendingTasksForIssueAgent` (queued/dispatched → cancelled) and `cancelAllTasksForIssue` (queued/dispatched/running → cancelled). Both work cleanly under the new state machine:
- No `cancelling` intermediate state. PITFALLS §PM5's analysis of the cancel race holds: the DB flip to `cancelled` is the single source of truth; runtime-side propagation is best-effort.
- Phase 18 ADDS a top-level `cancelTask(taskId)` for single-task cancellation (user hits "Cancel" on an issue's active task). Semantically identical to the existing `cancelPendingTasksForIssueAgent` but scoped to one task id.

### Column-write contract per transition

| Transition | Columns written |
|------------|----------------|
| `queued → dispatched` (claim) | `status`, `dispatched_at`, `updated_at` |
| `dispatched → running` (start) | `status`, `started_at`, `updated_at` |
| `running → completed` (complete) | `status`, `completed_at`, `result`, `updated_at` |
| `running → failed` (fail) | `status`, `completed_at`, `error`, `updated_at` |
| `any → cancelled` (cancel) | `status`, `cancelled_at`, `updated_at` |

## Monotonic seq for task_messages

### How the DB enforces ordering

Migration 007 declares:
```typescript
t.unique(['task_id', 'seq'], { indexName: 'uq_task_messages_task_seq' });
```

This is the final backstop: any two concurrent inserts that somehow produced the same `(task_id, seq)` would throw `SQLITE_CONSTRAINT`. But UNIQUE does NOT compute the next seq — the application must.

### Server-side batcher design

```typescript
// apps/server/src/task-dispatch/task-message-batcher.ts
const BATCH_INTERVAL_MS = 500;                            // TASK-03 spec
type Pending = { type: TaskMessageType; tool: string|null; content: string|null; input: unknown; output: unknown; metadata: Record<string,unknown> };
const buffer = new Map<string /*taskId*/, Pending[]>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function appendTaskMessage(taskId: string, msg: Pending): void {
  const list = buffer.get(taskId) ?? [];
  list.push(msg);
  buffer.set(taskId, list);
}

async function flushOne(taskId: string, messages: Pending[]): Promise<void> {
  if (messages.length === 0) return;
  await db.transaction(async (trx) => {
    await trx.raw('BEGIN IMMEDIATE');
    const row = await trx('task_messages').where({ task_id: taskId }).max({ m: 'seq' }).first();
    let next = Number(row?.m ?? 0);
    const inserts = messages.map((m) => ({
      id: randomUUID(), task_id: taskId, seq: ++next,
      type: m.type, tool: m.tool, content: m.content,
      input: m.input === undefined ? null : adapter.jsonValue(m.input),
      output: m.output === undefined ? null : adapter.jsonValue(m.output),
      metadata: adapter.jsonValue(m.metadata ?? {}),
      created_at: db.fn.now(),
    }));
    await trx('task_messages').insert(inserts);
  });
  // Broadcast AFTER commit — one WS event per inserted message.
  // PITFALLS §SQ5: never do I/O inside db.transaction().
}

export function startTaskMessageBatcher(): void { /* setInterval … flushAll … */ }
export function stopTaskMessageBatcher(): void { /* clearInterval + final flush */ }
```

### Why MAX(seq) under BEGIN IMMEDIATE is safe

Under pool=1, only ONE flush runs at a time. `BEGIN IMMEDIATE` acquires the write lock; the MAX(seq) read sees the latest committed value; the batch of inserts is atomic; COMMIT releases the lock. Interleaving is impossible within the process.

**Failure mode if the MAX-reread were outside the transaction:** flush A reads MAX=10, flush B reads MAX=10 before A commits, both try to insert seq=11 → one wins, the other fails with UNIQUE violation. The fix is to put MAX + INSERT in the SAME BEGIN IMMEDIATE.

### Per-task independence

The buffer is keyed by `task_id`, so flushes for task A and task B are independent serial txns. Ordering within a task is strictly monotonic (by construction); ordering ACROSS tasks is not guaranteed and is not required.

### Where messages come from

| Source | Wrote by | Phase |
|--------|----------|-------|
| Daemon `POST /api/daemon/tasks/:id/messages` | Phase 19 route handler | Phase 19 calls `appendTaskMessage()` per message |
| Hosted worker gateway events | Phase 20 `HostedTaskWorker` | Phase 20 calls `appendTaskMessage()` per translated event |

Phase 18 SHIPS `appendTaskMessage` + the batcher. Phase 19 and 20 CALL it. That's the contract.

### Pruning (out of scope for 18)

PITFALLS §ST2 mentions "prune task_messages > 30 days old via a GC loop." This is out of scope for Phase 18 per roadmap; add to Phase 26 / v1.5 backlog.

## Reaper Design

### setInterval tick rate

**Recommended: 30 s.** Matches offline-sweeper exactly. Trade-off analysis:
- `DISPATCH_STALE_MS = 5 * 60_000` — a 30 s tick means worst-case detection latency is 5 min 30 s. Acceptable.
- `RUNNING_STALE_MS = 2.5 * 60 * 60_000` — 30 s vs 2.5 h is noise.
- Going faster (10 s) doubles DB work for zero user-visible benefit.

### Thresholds

| Threshold | Default | Configurability |
|-----------|---------|-----------------|
| `DISPATCH_STALE_MS` | 5 min | `[OPEN QUESTION]` — hardcode initially (matches offline-sweeper's `HEARTBEAT_WINDOW_MS`); revisit only if a real user has a 6-min legitimate dispatch |
| `RUNNING_STALE_MS` | 2.5 h | `[ASSUMED]` — TASK-04 says "configurable", implying env-var or `.planning/config.json`. **Recommendation:** add `config.task.runningStaleMs` to `apps/server/src/config.ts` with default `2.5 * 60 * 60_000`, reading from `AQUARIUM_RUNNING_STALE_MS` env var. Rationale: long-running Claude tasks can exceed 2h for complex codebases; ops needs an override. |
| `SWEEP_INTERVAL_MS` | 30 s | Hardcoded — matches offline-sweeper |

### Exact reaper query (two batched UPDATEs)

```typescript
async function reapOnce(): Promise<{ dispatchedFailed: number; runningFailed: number }> {
  const dispatchCut = new Date(Date.now() - DISPATCH_STALE_MS).toISOString();
  const runningCut  = new Date(Date.now() - RUNNING_STALE_MS).toISOString();

  const dispatchedFailed = await db('agent_task_queue')
    .where('status', 'dispatched')
    .where('dispatched_at', '<', dispatchCut)
    .update({
      status: 'failed',
      error: 'Reaper: dispatched > 5 min without start',
      completed_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

  const runningFailed = await db('agent_task_queue')
    .where('status', 'running')
    .where('started_at', '<', runningCut)
    .update({
      status: 'failed',
      error: 'Reaper: running beyond configured timeout',
      completed_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

  // Broadcast task:failed for each reaped row — identify via a SELECT ... for UI updates.
  return { dispatchedFailed, runningFailed };
}
```

Neither UPDATE needs BEGIN IMMEDIATE explicitly — they are single-statement writes, and Knex's autocommit + pool=1 serialises them naturally against the claim path. The reaper's transition is always `dispatched→failed` or `running→failed`, both allowed by the state machine.

### Race avoidance: reaper vs legitimate transition

**Scenario:** at t=4:59 daemon posts `/tasks/:id/start` (dispatched→running, updates `started_at`). At t=5:00 reaper ticks and sees `dispatched_at < 5-min-cut`. The two UPDATEs race.

**Resolution under pool=1:** the two UPDATEs serialise. Whichever acquires the connection first wins:
- If daemon wins: `status` goes to `running`, `started_at` is set. Reaper's subsequent UPDATE has `WHERE status='dispatched'` which no longer matches — zero rows affected. Correct.
- If reaper wins: `status` goes to `failed`, `error` is set. Daemon's UPDATE has `WHERE id=? AND status='dispatched'` — zero rows affected. Daemon sees `affected=0` and treats the task as "already terminal", which matches TASK-06 semantics (discard).

Both orderings produce a consistent, terminal end state. No lost work, no duplicate work.

### WS broadcasts from the reaper

The reaper emits `task:failed` per reaped row. To get the IDs, do a `SELECT id, issue_id, agent_id FROM ... WHERE match-predicate` BEFORE the UPDATE (same txn or just before autocommit UPDATE), collect IDs, UPDATE, then broadcast for each.

## Cancellation Propagation

### The contract surface this phase ships

Phase 18 exposes exactly three surfaces to downstream phases:

1. **`cancelTask(taskId)` service function.** Atomically transitions queued|dispatched|running → cancelled. Emits `task:cancelled` broadcast. Returns `{ cancelled: boolean, previousStatus: TaskStatus }`.

2. **`isTaskCancelled(taskId): Promise<boolean>` service function.** Cheap indexed read. Used by daemon workers to poll (Phase 19 CLI-06 specifies 5 s cancel-detection SLA) and by hosted workers to check before `chat.send` fires (Phase 20).

3. **`GET /api/daemon/tasks/:id/status` route** — returns current status. DAEMON-06 spec. Phase 18 ships the service function; Phase 19 adds the route.

### Daemon polling model (Phase 19)

Daemon already heartbeats periodically. Roadmap / PITFALLS give two cadences:
- **Heartbeat:** 15 s (AUTH4 reference; exact spec owned by Phase 19)
- **Claim poll:** 2-5 s when capacity available (CLI-06 says "Server-side task cancellation is detected within 5 s via a polling cancel loop")

Cancel-detection pattern in the daemon (Phase 19 will implement):
```
every N seconds while task running:
  status = GET /api/daemon/tasks/:id/status
  if status == 'cancelled':
    AbortSignal.dispatch()   // to child process, SIGTERM escalation
    stop reporting messages
```

Phase 18's responsibility ends at "the DB flip to cancelled is atomic and the status endpoint returns the truth."

### Hosted worker cancel model (Phase 20)

Per PITFALLS §PM6 and roadmap: OpenClaw gateway protocol v3 may or may not have a cancel frame. Phase 20 RESEARCH GATE is "audit OpenClaw gateway WS protocol v3 for existing cancel/abort frame; document hosted-cancel semantics if absent." Until then:
- Phase 18 emits `task:cancelled` WS event + flips DB.
- Phase 20 reads the DB flip (via `isTaskCancelled` at every gateway-event receipt) and decides whether to close the gateway-RPC listener. Best-effort cancel; gateway work continues to completion and is discarded.

### AbortController disambiguation

The requirement text says "hosted worker (AbortController)". AbortController is a standard Web Platform API (`globalThis.AbortController`). For hosted workers, the daemon-style cancel flow doesn't apply — there's no child process. The AbortController is attached to the gateway RPC fetch/WS wait and triggers local cleanup. Phase 20 wires this; Phase 18 just exposes the signal (`isTaskCancelled`) that Phase 20 subscribes to.

### WS event for client UI

`task:cancelled` broadcasts to the workspace channel (same convention as Phase 17's `issue:*`). Payload shape per v14-types.ts `TaskEventPayload`: `{ taskId, issueId }`. UI updates the kanban card instantly.

## Discarded Completion Semantics

### Requirement (TASK-06)

> Completing or failing an already-cancelled task is handled as `{ discarded: true }` (no error).

### Recommended implementation (service layer)

```typescript
export interface CompleteResult {
  discarded: boolean;
  status: TaskStatus;
}

export async function completeTask(taskId: string, result: unknown): Promise<CompleteResult> {
  return db.transaction(async (trx) => {
    await trx.raw('BEGIN IMMEDIATE');
    const current = await trx('agent_task_queue').where({ id: taskId }).first('status');
    if (!current) throw new Error(`task ${taskId} not found`);
    if (current.status === 'cancelled') {
      return { discarded: true, status: 'cancelled' };
    }
    const affected = await trx('agent_task_queue')
      .where({ id: taskId })
      .andWhere('status', 'running')
      .update({
        status: 'completed',
        completed_at: db.fn.now(),
        result: getAdapter().jsonValue(result),
        updated_at: db.fn.now(),
      });
    if (affected === 0) {
      // Race: status changed between read and update (e.g., reaper just failed it).
      // Safe fallback — treat as discarded, not an error.
      return { discarded: true, status: (await trx('agent_task_queue').where({id: taskId}).first('status'))!.status as TaskStatus };
    }
    return { discarded: false, status: 'completed' };
  });
}
```

### HTTP surface

`POST /api/daemon/tasks/:id/complete` (Phase 19 adds this route; Phase 18 ships the service function). Response:
- Success path: `200 OK { ok: true, data: { discarded: false, status: 'completed' } }`
- Discarded path: `200 OK { ok: true, data: { discarded: true, status: 'cancelled' } }`
- **Never 400** on already-cancelled — that would force the daemon to add error-handling for a non-error path (PITFALLS §PM5).

### `cancelled` remains terminal

The state machine does NOT gain a `cancelled→completed` transition. The `cancelled` row stays with `status='cancelled'`, `cancelled_at` set, `completed_at` NULL, `result` NULL. If downstream analytics needs to know "the worker finished N seconds after we cancelled", that's a separate event log (Phase 24 / v1.5), not a state overwrite.

### Prevention of daemon overwriting cancelled

The `.andWhere('status', 'running')` in the UPDATE is the schema-level guard. The explicit `if (current.status === 'cancelled') return { discarded: true }` is the service-level guard that produces the nice shape. Both are required: the .andWhere prevents accidental overwrite; the read-first-branch avoids a blind UPDATE when we already know the answer (one query saved).

### `failTask` parallel

Same shape as `completeTask`:
```typescript
export async function failTask(taskId: string, error: string): Promise<{ discarded: boolean; status: TaskStatus }>;
```
- Pre-read status; if cancelled → return discarded.
- Otherwise UPDATE from dispatched|running → failed.
- Same 200-always semantics.

## Pitfalls and Mitigations

### SQ1 — No FOR UPDATE SKIP LOCKED

**Already covered above.** Mitigation: WAL + busy_timeout=5000 + BEGIN IMMEDIATE + single `UPDATE … RETURNING … WHERE id = (SELECT … LIMIT 1)`. The "skip locked" semantic is inapplicable under pool=1; the real-world ceiling (hundreds of claims/sec) is well above CE's expected load.

### SQ2 — better-sqlite3 is synchronous

**Mitigation:**
- Every multi-row insert in Phase 18 MUST be inside `db.transaction()` (autocommit per-row is 50× slower).
- Transactions MUST stay < 10 ms. The batcher flush reads MAX + inserts N messages — at N=100 that's still well under 5 ms on SSD.
- NO `SELECT *` on task_messages without LIMIT. The WS replay endpoint (Phase 24) SELECTs `WHERE task_id=? AND seq>?` which is indexed by `uq_task_messages_task_seq`.
- Consider Worker-thread reader for message replay in Phase 24 if profiling shows the blocking cost matters. Not a Phase 18 concern.

### SQ4 — Stale task reaper must run somewhere

**Mitigation:** `task-reaper.ts` is THAT somewhere. Wired into `server-core.ts` between offline-sweeper (Step 9e) and HTTP listen. The start order is:

```
9a. runtime-bridge reconcile (awaited) + 10s loop
9b. (Phase 20) in-flight hosted-task fail-on-boot
9c. task-reaper.ts (NEW in Phase 18)           ← 30s tick
9d. (Phase 20) hosted worker
9e. offline-sweeper (30s tick)
  → server.listen
```

Phase 18 owns 9c. The reaper start sits here in the order because it depends on migrations (done in step pre-9) and PRAGMAs (done in step pre-9), and should be running BEFORE the HTTP listener accepts requests (so a stale task from a previous crash is already being reaped when the first daemon registers).

### SQ5 — Write-lock starvation under long transactions

**Mitigation:**
- All Phase 18 txns are DB-only. No `fetch()`, no WS broadcast, no filesystem, no `console.log` with expensive stringification inside txn.
- Add a runtime-assertion helper in dev mode (optional): wrap `db.transaction` to `console.warn` if elapsed > 50 ms. Out of scope for MVP but nice-to-have.
- Batch size cap: the 500 ms flush window CAPS how many messages accumulate per task. If a misbehaving worker posts 10 000 messages in 500 ms, the flush inserts 10 000 rows in one transaction; this could blow the < 10 ms budget. Mitigation: cap buffer size per task at, say, 500 messages; on overflow, flush early.

### ST6 — Event ordering between daemon-direct and WS-broadcast paths

**Mitigation:**
- Single `broadcast(instanceId, event)` function owns all WS fan-out (already the case — `apps/server/src/ws/index.ts`).
- Every `task:*` broadcast happens AFTER the DB commit that caused it, in the same call stack. Reaper broadcasts `task:failed` after its UPDATE commits. `claimTask` broadcasts `task:dispatch` after its commit. Batcher broadcasts `task:message` events after its batch commits.
- `task_messages.seq` is the authoritative ordering within a task. Clients use seq for ordering; `createdAt` is informational.
- Consider a `task:event_seq` per task (separate from message seq) that covers ALL task:* events including dispatch/start/complete/cancel. Useful for ST2 replay but arguably over-engineering for v1.4. **Open question for planner: ship `task:event_seq` now or defer to Phase 24?**

### PM5 — Cancellation race (task completes just before cancel)

**Mitigation:** Covered by the `completeTask` / `failTask` discarded-path implementation above. The daemon hitting `POST /api/daemon/tasks/:id/complete` after user cancel receives `200 { discarded: true }` instead of 400. No state corruption; no daemon-log error cascade; user sees "cancelled" and the DB stays cancelled.

### T4 — Playwright can't verify SQLite transaction atomicity under load

**Mitigation:** Unit-test the concurrency properties outside Playwright.
- `apps/server/tests/unit/task-queue-claim.test.ts` using `node --test` (per BACKEND-07 pattern that Phase 21 establishes). Spin up an in-memory SQLite, seed N queued rows, `Promise.all` twenty `claimTask()` calls, assert each returned row has a distinct id and a matching `status='dispatched'` in the DB, and that `dispatched ≤ min(20, N)`.
- `apps/server/tests/unit/task-message-batcher.test.ts` — append 500 messages to the same task from 20 pseudo-concurrent appenders, flush, assert the DB has 500 messages with strictly monotonic `seq = 1..500`.
- `apps/server/tests/unit/task-reaper.test.ts` — fake clock (sinon-like or node:test mock timers), seed stale rows, advance clock past DISPATCH_STALE_MS, call `reapOnce()`, assert state.

These tests CANNOT be done in Playwright because Playwright can't drive 20 simultaneous HTTP calls deterministically and can't introspect DB in a way that demonstrates atomicity. Node `--test` + direct DB reads is the right tool.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (E2E happy path) + `node --test` (unit-level concurrency + reaper) |
| Config file | `playwright.config.ts` (root); unit test entry points in `apps/server/tests/unit/*.test.ts` (Wave 0 creates the folder — Phase 21 finalises it per BACKEND-07) |
| Quick run command | `npx playwright test tests/e2e/tasks.spec.ts -g "TASK-01"` |
| Full suite command | `npx playwright test tests/e2e/tasks.spec.ts && node --test apps/server/tests/unit/task-*.test.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TASK-01 | 20 pollers never claim same row twice | unit (concurrency) | `node --test apps/server/tests/unit/task-queue-claim.test.ts` | ❌ Wave 0 |
| TASK-01 | Partial-unique index blocks duplicate enqueue | unit (direct SQL) | same file, separate test case | ❌ Wave 0 |
| TASK-02 | Each transition accepts only legal prior state | unit | `node --test apps/server/tests/unit/task-queue-lifecycle.test.ts` | ❌ Wave 0 |
| TASK-03 | Strictly monotonic seq under 500-message interleave | unit | `node --test apps/server/tests/unit/task-message-batcher.test.ts` | ❌ Wave 0 |
| TASK-04 | Fake-clock reaper fails stuck rows on first tick | unit (mock timers) | `node --test apps/server/tests/unit/task-reaper.test.ts` | ❌ Wave 0 |
| TASK-05 | Cancel flips DB status AND `isTaskCancelled` returns true | unit | `node --test apps/server/tests/unit/task-queue-cancel.test.ts` | ❌ Wave 0 |
| TASK-06 | complete on cancelled → `{ discarded: true }`, no error | unit (race simulation) | same file (cancel suite) | ❌ Wave 0 |
| REL-01 coverage | End-to-end dispatch happy path through HTTP | E2E (Playwright) | `npx playwright test tests/e2e/tasks.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test apps/server/tests/unit/task-<touched>.test.ts` (targeted file)
- **Per wave merge:** `node --test apps/server/tests/unit/task-*.test.ts && npx playwright test tests/e2e/tasks.spec.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`. Plus `npm run typecheck -w @aquaclawai/aquarium && npm run build -w @aquarium/shared`.

### Wave 0 Gaps
- [ ] `apps/server/tests/unit/` folder — does not yet exist (Phase 21 / BACKEND-07 creates it per roadmap). **Phase 18 WILL create this folder one phase early** because Phase 18 can't ship its concurrency proofs without unit tests.
- [ ] `apps/server/tests/unit/test-db.ts` — shared fixture that opens an isolated SQLite file per test (tmpdir + unique name), runs migrations, applies PRAGMAs, returns a knex instance. All unit tests compose from this.
- [ ] `tests/e2e/tasks.spec.ts` — Playwright shell covering assign → dispatch → message stream → complete on hosted runtime. Detailed behaviours belong to Phase 20/24; Phase 18's E2E coverage is minimal because its functions are not HTTP-facing yet (Phase 19 wires the HTTP surface).
- [ ] `apps/server/tests/unit/README.md` — document the `node --test` entrypoint + conventions (fake clock, isolated DB, cleanup).

*(Gaps 1-2 are mandatory Wave 0 for Phase 18. Gap 3 can slip to Phase 19 if Phase 18's work is all non-HTTP. Gap 4 is a nice-to-have.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (Phase 19 owns daemon auth) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Route-level `requireAuth` (CE auto-user) / `requireDaemonAuth` (Phase 19). Task-level access control: tasks belong to a workspace; routes MUST filter by `req.auth.workspaceId` (CE: 'AQ'). |
| V5 Input Validation | yes | Task ID parsing (validate UUID format), status transitions validated at service layer via the `.andWhere('status', <expected>)` guard |
| V6 Cryptography | no — no new crypto primitives | — |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Race-condition duplicate dispatch | Tampering | BEGIN IMMEDIATE + partial UNIQUE index |
| Daemon overwrites cancelled task with completed | Tampering | Service-layer status guard + discarded response |
| Attacker polls cancel-status endpoint at high rate to enumerate task IDs | Information disclosure | Phase 19's per-daemon rate limit (AUTH4); Phase 18 status service returns 404 for unknown-id (no distinct "exists but not yours") |
| Malformed task message payload crashes batcher | DoS | JSON-stringify via adapter.jsonValue (already stores as TEXT for SQLite); type column validated by migration 007 trigger |
| Batcher exhausts memory from a runaway posting worker | DoS | Per-task buffer cap (e.g., 500 messages) with early flush on overflow |
| UNIQUE constraint violation surfaces as 500 rather than 409 | UX/Availability | Service layer catches SQLITE_CONSTRAINT and translates to meaningful response (mostly an issue for Phase 19's HTTP routes, but Phase 18 must make the service functions surface the constraint class cleanly) |

## Code Examples

### Claim (verified pattern)

```typescript
// apps/server/src/services/task-queue-store.ts (add after enqueueTaskForIssue)
import type { ClaimedTask } from '@aquarium/shared';

/**
 * Claim the next queued task for a runtime. Atomic under SQLite:
 *   BEGIN IMMEDIATE -> find candidate (respects max_concurrent_tasks) -> UPDATE … RETURNING *
 * Returns null if no claimable task exists. Emits `task:dispatch` WS event.
 */
export async function claimTask(runtimeId: string): Promise<ClaimedTask | null> {
  return db.transaction(async (trx) => {
    await trx.raw('BEGIN IMMEDIATE');
    // SELECT candidate
    const candidate = await trx('agent_task_queue as q')
      .join('agents as a', 'a.id', 'q.agent_id')
      .where('q.runtime_id', runtimeId)
      .andWhere('q.status', 'queued')
      .andWhere('a.archived_at', null)
      .andWhereRaw(
        `(SELECT COUNT(*) FROM agent_task_queue c WHERE c.agent_id = q.agent_id AND c.status IN ('dispatched','running')) < a.max_concurrent_tasks`
      )
      .orderBy('q.priority', 'desc')
      .orderBy('q.created_at', 'asc')
      .first('q.id');
    if (!candidate) return null;

    // UPDATE
    await trx('agent_task_queue')
      .where({ id: candidate.id, status: 'queued' })
      .update({
        status: 'dispatched',
        dispatched_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    const row = await trx('agent_task_queue').where({ id: candidate.id }).first();
    return buildClaimedTask(row);   // join with agent + issue + trigger comment
  });
}
```

### Reaper one-tick (verified pattern)

```typescript
// apps/server/src/task-dispatch/task-reaper.ts (header matching offline-sweeper.ts)
import { db } from '../db/index.js';
import { broadcast } from '../ws/index.js';

const DISPATCH_STALE_MS = 5 * 60_000;
const RUNNING_STALE_MS  = 2.5 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;

async function reapOnce(): Promise<void> {
  const dispatchCut = new Date(Date.now() - DISPATCH_STALE_MS).toISOString();
  const runningCut  = new Date(Date.now() - RUNNING_STALE_MS).toISOString();

  // Collect IDs for broadcasts BEFORE the UPDATE.
  const stuckDispatched = await db('agent_task_queue')
    .where('status', 'dispatched').where('dispatched_at', '<', dispatchCut)
    .select('id', 'issue_id', 'workspace_id');
  const stuckRunning = await db('agent_task_queue')
    .where('status', 'running').where('started_at', '<', runningCut)
    .select('id', 'issue_id', 'workspace_id');

  if (stuckDispatched.length) {
    await db('agent_task_queue').whereIn('id', stuckDispatched.map((r) => r.id))
      .update({ status: 'failed', error: 'Reaper: dispatched > 5 min without start', completed_at: db.fn.now(), updated_at: db.fn.now() });
  }
  if (stuckRunning.length) {
    await db('agent_task_queue').whereIn('id', stuckRunning.map((r) => r.id))
      .update({ status: 'failed', error: 'Reaper: running beyond configured timeout', completed_at: db.fn.now(), updated_at: db.fn.now() });
  }

  for (const r of [...stuckDispatched, ...stuckRunning]) {
    broadcast(r.workspace_id as string, { type: 'task:failed', taskId: r.id, issueId: r.issue_id, payload: { taskId: r.id, issueId: r.issue_id } });
  }
}

export function startTaskReaper(): void {
  if (sweepInterval) return;
  reapOnce().catch((err) => console.warn('[task-reaper] initial sweep failed:', err instanceof Error ? err.message : String(err)));
  sweepInterval = setInterval(() => {
    reapOnce().catch((err) => console.warn('[task-reaper] sweep failed:', err instanceof Error ? err.message : String(err)));
  }, SWEEP_INTERVAL_MS);
  console.log('[task-reaper] started (5min dispatch / 2.5h running, 30s tick)');
}

export function stopTaskReaper(): void {
  if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; console.log('[task-reaper] stopped'); }
}
```

### Boot wiring (server-core.ts addition)

```typescript
// server-core.ts — between 9a loop (line 295) and 9e offline-sweeper (line 299)
// Step 9c: task reaper — fails stuck dispatched/running tasks.
startTaskReaper();
// Step 9c (continued): task message batcher flush loop.
startTaskMessageBatcher();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SELECT FOR UPDATE SKIP LOCKED (Postgres pattern) | Single-writer BEGIN IMMEDIATE on SQLite | Migration to CE + SQLite (v1.4) | No SKIP semantics; pool=1 is the serialiser |
| Counter in memory for seq | MAX(seq)+1 under BEGIN IMMEDIATE + (task_id, seq) UNIQUE | Phase 15 schema | No Redis; DB is source of truth |
| EventEmitter for status changes | `broadcast(workspaceId, …)` direct after commit | Phase 17 convention | No race with rollback; post-commit only |

**Deprecated/outdated:**
- multica's Go `FOR UPDATE SKIP LOCKED` — inapplicable in SQLite; design around pool=1 serialisation.
- Any variant of "SELECT then UPDATE in autocommit" — upgrades deferred txn and hits busy errors under contention (PITFALLS §SQ1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hosted worker cancel uses AbortController attached to gateway RPC, not gateway-native cancel frame | §Cancellation Propagation | Low — Phase 20's research gate explicitly covers this. Phase 18's contract (flip DB + `isTaskCancelled`) works either way. |
| A2 | `RUNNING_STALE_MS` should be configurable via `config.task.runningStaleMs` reading `AQUARIUM_RUNNING_STALE_MS` env | §Reaper Design | Medium — if the planner chooses `.planning/config.json` instead, the pattern changes slightly (config reload logic). The default 2.5 h is the hard spec. |
| A3 | `SWEEP_INTERVAL_MS = 30_000` for the reaper | §Reaper Design | Low — matches offline-sweeper; if load testing shows a need, can be increased |
| A4 | Per-task buffer cap should be ~500 messages to prevent runaway flush | §Pitfalls / SQ5 | Medium — exact cap needs real-world measurement. Start at 500; revisit after Phase 20 load tests. |
| A5 | `task:event_seq` is deferred to Phase 24 (replay + reconnect) | §ST6 | Low — per-task message seq already exists; lifecycle events (dispatch/complete/fail/cancel) are few enough that ordering races are rare |
| A6 | Unit tests use `node --test` (per BACKEND-07 hint) rather than Jest / Vitest | §Validation Architecture | Low — Phase 21 formalises this; Phase 18 doing it one phase early is aligned |
| A7 | `apps/server/tests/unit/` folder creation is Phase 18's responsibility | §Validation Architecture Wave 0 | Low — alternative is to create it in a prior Wave 0 of Phase 18 |

**Confirmation checkpoint for planner:** items A2, A4 would benefit from explicit decisions in CONTEXT.md (if created) or in the PLAN's Decisions section. Items A1, A3, A5, A6, A7 can be locked by the planner directly.

## Open Questions

1. **Should `config.task.runningStaleMs` be env-var driven or `.planning/config.json` driven?**
   - What we know: roadmap says "configurable" (TASK-04); existing patterns split — offline-sweeper hardcodes 90 s, health-monitor uses config.ts + env. No existing `.planning/config.json` runtime-read path.
   - What's unclear: which mechanism the user prefers for per-deployment tuning.
   - Recommendation: add `config.task = { dispatchStaleMs, runningStaleMs, sweepIntervalMs }` to `apps/server/src/config.ts` with env overrides. Matches existing `config.*` pattern. Document in CLAUDE.md / AGENTS.md.

2. **Should the reaper fire WS events for reaped tasks?**
   - Recommended in §Reaper Design: yes — emit `task:failed` per reaped row. The SELECT-then-UPDATE pattern adds one extra query per tick but keeps UI fresh.
   - Alternative: skip WS; UI polls or waits for next task:* event. Rejected because user-perceived "stuck forever" is exactly the UX this requirement prevents.

3. **Per-task buffer size cap for the batcher?**
   - 500 messages proposed. Real-world: Claude Code stream-json can produce 20-50 messages per turn; runaway bug produces thousands. 500 covers normal bursts, flushes early on overflow.
   - Planner to confirm or adjust.

4. **`task:event_seq` per task for global event replay?**
   - Message-seq already covers `task:message` events. But `task:dispatch` / `task:complete` / `task:failed` / `task:cancelled` have no monotonic seq across the task's lifetime.
   - Phase 24 WS-reconnect replay might want this. Phase 18 can ship a `lifecycle_seq INTEGER` column now (cheap) or defer.
   - Recommendation: defer to Phase 24. Adding a column now locks semantics before we know what replay needs.

5. **Unit test framework: node --test vs vitest?**
   - BACKEND-07 says "node --test". Phase 18 lands these tests one phase early.
   - Vitest would give better DX (watch mode, snapshot) but adds a dependency.
   - Recommendation: follow BACKEND-07 — node --test. Phase 21 may reconsider.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime for all code | ✓ | 22+ (CLAUDE.md) | — |
| TypeScript tsx | dev script | ✓ | via npm | — |
| better-sqlite3 | DB driver | ✓ | already installed + proven | — |
| knex | Query builder | ✓ | already installed | — |
| SQLite `CURRENT_TIMESTAMP` + `json_extract` + partial UNIQUE indexes | Claim / state / idx | ✓ | SQLite 3.38+ (ships with better-sqlite3) | — |
| node:test module | Unit tests | ✓ | Node 22+ | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Sources

### Primary (HIGH confidence) — codebase truth
- `apps/server/src/db/knexfile.ts:15` — `pool: { min: 1, max: 1 }` for CE
- `apps/server/src/db/sqlite-adapter.ts:57-98` — boot PRAGMAs and read-back verification
- `apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts` — full schema for `agent_task_queue` + `task_messages`, CHECK triggers, partial UNIQUE
- `apps/server/src/services/task-queue-store.ts` — Phase 17 slice with top-of-file JSDoc reserving Phase 18 extension surface
- `apps/server/src/task-dispatch/offline-sweeper.ts` — reaper pattern template (exact parallel)
- `apps/server/src/task-dispatch/runtime-bridge.ts` — hook pattern reference
- `apps/server/src/server-core.ts:275-305` — boot steps 9a / 9e where 9c (task-reaper) slots in
- `apps/server/src/ws/index.ts` — `broadcast(instanceId, msg)` API for `task:*` events
- `packages/shared/src/v14-types.ts:128-251` — AgentTask / TaskStatus / TaskMessage / TaskEventType already exported
- `.planning/research/PITFALLS.md` §SQ1, §SQ2, §SQ4, §SQ5, §ST6, §PM5, §PM6, §T4
- `.planning/phases/17-agent-issue-comment-services/17-03-SUMMARY.md` — contract for enqueue / cancel; `task:*` namespace reservation
- `.planning/phases/16-runtime-registry-runtime-bridge/16-03-SUMMARY.md` — offline-sweeper and 9a/9e boot wiring

### Secondary (MEDIUM confidence) — official documentation
- [sqlite.org/lang_transaction.html](https://sqlite.org/lang_transaction.html) — BEGIN DEFERRED / IMMEDIATE / EXCLUSIVE semantics + SQLITE_BUSY on deferred-upgrade
- [knexjs.org/guide/transactions.html](https://knexjs.org/guide/transactions.html) — knex transaction API, no native IMMEDIATE/EXCLUSIVE flag exposure
- [github.com/WiseLibs/better-sqlite3 docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `.immediate()` / `.deferred()` / `.exclusive()` variants on raw db.transaction
- [sqlite.org/autoinc.html](https://sqlite.org/autoinc.html) — monotonic ROWID guarantees under AUTOINCREMENT
- [sqlite.org/wal.html](https://sqlite.org/wal.html) — WAL mode reader/writer concurrency model
- [github.com/knex/knex issue 5097](https://github.com/knex/knex/issues/5097) — better-sqlite3 support context
- [rails/rails PR 50371](https://github.com/rails/rails/pull/50371) — Rails' "SQLite transaction default to IMMEDIATE" — corroborates the deferred-trap analysis

### Tertiary (LOW confidence) — synthesised
- Verification that Knex emits plain `BEGIN;` for SQLite — confirmed via multiple WebSearch sources but no direct source-line citation. Assumption strength: HIGH (consistent across docs + issues). If ever shown wrong, the BEGIN IMMEDIATE defence is still safe (two BEGIN IMMEDIATEs in a row is just a no-op / error that the test suite catches).

## Metadata

**Confidence breakdown:**
- SQLite concurrency model: HIGH — verified pool=1 config + PRAGMA-at-boot enforcement + PITFALLS cross-reference
- Claim query design: HIGH — pattern is multica-portable + schema supports every WHERE clause natively via declared indexes
- Lifecycle state machine: HIGH — transitions already constrained by existing CHECK triggers; service-layer guards are idiomatic
- Batcher / monotonic seq: HIGH — UNIQUE(task_id, seq) backstop + MAX+1 inside BEGIN IMMEDIATE is the textbook pattern
- Reaper: HIGH — exact clone of Phase-16 offline-sweeper, which shipped with a proof-of-correctness in 16-03-SUMMARY
- Cancellation propagation: MEDIUM — Phase 18 surface is clear, but the runtime-side cancel contract depends on Phase 19 / Phase 20 research not yet done. All assumptions explicitly flagged.
- Discarded semantics: HIGH — PITFALLS §PM5 is explicit; TASK-06 text is unambiguous

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable — codebase + SQLite semantics do not change; re-check only if Knex major upgrade or pool config changes)

## RESEARCH COMPLETE
