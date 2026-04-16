---
phase: 19
slug: daemon-rest-api-auth
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 19 — Validation Strategy

> Per-phase validation contract. Sourced from `19-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (unit) via `tsx` + Playwright (integration/E2E) |
| **Config file** | none for `node --test`; `playwright.config.ts` at root |
| **Quick run command** | `npx tsx --test apps/server/tests/unit/daemon-auth.test.ts` |
| **Full suite command** | `npx tsx --test 'apps/server/tests/unit/*.test.ts' && npx playwright test tests/e2e/daemon-rest.spec.ts --list` |
| **Estimated runtime** | ~20 seconds unit + list-only |

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
| 19-01-01 | 01 | 1 | DAEMON-09 | AUTH4/AUTH5 | `adt_<32>` format; SHA-256 hash; `timingSafeEqual`; no cache | unit | `npx tsx --test apps/server/tests/unit/daemon-auth.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | DAEMON-07 | AUTH3 | `requireDaemonAuth` only; `/api/daemon/*` rejects cookie JWT | unit | `npx tsx --test apps/server/tests/unit/daemon-auth.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | AUTH1 | AUTH1 | `requireAuth` rejects `adt_*` bearer even with valid cookie | unit | `npx tsx --test apps/server/tests/unit/auth-guard.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | DAEMON-01/02/03 | AUTH3 | register/heartbeat/deregister endpoints return runtime IDs, update last_heartbeat_at | unit+integration | `npx tsx --test apps/server/tests/unit/daemon-routes.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | DAEMON-04/05/06 | — | claim/start/progress/messages/complete/fail/status wrap Phase-18 services | unit+integration | `npx tsx --test apps/server/tests/unit/daemon-routes.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-03 | 02 | 2 | DAEMON-08 | CE3 | `/api/daemon/*` exempt from global limiter; per-token ~1000/min bucket | unit | `npx tsx --test apps/server/tests/unit/rate-limit.test.ts` | ❌ W0 | ⬜ pending |
| 19-03-01 | 03 | 3 | DAEMON-10 | AUTH2 | POST/GET/DELETE `/api/daemon-tokens` — plaintext shown once; subsequent GET has hashed prefix only | unit+integration | `npx tsx --test apps/server/tests/unit/daemon-tokens-routes.test.ts` | ❌ W0 | ⬜ pending |
| 19-04-01 | 04 | 4 | all DAEMON-* | all AUTH | Playwright E2E spec covers SC-1..SC-5 | e2e | `npx playwright test tests/e2e/daemon-rest.spec.ts --list` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/tests/unit/daemon-auth.test.ts` — stub (implemented in 19-01)
- [ ] `apps/server/tests/unit/auth-guard.test.ts` — stub for the `requireAuth` `adt_*` reject path (19-01)
- [ ] `apps/server/tests/unit/daemon-routes.test.ts` — stub (19-02)
- [ ] `apps/server/tests/unit/rate-limit.test.ts` — stub (19-02)
- [ ] `apps/server/tests/unit/daemon-tokens-routes.test.ts` — stub (19-03)
- [ ] `tests/e2e/daemon-rest.spec.ts` — stub (19-04)

Reuse `apps/server/tests/unit/test-db.ts` from Phase 18. No new deps needed (`express-rate-limit@8.3.2` is already installed).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC-3 live: 5-min sustained 1-req/sec poll against `/claim` not throttled | DAEMON-08 | Requires long-running real server + real rate-limit state | Run `npm run dev`, then `while true; do curl -H "Authorization: Bearer adt_test" http://localhost:3001/api/daemon/runtimes/R/tasks/claim; sleep 1; done` for 5 min; assert no 429 |
| SC-4 live: revoked token → 401 within 1s | DAEMON-09 | Real HTTP round-trip timing | Issue token, revoke it via UI route, time next `/api/daemon/register` request; assert < 1s to 401 |
| SC-2 live: cookie-authed user with `adt_*` bearer → 401 on `/api/agents` | AUTH1 | Integration between cookie auth + middleware patch | Sign in via UI, add `Authorization: Bearer adt_*` header in DevTools, call `/api/agents`; assert 401 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
