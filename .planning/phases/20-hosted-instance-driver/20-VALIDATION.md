---
phase: 20
slug: hosted-instance-driver
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 20 — Validation Strategy

> Per-phase validation contract. Sourced from `20-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (unit) via `tsx` + Playwright (optional E2E) |
| **Config file** | none for `node --test`; `playwright.config.ts` at root |
| **Quick run command** | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` |
| **Full suite command** | `npx tsx --test 'apps/server/tests/unit/*.test.ts'` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command for that task's file
- **After every plan wave:** Run the full unit suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | infra (gateway stream hook) | — | `onChatStream` multi-shot listener added to gateway-event-relay | unit | `npx tsx --test apps/server/tests/unit/gateway-event-relay-stream.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-01 | 02 | 2 | HOSTED-01 | — | 2s tick; per-runtime claim loop | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-02 | 02 | 2 | HOSTED-02, HOSTED-03 | PM6 | `gatewayCall('chat.send')`; content-part → task_message row with correct type | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-03 | 02 | 2 | HOSTED-05 | X6 | WARN log cites ignored fields (custom_env/args/session_id/work_dir) | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-04 | 02 | 2 | HOSTED-06 | X5 | Gateway disconnected → worker tick returns early (no claim, task stays queued) | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-05 | 02 | 2 | ST5 | ST5 | Hosted dispatch never writes `instances.status` (DB snapshot pre/post) | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-06 | 02 | 2 | cancel (uses TASK-05) | PM6 | `chat.abort` invoked when `isTaskCancelled` flips mid-stream | unit | `npx tsx --test apps/server/tests/unit/hosted-task-worker.test.ts` | ❌ W0 | ⬜ pending |
| 20-03-01 | 03 | 3 | HOSTED-04 | — | Boot-time orphan sweep fails all `hosted_instance` tasks in `dispatched`/`running` with reason `'hosted-orphan-on-boot'` | unit | `npx tsx --test apps/server/tests/unit/hosted-orphan-sweep.test.ts` | ❌ W0 | ⬜ pending |
| 20-03-02 | 03 | 3 | infra | — | `server-core.ts` Step 9b (orphan sweep) before Step 9c (reaper) before Step 9d (hosted worker) | integration | `grep -c "failOrphanedHostedTasks\|startHostedTaskWorker" apps/server/src/server-core.ts` returns >= 2 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/tests/unit/gateway-event-relay-stream.test.ts` — stub (implemented in 20-01)
- [ ] `apps/server/tests/unit/hosted-task-worker.test.ts` — stub (implemented in 20-02)
- [ ] `apps/server/tests/unit/hosted-orphan-sweep.test.ts` — stub (implemented in 20-03)

Reuse `apps/server/tests/unit/test-db.ts` from Phase 18 (seed helpers: agents, runtimes, tasks). Add a `mockGateway()` helper to the worker's test file (inline; no shared fixture needed).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC-2 live: gateway disconnect → task queued → reconnect → dispatch within 2s | HOSTED-06 | Requires running gateway + real disconnect | Run `npm run dev`, assign issue to hosted-runtime agent, stop Docker container, wait, restart, observe dispatch |
| SC-3 live: server kill mid-task → boot orphan sweep | HOSTED-04 | Requires real process lifecycle | Start task, `kill -9` server, restart, verify task status flipped to failed with `hosted-orphan-on-boot` reason |
| Full Playwright E2E (if shipped) | all HOSTED-* | Requires running server + gateway | Deferred to Phase 26 REL-01 if not shipped in 20-04 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
