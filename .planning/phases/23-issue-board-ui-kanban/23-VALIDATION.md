---
phase: 23
slug: issue-board-ui-kanban
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nyquist required: `workflow.nyquist_validation: true` per `.planning/config.json`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (Chromium only, fullyParallel; `playwright.config.ts` at repo root) |
| **DB fixture** | better-sqlite3 for seed/assertion (pattern from `tests/e2e/issues-agents-comments.spec.ts`) |
| **Quick run command** | `npx playwright test tests/e2e/issues-board.spec.ts -g "<scenario>"` |
| **Full suite command** | `npx playwright test tests/e2e/issues-board.spec.ts` |
| **i18n parity** | `node apps/web/scripts/check-i18n-parity.mjs` |
| **Typecheck/build** | `npm run build -w @aquarium/shared && npm run build:ce -w @aquarium/web` |
| **Lint** | `npm run lint` (ESLint 9 flat config on web) |
| **Estimated runtime** | ~60–90 s for full Playwright spec (7–9 scenarios), ~2 s for i18n parity |

---

## Sampling Rate

- **After every task commit:** Run the one matching Playwright scenario (`-g "<name>"`) or the i18n-parity script — per Verification Map row.
- **After every plan wave:** Full `tests/e2e/issues-board.spec.ts` + `npm run build:ce -w @aquarium/web` + `npm run lint`.
- **Before `/gsd-verify-work`:** Full Playwright suite green + i18n parity script green + manual drag inspection at 200 issues confirms ≤ 20 cards in virtualized DOM.
- **Max feedback latency:** 30 s per scenario, 90 s full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-00-01 | 00 | 0 | UX3 | — | Z-index ladder CSS vars declared; drag overlay + toast migrated | unit/build | `grep -c "^\s*--z-" apps/web/src/index.css >= 6` | ❌ Wave 0 | ⬜ pending |
| 23-00-02 | 00 | 0 | UX5 | — | i18n parity script catches missing keys across 6 locales | script | `node apps/web/scripts/check-i18n-parity.mjs` exits 0 | ❌ Wave 0 | ⬜ pending |
| 23-00-03 | 00 | 0 | A1 (research) | — | WS broadcasts reach authenticated client without explicit subscribe | inline | Read `apps/server/src/ws/index.ts` — document behaviour | ❌ Wave 0 | ⬜ pending |
| 23-01-01 | 01 | 1 | UI-01 | — | IssueBoard renders read-only column-per-status view | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "renders columns"` | ❌ Wave 0 | ⬜ pending |
| 23-01-02 | 01 | 1 | UI-01 | — | Mouse drag moves card Todo → In Progress, server receives `POST /reorder` | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "mouse drag"` | ❌ Wave 0 | ⬜ pending |
| 23-02-01 | 02 | 2 | UI-02 (UX1 HARD) | — | Second session's `issue:reordered` during active drag deferred until drop | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "concurrent reorder"` | ❌ Wave 0 | ⬜ pending |
| 23-02-02 | 02 | 2 | UI-02 | — | Own-echo `issue:reordered` doesn't cause double-apply | e2e | same file, `-g "own echo"` | ❌ Wave 0 | ⬜ pending |
| 23-03-01 | 03 | 3 | UI-03 (UX4) | — | 200 issues seeded; virtualizer renders ≤ 20 cards in DOM | e2e | `-g "virtualization"` — assert `document.querySelectorAll('[data-issue-card]').length <= 25` | ❌ Wave 0 | ⬜ pending |
| 23-03-02 | 03 | 3 | UI-03 (UX4) | — | During drag, overscan bumps to items.length; dragged card never unmounts | e2e | `-g "virtualization drag"` — assert dragged card persists across scroll | ❌ Wave 0 | ⬜ pending |
| 23-04-01 | 04 | 4 | UI-01 (UX2 a11y) | — | Keyboard drag: Tab → Space → ArrowRight → Space moves card between columns | e2e | `-g "keyboard drag"` | ❌ Wave 0 | ⬜ pending |
| 23-04-02 | 04 | 4 | UX2 | — | `@dnd-kit/accessibility` live region announces drag events | e2e | `-g "a11y announcer"` — assert aria-live region text updates on pick-up/drop | ❌ Wave 0 | ⬜ pending |
| 23-05-01 | 05 | 5 | UX5 | — | All 6 locales (en/zh/fr/de/es/it) contain `issues.board.*` namespace keys | script | `node apps/web/scripts/check-i18n-parity.mjs` exits 0 | ❌ Wave 0 | ⬜ pending |
| 23-05-02 | 05 | 5 | UX5 | — | CI runs i18n parity on every push (prevents drift) | script | `grep -c check-i18n-parity .github/workflows/ci.yml >= 1` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, `@dnd-kit/accessibility` (latest compatible), `@tanstack/react-virtual@3.13.24` into `apps/web/package.json`
- [ ] `apps/web/src/index.css` — z-index ladder CSS variables (`--z-header`, `--z-dropdown`, `--z-modal`, `--z-toast`, `--z-drag-overlay`)
- [ ] `apps/web/scripts/check-i18n-parity.mjs` — Node script that globs `apps/web/src/**/*.{ts,tsx}` for `t('key')` calls and asserts every key exists in all 6 locale JSONs
- [ ] `.github/workflows/ci.yml` — add `check-i18n-parity` step (UX5 mitigation)
- [ ] Wave 0 prototype: 200-issue virtualized DnD sanity check (can be discarded after verification; confirms A3/A4 assumptions)
- [ ] `tests/e2e/issues-board.spec.ts` — new spec file with scenarios matching Verification Map rows
- [ ] `apps/web/src/components/issues/` directory scaffold (IssueBoard, IssueColumn, IssueCard, hooks)
- [ ] Document WS subscription semantics (A1 verification) in a short inline comment in the board-hook file

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 60 FPS during drag at 200+ issues | UI-03 (UX4) | FPS is a perception metric; Playwright can assert virtualizer DOM size but not frame timing reliably | Open issues board with 200 seeded issues in Chromium, open DevTools → Performance tab, start recording, drag a card from Todo to In Progress across multiple columns, stop recording. Assert: "Frames" track shows mostly green bars (no red >50 ms frames during drag). |
| Visual polish / drag overlay shadow / column hover states | UX3 + design quality | Visual design judgement | Open board, drag cards, confirm drag overlay has shadow/elevation distinguishing it from static cards; confirm empty column has a subtle drop-target affordance. |
| Localized rendering (zh/fr/de/es/it) reads naturally | UX5 | Linguistic quality check | Switch language, open board, confirm column headers (Todo/In Progress/etc.), button labels, and empty-state text read naturally in each locale. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (deps, scripts, CI, fixtures, component scaffold)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90 s full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner confirms

**Approval:** pending
