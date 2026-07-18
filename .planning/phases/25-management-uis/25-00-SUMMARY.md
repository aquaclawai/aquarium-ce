---
phase: 25
plan: 00
subsystem: management-uis
tags: [wave-0, scaffold, i18n, routing, ci-guards]
dependency-graph:
  requires:
    - Phase 23 sidebar nav pattern + NavItemDef interface
    - Phase 24 CI grep guard pattern in `.github/workflows/ci.yml`
    - Phase 23 i18n parity script (`apps/web/scripts/check-i18n-parity.mjs`)
    - Phase 18 shadcn primitives (Table, Dialog, Dropdown, Badge, Tabs, Tooltip, Sheet, etc.)
    - `packages/shared/src/v14-types.ts::Agent.status` enum
  provides:
    - `/agents`, `/runtimes`, `/daemon-tokens` routes (lazy-loaded)
    - Sidebar nav entries with `data-nav` attribute for Playwright selection
    - `management.agents.*` + `management.runtimes.*` + `management.daemonTokens.*` i18n namespaces (~145 keys in all 6 locales)
    - `apps/web/src/components/management/` directory reserved for Waves 1-3
    - `tests/e2e/management-uis.spec.ts` with 9 skip-stubs matching VALIDATION rows
    - 2 new CI grep guards (`! grep -rE`) enforcing MGMT-03 + UI-07 invariants under `components/management/**`
  affects:
    - Plan 25-01 (Agents UI) — consumes i18n keys + AgentsPage shell
    - Plan 25-02 (Runtimes UI) — consumes i18n keys + RuntimesPage shell
    - Plan 25-03 (Daemon Tokens UI) — consumes i18n keys + DaemonTokensPage shell + CI guards
    - Plan 25-04 (translations) — translates 5 non-English placeholder values
tech-stack:
  added: []
  patterns:
    - "Wave 0 scaffold pattern: register routes + i18n keys + spec titles BEFORE feature plans land (mirrors Phase 23 / 24 Wave 0)"
    - "Dependency-inversion ordering: i18n JSON additions come before TSX stubs in the same task so `npm run build:ce` resolves all `t('management.*')` keys"
    - "en-placeholder-in-all-locales: non-English locales ship with English values as placeholders until Wave 4 translates; parity script checks key presence only"
    - "Bulletproof CI grep guards: `! grep -rE` form over `if grep; then exit 1; fi` — fails on grep exit 2 (I/O error) in addition to exit 0 (match found)"
    - "NavItemDef optional `dataNav` field threaded onto SidebarMenuButton as `data-nav` HTML attribute for Playwright selection independent of locale text"
key-files:
  created:
    - apps/web/src/pages/AgentsPage.tsx
    - apps/web/src/pages/RuntimesPage.tsx
    - apps/web/src/pages/DaemonTokensPage.tsx
    - apps/web/src/components/management/.gitkeep
    - tests/e2e/management-uis.spec.ts
    - .planning/phases/25-management-uis/deferred-items.md
  modified:
    - apps/web/src/App.tsx
    - apps/web/src/components/layout/Sidebar.tsx
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json
    - .github/workflows/ci.yml
decisions:
  - "Task 1 ordering (i18n keys BEFORE TSX stubs) to avoid dependency-inversion build failure"
  - "`! grep -rE` CI guard form over `if grep; then exit 1; fi` — fails on grep exit 2 (I/O error); bulletproof MGMT-03 protection"
  - "Place management.agents.columns.status + management.agents.status.{idle|working|blocked|error|offline} in Wave 0 so Plan 25-01 Task 1 Status column adds zero i18n churn"
  - "NavItemDef extended with optional `dataNav` field instead of adding dedicated management-only nav component (keeps Sidebar.tsx single-source-of-truth)"
  - "All 9 Playwright scenarios (including row 25-00-03 `sidebar nav`) remain `.skip()` at Wave 0; Wave 1 un-skips `sidebar nav` alongside `agents list renders` so navigation + first-page-content share one real fixture"
  - "en-placeholder values in zh/fr/de/es/it deferred to Plan 25-04 per UX5 / UI-08 translation-wave pattern"
metrics:
  duration: "~25 minutes"
  completed: 2026-04-17
  tasks: 2
  files: 14
  commits: 2
---

# Phase 25 Plan 00: Management UIs Wave 0 Foundation Summary

Scaffolded all referenced surfaces for the three Phase 25 management pages (Agents / Runtimes / Daemon Tokens) — routes, sidebar nav, i18n namespaces in 6 locales, page stubs, Playwright spec with skip-stubs, management component directory, and two bulletproof CI grep guards — so Waves 1-3 can implement features without creating structural dependencies mid-wave and CI stays green throughout.

## Artifacts Created

### Page scaffolds (3 stubs)

- `apps/web/src/pages/AgentsPage.tsx` — `data-page="agents"` marker + localized `<h1>` + description. Reserved for Wave 1 / plan 25-01 to replace with AgentList + AgentFormDialog + ArchiveConfirmDialog orchestration.
- `apps/web/src/pages/RuntimesPage.tsx` — `data-page="runtimes"` marker. Reserved for Wave 2 / plan 25-02 (unified hosted + daemon runtime list with kind filter + detail drawer).
- `apps/web/src/pages/DaemonTokensPage.tsx` — `data-page="daemon-tokens"` marker. Reserved for Wave 3 / plan 25-03 (token list + create-with-copy-once flow + revoke).

### Component directory reservation

- `apps/web/src/components/management/.gitkeep` — empty file that preserves the directory in git so Waves 1-3 can land AgentList / AgentFormDialog / CustomEnvEditor / CustomArgsEditor / ArchiveConfirmDialog / RuntimeList / RuntimeRow / RuntimeDetailSheet / DaemonTokenList / DaemonTokenCreateModal / DaemonTokenCopyOnceDialog / RevokeConfirmDialog / `useAgents` / `useRuntimes` / `useDaemonTokens` without a structural commit.

### Routes + sidebar nav

- `apps/web/src/App.tsx` — 3 lazy imports after `IssueDetailPage` + 3 `<Route>` entries after `/issues/:id` inside the `AppLayout` wrapper: `/agents`, `/runtimes`, `/daemon-tokens`. All three respect the `ProtectedRoute` wrapper (cookie-JWT auth).
- `apps/web/src/components/layout/Sidebar.tsx` — added `Server` to the lucide-react import list; extended `NavItemDef` with optional `dataNav?: string` field; threaded `data-nav` HTML attribute onto `SidebarMenuButton` when defined; inserted 3 new `workspaceItems` entries (Bot / Server / KeyRound icons) between `/issues` and `/templates` with i18n labels `sidebar.agents` / `sidebar.runtimes` / `sidebar.daemonTokens`.

### i18n namespaces (all 6 locales)

- `en.json` — added ~145 keys under a new top-level `management` object (`management.agents.*`, `management.runtimes.*`, `management.daemonTokens.*`) + 3 new keys under the existing `sidebar` object (`agents`, `runtimes`, `daemonTokens`). Every EN string copied verbatim from UI-SPEC lines 220-540.
- `zh.json`, `fr.json`, `de.json`, `es.json`, `it.json` — same key set as en, with English placeholder values (Wave 4 / plan 25-04 will translate). Non-destructive merge: every existing translation preserved byte-for-byte.
- i18n parity: **2231 keys checked across 6 locales (OK)**.

### Playwright spec scaffold

- `tests/e2e/management-uis.spec.ts` — 9 `test.skip(...)` scenarios inside `test.describe.serial('Phase 25 — Management UIs', ...)`: `sidebar nav`, `agents list renders`, `agent form create`, `agent archive`, `runtimes unified list`, `runtime row details`, `token copy once`, `token create form`, `token revoke`. Scenario titles match VALIDATION.md rows 25-00-03 / 25-01-\* / 25-02-\* / 25-03-\* verbatim so Wave 1-3 wiring can call `-g "<title>"` directly.
- Helpers (`uniqueName`, `readDb`, `writeDb`, `signUpTestUser`) mirror the Phase 24 pattern; `void`-referenced to suppress unused-import lint at Wave 0.

### CI guards (2 new steps)

- `.github/workflows/ci.yml` — appended two steps after the existing "Check ReactMarkdown usage goes through SafeMarkdown":
  - `Verify no dangerouslySetInnerHTML in management pages` — `run: '! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management'`
  - `Verify plaintext token never leaks to browser storage` — `run: '! grep -rE "localStorage|sessionStorage" apps/web/src/components/management'`
- Both use the **bulletproof `! grep -rE` form** per UI-SPEC lines 742-750, NOT the weaker `if grep; then exit 1; fi` form. Baseline `grep -c "if grep" ci.yml` count remained at 2 (unchanged from Phase 24) — no new `if grep` blocks introduced.

## Files Modified

| File | Change |
| ---- | ------ |
| `apps/web/src/App.tsx` | 3 lazy imports + 3 `<Route>` entries |
| `apps/web/src/components/layout/Sidebar.tsx` | `Server` import; `NavItemDef.dataNav` field; `data-nav` attribute threading; 3 new workspaceItems |
| `apps/web/src/i18n/locales/en.json` | 3 new sidebar keys + full `management.*` namespace (~145 keys) |
| `apps/web/src/i18n/locales/{zh,fr,de,es,it}.json` | Same keys as en.json, en placeholder values (Wave 4 translates) |
| `.github/workflows/ci.yml` | 2 new `! grep -rE` guard steps |

## Key Decisions

1. **Task 1 ordering (dependency-inversion fix):** Added i18n JSON keys (step 1-3) BEFORE TSX page stubs (step 4-6). Without this ordering, `npm run build:ce` in Task 1's verify gate would fail because `<h1>{t('management.agents.title')}</h1>` resolves to an empty string and emits a missing-key warning (non-fatal) OR — if TypeScript's strict key-checking is ever enabled — a build error. Ordering makes the verify gate deterministic.

2. **`! grep -rE` CI guard form over `if grep; then exit 1; fi`:** The `!` form fails on grep exit 2 (I/O error, unreadable file, permission denied); the `if grep` form silently passes on exit 2. MGMT-03 is a HARD security invariant — the guard MUST fail on any non-zero-match outcome, not just on "no match found". UI-SPEC lines 742-750 codify this exact form; Task 2 adopts it verbatim.

3. **Blocker-3 prep (Agent status enum labels in Wave 0):** Added `management.agents.columns.status` + `management.agents.status.{idle|working|blocked|error|offline}` to all 6 locales at Wave 0 rather than deferring to Plan 25-01 Task 1. Rationale: Plan 25-01 Task 1 adds the Status column to AgentList; if those keys weren't in Wave 0, Plan 25-01 would have to touch 6 locale files AND the i18n parity script gate, doubling its surface. Wave 0 absorbs that churn up front.

4. **`NavItemDef.dataNav` extension over a dedicated management nav component:** Keeps `Sidebar.tsx` as the single source of truth for workspace navigation. Playwright specs can select via `[data-nav="agents"]` without depending on the user's language (which varies across 6 locales). The optional field + spread-when-defined pattern means existing nav entries stay byte-identical at the DOM level (no `data-nav=""` noise).

5. **All 9 Playwright scenarios remain `.skip()` at Wave 0:** Row 25-00-03 `sidebar nav` stays skipped even though the nav entries are live in DOM — Wave 1's first scenario hook un-skips it alongside `agents list renders` so navigation + first-page-content share one real fixture. Wave 0's job is to reserve titles + file + helpers, not assert behaviour.

6. **en-placeholder-in-all-locales pattern:** Non-English locales ship with English values at Wave 0 because the parity script checks key PRESENCE only (not value validity). Wave 4 / plan 25-04 translates. This matches the Phase 23 Wave 0 pattern and avoids blocking Waves 1-3 on translation work.

## MGMT-03 a11y Invariant Grep-Verified

`management.daemonTokens.a11y.copied` = `"Token copied to clipboard"` with NO `{{plaintext}}` interpolation anywhere. Verified via:

```
grep -rnE "\{\{plaintext" apps/web/src/i18n/locales/
# → no matches (0 lines)
```

The `{{name}}` interpolation is allowed in `a11y.created` and `a11y.revoked` because the friendly name is non-sensitive. The `adt_...` plaintext MUST NEVER reach a live-region announcer — this grep-invariant protects it.

## Agent Status Enum Labels Pre-Seeded

Per Plan 25-01 SC-1 (Status column in AgentList renders `Agent.status` enum as a shadcn Badge with `data-agent-status-badge`), Wave 0 seeds the label keys in all 6 locales:

| Key | en |
| --- | -- |
| `management.agents.columns.status` | `Status` |
| `management.agents.status.idle` | `Idle` |
| `management.agents.status.working` | `Working` |
| `management.agents.status.blocked` | `Blocked` |
| `management.agents.status.error` | `Error` |
| `management.agents.status.offline` | `Offline` |

Enum matches `packages/shared/src/v14-types.ts:62`: `export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline';`.

## Deviations from Plan

None - plan executed exactly as written.

### Auth Gates

None - Plan 25-00 makes no network calls; no authentication surface.

### Deferred Items

Pre-existing lint baseline: 28 problems (1 error + 27 warnings) in files outside Plan 25-00's diff. Baseline verified by stashing Plan 25-00 changes and re-running `npm run lint -w @aquarium/web` — same 28 problems. Tracked in `.planning/phases/25-management-uis/deferred-items.md`. Plan 25-00's own files (`AgentsPage.tsx`, `RuntimesPage.tsx`, `DaemonTokensPage.tsx`, `App.tsx` delta, `Sidebar.tsx` delta, spec stub) pass lint cleanly with zero errors and zero warnings.

## Verify Gate Results

All acceptance criteria green:

| Check | Result |
| ----- | ------ |
| `npm run build -w @aquarium/shared` | exit 0 |
| `npm run typecheck -w @aquaclawai/aquarium` | exit 0 |
| `npm run build:ce -w @aquarium/web` | exit 0 (2.87s) |
| `node apps/web/scripts/check-i18n-parity.mjs` | exit 0 (2231 keys, 6 locales) |
| `grep -c 'test.skip(' tests/e2e/management-uis.spec.ts` | 9 (≥6) |
| `grep -c "data-page=\"agents\"" AgentsPage.tsx` | 1 |
| `grep -c "data-page=\"runtimes\"" RuntimesPage.tsx` | 1 |
| `grep -c "data-page=\"daemon-tokens\"" DaemonTokensPage.tsx` | 1 |
| `grep -c 'path="/agents"\|path="/runtimes"\|path="/daemon-tokens"' App.tsx` | 3 |
| `grep -c "to: '/agents'\|to: '/runtimes'\|to: '/daemon-tokens'" Sidebar.tsx` | 3 |
| `grep -rnE "\{\{plaintext" apps/web/src/i18n/locales/` | 0 matches (HARD invariant) |
| `bash -c '! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management'` | exit 0 |
| `bash -c '! grep -rE "localStorage\|sessionStorage" apps/web/src/components/management'` | exit 0 |
| `grep -c "if grep" .github/workflows/ci.yml` | 2 (baseline unchanged) |

## Next Wave Readiness

- [x] `apps/web/src/components/management/` directory reserved via `.gitkeep`
- [x] All i18n keys (~145) in all 6 locales
- [x] Playwright spec file + 9 skip-stub titles reserved
- [x] 3 routes registered + sidebar nav live in DOM
- [x] CI grep guards armed (bulletproof form)
- [x] Agent status enum labels pre-seeded (Blocker-3 fix)
- [x] MGMT-03 a11y invariant grep-verified

Wave 1 (plan 25-01) can now land AgentList + AgentFormDialog + ArchiveConfirmDialog + `useAgents` hook + un-skip `agents list renders` + `agent form create` + `agent archive` + `sidebar nav` scenarios with zero structural churn.

## Commits

| Hash | Message |
| ---- | ------- |
| `25e4348` | `feat(25-00): i18n namespaces + page stubs + routes + sidebar + spec scaffold` |
| `977b638` | `chore(25-00): CI grep guards for management/ subtree (bulletproof form)` |

## Self-Check: PASSED

- [x] `apps/web/src/pages/AgentsPage.tsx` — FOUND
- [x] `apps/web/src/pages/RuntimesPage.tsx` — FOUND
- [x] `apps/web/src/pages/DaemonTokensPage.tsx` — FOUND
- [x] `apps/web/src/components/management/.gitkeep` — FOUND
- [x] `tests/e2e/management-uis.spec.ts` — FOUND
- [x] `.planning/phases/25-management-uis/deferred-items.md` — FOUND
- [x] Commit `25e4348` — FOUND
- [x] Commit `977b638` — FOUND
