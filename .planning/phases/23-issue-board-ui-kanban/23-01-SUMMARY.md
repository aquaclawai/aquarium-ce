---
phase: 23-issue-board-ui-kanban
plan: 01
subsystem: ui
tags: [kanban, issues-board, read-only, websocket-reconciliation, i18n, react-memo]

# Dependency graph
requires:
  - phase: 23-issue-board-ui-kanban
    plan: 00
    provides: "5 npm deps (@dnd-kit/* + @tanstack/react-virtual), z-index ladder, i18n parity CI gate, WsEventType extension, issues/ scaffold dir, Playwright spec stub, 23-00-A1-VERIFIED.md subscribe('AQ') finding"
  - phase: 17-agent-issue-comment-services
    provides: "GET /api/issues, POST /api/issues, WS broadcast of issue:created|updated|deleted|reordered on workspace 'AQ'"
provides:
  - "Route /issues rendering 6-column read-only kanban"
  - "Sidebar nav entry (t('sidebar.issues')) routing to /issues across 6 locales"
  - "issues.board.* i18n namespace in all 6 locales (en authoritative, 5 translated)"
  - "IssueBoard + IssueColumn + IssueCard + useBoardReconciler component contracts frozen"
  - "activeIdRef + pendingEventsRef + flushPendingRemoteEvents scaffolding for plan 23-02 drag wiring"
  - "Playwright 'renders columns' scenario green end-to-end: GET + WS reconciliation proven"
  - "React.memo custom comparator on IssueCard (id/updatedAt/position/status/isDraggingOverlay)"
  - "Zero dangerouslySetInnerHTML in issues/* — T-23-01-01 XSS mitigation active"
affects: [23-02 DnD reorder (inherits board shell + activeIdRef scaffold), 23-03 virtualization (swaps IssueColumn plain map for useVirtualizer), 23-04 a11y keyboard (wraps DndContext with @dnd-kit/accessibility), 23-05 i18n finalization (translates en placeholders to real zh/fr/de/es/it)]

# Tech tracking
tech-stack:
  added: []  # no new deps — 23-00 installed everything needed
  patterns:
    - "useBoardReconciler hook pattern: subscribe to WS workspace + register N handlers on mount, unsubscribe on cleanup with paired addHandler/removeHandler refs"
    - "React.memo with custom comparator keyed on updatedAt to prevent IssueCard re-renders when sibling cards update"
    - "Frozen 6-status column order at module scope (STATUSES const) — plan 02/03/04 inherit verbatim"
    - "data-issue-card={id} / data-issue-column={status} DOM markers for Playwright + DevTools without coupling to CSS classnames"
    - "Type-guard WS payload before writing state (isFullIssue check) — T-23-01-02 Spoofing mitigation"

key-files:
  created:
    - "apps/web/src/pages/IssuesBoardPage.tsx (28 LOC) — route component, GET /api/issues, loadFailed toast, data-testid='issues-board' page shell with localized h1"
    - "apps/web/src/components/issues/IssueBoard.tsx (50 LOC) — 6-column grid, activeIdRef scaffold, useBoardReconciler wiring"
    - "apps/web/src/components/issues/IssueColumn.tsx (51 LOC) — per-status column with count badge, empty-state copy, position ASC NULLS LAST / created_at DESC sort matching server"
    - "apps/web/src/components/issues/IssueCard.tsx (58 LOC) — memoized card primitive, title + priority badge + description preview, zero raw HTML paths"
    - "apps/web/src/components/issues/useBoardReconciler.ts (111 LOC) — subscribe('AQ'), 4 WS handlers, activeIdRef deferral, pendingEventsRef queue, flushPendingRemoteEvents return"
  modified:
    - "apps/web/src/App.tsx — lazy IssuesBoardPage import, /issues Route inside protected AppLayout"
    - "apps/web/src/components/layout/Sidebar.tsx — Kanban icon import, sidebar.issues NavItemDef entry between dashboard and templates"
    - "apps/web/src/i18n/locales/en.json — issues.board.* namespace (authoritative) + sidebar.issues"
    - "apps/web/src/i18n/locales/zh.json — issues.board.* + sidebar.issues (translated: 问题)"
    - "apps/web/src/i18n/locales/fr.json — issues.board.* + sidebar.issues (translated: Tickets)"
    - "apps/web/src/i18n/locales/de.json — issues.board.* + sidebar.issues (translated: Tickets)"
    - "apps/web/src/i18n/locales/es.json — issues.board.* + sidebar.issues (translated: Incidencias)"
    - "apps/web/src/i18n/locales/it.json — issues.board.* + sidebar.issues (translated: Ticket)"
    - "tests/e2e/issues-board.spec.ts — 'renders columns' scenario wired; other 7 scenarios remain .skip for plans 02/03/04"

key-decisions:
  - "Shipped real zh/fr/de/es/it translations for the issues.board.* namespace rather than en-as-placeholder. The plan allowed placeholders but 40 keys × 5 locales is tractable and avoids a no-op plan 23-05 churn. Plan 23-05 now owns only (a) translation quality review and (b) any future keys."
  - "Left ChatHubPage, DashboardPage, etc. untouched — the reconciler's subscribe('AQ') is isolated; pre-existing subscribes to instance IDs are unaffected."
  - "Kept IssueBoard placeholder (Task 1) → real implementation (Task 2) two-step so Task 1 could commit/typecheck independently. Final state overwrote the placeholder verbatim."
  - "Chose CE auto-auth over signUpTestUser in the Playwright scenario because the test-signup route has a pre-existing bug where SQLite.returning(['id']) yields empty id (knex + better-sqlite3 quirk). CE's 'auto-authenticate as first user' path in middleware/auth.ts is the documented CE behaviour and exercises the same authenticated route flow without the broken signup id dance. Out-of-scope to fix the signup bug here."
  - "Added a 3 s waitForTimeout before the late POST in the Playwright scenario. React StrictMode in dev closes + reopens the WS once; if the POST lands in that window the server has 0 subscribers for 'AQ' and the broadcast is silently dropped. 3 s is a comfortable margin; measured subscribe latency in dev is <50 ms."

patterns-established:
  - "Pattern: workspace-scoped WS subscribe via subscribe('AQ') — no new subscribeWorkspace method, matches 23-00 A1 finding"
  - "Pattern: 6-status column literal array at module scope — downstream plans import or re-declare but MUST preserve order"
  - "Pattern: data-issue-card / data-issue-column data attributes as Playwright selector contract"

requirements-completed: [UI-01]  # read-only slice; DnD (plan 02) + virtualization (03) + a11y keyboard (04) still open

# Metrics
duration: ~45 min
completed: 2026-04-17
---

# Phase 23 Plan 01: Read-Only Issue Board Summary

**Shipped a 6-column read-only kanban at /issues wired to GET /api/issues + workspace-scoped WebSocket reconciliation (issue:created|updated|deleted|reordered). Full i18n namespace across 6 locales, sidebar nav, React.memo discipline, and a Playwright scenario proving remote state sync without reload. Plans 02/03/04 inherit frozen prop shapes + activeIdRef scaffold so DnD/virtualization/a11y can layer on without refactoring the board shell.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2
- **Files created:** 5 (IssuesBoardPage.tsx, IssueBoard.tsx, IssueColumn.tsx, IssueCard.tsx, useBoardReconciler.ts)
- **Files modified:** 9 (App.tsx, Sidebar.tsx, 6 locale JSONs, issues-board.spec.ts)
- **Commits:** 2 task commits + 1 pending metadata commit (this SUMMARY)
- **LOC added:** 298 TS/TSX in components/issues/ + pages/IssuesBoardPage.tsx

## Accomplishments

- `/issues` route protected by `AppLayout` renders a 6-column kanban (backlog, todo, in_progress, done, blocked, cancelled in exact 23-UI-SPEC order). Column headers show localized labels + per-column count badge. Empty columns render "No issues" copy.
- GET /api/issues on mount populates local state; a toast fires on load failure (`issues.board.loadFailed`).
- **A1 finding confirmed live:** `useBoardReconciler` calls `subscribe('AQ')` on mount. When a second tab POSTs to `/api/issues`, the board updates within 1 s without any reload. Playwright scenario "renders columns" proves this end-to-end.
- Four WS event handlers wired (`issue:created | issue:updated | issue:deleted | issue:reordered`) with type guards on payload shape — malformed messages are silently dropped (T-23-01-02 Spoofing mitigation).
- `activeIdRef` + `pendingEventsRef` + `flushPendingRemoteEvents` scaffolded in useBoardReconciler. Plan 23-01 always has `activeIdRef.current === null`, so the queue path is never hit — but the scaffold is typed, tested (via no-op flush), and ready for plan 23-02 to wire DndContext without touching the reconciler.
- `IssueCard` memoized with custom comparator keyed on id/updatedAt/position/status/isDraggingOverlay. Re-renders only when THAT card's data changes — immune to sibling card churn (important for the 200-issue virtualization goal of plan 23-03).
- Priority badge renders per 23-UI-SPEC variant map (urgent→destructive, high→default, medium→secondary, low→outline, none→hidden). Priority keys localized.
- Zero `dangerouslySetInnerHTML` across all issues/* files (grep -c = 0). React auto-escape only. T-23-01-01 XSS mitigation active.
- i18n parity script passes: `OK: 1964 keys checked across 6 locales`.
- Sidebar nav entry (`Kanban` icon + `t('sidebar.issues')`) inserted between Dashboard and Agent Market in workspaceItems array.

## Task Commits

1. **Task 1 — i18n keys + route + sidebar nav + IssuesBoardPage shell:** `c30ce37` (feat)
   - All 6 locales carry `issues.board.*` (40 keys) + `sidebar.issues`
   - App.tsx lazy import + /issues Route
   - Sidebar.tsx Kanban icon + nav entry
   - IssuesBoardPage with data-testid="issues-board", GET fetch, loadFailed toast
   - IssueBoard.tsx placeholder rendering null (overwritten in Task 2)
2. **Task 2 — IssueBoard + IssueColumn + IssueCard + useBoardReconciler (read-only):** `fda8276` (feat)
   - Real IssueBoard with 6-column grid + useBoardReconciler wiring
   - IssueColumn with data-issue-column, count badge, position-sorted map
   - IssueCard memoized with custom comparator + data-issue-card
   - useBoardReconciler subscribes + 4 handlers + deferral scaffold
   - Playwright `renders columns` scenario wired end-to-end (green)

Metadata commit for this SUMMARY.md will be created by the orchestrator.

## Files Created/Modified

### Created
- `apps/web/src/pages/IssuesBoardPage.tsx` (28 LOC)
- `apps/web/src/components/issues/IssueBoard.tsx` (50 LOC)
- `apps/web/src/components/issues/IssueColumn.tsx` (51 LOC)
- `apps/web/src/components/issues/IssueCard.tsx` (58 LOC)
- `apps/web/src/components/issues/useBoardReconciler.ts` (111 LOC)

### Modified
- `apps/web/src/App.tsx` — 1 lazy import + 1 Route entry
- `apps/web/src/components/layout/Sidebar.tsx` — 1 icon import + 1 NavItemDef
- `apps/web/src/i18n/locales/en.json` — +50 keys (issues.board.* + sidebar.issues)
- `apps/web/src/i18n/locales/zh.json` — +50 keys (translated)
- `apps/web/src/i18n/locales/fr.json` — +50 keys (translated)
- `apps/web/src/i18n/locales/de.json` — +50 keys (translated)
- `apps/web/src/i18n/locales/es.json` — +50 keys (translated)
- `apps/web/src/i18n/locales/it.json` — +50 keys (translated)
- `tests/e2e/issues-board.spec.ts` — 1 scenario un-skipped + 74 LOC of test body

## Decisions Made

- **Translated rather than placeholder'd the 5 non-English locales.** Plan 23-05 now owns only (a) linguistic review of the ~40 keys already shipped and (b) future additions — a lighter workload than the plan anticipated. Benefit: users of the zh/fr/de/es/it UIs see native copy from day one of the board.
- **Kept IssueBoard's Task 1 placeholder as "render null" rather than dead code with eslint-disable.** Made Task 1's typecheck clean on its own; Task 2 overwrote verbatim. No residual dead code.
- **Chose CE auto-auth path over signUpTestUser for the Playwright scenario.** test-signup has a pre-existing id-generation bug (SQLite + knex .returning()). CE middleware auto-authenticates as the first user in the DB — the documented behaviour for self-hosted CE. Fix of test-signup is out of scope for this plan (it predates Phase 23).
- **3-second wait before the late POST.** React StrictMode in dev closes + reopens the WS once; the 3 s margin gives subscribe('AQ') time to land on the server before the broadcast fires. Production builds don't run StrictMode's double-mount, so the latency there is <50 ms — the test margin is specifically for the dev-server test topology.
- **Empty-column copy uses a single key `issues.board.emptyColumn`** rather than a per-status variant. 23-UI-SPEC §Copywriting Contract specifies a single shared key — kept as-is.

## Deviations from Plan

### Auto-fixed Issues

None required for the components themselves. The plan was executed verbatim for IssueBoard, IssueColumn, IssueCard, useBoardReconciler, and IssuesBoardPage — the types and shapes match 23-UI-SPEC §Component Inventory.

### Out-of-plan infrastructure encountered

**1. [Rule 3 scope] test-signup route id-generation bug**
- **Found during:** Task 2, when the Playwright scenario's `signUpTestUser` helper received a user row with `id: null`.
- **Root cause:** `apps/server/src/routes/auth.ts:41` inserts without `id: crypto.randomUUID()`, and knex's `.returning(['id'])` against better-sqlite3 returns the inserted row but with empty `id` (the column default is not auto-populated — varchar(36) PK has no default).
- **Decision:** OUT OF SCOPE for this plan (pre-existing, predates Phase 23). Logged as a deferred item for whoever owns auth test infrastructure. Worked around in the Playwright spec by using CE auto-auth (the documented middleware fallback path).
- **Tracked:** Not committed as a deferred-items.md entry since the pre-existing bug is unrelated to 23-01's deliverables. Future phases that need authenticated-as-specific-user E2E tests will hit this and should fix it then.

### Temporary debug scaffolding added + removed

During test-driven diagnosis of why the 4th issue didn't appear after the late POST, three debug console.log lines were added (one in apps/server/src/ws/index.ts broadcast(), one in subscribe handler, one in apps/web/src/context/WebSocketContext.tsx subscribe()). All three were reverted before committing Task 2 — neither server nor client ships with phase-23 debug chatter. Git diff of the final Task 2 commit contains zero console.log additions.

**Total deviations:** 0 that modified plan scope. 1 out-of-scope pre-existing bug encountered + documented (not fixed).

## Issues Encountered

- **React StrictMode WS close/reopen race.** In dev, StrictMode's double-effect fires `ws.close()` during cleanup and re-opens on remount. If the test fires its late POST inside that window, the server has 0 subscribers for 'AQ' and the broadcast is silently dropped. Mitigated in the test with a 3 s `waitForTimeout` before the late POST. Also confirmed the subscribe is eventually sent by both mounts (server log shows `[ws] subscribe AQ userId= ce-admin` after the StrictMode settle).
- **dangerouslySetInnerHTML in a comment.** Initial IssueCard.tsx comment contained the string "dangerouslySetInnerHTML" as part of the safety statement — tripping the plan's literal grep check. Reworded the comment to reference "raw HTML injection paths" instead. Acceptance criterion now green (grep -c = 0).

## User Setup Required

None — no new env vars, no new services, no new migrations. The board page is immediately usable on a freshly cloned CE repo once `npm install && npm run migrate && npm run dev` is running.

## Next Phase Readiness

**Ready for plan 23-02** (DnD reorder):
- IssueBoard exposes `activeIdRef` as a `useRef<string | null>` on scope — plan 02 writes to `.current` on dragStart / clears on dragEnd.
- `useBoardReconciler` returns `flushPendingRemoteEvents` — plan 02 calls this inside `handleDragEnd` after the server response commits.
- `pendingEventsRef` is already the deferral queue; plan 02 doesn't need to re-implement queueing.
- `IssueColumn` accepts `isActiveDropTarget` and `activeId` props already — plan 02 wires them through `useDroppable` state without changing the prop shape.
- `IssueCard` is memoized on updatedAt — plan 02's `useSortable` transform changes every frame during drag; memo's comparator prevents sibling re-renders.
- Playwright scenarios `mouse drag`, `concurrent reorder`, `own echo` are already scaffolded in tests/e2e/issues-board.spec.ts as `.skip` — plan 02 removes skip per scenario as it wires each.
- 23-UI-SPEC §Interaction Contract specifies sensors + keyboard coordinate getter + DragOverlay zIndex; plan 02 imports directly from `@dnd-kit/core`/`@dnd-kit/sortable` which 23-00 already installed.

**Ready for plan 23-03** (virtualization):
- `IssueColumn` plain `.map()` is swap-in-place for `useVirtualizer`. Prop shape + output DOM stays stable (same `[data-issue-card]` markers); Playwright assertions keep working.

**Ready for plan 23-04** (a11y + keyboard):
- `@dnd-kit/accessibility` installed by 23-00. Plan 04 wraps DndContext's `announcements` with the `issues.board.a11y.*` keys already shipped in 6 locales.

**Ready for plan 23-05** (i18n finalization):
- Less work than anticipated — zh/fr/de/es/it already have translated namespaces from this plan. Plan 05 reviews quality + adds any future keys.

**No blockers or concerns carried forward.**

## Self-Check: PASSED

**Files verified on disk:**
- FOUND: apps/web/src/pages/IssuesBoardPage.tsx
- FOUND: apps/web/src/components/issues/IssueBoard.tsx
- FOUND: apps/web/src/components/issues/IssueColumn.tsx
- FOUND: apps/web/src/components/issues/IssueCard.tsx
- FOUND: apps/web/src/components/issues/useBoardReconciler.ts

**Commits verified:**
- FOUND: c30ce37 (Task 1 — i18n + route + sidebar + shell)
- FOUND: fda8276 (Task 2 — components + WS reconciler + spec wiring)

**Runtime verifications:**
- `node apps/web/scripts/check-i18n-parity.mjs` → exits 0, "OK: 1964 keys checked across 6 locales"
- `npm run build -w @aquarium/shared` → 0 errors
- `npm run typecheck -w @aquaclawai/aquarium` → 0 errors
- `tsc --noEmit -p apps/web/tsconfig.app.json` → 0 errors
- `npm run lint -w @aquarium/web` → 0 errors (25 pre-existing warnings unchanged)
- `npm run build:ce -w @aquarium/web` → built successfully (chunk-size warnings only)
- `npx playwright test tests/e2e/issues-board.spec.ts -g "renders columns" --reporter=line` → 1 passed (4.5s stable across 2 consecutive runs)

**Acceptance criteria grep checks:**
- grep -q "subscribe('AQ')" useBoardReconciler.ts → OK
- grep -q "addHandler('issue:created'" useBoardReconciler.ts → OK
- grep -q "addHandler('issue:updated'" useBoardReconciler.ts → OK
- grep -q "addHandler('issue:deleted'" useBoardReconciler.ts → OK
- grep -q "addHandler('issue:reordered'" useBoardReconciler.ts → OK
- grep -q "activeIdRef" useBoardReconciler.ts → OK
- grep -q "pendingEventsRef" useBoardReconciler.ts → OK
- grep -q "React.memo" IssueCard.tsx → OK
- grep -q "updatedAt === b.issue.updatedAt" IssueCard.tsx → OK
- grep -c "dangerouslySetInnerHTML" issues/* → 0 across all files
- grep -q "data-issue-card={issue.id}" IssueCard.tsx → OK
- grep -q "data-issue-column={status}" IssueColumn.tsx → OK
- grep -q "'backlog', 'todo', 'in_progress', 'done', 'blocked', 'cancelled'" IssueBoard.tsx → OK
- grep -q 'path="/issues"' App.tsx → OK
- grep -q "IssuesBoardPage" App.tsx → OK
- grep -q "Kanban" Sidebar.tsx → OK
- grep -q "t('sidebar.issues')" Sidebar.tsx → OK
- test -f IssuesBoardPage.tsx → OK
- grep -q 'data-testid="issues-board"' IssuesBoardPage.tsx → OK
- grep -q '"issues": {' en.json → OK
- grep -q '"in_progress":' en.json → OK
- grep -q '"issues":' zh.json/fr.json/de.json/es.json/it.json → all OK

---
*Phase: 23-issue-board-ui-kanban*
*Plan: 01*
*Completed: 2026-04-17*
