---
phase: 18
slug: task-queue-dispatch
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Populated from `18-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (built-in, zero-dep; aligned with Phase 21 BACKEND-07) + Playwright (for any E2E) |
| **Config file** | none — `node --test` scans `apps/server/tests/**/*.test.ts` |
| **Quick run command** | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` |
| **Full suite command** | `npx tsx --test 'apps/server/tests/**/*.test.ts' && npx playwright test tests/e2e/runtimes.spec.ts tests/e2e/issues-agents-comments.spec.ts --list` |
| **Estimated runtime** | ~15 seconds unit + spec-list only |

---

## Sampling Rate

- **After every task commit:** Run the quick command for that task's file
- **After every plan wave:** Run the full unit suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

(Planner fills this in after reading 18-RESEARCH.md § Validation Architecture. Keep the format below.)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 0 | infra | — | Wave 0: install test harness + shared fixture | infra | `ls apps/server/tests/unit/test-db.ts` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | TASK-01 | SQ1/ST6 | `BEGIN IMMEDIATE`; 20-poller concurrency yields ≤ 1 `dispatched` per (issue_id, agent_id) | unit | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | TASK-02 | ST6 | Lifecycle transitions guarded by `.andWhere('status', <expected>)`; idempotent | unit | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-04 | 01 | 1 | TASK-06 | PM5 | completeTask on `cancelled` → `{ discarded: true }` HTTP 200 | unit | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 2 | TASK-03 | SQ2/SQ4 | 500ms batched flush; `MAX(seq)+1` in `BEGIN IMMEDIATE`; UNIQUE(task_id, seq) backstop | unit | `npx tsx --test apps/server/tests/unit/task-message-batcher.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 3 | TASK-04 | SQ5/T4 | Fake-clock reaper fails `dispatched > 5min` and `running > 2.5h` in one sweep tick | unit | `npx tsx --test apps/server/tests/unit/task-reaper.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 3 | infra | — | `startTaskReaper` / `stopTaskReaper` wired into `server-core.ts` Step 9c | integration | `grep -c "startTaskReaper" apps/server/src/server-core.ts` returns 1 | n/a | ⬜ pending |
| 18-04-01 | 04 | 4 | TASK-05 | — | Cancel propagation surface: `isTaskCancelled(taskId)` + `task:cancelled` WS broadcast | unit | `npx tsx --test apps/server/tests/unit/task-queue.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/tests/unit/test-db.ts` — shared fixture that opens a throwaway SQLite file, runs migrations, returns a Knex instance + cleanup
- [ ] `apps/server/tests/unit/task-queue.test.ts` — stub file with placeholder tests for TASK-01, TASK-02, TASK-06 (implemented in 18-01)
- [ ] `apps/server/tests/unit/task-message-batcher.test.ts` — stub file for TASK-03 (implemented in 18-02)
- [ ] `apps/server/tests/unit/task-reaper.test.ts` — stub file for TASK-04 (implemented in 18-03)
- [ ] Confirm `tsx` is already in `apps/server/package.json` devDependencies (`dev` script uses it — expected YES)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Observed claim latency under 20 concurrent pollers | SC-1 | Requires running process + real WAL I/O; unit test simulates via Promise.all but timing depends on host | Run `npx tsx apps/server/tests/load/claim-bench.ts` (optional; planner may defer to Phase 21) |
| Real daemon poll cycle seeing `cancelled` status | TASK-05 | Requires Phase 19 daemon | Deferred to Phase 19 E2E |
| Hosted worker `AbortController` propagation | TASK-05 | Requires Phase 20 hosted driver | Deferred to Phase 20 E2E |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
