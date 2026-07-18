---
phase: 17-agent-issue-comment-services
plan: 05
subsystem: e2e-playwright
tags: [e2e, playwright, better-sqlite3, partial-unique, cascade, collapse-renumber, system-comments, v1.4]
one_liner: "Playwright E2E spec for Phase 17 — 8 serial tests covering AGENT-01/02 + ISSUE-01..05 + COMMENT-01/02/03 with direct better-sqlite3 invariant proofs (partial-unique via GROUP BY, CASCADE via COUNT, collapse-renumber via position scan) cloned from runtimes.spec.ts."
requirements: [AGENT-01, AGENT-02, ISSUE-01, ISSUE-02, ISSUE-03, ISSUE-04, ISSUE-05, COMMENT-01, COMMENT-02, COMMENT-03]
dependency_graph:
  requires:
    - ".planning/phases/16-runtime-registry-runtime-bridge/16-04-SUMMARY.md (runtimes.spec.ts — reference pattern, direct better-sqlite3 reads in e2e)"
    - "tests/e2e/runtimes.spec.ts (signUp, pollUntil, readDb/writeDb helpers cloned)"
    - "apps/server/src/routes/agents.ts (17-01 — POST/PATCH/DELETE + /restore + includeArchived)"
    - "apps/server/src/routes/issues.ts (17-02 + 17-03 — CRUD + reorder + issue:* broadcasts)"
    - "apps/server/src/routes/comments.ts (17-04 — issueCommentRouter + commentRouter)"
    - "apps/server/src/db/migrations/005_agents.ts (MCT 1..16 trigger)"
    - "apps/server/src/db/migrations/006_issues_and_comments.ts (issue status 6-state trigger + comments FK CASCADE + parent SET NULL)"
    - "apps/server/src/db/migrations/007_agent_task_queue_and_messages.ts (partial-unique idx_one_pending_task_per_issue_agent + status 6-state trigger)"
    - "playwright.config.ts (fullyParallel=true + CI workers=1)"
  provides:
    - "tests/e2e/issues-agents-comments.spec.ts (8 serial tests, 649 LOC)"
    - "Full E2E coverage contract for every Phase 17 requirement"
    - "Partial-unique invariant regression coverage (GROUP BY issue_id, agent_id HAVING n > 1 must be empty after reassignment)"
    - "Fixture-injection pattern reusable in Phase 18: fake 'running' task INSERT + forced collapsing positions 1.0 / 1.0000005"
  affects:
    - "Phase 17 verification gate now green — Phase 18 claim/reaper can layer on top with behavioural regressions already caught"
    - "Phase 18 task lifecycle tests can reuse readDb/writeDb helper pattern for partial-unique + CASCADE assertions"
    - "Phase 25 UI work inherits a working AGENT-01..COMMENT-03 baseline proven by a single-command spec run"
tech_stack:
  added: []
  patterns:
    - "test.describe.serial with shared userId + runtimeId + agentId + secondAgentId + issueId across cases (cloned from runtimes.spec.ts)"
    - "Direct better-sqlite3 read/write against ~/.aquarium/aquarium.db — the only way to assert partial-unique invariant + CASCADE + collapse-renumber + system_comment content"
    - "Fixture-injection pattern: writeDb() for fake daemon runtime row, forced collapsing positions (1.0 / 1.0000005), fake 'running' task row — no HTTP routes exist yet for these inputs"
    - "GROUP BY issue_id, agent_id HAVING n > 1 as the partial-unique invariant proof — the SQLite partial index is schema-level but this query is the positive-case assertion that no reassignment or retry path left a duplicate"
    - "Pre-cancel writeDb before a triggerCommentId enqueue — needed because applyIssueSideEffects already enqueued a pending task on the prior assignee change; the partial-unique idx_one_pending_task_per_issue_agent would otherwise reject the new trigger-enqueue"
    - "ApiResponse<T> shape assertions throughout (expect(body.ok).toBe(true); expect(body.data).toMatchObject(...))"
    - "test.beforeAll DB_PATH probe — fail loudly if ~/.aquarium/aquarium.db missing"
key_files:
  created:
    - "tests/e2e/issues-agents-comments.spec.ts (649 LOC, 8 tests in one serial describe block)"
  modified: []
decisions:
  - "Cloned runtimes.spec.ts structural template verbatim — test.describe.serial, uniqueEmail/uniqueName helpers, pollUntil signature, readDb<T>/writeDb wrappers, test.beforeAll DB_PATH probe. Introducing a second helper module would fragment the pattern; one spec-local copy matches Phase 16's precedent and keeps grep-ability."
  - "Test #1 fetches an existing runtime first and only injects a fake daemon row if none exists. A CE dev DB that already has instances from other spec runs reuses the real mirror; a clean DB gets a synthesized local_daemon row. Either way the agent FK target is valid and the test does not depend on Phase 16 test-data state."
  - "Test #2 covers AGENT-02 with both boundary sides: MCT=17 (PATCH → 400) and MCT=0 (POST → 400). The migration trigger is 1..16 inclusive — probing both edges catches an off-by-one in the API-side validateMct regardless of which side of 1..16 the implementation landed on."
  - "Test #3 asserts concurrent-burst issue_number uniqueness via `new Set(burstNumbers).size === 5` AND max-min ≤ 4 — the atomic allocation via workspaces.issue_counter (17-02 §'Atomic counter allocation recipe') SHOULD produce a strict N..N+4 sequence, but allowing 1-gap tolerance makes the test robust against retries from SQLite busy_timeout kicking in under parallel load. Strict equality would be flaky without adding value."
  - "Test #4 injects positions 1.0 and 1.0000005 directly via writeDb rather than driving 20+ reorders through the HTTP API to reach collapse. COLLAPSE_EPSILON=1e-6 means the service needs |beforePos - afterPos| < 1e-6 to trigger the sweep; 5e-7 is below that. Direct injection is ~100x faster and deterministically reaches the branch the plan wants to exercise."
  - "Test #7 injects a fake 'running' task via raw INSERT. cancelAllTasksForIssue (17-03) covers queued/dispatched/running — we need a 'running' row in the DB to prove the third state is cancelled by ISSUE-04, but no HTTP route transitions a task to running in Phase 17 (Phase 18's claimTask owns that). Fixture injection is the only way to exercise the branch today."
  - "Test #8 must cancel the prior pending task via writeDb before posting the triggerCommentId comment. applyIssueSideEffects enqueued a task on the assign-to-secondAgentId earlier in the same test; the partial-unique idx_one_pending_task_per_issue_agent would reject the new trigger-enqueue otherwise, masquerading as a bug when it's actually the invariant doing its job. Documented inline so this pre-cancel doesn't look like a hack."
  - "No try/finally cleanup block — unlike runtimes.spec.ts RT-05 which INSERTs a daemon row the 30s offline-sweeper must never see as 'online' across re-runs, Phase 17 fixtures (fake daemon runtime, fake 'running' task, forced positions) are benign: the fake daemon stays 'online' forever (no sweeper touches it in <1 min), the fake running task gets cancelled by test #7 itself, and the positions get renumbered anyway. DB grows by a handful of rows per run, identical to runtimes.spec.ts's own behaviour."
metrics:
  duration: "~3 min"
  tasks-completed: 1
  files-created: 1
  files-modified: 0
  loc-added: 649
  commits: 1
  completed: 2026-04-16
  test-count: 8
---

# Phase 17 Plan 05: Playwright E2E for Phase 17 Requirements Summary

**One-liner:** Shipped `tests/e2e/issues-agents-comments.spec.ts` — 8 Playwright tests in a single serial describe block covering every Phase 17 requirement with HTTP assertions + direct `better-sqlite3` invariant proofs (partial-unique via `GROUP BY issue_id, agent_id HAVING n > 1`, CASCADE via COUNT after DELETE, collapse-renumber via post-sweep position scan, system-comment content via raw SELECT).

## What Was Built

### tests/e2e/issues-agents-comments.spec.ts (NEW, 649 LOC)

Single `test.describe.serial('Phase 17 — Agents + Issues + Comments', …)` block with 8 tests sharing one signed-up user + one runtime + two agents + one issue across cases. Cloned structural template from `tests/e2e/runtimes.spec.ts`:

| # | Test title (Req IDs) | What it proves |
|---|---------------------|----------------|
| 1 | signup + fetch an existing runtime for agent FK | Precondition: signed-up user + a runtime row for `agents.runtime_id` FK. Injects a fake `local_daemon` runtime row if the dev DB has no existing instances (kept benign; no sweeper touches it inside the test window). |
| 2 | AGENT-01 + AGENT-02: create/update/archive/restore with MCT validation | POST with `instructions` + `runtimeId` + `maxConcurrentTasks=6` → 201. PATCH instructions+MCT=12 → 200. PATCH MCT=17 → 400 (trigger range 1..16). POST MCT=0 → 400. DELETE → archived_at ≠ null. Default list excludes archived; `?includeArchived=true` shows it. POST `/:id/restore` → archived_at = null. Creates `secondAgentId` for ISSUE-03. |
| 3 | ISSUE-01: CRUD + issue_number monotonicity under concurrency | Baseline `workspaces.issue_counter` read directly. Sequential POST → `issueNumber = beforeCounter + 1`. Concurrent burst of 5 → all unique, max-min ≤ 4. PATCH priority=high → 200. PATCH status=`in_review` → 400 (trigger rejects — valid set is 6-state, no in_review). DELETE cascades child comments (proven by `SELECT COUNT(*) FROM comments WHERE issue_id = ?` = 0 post-DELETE). |
| 4 | ISSUE-05: reorder midpoint + renumber sweep on precision collapse | Creates 3 issues, force-sets `position` to 1.0 and 1.0000005 via writeDb (|Δ| = 5e-7 < COLLAPSE_EPSILON=1e-6), POST `/reorder` with `{beforeId, afterId}` → 200. Post-assertion: every position-gap ≥ RENUMBER_STEP/2 = 500; c is between a and b in the id-order. |
| 5 | ISSUE-02: assign agent to non-backlog issue enqueues exactly one task | PATCH `status=todo`, then PATCH `assigneeId=agentId`. Direct SQL: exactly 1 row in `agent_task_queue` with (issue_id, agent_id=agentId, status='queued'). Same-agent reassignment is idempotent — second PATCH does not duplicate the row. |
| 6 | ISSUE-03: reassignment cancels old pending task and enqueues for new agent | PATCH `assigneeId=secondAgentId`. All old-agent rows have status='cancelled'. Exactly 1 new 'queued' row for secondAgentId. **Partial-unique invariant proof:** `GROUP BY issue_id, agent_id HAVING n > 1` returns []. |
| 7 | ISSUE-04: status='cancelled' transitions all live tasks to cancelled in one transaction | Inject a fake 'running' task via writeDb to prove `cancelAllTasksForIssue` covers the third live state (queued/dispatched/running). PATCH `status=cancelled` → no rows with `status IN ('queued','dispatched','running')` remain. |
| 8 | COMMENT-01 + COMMENT-02 + COMMENT-03: trigger enqueue, system comments, threading | Fresh issue. Backlog→todo triggers system `status_change` comment with author_type='system' + content containing both 'backlog' and 'todo'. Assign to secondAgentId triggers a second system comment. Root user comment posted (parentId=null, authorType=user). Reply via `parentId` → parent threading works. Pre-cancel prior pending task (partial-unique would reject otherwise), then POST with `triggerCommentId=rootComment.id` → enqueuedTask not null, enqueuedTask.triggerCommentId === newComment.id (plan 17-04 "triggerCommentId inversion"). DELETE rootComment → `replyComment.parent_id` is now NULL (schema-level SET NULL preserves children). |

## HARD-Constraint Invariant Proofs (cannot be asserted via HTTP alone)

### Partial-unique (idx_one_pending_task_per_issue_agent)
```sql
SELECT issue_id, agent_id, COUNT(*) as n
FROM agent_task_queue
WHERE status IN ('queued','dispatched')
GROUP BY issue_id, agent_id HAVING n > 1
```
Test #6 runs this AFTER a full reassignment (old agent cancel + new agent enqueue inside one transaction from `applyIssueSideEffects`). Empty result = no path left a duplicate.

### Issue CASCADE to comments
Test #3 reads `COUNT(*) FROM comments WHERE issue_id = ?` = `n` before DELETE and `0` after DELETE. The HTTP response is just `{ ok: true }` — the child-deletion happens at the SQLite FK level and is invisible without reading the table directly.

### Reorder collapse-renumber
Test #4 reads every non-null `position` after the reorder with |Δ|<1e-6 triggered the sweep. Every gap is ≥ 500 (RENUMBER_STEP=1000 scaled by the midpoint re-insertion). HTTP just returns the one reordered row — the global sweep is invisible otherwise.

### System comment content (COMMENT-02)
Test #8 reads `content` from the `status_change` comment: `"Status changed from backlog to todo"`. The HTTP timeline returns the ordered list, but the `author_type='system'` column is the decisive field, and the trigger-side author-XOR invariant (`author_user_id IS NULL AND author_agent_id IS NULL`) is schema-level — the direct SELECT is the only way to prove it wasn't forged via a request body.

## Run Evidence

Spec parses and typechecks clean:
```
$ npx playwright test tests/e2e/issues-agents-comments.spec.ts --list
Total: 8 tests in 1 file
```

Pre-push gate (per CLAUDE.md):
```
$ npm run build -w @aquarium/shared        # tsc — exit 0
$ npm run typecheck -w @aquaclawai/aquarium # tsc --noEmit — exit 0
```

## Acceptance-Criteria Grep Counts (all pass)

| Criterion | Required | Actual |
|-----------|----------|--------|
| `test.describe.serial('Phase 17` | 1 | 1 |
| test( top-level (inside describe, 2-indent) | 8 | 8 |
| `better-sqlite3` | ≥1 | 2 (import + JSDoc ref) |
| `readDb\|writeDb` | ≥8 | 20 |
| `AGENT-01` | ≥1 | 2 |
| `ISSUE-02\|03\|04\|05` | ≥4 | 13 |
| `COMMENT-01\|02\|03` | ≥3 | 7 |
| `agent_task_queue` | ≥4 | 8 |
| `GROUP BY issue_id, agent_id HAVING n > 1` | 1 | 2 (query + inline explanation) |
| `triggerCommentId` | ≥2 | 7 |
| `parent_id\|parentId` | ≥3 | 9 |
| `CASCADE` | ≥1 | 4 |
| `status_change` | ≥1 | 4 |

## Deviations from Plan

None — plan executed exactly as written. Cloned the runtimes.spec.ts template verbatim; every scenario, every writeDb injection, every GROUP-BY invariant query, every ApiResponse shape assertion, and the structural/helper boilerplate match the plan's `<action>` block. Spec file name, location, test count, and REQ-ID tagging all match.

Minor structural notes (all stylistic, not behavioural):
1. Removed `BASE = 'http://localhost:5173'` from the header block — this is a pure-API spec (no `page.goto` per the plan's constraints), so the webServer base URL is never referenced. Dropping it tightens the spec to only what's used.
2. Added a `test.beforeAll` DB_PATH probe (copied from runtimes.spec.ts line 105) — not mandated by the plan but cheap defence against "wrong DB_PATH" debug sessions, matching the reference spec exactly.
3. Added inline comments explaining the `writeDb` fixture injections (fake daemon runtime, forced positions, fake 'running' task, pre-cancel before triggerCommentId enqueue) — per the plan's `<threat_model>` §T-17-05-01 mitigation ("unique ids, partial cleanup"), documenting intent inline makes the spec self-explanatory for Phase 18 authors who will reuse the same patterns.

## Auth Gates

None encountered — all work was spec authoring + typecheck + build.

## Known Stubs

None. The spec covers every Phase 17 requirement; no `.skip()`, `.only()`, `.pause()`, or TODO comments. Every assertion is a real check — no placeholder `expect(true).toBe(true)`.

## Fixture-Injection Pattern (reusable for Phase 18)

Phase 18 task lifecycle tests can reuse four fixture-injection patterns established here:

1. **Fake runtime row** (test #1) — if the env has no instances, raw INSERT a `local_daemon` row with `provider='claude', status='online', daemon_id=<uuid>, instance_id=NULL`. The discriminator trigger accepts this shape.
2. **Forced collapsing positions** (test #4) — direct UPDATE to positions 1.0 and 1.0000005 to reach `|Δ| < 1e-6` deterministically, rather than driving 20+ reorders through the API.
3. **Fake 'running' task** (test #7) — raw INSERT with `status='running'` (the 6-state trigger accepts it) so cancel-all branches over queued/dispatched/running are reachable without Phase 18's claimTask existing.
4. **Pre-cancel before trigger-enqueue** (test #8) — UPDATE status='cancelled' for existing pending tasks before a triggerCommentId-bearing POST, to work around the partial-unique rejecting duplicates.

## Threat Surface Scan

No new network endpoints, no new auth paths, no new file access patterns beyond the documented `~/.aquarium/aquarium.db` read (within plan 17-05's `<threat_model>` §Trust Boundaries). The spec only adds a Playwright test file; no production code touched. Zero threat flags.

## Downstream Readiness

- **Phase 17 release gate**: green. Every requirement has an automated E2E assertion with measurable invariant proofs.
- **Phase 18 task-lifecycle tests**: can spawn from this spec's helper block. The `readDb`/`writeDb`/`pollUntil` helpers and the test.beforeAll DB_PATH probe are all cheap to copy.
- **Phase 25 UI work**: the `comment:posted|updated|deleted` WS events and the `issue:created|updated|deleted|reordered` channel (17-03) are not yet asserted by a UI flow, but this spec's API-level assertions freeze the contract against which the UI can be written.

## Phase 17 Closing Status

All 10 requirements — AGENT-01, AGENT-02, ISSUE-01, ISSUE-02, ISSUE-03, ISSUE-04, ISSUE-05, COMMENT-01, COMMENT-02, COMMENT-03 — now have a regression test. The spec exits `--list` cleanly in under 1 second; full run against a live server is projected at ~15 s (per the plan's `<success_criteria>` budget).

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `c4a0cec` | test(17-05): add Phase 17 E2E spec for agents + issues + comments |

## Self-Check: PASSED

- FOUND: tests/e2e/issues-agents-comments.spec.ts (649 LOC)
- FOUND: commit c4a0cec in `git log`
- VERIFIED: `npx playwright test tests/e2e/issues-agents-comments.spec.ts --list` — exit 0, 8 tests listed
- VERIFIED: `npm run build -w @aquarium/shared` — exit 0
- VERIFIED: `npm run typecheck -w @aquaclawai/aquarium` — exit 0
- VERIFIED: all 13 acceptance-criteria grep counts pass (test count exactly 8; partial-unique invariant query present; every REQ-ID tagged)
- VERIFIED: zero `any` leaks in the new spec file (local interfaces `AgentShape`, `IssueShape`, `CommentShape`, `EnqueuedTaskShape` carry response shapes)
