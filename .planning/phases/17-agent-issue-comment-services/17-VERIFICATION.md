---
phase: 17-agent-issue-comment-services
verified: 2026-04-16T12:00:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (automated); 10/10 REQ-IDs implemented
re_verification: false
human_verification:
  - test: "Run 8-test Playwright suite end-to-end against a live server"
    expected: "8 passed (target ~15s); all invariant assertions pass (partial-unique GROUP BY, CASCADE COUNT, collapse-renumber gap >=500, status_change system comment content)"
    why_human: "Playwright requires a running server+DB; no headless execution available in verifier sandbox. The spec lists correctly via --list (8 tests confirmed) but runtime pass/fail requires a live server."
---

# Phase 17: Agent, Issue & Comment Services — Verification Report

**Phase Goal:** Users can create agents, issues, and comments through REST APIs, with issue status transitions automatically enqueueing/cancelling tasks so assignment acts as the primary trigger for agent work.
**Verified:** 2026-04-16T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST/DELETE agents with archive preserving FKs | VERIFIED | `agent-store.ts` archiveAgent uses `.whereNull('archived_at').update({archived_at, archived_by})`; no hard-delete. routes/agents.ts DELETE delegates to archiveAgent. |
| 2 | Assigning issue with status != 'backlog' enqueues exactly one queued task | VERIFIED | `applyIssueSideEffects` in issue-store.ts calls `enqueueTaskForIssue` inside the same `db.transaction`; task-queue-store checks idempotency via `getPendingTaskForIssueAgent` before inserting. |
| 3 | Reassigning cancels old + enqueues new, no duplicates | VERIFIED | `applyIssueSideEffects` reassignment branch: `cancelPendingTasksForIssueAgent(prev)` then `enqueueTaskForIssue(next)`, both passed the outer `trx`. Partial-unique index `idx_one_pending_task_per_issue_agent` is DB backstop. |
| 4 | status='cancelled' cancels all tasks in one transaction | VERIFIED | `applyIssueSideEffects` cancelled branch calls `cancelAllTasksForIssue({...issueId, trx})` which UPDATEs status IN ('queued','dispatched','running') in the same transaction. |
| 5 | Comment with triggerCommentId enqueues task; status transitions emit system comments | VERIFIED | `createUserComment` calls `enqueueTaskForIssue` with `triggerCommentId: id` (new comment's id) inside its transaction. `applyIssueSideEffects` calls `createSystemComment` for every status change and every assignee change before task-queue ops. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/agent-store.ts` | Agent CRUD + archive/restore + toAgent | VERIFIED | 212 lines; exports createAgent, updateAgent, archiveAgent, restoreAgent, getAgent, listAgents + 3 interfaces. 9 `^export` lines. validateMct/validateVisibility/assertRuntimeExists present. |
| `apps/server/src/routes/agents.ts` | POST/PATCH/DELETE/:id/restore/GET/GET:id | VERIFIED | 150 lines; all 6 routes present; `router.use(requireAuth)` on line 16; 17 `satisfies ApiResponse` occurrences; 0 direct `db(` calls. |
| `apps/server/src/services/issue-store.ts` | Issue CRUD + reorder + side-effects | VERIFIED | 477 lines; exports 7 functions + 4 interfaces; `increment('issue_counter'` in 1 place; 7 `db.transaction` calls; COLLAPSE_EPSILON/1e-6 in 3 places; renumberWorkspacePositions defined+called. applyIssueSideEffects defined + called (2 occurrences). |
| `apps/server/src/routes/issues.ts` | GET/POST/PATCH/DELETE/reorder + broadcast | VERIFIED | 196 lines; all 6 routes present; requireAuth on line 19; broadcast imported+used for all 4 mutations; 0 direct `db(` calls; isValidationError helper present. |
| `apps/server/src/services/task-queue-store.ts` | enqueue/cancel helpers + trx param | VERIFIED | 226 lines; 4 exports (enqueueTaskForIssue, cancelPendingTasksForIssueAgent, cancelAllTasksForIssue, getPendingTaskForIssueAgent); all accept optional trx; idempotency check present; soft-fail on null runtime_id; 0 any types. |
| `apps/server/src/services/comment-store.ts` | User/system comment + trigger enqueue | VERIFIED | 276 lines; 11 exports; createUserComment + createSystemComment + updateComment + deleteComment + getComment + listCommentsForIssue; author XOR enforced (author_type:'user' + author_user_id=authorUserId; author_type:'system' + both nulls); enqueueTaskForIssue imported and called. |
| `apps/server/src/routes/comments.ts` | Nested + top-level comment routers | VERIFIED | 208 lines; issueCommentRouter (GET+POST, mergeParams:true, requireAuth) + commentRouter (GET+PATCH+DELETE, requireAuth); broadcast for comment:posted/updated/deleted; 0 direct `db(` calls. |
| `apps/server/src/server-core.ts` | All 3 new routes mounted | VERIFIED | Lines 156-159: `app.use('/api/agents', agentRoutes)`, `app.use('/api/issues', issueRoutes)`, `app.use('/api/issues/:issueId/comments', issueCommentRouter)`, `app.use('/api/comments', commentRoutes)`. |
| `tests/e2e/issues-agents-comments.spec.ts` | 8-test Playwright spec | VERIFIED | File present; `npx playwright test --list` outputs 8 tests in `test.describe.serial('Phase 17 — Agents + Issues + Comments')`; `better-sqlite3` imported; `GROUP BY issue_id, agent_id HAVING n > 1` present (partial-unique proof); all 10 REQ-IDs tagged in test names. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| routes/agents.ts | services/agent-store.ts | `import ... from '../services/agent-store.js'` | WIRED | Confirmed line 2-12 of agents.ts |
| routes/issues.ts | services/issue-store.ts | `import ... from '../services/issue-store.js'` | WIRED | Confirmed line 2-14 of issues.ts |
| routes/comments.ts | services/comment-store.ts | `import ... from '../services/comment-store.js'` | WIRED | Confirmed line 2-11 of comments.ts |
| issue-store.ts | task-queue-store.ts | `import { enqueueTaskForIssue, cancelPendingTasksForIssueAgent, cancelAllTasksForIssue } from './task-queue-store.js'` | WIRED | Lines 4-8 of issue-store.ts |
| issue-store.ts | comment-store.ts | `import { createSystemComment } from './comment-store.js'` | WIRED | Line 9 of issue-store.ts |
| comment-store.ts | task-queue-store.ts | `import { enqueueTaskForIssue } from './task-queue-store.js'` | WIRED | Line 4 of comment-store.ts |
| applyIssueSideEffects | db.transaction (same trx) | `trx` parameter threaded through cancelAll/cancelPending/enqueue/createSystemComment | WIRED | Confirmed in issue-store.ts lines 192-263; all helpers receive the outer `trx` |
| server-core.ts | routes/agents.ts | `import agentRoutes from './routes/agents.js'` + `app.use('/api/agents', agentRoutes)` | WIRED | Lines 55, 156 of server-core.ts |
| server-core.ts | routes/issues.ts | `import issueRoutes from './routes/issues.js'` + `app.use('/api/issues', issueRoutes)` | WIRED | Lines 56, 157 of server-core.ts |
| server-core.ts | routes/comments.ts | `import commentRoutes, { issueCommentRouter } from './routes/comments.js'` + 2 mounts | WIRED | Lines 57, 158-159 of server-core.ts |

---

### Data-Flow Trace (Level 4)

Not applicable for this phase — all service files are pure DB-write/read services with no static data or disconnected props. Every route delegates to a service function that performs a real Knex query against the DB. No hollow props or static returns found.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Shared package builds | `npm run build -w @aquarium/shared` | exit 0 (no output beyond tsc invocation) | PASS |
| E2E spec lists 8 tests | `npx playwright test --list` | "8 tests in 1 file" with correct describe.serial block | PASS |
| No `any` types in service files | `grep -cE ": any" services/*.ts` | 0 matches across all 4 service files | PASS |
| No direct DB calls in route files | `grep -c "db(" routes/{agents,issues,comments}.ts` | 0 in all 3 files | PASS |
| requireAuth on all routers | grep on all 3 route files | agents.ts:1, issues.ts:1, comments.ts: issueCommentRouter.use+commentRouter.use (2) | PASS |
| Full typecheck | `npm run typecheck -w @aquaclawai/aquarium` | Not run (would require server dep install in verifier) | SKIP |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AGENT-01 | 17-01 | Create/update/archive/restore agents with instructions/env/args/runtime | SATISFIED | createAgent, updateAgent, archiveAgent, restoreAgent in agent-store.ts; all 5 HTTP verbs in routes/agents.ts |
| AGENT-02 | 17-01 | max_concurrent_tasks 1-16 enforced at API boundary | SATISFIED | validateMct() called before INSERT/UPDATE; maps to 400 via isValidation regex in route |
| ISSUE-01 | 17-02 | Create/update/delete issues with title/description/priority/status/assignee | SATISFIED | createIssue (atomic issue_number), updateIssue, deleteIssue, getIssue, listIssues in issue-store.ts |
| ISSUE-02 | 17-03 | Assign issue with status != backlog auto-enqueues task | SATISFIED | applyIssueSideEffects: reassignment branch + leaving-backlog branch call enqueueTaskForIssue inside db.transaction |
| ISSUE-03 | 17-03 | Reassign cancels old pending task, enqueues new one atomically | SATISFIED | applyIssueSideEffects reassignment: cancelPendingTasksForIssueAgent(prev) then enqueueTaskForIssue(next), both sharing outer trx |
| ISSUE-04 | 17-03 | status=cancelled cancels all queued/dispatched/running tasks | SATISFIED | applyIssueSideEffects: `if (next.status === 'cancelled' && prev.status !== 'cancelled') { await cancelAllTasksForIssue(...) }` |
| ISSUE-05 | 17-02 | Kanban reorder via fractional position with collapse renumber | SATISFIED | reorderIssue: collapse detection (COLLAPSE_EPSILON 1e-6), renumberWorkspacePositions (step=1000), computeMidpoint |
| COMMENT-01 | 17-04 | Post comment; triggerCommentId enqueues task for issue assignee | SATISFIED | createUserComment: if triggerCommentId && issue.assignee_id → enqueueTaskForIssue({triggerCommentId: id}) inside same trx |
| COMMENT-02 | 17-04 | Status transitions emit system comments in issue timeline | SATISFIED | applyIssueSideEffects: createSystemComment for every status change AND every assignee change, inside issue UPDATE transaction |
| COMMENT-03 | 17-04 | Threaded comments via parent_id | SATISFIED | createUserComment validates parentId same-issue membership; routes POST body forwards parentId; schema SET NULL preserves children |

All 10 required REQ-IDs are implemented. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| routes/agents.ts | 19 | `// TODO(EE): swap for req.auth.workspaceId` | Info | Intentional CE placeholder — EE upgrade path documented. Not a stub; CE single-workspace is the correct v1.4 design. |
| routes/issues.ts | 22-23 | Same EE TODO comment | Info | Same as above. |
| routes/comments.ts | 15-16 | Same EE TODO comment | Info | Same as above. |

No blockers or warnings. No `return null` / `return {}` / `return []` stubs. No `console.log`-only implementations. No placeholder content strings. The `console.warn` calls in task-queue-store.ts for null runtime_id are intentional soft-fails per the plan spec (not stubs).

---

### CE Pattern Compliance

**CE1 (thin controllers — no direct DB in route files):** PASS — 0 `db(` calls in agents.ts, issues.ts, comments.ts.

**CE4 (transaction compliance):** PASS — All multi-row side-effects share one `db.transaction()`:
  - `createIssue`: counter-bump + INSERT inside one trx
  - `updateIssue`: field UPDATE + applyIssueSideEffects (cancel/enqueue/system-comment) in one trx
  - `reorderIssue`: position read + optional renumber + write in one trx
  - `createUserComment`: comment INSERT + optional enqueueTaskForIssue in one trx
  - `enqueueTaskForIssue`: agent read + pending check + INSERT in one trx (or caller's trx)

**CLAUDE.md compliance:**
  - `.js` extensions: all local imports in all 4 service files and 3 route files use `.js` ✓
  - `ApiResponse<T>` with `satisfies`: agents.ts 17 occurrences, issues.ts 17, comments.ts 16 ✓
  - No `any` types: 0 matches across all 7 new files ✓
  - Shared types from `@aquarium/shared`: Agent/Issue/Comment/AgentTask/TaskStatus imported from `@aquarium/shared` in all services ✓

**Security (IDOR mitigation):** All service queries include `workspace_id` in the WHERE clause. Cross-workspace references rejected (assertRuntimeExists, issue FK check in createUserComment, listCommentsForIssue issue workspace gate).

---

### Human Verification Required

#### 1. Playwright E2E Suite

**Test:** With server running on port 3001 and a clean DB, run:
```
npx playwright test tests/e2e/issues-agents-comments.spec.ts --reporter=line
```
**Expected:** `8 passed (~15s)` — all invariant assertions pass:
- Partial-unique GROUP BY returns empty array after reassignment
- CASCADE SELECT COUNT returns 0 after issue delete with comments
- Collapse-renumber gap assertion `gaps.every(g => g >= 500)` passes after 1.0/1.0000005 position injection
- System comment `author_type='system'` and `content` includes 'backlog'+'todo'
- `triggerCommentId` on task row equals the newly-created comment id (not the anchor)

**Why human:** Playwright requires a running server+SQLite DB. The spec lists correctly (8 tests, serial describe block confirmed), but runtime pass/fail cannot be asserted without a live process.

---

### Gaps Summary

No gaps found. All 5 ROADMAP success criteria are verified in the codebase. All 10 required REQ-IDs are implemented with substantive, wired, data-flowing code. One human verification item remains: running the 8-test Playwright suite against a live server to confirm behavioral correctness end-to-end.

---

_Verified: 2026-04-16T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
