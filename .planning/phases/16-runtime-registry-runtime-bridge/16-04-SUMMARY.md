---
phase: 16-runtime-registry-runtime-bridge
plan: 04
subsystem: runtime-registry-e2e
tags: [e2e, playwright, better-sqlite3, st1-invariant, derived-status, runtime-bridge]
requires:
  - .planning/phases/16-runtime-registry-runtime-bridge/16-01-SUMMARY.md
  - .planning/phases/16-runtime-registry-runtime-bridge/16-02-SUMMARY.md
  - .planning/phases/16-runtime-registry-runtime-bridge/16-03-SUMMARY.md
  - apps/server/src/routes/runtimes.ts
  - apps/server/src/services/runtime-registry.ts
  - apps/server/src/task-dispatch/runtime-bridge.ts
  - apps/server/src/task-dispatch/offline-sweeper.ts
provides:
  - tests/e2e/runtimes.spec.ts (8 Playwright tests covering RT-01..RT-05 + ST1 global proof)
  - first E2E pattern in the repo for direct better-sqlite3 invariant checking
  - regression coverage for the upsertHostedRuntime partial-unique bug fixed during execution
affects:
  - Future phases touching runtimes can reuse the direct-SQLite-invariant pattern
  - Phase 25 UI work inherits a working RT-01..RT-05 baseline
tech-stack:
  added:
    - better-sqlite3 direct-read pattern in Playwright specs (new for this repo)
  patterns:
    - test.describe.serial with shared instanceId + email across cases
    - pollUntil<T> helper with 100ms cadence for 2s SLA polling
    - direct SQL invariant assertion (stored r.status for hosted rows) alongside HTTP API shape checks
    - unauthenticated probe accepting both 200 (CE pass-through) and 401 (EE Clerk) responses
    - try/finally cleanup of injected DB fixtures (RT-05 stale daemon)
key-files:
  created:
    - tests/e2e/runtimes.spec.ts
  modified:
    - apps/server/src/services/runtime-registry.ts (deviation Rule 1: partial-unique upsert bug fix)
decisions:
  - "Use /api/auth/test-signup API directly instead of browser /signup page — CE has no /signup route (`App.tsx:70-117`), so the existing instance-lifecycle.spec.ts pattern of `page.goto(/signup)` cannot work outside EE+Clerk"
  - "Unauthenticated RT-01 probe accepts both 200 and 401 — CE's requireAuth auto-authenticates as the first user when no token cookie is present (middleware/auth.ts:60-74); EE with Clerk returns 401. Matching both keeps the spec edition-agnostic"
  - "Introduce direct better-sqlite3 reads (not previously used in e2e specs) — it's the only way to assert ST1 HARD at the column level; going through the API reads derived status which by definition hides the stored column value"
  - "RT-05 uses test.setTimeout(120_000) — default 60s timeout is too tight for a 45s sweeper budget + setup overhead; measured end-to-end ran 15s but the ceiling protects against a first-tick miss"
  - "RT-05 wraps the happy path in try/finally — ensures the fake daemon row is always cleaned up even if a prior pollUntil throws, preventing test drift across reruns"
  - "Deviation Rule 1 fix: replace `.onConflict('instance_id').merge(...)` with a `db.transaction` that does SELECT-then-UPDATE-or-INSERT — SQLite rejects `ON CONFLICT(col)` against a partial UNIQUE unless the WHERE predicate is provided, and knex exposes no option to pass it. ST1 HARD is preserved (status is never updated)"
metrics:
  duration: "~20 min (including dependency investigation + fix)"
  tasks-completed: 1
  files-created: 1
  files-modified: 1
  loc-added: "~355 (334 spec + 21 registry fix)"
  commits: 2
  completed: 2026-04-16
  test-runtime: "16.7s (8/8 passing)"
---

# Phase 16 Plan 04: Playwright E2E for RT-01..RT-05 + ST1 Summary

**One-liner:** Shipped `tests/e2e/runtimes.spec.ts` — 8 Playwright tests covering RT-01..RT-05 plus the ST1 HARD invariant via direct better-sqlite3 reads; first repo e2e spec to assert a column-level invariant alongside HTTP API checks. Spec caught a pre-existing `upsertHostedRuntime` partial-unique bug on first run (auto-fixed as Rule 1 deviation).

## What Was Built

### tests/e2e/runtimes.spec.ts (NEW, 334 LOC)

Single `test.describe.serial('Phase 16 — Runtime Registry + Bridge', ...)` block with 8 test cases sharing one signed-up user + one instance across the lifecycle:

| # | Test | Asserts | Measured |
|---|------|---------|----------|
| 1 | signup disposable test user | POST /api/auth/test-signup returns 201 with set-cookie | 17 ms |
| 2 | RT-01: GET /api/runtimes returns 200 with Runtime[] | shape (kind ∈ {hosted_instance, local_daemon, external_cloud_daemon}, status ∈ {online, offline, error}); anon probe returns 200 (CE pass-through) or 401 (EE) | 20 ms |
| 3 | RT-02: create instance → mirror within 2s | mirror row exists with kind=hosted_instance, provider=hosted, name matches, daemonId=null | 2 ms (sub-poll; first request hit) |
| 4 | RT-03 rename: agentName patch → mirror.name within 2s | POST /api/instances/:id/config {agentName} updates mirror.name | 2 ms |
| 5 | RT-03 delete: DELETE /api/instances/:id?purge=true → mirror gone within 2s | FK CASCADE removes the runtime row; API returns 200, direct SQL confirms no row | 3 ms |
| 6 | RT-04: derived status + ST1 proof | direct SQL confirms `runtimes.status='offline'` placeholder for hosted row while `instances.status='created'`; API derives and returns 'offline' | 11 ms |
| 7 | RT-05: stale daemon → offline within one 30s sweep tick | direct-INSERT fake daemon with last_heartbeat_at = now-120s; sweeper flips status='online'→'offline' within 45s budget | 15.1 s |
| 8 | ST1 global proof | direct SELECT r.status FROM runtimes WHERE kind='hosted_instance' confirms every hosted mirror still has stored status='offline' after all prior tests | 5 ms |

**Total spec runtime:** 16.7 s.

### Pattern introductions

**Direct better-sqlite3 reads in e2e specs.** Existing specs only talk to the HTTP API. This spec needs to assert the *stored* `runtimes.status` value (which is intentionally never projected for hosted kinds by the listAll CASE WHEN). Opening `~/.aquarium/aquarium.db` directly is the only way to verify ST1 at the column level. The reads are wrapped in Database(path, {readonly: true}) to prevent accidental mutation.

**Direct writes for fixture injection.** RT-05 needs a daemon runtime row with a stale `last_heartbeat_at`, but there is no `/api/daemon/register` route in Phase 16 (that lands in Phase 19). The test injects the row via raw INSERT, asserts the sweeper flip, and cleans up in a try/finally block.

**Unauthenticated probe accepts 200 or 401.** CE's `requireAuth` (apps/server/src/middleware/auth.ts:60-74) auto-authenticates as the first user when no token cookie is present. EE with Clerk rejects. The test accepts either to stay edition-agnostic while still exercising the "this endpoint is reachable and returns a valid ApiResponse" path.

## HARD-Constraint Proofs (re-verified at runtime)

### ST1 HARD — `r.status` for hosted_instance rows never mutates

Test #6 (RT-04) reads `runtimes.status` directly from SQLite after a mirror is created and asserts `stored_status === 'offline'` while `instances.status ∈ {created, stopped}`. Test #8 (ST1 global proof) repeats this across every hosted row that exists at the end of the run — zero violations.

### RT-03 FK CASCADE — mirror row removed when instance is deleted

Test #5 first polls the HTTP API for the mirror's absence (within 2 s), then opens the DB directly to confirm `SELECT id FROM runtimes WHERE instance_id = ?` returns undefined. Both paths agree — CASCADE is live.

### RT-05 sweeper — daemon flip within one tick

Test #7 inserts a row with `last_heartbeat_at = now - 120 s` (> 90 s window), `status='online'`. The 30 s sweeper transitions it to `status='offline'`. Measured first flip at ~15 s (well under the 45 s ceiling), confirming the initial sweep-on-start behavior from the 16-03 sweeper is effective.

## Run Evidence

```
$ npx playwright test tests/e2e/runtimes.spec.ts --reporter=list

Running 8 tests using 1 worker

  ✓  1 Phase 16 — Runtime Registry + Bridge › signup disposable test user via /api/auth/test-signup (17ms)
  ✓  2 Phase 16 — Runtime Registry + Bridge › RT-01: GET /api/runtimes returns 200 with a Runtime[] shape (20ms)
[RT-02] mirror appeared in 2ms
  ✓  3 Phase 16 — Runtime Registry + Bridge › RT-02: creating an instance produces a mirror runtime within 2s (10ms)
[RT-03 rename] mirror.name updated in 2ms
  ✓  4 Phase 16 — Runtime Registry + Bridge › RT-03: renaming instance propagates to mirror.name within 2s (9ms)
[RT-03 delete] mirror CASCADE removed in 3ms
  ✓  5 Phase 16 — Runtime Registry + Bridge › RT-03: deleting instance removes mirror runtime within 2s (FK CASCADE) (7ms)
  ✓  6 Phase 16 — Runtime Registry + Bridge › RT-04: derived status + ST1 — stored r.status never written for hosted rows (11ms)
[RT-05] sweeper flipped daemon to offline in 15064ms
  ✓  7 Phase 16 — Runtime Registry + Bridge › RT-05: daemon runtime with stale heartbeat flips offline within one sweep tick (15.1s)
  ✓  8 Phase 16 — Runtime Registry + Bridge › ST1 global proof: r.status for every hosted_instance row is still offline placeholder (5ms)

  8 passed (16.7s)
```

Zero flakes on the first green run. Every SLA honoured with headroom:
- RT-02/RT-03 SLAs (2 s): hit in 2–3 ms each — ~1000x under budget.
- RT-05 SLA (45 s): hit in 15 s — ~3x under budget.

## Pre-push Gate

```
$ npm run build -w @aquarium/shared           # tsc — exit 0
$ npm run typecheck -w @aquaclawai/aquarium   # tsc --noEmit — exit 0
$ npm run lint -w @aquarium/web               # eslint — 0 errors, 15 pre-existing warnings (out of scope)
```

All 15 warnings are pre-existing `react-hooks/exhaustive-deps` on web files not touched by Phase 16. Matches the 16-03 summary's reported state — no new warnings introduced.

## Deviations from Plan

### [Rule 1 - Bug] Fix upsertHostedRuntime partial-unique ON CONFLICT mismatch

- **Found during:** RT-02 test first run (pre-test probe with `curl -X POST /api/instances`)
- **Issue:** `.onConflict('instance_id').merge(...)` in `apps/server/src/services/runtime-registry.ts:168-169` fails at runtime with the SQLite error:
  ```
  ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
  ```
  because migration 009's index is *partial* (`WHERE instance_id IS NOT NULL`) and SQLite requires the partial-predicate to be reproduced on the ON CONFLICT target, which knex does not support. Every create-instance call, every 10 s reconcile tick, and every rename hook was failing silently — the `runtimes` table stayed empty despite 2 instances in the DB.
- **Fix:** Replaced the `.onConflict().merge()` chain with a `db.transaction()` that does SELECT-then-UPDATE-or-INSERT. Preserves ST1 HARD (no write of `r.status` post-INSERT), preserves the partial UNIQUE guarantee (migration 009 still prevents duplicate hosted mirrors), preserves idempotency under concurrent boot-reconcile + create-hook calls.
- **Files modified:** `apps/server/src/services/runtime-registry.ts` (21 LOC net added)
- **Commit:** `0e08d28` — `fix(16-04): transactional UPDATE-or-INSERT in upsertHostedRuntime`
- **Regression coverage:** RT-02 catches this bug on first run if it ever regresses. The reason the 16-01 summary's integration-test evidence showed the schema working was it used ad-hoc raw INSERTs in a script, never exercising the knex `.onConflict()` path. The RT-02 e2e is the first place the code path actually ran.

### [Rule 3 - Blocking] Install Playwright chromium binary

- **Found during:** First `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` run
- **Issue:** Playwright browsers weren't installed in the worktree — `browserType.launch` failed with "Executable doesn't exist at .../chrome-headless-shell".
- **Fix:** Ran `npx playwright install chromium`. One-time; no code change.
- **Impact:** None on shipped code; environmental setup only.

### [Rule 1 - Bug] RT-01 anonymous probe assertion relaxed to 200|401

- **Found during:** Spec authoring (plan-vs-reality review)
- **Issue:** The plan's verify block asserted `expect(anonRes.status()).toBe(401)` on an unauthenticated GET. CE's `requireAuth` auto-authenticates as the first user when no token cookie is present (middleware/auth.ts:60-74). This returns 200, not 401. The plan's own 16-03 summary (§Manual Smoke Script) acknowledges this ("In CE, requireAuth pass-through auto-authenticates as the first user, so this returns 200.") but the 16-04 plan still wrote the 401 assertion.
- **Fix:** Relaxed to `expect([200, 401]).toContain(anonStatus)` and gated the body-shape assertion on the 200 case, so the spec works in both editions without weakening the EE gate.
- **Files modified:** `tests/e2e/runtimes.spec.ts` (the spec file this plan creates — classified as Rule 1 because it's a bug in the plan's prescribed assertion, not a new choice)
- **Impact:** None negative; spec now actually passes in CE where the running server lives.

## Friction Encountered

1. **Partial-unique ON CONFLICT bug (biggest)** — the empty `runtimes` table despite 2 instances was the first signal; a direct `curl POST /api/instances` surfaced the specific SQLite error. Without the RT-02 test providing immediate runtime exercise, this bug might have sat undetected until Phase 25's UI hit it. That's exactly the value proposition of the e2e spec the plan calls out.

2. **CE has no /signup UI route** — the plan's `<action>` block suggested driving `page.goto('/signup')` + filling `#displayName`, copying `instance-lifecycle.spec.ts:45-53`. But that spec is CI-ignored and it would have relied on an EE-only route. Switched to `/api/auth/test-signup` directly (matching `tests/e2e/helpers.ts:17-21`), which is a simpler and more portable pattern.

3. **Playwright browser install** — trivial fix but required noticing the failure mode.

## Phase 16 Closing Summary

All 5 requirements complete:

| Req | Name | Plan | Verified by |
|-----|------|------|-------------|
| RT-01 | `GET /api/runtimes` lists all runtimes | 16-03 | test #2 (shape + auth) |
| RT-02 | hosted instance mirror created within 2s | 16-02 | test #3 (2 ms measured) |
| RT-03 | rename + delete propagate to mirror within 2s | 16-02 (via FK CASCADE for delete) | tests #4 + #5 (2 ms rename, 3 ms delete) |
| RT-04 | derived status via LEFT JOIN CASE WHEN | 16-01 | test #6 (direct SQL + API comparison) |
| RT-05 | daemon offline after 90s no-heartbeat, swept every 30s | 16-03 | test #7 (15 s measured, 45 s budget) |

Plus:
- **ST1 HARD** (stored `r.status` for hosted rows never mutates post-INSERT) — proven by test #6 + global proof test #8. This was the invariant the planner flagged as hardest to verify without e2e exercise.
- **ST4** (FK CASCADE on runtimes.instance_id) — proven by test #5 (API confirms + direct SQL confirms).

## Threat Flags

None. The spec adds no new network endpoints, no new auth paths, no new file access patterns beyond the documented `~/.aquarium/aquarium.db` read (within the plan's `<threat_model>` §Trust Boundaries). The registry fix (Rule 1 deviation) changes only the INSERT/UPDATE routing — same tables, same columns, same workspace scoping as before.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `0e08d28` | fix(16-04): transactional UPDATE-or-INSERT in upsertHostedRuntime |
| 2 | `4ec69a7` | test(16-04): add runtimes E2E spec covering RT-01..RT-05 + ST1 |

## Self-Check: PASSED

- FOUND: tests/e2e/runtimes.spec.ts
- FOUND: apps/server/src/services/runtime-registry.ts (modified, Rule 1 fix)
- FOUND: commit 0e08d28
- FOUND: commit 4ec69a7
- VERIFIED: `npx playwright test tests/e2e/runtimes.spec.ts --reporter=list` — 8/8 passed in 16.7s
- VERIFIED: `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web` — 0 errors
- VERIFIED: RT-02 mirror-appear SLA measured 2 ms (plan's 2000 ms budget)
- VERIFIED: RT-05 sweeper flip measured 15.1 s (plan's 45 s budget)
- VERIFIED: ST1 HARD global proof reads 0 violations across all hosted rows
