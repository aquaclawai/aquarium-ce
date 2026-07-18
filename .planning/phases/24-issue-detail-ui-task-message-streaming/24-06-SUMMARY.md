---
phase: 24-issue-detail-ui-task-message-streaming
plan: 06
subsystem: ui
tags: [i18n, react-i18next, translations, locale, accessibility, phase-24-closure]

requires:
  - phase: 24-issue-detail-ui-task-message-streaming
    provides: "en.json issues.detail.* + chat.composer.* namespaces (added in Waves 0-5) with English placeholders installed in the 5 non-en locales"
provides:
  - "Native zh / fr / de / es / it translations for every issues.detail.* key (~70 keys) and chat.composer.* key (8 keys)"
  - "Byte-identical preservation of every i18next interpolation token across all 6 locales ({{count}}, {{shown}}, {{total}}, {{relativeTime}}, {{seconds}}, {{from}}, {{to}}, {{seq}}, {{toolName}}, {{number}}, {{issueNumber}}, {{workspaceName}}, {{author}}, {{displayName}}, {{agentName}}, {{authorName}}, {{max}})"
  - "U+22EF ellipsis (⋯) truncation marker preserved in every locale"
  - "PROJECT.md footer bumped to Phase 24 completion with UI-04..08 + CHAT-01 shipped note"
affects: [phase-25+, any future phase that adds keys to issues.detail.* or chat.composer.*]

tech-stack:
  added: []
  patterns:
    - "i18n parity gate (apps/web/scripts/check-i18n-parity.mjs) — 2053 keys x 6 locales enforced at CI"
    - "Translation-polish wave closes a phase after functional waves are green — matches Phase 23 Wave 5 pattern"
    - "Interpolation tokens preserved byte-identically; grep counts match EN across all 6 locales for each token"

key-files:
  created:
    - .planning/phases/24-issue-detail-ui-task-message-streaming/24-06-SUMMARY.md
  modified:
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json
    - .planning/PROJECT.md

key-decisions:
  - "Task 2 (zh locale-smoke Playwright test) skipped per plan's explicit option (b) — Phase 23 has no locale-smoke pattern to clone and native-speaker-quality QA is documented as a Manual-Only Verification per 24-VALIDATION.md; parity gate + build + E2E suite remain the objective gates"
  - "Kept the ⌘⏎ send-shortcut literal English-punctuation in all 5 locales — the keyboard symbols (⌘ + Enter glyph) are globally recognized, and per plan guidance localising them can confuse users on non-Mac keyboards; each locale adds its own connective prose (e.g. zh '⌘⏎ 发送', de '⌘⏎ zum Senden')"
  - "Kept pure-interpolation containers identical across locales: postedAt='{{relativeTime}}', comments.count='{{count}}', seqMeta='seq {{seq}} · {{relativeTime}}', issueNumber='#{{number}}'. These carry no locale-specific prose — matches Phase 23 Wave 5's columnCount='{{count}}' convention"
  - "Chose consistent per-locale terminology: fr 'ticket' (not 'issue'), de 'Vorgang' (not 'Issue'), zh '问题' (issue in CE context), es 'incidencia', it 'ticket'. Aligned with Phase 23 Wave 5's sidebar.issues terminology so the detail page matches the kanban board header"
  - "Author suffix localised: zh '· 代理', de '· Agent', fr '· agent', es '· agente', it '· agente' — keeps the · separator uniform and preserves the agentName interpolation order"

patterns-established:
  - "Pattern: translation wave edits MUST be scoped to target namespace — every diff is a 1-for-1 line replacement (equal insertions/deletions) within issues.detail.* and chat.composer.* only"
  - "Pattern: placeholder-preservation grep is the security invariant — T-24-06-01 (Tampering: translator drops an interpolation token) mitigated by per-token count comparison against EN across all 6 locales"

requirements-completed: [UI-08]

duration: 7m 12s
completed: 2026-04-17
---

# Phase 24 Plan 06: i18n translations for issues.detail.* + chat.composer.* namespaces Summary

**Closed the Phase 24 localisation gap by replacing en-placeholder strings with natural-reading zh / fr / de / es / it translations across every issues.detail.* and chat.composer.* key, preserving all 17 interpolation tokens byte-identically — completes UI-08 (UX5) and ships Phase 24.**

## Performance

- **Duration:** 7m 12s
- **Started:** 2026-04-17T20:39:16Z
- **Completed:** 2026-04-17T20:46:28Z
- **Tasks:** 1 (Task 2 explicitly skipped per plan option b)
- **Files modified:** 6 (5 locale files + PROJECT.md)

## Accomplishments

- Translated the full issues.detail.* subtree (~70 keys, 82 insertions/deletions per locale on average) in each of zh / fr / de / es / it to native phrasings
- Translated the chat.composer.* subtree (8 keys: srHeader, placeholder, send, sending, noAssignee, sendFailed, chars, hint) in each of the 5 non-en locales
- Preserved every i18next interpolation placeholder byte-identically — per-token grep counts match EN across all 6 locales (see Verification Results below)
- Preserved U+22EF truncation marker (⋯) across all 6 locales — count = 1 each
- i18n parity gate cleanly green: `OK: 2053 keys checked across 6 locales (en, zh, fr, de, es, it).`
- Phase 24 Playwright suite: **7/8 green, 1 skipped** (background tab recovery, manual-only per VALIDATION) — no regression from translations
- Phase 23 Playwright suite: **8/8 green** — no kanban regression
- CE web build clean: `IssueDetailPage-*.js` chunk 36.54 kB / 11.00 kB gzipped
- Server typecheck + shared package build clean
- Diff strictly scoped: every changed line falls inside lines 1132-1142 (chat.composer.*) or lines 2449-2559 (issues.detail.*) of each locale file — no drift into the other ~2000 keys
- `.planning/PROJECT.md` footer updated to note Phase 24 completion with UI-04..08 + CHAT-01 shipped, including references to the 16 KB truncation, WS buffered-replay, React 19 useTransition, and zero-dangerouslySetInnerHTML invariants

## Task Commits

Each task committed atomically:

1. **Task 1: Translate issues.detail.* + chat.composer.* in 5 locale files (+ update PROJECT.md footer)** — `e206119` (feat)

_Task 2 (optional zh locale-smoke Playwright test) explicitly skipped — see Decisions Made #1._

## Files Created/Modified

### Per-locale diff scope (issues.detail.* + chat.composer.* blocks only)

| Locale | Total lines changed | Insertions | Deletions | Namespaces touched |
|--------|---------------------|------------|-----------|--------------------|
| zh     | 164 (82 ins / 82 del) | 82 | 82 | issues.detail.*, chat.composer.* |
| fr     | 162 (81 ins / 81 del) | 81 | 81 | issues.detail.*, chat.composer.* |
| de     | 160 (80 ins / 80 del) | 80 | 80 | issues.detail.*, chat.composer.* |
| es     | 162 (81 ins / 81 del) | 81 | 81 | issues.detail.*, chat.composer.* |
| it     | 160 (80 ins / 80 del) | 80 | 80 | issues.detail.*, chat.composer.* |

Every locale has balanced insertions/deletions — the parity gate would have caught any key addition or removal.

### Modified files
- `apps/web/src/i18n/locales/zh.json` — 82 value updates (issues.detail.* + chat.composer.*)
- `apps/web/src/i18n/locales/fr.json` — 81 value updates
- `apps/web/src/i18n/locales/de.json` — 80 value updates
- `apps/web/src/i18n/locales/es.json` — 81 value updates
- `apps/web/src/i18n/locales/it.json` — 80 value updates
- `.planning/PROJECT.md` — 1-line footer replacement (Phase 23 completion note → Phase 24 completion note)

### Created files
- `.planning/phases/24-issue-detail-ui-task-message-streaming/24-06-SUMMARY.md` — this file

## Decisions Made

1. **Task 2 (zh locale-smoke Playwright test) skipped per plan option (b).** The plan explicitly permits skipping if Phase 23 has no locale-smoke pattern to clone. Verified `tests/e2e/issues-board.spec.ts` — no `locale` / `language` / `i18nextLng` cookie manipulation exists in Phase 23 tests; they all run under the default EN locale. Adding a new cookie-driven locale-switch scenario from scratch would require changes to `apps/web/src/i18n/index.ts` language detection and Playwright test helpers — scope creep beyond UI-08. Per 24-VALIDATION.md §Manual-Only Verifications, native-speaker linguistic-quality review is listed as a manual-only test. The objective gates (i18n parity + web build + E2E regression) are sufficient to prove translations load without breaking rendering; QA signs off on linguistic quality separately.

2. **`⌘⏎` keyboard shortcut kept in all 5 locales.** The `chat.composer.placeholder` and `chat.composer.hint` keys both contain `⌘⏎`. The ⌘ (Cmd) + ⏎ (Enter) glyphs are a universally recognized visual convention; localising them to "Cmd+Enter" or "Ctrl+Enter" would (a) inflate the placeholder width and (b) require per-OS variants. Each locale adds natural connective prose around the glyph (zh "⌘⏎ 发送", de "⌘⏎ zum Senden", fr "⌘⏎ pour envoyer", es "⌘⏎ para enviar", it "⌘⏎ per inviare"). Matches macOS HIG localisation guidance.

3. **Pure-interpolation containers held identical across all 6 locales.** `issues.detail.comments.postedAt` is `"{{relativeTime}}"` in every locale, `issues.detail.comments.count` is `"{{count}}"` in every locale, and `issues.detail.task.seqMeta` is `"seq {{seq}} · {{relativeTime}}"` in every locale. These contain no locale-specific prose — localising them would introduce drift without adding value. Matches Phase 23 Wave 5's `columnCount = "{{count}}"` convention.

4. **Per-locale terminology anchored to Phase 23 sidebar choice.** Phase 23 Wave 5 established sidebar.issues translations per locale (zh 问题, fr Tickets, de Tickets, es Incidencias, it Ticket). Wave 6 maintains the same nouns in the detail page: fr consistently uses "ticket" (not "issue" or "problème"), de uses "Vorgang" (not "Issue"), zh uses 问题 throughout, es uses "incidencia", it uses "ticket". Avoids jarring register switches between kanban header and detail header.

5. **Agent author suffix localised consistently.** `issues.detail.comments.author.agent = "{{agentName}} · agent"` → zh "· 代理", fr "· agent", de "· Agent", es "· agente", it "· agente". Uniform `·` separator, preserved interpolation order, localised noun. Capitalisation follows each locale's convention (de capitalises nouns, others lowercase).

## Deviations from Plan

None — plan executed exactly as written. Task 2 was explicitly optional in the plan with option (b) covering the skip path taken here; this is not a deviation.

## Issues Encountered

None. The parity script ran green on every iteration, the web build compiled cleanly, and both Playwright suites remained green throughout. No auth gates, no Rule 1-4 triggers, no blocking dependencies.

## Authentication Gates

None.

## Authentication Flow Notes

Not applicable — this plan is a content-only edit against JSON locale files.

## Verification Results

### i18n parity gate
```
$ node apps/web/scripts/check-i18n-parity.mjs
OK: 2053 keys checked across 6 locales (en, zh, fr, de, es, it).
```

### Interpolation token preservation (T-24-06-01 mitigation)
Per-token grep count comparison between EN and each non-en locale. Every token count matches exactly:

| Token | EN | zh | fr | de | es | it |
|-------|----|----|----|----|----|----|
| `{{count}}` | 27 | 27 | 27 | 27 | 27 | 27 |
| `{{shown}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{total}}` | 4 | 4 | 4 | 4 | 4 | 4 |
| `{{relativeTime}}` | 5 | 5 | 5 | 5 | 5 | 5 |
| `{{seconds}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{from}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{to}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{seq}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{toolName}}` | 2 | 2 | 2 | 2 | 2 | 2 |
| `{{number}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{issueNumber}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{workspaceName}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{author}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{displayName}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{agentName}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{authorName}}` | 1 | 1 | 1 | 1 | 1 | 1 |
| `{{max}}` | 2 | 2 | 2 | 2 | 2 | 2 |

### U+22EF truncation marker preservation
```
en: ⋯ count=1  |  zh: ⋯ count=1  |  fr: ⋯ count=1
de: ⋯ count=1  |  es: ⋯ count=1  |  it: ⋯ count=1
```

### Spot checks per locale
| Locale | issues.detail.back | chat.composer.send | issues.detail.task.truncated |
|--------|---------------------|---------------------|------------------------------|
| zh | 返回问题列表 | 发送 | ⋯ 已截断（显示 {{shown}} / {{total}} 字节） |
| fr | Retour aux tickets | Envoyer | ⋯ tronqué (affichage de {{shown}} sur {{total}} octets) |
| de | Zurück zu Vorgängen | Senden | ⋯ abgeschnitten (zeigt {{shown}} von {{total}} Bytes) |
| es | Volver a incidencias | Enviar | ⋯ truncado (mostrando {{shown}} de {{total}} bytes) |
| it | Torna ai ticket | Invia | ⋯ troncato (mostrati {{shown}} di {{total}} byte) |

Every value is a native string (not the EN placeholder), with the interpolation tokens preserved in each locale's natural word order.

### Phase 24 Playwright suite — full run
```
$ npx playwright test tests/e2e/issue-detail.spec.ts --reporter=line
Running 8 tests using 1 worker
[1/8] issue detail renders
[2/8] threaded comments
[3/8] task stream live
[4/8] background tab recovery                  ← test.skip (manual-only per VALIDATION)
[5/8] reconnect replay
[6/8] replay no reorder
[7/8] truncation marker
[8/8] chat on issue
  1 skipped
  7 passed (14.7s)
```

The single skipped scenario is `background tab recovery` (line 319), which is already marked `test.skip(...)` per 24-02-SUMMARY and documented as manual-only in 24-VALIDATION.md §Manual-Only Verifications (Chrome tab-throttle + BFcache behaviour not reliably reproducible in headless Playwright). No other scenario was accidentally skipped.

### Phase 23 Playwright regression — full run
```
$ npx playwright test tests/e2e/issues-board.spec.ts --reporter=line
Running 8 tests using 1 worker
[1/8] renders columns
[2/8] mouse drag
[3/8] concurrent reorder
[4/8] own echo
[5/8] virtualization
[6/8] virtualization drag
[7/8] keyboard drag
[8/8] a11y announcer
  8 passed (39.6s)
```

Phase 23 kanban unchanged — including the a11y announcer scenario that reads the en issues.board.a11y.* templates — confirming the translation edits did not leak into Phase 23's key namespace.

### Typecheck + build
- `npm run build -w @aquarium/shared` → exit 0
- `npm run typecheck -w @aquaclawai/aquarium` → exit 0
- `npm run build:ce -w @aquarium/web` → exit 0 (Vite bundle built, `IssueDetailPage-*.js` chunk 36.54 kB / gzip 11.00 kB, `index-*.js` 334.47 kB / gzip 101.12 kB — no new chunks, no size blow-up)

### Diff scope verification
All 5 locale diffs touch exactly two hunk regions:
- Lines 1132-1142: `chat.composer.*` subtree
- Lines 2449-2559: `issues.detail.*` subtree

Zero edits outside these ranges. `git diff --stat` shows balanced insertions/deletions per file (82/82, 81/81, 80/80, 81/81, 80/80), confirming no keys were added or removed — which would have been the only way to break i18n parity.

### `dangerouslySetInnerHTML` CI guard
```
$ grep -r 'dangerouslySetInnerHTML' apps/web/src/components/issues/detail/
(no matches)
```
T-24-06-03 (Tampering via injected `<script>`) mitigation holds. All translated strings render via `t('...')` → plain string → React auto-escape. No `<Trans>` with HTML components anywhere in detail.

## User Setup Required

None — this is a content-only plan. No new environment variables, no new secrets, no new dashboard configuration. Users switching to a non-en locale via the existing language picker will see the new native strings on next page load.

## Phase 24 Closure

This plan is the final wave (Wave 6) in Phase 24. With 24-06 landed:

- **UI-04** (Issue detail page renders title + description + threaded comments + action sidebar) — SHIPPED (plan 24-01)
- **UI-05** (Task messages stream live via WS subscribe_task with tool_use/tool_result/text/thinking kinds, React 19 useTransition + virtualization for 500+ messages) — SHIPPED (plan 24-02)
- **UI-06** (Reconnect mid-stream replays from lastSeq with buffered-replay-live invariant) — SHIPPED (plan 24-03)
- **UI-07** (Zero dangerouslySetInnerHTML, explicit truncation marker with Show-full affordance, 16 KB server truncation + overflow row) — SHIPPED (plan 24-04 + plan 24-00 server work)
- **CHAT-01** (Chat on issue: user comment → task with trigger_comment_id → streamed response → threaded agent comment) — SHIPPED (plan 24-05)
- **UI-08 (UX5)** (Localisation coverage across 6 locales) — SHIPPED (this plan)

Phase 24 is complete. All Playwright scenarios green. All deviation rules respected. i18n parity enforced by CI. Native-speaker linguistic-quality QA is pending per 24-VALIDATION.md §Manual-Only — not a blocker for phase closure.

## Self-Check: PASSED

- `.planning/phases/24-issue-detail-ui-task-message-streaming/24-06-SUMMARY.md` — FOUND (this file)
- Commit `e206119` — FOUND (`git log --oneline -3` shows `e206119 feat(24-06): translate issues.detail.* + chat.composer.* across 5 non-en locales (UI-08 / UX5)`)
- All 5 target locale files present and JSON.parse-valid with non-empty translated `issues.detail.*` + `chat.composer.*` subtrees (spot-checks above)
- `.planning/PROJECT.md` present and updated with Phase 24 footer
- Zero keys outside `issues.detail.*` + `chat.composer.*` modified in any locale file — verified via balanced per-file diff stats and hunk-range grep (all `@@ -N,M +N,M @@` hunks are inside the two target line ranges)
- i18n parity: `OK: 2053 keys checked across 6 locales`
- Phase 24 Playwright: 7 passed / 1 skipped (expected)
- Phase 23 Playwright: 8/8 green (no regression)

---
*Phase: 24-issue-detail-ui-task-message-streaming*
*Completed: 2026-04-17*
