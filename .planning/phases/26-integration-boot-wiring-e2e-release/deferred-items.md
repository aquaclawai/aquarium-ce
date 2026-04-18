# Phase 26 - Deferred Items

Out-of-scope discoveries logged during plan execution.


## Plan 26-02 (2026-04-18)

### `react-hooks/incompatible-library` lint error in TaskMessageList.tsx (PRE-EXISTING)

**File:** apps/web/src/components/issues/detail/TaskMessageList.tsx:38
**Error:** `TanStack Virtual's useVirtualizer() API returns functions that cannot be memoized safely`
**Origin:** Commit 0bcae8b (Phase 24-02 "feat: pure rendering components").
**Verification:** Stashing 26-02 changes (no web/ src modifications from this plan) reproduces the error on the bare base commit — confirming pre-existing.
**Scope:** Outside Plan 26-02's touch set (tests/e2e/, root package.json, playwright.config.ts, .github/workflows/ci.yml only).
**Action:** DO NOT fix in 26-02. Plan 26-05 ("phase-wide verification") is the natural place to address web-surface lint gate before release.
