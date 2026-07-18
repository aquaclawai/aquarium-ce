---
phase: 25
plan: 02
subsystem: management-uis
tags: [wave-2, runtimes, MGMT-02, unified-list, sheet-drawer]
dependency-graph:
  requires:
    - Phase 25 Wave 0 scaffold (RuntimesPage stub + i18n namespaces + CI guards + Playwright skip-stubs)
    - Phase 25 Wave 1 shared helpers (time.ts formatRelativeTime/formatAbsoluteTime + EmptyState)
    - Phase 16 GET /api/runtimes endpoint (single unified listing)
    - Phase 18 shadcn primitives (Table, Sheet, Tooltip, Badge, Input, Button, Separator, Skeleton)
    - Phase 23 sidebar nav + AppLayout route wrapper
    - packages/shared/src/v14-types.ts::Runtime + RuntimeKind + RuntimeStatus + RuntimeDeviceInfo
  provides:
    - Fully functional /runtimes surface — unified list (hosted_instance + local_daemon + external_cloud_daemon) with kind chip filter + URL deep-link + row-click Sheet drawer
    - useRuntimes hook with 30s polling + diff-apply reference preservation
    - KindFilterChips with 4 radiogroup chips + live counts + keyboard arrow cycle
    - RuntimeList with Device tooltip (full deviceInfo JSON) + Heartbeat tooltip (absolute time)
    - RuntimeDetailSheet drawer showing full Runtime shape read-only with pretty-printed deviceInfo + metadata JSON
    - Playwright scenarios un-skipped: `runtimes unified list`, `runtime row details`
  affects:
    - Plan 25-03 (Daemon Tokens UI) — reuses Sheet primitive pattern for potential future detail views
    - Plan 25-04 (translations) — no new i18n keys introduced (all 30+ runtime keys landed in Wave 0)
tech-stack:
  added: []
  patterns:
    - "Unified list via single GET /api/runtimes + client-side chip filter — HARD MGMT-02 invariant (no per-kind route split anywhere in apps/web/src)"
    - "Deep-link via useSearchParams + strict enum coercion on ?kind= param — attacker-controlled URL values silently fall back to 'all' (T-25-02-02/06 mitigation)"
    - "Diff-apply reference preservation in useRuntimes: new list entries reuse old references when shallowEqualRuntime matches, keeping React.memo stable across 30s polls"
    - "JSON.stringify(obj, null, 2) inside <pre> for deviceInfo + metadata — React auto-escapes text children, no dangerouslySetInnerHTML (T-25-02-01 mitigation, CI grep guard from Wave 0 enforces)"
    - "RuntimeRow React.memo comparator keyed on the exact subset of fields that change during polling: id + status + lastHeartbeatAt + updatedAt + name + provider + kind + locale"
    - "Row keyboard activation: tabIndex=0 + role=button on TableRow + Enter/Space handler → parity with click for a11y"
    - "shadcn Sheet primitive (Radix Dialog under the hood) auto-handles portal, overlay, focus trap, aria-modal, Escape close — no custom keyboard trap needed (T-25-02-04 clickjacking mitigation)"
key-files:
  created:
    - apps/web/src/components/management/useRuntimes.ts
    - apps/web/src/components/management/KindFilterChips.tsx
    - apps/web/src/components/management/RuntimeList.tsx
    - apps/web/src/components/management/RuntimeDetailSheet.tsx
  modified:
    - apps/web/src/pages/RuntimesPage.tsx
    - tests/e2e/management-uis.spec.ts
decisions:
  - "Single GET /api/runtimes + client-side filter — HARD MGMT-02 invariant. Confirmed via grep: 0 matches for /runtimes/hosted or /runtimes/daemon anywhere in apps/web/src."
  - "30-second polling interval, no WebSocket subscription in Wave 2. useRuntimes can be upgraded to WS reconciliation in a later wave without touching callers."
  - "Strict enum coercion on ?kind= query param — only the 3 RuntimeKind values + 'all' are accepted; any other string silently coerces to 'all'. Covers T-25-02-02 and T-25-02-06."
  - "Device cell shows truncated os/arch summary (28 chars) + Tooltip reveals full JSON. Truncation keeps the row compact; Tooltip lifts to absolute/portal-positioned via Radix so no layout shift."
  - "Seeded hosted_instance test rows reuse any existing instance_id (FK off in CE + XOR trigger requires non-null instance_id) — avoids spinning a full instance fixture for a read-only UI scenario."
  - "RuntimeRow memoization keyed on polling-mutable fields (status, lastHeartbeatAt, updatedAt) — row stays mounted across polls, avoids re-render churn for unchanged rows."
metrics:
  duration: "~45 minutes"
  completed: 2026-04-17
  tasks: 2
  files: 6
  commits: 4
---

# Phase 25 Plan 02: Runtimes Management UI Summary

Delivered the complete MGMT-02 surface — unified runtimes list with kind chip filter, URL deep-link, row click → detail Sheet drawer, 30-second polling — so users can browse all three runtime kinds (hosted_instance + local_daemon + external_cloud_daemon) in one view without per-kind route splits.

## Artifacts Created (4 new files)

### Components

| File | Purpose |
| ---- | ------- |
| `apps/web/src/components/management/useRuntimes.ts` | Data hook. `GET /api/runtimes` on mount + 30-second polling. Diff-apply: preserves old references for runtimes that are materially unchanged so `RuntimeRow` memo stays stable across polls. No mutations exposed — MGMT-02 is read-only. |
| `apps/web/src/components/management/KindFilterChips.tsx` | 4-chip `role="radiogroup"` filter (All / Hosted / Local daemon / Cloud daemon). Each chip carries live counts + `data-kind-filter` + `aria-checked`. Keyboard: ArrowLeft/Right cycles the active chip; focus moves to the new chip. Tab enters/exits the group at the active chip (tabIndex=0/-1 dance). |
| `apps/web/src/components/management/RuntimeList.tsx` | shadcn Table: Name / Kind badge (with lucide icon) / Provider / Status badge (with icon) / Device (truncated `os/arch` + Tooltip with full deviceInfo JSON in `<pre>`) / Heartbeat (relative + Tooltip with absolute locale time) / Actions (sr-only). Client-side filter by kind + search. `RuntimeRow` memoized by polling-mutable fields. |
| `apps/web/src/components/management/RuntimeDetailSheet.tsx` | shadcn Sheet (right drawer) rendering the full Runtime shape read-only: kind + provider + status badges, runtime/daemon/instance IDs (font-mono, break-all), createdAt + lastHeartbeatAt absolute times, deviceInfo + metadata JSON inside `<pre>` via `JSON.stringify(..., null, 2)`. |

### Page wiring

- `apps/web/src/pages/RuntimesPage.tsx` — replaces Wave 0 stub. Orchestrates:
  - Search `<Input>` + `<KindFilterChips>` toolbar
  - `<RuntimeList>` with computed counts from the current runtime set
  - `<RuntimeDetailSheet>` opened by row click via `detailRuntime` state
  - Initial filter coerced from `?kind=` on mount; filter → URL sync via `setSearchParams({ replace: true })` so history isn't spammed
  - Load-failure banner rendered inline when `useRuntimes` returns an ApiError
  - HARD invariant verified: `api.get<Runtime[]>('/runtimes')` is the sole call; no per-kind path exists

### Playwright

- `tests/e2e/management-uis.spec.ts` — un-skipped 2 scenarios; 4 remain `.skip`ed for Wave 3.
  - `runtimes unified list` — seeds 3 runtimes (one per kind) via `writeDb`, asserts all 3 rows render with `[data-runtime-row]` + `[data-runtime-kind]`. Clicks Hosted chip → only 1 hosted row + URL contains `?kind=hosted_instance`. Clicks All chip → all 3 rows return.
  - `runtime row details` — seeds 1 runtime with deviceInfo + metadata JSON, clicks the row, asserts `[data-runtime-detail-sheet]` visible, name in heading, all 4 deviceInfo fields (os/arch/hostname/version) + metadata (foo/bar) present in sheet text, then Escape closes the sheet.

## Files Modified

| File | Change |
| ---- | ------ |
| `apps/web/src/pages/RuntimesPage.tsx` | Wave 0 stub → full page with toolbar + chip filter + table + detail sheet + URL deep-link |
| `tests/e2e/management-uis.spec.ts` | 2 scenarios un-skipped (`runtimes unified list`, `runtime row details`); scaffold helpers + describe structure preserved |

## Data-Attribute Markers Applied

### KindFilterChips (Task 1)

| Marker | On element |
| ------ | ---------- |
| `data-kind-filter="all"` / `"hosted_instance"` / `"local_daemon"` / `"external_cloud_daemon"` | Per-chip `<Button>` |

### RuntimeList (Task 1)

| Marker | On element |
| ------ | ---------- |
| `data-runtime-row={runtime.id}` | Per-runtime `<TableRow>` |
| `data-runtime-kind={runtime.kind}` | Same `<TableRow>` (additional attribute) |
| `data-runtime-device-tooltip` | Device cell tooltip trigger `<span>` |
| `data-runtime-status-badge={runtime.status}` | Per-row status Badge |
| `data-column="status"` | Status column `<TableHead>` |

### RuntimesPage (Task 1)

| Marker | On element |
| ------ | ---------- |
| `data-page="runtimes"` | Page root `<main>` (Wave 0 marker reused) |

### RuntimeDetailSheet (Task 2)

| Marker | On element |
| ------ | ---------- |
| `data-runtime-detail-sheet` | `<SheetContent>` (portal-rendered body) |

## HARD Invariant Confirmations

### MGMT-02 Unified List (single GET /api/runtimes)

```
$ grep -rn "/api/runtimes/hosted\|/api/runtimes/daemon" apps/web/src/
# (no output — clean)
$ grep -c "api.get<Runtime\[\]>('/runtimes')" apps/web/src/components/management/useRuntimes.ts
1
```

No per-kind route splits. Client-side filter via `activeKindFilter === 'all' || r.kind === activeKindFilter`.

### Storage + innerHTML Guards (Wave 0 CI bulletproof form)

```
$ bash -c '! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management'   # exit 0 (CLEAN)
$ bash -c '! grep -rE "localStorage|sessionStorage" apps/web/src/components/management'   # exit 0 (CLEAN)
```

All runtime state is ephemeral React state; deviceInfo/metadata JSON rendered via `{JSON.stringify(...)}` as React text children inside `<pre>`.

### Deep-link Round-trip

`?kind=hosted_instance` inbound → `coerceKind` returns `'hosted_instance'` → chip pre-selected → rows pre-filtered. Outbound: chip click → `setSearchParams({kind: ...}, {replace: true})` → URL reflects state without polluting history.

## i18n Key Usage Confirmation

Every user-visible label comes from the `management.runtimes.*` namespace landed by Wave 0. Plan 25-02 introduces **zero new i18n keys**. Keys consumed:

- Page scaffold: `management.runtimes.{title, description, filter.search, loadFailed}`
- Chip labels: `management.runtimes.filter.{all, hostedInstance, localDaemon, externalCloudDaemon}`
- Table columns: `management.runtimes.columns.{name, kind, provider, status, device, lastHeartbeat, actions}`
- Kind labels: `management.runtimes.kind.{hostedInstance, localDaemon, externalCloudDaemon}`
- Status labels: `management.runtimes.status.{online, offline, error}`
- Cell content: `management.runtimes.{noDeviceInfo, neverHeartbeat, heartbeatJustNow}`
- Empty states: `management.runtimes.{empty.heading, empty.body, noMatches.heading, noMatches.clear}`
- Detail drawer: `management.runtimes.detail.{title, kind, provider, status, id, daemonId, instanceId, createdAt, lastHeartbeatAt, deviceInfoHeader, metadataHeader}`

i18n parity: **2231 keys across 6 locales (OK)** — unchanged from Wave 0 baseline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] DB trigger rejected hosted_instance seed with null instance_id**
- **Found during:** First RED-to-GREEN Playwright run of `runtimes unified list`.
- **Issue:** The runtimes table has a SQLite trigger that enforces `kind='hosted_instance' AND instance_id IS NOT NULL AND daemon_id IS NULL` (migration 004). My initial seed used `instance_id: null` for the hosted_instance row, which triggered `SqliteError: runtimes: daemon kinds require daemon_id and no instance_id; hosted_instance requires instance_id and no daemon_id`.
- **Fix:** Seed now reads any existing instances row (`SELECT id FROM instances LIMIT 1`) and reuses its id as the `instance_id`. Foreign-keys are off in this CE build so no new instance row is needed; a fabricated string would also work but reusing an existing id is safer for any future FK tightening.
- **Files modified:** `tests/e2e/management-uis.spec.ts`
- **Commit:** `c8ccb6d`

**2. [Rule 3 — Blocker] Strict-mode locator matched both SheetTitle and SheetDescription**
- **Found during:** First Playwright run of `runtime row details` after wiring the Sheet.
- **Issue:** My test used `sheet.getByText(rtName)` to verify the title. The `SheetDescription` renders `{{name}}` interpolation through `t('management.runtimes.detail.title', { name })` as an sr-only `<p>`, so the name appeared twice in DOM (the `<h2>` title + the sr-only `<p>`). Playwright strict mode raised a violation.
- **Fix:** Switched to `sheet.getByRole('heading', { name: rtName })`, which targets the `<h2>` exclusively. The sr-only description stays for a11y.
- **Files modified:** `tests/e2e/management-uis.spec.ts`
- **Commit:** `4e7dcfe`

### Auth Gates

None — the CE auto-auth middleware grants first-user access to bearer-less requests; Playwright runs against `http://localhost:3001` directly.

### Deferred Items

Baseline lint: 28 problems (1 error + 27 warnings) in files outside Plan 25-02's diff (matches Wave 0's `deferred-items.md`). Plan 25-02's own files (4 new + 2 modified) pass eslint with zero errors and zero warnings.

Transient Playwright flake: `issue-detail.spec.ts#reconnect replay` (Phase 24) failed once during the multi-spec regression run but passed on isolated re-run (6.2s). Not related to Plan 25-02's diff — tracked as a pre-existing Phase 24 flake.

## Verify Gate Results

All acceptance criteria green:

| Check | Result |
| ----- | ------ |
| `npm run build -w @aquarium/shared` | exit 0 |
| `npm run typecheck -w @aquaclawai/aquarium` | exit 0 |
| `npm run build:ce -w @aquarium/web` | exit 0 (~3s) |
| `npx eslint` on new/modified files | exit 0 (zero errors, zero warnings) |
| `node apps/web/scripts/check-i18n-parity.mjs` | exit 0 (2231 keys, 6 locales) |
| `bash -c '! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management'` | exit 0 |
| `bash -c '! grep -rE "localStorage\|sessionStorage" apps/web/src/components/management'` | exit 0 |
| `grep -rn "/api/runtimes/hosted\|/api/runtimes/daemon" apps/web/src/` | 0 matches (HARD invariant) |
| `grep -c "data-runtime-row" RuntimeList.tsx` | 1 (≥ 1) |
| `grep -c "data-runtime-kind" RuntimeList.tsx` | 1 (≥ 1) |
| `grep -c "data-kind-filter" KindFilterChips.tsx` | 3 (≥ 1) |
| `grep -c "api.get<Runtime\[\]>('/runtimes')" useRuntimes.ts` | 1 |
| `grep -c "data-page=\"runtimes\"" RuntimesPage.tsx` | 1 |
| `grep -cE "setInterval\|clearInterval" useRuntimes.ts` | 2 (polling) |
| `grep -c "data-runtime-detail-sheet" RuntimeDetailSheet.tsx` | 1 |
| `grep -c "JSON.stringify" RuntimeDetailSheet.tsx` | 3 (≥ 2 — deviceInfo + metadata + sheet description safe-render) |
| Playwright `-g "runtimes unified list"` | 1 passed |
| Playwright `-g "runtime row details"` | 1 passed |
| Playwright `-g "runtimes unified list\|runtime row details"` | 2 passed |
| Full `management-uis.spec.ts` | 5 passed, 4 skipped (Wave 3) |
| Regression: `issues-board.spec.ts` + `issue-detail.spec.ts` | 11 passed (1 flake re-ran green) |

## Known Stubs

None. RuntimesPage wires directly to `GET /api/runtimes` and renders every projection field in both the row and the detail sheet. No placeholder values, no TODO blocks, no hardcoded empty lists.

## Next Wave Readiness

- [x] `useRuntimes` hook exportable and stable (no breaking changes anticipated for a WS-reconciliation upgrade)
- [x] `KindFilterChips` reusable as a radio-chip pattern for any future filter surfaces
- [x] RuntimeDetailSheet pattern (Sheet + key-value grid + JSON `<pre>` sections) reusable for Plan 25-03's token detail if needed
- [x] Both Plan 25-02 scenarios green; Wave 3 can land its un-skips without touching Wave 2 files

## Commits

| Hash | Message |
| ---- | ------- |
| `60f8c29` | `test(25-02): RED — un-skip runtimes unified list scenario` |
| `c8ccb6d` | `feat(25-02): GREEN — useRuntimes + KindFilterChips + RuntimeList + unified page` |
| `760fe96` | `test(25-02): RED — un-skip runtime row details scenario` |
| `4e7dcfe` | `feat(25-02): GREEN — RuntimeDetailSheet + row click Sheet wiring` |

## Self-Check: PASSED

- [x] `apps/web/src/components/management/useRuntimes.ts` — FOUND
- [x] `apps/web/src/components/management/KindFilterChips.tsx` — FOUND
- [x] `apps/web/src/components/management/RuntimeList.tsx` — FOUND
- [x] `apps/web/src/components/management/RuntimeDetailSheet.tsx` — FOUND
- [x] `apps/web/src/pages/RuntimesPage.tsx` — FOUND (modified)
- [x] `tests/e2e/management-uis.spec.ts` — FOUND (2 scenarios un-skipped)
- [x] Commit `60f8c29` — FOUND
- [x] Commit `c8ccb6d` — FOUND
- [x] Commit `760fe96` — FOUND
- [x] Commit `4e7dcfe` — FOUND
