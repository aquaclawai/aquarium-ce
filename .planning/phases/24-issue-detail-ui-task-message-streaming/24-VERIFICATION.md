---
phase: 24-issue-detail-ui-task-message-streaming
verified: 2026-04-17T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Background-tab recovery at 500+ messages — 60 FPS main-thread check"
    expected: "Switch to another tab while a 500-message task is streaming; return to the tab; UI catches up fully. Chrome DevTools Performance tab must show no blocking main-thread task >= 500 ms during the catch-up burst."
    why_human: "Chrome tab-throttle and BFcache behaviour are not reliably reproducible in headless Playwright (confirmed as manual-only in 24-VALIDATION.md row 24-02-02)."
  - test: "XSS adversarial input audit for agent-authored content"
    expected: "Paste <script>alert(1)</script>, <iframe src=javascript:void(0)>, and onload=alert(1) as agent output in a fixture task_message row; navigate to the issue detail page; confirm zero script execution, no iframe loaded, no attribute handler fired."
    why_human: "Automated grep confirms zero dangerouslySetInnerHTML and rehype-sanitize is wired; adversarial execution can only be confirmed by a human examining live browser DevTools output and the rendered DOM."
  - test: "Native-speaker linguistic-quality review for zh/fr/de/es/it on issues.detail.* and chat.* namespaces"
    expected: "Switch browser language to each of zh, fr, de, es, it; open an issue detail page and the chat composer; confirm strings read naturally and carry correct gender/formality/register for the locale."
    why_human: "Programmatic parity checks (node apps/web/scripts/check-i18n-parity.mjs) only confirm key presence and non-null values. Linguistic quality requires native-speaker review."
---

# Phase 24: Issue Detail + Task Message Streaming Verification Report

**Phase Goal:** Users open an issue, see its full timeline (description + comments + system events) and watch any running task stream live tool-use / tool-result / text / thinking messages over WebSocket, with automatic replay on reconnect.
**Verified:** 2026-04-17
**Status:** human_needed — all automated checks pass; three manual-only verification items remain (SC-3 60-FPS backgrounded-tab recovery, UX6 adversarial XSS audit, UX5 native-speaker i18n review).
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Issue detail page shows description, threaded comments by `parent_id`, and a live task panel that auto-subscribes via WS `subscribe_task` | VERIFIED | `IssueDetailPage.tsx` composes `IssueDescription`, `CommentsTimeline` (builds forest by `parentId`), `TaskPanel` wired to `useTaskStream` which sends `subscribe_task` on mount. Playwright tests "issue detail renders" and "threaded comments" pass (7/7 active). |
| SC-2 | Reconnecting mid-stream replays missed messages from `task_messages` table using `lastSeq`, with no gaps or duplicates | VERIFIED | `useTaskStream.ts` lines 210-219 fire `requestTaskReplay(taskId, lastSeqRef.current)` on `false→true` isConnected transition. Server `ws/index.ts` calls `listRecentMessagesAfterSeq` (DESC-500 cap, reversed ASC). Dedup guard at line 107: `if (payload.seq <= lastSeqRef.current) return`. Playwright tests "reconnect replay" (10 msgs) and "replay no reorder" (40 msgs + monotonic DOM assert) pass. |
| SC-3 | Switching to a background tab during an active task and returning shows all accumulated messages without blocking the main thread (uses React 19 `useTransition`) | HUMAN NEEDED | `useTaskStream.ts` uses `useTransition` (line 76) + `useDeferredValue` (line 69). `visibilitychange` handler calls `pauseTaskStream` / `resumeTaskStream(taskId, lastSeqRef.current)`. Code path is correct; 60-FPS guarantee requires manual Chrome DevTools measurement per 24-VALIDATION.md. |
| SC-4 | Agent-authored output never executes as HTML (no `dangerouslySetInnerHTML`); task output is truncated to 16 KB server-side with an explicit "truncated" marker | VERIFIED | `grep dangerouslySetInnerHTML apps/web/src/components/issues/detail/` → 0 hits. `TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384` in `task-message-store.ts`. `markdown.tsx` uses `rehype-sanitize` with default-safe schema. CI step "Check no dangerouslySetInnerHTML in issue detail" enforces this at every push. `TruncationMarker.tsx` renders `data-truncated="true"` + `data-original-bytes` markers. Playwright test "truncation marker" passes. |
| SC-5 | Chat-on-issue flow: user types message → task enqueued with `trigger_comment_id` → response streams as task_messages → completes as a threaded agent comment | VERIFIED | `ChatComposer.tsx` submits `{ content, triggerCommentId }` to `POST /api/issues/:id/comments`. `daemon.ts` `/complete` route: `listTaskMessagesOfKind(db, taskId, 'text')` → `createAgentComment(parentId: trigger_comment_id)` → `broadcast(comment:posted)`. Zero `finalText` in daemon.ts. `useIssueDetail` appends agent comment on `comment:posted` event. Playwright test "chat on issue" passes (seeds daemon token, calls `/api/daemon/tasks/:id/complete`, asserts threaded agent reply). |

**Score:** 5/5 truths verified (SC-3 verified structurally; 60-FPS behavioral claim is manual-only)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/services/task-message-store.ts` | Truncation + replay helpers | VERIFIED | All 6 exports present: `TASK_MESSAGE_CONTENT_LIMIT_BYTES=16384`, `truncateForStorage`, `listMessagesAfterSeq`, `listRecentMessagesAfterSeq`, `listTaskMessagesOfKind`, `getFullMessage`. Zero `any` keywords. |
| `apps/server/src/db/migrations/010_task_message_overflow.ts` | overflow table keyed by (task_id, seq) | VERIFIED | `task_message_overflow` table with composite PK, ON DELETE CASCADE from `agent_task_queue`. |
| `apps/server/src/task-dispatch/task-message-batcher.ts` | Calls `truncateForStorage` before INSERT | VERIFIED | `broadcastTaskMessage` imported and called (2 grep hits). `truncateForStorage` used in flush path. |
| `apps/server/src/ws/index.ts` | `subscribe_task` + `pause_stream` + `resume_stream` with buffer-replay-live ordering | VERIFIED | All three handlers present. `listRecentMessagesAfterSeq` called (2 hits). `listMessagesAfterSeq` absent (0 hits — HARD invariant passes). `replay_truncated` sentinel emitted (2 hits). `broadcastTaskMessage` exported. |
| `apps/server/src/routes/tasks.ts` | GET messages + GET full + POST cancel | VERIFIED | All three routes present. Mounted at `/api/tasks` in `server-core.ts` line 180. |
| `apps/server/src/routes/issues.ts` | GET /:id/tasks | VERIFIED | `listTasksForIssue` called at line 85. |
| `apps/server/src/routes/daemon.ts` | POST /complete — uniform `listTaskMessagesOfKind` path, zero `finalText` | VERIFIED | `listTaskMessagesOfKind` called 3× in daemon.ts. `finalText` → 0 grep hits in daemon.ts. `createAgentComment` called with `parentId: trigger_comment_id`. |
| `apps/server/src/services/comment-store.ts` | `createAgentComment` exported | VERIFIED | Exported at line 197. |
| `apps/web/src/pages/IssueDetailPage.tsx` | Full detail page wiring | VERIFIED | Imports all Wave 1-5 components. Calls `useIssueDetail` + `useTaskStream`. ChatComposer submit handler calls `overrideLatestTask`. |
| `apps/web/src/components/issues/detail/` directory | 17 component files + hooks | VERIFIED | 17 files: CommentCard, CommentComposer, CommentThread, CommentsTimeline, IssueActionSidebar, IssueDescription, IssueHeader, markdown, TaskMessageList, TaskStateBadge, useIssueDetail, ReconnectBanner, TaskPanel, useTaskStream, TaskMessageItem, TruncationMarker, ChatComposer. |
| `apps/web/src/components/issues/detail/markdown.tsx` | SafeMarkdown with rehype-sanitize | VERIFIED | Uses `rehype-sanitize` with `defaultSchema` + className extensions for code highlighting. No raw innerHTML. |
| `apps/web/src/components/issues/detail/useTaskStream.ts` | `useTransition` + `useDeferredValue` + replay | VERIFIED | Both React 19 APIs imported and used. `resumeTaskStream(taskId, lastSeqRef.current)` on visibility resume (HARD invariant). |
| `apps/web/src/context/WebSocketContext.tsx` | `requestTaskReplay` / `pauseTaskStream` / `resumeTaskStream` trio | VERIFIED | All three methods present and wired. Pre-auth queue via `pendingTaskReplayRef`. `__aquariumForceWsClose` test hook gated to DEV/test builds. |
| `packages/shared/src/types.ts` | WsEventType extended with task:* and comment:* | VERIFIED | `task:message`, `task:dispatched`, `task:started`, `task:completed`, `task:failed`, `comment:posted`, `comment:updated`, `comment:deleted` all present. |
| `tests/e2e/issue-detail.spec.ts` | 8 test scenarios | VERIFIED | 8 total tests (7 active + 1 `test.skip('background tab recovery')`). All 8 names match VALIDATION.md verbatim. Wave 0 stubs wired by subsequent plans. |
| `apps/web/package.json` | `rehype-sanitize: ^6.0.0` in dependencies | VERIFIED | Line 45 of package.json. |
| `apps/server/tests/unit/task-message-truncation.test.ts` | Wave 0 truncation tests | VERIFIED | File exists. |
| `apps/server/tests/unit/task-messages-replay.test.ts` | Wave 0 replay tests | VERIFIED | File exists. |
| `apps/server/tests/unit/ws-subscribe-task.test.ts` | Wave 0 WS ordering tests | VERIFIED | File exists. |
| `apps/server/tests/unit/chat-threading.test.ts` | Wave 5 CHAT-01 tests | VERIFIED | File exists. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `task-message-batcher.ts` | `task-message-store.ts` | `import truncateForStorage` | VERIFIED | 2 grep hits in batcher (import + call). `broadcastTaskMessage` also imported from ws/index.ts and replaces former `broadcast` call. |
| `ws/index.ts` | `task-message-store.ts` | `listRecentMessagesAfterSeq(taskId, lastSeq, 500)` | VERIFIED | 2 grep hits. Confirmed NOT using `listMessagesAfterSeq` (0 hits in ws/index.ts — HARD invariant). |
| `routes/tasks.ts` | `task-message-store.ts` | `listMessagesAfterSeq` for REST replay | VERIFIED | Imported and called in GET `/:id/messages`. |
| `server-core.ts` | `routes/tasks.ts` | `app.use('/api/tasks', tasksRouter)` | VERIFIED | Line 180 of server-core.ts. |
| `useTaskStream.ts` | `WebSocketContext.tsx` | `requestTaskReplay` / `pauseTaskStream` / `resumeTaskStream` | VERIFIED | All three destructured and used. `resumeTaskStream(taskId, lastSeqRef.current)` — HARD invariant (not `0`). |
| `IssueDetailPage.tsx` | `useTaskStream.ts` | `const stream = useTaskStream({ taskId: latestTask?.id ?? null })` | VERIFIED | Single hook instance at page level. `stream` passed to `TaskPanel` + `ReconnectBanner`. |
| `ChatComposer.tsx` | `POST /issues/:id/comments` | `api.post` with `triggerCommentId` | VERIFIED | `triggerCommentId: lastUserCommentId ?? issue.id` passed in body. `overrideLatestTask` called with `enqueuedTask`. |
| `daemon.ts /complete` | `comment-store.ts` | `listTaskMessagesOfKind` → `createAgentComment(parentId: trigger_comment_id)` | VERIFIED | 3 grep hits for `listTaskMessagesOfKind` in daemon.ts. `broadcast(comment:posted)` fires post-commit. |
| `TruncationMarker.tsx` | `GET /tasks/:id/messages/:seq/full` | `api.get('/tasks/' + taskId + '/messages/' + seq + '/full')` | VERIFIED | Passes full TaskMessage to `onLoad` prop; body re-renders through SafeMarkdown path. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `TaskPanel.tsx` | `stream.renderedMessages` | `useTaskStream` → REST `GET /tasks/:id/messages` + WS `task:message` | Yes — DB query in `listMessagesAfterSeq`; live events from batcher | FLOWING |
| `CommentsTimeline.tsx` | `comments` (forest via `buildForest`) | `useIssueDetail` → `GET /issues/:id/comments` + `comment:posted` WS | Yes — DB query in issue route; real inserts via `createAgentComment` | FLOWING |
| `TruncationMarker.tsx` | `full` (TaskMessage on "Show full") | `GET /api/tasks/:id/messages/:seq/full` → `getFullMessage` → overflow table merge | Yes — `getFullMessage` reads `task_message_overflow` then merges into TaskMessage | FLOWING |
| `ChatComposer.tsx` | `content` (user-typed) | textarea state, submitted via `POST /issues/:id/comments` | User input — no stub; server enqueues task and returns `{ comment, enqueuedTask }` | FLOWING |

---

### Behavioral Spot-Checks

Step 7b is SKIPPED for the Playwright E2E scenarios because they require a running server + Vite dev build. Server is not started during this static verification pass. The verification notes confirm all 7 active Playwright tests passed in the wave execution runs. The three server unit suites (truncation, replay, ws-subscribe) and the Wave 5 chat-threading suite are confirmed green per the verification notes.

| Behavior | Evidence | Status |
|----------|----------|--------|
| `TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384` exported | grep count=1 in task-message-store.ts | PASS |
| `listRecentMessagesAfterSeq` used in ws/index.ts (not `listMessagesAfterSeq`) | grep count=2 / 0 | PASS |
| `replay_truncated` sentinel emitted when `olderOmittedCount > 0` | grep count=2 in ws/index.ts | PASS |
| `broadcastTaskMessage` exported and used by batcher | grep count=3 in batcher | PASS |
| Zero `finalText` in daemon.ts | grep count=0 | PASS |
| Zero `dangerouslySetInnerHTML` in detail components | grep count=0 | PASS |
| `rehype-sanitize` in apps/web dependencies | line 45 package.json | PASS |
| `resumeTaskStream(taskId, lastSeqRef.current)` — not `0` | grep match on exact call | PASS |
| `test.skip('background tab recovery')` preserved | grep count=1 test.skip | PASS |
| 8 test cases total (7 active + 1 skip) | grep count=8 test( or test.skip | PASS |
| 6-locale i18n keys non-null | node eval across en/zh/fr/de/es/it | PASS (translated, not placeholders) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UI-04 | 24-01-PLAN.md | Issue Detail page: title, description, comments timeline, active task progress, action sidebar | SATISFIED | `IssueDetailPage.tsx` + all 5 sub-components. Playwright "issue detail renders" + "threaded comments" pass. |
| UI-05 | 24-00-PLAN.md, 24-02-PLAN.md | Task message stream: live tool_use/tool_result/text/thinking from WS `subscribe_task` | SATISFIED | `useTaskStream` boots REST seed then WS subscribe. `TaskMessageItem` dispatches all 4 kinds through SafeMarkdown / pre. Playwright "task stream live" passes. |
| UI-06 | 24-00-PLAN.md, 24-03-PLAN.md | WS reconnect replays `task_messages` from `lastSeq` — no gaps | SATISFIED | Wave 0 WS handler (buffer-replay-live ordering). `useTaskStream` reconnect effect. Playwright "reconnect replay" + "replay no reorder" pass. |
| UI-07 | 24-04-PLAN.md | No `dangerouslySetInnerHTML`; 16 KB server-side truncation with explicit marker | SATISFIED | grep=0 dangerouslySetInnerHTML. 16 KB constant + batcher truncation. `TruncationMarker` renders `data-truncated`. CI guard step. Playwright "truncation marker" passes. |
| UI-08 | 24-00-PLAN.md, 24-06-PLAN.md | All new UI strings translated across 6 locales; i18n parity enforced in CI | SATISFIED | `issues.detail.*` + `chat.*` keys present in all 6 locales with real translations (not en-fallback placeholders). `check-i18n-parity.mjs` exits 0 (2053 keys × 6 locales per verification notes). |
| CHAT-01 | 24-05-PLAN.md | User can chat with agent on issue; each message creates a task, response streams back, chat history threads via `trigger_comment_id` | SATISFIED | `ChatComposer` → `POST /issues/:id/comments` with `triggerCommentId`. Daemon `/complete` → `listTaskMessagesOfKind` → `createAgentComment(parentId: trigger_comment_id)`. Playwright "chat on issue" passes. |

**All 6 requirement IDs satisfied.** No orphaned requirements found for phase 24 in REQUIREMENTS.md.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/src/components/issues/detail/TruncationMarker.tsx` | — | `'chat.composer.noAssignee'` used in ChatComposer.tsx but not in TruncationMarker | Info | No impact — found in ChatComposer which is correct. |
| (None) | — | Zero `dangerouslySetInnerHTML` in entire detail tree | — | Hard invariant holds. |
| (None) | — | Zero `return null` / `return []` / `return {}` stubs in rendering paths | — | All component cases are implemented. `default:` exhaustive-match in TaskMessageItem returns `null` only on unreachable never branch. |

No blockers or warnings found. The `return null` in TaskMessageItem's `default:` branch is an exhaustive-match guard on a `never` type — not a stub.

---

### Human Verification Required

#### 1. Background-Tab 60-FPS Recovery (SC-3 Manual)

**Test:** Open the issue detail page for an issue whose agent task is actively producing 500+ messages at high frequency. Switch to a different Chrome tab and wait at least 60 seconds. Return to the issue detail tab.
**Expected:** The UI catches up completely (all accumulated messages render without gap). Chrome DevTools Performance tab (recorded during the catch-up) shows no blocking main-thread task of 500 ms or longer. The `useTransition` + `useDeferredValue` setup in `useTaskStream.ts` should keep frames at >= 60 FPS.
**Why human:** Chrome tab-throttle and BFcache behaviour are not reliably reproducible in headless Playwright. Documented as manual-only in `24-VALIDATION.md §Manual-Only Verifications`.

#### 2. XSS Adversarial Input Audit (UX6)

**Test:** In a test environment, directly insert a `task_messages` row with `content` containing each of: `<script>alert('xss')</script>`, `<iframe src="javascript:void(0)">`, and `<img src=x onerror=alert(1)>`. Navigate to the issue detail page that shows these messages. Open Chrome DevTools console.
**Expected:** No alert dialogs appear. No iframe loads. Console shows no XSS-related errors. DevTools Elements panel shows the raw strings as text nodes, not executed HTML — confirming `rehype-sanitize` stripped the dangerous elements/attributes.
**Why human:** Automated grep confirms zero `dangerouslySetInnerHTML` and `rehype-sanitize` is wired correctly; actual non-execution of injected HTML can only be confirmed by observing live browser behavior with adversarial inputs.

#### 3. Native-Speaker Linguistic Quality Review (UX5 / UI-08)

**Test:** In the running web app, switch the browser/app language to each of: `zh`, `fr`, `de`, `es`, `it`. Navigate to an issue detail page (showing comments, task panel, chat composer). Read the strings in `issues.detail.*` (back button, comments header, task header, action labels, reconnect banner) and `chat.*` (composer placeholder, send button, no-assignee warning, char counter).
**Expected:** Strings read naturally in each language with correct gender agreement, formality register, and domain-appropriate vocabulary (especially `zh` for "agent/task" terminology). No strings appear as English fallbacks.
**Why human:** `check-i18n-parity.mjs` only confirms key presence and non-null values. Actual locale strings are real translations per automated check (not en-fallbacks), but linguistic quality requires native-speaker judgment. The i18n parity script exit-0 with 2053 keys × 6 locales is confirmed.

---

### Gaps Summary

No gaps. All 5 success criteria and all 6 requirement IDs are satisfied by the implemented code. Three items require human verification (listed above) but none represent implementation gaps — the code paths for SC-3, UX6, and UX5 are all correctly implemented.

---

_Verified: 2026-04-17_
_Verifier: Claude (gsd-verifier)_
