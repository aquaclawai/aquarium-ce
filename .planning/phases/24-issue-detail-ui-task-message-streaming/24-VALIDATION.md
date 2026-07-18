---
phase: 24
slug: issue-detail-ui-task-message-streaming
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nyquist required: `workflow.nyquist_validation: true` per `.planning/config.json`.
> Research gate: SKIP (per ROADMAP) — scope fully defined by 5 SCs + 6 REQ IDs + 3 owned pitfalls (ST2 reconnect replay, ST3 background-tab backpressure, UX6 truncation + XSS).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (Chromium only, fullyParallel; `playwright.config.ts` at repo root) |
| **DB fixture** | better-sqlite3 for direct seed/assertion |
| **Quick run command** | `npx playwright test tests/e2e/issue-detail.spec.ts -g "<scenario>"` |
| **Full suite command** | `npx playwright test tests/e2e/issue-detail.spec.ts` |
| **i18n parity** | `node apps/web/scripts/check-i18n-parity.mjs` (already shipped in Phase 23; covers 6 locales) |
| **Typecheck/build** | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run build:ce -w @aquarium/web` |
| **Server test_unit** | `npm run test:unit -w @aquaclawai/aquarium` (for server-side 16 KB truncation + replay endpoint) |
| **Estimated runtime** | ~70–100 s for full Playwright spec (8–10 scenarios), ~8 s for server unit suite |

---

## Sampling Rate

- **After every task commit:** Run the one matching Playwright scenario (`-g "<name>"`) OR the relevant server unit test file (for truncation/replay changes).
- **After every plan wave:** Full `tests/e2e/issue-detail.spec.ts` + `npm run test:unit -w @aquaclawai/aquarium` + typecheck + web build.
- **Before `/gsd-verify-work`:** Full Playwright suite green + full server unit suite green + i18n parity green + manual backgrounded-tab recovery test.
- **Max feedback latency:** 30 s per scenario, 100 s full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-00-01 | 00 | 0 | UI-07 (UX6) | T-24-00-01 | Server truncates task_messages to 16 KB with explicit truncated marker | unit | `npx tsx --test apps/server/tests/unit/task-message-truncation.test.ts` | ❌ Wave 0 | ⬜ pending |
| 24-00-02 | 00 | 0 | UI-06 (ST2) | T-24-00-02 | `GET /api/tasks/:id/messages?afterSeq=N` returns rows > N in seq order | unit | same file OR `tests/unit/task-messages-replay.test.ts` | ❌ Wave 0 | ⬜ pending |
| 24-00-03 | 00 | 0 | UI-05 | — | WS `subscribe_task` handler buffers live broadcasts until replay flush completes (ordering invariant) | unit | `tests/unit/ws-subscribe-task.test.ts` | ❌ Wave 0 | ⬜ pending |
| 24-00-04 | 00 | 0 | UI-08 (UX5) | — | Playwright spec file scaffolded with skip-stubs for all downstream scenarios | build | `grep -c "test.skip(" tests/e2e/issue-detail.spec.ts >= 7` | ❌ Wave 0 | ⬜ pending |
| 24-01-01 | 01 | 1 | UI-04 | — | Issue detail page at `/issues/:id` renders title + description + comments timeline + action sidebar | e2e | `-g "issue detail renders"` | ❌ Wave 0 | ⬜ pending |
| 24-01-02 | 01 | 1 | UI-04 | — | Threaded comments render by `parent_id` (parent-child indentation) | e2e | `-g "threaded comments"` | ❌ Wave 0 | ⬜ pending |
| 24-02-01 | 02 | 2 | UI-05 | — | Task messages stream live via WS `subscribe_task` with tool_use/tool_result/text/thinking kinds | e2e | `-g "task stream live"` | ❌ Wave 0 | ⬜ pending |
| 24-02-02 | 02 | 2 | UI-05 (ST3) | T-24-02-02 | Messages rendered via `useTransition` so main thread stays unblocked at 500+ messages | e2e | `-g "background tab recovery"` + perf assert | ❌ Wave 0 | ⬜ pending |
| 24-03-01 | 03 | 3 | UI-06 (ST2) | — | Reconnect mid-stream replays `task_messages` from `lastSeq` with no gaps + no duplicates | e2e | `-g "reconnect replay"` | ❌ Wave 0 | ⬜ pending |
| 24-03-02 | 03 | 3 | UI-06 | — | Server-side replay + live-handoff buffer prevents out-of-order delivery | e2e | `-g "replay no reorder"` | ❌ Wave 0 | ⬜ pending |
| 24-04-01 | 04 | 4 | UI-07 (UX6) | T-24-04-01 | Zero `dangerouslySetInnerHTML` in `apps/web/src/components/issues/detail/` — grep returns 0 | build | `! grep -r 'dangerouslySetInnerHTML' apps/web/src/components/issues/detail/` | ❌ Wave 0 | ⬜ pending |
| 24-04-02 | 04 | 4 | UI-07 | — | Truncated messages show explicit "truncated" marker + "Show full" affordance | e2e | `-g "truncation marker"` | ❌ Wave 0 | ⬜ pending |
| 24-05-01 | 05 | 5 | CHAT-01 | — | Chat on issue: user types → task enqueued with `trigger_comment_id` → response streams → completes as threaded agent comment | e2e | `-g "chat on issue"` | ❌ Wave 0 | ⬜ pending |
| 24-06-01 | 06 | 6 | UI-08 (UX5) | — | All 6 locales (en/zh/fr/de/es/it) contain `issues.detail.*` + `chat.*` namespace keys | script | `node apps/web/scripts/check-i18n-parity.mjs` exits 0 | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install `react-markdown` (for safe markdown rendering of text/thinking messages) + `rehype-sanitize` (default-safe plugin) — confirm versions during Wave 0
- [ ] Install `react-virtuoso` (for message-list virtualization per ST3) — or reuse Phase 23's `@tanstack/react-virtual` if functionally equivalent
- [ ] `apps/server/src/services/task-message-store.ts` (or extend existing) — add 16 KB truncation on insert
- [ ] `apps/server/src/routes/tasks.ts` (or similar) — add `GET /api/tasks/:id/messages?afterSeq=N` replay endpoint
- [ ] `apps/server/src/ws/` — add `subscribe_task` handler with buffered replay + live-handoff ordering invariant
- [ ] Server unit tests: `task-message-truncation.test.ts`, `task-messages-replay.test.ts`, `ws-subscribe-task.test.ts`
- [ ] `tests/e2e/issue-detail.spec.ts` — new spec file stubbed with 7+ skip scenarios
- [ ] `apps/web/src/pages/IssueDetailPage.tsx`
- [ ] `apps/web/src/components/issues/detail/` directory scaffold (IssueHeader, CommentsTimeline, CommentThread, TaskPanel, TaskMessageList, TaskMessageItem, ChatComposer hooks)
- [ ] New i18n namespaces in all 6 locales: `issues.detail.*` + `chat.*` (at minimum ~40 keys)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Backgrounded-tab recovery at 500+ messages, main thread not blocked | UI-05 + ST3 | Realistic Chrome tab-throttle + BFcache behaviour not reliably reproducible in headless Playwright | Open issue detail for a live 500-msg task in Chrome, switch to another tab for 60 s, return — UI should catch up without freezing; DevTools Performance tab shows no 500 ms+ blocking main-thread tasks |
| Markdown rendering of agent text/thinking is XSS-safe when agent output contains `<script>`, `<iframe>`, `onload=` | UI-07 + UX6 | Manual inspection of react-markdown + rehype-sanitize output against adversarial inputs | Manually paste a known-bad string into agent output fixture; render in issue detail; confirm no script execution, no iframe loaded |
| Native-speaker linguistic-quality review for zh/fr/de/es/it on the new `issues.detail.*` + `chat.*` namespaces | UI-08 (UX5) | Linguistic quality check | Switch language, open issue detail + chat composer, confirm strings read naturally |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (server unit tests, Playwright spec, component scaffold, i18n namespaces, deps)
- [ ] No watch-mode flags
- [ ] Feedback latency < 100 s full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner confirms

**Approval:** pending
