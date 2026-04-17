---
phase: 24-issue-detail-ui-task-message-streaming
plan: 04
subsystem: web
tags: [react, ui, truncation, xss, ci, fetch, api-wrapper, i18n, react-i18next, ux6]

# Dependency graph
requires:
  - phase: 24-issue-detail-ui-task-message-streaming
    plan: 00
    provides: task-message-store.ts truncateForStorage + getFullMessage + task_message_overflow table; tasks router with GET /api/tasks/:id/messages/:seq/full; i18n keys issues.detail.task.truncated/showFull/showFullLoading/showFullFailed/collapse in all 6 locales
  - phase: 24-issue-detail-ui-task-message-streaming
    plan: 02
    provides: TaskMessageItem Wave 2 skeleton with TruncationMarkerPlaceholder stub + data-task-message-truncated wrapper attr; rehype-sanitize-backed SafeMarkdown
provides:
  - TruncationMarker component — inline "⋯ truncated (showing {shown} of {total} bytes)" marker with Show-full button that fetches /api/tasks/:id/messages/:seq/full through the shared api.get<T>() wrapper and lifts the full TaskMessage back to the parent; Collapse button reverts
  - TaskMessageItem real truncation wiring — TruncationMarkerPlaceholder removed, replaced with <TruncationMarker /> on text / thinking / tool_use / tool_result kinds; fullOverride local state re-renders body through SafeMarkdown / <pre> on expansion
  - Client-side 256 KB render cap + FurtherClippedNotice — defends against adversarial overflow rows slipping past the server's 1 MB cap
  - CI guard step "Check no dangerouslySetInnerHTML in issue detail" — fails on any dangerouslySetInnerHTML occurrence under apps/web/src/components/issues/detail/ or apps/web/src/pages/IssueDetailPage.tsx
  - CI guard step "Check ReactMarkdown usage goes through SafeMarkdown" — fails if any file in detail/ (except markdown.tsx) imports react-markdown directly; closes the tampering loophole where an engineer could bypass the sanitized render path
  - Playwright "truncation marker" scenario green — seeds 20 KB truncated row + overflow, asserts marker + Show-full fetch + full body render + Collapse revert
affects: [24-05, 24-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UX6 component-boundary isolation: TruncationMarker only paints the marker + button and NEVER renders agent content. Full payload goes through onLoad to TaskMessageItem which re-renders via SafeMarkdown / <pre>. Single sanitization entry point preserved."
    - "String-concat URL interpolation ('/tasks/' + taskId + '/messages/' + seq + '/full') rather than template literals. Rationale: lets the plan's key_links grep invariant match verbatim and keeps the /messages/ boundary auditable."
    - "ApiError-aware toast: catch distinguishes ApiError message (server-originated, potentially actionable) from the generic localized fallback; surfaces server reason only when it differs from the generic copy."
    - "Client 256 KB hard render cap as defence-in-depth: server caps /full at 1 MB but the client further clips to CLIENT_RENDER_CAP_BYTES (262_144) before rendering, with a FurtherClippedNotice span so the user isn't surprised. Both the marker AND the further-clipped notice remain visible when the defensive clip fires."
    - "Per-row fullOverride state in TaskMessageItem (not lifted to parent list): preserves expansion across virtualizer-driven re-renders without thrashing a shared Map; the memo compare on id+seq+truncated+isLatest keeps the override stable for each row."
    - "CI grep-guard pattern: two steps after check:i18n — dangerouslySetInnerHTML exclusion + react-markdown import allowlist. Runs locally via the same one-liner engineers can rerun before pushing. Matches Phase 23's check:i18n grep pattern."

key-files:
  created:
    - apps/web/src/components/issues/detail/TruncationMarker.tsx
    - .planning/phases/24-issue-detail-ui-task-message-streaming/24-04-SUMMARY.md
  modified:
    - apps/web/src/components/issues/detail/TaskMessageItem.tsx
    - .github/workflows/ci.yml

key-decisions:
  - "Drop the earlier TruncationMarkerPlaceholder stub entirely rather than leaving it as a dead export. The real component has the same single call-site shape (<TruncationMarker ... />) so callers change only the import — leaving the stub would invite confusion and allow a future rollback to silently render nothing."
  - "fullOverride lives inside TaskMessageItem (not TaskMessageList or the stream hook). Rationale: the list already memo-optimises per row; hoisting would require a Map<seq, TaskMessage> with its own cache invalidation and would lose the virtualizer's natural per-row scoping. The memo compare is stable on id+seq+truncated+isLatest — fullOverride is reset per message id, which is exactly what we want when a task restarts."
  - "CI guard is TWO steps rather than a combined regex. First step is the literal-string dangerouslySetInnerHTML grep the plan mandates; second step is the react-markdown import allowlist closing the tampering loophole (UI-SPEC §Security Contract invariant 3). Splitting lets CI output name the exact violation on failure."
  - "Use new Blob([s]).size for byte accounting in both TruncationMarker copy and the client 256 KB cap. Browser-native, equivalent to Buffer.byteLength(s, 'utf8') but available without a Node polyfill; also handles surrogate-pair UTF-16 correctly. Same helper is used in TaskMessageItem's clipForRender for consistency."
  - "Error toast uses sonner (already a project-wide dep) rather than rolling a local alert. Matches the pattern in IssueDetailPage.tsx / IssuesBoardPage.tsx and provides localized description-line context when the ApiError carries a server message distinct from the generic fallback."

patterns-established:
  - "Spec-driven data-attrs: data-truncated='true' + data-original-bytes={N} on the marker span, data-action='show-full' + data-task-id + data-seq on the collapsed button. Playwright contract is stable across renders — locator([data-truncated='true'][data-original-bytes='20480']) and [data-action='show-full'][data-seq='1'] match the RED test verbatim."
  - "api.get<T>() in UI components unwraps ApiResponse<T>; callers receive the T payload directly and rely on try/catch for failures. Future 'show full' style affordances (e.g. comment-edit history) can reuse this exact pattern."
  - "grep-guard CI step as a cheap invariant enforcer: a single yaml block with an inline shell `if grep ...; then exit 1` is faster and more auditable than a custom checker script. Pattern scales to any security invariant the team needs to enforce on every PR (e.g. 'no eval(', 'no new Function(')."

requirements-completed: [UI-07]

# Metrics
duration: ~20 min
completed: 2026-04-17
---

# Phase 24 Plan 04: TruncationMarker Component + CI dangerouslySetInnerHTML Guard — UI-07 / UX6 Closed

**Shipped the TruncationMarker affordance + the CI invariants that keep dangerouslySetInnerHTML and out-of-band react-markdown imports out of the issue-detail subtree. TaskMessageItem now renders the real marker (not the Wave 2 stub), fetches full content through the shared api.get<T>() wrapper, and lifts the uncapped TaskMessage back via onLoad so the body re-renders through the single SafeMarkdown / <pre> sanitization path — zero innerHTML anywhere. Playwright "truncation marker" green; all 5 prior Phase 24 scenarios still green; Phase 23 kanban suite unchanged.**

## Performance

- **Duration:** ~20 min (2 tasks)
- **Started:** 2026-04-17
- **Completed:** 2026-04-17
- **Tasks:** 2 (RED already shipped as commit d1206f2 in the prior executor session; this run completed the GREEN work)
- **Files modified:** 3 (1 created, 2 modified) + this SUMMARY
- **Commits:** 2 new (b9701b1 GREEN + 118d8be CI)

## Commits

- **d1206f2** `test(24-04): un-skip truncation marker scenario (RED) (UI-07 / UX6)` — SHIPPED IN PRIOR SESSION. Seeds 20 KB truncated row + overflow via writeDb, asserts `[data-truncated="true"][data-original-bytes="20480"]` marker, clicks `[data-action="show-full"][data-seq="1"]`, confirms full body renders, Collapse reverts. Spec navigates to `http://localhost:5173` (Vite dev) so the API base is the `/api` proxy path.
- **b9701b1** `feat(24-04): TruncationMarker component + full-content fetch + wire into TaskMessageItem (UI-07 / UX6)` — NEW. Added `apps/web/src/components/issues/detail/TruncationMarker.tsx` and replaced `TruncationMarkerPlaceholder` in `TaskMessageItem.tsx` with the real wiring (fullOverride state, marker render on text/thinking/tool_use/tool_result, 256 KB client-render cap with FurtherClippedNotice).
- **118d8be** `ci(24-04): guard dangerouslySetInnerHTML + react-markdown import invariants (UI-07 / UX6)` — NEW. Appended two grep-guard steps to `.github/workflows/ci.yml` after the existing `check:i18n` step.

## Accomplishments

### TruncationMarker component (`apps/web/src/components/issues/detail/TruncationMarker.tsx` — new, 116 lines)

- Renders a single `<span data-truncated="true" data-original-bytes={totalBytes}>` containing the localized "⋯ truncated (showing {shown} of {total} bytes)" copy and a button that toggles between Show-full (collapsed) and Collapse (expanded) states.
- `handleShowFull` calls `api.get<TaskMessage>('/tasks/' + taskId + '/messages/' + seq + '/full')` — string concat keeps the `/messages/` grep-invariant from the plan's key_links frontmatter trivially auditable.
- On success: `onLoad(full)` lifts the full TaskMessage to the parent. On `ApiError`: fires a sonner `toast.error` using the localized `showFullFailed` copy plus the server reason as a description line; the button stays clickable to retry.
- `loading` state disables the button and swaps text to `showFullLoading`, so double-click can't re-trigger the fetch.
- Zero direct rendering of agent content. The component only paints the marker copy + button; full payload rendering is the parent's job (preserves UX6's single sanitization entry point).

### TaskMessageItem rewiring (`apps/web/src/components/issues/detail/TaskMessageItem.tsx` — modified)

- Dropped `TruncationMarkerPlaceholder` entirely; imported the real `TruncationMarker`.
- Added per-row `fullOverride: useState<TaskMessage | null>(null)` so the body re-renders against the uncapped payload once Show-full lands. `effective = fullOverride ?? message` pipes through all four case branches.
- Marker render site: text / thinking / tool_use / tool_result when `message.metadata?.truncated === true`. `error` kind skipped (always tiny per the per-kind table).
- `markerBytes = useMemo(...)` computes `shown` from `new Blob([body]).size` of the currently-rendered payload and reads `total` from `metadata.originalBytes`. The memo depends on `effective` so shown reflects the expanded payload after Show-full.
- Client 256 KB render cap via `clipForRender`: if `byteLength(body) > CLIENT_RENDER_CAP_BYTES`, slice to a 128 Ki char safe prefix and render a `<span data-further-clipped="true">(further clipped for rendering)</span>` notice below. Defence-in-depth against an adversarial overflow row slipping past the server's 1 MB cap.
- `memo` compare unchanged: `id + seq + metadata.truncated + isLatest`. The new `fullOverride` state is local and not a prop, so it survives virtualizer-driven parent re-renders.

### CI guard (`.github/workflows/ci.yml` — modified)

- **Step 1 — "Check no dangerouslySetInnerHTML in issue detail":** `grep -rn "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/ apps/web/src/pages/IssueDetailPage.tsx` → exit 1 on any hit. Promotes the UX6 invariant from "tested locally" to "enforced on every PR".
- **Step 2 — "Check ReactMarkdown usage goes through SafeMarkdown":** `grep -rln "from 'react-markdown'" ... | grep -v markdown.tsx` → exit 1 if any file in detail/ (except the SafeMarkdown wrapper) imports react-markdown. Closes the tampering loophole where an engineer could reintroduce an unsanitized render path by side-stepping SafeMarkdown.
- Verified locally: both steps print their "OK:" line and exit 0 on the current tree.

### i18n

- No new keys added. Wave 0 already shipped `issues.detail.task.truncated` / `showFull` / `showFullLoading` / `showFullFailed` / `collapse` in all 6 locales. `node apps/web/scripts/check-i18n-parity.mjs` reports 2053 keys checked across 6 locales.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Worktree was on the wrong commit when executor started**
- **Found during:** Initial worktree_branch_check.
- **Issue:** Worktree HEAD was at `fb47148` (main tip before Phase 21+) rather than the post-RED `d1206f271118098540321e756cf8b71f6eb87ab9` that the prior executor had committed on the main workspace branch. The spec required the worktree to be based on the RED commit so GREEN work would stack cleanly on top.
- **Fix:** Ran the spec's prescribed `git reset --hard d1206f271118098540321e756cf8b71f6eb87ab9`. Confirmed HEAD moved to the RED commit with the un-skipped Playwright test present.
- **Files modified:** None (working-tree state only).
- **Commit:** N/A (pre-work state adjustment).

### Adaptations from plan text

**2. [Rule 1 - Bug] api.get<T>() return-shape mismatch in plan pseudo-code**
- **Found during:** Writing TruncationMarker.tsx per the plan's example snippet.
- **Issue:** The plan's pseudo-code was `if (!res.ok || !res.data) throw new Error(res.error ?? 'load failed')` — but `apps/web/src/api.ts`'s `get<T>(): Promise<T>` already unwraps ApiResponse and throws `ApiError` on failure. Calling `!res.ok` on an unwrapped `TaskMessage` would be a type error and defeat the wrapper's contract.
- **Fix:** Used `const full = await api.get<TaskMessage>(...); onLoad(full);` inside try/catch with `ApiError`-aware toast description. Matches the existing pattern in `useTaskStream.ts:144`.
- **Files modified:** apps/web/src/components/issues/detail/TruncationMarker.tsx
- **Commit:** b9701b1

**3. [Rule 2 - Missing critical functionality] onCollapse prop required, not optional**
- **Found during:** Writing TruncationMarker.tsx.
- **Issue:** The plan's interface declared `onCollapse?: () => void` (optional), but every call site in TaskMessageItem always passes it. Leaving it optional hides the hard contract — a future refactor could drop it and break Collapse silently.
- **Fix:** Made `onCollapse: () => void` required. All current call sites already pass it, so this is a type-tightening that surfaces misuse at compile time.
- **Files modified:** apps/web/src/components/issues/detail/TruncationMarker.tsx
- **Commit:** b9701b1

## Threat Model

Threats from the plan's `<threat_model>` (T-24-04-01 through T-24-04-04) are all mitigated:

| Threat ID | Disposition | Mitigation status |
|-----------|-------------|-------------------|
| T-24-04-01 (XSS via expanded render) | mitigate | Full content still flows through SafeMarkdown / `<pre>`. Grep guard in CI fails on any dangerouslySetInnerHTML introduction. |
| T-24-04-02 (DoS from 1 MB+ /full response) | mitigate | Server caps /full at FULL_MESSAGE_ABSOLUTE_CAP_BYTES (1 MB, Wave 0). Client further-clips at CLIENT_RENDER_CAP_BYTES (256 KB) with a FurtherClippedNotice so the DOM stays responsive. |
| T-24-04-03 (CI guard leaks dir layout) | accept | Grep paths are public repo content. |
| T-24-04-04 (Tampering via sibling react-markdown import) | mitigate | Second CI step forbids `from 'react-markdown'` in any detail/ file except markdown.tsx. |

No new threat surface introduced by this wave.

## Verification

### Automated checks (all exit 0)

```
npm run build -w @aquarium/shared    → exit 0
npm run typecheck -w @aquaclawai/aquarium    → exit 0
npm run build:ce -w @aquarium/web    → exit 0 (2.64s)
node apps/web/scripts/check-i18n-parity.mjs    → OK: 2053 keys across 6 locales
grep -rn "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/ apps/web/src/pages/IssueDetailPage.tsx    → no matches
grep -rln "from 'react-markdown'" apps/web/src/components/issues/detail/ | grep -v markdown.tsx    → empty
```

### Playwright

- `npx playwright test tests/e2e/issue-detail.spec.ts -g "truncation marker"` → **1 passed** (2.7s)
- `npx playwright test tests/e2e/issue-detail.spec.ts -g "issue detail renders|threaded comments|task stream live|reconnect replay|replay no reorder"` → **5 passed** (12.0s)
- `npx playwright test tests/e2e/issues-board.spec.ts` (Phase 23 kanban regression) → **8 passed** (40.1s)

### Acceptance grep invariants

```
grep -c "export function TruncationMarker" apps/web/src/components/issues/detail/TruncationMarker.tsx    → 1  ✓
grep -c "<TruncationMarker" apps/web/src/components/issues/detail/TaskMessageItem.tsx    → 5  ✓ (>=1)
grep -c "TruncationMarkerPlaceholder" apps/web/src/components/issues/detail/TaskMessageItem.tsx    → 0  ✓
grep -rc "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/    → 0  ✓ (HARD)
grep -c "test.skip" tests/e2e/issue-detail.spec.ts    → 2  ✓ (<=3)
grep -c "Check no dangerouslySetInnerHTML" .github/workflows/ci.yml    → 1  ✓
grep -c "Check ReactMarkdown usage goes through SafeMarkdown" .github/workflows/ci.yml    → 1  ✓
```

## Self-Check: PASSED

- TruncationMarker.tsx created at `apps/web/src/components/issues/detail/TruncationMarker.tsx` — FOUND
- TaskMessageItem.tsx modified to wire TruncationMarker + drop placeholder — FOUND
- .github/workflows/ci.yml updated with 2 new guard steps — FOUND
- Commit b9701b1 present in `git log` — FOUND
- Commit 118d8be present in `git log` — FOUND
- Prior commit d1206f2 (RED) still present — FOUND
- Playwright "truncation marker" scenario exits 0 — CONFIRMED
- All 5 prior Phase 24 scenarios still green — CONFIRMED
- Phase 23 kanban suite still green — CONFIRMED
