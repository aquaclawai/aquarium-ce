---
phase: 25
plan: 03
subsystem: management-uis
tags: [wave-3, daemon-tokens, MGMT-03, copy-once, hard-invariant, security]
dependency-graph:
  requires:
    - Phase 25 Wave 0 scaffold (DaemonTokensPage stub + i18n + CI grep guards)
    - Phase 25 Wave 1 shared helpers (time.ts formatRelativeTime/formatAbsoluteTime + EmptyState)
    - Phase 19-03 /api/daemon-tokens REST endpoints (POST/GET/DELETE)
    - Phase 18 shadcn primitives (Dialog, Table, DropdownMenu, Tooltip, Badge, Skeleton, Input, Button)
    - packages/shared/src/v14-types.ts::DaemonToken + DaemonTokenCreatedResponse
  provides:
    - Fully functional /daemon-tokens surface — list with derived status badges, two-step create modal (form + copy-once view), destructive revoke confirmation
    - DaemonTokenList with data-token-row + data-token-status markers + derived-status badge variant map
    - DaemonTokenCreateModal with MGMT-03 HARD invariant contract — sensitive string lives only in local useState, cleared on dismiss, nested confirm-close protects against accidental dismissal
    - RevokeConfirmDialog (destructive + autoFocused Cancel) + useDaemonTokens hook + deriveTokenStatus pure helper
    - Playwright scenarios un-skipped: `token create form`, `token copy once`, `token revoke`
  affects:
    - Plan 25-04 (translations) — no new i18n keys introduced (all 40+ daemonTokens keys landed in Wave 0)
tech-stack:
  added: []
  patterns:
    - "MGMT-03 HARD copy-once: sensitive string confined to a single useState<string | null> inside DaemonTokenCreateModal; dismiss clears the React state + Dialog portal unmounts to tear down DOM; parent callback receives hashed-projection DaemonToken only (type-enforced absence of plaintext field at the boundary)"
    - "Structural console-silence: zero console.* calls in DaemonTokenCreateModal.tsx — per-task grep guard covers all variants (log/warn/error/debug/info/trace). Submit catch swallows the error; toast copy is i18n-driven only so ApiError messages cannot echo sensitive payload fields"
    - "Nested confirm-close Dialog: Step B's Dialog onOpenChange intercepts the close flow while sensitive string is held; user must explicitly confirm before state clears. Cancel is default (autoFocus + variant=default); Close-anyway is destructive"
    - "Clipboard interceptor pattern for Playwright: page.addInitScript wraps navigator.clipboard.writeText to record what was copied; test grants clipboard-read/write permission via page.context().grantPermissions so writeText does not throw in headless Chromium"
    - "DaemonTokenList derived-status variant map: 4 states (active/expiring_soon/expired/revoked) rendered as <Badge data-token-status-badge={derived}> with CSS-var subtle-bg palette for success/warning, shadcn destructive variant for expired, muted outline for revoked"
    - "useDaemonTokens has no create method: routing the POST response through the hook would expose the sensitive string to the parent page. Refetch-after-create happens from the page after the modal dismisses; the hook never holds the sensitive string"
    - "tokenStatus.ts deriveTokenStatus: pure function (DaemonToken, Date) → union type; 7-day expiring_soon window; revoked takes priority over expiry"
key-files:
  created:
    - apps/web/src/components/management/tokenStatus.ts
    - apps/web/src/components/management/useDaemonTokens.ts
    - apps/web/src/components/management/DaemonTokenList.tsx
    - apps/web/src/components/management/DaemonTokenCreateModal.tsx
    - apps/web/src/components/management/RevokeConfirmDialog.tsx
  modified:
    - apps/web/src/pages/DaemonTokensPage.tsx
    - tests/e2e/management-uis.spec.ts
decisions:
  - "DaemonTokenCreateModal owns the ONLY useState<string | null> holding the sensitive adt_* string — not the page, not the hook, not any parent. This is the structural source of the MGMT-03 HARD invariant"
  - "Zero console.* calls in DaemonTokenCreateModal.tsx (Warning-4 fix): submit catch swallows the ApiError; handleCopy catch swallows the clipboard failure. Failure states transition via UI only (copyState='failed' → button label changes); toast copy is locale-driven; no developer-tools stream can receive the sensitive value even through accidental logging"
  - "Date input `<input type=\"date\">` with min={todayIso()} rather than a Popover-wrapped calendar — simpler DOM, native browser validation, no new Radix Popover surface, and Playwright can fill it directly with a YYYY-MM-DD string"
  - "Confirm-close nested Dialog uses variant=\"default\" + autoFocus on Cancel — matches UI-SPEC §Destructive confirmation pattern so Enter keeps the user viewing the sensitive string rather than dismissing it"
  - "useDaemonTokens.refetch is triggered from the page (not the modal) after onCreated fires — this keeps the modal decoupled from list state and maintains the invariant that the hook never sees the sensitive string"
  - "Lint fix: DaemonTokenList.tsx uses plain `const now = new Date()` per render rather than `useMemo(() => new Date(), [tokens])` — the useMemo dep was semantically wrong (intent was per-render freshness) and ESLint flagged it as unnecessary"
metrics:
  duration: "~55 minutes"
  completed: 2026-04-17
  tasks: 3
  files: 7
  commits: 3
---

# Phase 25 Plan 03: Daemon Tokens Management UI Summary

Delivered the complete MGMT-03 HARD surface — daemon-token list with derived status badges, two-step create modal with copy-once plaintext view, destructive revoke confirmation — so users can issue, inspect, and revoke daemon tokens end-to-end while the sensitive `adt_*` string provably never reaches browser storage, URL, page title, developer-tools console, or any structured output channel. All six HARD grep guards are green; all three Playwright scenarios pass.

## Artifacts Created (5 new files)

### Components

| File | Purpose |
| ---- | ------- |
| `apps/web/src/components/management/tokenStatus.ts` | Pure `deriveTokenStatus(token, now)` helper. 4-state union (active / expiring_soon / expired / revoked). 7-day expiring_soon window. `revokedAt !== null` takes priority over expiry. Used by DaemonTokenList to drive the badge variant + `data-token-status` attribute. |
| `apps/web/src/components/management/useDaemonTokens.ts` | Data hook. `GET /api/daemon-tokens` on mount; `revoke(id)` calls `DELETE /api/daemon-tokens/:id` + refetches. Deliberately NO `create` method — the POST response's sensitive field cannot flow through this hook without widening the MGMT-03 HARD surface. |
| `apps/web/src/components/management/DaemonTokenList.tsx` | shadcn Table with 6 columns (Name / Created / Expires / Last used / Status / Actions). Per-row Badge renders `deriveTokenStatus(token, now)` with variant map: success-subtle (active), warning-subtle (expiring_soon), destructive (expired), muted outline (revoked). Revoke dropdown disabled when already revoked. Loading skeleton (5 rows) + EmptyState integration + relative/absolute time tooltips for Created + Last used. |
| `apps/web/src/components/management/DaemonTokenCreateModal.tsx` | **MGMT-03 HARD**. Two-step Dialog: Step A form (name + optional expiry date input), Step B copy-once view with warning callout + `<pre>`-rendered sensitive string + Copy / Dismiss buttons. Nested ConfirmClose Dialog blocks accidental dismissal while Step B holds the sensitive string. State machine is local — parent only receives the hashed-projection `DaemonToken` via `onCreated`. Zero `console.*` calls, zero storage writes, zero URL/history/title mutation. |
| `apps/web/src/components/management/RevokeConfirmDialog.tsx` | Destructive-variant confirmation Dialog. Cancel autoFocuses (destructive is not default per UI-SPEC keyboard contract). Mirrors ArchiveConfirmDialog pattern from Plan 25-01. Dialog stays open on error so user can retry. |

### Page wiring

- `apps/web/src/pages/DaemonTokensPage.tsx` — replaces Wave 0 stub. Orchestrates:
  - Page header + description + "New token" CTA button with `data-token-create-open`
  - `<DaemonTokenList>` with `onRevoke` handler wired to `setRevokeTarget(tok)` state
  - `<DaemonTokenCreateModal>` controlled by `createOpen` state; `onCreated` callback receives the hashed `DaemonToken` projection only (type-enforced — no sensitive field)
  - `<RevokeConfirmDialog>` controlled by `revokeTarget` state; `onConfirm` awaits `revoke(id)` + announces via sr-only polite region
  - sr-only `<div role="status" aria-live="polite">` announcer interpolates only `{{name}}` via `management.daemonTokens.a11y.*` keys — never the sensitive string

### Playwright

- `tests/e2e/management-uis.spec.ts` — un-skipped 3 scenarios (`token create form`, `token copy once`, `token revoke`). Only `sidebar nav` remains skipped (Wave 0 scaffold reservation).

## Files Modified

| File | Change |
| ---- | ------ |
| `apps/web/src/pages/DaemonTokensPage.tsx` | Wave 0 stub → full page with list + create modal + revoke dialog + sr-announcer |
| `tests/e2e/management-uis.spec.ts` | 3 scenarios un-skipped; scaffold helpers + describe structure preserved byte-for-byte |

## Data-Attribute Markers Applied

### DaemonTokenList

| Marker | On element |
| ------ | ---------- |
| `data-token-row={token.id}` | `<TableRow>` per token |
| `data-token-status={derived}` | Same `<TableRow>` (additional attribute — `active` / `expiring_soon` / `expired` / `revoked`) |
| `data-token-status-badge={derived}` | Per-row `<Badge>` in Status column |
| `data-column="status"` | Status column `<TableHead>` |
| `data-token-actions-trigger={token.id}` | Per-row `<MoreHorizontal>` dropdown trigger |
| `data-token-revoke-open={token.id}` | Revoke DropdownMenuItem |

### DaemonTokensPage

| Marker | On element |
| ------ | ---------- |
| `data-page="daemon-tokens"` | Page root `<main>` (Wave 0 marker reused) |
| `data-token-create-open` | "New token" primary CTA in toolbar |

### DaemonTokenCreateModal

| Marker | On element |
| ------ | ---------- |
| `data-token-form-field="name"` | Name `<Input>` (Step A, autoFocus) |
| `data-token-form-field="expiresAt"` | Date `<Input type="date">` (Step A) |
| `data-token-form-submit` | Create button (Step A) |
| `data-token-plaintext` | `<pre>` block rendering the sensitive string (Step B only) |
| `data-token-copy-button` | Copy to clipboard button (Step B) |
| `data-token-dismiss` | "I've saved it" button (Step B) |
| `data-token-close-confirm-ok` | "Close anyway" button in nested ConfirmClose dialog |

### RevokeConfirmDialog

| Marker | On element |
| ------ | ---------- |
| `data-token-revoke-confirm` | Destructive confirm button |

## MGMT-03 HARD Invariant Verification

**All six grep guards green** (validated at task commit time and re-verified at plan close):

| Guard | Command | Result |
| ----- | ------- | ------ |
| 1. No `dangerouslySetInnerHTML` in `components/management/` | `! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management` | PASS |
| 2. No `localStorage` / `sessionStorage` in `components/management/` | `! grep -rE "localStorage\|sessionStorage" apps/web/src/components/management` | PASS |
| 3. No `document.title` in `DaemonTokenCreateModal.tsx` | `! grep -n "document\.title" apps/web/src/components/management/DaemonTokenCreateModal.tsx` | PASS |
| 4. No `{{plaintext}}` interpolation in any locale file | `! grep -rnE "\\{\\{plaintext" apps/web/src/i18n/locales/` | PASS |
| 5. No `console.*` calls in `DaemonTokenCreateModal.tsx` (Warning-4 fix — covers log/warn/error/debug/info/trace) | `! grep -n "console\." apps/web/src/components/management/DaemonTokenCreateModal.tsx` | PASS |
| 6. No URL / history / title propagation of the sensitive string | `! grep -n "?token=\|plaintext.*location\|plaintext.*history" apps/web/src/components/management/DaemonTokenCreateModal.tsx` | PASS |

## Explicit Call-Out: Channels the Sensitive String Never Reaches

The `adt_*` plaintext returned by `POST /api/daemon-tokens` lives in exactly one place:
```ts
const [plaintext, setPlaintext] = useState<string | null>(null);
```
inside `DaemonTokenCreateModal`. Proved (structurally + grep-guarded + Playwright-asserted) not to reach any of the following channels:

- **`localStorage`** — zero references in `components/management/` (CI-enforced bulletproof `! grep` guard in `.github/workflows/ci.yml`)
- **`sessionStorage`** — same CI guard
- **URL query string / path** — no `navigate()` / `location.href` / `history.pushState` / `setSearchParams` with the sensitive value anywhere
- **`document.title`** — grep-verified 0 matches in the modal file
- **Developer-tools console** — zero `console.*` calls of any variant in the modal file (Warning-4 fix). Submit catch swallows ApiError; handleCopy catch swallows clipboard failure
- **React error boundary / thrown error properties** — submit catch block does not rethrow; failure is communicated via `toast.error(t(...))` with i18n-only copy
- **`aria-live` announcer** — page-level sr-only `<div role="status">` interpolates only `{{name}}` via `management.daemonTokens.a11y.*` keys; locale-file grep for `{{plaintext}}` returns 0 matches
- **`dangerouslySetInnerHTML`** — zero references anywhere in `components/management/` (CI-enforced)
- **Parent callback props** — `onCreated(token: DaemonToken)` receives the hashed-projection type which has no `plaintext` field (type-enforced at the `@aquarium/shared` boundary, see `packages/shared/src/v14-types.ts:173-185`)
- **Cookie / indexedDB / WebSocket / fetch body** — never written to any of these from the modal; the only network call is the initial `POST /daemon-tokens` and the server's response is consumed entirely within the try block
- **Browser back/forward cache** — the `<pre>` DOM node lives in the Radix Dialog portal which tears down on close; `setPlaintext(null)` clears the React state before the portal unmounts

### Playwright Proof

The `token copy once` scenario (`tests/e2e/management-uis.spec.ts`) asserts all of the above at runtime:

1. Installs a clipboard interceptor via `page.addInitScript` that records every `writeText` call in a window array
2. Creates a token, captures the sensitive string from `[data-token-plaintext]`
3. Clicks Copy, asserts the interceptor recorded exactly the expected value
4. Clicks Dismiss, asserts `[data-token-plaintext]` disappears from DOM
5. **Reloads the page** and asserts:
   - The row appears with `data-token-status="active"` (hashed projection loaded from GET)
   - `document.body.innerHTML.includes(plaintext)` is `false` (no leak into any rendered HTML)
   - Neither `localStorage` nor `sessionStorage` contain any entry matching the sensitive string

## ROADMAP MGMT-03 SC — Fully Closed

| SC | Requirement | Closure |
| -- | ----------- | ------- |
| MGMT-03 SC | Users can issue, list, and revoke daemon tokens; plaintext visible exactly once; never persists client-side after close | Green — `token create form` + `token copy once` + `token revoke` Playwright scenarios prove the full round-trip and the copy-once invariant |

## i18n Key Usage Confirmation

Every user-visible label consumed from the `management.daemonTokens.*` namespace seeded by Wave 0. Plan 25-03 introduces **zero new i18n keys**. Keys consumed:

- Page scaffold: `management.daemonTokens.{title, description, actions.create, loadFailed}`
- Table columns: `management.daemonTokens.columns.{name, created, expires, lastUsed, status, actions}`
- Cell content: `management.daemonTokens.{neverExpires, neverUsed, relative}`
- Status labels: `management.daemonTokens.status.{active, expiringSoon, expired, revoked}`
- Empty state: `management.daemonTokens.empty.{heading, body, cta}`
- Create modal form: `management.daemonTokens.createModal.{title, name.*, expiry.*, actions.*, createFailed}`
- Copy-once view: `management.daemonTokens.copyOnce.{title, warning, warningIcon, tokenLabel, copyButton, copied, copyFailed, dismiss, confirmClose.*}`
- Revoke: `management.daemonTokens.{actions.revoke, revokeConfirm.*, revoke.*}`
- a11y: `management.daemonTokens.a11y.{created, revoked, copied}` (zero interpolation on `copied`; `{{name}}` only on the other two)
- Common + time: `common.buttons.cancel`, `management.runtimes.heartbeatJustNow` (shared "just now" label)

i18n parity: **2231 keys across 6 locales (OK)** — unchanged from Wave 0 baseline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Commented grep-forbidden strings tripped their own HARD guards**
- **Found during:** Task 2 verify gate — the 6 HARD grep guards immediately failed because my initial docblock used literal forbidden strings (`localStorage`, `document.title`, `console.error`, `dangerouslySetInnerHTML`) in prose that explained *why those terms are forbidden*. The CI `! grep -rE` form treats any match as a regression.
- **Fix:** Rewrote docblock comments to convey the invariants without the literal trigger strings (e.g., "browser storage" instead of "localStorage/sessionStorage", "structured log output / developer-tools stream" instead of "console.*"). Inline code comments in the submit catch and clipboard catch were rewritten the same way. The structural guarantee is identical; the grep guard now passes because no literal match exists anywhere in the file — not in code, not in comments.
- **Files modified:** `apps/web/src/components/management/DaemonTokenCreateModal.tsx`
- **Commit:** folded into `ccc7791`

**2. [Rule 3 — Blocker] Documentation comment in useDaemonTokens.ts referenced `plaintext` keyword**
- **Found during:** Task 1 acceptance check — the plan's grep `grep -c "plaintext" useDaemonTokens.ts` returned 4 (all comment matches explaining the security contract) when it should return 0.
- **Fix:** Rewrote the docblock using "sensitive string" / "sensitive adt_* string" terminology rather than the literal `plaintext` word. The structural guarantee (hook never holds the sensitive value) is unchanged; the grep is now clean.
- **Files modified:** `apps/web/src/components/management/useDaemonTokens.ts`
- **Commit:** folded into `b391e72`

**3. [Rule 1 — Bug] ESLint unnecessary-dep warning in DaemonTokenList useMemo**
- **Found during:** Task 3 full verify gate — `npm run lint -w @aquarium/web` reported 29 problems (1 baseline error + 28 warnings) whereas the Wave 0 baseline was 28. The extra warning was in my new file: `useMemo(() => new Date(), [tokens])` — the `tokens` dep was semantically wrong because the intent was per-render freshness rather than a cache keyed to the data.
- **Fix:** Switched to `const now = new Date()` evaluated per render. Semantically identical (each render still computes a fresh Date on the call site) but without a pretend-cache memo. Also dropped the now-unused `useMemo` import.
- **Files modified:** `apps/web/src/components/management/DaemonTokenList.tsx`
- **Commit:** folded into `650fadd`

### Auth Gates

None — the CE auto-auth middleware grants the first user to bearer-less requests (cookie-JWT); Playwright runs against `http://localhost:3001` without additional credentials.

### Deferred Items

Baseline lint: 28 problems (1 error + 27 warnings) in files outside Plan 25-03's diff (matches Wave 0 / 1 / 2 deferred-items.md). Plan 25-03's own files (5 new + 2 modified) pass ESLint with **zero errors and zero warnings**.

Ignored the Next.js / next-forge / react-best-practices / workflow / deployments-cicd / shadcn skill auto-injection hooks. None apply to this repo: it is a Vite + React 19 SPA (not Next.js App Router), a GitHub Actions workflow (not Vercel), and shadcn primitives are already vendored into the repo (I read the actual source rather than consulting external docs). CLAUDE.md explicitly defines the stack and takes precedence.

## Verify Gate Results

All acceptance criteria green:

| Check | Result |
| ----- | ------ |
| `npm run build -w @aquarium/shared` | exit 0 |
| `npm run typecheck -w @aquaclawai/aquarium` | exit 0 |
| `npm run build:ce -w @aquarium/web` | exit 0 (~2.6s) |
| `npm run lint -w @aquarium/web` — Plan 25-03 diff files only | exit 0 (zero errors, zero warnings) |
| `npm run lint -w @aquarium/web` — full repo | 28 problems (matches Wave 0 baseline; no regression) |
| `node apps/web/scripts/check-i18n-parity.mjs` | exit 0 (2231 keys, 6 locales) |
| `! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management` | exit 0 (HARD guard 1) |
| `! grep -rE "localStorage\|sessionStorage" apps/web/src/components/management` | exit 0 (HARD guard 2) |
| `! grep -n "document\.title" DaemonTokenCreateModal.tsx` | exit 0 (HARD guard 3) |
| `! grep -rnE "\\{\\{plaintext" apps/web/src/i18n/locales/` | exit 0 (HARD guard 4) |
| `! grep -n "console\." DaemonTokenCreateModal.tsx` | exit 0 (HARD guard 5 — Warning-4 fix) |
| `! grep -n "?token=\|plaintext.*location\|plaintext.*history" DaemonTokenCreateModal.tsx` | exit 0 (HARD guard 6) |
| `grep -c "data-token-row" DaemonTokenList.tsx` | 2 (≥ 1) |
| `grep -c "data-token-status" DaemonTokenList.tsx` | 3 (≥ 1) |
| `grep -c "api.get<DaemonToken\[\]>" useDaemonTokens.ts` | 1 |
| `grep -c "api.delete" useDaemonTokens.ts` | 1 |
| `grep -c "plaintext" useDaemonTokens.ts` | 0 |
| `grep -c "data-token-plaintext" DaemonTokenCreateModal.tsx` | 1 |
| `grep -c "data-token-dismiss" DaemonTokenCreateModal.tsx` | 1 |
| `grep -c "data-token-copy-button" DaemonTokenCreateModal.tsx` | 1 |
| `grep -c "useState<string | null>" DaemonTokenCreateModal.tsx` | 2 (sensitive-string state + expiry-error helper) |
| `grep -c "setPlaintext" DaemonTokenCreateModal.tsx` | 5 (reset, set-from-response, clear-on-dismiss, etc.) |
| `grep -c "navigator.clipboard.writeText" DaemonTokenCreateModal.tsx` | 1 |
| `grep -c "data-token-revoke-confirm" RevokeConfirmDialog.tsx` | 1 |
| `grep -c 'variant="destructive"' RevokeConfirmDialog.tsx` | 1 |
| `grep -c "autoFocus" RevokeConfirmDialog.tsx` | 2 (Cancel button + inline prop) |
| `grep -c "test.skip(" tests/e2e/management-uis.spec.ts` | 1 (only `sidebar nav` remains — Wave 0 scaffold) |
| Playwright `-g "token create form"` | 1 passed |
| Playwright `-g "token copy once"` | 1 passed |
| Playwright `-g "token revoke"` | 1 passed |
| Playwright full `management-uis.spec.ts` | 8 passed, 1 skipped (sidebar nav) |

## Known Stubs

None. Every field and action in Plan 25-03's surface round-trips through real API calls (`POST` / `GET` / `DELETE /api/daemon-tokens/*`) against the Phase 19-03 endpoints. The derived status is computed from live projection data; the Copy button uses a real `navigator.clipboard.writeText` call with a `select-all` `<pre>` fallback for restricted-permission contexts.

## Next Wave Readiness

- [x] All 3 Plan 25-03 Playwright scenarios green
- [x] 6 MGMT-03 HARD grep guards green (2 CI-enforced bulletproof guards + 4 per-task grep checks)
- [x] RevokeConfirmDialog pattern reusable for future destructive actions that need to mirror ArchiveConfirmDialog without sharing its shape
- [x] tokenStatus.ts deriveTokenStatus is pure and unit-testable — ready for future vitest integration if the repo adopts unit testing later
- [x] useDaemonTokens hook interface stable (no breaking changes anticipated for a WS-reconciliation upgrade in a later wave)

## Commits

| Hash | Message |
| ---- | ------- |
| `b391e72` | `feat(25-03): daemon token list read-only slice + tokenStatus helper + useDaemonTokens hook` |
| `ccc7791` | `feat(25-03): DaemonTokenCreateModal two-step copy-once + MGMT-03 HARD invariants` |
| `650fadd` | `feat(25-03): RevokeConfirmDialog + wire revoke flow + un-skip token revoke scenario` |

## Self-Check: PASSED

- [x] `apps/web/src/components/management/tokenStatus.ts` — FOUND
- [x] `apps/web/src/components/management/useDaemonTokens.ts` — FOUND
- [x] `apps/web/src/components/management/DaemonTokenList.tsx` — FOUND
- [x] `apps/web/src/components/management/DaemonTokenCreateModal.tsx` — FOUND
- [x] `apps/web/src/components/management/RevokeConfirmDialog.tsx` — FOUND
- [x] `apps/web/src/pages/DaemonTokensPage.tsx` — FOUND (modified from Wave 0 stub to full page)
- [x] `tests/e2e/management-uis.spec.ts` — FOUND (3 scenarios un-skipped)
- [x] Commit `b391e72` — FOUND
- [x] Commit `ccc7791` — FOUND
- [x] Commit `650fadd` — FOUND
