---
phase: 25
plan: 01
subsystem: management-uis
tags: [wave-1, agents, MGMT-01, SC-1, status-column]
dependency-graph:
  requires:
    - Phase 25 Wave 0 scaffold (routes, sidebar nav, i18n namespaces, CI guards)
    - Phase 17 /api/agents REST endpoints (list/create/patch/archive/restore)
    - Phase 16 /api/runtimes endpoint (runtime-kind icon rendering)
    - Phase 18 shadcn primitives (Table, Dialog, Dropdown, Badge, Tabs, Tooltip, Select, ScrollArea, Separator, Skeleton, Button, Input)
    - Phase 23 sidebar nav + AppLayout
    - Phase 24 SafeMarkdown pattern (reserved for future agent-instructions preview)
    - packages/shared/src/v14-types.ts::AgentStatus enum (5 values)
  provides:
    - Fully functional /agents surface — list with SC-1 Status column, create + edit form, archive + restore dialogs, Active/Archived tab UX
    - AgentList component with data-agent-row + data-agent-status-badge markers
    - AgentFormDialog with full MGMT-01 form field set (name, instructions, runtime, customEnv, customArgs, maxConcurrentTasks)
    - ArchiveConfirmDialog (destructive + positive modes) for archive / restore
    - useAgents hook (fetch + mutations + refetch-on-success)
    - Shared `time.ts` helper (Intl.RelativeTimeFormat + absolute-time formatter) and `EmptyState` component — consumed by Waves 2 + 3
    - Playwright scenarios un-skipped: `agents list renders`, `agent form create`, `agent archive`
  affects:
    - Plan 25-02 (Runtimes UI) — reuses `time.ts` + `EmptyState` verbatim
    - Plan 25-03 (Daemon Tokens UI) — reuses `time.ts` + `EmptyState` verbatim + ArchiveConfirmDialog pattern for Revoke
    - Plan 25-04 (translations) — no new i18n keys introduced (all 145 keys landed in Wave 0)
tech-stack:
  added: []
  patterns:
    - "SC-1 Status column: fixed 5-enum variant map (idle→secondary, working→default, blocked→outline, error→destructive, offline→outline) rendered as <Badge data-agent-status-badge={status}> with i18n-driven labels from management.agents.status.*"
    - "Radix Select empty-value sentinel: `__none__` translates to null at the boundary (Radix disallows empty-string value prop — this is the only way to represent 'No runtime' in a Select)"
    - "CustomEnvEditor controlled-uncontrolled hybrid: re-seeds from parent only when content meaningfully differs, preventing parent re-renders with identity-new-but-equal {} from clobbering in-flight empty rows the user just added"
    - "AgentRow React.memo comparator on (agent.id, agent.updatedAt, agent.status, runtime fields, locale) — status changes force re-render while pure rerenders from sibling-row mutation do not"
    - "Archive semantics: DELETE /api/agents/:id is soft-archive (server sets archived_at); row disappears from Active tab and reappears in Archived tab with opacity-70 muted styling plus supplemental Archived badge — Status column still renders the Agent.status enum for archived agents (the two indicators are complementary)"
    - "Playwright Radix Select workaround: dispatchEvent('click') on the portal option bypasses Playwright's viewport-check heuristic which misreports portalled content as 'outside viewport' when positioned above the trigger"
    - "sr-only live region announcer: management.agents.a11y.{saved,archived,restored} pushed to <div role=status aria-live=polite> — no plaintext-token concerns in this plan, announcer is simple name-interpolation only"
key-files:
  created:
    - apps/web/src/components/management/AgentList.tsx
    - apps/web/src/components/management/AgentFormDialog.tsx
    - apps/web/src/components/management/CustomEnvEditor.tsx
    - apps/web/src/components/management/CustomArgsEditor.tsx
    - apps/web/src/components/management/ArchiveConfirmDialog.tsx
    - apps/web/src/components/management/useAgents.ts
    - apps/web/src/components/management/EmptyState.tsx
    - apps/web/src/components/management/time.ts
  modified:
    - apps/web/src/pages/AgentsPage.tsx
    - tests/e2e/management-uis.spec.ts
decisions:
  - "Default maxConcurrentTasks = 6 in the form (matches agent-store.ts server default) rather than 1 from the plan text — keeps the client optimistic default identical to the server's fallback so a user who never touches the spinner produces the same row the server would without them"
  - "Radix Select uses `__none__` sentinel for 'No runtime' option — Radix throws at runtime if SelectItem value is empty string"
  - "AgentList Archived-tab row keeps the full Status column rendering (not replaced by the Archived badge). The Archived badge is supplemental lifecycle state (the user archived this row); the Status column is the agent-runtime state (idle/working/blocked/error/offline) — two independent axes, both shown"
  - "CustomEnvEditor content-equality re-seed vs reference-equality re-seed: prevents losing newly-added empty rows after parent re-renders with a new-object-but-equal {} — a subtle bug caught only after Playwright clicked Add variable 100× and no row materialized"
  - "Playwright test 'agents list renders' does not assert empty Archived tab — other test suites (Phase 24) leave archived agents in the DB; we instead assert the Archived tab activates correctly"
metrics:
  duration: "~70 minutes"
  completed: 2026-04-17
  tasks: 3
  files: 10
  commits: 3
---

# Phase 25 Plan 01: Agents Management UI Summary

Delivered the complete MGMT-01 surface — list with SC-1 Status column, create + edit form dialog, archive + restore confirmation dialogs, Active/Archived tab UX, and 3 green Playwright scenarios — so users can browse / create / edit / archive / restore Agents end-to-end without any "v1 simplified" gaps.

## Artifacts Created (8 new files)

### Components

| File | Purpose |
| ---- | ------- |
| `apps/web/src/components/management/AgentList.tsx` | shadcn Table with 6 columns (Name / Runtime / **Status** / MaxConcurrent / Updated / Actions). Status column (ROADMAP SC-1, Blocker-3 fix) renders `agent.status` as `<Badge data-agent-status-badge={status}>` with fixed 5-enum variant map. `<th data-column="status">` marker lets Playwright assert the column exists without locale-dependent visible-text matching. AgentRow memoized on `(id, updatedAt, status, runtime fields, locale)`. |
| `apps/web/src/components/management/AgentFormDialog.tsx` | Full create+edit form Dialog. Fields: name (required), instructions (Textarea with counter past 3500 chars), runtime (Radix Select with `__none__` sentinel), customEnv (key-value editor), customArgs (tag input), maxConcurrentTasks (number 1..16). Maps server 400 UNIQUE collision to localized `nameCollision` copy. |
| `apps/web/src/components/management/CustomEnvEditor.tsx` | Key-value row editor with duplicate-key warning (last-write-wins semantics match server). Content-equality re-seed prevents clobbering user-added empty rows. |
| `apps/web/src/components/management/CustomArgsEditor.tsx` | Tag-input. Enter adds trimmed value; Backspace on empty input removes last tag; per-tag × button with localized aria-label. |
| `apps/web/src/components/management/ArchiveConfirmDialog.tsx` | Destructive (archive) + positive (restore) confirmation Dialog. Cancel autoFocuses per UI-SPEC §Keyboard. Awaits onConfirm; parent keeps dialog open on error. |
| `apps/web/src/components/management/useAgents.ts` | Data hook — `GET /agents` + `GET /agents?includeArchived=true` on mount, refetch on every mutation. Exposes `{ active, archived, isLoading, error, refetch, create, update, archive, restore }`. Swallows ApiError into error state. |
| `apps/web/src/components/management/EmptyState.tsx` | Shared card-styled empty state — icon + heading + body + optional CTA. Forwards `data-empty-${marker}` for Playwright. Consumed by Waves 2 + 3. |
| `apps/web/src/components/management/time.ts` | `formatRelativeTime` (via `Intl.RelativeTimeFormat` narrow style with English fallback) + `formatAbsoluteTime` (via `Intl.DateTimeFormat` medium+short). Used by AgentList Updated column; reserved for RuntimeList + DaemonTokenList in Waves 2+3. |

### Page wiring

- `apps/web/src/pages/AgentsPage.tsx` — replaces Wave 0 stub. Orchestrates the whole surface:
  - Search toolbar (client-side name filter) + "New agent" primary CTA
  - Active/Archived `<Tabs>` with `data-agent-tab="active|archived"` triggers
  - URL deep-link: `?tab=archived` selects the Archived tab on mount; tab change replaces the URL
  - Mounts `<AgentFormDialog>` + `<ArchiveConfirmDialog>` + sr-only live region for a11y announcements

### Playwright

- `tests/e2e/management-uis.spec.ts` — un-skipped 3 scenarios; remaining 6 stay `.skip()`ed for Waves 2-3.
  - `agents list renders` — seeds 3 agents via POST, asserts all 3 rows visible with SC-1 status badges + `data-column="status"` header + Archived tab activates
  - `agent form create` — opens dialog, fills every field (incl. Radix Select via dispatchEvent workaround + env row + custom arg tag + maxConcurrent=4), submits, DB verify on customEnv / customArgs / maxConcurrentTasks round-trip
  - `agent archive` — opens row dropdown → Archive, confirms dialog, asserts row disappears from Active + appears in Archived + `archived_at` non-null in DB

## Files Modified

| File | Change |
| ---- | ------ |
| `apps/web/src/pages/AgentsPage.tsx` | Wave 0 stub → full page with AgentList + tabs + form dialog + archive dialog + sr-announcer |
| `tests/e2e/management-uis.spec.ts` | 3 scenarios un-skipped (`agents list renders`, `agent form create`, `agent archive`) — scaffold helper references + describe structure preserved byte-for-byte; only the 3 target test bodies changed |

## Data-Attribute Markers Applied

### AgentList (Task 1)

| Marker | On element |
| ------ | ---------- |
| `data-agent-row={agent.id}` | `<TableRow>` per agent |
| `data-agent-status-badge={agent.status}` | Per-row `<Badge>` in Status column (SC-1) |
| `data-column="status"` | Status column `<TableHead>` — locale-independent column-exists assertion |
| `data-agent-actions-trigger={agent.id}` | Per-row `<MoreHorizontal>` dropdown trigger |
| `data-agent-action="edit"` / `archive"` / `restore"` | DropdownMenuItem entries |
| `data-empty-agents` / `data-empty-agents-archived` / `data-empty-agents-no-matches` | EmptyState card outer element |

### AgentsPage (Task 1)

| Marker | On element |
| ------ | ---------- |
| `data-page="agents"` | Page root `<main>` (Wave 0 marker reused) |
| `data-agent-tab="active"` / `data-agent-tab="archived"` | Tab triggers |
| `data-agent-new-open` | "New agent" primary CTA in toolbar |

### AgentFormDialog (Task 2)

| Marker | On element |
| ------ | ---------- |
| `data-agent-form-field="name"` | Name `<Input>` (autoFocus) |
| `data-agent-form-field="instructions"` | Instructions `<textarea>` |
| `data-agent-form-field="runtime"` | Runtime `<SelectTrigger>` |
| `data-agent-form-field="maxConcurrent"` | Max concurrent number `<Input>` |
| `data-agent-form-submit` | Submit button |
| `data-agent-form-cancel` | Cancel button |

### CustomEnvEditor (Task 2)

| Marker | On element |
| ------ | ---------- |
| `data-agent-env-add` | "Add variable" button |
| `data-agent-env-row={index}` | Per-row container |

### CustomArgsEditor (Task 2)

| Marker | On element |
| ------ | ---------- |
| `data-agent-args-input` | Tag-input `<Input>` |
| `data-agent-arg-tag={index}` | Per-tag `<Badge>` |

### ArchiveConfirmDialog (Task 3)

| Marker | On element |
| ------ | ---------- |
| `data-agent-archive-confirm` | Destructive confirm button (archive mode) |
| `data-agent-restore-confirm` | Default-variant confirm button (restore mode) |

## ROADMAP SC-1 Status Column — Fully Closed

The Status column satisfies the `MGMT-01 SC-1 Agents page lists agents with runtime + status + max_concurrent_tasks` requirement with real projection data (not a placeholder):

- **Visible column header:** `<TableHead data-column="status">{t('management.agents.columns.status')}</TableHead>` in every render (loading + data + all empty states preserve the column)
- **Per-row Badge:** `<Badge variant={statusVariant[agent.status]} data-agent-status-badge={agent.status}>{t('management.agents.status.${agent.status}')}</Badge>` with i18n labels pre-seeded by Wave 0 Plan 25-00 Task 1
- **5-enum variant map:**

  | Enum value | Variant | Color intent |
  |------------|---------|--------------|
  | `idle`     | `secondary`   | neutral grey — no active work |
  | `working`  | `default`     | brand primary — active work |
  | `blocked`  | `outline`     | subtle — needs attention but not destructive |
  | `error`    | `destructive` | red — surfaces the problem |
  | `offline`  | `outline`     | muted — no activity |

- **Memoization hook:** `AgentRow` is `React.memo`ized on `(agent.id, agent.updatedAt, agent.status, runtime fields, locale)` — a server-driven status change reliably re-renders the Badge without over-rendering siblings.
- **Playwright coverage:** `agents list renders` asserts `[data-agent-status-badge]` count-per-row and specifically targets `[data-agent-status-badge="${seed.status}"]` (newly-created agents default to `idle` server-side).
- **XSS hardening:** Even if the server ever returns an unknown enum value, react-i18next returns the key as fallback text which React auto-escapes — no user-controlled string can reach the Badge via the status path (threat model T-25-01-07 → accept).

## i18n Key Usage Confirmation

Every user-visible label comes from the `management.agents.*` namespace landed by Wave 0. Plan 25-01 introduces **zero new i18n keys** — Wave 0 front-loaded all 145. Keys consumed:

- Page scaffold: `management.agents.{title, description, actions.create, tabs.active, tabs.archived, filter.search, archived, archivedEmpty, noRuntime}`
- Column headers: `management.agents.columns.{name, runtime, status, maxConcurrent, updated, actions}`
- Empty states: `management.agents.{empty.heading, empty.body, empty.cta, noMatches.heading, noMatches.body, noMatches.clear, archivedEmpty}`
- Form labels/placeholders/hints: `management.agents.form.{titleCreate, titleEdit, name.*, instructions.*, runtime.*, customEnv.*, customArgs.*, maxConcurrent.*, actions.*, validation.*, saveSuccess, saveFailed, nameCollision}`
- Row actions: `management.agents.actions.{edit, archive, restore}`
- Archive/restore confirmation: `management.agents.{archiveConfirm.*, archive.*, restoreConfirm.*, restore.*}`
- **Status enum (SC-1):** `management.agents.status.{idle, working, blocked, error, offline}` — the 5-key Wave 0 pre-seeding is exactly what AgentList consumes via `t(\`management.agents.status.\${agent.status}\`)`
- a11y announcements: `management.agents.a11y.{saved, archived, restored}`
- Runtime-kind labels (in the runtime selector): `management.runtimes.kind.{hostedInstance, localDaemon, externalCloudDaemon}`
- Common: `common.buttons.cancel`

i18n parity: **2231 keys across 6 locales (OK)** — unchanged from Wave 0's baseline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] CustomEnvEditor re-seed clobbered user-added empty rows**
- **Found during:** Task 2 Playwright debugging — `[data-agent-env-add]` button click succeeded but no env row appeared in DOM.
- **Issue:** The original effect re-seeded rows from `value` whenever `value` reference changed. Parent `setValue({ ...v, customEnv: {} })` creates a new `{}` reference on every render, triggering the effect to reset `rows` back to `[]`, erasing the row the user just added.
- **Fix:** Changed the effect to re-seed only when the *content* of `value` meaningfully differs from `toRecord(rows)` (i.e., the parent actually changed what it's asking us to display, as opposed to spitting out an identity-new-but-equal object). Rows with empty keys are not part of `toRecord`'s output so they no longer race with the effect.
- **Files modified:** `apps/web/src/components/management/CustomEnvEditor.tsx`
- **Commit:** `950835b`

**2. [Rule 3 — Blocker] Radix Select portal content misread as "outside viewport" by Playwright**
- **Found during:** Task 2 Playwright run — `getByRole('option').click()` timed out after 100+ scroll-into-view retries even though the option element was attached and visible.
- **Issue:** Radix Select renders option list via portal with absolute positioning. When the trigger is near the dialog's bottom edge, Radix positions the list *above* the trigger (in negative-y relative to the viewport root). Playwright's viewport-check heuristic falsely reports the element as outside the visible region and refuses to click it.
- **Fix:** Use `locator.dispatchEvent('click')` on the option — this bypasses Playwright's viewport check and dispatches the raw `click` event directly, which Radix handles identically to a real click.
- **Files modified:** `tests/e2e/management-uis.spec.ts`
- **Commit:** `950835b`

**3. [Rule 3 — Blocker] Radix Select rejects empty-string value for "No runtime" option**
- **Found during:** AgentFormDialog authoring — runtime selector needs a "None" option but Radix throws if `<SelectItem value="">`.
- **Fix:** Introduced a `NO_RUNTIME_SENTINEL = '__none__'` constant, translated to `null` at the `onValueChange` boundary + from `null` back to the sentinel at the `value` prop. Clean at the Select's edge; API payload still carries `runtimeId: null`.
- **Files modified:** `apps/web/src/components/management/AgentFormDialog.tsx`
- **Commit:** `950835b`

**4. [Rule 3 — Blocker] Archived tab test assumption — other suites leave archived rows behind**
- **Found during:** Task 1 Playwright run — `agents list renders` originally asserted the Archived tab showed the archivedEmpty state, which failed because Phase 24 test suites archive (not hard-delete) their runtime+agent fixtures, leaving 18+ archived agents in the DB.
- **Fix:** The scenario now asserts the Archived tab *activates* (`[data-agent-tab="archived"][data-state="active"]`) rather than renders the empty state. Archived-content assertions are still covered by the `agent archive` test which does a clean seed.
- **Files modified:** `tests/e2e/management-uis.spec.ts`
- **Commit:** `d10c95e`

### Auth Gates

None — the CE auto-auth middleware grants the first user to bearer-less requests, and Playwright runs against `http://localhost:3001` directly.

### Deferred Items

Baseline lint: 28 problems in files outside Plan 25-01's diff (matches Wave 0's `deferred-items.md`). Plan 25-01's own files (8 new + 2 modified) pass `eslint` with zero errors and zero warnings.

## Verify Gate Results

All acceptance criteria green:

| Check | Result |
| ----- | ------ |
| `npm run build -w @aquarium/shared` | exit 0 |
| `npm run typecheck -w @aquaclawai/aquarium` | exit 0 |
| `npm run build:ce -w @aquarium/web` | exit 0 (~3s) |
| `npm run lint -w @aquarium/web` (new+modified files) | exit 0 |
| `node apps/web/scripts/check-i18n-parity.mjs` | exit 0 (2231 keys, 6 locales) |
| `bash -c '! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management'` | exit 0 |
| `bash -c '! grep -rE "localStorage\|sessionStorage" apps/web/src/components/management'` | exit 0 |
| `grep -c 'test.skip(' tests/e2e/management-uis.spec.ts` | 6 (≤ 6) |
| `grep -c "data-agent-row" apps/web/src/components/management/AgentList.tsx` | 1 (≥ 1) |
| `grep -c "data-page=\"agents\"" apps/web/src/pages/AgentsPage.tsx` | 1 |
| `grep -c "data-agent-tab" apps/web/src/pages/AgentsPage.tsx` | 2 (≥ 1) |
| `grep -c "api\.get<Agent\[\]>" apps/web/src/components/management/useAgents.ts` | 2 |
| SC-1 column grep (`Status` or `data-column="status"` or `agent-status-badge`) | match |
| `grep -c data-agent-status-badge` on AgentList.tsx | match |
| `grep -c management.agents.status` on AgentList.tsx | match |
| `grep -c "data-agent-form-submit" AgentFormDialog.tsx` | 1 |
| `grep -c "data-agent-form-field" AgentFormDialog.tsx` | 4 (name, instructions, runtime, maxConcurrent) |
| `grep -c "data-agent-env-add" CustomEnvEditor.tsx` | 1 |
| `grep -c "data-agent-args-input" CustomArgsEditor.tsx` | 1 |
| `grep -c "data-agent-archive-confirm" ArchiveConfirmDialog.tsx` | 1 |
| `grep -c "data-agent-restore-confirm" ArchiveConfirmDialog.tsx` | 1 |
| `grep -c 'variant="destructive"' ArchiveConfirmDialog.tsx` | 2 |
| Playwright `-g "agents list renders\|agent form create\|agent archive"` | 3 passed |
| Full spec (`management-uis.spec.ts`) | 3 passed, 6 skipped |
| Regression: Phase 23 issues-board suite | 8 passed |

## Known Stubs

None. Every field in AgentFormDialog round-trips through real API calls and renders from server-projected data. The Status column reads from `agent.status` which ships real enum values via the `/api/agents` projection.

## Next Wave Readiness

- [x] `time.ts` + `EmptyState.tsx` exported and consumable by Waves 2+3
- [x] AgentFormDialog Radix-Select sentinel pattern reusable for DaemonTokenCreateModal expiry field
- [x] ArchiveConfirmDialog pattern reusable for RevokeConfirmDialog (copy destructive variant, rename markers)
- [x] All 3 Plan 25-01 scenarios green; Wave 2 can land its un-skips without re-running Wave 1's work

## Commits

| Hash | Message |
| ---- | ------- |
| `d10c95e` | `feat(25-01): AgentList with SC-1 status column + tabs + useAgents hook` |
| `950835b` | `feat(25-01): AgentFormDialog + CustomEnvEditor + CustomArgsEditor` |
| `f7d5700` | `feat(25-01): ArchiveConfirmDialog + restore flow + sr-announcer` |

## Self-Check: PASSED

- [x] `apps/web/src/components/management/AgentList.tsx` — FOUND
- [x] `apps/web/src/components/management/AgentFormDialog.tsx` — FOUND
- [x] `apps/web/src/components/management/CustomEnvEditor.tsx` — FOUND
- [x] `apps/web/src/components/management/CustomArgsEditor.tsx` — FOUND
- [x] `apps/web/src/components/management/ArchiveConfirmDialog.tsx` — FOUND
- [x] `apps/web/src/components/management/useAgents.ts` — FOUND
- [x] `apps/web/src/components/management/EmptyState.tsx` — FOUND
- [x] `apps/web/src/components/management/time.ts` — FOUND
- [x] `apps/web/src/pages/AgentsPage.tsx` — FOUND (modified)
- [x] `tests/e2e/management-uis.spec.ts` — FOUND (3 scenarios un-skipped)
- [x] Commit `d10c95e` — FOUND
- [x] Commit `950835b` — FOUND
- [x] Commit `f7d5700` — FOUND
