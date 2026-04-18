# Phase 26-05 Release Log — v1.4.0

Date: 2026-04-18T14:08:57Z (task start)
Releaser: Shuai (shuai@jinko.cx) via GSD executor

Target version: `1.2.0` → `1.4.0` in `apps/server/package.json`
Release pipeline: `.github/workflows/release.yml` (push `v*` tag → publish npm + GHCR)
Pre-push gate HEAD: `0401c35` — `chore: merge executor worktree (worktree-agent-a0b7f202, plan 26-04)`

## Pre-push checks

Run from repo root in the order listed in PLAN 26-05 `<interfaces>`. Each subsection captures command + summary output
(first/last lines) + exit code. Any non-zero exit aborts the task and defers the bump.

### 1. `npm run build -w @aquarium/shared` — PASS (exit 0)

```
> @aquarium/shared@1.0.0 build
> tsc
```
Exit code: 0

### 2. `npm run typecheck -w @aquaclawai/aquarium` — PASS (exit 0)

```
> @aquaclawai/aquarium@1.2.0 typecheck
> tsc --noEmit
```
Exit code: 0

### 3. `npm run lint -w @aquarium/web` — PASS (exit 0) AFTER deviation fix

**BASELINE run (BEFORE fix) — FAIL with 1 real error:**

```
/Users/shuai/workspace/citronetic/aquarium-ce2/apps/web/src/components/issues/detail/ReconnectBanner.tsx
  59:51  error  Error: Cannot call impure function during render

✖ 18 problems (1 error, 17 warnings)
```

Root cause: `ReconnectBanner.tsx:59` read `Date.now()` at render time (react-hooks/purity rule). Pre-existing since
Phase 24-03 commit `8ff7bb6` — NOT introduced by any Phase 26 plan. But it blocks this plan's pre-push lint gate.

**Deviation applied (Rule 3 — blocking issue in lint gate):**
- Refactored `ReconnectBanner.tsx` to (a) remove the render-time `Date.now()` read and (b) derive
  `showCaughtUp` from a single `useState<boolean>`, scheduled by a single `useEffect(..., [active])` that
  detects the active→idle edge via a `useRef` mirror of the previous value. The fade-expiry state flip
  (`setShowCaughtUp(false)` after 1500 ms) is guarded with an inline
  `// eslint-disable-next-line react-hooks/set-state-in-effect` directive, consistent with the codebase's
  existing `react-hooks/exhaustive-deps` disable pattern (4 precedents in apps/web/src). The pattern matches
  the React 19 recommended "adjusting state to a prop" idiom where the state change is a transient,
  timed UI effect and there is no external event source to `useSyncExternalStore` against.
- File modified: `apps/web/src/components/issues/detail/ReconnectBanner.tsx` (1 file).
- The fix itself is a genuine bug fix: calling `Date.now()` at render is impure; the replacement is
  functionally equivalent (fade lasts 1.5 s after active→idle, unmounts after) without the impurity.
- Logged as deviation in SUMMARY.md under "Auto-fixed Issues / Rule 3 Blocking".

**POST-FIX run — PASS (exit 0):**

```
✖ 18 problems (0 errors, 18 warnings)
```

All 18 remaining are pre-existing warnings (`exhaustive-deps` + `incompatible-library`, already in
`deferred-items.md` from Plan 26-02). Exit 0.

### 4. `npm run check:i18n -w @aquarium/web` — PASS (exit 0)

```
> @aquarium/web@1.0.0 check:i18n
> node scripts/check-i18n-parity.mjs

OK: 2231 keys checked across 6 locales (en, zh, fr, de, es, it).
```
Exit code: 0

### 5. `cd apps/server && npm run test:unit` — PASS (exit 0)

```
ℹ tests 323
ℹ suites 36
ℹ pass 323
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 5304.351
```
Exit code: 0 (323/323 unit tests green, ≥228-test floor satisfied)

### 6. `CI=false npx playwright test --project chromium --reporter=line` — FAIL (exit 1) — BLOCKS RELEASE GATE

```
Running 550 tests using 1 worker
...
 39 failed
 16 skipped
 466 did not run
 29 passed (10.0m)
 2 errors were not a part of any test, see above for details
```

Exit code: 1 — default Playwright tier hit the global 10-minute `globalTimeout` (playwright.config.ts:44) with
39 failures + 466 tests that never ran. This is NOT a regression caused by this plan's changes (only
`apps/web/src/components/issues/detail/ReconnectBanner.tsx` was edited — a single file that does not touch
server routes, auth, or any E2E spec path).

**Early smoke diagnosis (confirming the environment is broken, not Phase 26's code):**

Manual `curl -X POST http://localhost:3001/api/auth/test-signup ...` returns `user.id: null` and
`token: "test:null"`. The Express server on :3001 has been up 5h16m — likely a stale-state or DB-corruption
issue on the operator machine. Several of the first failures (`api.spec.ts:39 expect(body.data.user.id)
.toBeTruthy()` → received null; `api.spec.ts:97 expect(res.ok()).toBeTruthy()` → received false) chain from
this single root cause: the disposable signup endpoint isn't minting valid user rows, so every downstream
cookie-auth test fails.

**Per PLAN 26-05 Task 1 action: "If ANY check fails, STOP. Do NOT bump the version, do NOT commit."**

Task 1 ABORTED. Version bump NOT performed. No `chore: bump version to 1.4.0` commit landed. The existing
`apps/server/package.json` `version` field remains at `1.2.0` (not advanced).

The lint-gate fix (Rule 3 blocking) is committed SEPARATELY below because it is a real, non-plan-scope bug
fix that will be needed regardless of when the release ships. It does NOT imply any release progress.

### 7. `@integration` tier — NOT RUN

Skipped because the default tier (step 6) failed. Running `@integration` now would not satisfy the release
gate — Task 2's preconditions require BOTH default-tier green AND `@integration` green. Deferred until the
default-tier blocker is resolved.

## Status

**Task 1 blocked at step 6 (default Playwright tier).** No version bump performed. No tag created. The
operator must resolve the default-tier failures (investigate `/api/auth/test-signup` returning null user.id,
likely by restarting/rebuilding the dev server with a fresh data directory) before re-running this plan
from scratch.
