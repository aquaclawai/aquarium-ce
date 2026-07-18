---
phase: 25-management-uis
verified: 2026-04-17T00:00:00Z
status: human_needed
score: 12/12 must-haves verified
human_verification:
  - test: "In Chrome, Firefox, and Safari: navigate to /daemon-tokens, create a token, click the copy button, paste into a text field and confirm the plaintext matches the adt_... token shown in the modal. Then click 'I've saved it' (dismiss). Revisit the /daemon-tokens page and confirm no plaintext appears — only the hashed-projection row is visible."
    expected: "Clipboard receives the full adt_... string. After dismiss, no plaintext is accessible in any UI surface including revisiting the page."
    why_human: "Clipboard API behaviour differs by browser and OS permissions level. The Playwright spec asserts DOM presence/absence but cannot verify actual clipboard contents in cross-browser CI without HTTPS + real browser user gesture grants."
  - test: "Switch the app language to each of zh, fr, de, es, it (via language switcher or localStorage i18next override). Visit /agents, /runtimes, and /daemon-tokens. Read all visible strings in the management.* namespace for linguistic naturalness — headings, column labels, button text, empty states, toast messages."
    expected: "All strings read naturally and fluently in the target language. No English placeholder phrases appear. Technical terms (e.g. 'daemon token', 'runtime') are rendered with culturally appropriate equivalents or left as accepted loanwords."
    why_human: "Linguistic quality is a judgement call that requires native or near-native speaker competence. The i18n parity script verifies key presence only; it cannot evaluate semantic appropriateness of translated strings."
  - test: "With zero agents created, visit /agents and inspect the empty state. Repeat with zero runtimes on /runtimes and zero tokens on /daemon-tokens."
    expected: "Each page renders a polished empty state with a meaningful heading, body copy, and (where applicable) a primary CTA button — not a blank white area or an empty table skeleton."
    why_human: "Empty-state visual quality is a design judgement. The EmptyState component exists and is wired but whether the resulting presentation meets design standards requires visual inspection."
---

# Phase 25: Management UIs Verification Report

**Phase Goal:** Users manage agents, runtimes, and daemon tokens through dedicated pages with i18n coverage across all 6 locales.
**Verified:** 2026-04-17T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Routes `/agents`, `/runtimes`, `/daemon-tokens` are reachable and render page scaffolds | VERIFIED | `App.tsx` lines 106–108: three `<Route>` elements inside `AppLayout` with lazy-imported `AgentsPage`, `RuntimesPage`, `DaemonTokensPage`. Each page has a `data-page=` marker confirmed in source. |
| 2 | Sidebar contains three new nav entries (Agents / Runtimes / Daemon Tokens) after the Issues entry | VERIFIED | `Sidebar.tsx` lines 111–113: `{ to: '/agents', icon: Bot, ... }`, `{ to: '/runtimes', icon: Server, ... }`, `{ to: '/daemon-tokens', icon: KeyRound, ... }` inserted after `/issues` and before `/templates`. `Server` imported at line 22. `dataNav` threaded to `data-nav` attribute on `SidebarMenuButton`. |
| 3 | Agents page lists agents with runtime badge, status badge (Agent.status enum), and max_concurrent_tasks — SC-1 | VERIFIED | `AgentList.tsx`: Status column at line 279–285 renders `<Badge data-agent-status-badge={agent.status}>` with 5-enum variant map (`idle/working/blocked/error/offline`). Runtime column with icon at lines 263–276. `maxConcurrentTasks` column at line 289. `data-agent-row` at line 247. |
| 4 | Agent create/edit form includes custom_env and custom_args editors | VERIFIED | `AgentFormDialog.tsx` exists with `data-agent-form-submit`. `CustomEnvEditor.tsx` with `data-agent-env-add`. `CustomArgsEditor.tsx` with `data-agent-args-input`. All wired through `useAgents` hook. |
| 5 | Runtimes page shows all three kinds in one unified list with device_info, last_heartbeat_at, and a kind filter chip | VERIFIED | `useRuntimes.ts` line 53: single `api.get<Runtime[]>('/runtimes')` — no split routes. `RuntimeList.tsx` renders `runtime.deviceInfo` with Tooltip at lines 305–327, `runtime.lastHeartbeatAt` at lines 330–345. `KindFilterChips.tsx` with `data-kind-filter` attribute. `data-runtime-row` at line 268. |
| 6 | Runtimes kind filter is wired via URL `?kind=` deep-link | VERIFIED | `RuntimesPage.tsx` uses `useSearchParams` (line 3), syncs chip selection to `params.set('kind', next)` at line 69, and reads initial value via `coerceKind(searchParams.get('kind'))` at line 45. |
| 7 | Row click opens RuntimeDetailSheet | VERIFIED | `RuntimesPage.tsx` line 74: `handleRowClick` sets `detailRuntime`. Sheet at lines 127–133: `open={detailRuntime !== null}`. `data-runtime-detail-sheet` in `RuntimeDetailSheet.tsx` at line 102. |
| 8 | Daemon Tokens page: create with friendly name + optional expiry, copy plaintext once, list existing, revoke with confirmation | VERIFIED | `DaemonTokenCreateModal.tsx`: form step with name + expiry date fields. Plaintext held in `useState<string \| null>(null)` (line 89), cleared to `null` on dismiss (lines 105, 117). `data-token-plaintext` on `<pre>` at line 377. `RevokeConfirmDialog.tsx` with `data-token-revoke-confirm`. `DaemonTokenList.tsx` with `data-token-row`. |
| 9 | Plaintext never persisted to localStorage, sessionStorage, URL, document.title, or console | VERIFIED | `DaemonTokenCreateModal.tsx`: grep of console/localStorage/sessionStorage/document.title/history returns 0 matches. CI guards at `.github/workflows/ci.yml` lines 54 + 62 use `! grep -rE` bulletproof form. i18n check: `{{plaintext}}` interpolation grep across all 6 locales returns 0 matches. `a11y.copied` key value is `"Token copied to clipboard"` (zero interpolation confirmed across all 6 locales). |
| 10 | All new strings present in all 6 locales — SC-4 | VERIFIED | Runtime check: all 6 locales contain `management.agents.*`, `management.runtimes.*`, `management.daemonTokens.*`, `sidebar.agents`, `sidebar.runtimes`, `sidebar.daemonTokens`, and the 5-value `management.agents.status.*` enum. Non-English locales have real translations (zh: `"代理"`, de: `"Agenten"`, es: `"Agentes"`, it: `"Agenti"`). fr has `"Agents"` — same word in French, linguistically correct, not a placeholder issue. |
| 11 | i18n parity CI script exits 0 and both CI grep guards use `! grep -rE` form | VERIFIED | Verification notes confirm 2231 keys × 6 locales parity. `ci.yml` lines 54, 62: exact `! grep -rE` form per UI-SPEC spec. Not the `if grep; then exit 1; fi` form. |
| 12 | Playwright spec has >= 6 non-skipped scenarios for Wave 1/2/3 | VERIFIED | `management-uis.spec.ts`: 8 of 9 scenarios are un-skipped and green (`agents list renders`, `agent form create`, `agent archive`, `runtimes unified list`, `runtime row details`, `token create form`, `token copy once`, `token revoke`). 1 skip is `'sidebar nav'` — Wave 0 stub intentionally left skipped per plan direction. |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/pages/AgentsPage.tsx` | Route component for /agents with data-page="agents" | VERIFIED | Full implementation with tabs, search, useAgents hook, AgentList, AgentFormDialog, ArchiveConfirmDialog wired. `data-page="agents"` at line 128. |
| `apps/web/src/pages/RuntimesPage.tsx` | Route component for /runtimes with data-page="runtimes" | VERIFIED | Full implementation with KindFilterChips, RuntimeList, RuntimeDetailSheet. `data-page="runtimes"` at line 84. |
| `apps/web/src/pages/DaemonTokensPage.tsx` | Route component for /daemon-tokens with data-page="daemon-tokens" | VERIFIED | Full implementation with DaemonTokenList, DaemonTokenCreateModal, RevokeConfirmDialog. `data-page="daemon-tokens"` at line 35. |
| `apps/web/src/components/management/AgentList.tsx` | Table with Name/Runtime/Status/MaxConcurrent/Updated/Actions columns | VERIFIED | All 6 columns present. `data-agent-row` per row. `data-agent-status-badge={status}` with 5-enum variant map. |
| `apps/web/src/components/management/AgentFormDialog.tsx` | Create/edit form with `data-agent-form-submit` | VERIFIED | `data-agent-form-submit` at line 372. |
| `apps/web/src/components/management/CustomEnvEditor.tsx` | Key-value row editor with `data-agent-env-add` | VERIFIED | File exists, `data-agent-env-add` confirmed via data-attribute grep. |
| `apps/web/src/components/management/CustomArgsEditor.tsx` | Tag-input editor with `data-agent-args-input` | VERIFIED | File exists, `data-agent-args-input` confirmed via data-attribute grep. |
| `apps/web/src/components/management/ArchiveConfirmDialog.tsx` | Destructive confirmation Dialog with `data-agent-archive-confirm` | VERIFIED | `data-agent-archive-confirm` at line 97. |
| `apps/web/src/components/management/useAgents.ts` | Fetch + create + update + archive + restore hooks | VERIFIED | Lines 58–99: `api.get`, `api.post`, `api.patch`, `api.delete`, `api.post restore` all wired. |
| `apps/web/src/components/management/RuntimeList.tsx` | Unified table with `data-runtime-row` | VERIFIED | `data-runtime-row={runtime.id}` at line 268. deviceInfo tooltip + lastHeartbeatAt relative + absolute time wired. |
| `apps/web/src/components/management/KindFilterChips.tsx` | 4-chip filter with `data-kind-filter` | VERIFIED | `data-kind-filter={chip.value}` at line 80. |
| `apps/web/src/components/management/RuntimeDetailSheet.tsx` | Sheet drawer with `data-runtime-detail-sheet` | VERIFIED | `data-runtime-detail-sheet` at line 102. |
| `apps/web/src/components/management/useRuntimes.ts` | Fetch + 30s polling hook via single `/runtimes` endpoint | VERIFIED | Single `api.get<Runtime[]>('/runtimes')` at line 53. `POLL_INTERVAL_MS = 30_000` at line 22. |
| `apps/web/src/components/management/DaemonTokenList.tsx` | Token table with `data-token-row` | VERIFIED | `data-token-row={token.id}` at line 243. |
| `apps/web/src/components/management/DaemonTokenCreateModal.tsx` | Two-step Dialog with `data-token-plaintext` | VERIFIED | `data-token-plaintext` at line 377. Plaintext in `useState<string \| null>`, cleared on dismiss at lines 105, 117. No console/storage/URL leakage. |
| `apps/web/src/components/management/RevokeConfirmDialog.tsx` | Destructive confirm Dialog with `data-token-revoke-confirm` | VERIFIED | `data-token-revoke-confirm` at line 93. |
| `apps/web/src/components/management/useDaemonTokens.ts` | Fetch + revoke hook (no create — plaintext stays in modal only) | VERIFIED | `api.get('/daemon-tokens')` + `api.delete('/daemon-tokens/:id')`. No create method by design (MGMT-03 invariant). |
| `apps/web/src/components/management/tokenStatus.ts` | `deriveTokenStatus` pure function | VERIFIED | File exists, imported by `DaemonTokenList.tsx` at line 37. |
| `apps/web/src/components/layout/Sidebar.tsx` | 3 new workspaceItems entries | VERIFIED | Lines 111–113: Bot/Server/KeyRound icons, `dataNav` values threaded to `data-nav` attribute. |
| `apps/web/src/App.tsx` | 3 lazy imports + 3 routes inside AppLayout | VERIFIED | Lines 58–60: lazy imports. Lines 106–108: routes inside `<Route element={<AppLayout />}>`. |
| All 6 locale files | `management.*` + `sidebar.agents/runtimes/daemonTokens` keys | VERIFIED | Runtime check: all keys present and non-English locales have real translations. |
| `.github/workflows/ci.yml` | 2 `! grep -rE` CI guards | VERIFIED | Lines 47–62: both guards present with bulletproof `! grep -rE` form per UI-SPEC. |
| `tests/e2e/management-uis.spec.ts` | >= 6 scenarios; 8 un-skipped green, 1 intentional skip | VERIFIED | 9 total: 8 green (Waves 1/2/3), 1 skip (`sidebar nav`, Wave 0 stub). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `App.tsx` | `AgentsPage`, `RuntimesPage`, `DaemonTokensPage` | `lazy()` + `<Route path="...">` | WIRED | Lines 58–60 (lazy imports), 106–108 (routes). |
| `Sidebar.tsx` | `/agents`, `/runtimes`, `/daemon-tokens` | `workspaceItems` nav entries + `navigate()` | WIRED | Lines 111–113: to + icon + label + dataNav. |
| `AgentsPage` | `/api/agents` | `useAgents` → `api.get('/agents')` + `api.get('/agents?includeArchived=true')` | WIRED | `useAgents.ts` lines 58–59. |
| `AgentFormDialog` | `/api/agents` POST + PATCH | `useAgents.create` / `useAgents.update` | WIRED | `useAgents.ts` lines 81, 87. |
| `ArchiveConfirmDialog` | `/api/agents/:id` DELETE + restore POST | `useAgents.archive` / `useAgents.restore` | WIRED | `useAgents.ts` lines 93, 99. |
| `AgentList` | `Agent.status` enum | `statusVariant` map + `data-agent-status-badge={agent.status}` | WIRED | `AgentList.tsx` lines 57–63, 282. |
| `RuntimesPage` | `/api/runtimes` (single unified endpoint) | `useRuntimes` → `api.get('/runtimes')` with 30s poll | WIRED | `useRuntimes.ts` line 53. No `/runtimes/hosted` or `/runtimes/daemon` calls anywhere in `apps/web/src/`. |
| `RuntimesPage` | URL `?kind=` deep-link | `useSearchParams` + `setSearchParams` | WIRED | `RuntimesPage.tsx` lines 41, 65–72. |
| `RuntimeList` | `RuntimeDetailSheet` | `onRowClick` → `setDetailRuntime` | WIRED | `RuntimesPage.tsx` line 74, 127. |
| `DaemonTokenCreateModal` | `/api/daemon-tokens` POST | `api.post<DaemonTokenCreatedResponse>('/daemon-tokens', ...)` | WIRED | `DaemonTokenCreateModal.tsx` line 161. |
| `DaemonTokenCreateModal` | Plaintext clearance | `useState<string \| null>(null)` + `setPlaintext(null)` on dismiss | WIRED | Lines 89, 105, 117. Plaintext never crosses component boundary. |
| `RevokeConfirmDialog` | `/api/daemon-tokens/:id` DELETE | `useDaemonTokens.revoke` → `api.delete(...)` | WIRED | `useDaemonTokens.ts` line 61. |
| `i18n locales` | `check-i18n-parity.mjs` CI gate | 6 locales × all management.* keys | WIRED | All 6 locales verified to contain all required keys at runtime. |
| `ci.yml` guards | `apps/web/src/components/management/` | `! grep -rE` bulletproof form | WIRED | Lines 54, 62 of `ci.yml`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `AgentList.tsx` | `agents: Agent[]` | `useAgents` → `api.get('/agents')` → Express route → DB | Yes — live fetch; hook splits into `active` / `archived` arrays | FLOWING |
| `RuntimeList.tsx` | `runtimes: Runtime[]` | `useRuntimes` → `api.get('/runtimes')` → Express route → DB; 30s poll | Yes — live fetch with diff-apply for reference stability | FLOWING |
| `DaemonTokenList.tsx` | `tokens: DaemonToken[]` | `useDaemonTokens` → `api.get('/daemon-tokens')` → Express route → DB | Yes — full refetch on create/revoke | FLOWING |
| `DaemonTokenCreateModal.tsx` | `plaintext: string \| null` | `api.post<DaemonTokenCreatedResponse>('/daemon-tokens', ...)` — server generates real token | Yes — `resp.plaintext` set on success; `null` on dismiss | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — verification notes confirm Playwright 8/9 green (full suite run pre-spawn). Running the server is not available in this static analysis context.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MGMT-01 | 25-00, 25-01, 25-04 | Browse / create / edit / archive Agents with form showing instructions, runtime selector, custom env, custom args, max concurrent tasks | SATISFIED | `AgentsPage.tsx` + 7 management components fully implemented. SC-1 status column with 5-enum Badge verified. `AgentFormDialog` includes all form fields. `CustomEnvEditor` + `CustomArgsEditor` present. 3 Playwright scenarios green. |
| MGMT-02 | 25-00, 25-02, 25-04 | Browse Runtimes in a unified list showing hosted instances + daemon connections with status badges | SATISFIED | Single `GET /api/runtimes` endpoint. No split routes. All 3 kinds shown. device_info + last_heartbeat_at + status badges in `RuntimeList`. Kind filter chip group wired. `RuntimeDetailSheet` present. 2 Playwright scenarios green. |
| MGMT-03 | 25-00, 25-03, 25-04 | Issue a new daemon token with friendly name + optional expiry, copy plaintext once, revoke from list view | SATISFIED | `DaemonTokenCreateModal` implements two-step form + copy-once with plaintext in local `useState` only. `setPlaintext(null)` on dismiss. No console/storage/URL leakage verified. `DaemonTokenList` shows hashed projection only. `RevokeConfirmDialog` with destructive confirmation. CI grep guards enforce MGMT-03 structural invariant. 3 Playwright scenarios green. |

No orphaned requirements found. All three MGMT IDs are claimed by plans and satisfied by implementation evidence.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None detected | — | — | — | — |

Security scan results:
- `dangerouslySetInnerHTML` in `apps/web/src/components/management/`: 0 matches
- `localStorage` / `sessionStorage` in `apps/web/src/components/management/`: 0 matches
- `console.*` in `DaemonTokenCreateModal.tsx`: 0 matches
- `document.title` in `DaemonTokenCreateModal.tsx`: 0 matches
- `{{plaintext` in any i18n locale: 0 matches
- `a11y.copied` in all 6 locales: zero-interpolation string confirmed

---

### Human Verification Required

#### 1. Clipboard API cross-browser test — Daemon Token copy button

**Test:** In Chrome, Firefox, and Safari (on macOS): navigate to `/daemon-tokens`, create a new token with any friendly name, observe the copy-once modal at Step B. Click "Copy to clipboard". Open a plain text editor and paste. Confirm the pasted text matches the `adt_...` value shown in the `<pre>` block exactly. Click "I've saved it" (dismiss button). Revisit `/daemon-tokens`. Confirm no plaintext appears — only the row with the token name and status badge.

**Expected:** Clipboard receives the full `adt_...` string in all three browsers. After dismiss, the plaintext is absent from all visible UI surfaces including the revisited list page.

**Why human:** Clipboard API (`navigator.clipboard.writeText`) requires an HTTPS origin and a real browser user gesture for reliable operation. Playwright's synthetic click can trigger the handler but clipboard contents cannot be asserted cross-browser without browser-specific permission grants that are unavailable in standard CI. Safari in particular has stricter clipboard permissions.

#### 2. Native-speaker linguistic-quality review across zh/fr/de/es/it

**Test:** Switch the app language to each of zh, fr, de, es, it (via the language switcher or by setting `i18next` localStorage key). Visit `/agents`, `/runtimes`, and `/daemon-tokens`. Read all visible strings — page headings, table column headers, button labels, empty-state copy, toast messages, dialog titles — in the `management.*` namespace.

**Expected:** All strings read naturally and fluently. No English placeholder phrases remain visible (note: fr `"Agents"` is the correct French word and is not a placeholder). Technical terms like "daemon token" and "runtime" are handled with culturally appropriate choices or accepted loanwords.

**Why human:** The i18n parity script verifies key presence and structural parity only. It cannot evaluate semantic correctness or linguistic quality. Native or near-native speaker judgement is required.

#### 3. Empty-state design quality spot-check across all 3 pages

**Test:** With zero agents created (delete any existing agents or use a fresh DB), visit `/agents`. Confirm the empty state. Repeat for `/runtimes` (no runtimes registered) and `/daemon-tokens` (no tokens issued).

**Expected:** Each page renders a polished empty state with a meaningful icon or illustration, heading, body text, and (where appropriate) a primary CTA button — not a blank white area, an empty table frame, or a raw "No data" string.

**Why human:** The `EmptyState` component is wired and the i18n keys are present, but whether the resulting visual presentation meets design quality standards requires visual inspection. This is a design judgement that cannot be asserted programmatically.

---

### Gaps Summary

No gaps found. All 12 observable truths are VERIFIED. All required artifacts exist, are substantive, are wired to their data sources, and data flows through the wiring to real API endpoints. MGMT-01, MGMT-02, and MGMT-03 are fully satisfied.

Three items require human verification before the phase can be marked fully passed: cross-browser clipboard testing, linguistic quality review in 5 non-English locales, and empty-state design quality inspection. These are structural quality gates rather than implementation gaps.

---

_Verified: 2026-04-17T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
