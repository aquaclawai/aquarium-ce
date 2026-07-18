---
phase: 23-issue-board-ui-kanban
plan: 03
subsystem: ui
tags: [kanban, issues-board, virtualization, tanstack-react-virtual, dnd-kit, overscan-during-drag, ui-03, ux4]

# Dependency graph
requires:
  - phase: 23-issue-board-ui-kanban
    plan: 00
    provides: "@tanstack/react-virtual@3.13.24 installed"
  - phase: 23-issue-board-ui-kanban
    plan: 01
    provides: "IssueColumn shell + data-issue-card / data-issue-column attributes + IssuesBoardPage route"
  - phase: 23-issue-board-ui-kanban
    plan: 02
    provides: "activeId plumbed from useIssueBoard → IssueBoard → IssueColumn; DragOverlay wired; IssueCard memoized; SortableContext items={sortedItems.map(i=>i.id)} invariant already present"
provides:
  - "Per-column virtualizer: useVirtualizer from @tanstack/react-virtual, threshold=100, estimateSize=72"
  - "Drag-safe overscan: overscan bumps from 10 → items.length while activeId !== null"
  - "data-scroll-container attribute on the virtualizer scroll wrapper (Playwright selector hook)"
  - "tests/e2e/helpers/seed-200-issues.ts — atomic bulk-seed via workspaces.issue_counter + BEGIN IMMEDIATE"
  - "Playwright scenarios 'virtualization' + 'virtualization drag' wired and green"
affects:
  - "23-04 keyboard a11y: keyboard drag paths traverse the same virtualized column; the overscan-during-drag bump also activates for keyboard-initiated drags (activeId !== null on any drag, including keyboard) — no new wiring needed in plan 04"
  - "23-05 i18n finalization: no new i18n keys introduced in plan 03 (virtualization is visual-only, no copy)"

# Tech tracking
tech-stack:
  added: []  # @tanstack/react-virtual was installed by 23-00
  patterns:
    - "useVirtualizer called unconditionally (Rules of Hooks). `shouldVirtualize = sortedItems.length > VIRTUALIZATION_THRESHOLD` is a render-time branch; when below threshold, the virtualizer's output is simply unused."
    - "SortableContext items={sortedItems.map(i=>i.id)} ALWAYS receives the full id array — never the windowed subset. This is the critical @dnd-kit + virtualizer integration rule (23-UI-SPEC §Virtualization Contract)."
    - "Drag-safe overscan: overscan: activeId !== null ? sortedItems.length : 10. When any drag is in progress anywhere on the board, the virtualized column effectively disables windowing for that render cycle, ensuring the dragged node is never unmounted mid-drag."
    - "Flex min-height: auto workaround: the scroll container must set inline `minHeight: 0` alongside `height: 70vh`. Without it, the flex-item default `min-height: auto` forces the wrapper to stretch to fit the 14400px spacer child, defeating virtualization entirely. This was discovered during Task 2 and fixed under Rule 1 (auto-fix bug)."

key-files:
  created:
    - "tests/e2e/helpers/seed-200-issues.ts (~80 LOC) — atomic BEGIN IMMEDIATE transaction + workspaces.issue_counter bump + 200 INSERT statements; mirrors createIssue's contract from apps/server/src/services/issue-store.ts"
  modified:
    - "apps/web/src/components/issues/IssueColumn.tsx — +76 LOC net: VIRTUALIZATION_THRESHOLD constant, useVirtualizer hook, conditional render branch, data-scroll-container attribute, minHeight: 0 flex-fix"
    - "tests/e2e/issues-board.spec.ts — +209 LOC: 'virtualization' scenario + 'virtualization drag' scenario + seed200Issues import"

key-decisions:
  - "Chose height: 70vh as the scroll container bound. Gives a viewport-relative scroll region that adapts across desktop sizes without introducing a new token. 70vh on a 1170px viewport = 820px; on a 720px viewport = 504px — both well below 200 * 72 = 14400px total content, so virtualization is effective at any reasonable viewport."
  - "Kept `useVirtualizer` called unconditionally (before the `shouldVirtualize` branch). This satisfies Rules of Hooks without a conditional useRef/useVirtualizer pair. Below threshold, its output is computed but not rendered — the hook pays a trivial tick-cost but no DOM cost. React Compiler (react-hooks plugin) flagged this as 'Compilation Skipped: Use of incompatible library' — an advisory warning for @tanstack/react-virtual (not an error). Lint still exits 0."
  - "data-scroll-container attribute vs. a class selector: chose the data-attribute because Tailwind v4 JIT's class-presence at runtime is not reliably regex-matchable from Playwright (class names are content-hashed in production). data-attributes are stable across dev + prod builds."
  - "Auto-fix under Rule 1: the `minHeight: 0` fix on the scroll container is required for virtualization to function at all. Without it, flex-item default min-height: auto makes the container stretch to 14400px and every card renders. Discovered via a probe script during Task 2, applied as a one-line inline-style addition. Documented in the Deviations section below."

requirements-completed: [UI-03]

# Metrics
duration: ~25 min
completed: 2026-04-17
---

# Phase 23 Plan 03: Per-Column Virtualization with Drag-Safe Overscan Summary

**Shipped UI-03 (virtualization at ≥100 items per column) with overscan-during-drag protection for @dnd-kit integration. `@tanstack/react-virtual`'s useVirtualizer windows the DOM to ~17 cards at 200 items (7 visible + 10 overscan), bumping to items.length while a drag is in progress so the dragged card never unmounts. Two Playwright scenarios prove it end-to-end: 'virtualization' asserts ≤ 25 cards in DOM + scroll reveals new cards; 'virtualization drag' asserts the dragged card persists across scroll and lands in the target column. Wave 1-2 scenarios (renders columns, mouse drag, concurrent reorder, own echo) all remain green — UX1 HARD invariant preserved. Plans 04 (keyboard) and 05 (i18n) inherit a performance-ready board.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (per plan) + 1 inline auto-fix
- **Files created:** 1 (seed-200-issues.ts)
- **Files modified:** 2 (IssueColumn.tsx, issues-board.spec.ts)
- **Commits:** 2 on top of the plan-02 tip
- **LOC added:** ~80 helper + ~210 test + ~75 component = ~365 net

## Accomplishments

- **UI-03 proven by automated test.** With 200 todo issues seeded (atomic `workspaces.issue_counter` bump + 200 INSERTs in one BEGIN IMMEDIATE transaction), the Todo column renders ~17 cards in the DOM — well below the ≤ 25 VALIDATION threshold. Scrolling reveals a different set of cards, proving windowing (not coincidental 25-card rendering).
- **Drag-safe overscan proven by automated test.** 'virtualization drag' starts a drag on the first card (index 0), scrolls the column 10,000 px, and asserts the dragged card is still attached via `toBeAttached()`. Drop onto In Progress then verifies both the server (`GET /api/issues/:id` → `status: in_progress`) and the DOM (`[data-issue-column="in_progress"] [data-issue-card="${id}"]` attached). The overscan: activeId !== null ? items.length : 10 branch is exercised exactly.
- **SortableContext invariant preserved.** `<SortableContext items={sortedItems.map(i => i.id)}>` stays OUTSIDE the `shouldVirtualize` branch so the full id array is always passed to @dnd-kit — never the windowed subset. 23-UI-SPEC §Virtualization Contract §"critical rule" satisfied.
- **UX1 HARD invariant not regressed.** `useIssueBoard.ts` line 254 (success-path clear of activeIdRef) remains AFTER line 245 (`await api.post<Issue>`). The grep guard verified before writing this summary.
- **Atomic seed helper.** `tests/e2e/helpers/seed-200-issues.ts` uses `BEGIN IMMEDIATE` + `UPDATE workspaces SET issue_counter = issue_counter + 200` + 200 parameterized INSERTs inside one transaction. Forbidden pattern (per-row `SELECT MAX(issue_number)+1`) is absent by grep.
- **Wave 1-2 scenarios still green.** `renders columns`, `mouse drag`, `concurrent reorder`, `own echo` all pass after the Task 1 virtualization changes (21.9 s total). No regression.
- **Build pipeline green:** `npm run build -w @aquarium/shared` + `npm run typecheck -w @aquaclawai/aquarium` + `npm run lint -w @aquarium/web` + `npm run build:ce -w @aquarium/web` all exit 0. Lint: 26 warnings (baseline was 25; 1 new advisory: `react-hooks/incompatible-library` on @tanstack/react-virtual — this is the React Compiler flagging that the library's returned-functions can't be auto-memoized, which is accurate and benign). No errors.
- **No XSS surface added.** `grep -rE "dangerouslySetInnerHTML" apps/web/src/components/issues/` returns 0. The virtualizer wrapper is inline-styled only; no user content flows through `innerHTML`.

## Virtualization measurements observed

Captured via a Playwright probe script (not committed — deleted after verification):

| Metric | With 200 items seeded |
|--------|----------------------|
| Scroll container `clientHeight` (`height: 70vh` on a 720px viewport) | 504 px |
| Spacer inner div `height` (`virtualizer.getTotalSize()`) | 14400 px (200 × 72) |
| `[data-issue-card]` DOM count at rest | ~17 |
| `[data-issue-card]` DOM count while dragging (expected = 200 due to overscan: items.length) | not asserted numerically in the test — the test asserts the dragged card IS attached, which is the load-bearing claim. Numeric DOM size during drag would be flaky across viewport sizes. |
| Scroll 5000 px → new DOM card ids | Different set (intersection < before set size) — proves windowing |

## Drag-safe overscan semantics

When `activeId !== null` (any drag in progress anywhere on the board), the virtualizer's `overscan` jumps from 10 to `sortedItems.length`, effectively disabling windowing for that render cycle. This means:

- The dragged card stays mounted even if it scrolls far out of view.
- @dnd-kit can read the dragged element's bounding rect at any time during the drag (needed for pointer-over collision detection).
- The DragOverlay's source card also stays mounted, so the `isDragging ? opacity: 0.4 : 1` ghost in its slot renders continuously.

When the drag ends (success or cancel), `activeId` flips back to null and the next render re-windows to the default overscan of 10. No explicit cleanup needed — React's natural re-render handles it.

## Network-call shape during virtualization drag

Confirmed via the 'virtualization drag' scenario:

```
PATCH /api/issues/{id0}
Body: { "status": "in_progress" }

POST /api/issues/{id0}/reorder
Body: { "beforeId": <last-card-in-in-progress or null>, "afterId": null }
```

Same shape as the plan-02 mouse drag scenario — virtualization does not alter the drag contract. Server-side `GET /api/issues/:id` after the drop confirms `status: in_progress`.

## Flex-item min-height quirk encountered

**Symptom:** First run of 'virtualization' failed with `Received: 200` (all cards in DOM) instead of ≤ 25.

**Root cause:** The virtualizer's scroll container is a flex-item inside `.flex flex-col gap-2` (the column). By default, flex items inherit `min-height: auto`, which means "at least the intrinsic min-content size of this flex item." The item's child is the 14400 px absolute-positioned spacer. Flex's `min-height: auto` forced the scroll wrapper to stretch to 14400 px, despite `style={{ height: '70vh' }}` being present inline. Inline `height` is overridden by flex's min-content constraint in this case.

**Fix:** Added `minHeight: 0` to the inline style, alongside `height: 70vh`. This explicitly releases the flex-item from min-content sizing. Verified via probe: scrollable height dropped from 14400 px → 504 px, card count from 200 → 17.

**Lesson (for plan 04/future phases):** Any flex-item that wraps an `overflow: auto` virtualizer MUST set `min-height: 0` to bound the scroll region. Noted here for downstream plans.

## Atomic bulk-seed contract

Helper `tests/e2e/helpers/seed-200-issues.ts`:

1. Opens `better-sqlite3` connection (write).
2. Begins an immediate transaction (`BEGIN IMMEDIATE`) — takes a write-lock, serialising any concurrent writer.
3. `SELECT issue_counter FROM workspaces WHERE id = 'AQ'` — reads the current base.
4. `UPDATE workspaces SET issue_counter = issue_counter + 200 WHERE id = 'AQ'` — atomic bump.
5. 200 parameterized `INSERT INTO issues (...) VALUES (?, ..., 'todo', 'none', NULL, ..., '{}', datetime('now'), datetime('now'))` calls with `issue_number = base + i`.
6. `COMMIT`.

This mirrors the contract in `apps/server/src/services/issue-store.ts` `createIssue`, which uses `trx('workspaces').increment('issue_counter', 1)` + read-back inside `db.transaction()`. Since our seed uses the SAME counter, any issue created via the API after a seed run will continue to get unique monotonic numbers — the allocator invariant is preserved.

Forbidden pattern explicitly absent (verified by grep): per-row `SELECT MAX(issue_number) + 1` against the issues table. That pattern is non-atomic and would race with any concurrent API writer (including parallel Playwright workers).

## Task Commits

1. **Task 1 — virtualize IssueColumn with drag-safe overscan:** `2a6c7d1` (feat)
   - apps/web/src/components/issues/IssueColumn.tsx — useVirtualizer hook + conditional render + data-scroll-container attribute
   - Note: the `minHeight: 0` fix was added in commit `93035d5` below (discovered during Task 2 testing).

2. **Task 2 — Playwright 'virtualization' + 'virtualization drag' scenarios + bugfix:** `93035d5` (test)
   - tests/e2e/helpers/seed-200-issues.ts — created, atomic bulk-seed helper
   - tests/e2e/issues-board.spec.ts — 2 scenarios un-skipped + wired (~210 LOC)
   - apps/web/src/components/issues/IssueColumn.tsx — `minHeight: 0` inline-style fix (Rule 1 auto-fix)

Metadata commit for this SUMMARY.md will be created by the orchestrator.

## Files Created/Modified

### Created
- `tests/e2e/helpers/seed-200-issues.ts` (~80 LOC)

### Modified
- `apps/web/src/components/issues/IssueColumn.tsx` — +75 LOC: VIRTUALIZATION_THRESHOLD constant, useVirtualizer hook (unconditional), conditional render branch (virtualized vs plain .map), data-scroll-container on scroll wrapper, minHeight: 0 inline fix.
- `tests/e2e/issues-board.spec.ts` — +210 LOC: 'virtualization' scenario + 'virtualization drag' scenario wired, seed200Issues import added.

## Decisions Made

- **VIRTUALIZATION_THRESHOLD = 100** per 23-UI-SPEC §Virtualization Contract. Below 100 items, the plain `.map()` branch renders — zero virtualizer DOM overhead. Above, useVirtualizer windows. The threshold is module-scoped so downstream tests or migrations can import and reference it (currently unused externally but cheap to expose).
- **overscan: activeId !== null ? sortedItems.length : 10** — at-rest overscan of 10 is the tanstack/virtual default for smooth scrolling; during drag it balloons to the full list so the dragged card never unmounts. The condition is `activeId !== null` (any drag, anywhere on the board), not `activeId === <this column's dragged card>` — this is intentional so that cross-column drags where the card lives in ANOTHER virtualized column also keep the source mounted.
- **useVirtualizer called unconditionally** — Rules of Hooks requires the hook always runs. Below threshold, its output is simply unused. The React Compiler flagged this as "incompatible library" (advisory warning), which is accurate — tanstack virtual returns functions and ref-like handles that can't be auto-memoized by React Compiler. This is a known characteristic and does not indicate a runtime issue.
- **70vh height for the scroll container** — viewport-relative, adapts across desktop sizes. 70vh ≈ 500 px on a typical 720 px test viewport, comfortably bounded below the 14400 px spacer content so virtualization actually windows.
- **minHeight: 0 fix applied inline, not via Tailwind class** — the fix is semantically a layout constraint, not a design token. Inline style is explicit about the relationship (it pairs with `height: 70vh` on the same element). Tailwind's `min-h-0` would also work, but the inline style co-locates the two height constraints.
- **Seed helper uses `BEGIN IMMEDIATE` (not `BEGIN` or `BEGIN DEFERRED`)** — IMMEDIATE acquires a RESERVED lock at the start of the transaction, preventing any other writer from starting a transaction until we COMMIT. This is exactly the semantic we need: the counter-bump + 200 INSERTs are serialised atomically against any concurrent application writer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `minHeight: 0` to the virtualizer scroll container**
- **Found during:** Task 2, first run of the 'virtualization' Playwright scenario.
- **Issue:** The test failed with `Received: 200` cards instead of ≤ 25. A probe showed the scroll container rendered at 14400 px tall despite the inline `height: 70vh` — flex-item default `min-height: auto` forced the wrapper to stretch to its 14400 px spacer child, completely defeating virtualization.
- **Fix:** Added `minHeight: 0` to the inline style alongside `height: 70vh`. Verified via probe: container drops to 504 px, card count drops to 17.
- **Files modified:** apps/web/src/components/issues/IssueColumn.tsx
- **Commit:** `93035d5` (folded into the Task 2 commit, since the bug was discovered while running Task 2's scenarios)

**Total:** 1 auto-fix (Rule 1). 0 architectural deviations. 0 user questions needed.

## Issues Encountered

- **Flex `min-height: auto` quirk** (described above under "Flex-item min-height quirk encountered"). Lesson documented inline in the component as a comment; propagates to plan 04/future phases as a known constraint.
- **React Compiler advisory warning on useVirtualizer.** The `react-hooks/incompatible-library` warning is an advisory (not an error) from the React 19 Compiler plugin, flagging that tanstack/virtual returns values the compiler can't auto-memoize. This is expected behavior for the library. Lint exits 0. Pre-existing warning count was 25; this plan adds 1. No action needed.
- **Scroll container selector ambiguity.** The tests use `[data-issue-column="todo"][data-scroll-container], [data-issue-column="todo"] [data-scroll-container]` as the selector — the first branch matches when data-issue-column is on the scroll container itself (virtualized case); the second covers a hypothetical future layout where they separate. In the current shape the first branch always matches. The double-selector is defensive; costs nothing.

## User Setup Required

None — no new env vars, no new services, no new migrations, no new dependencies (tanstack/react-virtual was installed by plan 23-00).

## Next Phase Readiness

**Ready for plan 23-04** (keyboard a11y):
- The KeyboardSensor was already wired in plan 23-02 (IssueBoard.tsx `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })`).
- Keyboard-initiated drags also set `activeId !== null` via the same handleDragStart path, so the overscan-during-drag bump applies to keyboard drags identically — the dragged card will stay mounted even if the user keyboards-scrolls through a virtualized column.
- Plan 04 just adds `@dnd-kit/accessibility` announcer + i18n keys; no virtualization changes needed.

**Ready for plan 23-05** (i18n finalization):
- No new i18n keys introduced in plan 03 (virtualization is visual-only, no copy).

**Performance readiness note (manual verification deferred):**
- The automated tests prove DOM size ≤ 25 at 200 items, which is the 23-UI-SPEC target. A manual FPS spot-check at 200 items via Chromium DevTools Performance tab is listed in VALIDATION §Manual-Only Verifications and remains deferred to end-of-phase QA. Plan 23-03's scope ends at the automated DOM assertion.

**No blockers or concerns carried forward.**

## Self-Check: PASSED

**Files verified on disk:**
- FOUND: apps/web/src/components/issues/IssueColumn.tsx (modified)
- FOUND: tests/e2e/issues-board.spec.ts (modified)
- FOUND: tests/e2e/helpers/seed-200-issues.ts (created)

**Commits verified:**
- FOUND: 2a6c7d1 (Task 1 — virtualize IssueColumn with drag-safe overscan)
- FOUND: 93035d5 (Task 2 — Playwright scenarios + seed helper + minHeight: 0 Rule 1 fix)

**Runtime verifications:**
- `npm run build -w @aquarium/shared` → 0 errors
- `npm run typecheck -w @aquaclawai/aquarium` → 0 errors
- `npm run lint -w @aquarium/web` → 0 errors (26 warnings — baseline was 25, +1 advisory `react-hooks/incompatible-library` for @tanstack/react-virtual)
- `npm run build:ce -w @aquarium/web` → built successfully (3.14 s, chunk-size warnings only)
- `npx playwright test tests/e2e/issues-board.spec.ts -g "virtualization"` → 2 passed (6.7 s)
- `npx playwright test tests/e2e/issues-board.spec.ts -g "renders columns|mouse drag|concurrent reorder|own echo"` → 4 passed (21.9 s, Wave 1-2 regression check)

**Acceptance criteria grep checks:**
- grep -q "useVirtualizer" IssueColumn.tsx → OK
- grep -q "VIRTUALIZATION_THRESHOLD = 100" IssueColumn.tsx → OK
- grep -q "items={sortedItems.map" IssueColumn.tsx → OK
- grep -q "overscan: activeId !== null ? sortedItems.length : 10" IssueColumn.tsx → OK
- grep -q "data-scroll-container" IssueColumn.tsx → OK
- grep -q "estimateSize: () => 72" IssueColumn.tsx → OK
- grep -q "from '@tanstack/react-virtual'" IssueColumn.tsx → OK
- grep -q "BEGIN IMMEDIATE" tests/e2e/helpers/seed-200-issues.ts → OK
- grep -q "issue_counter" tests/e2e/helpers/seed-200-issues.ts → OK
- ! grep -q "MAX(issue_number)" tests/e2e/helpers/seed-200-issues.ts → OK
- grep -c "seed200Issues(" tests/e2e/issues-board.spec.ts → 2 (OK — both scenarios use the helper)
- ! grep -q "test.skip(true, 'wired in 23-03')" tests/e2e/issues-board.spec.ts → OK
- grep -q "React.memo" apps/web/src/components/issues/IssueCard.tsx → OK (unchanged from plan 02)
- grep -c "dangerouslySetInnerHTML" apps/web/src/components/issues/ → 0 (OK — no XSS surface)
- UX1 HARD ordering: post-line=245 < success-clear-line=254 → OK (unchanged from plan 02)

---
*Phase: 23-issue-board-ui-kanban*
*Plan: 03*
*Completed: 2026-04-17*
