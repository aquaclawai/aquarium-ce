---
phase: 23-issue-board-ui-kanban
plan: 00
subsystem: ui
tags: [dnd-kit, @tanstack/react-virtual, i18next, websockets, ci, z-index-ladder, kanban, foundation]

# Dependency graph
requires:
  - phase: 17-agent-issue-comment-services
    provides: Issue store, POST /reorder endpoint, issue:created|updated|deleted|reordered + task:cancelled WS broadcast contract
provides:
  - "5 pinned npm deps for DnD + virtualization + a11y announcer installed in @aquarium/web"
  - "Z-index CSS ladder (10 rungs: --z-base..--z-critical-alert) in apps/web/src/index.css"
  - "Sonner Toaster respects the new ladder via zIndex: var(--z-toast)"
  - "i18n parity script + CI gate preventing future 6-locale drift"
  - "Pre-existing 3974-key drift backfilled across zh/fr/de/es/it (parity script now exits 0)"
  - "WsEventType shared union extended with issue:created|updated|deleted|reordered + task:cancelled"
  - "WsMessage.payload relaxed to optional + issueId?/taskId? fields added"
  - "apps/web/src/components/issues/ directory scaffolded for downstream plans"
  - "tests/e2e/issues-board.spec.ts scaffold with 8 skipped scenarios matching VALIDATION.md titles verbatim"
  - "A1 (WS subscribe semantics) verified and documented — plan 23-01 can call subscribe('AQ') without inventing a new subscribeWorkspace method"
affects: [23-01 board shell + read-only render, 23-02 DnD reorder, 23-03 virtualization, 23-04 a11y + keyboard, 23-05 i18n rollout, 24-issue-detail, 25-management-pages]

# Tech tracking
tech-stack:
  added:
    - "@dnd-kit/core@^6.3.1"
    - "@dnd-kit/sortable@^10.0.0"
    - "@dnd-kit/utilities@^3.2.2"
    - "@dnd-kit/accessibility@^3.1.1"
    - "@tanstack/react-virtual@^3.13.24"
  patterns:
    - "Z-index ladder via CSS variables — no raw z-index numbers in new code"
    - "i18n parity script enforced in CI — 6 locales mandatory"
    - "WsMessage.payload is optional — consumers guard with `if (!payload) return;` or conditional checks"

key-files:
  created:
    - ".planning/phases/23-issue-board-ui-kanban/23-00-A1-VERIFIED.md"
    - "apps/web/scripts/check-i18n-parity.mjs"
    - "apps/web/src/components/issues/.gitkeep"
    - "tests/e2e/issues-board.spec.ts"
  modified:
    - "apps/web/package.json (add 5 deps + check:i18n npm script)"
    - "apps/web/src/index.css (z-index ladder CSS vars)"
    - "apps/web/src/components/ui/sonner.tsx (zIndex: var(--z-toast))"
    - "apps/web/src/i18n/locales/{en,zh,fr,de,es,it}.json (backfilled 3974 missing keys)"
    - ".github/workflows/ci.yml (check-i18n step after lint)"
    - "packages/shared/src/types.ts (WsEventType + WsMessage)"
    - "apps/web/src/pages/{ChatHubPage,DashboardPage,MyAssistantsPage,InstancePage}.tsx (payload null guards)"

key-decisions:
  - "Added 5 new literals to WsEventType additively (issue:created|updated|deleted|reordered, task:cancelled) — no breaking change to existing server/client code"
  - "Relaxed WsMessage.payload to optional because routes/issues.ts line 169 broadcasts issue:deleted with no payload field; added issueId?/taskId? to match server reality"
  - "Backfilled pre-existing 6-locale drift using en-first → any-other-locale → key-as-placeholder chain so parity script exits 0 today. Preserved every existing translation string."
  - "Verified A1 (WS subscribe semantics) via direct read of apps/server/src/ws/index.ts:115-121 — confirmed existing subscribe(instanceId) method CAN be called with workspace id 'AQ'. No new subscribeWorkspace method required."

patterns-established:
  - "Pattern: z-index ladder (UX3) — use var(--z-drag-overlay), var(--z-toast), etc. Never pick a raw number."
  - "Pattern: i18n parity enforced by CI — adding a new t('key') requires adding the key to all 6 locales or CI fails."
  - "Pattern: WS handlers on the web must null-check message.payload because the shared type now models reality (issue:deleted has no payload)."

requirements-completed: [UI-01, UI-02, UI-03]

# Metrics
duration: ~22 min
completed: 2026-04-17
---

# Phase 23 Plan 00: Issue Board UI Foundation Summary

**Installed the 5-piece DnD + virtualization + a11y dependency set, shipped a 10-rung z-index ladder + i18n parity CI gate, extended the shared WsEventType for Phase 17's issue:*/task:cancelled broadcasts, verified WS subscribe semantics (A1), and scaffolded the board components + Playwright spec so plans 23-01 through 23-05 are trivially mergeable.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-17T14:37Z (approx)
- **Completed:** 2026-04-17T14:59:08Z
- **Tasks:** 2
- **Files modified:** 21 (6 created, 15 updated)
- **Commits:** 2 task commits + 1 pending metadata commit (this SUMMARY)

## Accomplishments

- Five pinned DnD + virtualization + a11y deps installed in @aquarium/web at the exact versions from 23-RESEARCH §Standard Stack (@dnd-kit/core@6.3.1, sortable@10.0.0, utilities@3.2.2, accessibility@3.1.1, @tanstack/react-virtual@3.13.24). Total ~28 KB gzipped per research estimate.
- Z-index CSS ladder established in apps/web/src/index.css (10 rungs, --z-base through --z-critical-alert) — Toaster migrated to var(--z-toast) so toast stacking survives drag overlays (UX3 mitigation).
- i18n parity script (apps/web/scripts/check-i18n-parity.mjs, 107 LOC, zero runtime deps beyond Node builtins) + CI step wired. The script scans apps/web/src/**/*.{ts,tsx} for t('key') and i18nKey="key" patterns, unions them with each locale's flattened keys, and fails when any locale is missing any key. UX5 mitigation active on every push.
- Backfilled 3974 pre-existing locale gaps (787 keys missing from each of de/es/fr/it, 170 from zh) using en-first fallback chain. Every pre-existing non-English translation preserved.
- packages/shared/src/types.ts WsEventType extended additively with 5 new literals (issue:created, issue:updated, issue:deleted, issue:reordered, task:cancelled). WsMessage.payload relaxed to optional (matches routes/issues.ts line 169 reality); issueId?/taskId? added for board handlers to read without casts.
- apps/web/src/components/issues/ directory scaffolded via .gitkeep; tests/e2e/issues-board.spec.ts created with 8 skipped scenarios matching VALIDATION.md titles verbatim (renders columns, mouse drag, concurrent reorder, own echo, virtualization, virtualization drag, keyboard drag, a11y announcer). Plans 23-01 through 23-04 remove .skip() per scenario as they wire implementations.
- A1 (WS subscribe semantics) verified by direct read of apps/server/src/ws/index.ts:115-121 — broadcast() filters on client.instanceSubscriptions.has(instanceId); Phase 17 broadcasts with workspace id 'AQ' as that key. Finding documented in 23-00-A1-VERIFIED.md so plan 23-01 calls subscribe('AQ') without inventing a new subscribeWorkspace method.

## Task Commits

1. **Task 1: Install deps + extend shared WsEventType + scaffold component dir + Playwright spec stub + A1 doc** — `0dff5bf` (feat)
2. **Task 2: Z-index CSS ladder + Toaster migrate + i18n parity script + CI wiring + payload null-guard fixes** — `7fc058d` (feat)

Metadata commit for this SUMMARY.md will be created by the orchestrator.

## Files Created/Modified

### Created
- `.planning/phases/23-issue-board-ui-kanban/23-00-A1-VERIFIED.md` — WS subscribe semantics verification note for plan 23-01 consumption
- `apps/web/scripts/check-i18n-parity.mjs` — Node-builtin-only i18n parity guard (107 LOC)
- `apps/web/src/components/issues/.gitkeep` — reserve directory for plans 23-01..23-04
- `tests/e2e/issues-board.spec.ts` — Playwright spec scaffold with 8 skipped scenarios

### Modified
- `apps/web/package.json` — 5 new deps + check:i18n script
- `apps/web/src/index.css` — z-index ladder added inside :root (10 new CSS vars, theme-invariant)
- `apps/web/src/components/ui/sonner.tsx` — zIndex: var(--z-toast) added; every pre-existing style key preserved
- `apps/web/src/i18n/locales/{en,zh,fr,de,es,it}.json` — 3974 backfill entries added across 6 locales; existing translations preserved byte-for-byte
- `.github/workflows/ci.yml` — "Check i18n parity" step appended after "Lint"
- `packages/shared/src/types.ts` — WsEventType +5 literals, WsMessage.payload relaxed to optional, +issueId?/taskId?
- `apps/web/src/pages/ChatHubPage.tsx` — handleStatusUpdate payload null-guard (Rule 3 fix)
- `apps/web/src/pages/DashboardPage.tsx` — handleStatusUpdate payload null-guard (Rule 3 fix)
- `apps/web/src/pages/MyAssistantsPage.tsx` — handleStatusUpdate payload null-guard (Rule 3 fix)
- `apps/web/src/pages/InstancePage.tsx` — 3 handler null-guards: handleStatusUpdate, handleExecApprovalResolved, handleSecurityEvent (Rule 3 fix)
- `package-lock.json` — lockfile updated by `npm install`

## Decisions Made

- **Additive-only WsEventType extension:** chose to widen the union with 5 new literals rather than introducing a separate Board-only event type. This matches Phase 17's already-shipped server broadcasts verbatim and avoids any duplication. Gated by plan threat T-23-00-06 (Spoofing → accept: purely additive, no runtime change).
- **Relaxing WsMessage.payload to optional:** plan Step 2 mandated this based on routes/issues.ts line 169 (`issue:deleted` broadcasts with no payload). Verified downstream consumers: 4 files / 11 usage sites needed null-guards, all in the web workspace; server typecheck stayed clean because server only READs from the routes side. Tracked as threat T-23-00-05 (mitigate).
- **i18n backfill strategy:** EN-first fallback → any-other-locale → key-as-placeholder. Preserves every existing translation while making the parity script green today. The single conflict class (`wizard.confirm.temperature` object vs. sibling `temperatureCurrent` string) is benign — only the object form is actually rendered via sub-keys.
- **A1 resolution:** confirmed by direct code read that the existing `subscribe(instanceId)` method accepts ANY string key and compares against the same set the server broadcasts to. No client-side API change needed for plan 23-01; documented inline in 23-00-A1-VERIFIED.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added message.payload null-guards at 5 pre-existing consumer sites**
- **Found during:** Task 2 (first full web build after shared types rebuilt)
- **Issue:** Making `WsMessage.payload` optional (required by plan Step 2 to match `issue:deleted` server reality) surfaced 11 TS18048 errors in four existing page components that dereferenced `message.payload` without a null check. This was the expected cost flagged in threat T-23-00-05 and had to be fixed before the web build would pass.
- **Fix:** Added `if (!payload) return;` (or `&& message.payload` in an existing condition) at exactly the touched sites; no logic change — payload always populated for `instance:status`, `instance:exec_approval_resolved`, `security_event` at runtime, so the guards only defend the type.
- **Files modified:** `apps/web/src/pages/ChatHubPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/MyAssistantsPage.tsx`, `apps/web/src/pages/InstancePage.tsx`
- **Verification:** `npm run build:ce -w @aquarium/web` → 0 errors; `npm run typecheck -w @aquaclawai/aquarium` → 0 errors; `npm run lint -w @aquarium/web` → 0 errors, 25 pre-existing warnings unrelated to this plan.
- **Committed in:** `7fc058d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Single anticipated consequence of the WsMessage.payload relaxation. Fully contained to 4 files; no scope creep.

## Issues Encountered

- **Pre-existing i18n drift at 3974 key-gaps.** The plan allowed this: *"If the current codebase already has drift, patch ONLY what is needed to make the script green; preserve non-English translation strings where they exist."* Resolved via one-shot backfill helper that ran once and was then discarded. Not a bug against Phase 23 — it's a pre-existing state surfaced by the new guard. Every existing translation preserved (verified by spot-check of zh.common.buttons → Chinese strings intact).
- **Skill-injection notices flagged Next.js patterns irrelevant to this Vite + Express project.** Ignored by design — the project is a TypeScript monorepo with Vite frontend and Express backend (documented in CLAUDE.md: "no external auth provider"), not Next.js.

## User Setup Required

None — no external service configuration required. The new CI step runs inside the existing GitHub Actions sandbox (no new secrets, no new permissions).

## Next Phase Readiness

**Ready for plan 23-01** (Wave 1 — board shell + read-only render):
- Deps installed: 23-01 can `import { DndContext, ... } from '@dnd-kit/core'` immediately.
- WsEventType covers issue:* + task:cancelled: 23-01's `addHandler('issue:reordered', ...)` will typecheck.
- A1 documented: 23-01 calls `subscribe('AQ')` on mount; `unsubscribe('AQ')` on unmount. See 23-00-A1-VERIFIED.md.
- Playwright scenario `renders columns` scaffolded — 23-01 replaces `test.skip()` with the real assertion.
- apps/web/src/components/issues/ exists — 23-01 writes IssueBoard.tsx, IssueColumn.tsx, IssueCard.tsx, useIssueBoard.ts, useBoardReconciler.ts into it.
- Z-index ladder live — 23-01's DragOverlay uses `style={{ zIndex: 'var(--z-drag-overlay)' }}` per 23-UI-SPEC §Z-Index Ladder.
- Sidebar nav entry + i18n key `sidebar.issues` — 23-01 adds this. The parity script will fail loudly if any of the 6 locales miss it, enforcing the 6-locale discipline at the plan boundary.

**No blockers or concerns carried forward.**

## Self-Check: PASSED

**Files verified on disk:**
- FOUND: `.planning/phases/23-issue-board-ui-kanban/23-00-A1-VERIFIED.md`
- FOUND: `apps/web/scripts/check-i18n-parity.mjs`
- FOUND: `apps/web/src/components/issues/.gitkeep`
- FOUND: `tests/e2e/issues-board.spec.ts`
- FOUND: `apps/web/src/i18n/locales/{en,zh,fr,de,es,it}.json` (all 6)
- FOUND: updated `apps/web/package.json`, `apps/web/src/index.css`, `apps/web/src/components/ui/sonner.tsx`, `packages/shared/src/types.ts`, `.github/workflows/ci.yml`

**Commits verified:**
- FOUND: `0dff5bf` — Task 1 commit (feat: install deps + extend WsEventType + scaffolds)
- FOUND: `7fc058d` — Task 2 commit (feat: z-index + Toaster + parity + CI + null-guard fixes)

**Runtime verifications:**
- `node apps/web/scripts/check-i18n-parity.mjs` exits 0 with `OK: 1927 keys checked across 6 locales`
- `npm run build -w @aquarium/shared` exits 0
- `npm run typecheck -w @aquaclawai/aquarium` exits 0
- `npm run build:ce -w @aquarium/web` exits 0 (with standard chunk-size warnings only)
- `npm run lint -w @aquarium/web` exits 0 errors / 25 pre-existing warnings

---
*Phase: 23-issue-board-ui-kanban*
*Completed: 2026-04-17*
