---
phase: 25
slug: management-uis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nyquist required: `workflow.nyquist_validation: true` per `.planning/config.json`.
> Research gate: SKIP (per ROADMAP) — scope fully defined by 4 SCs + 3 REQ IDs; server endpoints all exist from Phases 16/17/19.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (Chromium only, fullyParallel; `playwright.config.ts` at repo root) |
| **DB fixture** | better-sqlite3 for seed/assertion (pattern from Phase 23 / Phase 24 specs) |
| **Quick run command** | `npx playwright test tests/e2e/management-uis.spec.ts -g "<scenario>"` |
| **Full suite command** | `npx playwright test tests/e2e/management-uis.spec.ts` |
| **i18n parity** | `node apps/web/scripts/check-i18n-parity.mjs` (already shipped in Phase 23; enforces 6 locales) |
| **Typecheck/build** | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run build:ce -w @aquarium/web` |
| **Lint** | `npm run lint -w @aquarium/web` |
| **Estimated runtime** | ~50–70 s for full Playwright spec (7–9 scenarios), ~2 s for i18n parity |

---

## Sampling Rate

- **After every task commit:** Run the one matching Playwright scenario (`-g "<name>"`) OR the i18n-parity script.
- **After every plan wave:** Full `tests/e2e/management-uis.spec.ts` + `npm run build:ce -w @aquarium/web` + `npm run lint`.
- **Before `/gsd-verify-work`:** Full Playwright suite green + i18n parity green + manual copy-token-once visual inspection.
- **Max feedback latency:** 25 s per scenario, 70 s full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-00-01 | 00 | 0 | MGMT-01/02/03 | — | Playwright spec scaffolded with skip-stubs for all downstream scenarios | build | `grep -c "test.skip(" tests/e2e/management-uis.spec.ts >= 6` | ❌ Wave 0 | ⬜ pending |
| 25-00-02 | 00 | 0 | MGMT-01/02/03 | — | `apps/web/src/components/management/` directory scaffold + i18n `management.agents.*`/`management.runtimes.*`/`management.daemonTokens.*` namespaces in all 6 locales | build | `node apps/web/scripts/check-i18n-parity.mjs` exits 0 | ❌ Wave 0 | ⬜ pending |
| 25-00-03 | 00 | 0 | MGMT-01/02/03 | — | Sidebar nav entries for Agents / Runtimes / Daemon Tokens wired into layout | e2e | `-g "sidebar nav"` asserts 3 new nav items visible | ❌ Wave 0 | ⬜ pending |
| 25-01-01 | 01 | 1 | MGMT-01 | — | Agents page lists agents with runtime badge, status, max_concurrent_tasks | e2e | `-g "agents list renders"` | ❌ Wave 0 | ⬜ pending |
| 25-01-02 | 01 | 1 | MGMT-01 | — | Create/edit agent form includes instructions, runtime selector, custom_env, custom_args, max_concurrent_tasks | e2e | `-g "agent form create"` | ❌ Wave 0 | ⬜ pending |
| 25-01-03 | 01 | 1 | MGMT-01 | — | Agent archive flow with confirmation | e2e | `-g "agent archive"` | ❌ Wave 0 | ⬜ pending |
| 25-02-01 | 02 | 2 | MGMT-02 | — | Runtimes page shows hosted + daemon runtimes in one unified list with kind filter chip | e2e | `-g "runtimes unified list"` | ❌ Wave 0 | ⬜ pending |
| 25-02-02 | 02 | 2 | MGMT-02 | — | Each runtime row displays device_info + last_heartbeat_at + status badge | e2e | `-g "runtime row details"` | ❌ Wave 0 | ⬜ pending |
| 25-03-01 | 03 | 3 | MGMT-03 | T-25-03-01 | Daemon token plaintext shown ONCE on creation, never persisted client-side after close | e2e | `-g "token copy once"` — asserts plaintext appears then disappears after dismiss; revisit page shows hashed-only projection | ❌ Wave 0 | ⬜ pending |
| 25-03-02 | 03 | 3 | MGMT-03 | — | Token create form accepts friendly name + optional expiry (date picker) | e2e | `-g "token create form"` | ❌ Wave 0 | ⬜ pending |
| 25-03-03 | 03 | 3 | MGMT-03 | — | Token list shows existing tokens; revoke flow requires confirmation | e2e | `-g "token revoke"` | ❌ Wave 0 | ⬜ pending |
| 25-04-01 | 04 | 4 | UI-08 (UX5 carry-forward) | — | All 6 locales contain `management.agents.*`/`management.runtimes.*`/`management.daemonTokens.*` namespaces with real translations | script | `node apps/web/scripts/check-i18n-parity.mjs` exits 0 AND zh/fr/de/es/it no longer match en placeholders | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/management-uis.spec.ts` — new spec file with ≥ 6 skip-stub scenarios
- [ ] `apps/web/src/pages/AgentsPage.tsx`, `RuntimesPage.tsx`, `DaemonTokensPage.tsx` — 3 page scaffolds
- [ ] `apps/web/src/components/management/` directory scaffold (AgentList, AgentForm, RuntimeList, RuntimeRow, DaemonTokenList, DaemonTokenCreateModal, sub-components)
- [ ] `apps/web/src/App.tsx` — add `/agents`, `/runtimes`, `/daemon-tokens` routes
- [ ] `apps/web/src/components/layout/Sidebar.tsx` — add 3 nav entries
- [ ] i18n namespaces in all 6 locales: `management.agents.*` + `management.runtimes.*` + `management.daemonTokens.*` + `sidebar.agents`/`sidebar.runtimes`/`sidebar.daemonTokens` (en complete; 5 locales as placeholders for Wave 4 to translate)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Daemon token plaintext UX — copy button works cross-browser | MGMT-03 | Clipboard API behaviour differs by browser/permissions | In Chrome, Firefox, Safari (on macOS): create a token, click copy button, paste in a text field, confirm plaintext matches. Click "I've saved it" dismiss; revisit page; confirm plaintext is gone (only hashed projection shown). |
| Native-speaker linguistic-quality review — zh/fr/de/es/it on `management.*` | MGMT-01/02/03 + UX5 | Linguistic judgement | Switch language to each of zh/fr/de/es/it. Visit Agents + Runtimes + Daemon Tokens pages. Confirm strings read naturally. |
| Empty-state design quality | MGMT-01/02/03 + design | Visual judgement | With zero agents / zero runtimes / zero tokens, confirm each page renders a polished empty state (illustration or heading + CTA), not a blank table. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (pages, components, spec, i18n)
- [ ] No watch-mode flags
- [ ] Feedback latency < 70 s full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner confirms

**Approval:** pending
