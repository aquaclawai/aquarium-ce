---
phase: 24-issue-detail-ui-task-message-streaming
plan: 01
subsystem: web

# Dependency graph
requires:
  - phase: 24-issue-detail-ui-task-message-streaming
    plan: 00
    provides: rehype-sanitize@^6.0.0 dep, apps/web/src/components/issues/detail/ scaffold dir, issues.detail.* + chat.composer.* i18n keys across 6 locales, tests/e2e/issue-detail.spec.ts with 8 verbatim test.skip stubs, WsEventType extended with task:* literals
  - phase: 23-issue-board-ui-kanban
    provides: useSortable pointerDistance:5 activation constraint, useBoardReconciler 'AQ' subscribe pattern, IssueCard memo comparator, issues.board.priority.* / issues.board.columns.* keys
  - phase: 17-agent-issue-comment-services
    provides: GET /api/issues/:id, GET /api/issues/:id/comments, POST /api/issues/:id/comments, PATCH /api/comments/:id, DELETE /api/comments/:id, comment broadcast events (comment:posted|updated|deleted)
provides:
  - /issues/:id route in apps/web/src/App.tsx
  - read-only Issue Detail page orchestrator (IssueDetailPage)
  - 8 detail-subsystem components in apps/web/src/components/issues/detail/ (SafeMarkdown, useIssueDetail, IssueHeader, IssueDescription, CommentsTimeline, CommentThread, CommentCard, CommentComposer, IssueActionSidebar)
  - navigation from IssueCard title to /issues/:id coexisting with @dnd-kit drag
  - UX6 XSS mitigation grep-enforced at 0 occurrences of dangerouslySetInnerHTML under apps/web/src/components/issues/detail/
  - comment:posted|updated|deleted literals added to WsEventType (enables typechecked client handlers; server already emits them)
  - issues.detail.noDescription + issues.detail.confirmDelete.{title,body,confirm} i18n keys across 6 locales
  - Playwright scenarios "issue detail renders" + "threaded comments" green
affects: [24-02, 24-03, 24-04, 24-05, 24-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SafeMarkdown wrapper: react-markdown + rehype-sanitize (defaultSchema + className allowlist on <code>/<pre>) + rehype-highlight. Anchor override unconditionally emits target=_blank + rel=noopener noreferrer nofollow (T-24-01-05)."
    - "useIssueDetail: parallel issue+comments fetch; subscribe('AQ') on the workspace channel (Phase 23 A1 pattern); 5 WS handlers reconcile local state with isFullIssue/isFullComment type guards (T-24-01-02)."
    - "Nonce-based refetch pattern: setRefetchNonce(n => n + 1) inside useCallback triggers an effect re-run without the React 'setState-in-effect cascading renders' lint error."
    - "Threaded comments render via buildForest: flat Comment[] → Map<parent_id, Comment[]> → recursive CommentTreeNode[]. Orphans (parent SET NULL) surface as roots so they stay visible."
    - "Depth cap = 3 visible levels + collapse at > 5 direct children (first 2 kept, remainder behind Show {n} more affordance) — T-24-01-04 DoS mitigation."
    - "IssueCard title navigation via onClick (no onPointerDown stopPropagation) — relies on @dnd-kit pointerDistance:5 activation to discriminate click vs drag. Verified preserving Phase 23 'own echo' drag regression."

key-files:
  created:
    - apps/web/src/pages/IssueDetailPage.tsx
    - apps/web/src/components/issues/detail/markdown.tsx
    - apps/web/src/components/issues/detail/useIssueDetail.ts
    - apps/web/src/components/issues/detail/IssueHeader.tsx
    - apps/web/src/components/issues/detail/IssueDescription.tsx
    - apps/web/src/components/issues/detail/IssueActionSidebar.tsx
    - apps/web/src/components/issues/detail/CommentsTimeline.tsx
    - apps/web/src/components/issues/detail/CommentThread.tsx
    - apps/web/src/components/issues/detail/CommentCard.tsx
    - apps/web/src/components/issues/detail/CommentComposer.tsx
    - .planning/phases/24-issue-detail-ui-task-message-streaming/24-01-SUMMARY.md
  modified:
    - apps/web/src/App.tsx
    - apps/web/src/components/issues/IssueCard.tsx
    - tests/e2e/issue-detail.spec.ts
    - packages/shared/src/types.ts
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json

key-decisions:
  - "Dropped plan's onPointerDown stopPropagation on the IssueCard title button: the prescribed guard broke Phase 23 'own echo' drag test (drag starting from the center of the card, which happens to land on the title text, was swallowed by stopPropagation). Replaced with a stationary onClick-only handler and rely on @dnd-kit's pointerDistance:5 activation to discriminate click vs drag. Verified all 5 Phase 23 board scenarios green (renders columns / mouse drag / own echo / keyboard drag / concurrent reorder)."
  - "Auto-extended WsEventType with comment:posted|updated|deleted literals (Rule 3 blocking): server broadcasts these events from Phase 17-04, but Wave 0 only added task:* literals. Without the web-side union extension, addHandler() calls in useIssueDetail wouldn't typecheck."
  - "Nonce-based refetch pattern instead of calling a refetch useCallback from inside a useEffect body: the project's lint config flags setState-in-useEffect as 'Calling setState synchronously within an effect can trigger cascading renders'. A refetch nonce bumps state which is a dep of the single fetch effect — cleaner separation, identical behaviour."
  - "IssueActionSidebar renders null on viewports < 1024px (instead of collapsing into a popover in-file) — the header's DropdownMenu already surfaces the same actions. This keeps the sidebar component focused on its single responsive variant; Wave 3's inline edit flows will add the full popover when the edit UI lands."
  - "buildForest treats orphaned children as roots so they stay visible: comments.parent_id is ON DELETE SET NULL, so deleting a root leaves its replies in the timeline rather than orphaning them into the void."

patterns-established:
  - "apps/web/src/components/issues/detail/ — centralised subsystem directory for all detail-page components + hooks. Waves 2-5 add TaskPanel / ChatComposer / ReconnectBanner / TaskMessageList here without touching IssueDetailPage.tsx orchestration."
  - "data-comment-thread={rootId}, data-comment={id}, data-comment-author-type={user|agent|system}, data-comment-parent={parentId | ''}, data-comment-collapsed={count}, data-issue-header={id}, data-testid='issue-detail', data-issue-id={id} — deterministic Playwright selectors per UI-SPEC §Data-Attribute Markers."
  - "onClick-only navigation on IssueCard title — no stopPropagation on pointerdown. Downstream consumers of @dnd-kit sortables in this repo should follow the same pattern."

requirements-completed: [UI-04, UI-07]

# Metrics
duration: ~20 min
completed: 2026-04-17
---

# Phase 24 Plan 01: Issue Detail UI Read-Only Slice Summary

**Shipped the read-only slice of `/issues/:id` — 8 detail-subsystem components + useIssueDetail hook + SafeMarkdown wrapper + IssueCard title-click navigation. Playwright "issue detail renders" + "threaded comments" both green; all 5 Phase 23 board regression scenarios still green.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-17
- **Completed:** 2026-04-17
- **Tasks:** 3
- **Files modified:** 20 (10 created, 10 modified)

## Accomplishments

- `apps/web/src/components/issues/detail/markdown.tsx` — SafeMarkdown wrapper. react-markdown v10 + rehype-sanitize defaultSchema (extended with `className` on `<code>`/`<pre>` for rehype-highlight) + rehype-highlight + remark-gfm. Anchor override unconditionally sets `target=_blank` + `rel=noopener noreferrer nofollow` (T-24-01-05 mitigation). Zero raw-HTML injection paths.
- `apps/web/src/components/issues/detail/useIssueDetail.ts` — single source of truth for the detail page. Parallel `api.get('/issues/:id')` + `api.get('/issues/:id/comments')` via Promise.all. Subscribes `'AQ'` workspace channel on mount; registers 5 WS handlers (`issue:updated|deleted` + `comment:posted|updated|deleted`) that reconcile local state through `isFullIssue` / `isFullComment` type guards (T-24-01-02 tampering mitigation). Nonce-based `refetch()` sidesteps the project's "setState-in-effect" lint rule.
- `apps/web/src/components/issues/detail/IssueHeader.tsx` — title + status/priority badges + relative-time posted meta + DropdownMenu with Edit / Assign / ChangeStatus / Delete. Delete triggers a destructive `<Dialog>` with `issues.detail.confirmDelete.*` keys.
- `apps/web/src/components/issues/detail/IssueDescription.tsx` — SafeMarkdown-wrapped prose with `issues.detail.noDescription` empty state.
- `apps/web/src/components/issues/detail/IssueActionSidebar.tsx` — right-column sticky Card on `>=1024px` viewports; collapses to null on narrower screens (header dropdown subsumes). Uses `window.matchMedia('(min-width: 1024px)')` + effect-driven state so the collapse is reactive to window resize.
- `apps/web/src/components/issues/detail/CommentsTimeline.tsx` — builds a tree forest from flat `Comment[]` via `buildForest(comments)` keyed on `parent_id`. Renders empty-state card when no comments, otherwise maps each root to a `CommentThread`. Top-level CommentComposer always available.
- `apps/web/src/components/issues/detail/CommentThread.tsx` — recursive renderer. Depth cap = 3 visible levels; deeper replies render at depth 3 without further indent. Collapse at > 5 direct children (keep first 2 + "Show {n} more replies" button). System comments disable the reply affordance (server refuses replies to system comments; Phase 17-04 guard).
- `apps/web/src/components/issues/detail/CommentCard.tsx` — user/agent branch: avatar + author line + `formatRelative(createdAt)` + SafeMarkdown body + Reply/Edit/Delete actions (Edit/Delete only on own user comments). System branch: compact italic single-line row, no actions, no avatar. Memoized on `id + updatedAt + content + isActiveReplyTarget`.
- `apps/web/src/components/issues/detail/CommentComposer.tsx` — plain textarea + Post button. `⌘⏎` / `Ctrl+Enter` submits; plain Enter inserts newline. Disabled while pending; parent owns the toast on error.
- `apps/web/src/pages/IssueDetailPage.tsx` — route orchestrator. Wires `useIssueDetail(id)` → IssueHeader + IssueDescription + CommentsTimeline + IssueActionSidebar. Sets/restores `document.title` through a useEffect. On `error === 'ISSUE_DELETED'` (set by the hook when the WS `issue:deleted` event fires for the current issue), navigates back to `/issues` with a toast. 404 state renders a Back button.
- `apps/web/src/App.tsx` — lazy imports IssueDetailPage + registers `<Route path="/issues/:id" element={<IssueDetailPage />} />` inside the protected AppLayout branch.
- `apps/web/src/components/issues/IssueCard.tsx` — title wrapped in `<button>` with `onClick={() => navigate('/issues/' + id)}`. **No `onPointerDown` stopPropagation** — the plan prescribed one, but it broke Phase 23's "own echo" drag test (drag from center of card, which often starts on the title text, was swallowed). Replaced with an onClick-only handler + @dnd-kit's existing `pointerDistance:5` activation discriminating click vs drag.
- `packages/shared/src/types.ts` — extended `WsEventType` additively with `comment:posted | comment:updated | comment:deleted` so the web-side `addHandler()` calls typecheck (server emits these literals from Phase 17-04; Wave 0 didn't add them because task:* was the only Wave-0 concern).
- `apps/web/src/i18n/locales/*.json` — added `issues.detail.noDescription` + `issues.detail.confirmDelete.{title,body,confirm}` across 6 locales. Parity script: 2053 keys × 6 locales, exit 0.
- `tests/e2e/issue-detail.spec.ts` — un-skipped 2 scenarios: "issue detail renders" (asserts `data-testid="issue-detail"` + title + SafeMarkdown-rendered `<strong>` + CommentsTimeline section) and "threaded comments" (seeds 2 DB comments linked by `parent_id`, asserts single `[data-comment-thread]` with the reply nested inside + `pl-6` indent class on the reply's ancestor thread wrapper). describe promoted to `describe.serial` to mirror Phase 23's spec pattern.

## Task Commits

1. **Task 1** — `6b8c7f1` (feat): IssueHeader + IssueDescription + IssueActionSidebar + useIssueDetail + SafeMarkdown.
2. **Task 2** — `847bdca` (feat): CommentsTimeline + CommentThread + CommentCard + CommentComposer (threaded by parent_id).
3. **Task 3** — `2e0c869` (feat): IssueDetailPage + /issues/:id route + IssueCard title onClick navigation.

## Files Created/Modified

### Created (10)
- `apps/web/src/pages/IssueDetailPage.tsx` — route orchestrator; ~170 lines.
- `apps/web/src/components/issues/detail/markdown.tsx` — SafeMarkdown wrapper; ~60 lines.
- `apps/web/src/components/issues/detail/useIssueDetail.ts` — fetch + WS reconciliation hook; ~150 lines.
- `apps/web/src/components/issues/detail/IssueHeader.tsx` — title + actions dropdown + destructive delete dialog; ~145 lines.
- `apps/web/src/components/issues/detail/IssueDescription.tsx` — SafeMarkdown-wrapped prose; ~25 lines.
- `apps/web/src/components/issues/detail/IssueActionSidebar.tsx` — sticky sidebar on desktop; ~110 lines.
- `apps/web/src/components/issues/detail/CommentsTimeline.tsx` — forest builder + section container; ~105 lines.
- `apps/web/src/components/issues/detail/CommentThread.tsx` — recursive depth-capped renderer + collapse; ~110 lines.
- `apps/web/src/components/issues/detail/CommentCard.tsx` — user/agent/system branches + memo; ~125 lines.
- `apps/web/src/components/issues/detail/CommentComposer.tsx` — textarea + ⌘⏎ submit + onCancel; ~80 lines.

### Modified (10)
- `apps/web/src/App.tsx` — added IssueDetailPage lazy import + /issues/:id route.
- `apps/web/src/components/issues/IssueCard.tsx` — title button with onClick navigate.
- `tests/e2e/issue-detail.spec.ts` — 2 scenarios un-skipped + real test bodies.
- `packages/shared/src/types.ts` — WsEventType extended with comment:* literals.
- `apps/web/src/i18n/locales/{en,zh,fr,de,es,it}.json` — issues.detail.noDescription + issues.detail.confirmDelete.*.

## Decisions Made

Covered in detail in frontmatter `key-decisions`. The load-bearing choice was dropping the plan's prescribed `onPointerDown` stopPropagation on the IssueCard title — the plan over-specified the guard, and Phase 23's "own echo" drag test proved it drags from the center of the card which overlaps with the title text. Removed the guard + relied on @dnd-kit's existing `pointerDistance:5` activation. All 5 Phase 23 scenarios stayed green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IssueCard title `onPointerDown={(e) => e.stopPropagation()}` broke Phase 23 drag regression**
- **Found during:** Task 3 verification (regression run of `tests/e2e/issues-board.spec.ts -g "own echo"`).
- **Issue:** The plan prescribed `onPointerDown={(e) => e.stopPropagation()}` on the title button to prevent drag activation when the user clicks the title. In practice, Playwright's `page.mouse.move/down/up` at the center of a 72-px-tall card lands on the title text (since the title fills the top half of the card). The React synthetic event on the button stopped propagation to the Card's `onPointerDown` listener that `@dnd-kit` installed, so the drag never started — "own echo" failed with `received 0 expected 1` for the post-drag target column cardinality.
- **Fix:** Removed the `onPointerDown` handler entirely. Kept the `onClick={navigate(...)}` with `stopPropagation` on the click (which fires AFTER the pointerup sequence and only when there was no drag — @dnd-kit's `pointerDistance:5` activation handles the discrimination for us). Doc comment updated to explain the design.
- **Files modified:** `apps/web/src/components/issues/IssueCard.tsx`.
- **Verification:** All 5 Phase 23 scenarios pass (`renders columns`, `mouse drag`, `own echo`, `keyboard drag`, `concurrent reorder`). "issue detail renders" + "threaded comments" still green (navigation from kanban to detail is verified indirectly through the detail URL path being reachable; the drag scenarios prove the click handler doesn't fire during drag because `pointerDistance:5` triggers the drag sensor before `onClick` can fire).
- **Committed in:** `2e0c869`.

**2. [Rule 3 - Blocking] Missing `comment:posted|updated|deleted` literals in WsEventType**
- **Found during:** Task 1 build-check (`npm run build:ce -w @aquarium/web` reported 6 TS2345 errors).
- **Issue:** The server has been broadcasting `comment:posted|updated|deleted` since Phase 17-04 (`apps/server/src/routes/comments.ts:91, 160, 196`), but the web-side `WsEventType` union in `packages/shared/src/types.ts` never included those literals. Wave 0 extended it with `task:*` additions but skipped the comment:* story. Without the extension, `useIssueDetail.addHandler('comment:posted', ...)` wouldn't typecheck.
- **Fix:** Additive extension of the union with `comment:posted`, `comment:updated`, `comment:deleted`. Rebuilt shared. Same pattern as Phase 23 / Wave 0 extensions.
- **Files modified:** `packages/shared/src/types.ts`.
- **Verification:** `npm run build -w @aquarium/shared` + `npm run build:ce -w @aquarium/web` both exit 0 after the change.
- **Committed in:** `6b8c7f1` (Task 1 commit includes this as part of the same story).

**3. [Rule 3 - Blocking] ESLint "setState-in-effect cascading renders" rule**
- **Found during:** Task 1 lint-check.
- **Issue:** Initial `useIssueDetail` implementation called a `refetch` useCallback from inside a useEffect body, which ran `setLoading(true)` inside the effect — the project's lint config flags this as `Calling setState synchronously within an effect can trigger cascading renders`.
- **Fix:** Refactored to a nonce pattern: `setRefetchNonce(n => n + 1)` bumps a state value, and the single fetch effect depends on `[issueId, refetchNonce]`. Initial state (`loading=true`) matches the pre-fetch UI shape so the effect doesn't need a synchronous state reset.
- **Files modified:** `apps/web/src/components/issues/detail/useIssueDetail.ts`.
- **Verification:** `npm run lint -w @aquarium/web` → 0 errors (26 pre-existing warnings in other files).
- **Committed in:** `6b8c7f1`.

**4. [Rule 3 - Blocking] ESLint `react/no-children-prop` on CommentThread passing children-shaped prop**
- **Found during:** Task 2 lint-check.
- **Issue:** CommentThread originally declared a `children: CommentTreeNode[]` prop (matching the UI-SPEC signature). The project's lint rule forbids passing a prop literally named `children` by name (uses React's intrinsic child-array semantics).
- **Fix:** Renamed the prop from `children` to `replies`. Updated both `CommentsTimeline.tsx` and `CommentThread.tsx` callers. Behaviour unchanged.
- **Files modified:** `apps/web/src/components/issues/detail/CommentThread.tsx`, `apps/web/src/components/issues/detail/CommentsTimeline.tsx`.
- **Verification:** Lint + build green.
- **Committed in:** `847bdca`.

---

**Total deviations:** 4 auto-fixed (1 bug + 3 blocking lint/build issues).
**Impact on plan:** Behavior-preserving. The drag-coexistence invariant is satisfied by a lighter-weight approach (no stopPropagation; rely on pointerDistance). No scope creep.

## Issues Encountered

None beyond the deviations above. The hard invariants (zero `dangerouslySetInnerHTML`, SafeMarkdown on all user/agent content, threaded comments by parent_id with indent marker, all tests green) held end-to-end.

## User Setup Required

None — no external service configuration required.

## Next Wave Readiness

Wave 2 (TaskPanel + task message streaming) can merge trivially:
- `apps/web/src/components/issues/detail/` directory is live with 8 components. TaskPanel adds files alongside; no changes to IssueDetailPage.tsx orchestration needed (comment marker `{/* Wave 2 inserts the task panel here */}` is the insertion point).
- `useIssueDetail` hook already exposes the issue + comments shape; Wave 2 extends it with `latestTask` lookup OR ships a sibling `useTaskStream` hook.
- SafeMarkdown wrapper is the one-stop render path for all agent-authored content — Wave 2's text + thinking + tool_result renderers use `<SafeMarkdown>{msg.content}</SafeMarkdown>` directly.
- Playwright spec has 6 remaining skipped scenarios wired to Waves 2-5 and locale 24-06.
- WsEventType includes all task:* literals (Wave 0) + comment:* literals (this plan's auto-fix). No further retrofits needed.

## Self-Check: PASSED

**File existence:**
- FOUND: `apps/web/src/pages/IssueDetailPage.tsx`
- FOUND: `apps/web/src/components/issues/detail/markdown.tsx`
- FOUND: `apps/web/src/components/issues/detail/useIssueDetail.ts`
- FOUND: `apps/web/src/components/issues/detail/IssueHeader.tsx`
- FOUND: `apps/web/src/components/issues/detail/IssueDescription.tsx`
- FOUND: `apps/web/src/components/issues/detail/IssueActionSidebar.tsx`
- FOUND: `apps/web/src/components/issues/detail/CommentsTimeline.tsx`
- FOUND: `apps/web/src/components/issues/detail/CommentThread.tsx`
- FOUND: `apps/web/src/components/issues/detail/CommentCard.tsx`
- FOUND: `apps/web/src/components/issues/detail/CommentComposer.tsx`

**Commits:**
- FOUND: `6b8c7f1` (Task 1)
- FOUND: `847bdca` (Task 2)
- FOUND: `2e0c869` (Task 3)

**Acceptance checks (hard invariants):**
- `grep -rc "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/ apps/web/src/pages/IssueDetailPage.tsx` = 0
- `grep -c "export function SafeMarkdown" apps/web/src/components/issues/detail/markdown.tsx` = 1
- `grep -c "rehypeSanitize" apps/web/src/components/issues/detail/markdown.tsx` = 2
- `grep -c 'rel="noopener noreferrer nofollow"' apps/web/src/components/issues/detail/markdown.tsx` = 1
- `grep -c "subscribe('AQ')" apps/web/src/components/issues/detail/useIssueDetail.ts` = 3 (doc comment + call + unsubscribe substring)
- `grep -c "addHandler('issue:updated'" apps/web/src/components/issues/detail/useIssueDetail.ts` = 1
- `grep -c "addHandler('issue:deleted'" apps/web/src/components/issues/detail/useIssueDetail.ts` = 1
- `grep -c "addHandler('comment:posted'" apps/web/src/components/issues/detail/useIssueDetail.ts` = 1
- `grep -c "data-issue-header={issue.id}" apps/web/src/components/issues/detail/IssueHeader.tsx` = 1
- `grep -c "data-comment=" apps/web/src/components/issues/detail/CommentCard.tsx` = 2
- `grep -c "data-comment-thread=" apps/web/src/components/issues/detail/CommentThread.tsx` = 1
- `grep -c "SafeMarkdown" apps/web/src/components/issues/detail/CommentCard.tsx` = 2
- `grep -c "metaKey\|ctrlKey" apps/web/src/components/issues/detail/CommentComposer.tsx` = 1
- `grep -c "IssueDetailPage" apps/web/src/App.tsx` = 2 (lazy import + Route element)
- `grep -c 'path="/issues/:id"' apps/web/src/App.tsx` = 1
- `grep -c 'navigate(\`/issues/${issue.id}\`)' apps/web/src/components/issues/IssueCard.tsx` = 1
- `grep -c 'data-testid="issue-detail"' apps/web/src/pages/IssueDetailPage.tsx` = 1
- `grep -c "data-issue-id={issue.id}" apps/web/src/pages/IssueDetailPage.tsx` = 1
- `grep -c "TaskPanel" apps/web/src/pages/IssueDetailPage.tsx` = 0
- `grep -c "test.skip(" tests/e2e/issue-detail.spec.ts` = 6 (went from 8 → 6, the 2 Phase 24-01 scenarios are now real)

**Test / build sweep:**
- `npm run build -w @aquarium/shared` exits 0.
- `npm run build:ce -w @aquarium/web` exits 0.
- `npm run typecheck -w @aquaclawai/aquarium` exits 0.
- `npm run lint -w @aquarium/web` exits with 0 errors (26 pre-existing warnings in other files).
- `node apps/web/scripts/check-i18n-parity.mjs` exits 0 (2053 keys × 6 locales).
- Playwright `-g "issue detail renders"` passed (1.6s).
- Playwright `-g "threaded comments"` passed (1.5s).
- Playwright `-g "renders columns"` passed (Phase 23 regression).
- Playwright `-g "mouse drag"` passed (Phase 23 regression).
- Playwright `-g "own echo"` passed (Phase 23 regression — the key drag-coexistence test).
- Playwright `-g "keyboard drag"` passed (Phase 23 regression).
- Playwright `-g "concurrent reorder"` passed (Phase 23 regression).

---
*Phase: 24-issue-detail-ui-task-message-streaming*
*Completed: 2026-04-17*
