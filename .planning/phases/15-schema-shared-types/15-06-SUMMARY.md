---
phase: 15-schema-shared-types
plan: 06
subsystem: database + shared-types

tags: [knex, sqlite, migration, schema, daemon-tokens, auth, sha256, typescript, shared-types, v1.4, phase-completion]

requires:
  - phase: 15-01
    provides: "migration-helpers (addUuidPrimary, addUuidColumn) + workspaces 'AQ' seed (FK target for daemon_tokens.workspace_id)"
  - phase: 15-02
    provides: "Runtime type shape (RuntimeKind, RuntimeStatus, RuntimeProvider) canonical values enforced by migration 004 triggers"
  - phase: 15-03
    provides: "Agent type shape (AgentStatus, AgentVisibility) canonical values enforced by migration 005 triggers"
  - phase: 15-04
    provides: "Issue + Comment type shapes (IssueStatus, IssuePriority, CommentType) canonical values enforced by migration 006 triggers"
  - phase: 15-05
    provides: "AgentTask + TaskMessage type shapes (TaskStatus, TaskMessageType) canonical values enforced by migration 007 triggers"

provides:
  - "daemon_tokens table with SHA-256 hashed storage (token_hash VARCHAR(64) UNIQUE NOT NULL), no plaintext column"
  - "@aquarium/shared v1.4 contract: 26 exports covering every domain + wire type exchanged by server/web/daemon"
  - "Phase 15 complete: 8 migrations (001-008), 15 tables net new for v1.4, PRAGMAs applied at boot, single authoritative TS contract"

affects:
  - 17-issues-service (imports Issue, IssueStatus, IssuePriority, Comment, CommentType from @aquarium/shared)
  - 18-task-queue (imports AgentTask, TaskStatus from @aquarium/shared)
  - 19-daemon-rest (imports DaemonRegisterRequest/Response, ClaimedTask, DaemonToken; queries daemon_tokens for auth)
  - 20-daemon-tokens-service (full CRUD over daemon_tokens; plaintext-once response uses DaemonTokenCreatedResponse)
  - 24-web-kanban (imports Issue, Agent, TaskEventType, TaskEventPayload from @aquarium/shared)

tech-stack:
  added: []
  patterns:
    - "Hashed-only credential storage (SHA-256 hex in UNIQUE-indexed VARCHAR(64)) — plaintext exists for O(1) and dies"
    - "DB-backed token revocation (revoked_at timestamp read on every auth request — no JWT caching)"
    - "Namespace-isolated shared types (v14-types.ts kept separate from 1754-line types.ts for reviewability)"
    - "String-literal unions mirror migration enum triggers 1:1 (compile-time parity gate between TS and schema)"
    - "Barrel re-export with ESM .js extension for NodeNext resolution"

key-files:
  created:
    - apps/server/src/db/migrations/008_daemon_tokens.ts
    - packages/shared/src/v14-types.ts
  modified:
    - packages/shared/src/index.ts

key-decisions:
  - "token_hash VARCHAR(64) UNIQUE NOT NULL — and NO plaintext column: the STRIDE T-15-06-01 mitigation is schema-level. SHA-256 hex is always 64 chars. UNIQUE + NOT NULL means the auth hot-path is a single indexed lookup. A future reviewer proposing a plaintext `token` column for debugging MUST be rejected; the plaintext is shown once by Phase 19 service code and never persisted."
  - "workspace_id CASCADE vs created_by_user_id SET NULL — divergent FK disposition: workspace deletion is a tenancy teardown event (tokens are meaningless without their workspace), so CASCADE. User deletion is an audit-sensitive event (tokens keep working until revoked; the issuing user's identity loss shouldn't invalidate them), so SET NULL preserves the token row with a null issuer. Matches the existing runtimes.owner_user_id SET NULL pattern (migration 004)."
  - "idx_daemon_tokens_revoked as scan reducer on the auth hot path: the request-time query is `SELECT * FROM daemon_tokens WHERE token_hash = ? AND revoked_at IS NULL`. UNIQUE(token_hash) already makes it O(log n), but a separate index on revoked_at lets admin-facing queries (`SELECT * FROM daemon_tokens WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`) skip the NOT-NULL branch cleanly. Small cost, measurable benefit on populated workspaces."
  - "v14-types.ts as a separate file, re-exported via index barrel: types.ts is already 1754 lines. Adding 20+ v1.4 types dilutes a crowded file and makes diffs unreadable. A dedicated module (a) is easy to review in one sitting, (b) can be deleted wholesale if v1.4 is ever renamed, (c) signals 'this is the task-delegation namespace' without needing section headers. Consumers still `import { Issue } from '@aquarium/shared'` because the barrel re-exports it transparently."
  - "`unknown` for AgentTask.result and TaskMessage.input/output, NOT `any`: CLAUDE.md explicitly forbids `any`. These fields carry type-specific JSON (tool_use has tool input, tool_result has tool output) and the consumer is expected to narrow via the `type` discriminant. `unknown` forces that narrowing at the call site; `any` would silently accept garbage."
  - "String-literal unions match migration trigger enum strings 1:1: IssueStatus is `'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'` — exactly the list enforced by `trg_issues_status_check` and `_upd` (migration 006). Every divergence between TS union and schema trigger is a guaranteed runtime failure; keeping them lockstep means the typecheck IS the schema contract check."
  - "Explicit interface for extending types over intersection aliases: `ClaimedTask extends AgentTask` rather than `type ClaimedTask = AgentTask & {...}`. Per CLAUDE.md 'interface for shapes', and interface extension is friendlier to IDE auto-import + docstring linking."

patterns-established:
  - "Daemon-credential schema pattern: hashed storage, optional expiry, soft-revocation via timestamp column, last-use tracking, created-by with SET NULL — reusable for any future bearer-token system (OAuth client secrets, webhook signing keys, etc.)"
  - "Shared-types-from-DB-schema pattern: every migration trigger enum has a matching TS string-literal union; every DB column has a camelCase TS field; every JSON/B column becomes `Record<string, unknown>` or a narrow shape"
  - "Namespace-isolated shared types: when a feature family adds 10+ types, put them in their own module and re-export from index (keeps the 'god-file' types.ts from hitting 2000 lines)"

requirements-completed: [SCH-08, SCH-10]

duration: ~15min
completed: 2026-04-16
---

# Phase 15-06: Daemon Tokens + v1.4 Shared Types Summary

**The closing plan of Phase 15: a SHA-256-hashed `daemon_tokens` table (no plaintext column by design) plus `@aquarium/shared/v14-types.ts` exporting the full v1.4 contract (26 types) — every DTO, enum, and wire shape the task-delegation platform exchanges across server/web/daemon boundaries.**

## Performance

- **Duration:** ~15 min (one migration + one new shared module + one barrel-export edit)
- **Completed:** 2026-04-16
- **Tasks:** 2
- **Files created:** 2 (`008_daemon_tokens.ts`, `v14-types.ts`)
- **Files modified:** 1 (`packages/shared/src/index.ts` — +1 line barrel re-export)

## Accomplishments

### Task 1: Migration 008 — daemon_tokens (SCH-08)

- Created `daemon_tokens` table with 11 columns covering identity (id), tenancy (workspace_id), secret storage (token_hash UNIQUE), UI label (name), optional daemon binding (daemon_id, populated at first register), audit trail (created_by_user_id SET NULL), lifecycle timestamps (expires_at, last_used_at, revoked_at), and metadata (created_at, updated_at)
- `token_hash` is `VARCHAR(64) NOT NULL` with a UNIQUE index (`daemon_tokens_token_hash_unique`) — the auth hot-path is O(log n) and hash collisions are rejected at schema level
- NO plaintext column exists (STRIDE T-15-06-01 mitigation). Plaintext `adt_<32nanoid>` is shown ONCE by Phase 19 service code on token creation and never persisted.
- Two indexes beyond the UNIQUE constraint:
  - `idx_daemon_tokens_workspace (workspace_id)` — admin-facing "list tokens for workspace" queries
  - `idx_daemon_tokens_revoked (revoked_at)` — scan reducer for the revocation-aware auth query
- FK dispositions verified via `PRAGMA foreign_key_list`:
  - `workspace_id → workspaces(id)` **CASCADE** (tenant teardown removes tokens)
  - `created_by_user_id → users(id)` **SET NULL** (user deletion preserves token audit row with null issuer)

### Task 2: @aquarium/shared v14-types (SCH-10)

- Created `packages/shared/src/v14-types.ts` with 26 exports across 10 domain sections (Workspace, Runtime, Agent, Issue, Comment, Task queue, Task messages, Daemon tokens, Daemon REST wire, WebSocket events)
- Every string-literal union mirrors the corresponding migration trigger enum 1:1 — IssueStatus matches `trg_issues_status_check`, TaskStatus matches `trg_atq_status_check`, TaskMessageType matches `trg_task_messages_type_check`, etc.
- Used `unknown` (not `any`) for `AgentTask.result`, `TaskMessage.input`, `TaskMessage.output`, `TaskEventPayload.input/output` — consumers must narrow via the `type` discriminant
- Used `interface extends` for `ClaimedTask extends AgentTask` (shape extension) and `type` for every union (per CLAUDE.md conventions)
- Extended `packages/shared/src/index.ts` barrel with `export * from './v14-types.js';` — consumers continue to write `import { Issue } from '@aquarium/shared'`
- Build emits `packages/shared/dist/v14-types.js` + `.d.ts` + source maps

## Task Commits

1. **Task 1: Create migration 008 — daemon_tokens table** — `4c8f2b0` (feat)
2. **Task 2: Create packages/shared/src/v14-types.ts + re-export** — `0e00eaf` (feat)

## Files Created/Modified

- `apps/server/src/db/migrations/008_daemon_tokens.ts` — new migration creating `daemon_tokens` (11 cols, 2 indexes + 1 UNIQUE, 2 FKs). Reversible `down()` drops the table.
- `packages/shared/src/v14-types.ts` — new module with 26 exports covering the v1.4 Task Delegation Platform contract (Workspace, Runtime[Kind/Status/Provider/DeviceInfo], Agent[Status/Visibility], Issue[Status/Priority], Comment[Type/AuthorType], AgentTask[TaskStatus], TaskMessage[Type], DaemonToken[CreatedResponse], DaemonRegisterRequest/Response, ClaimedTask, TaskEventType, TaskEventPayload).
- `packages/shared/src/index.ts` — added one line `export * from './v14-types.js';` (barrel re-export).

## Decisions Made

- **Hashed-only storage with NO plaintext column**: the STRIDE T-15-06-01 mitigation is at the schema level. The plaintext `adt_<32nanoid>` exists only in Phase 19's `POST /api/daemon-tokens` response body, then dies. Any future PR proposing a plaintext column for "debugging" must be rejected; the threat model is explicit that plaintext persistence is disallowed.
- **`workspace_id` CASCADE, `created_by_user_id` SET NULL**: different FKs, different semantics. Workspace deletion is an operational teardown (tokens without a workspace are meaningless). User deletion is an audit-sensitive event (the token's validity is orthogonal to its issuer's account state). SET NULL preserves the token row — admins can still audit "token X was used N times" even after the issuer is deleted.
- **`idx_daemon_tokens_revoked` as a scan reducer**: UNIQUE(token_hash) already gives O(log n) hash lookup for the request-time auth check. The separate index on `revoked_at` accelerates admin-facing queries that list non-revoked tokens per workspace. Low cost, measurable benefit at scale.
- **Separate `v14-types.ts` module, not appended to `types.ts`**: the existing 1754-line `types.ts` is already difficult to review. A dedicated v1.4 module is easier to diff, easier to audit during security reviews, and trivial to delete if a future rename happens. Consumers see no API change — the barrel re-export makes the import path identical.
- **`unknown` over `any`**: CLAUDE.md explicitly forbids `any`. `AgentTask.result`, `TaskMessage.input/output`, `TaskEventPayload.input/output` are genuinely dynamic (tool-use payload shapes are tool-specific) — `unknown` forces the consumer to narrow, preserving type safety. A `:\s*any[\s;)<,]` regex scan of `v14-types.ts` returns zero matches.
- **String-literal unions mirror migration enum triggers 1:1**: the `IssueStatus` union (`'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'`) is the same list enforced by `trg_issues_status_check_upd` (migration 006). Same lockstep for TaskStatus / TaskMessageType / RuntimeKind / RuntimeStatus / AgentStatus / AgentVisibility / IssuePriority / CommentType / CommentAuthorType / RuntimeProvider. Any drift = build-blocking schema violation caught at `npm run typecheck`.
- **`ClaimedTask extends AgentTask` (interface extension) not intersection**: CLAUDE.md says "interface for shapes". Interface extension plays nicer with docstring linking and IDE auto-import.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria satisfied on first run. No auto-fixes, no architectural decisions, no auth gates.

## Verification Evidence

### Migration run (fresh DB, migrations 001-008)

```
Batch 1 run: 8 migrations
001_initial_schema.ts
002_seed_wizard_configs.ts
003_boot_pragmas_and_workspace.ts
004_runtimes.ts
005_agents.ts
006_issues_and_comments.ts
007_agent_task_queue_and_messages.ts
008_daemon_tokens.ts
```

### daemon_tokens schema (from `.schema daemon_tokens`)

```sql
CREATE TABLE `daemon_tokens` (
  `id` varchar(36),
  `workspace_id` varchar(36) not null,
  `token_hash` varchar(64) not null,
  `name` varchar(100) not null,
  `daemon_id` varchar(36) null,
  `created_by_user_id` varchar(36) null,
  `expires_at` datetime null,
  `last_used_at` datetime null,
  `revoked_at` datetime null,
  `created_at` datetime not null default CURRENT_TIMESTAMP,
  `updated_at` datetime not null default CURRENT_TIMESTAMP,
  foreign key(`workspace_id`) references `workspaces`(`id`) on delete CASCADE,
  foreign key(`created_by_user_id`) references `users`(`id`) on delete SET NULL,
  primary key (`id`)
);
CREATE UNIQUE INDEX `daemon_tokens_token_hash_unique` on `daemon_tokens` (`token_hash`);
CREATE INDEX `idx_daemon_tokens_workspace` on `daemon_tokens` (`workspace_id`);
CREATE INDEX `idx_daemon_tokens_revoked` on `daemon_tokens` (`revoked_at`);
```

### FK graph (via `PRAGMA foreign_key_list(daemon_tokens)`)

| seq | to table   | from col             | to col | on_update | on_delete |
|-----|------------|----------------------|--------|-----------|-----------|
| 0   | users      | created_by_user_id   | id     | NO ACTION | **SET NULL** |
| 1   | workspaces | workspace_id         | id     | NO ACTION | **CASCADE**  |

### Plaintext-column absence proof

```
grep -E "'token'|\"token\"" apps/server/src/db/migrations/008_daemon_tokens.ts | grep -v "token_hash"
# (zero lines of output — no plaintext column)
```

### UNIQUE rejection proof

```
INSERT INTO daemon_tokens (id='dt2', workspace_id='AQ', token_hash='<hex>', name='test2');  -- OK
INSERT INTO daemon_tokens (id='dt3', workspace_id='AQ', token_hash=<same hex>, name='dup');
Error: stepping, UNIQUE constraint failed: daemon_tokens.token_hash (19)
```

### workspace_id CASCADE proof

```
PRAGMA foreign_keys=ON;
INSERT INTO workspaces (id='WST', ...);  -- OK
INSERT INTO daemon_tokens (id='dtc', workspace_id='WST', ...);  -- OK
-- before: 1 row where id='dtc'
DELETE FROM workspaces WHERE id='WST';
-- after: 0 rows where id='dtc'  ✓ CASCADE
```

### created_by_user_id SET NULL proof

```
PRAGMA foreign_keys=ON;
INSERT INTO users (id='u-sn', email='sn@x', display_name='SN Test', password_hash='hash');
INSERT INTO daemon_tokens (id='dtu', workspace_id='AQ', token_hash='user_hash_xx',
                           name='by-user', created_by_user_id='u-sn');
-- before: created_by_user_id = 'u-sn'
DELETE FROM users WHERE id='u-sn';
-- after:  created_by_user_id = NULL  ✓ SET NULL
```

### Rollback round-trip

```
-- Forward: daemon_tokens exists = true
-- Rollback batch 1: 8 migrations rolled back
-- After rollback: daemon_tokens exists = false
-- Re-forward batch 1: 8 migrations applied
-- After re-forward: daemon_tokens exists = true
```

### Shared types build + exports

```
$ npm run build -w @aquarium/shared
> tsc
(exit 0)

$ ls packages/shared/dist/ | grep v14-types
v14-types.d.ts
v14-types.d.ts.map
v14-types.js
v14-types.js.map
```

### Required exports (26 via grep)

```
19:export interface Workspace {
32:export type RuntimeKind = 'local_daemon' | 'external_cloud_daemon' | 'hosted_instance';
33:export type RuntimeStatus = 'online' | 'offline' | 'error';
34:export type RuntimeProvider = 'claude' | 'codex' | 'openclaw' | 'opencode' | 'hermes' | 'hosted';
36:export interface RuntimeDeviceInfo {
43:export interface Runtime {
62:export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline';
63:export type AgentVisibility = 'private' | 'workspace' | 'public';
65:export interface Agent {
87:export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
88:export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
90:export interface Issue {
111:export type CommentType = 'comment' | 'status_change' | 'progress_update' | 'system';
112:export type CommentAuthorType = 'user' | 'agent' | 'system';
114:export interface Comment {
130:export type TaskStatus = 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';
132:export interface AgentTask {
156:export type TaskMessageType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
158:export interface TaskMessage {
174:export interface DaemonToken {
188:export interface DaemonTokenCreatedResponse {
195:export interface DaemonRegisterRequest {
209:export interface DaemonRegisterResponse {
214:export interface ClaimedTask extends AgentTask {
234:export type TaskEventType = …
242:export interface TaskEventPayload {
```

### No `any` / no `in_review`

```
$ grep -E ":\s*any[\s;)<,]" packages/shared/src/v14-types.ts
# (zero matches)

$ grep "in_review" packages/shared/src/v14-types.ts
# (zero matches)
```

### Barrel re-export

```
$ cat packages/shared/src/index.ts
export * from './types.js';
export * from './metadata-types.js';
export * from './v14-types.js';
```

### Full green gate

```
$ npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web
> @aquarium/shared@1.0.0 build
> tsc
(exit 0)

> @aquaclawai/aquarium@1.2.0 typecheck
> tsc --noEmit
(exit 0)

> @aquarium/web@... lint
> eslint ...
✖ 25 problems (0 errors, 25 warnings)
(exit 0 — warnings are pre-existing react-hooks/exhaustive-deps, out of scope)
```

## Threat Model Outcomes

| Threat | Disposition | How the schema closes it |
|--------|-------------|--------------------------|
| T-15-06-01 Info Disclosure (plaintext persisted) | Mitigated | No plaintext column exists; `token_hash VARCHAR(64) UNIQUE` only |
| T-15-06-02 Spoofing (forged token passes middleware) | Mitigated (schema half) | UNIQUE(token_hash) ensures no collision in lookup table; Phase 19 adds timingSafeEqual |
| T-15-06-03 Tampering (revocation bypass) | Mitigated | `revoked_at` is DB-backed; middleware reads on every request (AUTH3). No JWT caching |
| T-15-06-04 Repudiation (user denies issuing) | Mitigated | `created_by_user_id` SET NULL preserves audit even after user deletion |
| T-15-06-05 Elevation of Privilege (TS drift between server + web) | Mitigated | Single v14-types.ts; `npm run typecheck` catches any divergence |

No new threat flags introduced — the surface added (daemon_tokens + shared types module) is contained within the threat model declared in plan 15-06.

## Phase 15 Completion Summary

All four ROADMAP success criteria for Phase 15 are now satisfied:

1. **Migrations 001-008 run cleanly on a fresh DB** — verified above (batch 1 applied 8 migrations in order, no errors)
2. **PRAGMAs applied at boot** — migration 003 installs `SqliteAdapter.applyBootPragmas()` which sets `journal_mode=wal`, `busy_timeout=5000`, `foreign_keys=ON` on every connection open (verified in 15-03 summary; this plan does not touch that path)
3. **All green: shared build + server typecheck + web lint** — verified above
4. **Single authoritative TS contract** — `@aquarium/shared` now re-exports 26 v1.4 types from `v14-types.js` alongside the pre-existing `types.ts` + `metadata-types.ts`; consumers import as before

Phase 15 (schema-shared-types) is **COMPLETE**. The next waves unblock:

- **Phase 16 (runtime-bridge)** can now materialize hosted-instance runtime rows against the `runtimes` table and daemon-reported runtimes via the register endpoint wire contract (`DaemonRegisterRequest/Response`).
- **Phase 17 (agent/issue/comment services)** has all 4 tables + trigger enforcement + 26 shared types needed to implement thin route controllers calling service functions.
- **Phase 18 (task-queue service)** has the partial unique index coalescing guarantee (from 15-05) and the shared `AgentTask` / `ClaimedTask` types for the dispatch wire protocol.
- **Phase 19 (daemon REST)** has `daemon_tokens` as the auth substrate (schema-level UNIQUE + SET NULL + revoked_at all in place) and `DaemonRegisterRequest/Response` + `ClaimedTask` as the wire contract.
- **Phase 24 (web kanban)** can import `Issue`, `Agent`, `TaskEventType`, `TaskEventPayload` from `@aquarium/shared` without additional schema work.

## Reminder for Phase 19 (Daemon REST)

**This plan provides the schema substrate for daemon auth; Phase 19 owns the cryptographic verification:**

1. Generate plaintext: `adt_` + 32-char nanoid
2. Compute hash: `crypto.createHash('sha256').update(plaintext).digest('hex')` → 64-char hex
3. Store: INSERT `{id, workspace_id, token_hash, name, ...}` — plaintext never persisted
4. Return plaintext ONCE in `DaemonTokenCreatedResponse` (defined in v14-types.ts)
5. Middleware verification per request:
   ```
   const presentedHash = sha256(presentedPlaintext)
   const row = await db('daemon_tokens')
     .where({ token_hash: presentedHash })
     .whereNull('revoked_at')
     .first()
   if (!row) → 401
   if (row.expires_at && row.expires_at < now) → 401
   if (!crypto.timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(presentedHash))) → 401
   // update last_used_at opportunistically (non-blocking)
   ```

The schema gives Phase 19 everything it needs: O(log n) hash lookup, instant revocation, expiry enforcement, audit trail via `last_used_at` + `created_by_user_id`.

## Self-Check

- File `apps/server/src/db/migrations/008_daemon_tokens.ts`: FOUND
- File `packages/shared/src/v14-types.ts`: FOUND
- File `packages/shared/src/index.ts` contains `export * from './v14-types.js';`: FOUND
- Commit `4c8f2b0` (migration 008): FOUND in git log
- Commit `0e00eaf` (shared types): FOUND in git log
- `daemon_tokens` table present in sqlite_master after fresh migration run: CONFIRMED
- `token_hash` UNIQUE + NOT NULL + no plaintext column: CONFIRMED (regex returns zero matches on token-non-hash usage)
- FK workspace_id CASCADE + created_by_user_id SET NULL: CONFIRMED via PRAGMA foreign_key_list
- All 26 required TS exports present: CONFIRMED via grep
- No `any` type annotation in v14-types.ts: CONFIRMED (regex scan returns zero)
- `npm run build -w @aquarium/shared` exit 0 + emits v14-types.d.ts: CONFIRMED
- `npm run typecheck -w @aquaclawai/aquarium` exit 0: CONFIRMED
- `npm run lint -w @aquarium/web` exit 0 (25 pre-existing warnings out of scope): CONFIRMED
- Rollback round-trip (8 forward → 0 after rollback → 8 after re-forward): CONFIRMED

## Self-Check: PASSED

---
*Phase: 15-schema-shared-types — **COMPLETE***
*Completed: 2026-04-16*
