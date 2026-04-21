---
phase: 16
slug: runtime-registry-runtime-bridge
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-16
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (existing — per CLAUDE.md; no unit framework in CE) |
| **Config file** | `playwright.config.ts` (repo root) |
| **Quick run command** | `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~45-60 s (dominated by 30-45 s offline-sweeper RT-05 wait) |

**Per-task fast gates (not Playwright):**
- Typecheck: `npm run typecheck -w @aquaclawai/aquarium` — ~4 s
- Lint: `npm run lint -w @aquarium/web` — ~3 s
- ST1/ST4 grep assertions: inline node scripts — <1 s each
- Migration run on fresh DB: `npm run migrate` — ~2 s

---

## Sampling Rate

- **After every task commit:** Run relevant fast grep + typecheck (~5 s). Playwright test suite only at wave boundaries.
- **After every plan wave:** Run `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` — ~45 s.
- **Before phase verification:** Full `npx playwright test` + `npm run typecheck` + `npm run lint` — ~3 min.
- **Max feedback latency (per-task):** ~5 s (typecheck + grep only; Playwright deferred to wave boundary).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | RT-04 (foundation) | T-16-01 (status-drift mitigation) | Migration 009 adds partial UNIQUE on `runtimes.instance_id WHERE instance_id IS NOT NULL`; enforced by SQLite | integration (sqlite3) | `npm run migrate -w @aquaclawai/aquarium && sqlite3 /tmp/aq-verify.db "SELECT sql FROM sqlite_master WHERE name='idx_runtimes_instance_unique'"` | ❌ W0 (runtimes.spec.ts Phase 16) | ⬜ pending |
| 16-01-02 | 01 | 1 | RT-01, RT-04 | T-16-02 (derived status via JOIN) | `listAll()` uses LEFT JOIN + CASE WHEN; grep asserts `upsertHostedRuntime` merge excludes `status` | grep + typecheck | `grep -E "listAll|CASE WHEN r.kind" apps/server/src/services/runtime-registry.ts && npm run typecheck -w @aquaclawai/aquarium` | N/A (source grep) | ⬜ pending |
| 16-02-01 | 02 | 2 | RT-02, RT-03 | T-16-03 (bridge read-only to instances) | `runtime-bridge.ts` has zero `db('instances').(update\|insert\|delete)` calls | grep | `grep -cE "db\('instances'\)\.(update\|insert\|delete)" apps/server/src/task-dispatch/runtime-bridge.ts` (must be 0) | N/A | ⬜ pending |
| 16-02-02 | 02 | 2 | RT-02, RT-03 | T-16-04 (instance-manager doesn't write runtimes) | `instance-manager.ts` has zero `db('runtimes').(update\|insert\|delete)` calls | grep | `grep -cE "db\('runtimes'\)\.(update\|insert\|delete)" apps/server/src/services/instance-manager.ts` (must be 0) | N/A | ⬜ pending |
| 16-03-01 | 03 | 3 | RT-01 | — | `GET /api/runtimes` returns unified list with correct shape | e2e (curl/http) | `curl -s http://localhost:3001/api/runtimes` + shape assertion | ❌ W0 | ⬜ pending |
| 16-03-02 | 03 | 3 | RT-05 | T-16-05 (sweeper daemon-only) | `offline-sweeper.ts` whereIn guards `kind IN ('local_daemon','external_cloud_daemon')` only | grep + e2e | `grep -E "whereIn\('kind'" apps/server/src/task-dispatch/offline-sweeper.ts` + Playwright RT-05 | ❌ W0 | ⬜ pending |
| 16-03-03 | 03 | 3 | RT-01..RT-05 (wiring) | — | Boot sequence wires 9a + 9e between existing step 9 and listen | grep | `grep -n "runtimeBridgeReconcile\|startRuntimeOfflineSweeper" apps/server/src/server-core.ts` (must have both, between lines 265 and 275) | N/A | ⬜ pending |
| 16-04-01 | 04 | 4 | RT-01..RT-05 | ALL | Full E2E covers list, mirror-within-2s, rename-within-2s, delete-cascade, derived-status, sweeper-90s | e2e | `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/runtimes.spec.ts` — new Playwright spec covering RT-01 through RT-05 (created in Plan 16-04)
- [ ] `better-sqlite3` as dev dep for the Playwright runner if direct SQLite inspection is used in the test (plan 16-04 notes `npm i --save-dev` fallback)
- [x] Existing Playwright harness (`playwright.config.ts`) — already provisioned by v1.0-v1.3

*Existing infrastructure covers all per-task grep and typecheck gates. Only the new spec file is truly Wave 0 missing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual confirmation of unified runtimes list in web UI | RT-01 | Phase 16 ships only the API — UI consumes it in Phase 25 | Defer manual UX review until after Phase 25 Management UIs. For Phase 16, `curl` output is sufficient. |

*All phase requirements have automated verification.* The UI-level manual check belongs to Phase 25.

---

## Security-Adjacent Controls (cross-referenced from research)

| Threat | Mitigation | Verified By |
|--------|-----------|-------------|
| Cross-workspace runtime leak (Info Disclosure) | Every registry function scopes via `.where('workspace_id', ctx.workspaceId)` | Plan 16-01 Task 2 grep asserts `.where\('workspace_id'` appears in every exported registry function |
| Bridge writes to `instances` (Tampering / ST1) | `runtime-bridge.ts` uses only `db('instances').select(...)` reads | Plan 16-02 Task 1 grep (must return 0) |
| Sweeper touches hosted runtimes (ST1) | `whereIn('kind', ['local_daemon', 'external_cloud_daemon'])` guard in sweeper query | Plan 16-03 Task 2 grep + node-inline integration test |
| Orphan mirror rows after instance delete (DoS) | Migration 004 FK `ON DELETE CASCADE` (Phase 15) handles it automatically | Plan 16-04 RT-03 e2e deletes an instance and asserts runtime row vanishes within 2 s |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies listed
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has grep OR typecheck OR e2e)
- [x] Wave 0 covers all MISSING references (`tests/e2e/runtimes.spec.ts` created in plan 16-04)
- [x] No watch-mode flags in any automated command
- [x] Feedback latency < 5 s per-task (Playwright deferred to wave boundary)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-16
