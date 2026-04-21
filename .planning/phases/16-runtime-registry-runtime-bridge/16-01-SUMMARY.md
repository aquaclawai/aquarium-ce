---
phase: 16-runtime-registry-runtime-bridge
plan: 01
subsystem: runtime-registry
tags: [service, migration, sqlite, postgres, runtime, upsert, derived-status]
requires:
  - .planning/phases/15-schema-shared-types/15-02-SUMMARY.md
  - apps/server/src/db/migrations/004_runtimes.ts
  - packages/shared/src/v14-types.ts
provides:
  - partial UNIQUE index `uq_runtimes_instance` on runtimes(instance_id) WHERE instance_id IS NOT NULL
  - `runtime-registry` service boundary (listAll/getById/upsertHostedRuntime/upsertDaemonRuntime/updateHeartbeat/setRuntimeOffline)
  - LEFT JOIN + CASE WHEN derived-status read pattern for hosted rows
affects:
  - runtime-bridge (plan 16-02 consumer of upsertHostedRuntime + reconcileFromInstances)
  - offline-sweeper (plan 16-03 consumer of setRuntimeOffline)
  - daemon-register route (Phase 19 consumer of upsertDaemonRuntime + updateHeartbeat)
tech-stack:
  added:
    - partial UNIQUE index (SQLite 3.38+ / Postgres 12+ portable syntax)
  patterns:
    - LEFT JOIN + CASE WHEN derived-column pattern for read-path
    - ON CONFLICT(col).merge({...}) UPSERT via knex
    - dialect-branched migration via lazy-imported getAdapter()
key-files:
  created:
    - apps/server/src/db/migrations/009_runtimes_instance_unique.ts
    - apps/server/src/services/runtime-registry.ts
  modified: []
decisions:
  - "Partial UNIQUE in a dedicated migration 009 (Option A from 16-RESEARCH.md §Open Questions #1) — chosen over service-level check-then-insert for schema-level enforcement"
  - "LEFT JOIN + CASE WHEN at read time (Option 1 from 16-RESEARCH.md Derived-Status Decision Table) — chosen over SQL VIEW / triggers / stored column"
  - "Hosted INSERT writes r.status='offline' placeholder; merge block on ON CONFLICT excludes status — keeps InstanceManager as sole writer of instance-derived status (ST1 HARD)"
  - "updateHeartbeat flips status back to 'online' when a daemon resumes heartbeating — avoids stale offline marker after sweeper tick"
  - "whereIn('kind', daemon-kinds) defence-in-depth guard in setRuntimeOffline + updateHeartbeat — static-grep verifiable"
metrics:
  duration: "~5 min"
  tasks-completed: 2
  files-created: 2
  files-modified: 0
  loc-added: "~320 (60 migration + 262 service)"
  commits: 2
  completed: 2026-04-16
---

# Phase 16 Plan 01: Runtime Registry Foundation Summary

**One-liner:** Shipped partial-UNIQUE schema invariant (migration 009) plus the runtime-registry service with LEFT JOIN derived-status read path and six UPSERT/heartbeat/offline exports — foundations for plan 16-02's runtime-bridge hooks and plan 16-03's offline sweeper.

## What Was Built

### 1. Migration 009 — Partial UNIQUE on `runtimes.instance_id`

File: `apps/server/src/db/migrations/009_runtimes_instance_unique.ts` (60 LOC).

Schema diff vs migration 004:

| Before (migration 004 line 125-129 SQLite / line 141 PG) | After (migration 009) |
|---|---|
| `CREATE INDEX idx_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL` (non-unique partial) | `CREATE UNIQUE INDEX uq_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL` (partial UNIQUE) |

- `up()` — `DROP INDEX IF EXISTS idx_runtimes_instance;` then `CREATE UNIQUE INDEX uq_runtimes_instance ...`.
- `down()` — `DROP INDEX IF EXISTS uq_runtimes_instance;` then restore the original non-unique partial index, leaving schema identical to pre-009 state.
- Dialect branches are structurally split (per plan) even though the SQL text is identical today, so future Postgres-only tweaks (e.g. `INCLUDE` clauses) slot in without re-introducing the switch.

**Invariant enforced:** "at most one hosted_instance mirror per instance". Daemon rows (`instance_id IS NULL`) do NOT participate in the UNIQUE constraint — the partial predicate excludes them, keeping multi-daemon-per-workspace valid.

### 2. `apps/server/src/services/runtime-registry.ts` — Public Surface

File: 262 LOC. Six exports:

```typescript
export async function listAll(workspaceId: string): Promise<Runtime[]>;
export async function getById(workspaceId: string, id: string): Promise<Runtime | null>;
export async function upsertHostedRuntime(args: UpsertHostedRuntimeArgs): Promise<void>;
export async function upsertDaemonRuntime(args: UpsertDaemonRuntimeArgs): Promise<string>;
export async function updateHeartbeat(id: string): Promise<void>;
export async function setRuntimeOffline(id: string): Promise<void>;
```

Key shapes:

```typescript
interface UpsertHostedRuntimeArgs {
  workspaceId: string;
  instanceId: string;
  name: string;
  ownerUserId: string | null;
}

interface UpsertDaemonRuntimeArgs {
  workspaceId: string;
  daemonId: string;
  provider: RuntimeProvider;
  name: string;
  deviceInfo: RuntimeDeviceInfo | null;
  ownerUserId: string | null;
  kind: Extract<RuntimeKind, 'local_daemon' | 'external_cloud_daemon'>;
}
```

## HARD-Constraint Proofs

### ST1 HARD — hosted `r.status` is never written after INSERT

The only hosted write path (`upsertHostedRuntime`) sets `status='offline'` placeholder on the INSERT branch and its ON CONFLICT merge block excludes `status` entirely. Automated proof (inline node script):

```text
MERGE BLOCK: .merge({ name: args.name, updated_at: db.fn.now() })
PASS: hosted merge block excludes status
```

Defence-in-depth: `setRuntimeOffline` and `updateHeartbeat` both carry `whereIn('kind', ['local_daemon', 'external_cloud_daemon'])` guards so a caller cannot accidentally flip a hosted row's stored status via the daemon-facing mutation APIs.

Additionally verified at runtime: manually setting `runtimes.status='offline'` for a hosted row where `instances.status='running'` still yields `derived_status='online'` via the listAll CASE WHEN — the stored column is ignored for hosted kinds.

```text
d1|daemon-a|local_daemon||online|online       # daemon: derived = stored
d2|daemon-b|local_daemon||online|online       # daemon: derived = stored
r1|mirror1|hosted_instance|running|online|offline   # hosted: derived(online) != stored(offline) — JOIN wins
```

### CE1 HARD — every read path filters by workspace_id

Every exported function that reads is workspace-scoped:

```
apps/server/src/services/runtime-registry.ts:63  .where('r.workspace_id', workspaceId)  # listAll
apps/server/src/services/runtime-registry.ts:99  .where('r.workspace_id', workspaceId)  # getById
```

Every write path scopes via the `workspace_id` column in the INSERT payload:

```
line 154: workspace_id: args.workspaceId,  # upsertHostedRuntime INSERT
line 197: workspace_id: args.workspaceId,  # upsertDaemonRuntime INSERT
line 223: workspace_id: args.workspaceId,  # upsertDaemonRuntime readback
```

Runtime sanity check: inserted a daemon `d3` under workspace `OTHER`; `listAll('AQ')` returned only `d1, d2, r1` (workspace-scoped). Cross-leak count = 0.

### RT-04 / Derived Status — LEFT JOIN + CASE WHEN

`listAll()` / `getById()` both use:

```typescript
db('runtimes as r')
  .leftJoin('instances as i', 'r.instance_id', 'i.id')
  // ...
  db.raw(`
    CASE
      WHEN r.kind = 'hosted_instance' THEN
        CASE
          WHEN i.status = 'running' THEN 'online'
          WHEN i.status = 'error' THEN 'error'
          ELSE 'offline'
        END
      ELSE r.status
    END as status
  `)
```

- `LEFT JOIN` preserves daemon rows where `instance_id IS NULL` (join matches nothing, CASE falls through to `r.status`).
- For `hosted_instance`, derived status comes exclusively from `instances.status` — never from the stored `r.status` column.
- Portable across SQLite 3.38+ and Postgres 12+ with identical syntax (no dialect branching in the service).

## Schema Verification Evidence

Fresh-DB migration run (`rm /tmp/aq-p16-p01.db && npm run migrate`):

```
...
008_daemon_tokens.ts
009_runtimes_instance_unique.ts
```

`sqlite_master` post-migration:

```sql
CREATE UNIQUE INDEX uq_runtimes_instance
      ON runtimes(instance_id)
      WHERE instance_id IS NOT NULL
```

Old `idx_runtimes_instance` count: 0 (dropped).

Partial UNIQUE enforcement — integration test on the schema:

| Scenario | Expected | Actual |
|---|---|---|
| Insert hosted row `r1` with `instance_id='i1'` | accepted | `insert 1 ok` |
| Insert second hosted row `r2` with same `instance_id='i1'` | rejected | `UNIQUE constraint failed: runtimes.instance_id` |
| Insert daemon `d1` with `instance_id=NULL` | accepted | `daemon 1 ok` |
| Insert daemon `d2` with `instance_id=NULL` | accepted | `daemon 2 ok` |

## Build + Typecheck

```
npm run build -w @aquarium/shared     # tsc
npm run typecheck -w @aquaclawai/aquarium  # tsc --noEmit
```

Both exit 0. No `any`, no `@ts-ignore`. All relative imports in new server files end with `.js` per CLAUDE.md §ESM Import Rules.

## Deviations from Plan

**None — plan executed exactly as written.**

- Inline node-script in the task 2 acceptance criteria (`src.split('upsertHostedRuntime')[1].split('export')[0]`) needed a minor refinement to handle the fact that `upsertHostedRuntime` appears both in the JSDoc preamble and in the `export async function` declaration; the refined script uses `src.indexOf('export async function upsertHostedRuntime')` as the anchor. This is a **verification-script refinement only** — the plan's intent (assert `status` absent from the hosted merge block) is exactly preserved. Not a code deviation.

## Follow-ups for Plans 16-02, 16-03, 16-04

- Plan 16-02 (runtime-bridge) will consume `upsertHostedRuntime` from hooks at `instance-manager.ts:167/475/820/951` and call `upsertHostedRuntime` in a loop from `reconcileFromInstances()`. All integration points are frozen.
- Plan 16-03 (offline sweeper) will call `setRuntimeOffline` on each stale-heartbeat row within its 30s tick.
- Plan 16-04 (E2E) will Playwright-drive RT-01..RT-05 against `GET /api/runtimes` — the shape returned by `listAll` is what the route will marshal in 16-03 Task 1.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `a1da947` | feat(16-01): add migration 009 partial UNIQUE on runtimes.instance_id |
| 2 | `9c7cb33` | feat(16-01): add runtime-registry service with derived-status listAll |

## Self-Check: PASSED

- FOUND: apps/server/src/db/migrations/009_runtimes_instance_unique.ts
- FOUND: apps/server/src/services/runtime-registry.ts
- FOUND: .planning/phases/16-runtime-registry-runtime-bridge/16-01-SUMMARY.md
- FOUND: commit a1da947
- FOUND: commit 9c7cb33
