---
phase: 24-issue-detail-ui-task-message-streaming
plan: 00
subsystem: api
tags: [websocket, streaming, sqlite, truncation, xss, react, i18n, replay, ordering]

# Dependency graph
requires:
  - phase: 18-task-queue-dispatch
    provides: task_messages table, batcher with monotonic seq, UNIQUE(task_id, seq), cancelTask + task:cancelled broadcast
  - phase: 23-issue-board-ui-kanban
    provides: WsEventType additive extension pattern, check-i18n-parity.mjs, @tanstack/react-virtual, sonner z-index, rehype-highlight, react-markdown, remark-gfm
  - phase: 17-agent-issue-comment-services
    provides: createUserComment returning { comment, enqueuedTask }, parent_id threading, triggerCommentId semantics
provides:
  - 16 KB task_message truncation on INSERT path + task_message_overflow table keyed by (task_id, seq)
  - REST replay endpoint GET /api/tasks/:id/messages?afterSeq=N (ASC paginated, 500-row cap + hasMore)
  - REST "Show full" endpoint GET /api/tasks/:id/messages/:seq/full (overflow-first, 1 MB hard cap, 413 on overflow)
  - WS subscribe_task / pause_stream / resume_stream inbound handlers with 6-step buffer-replay-live ordering invariant
  - WS replay_truncated sentinel event fires BEFORE the capped 500 rows when older entries were omitted
  - listTaskMessagesOfKind(taskId, kind) helper for Wave 5 hosted + daemon completion routes
  - broadcastTaskMessage(workspaceId, taskId, message) helper honouring per-client pause + replay buffer state
  - WsEventType extended additively with task:message, task:dispatched, task:started, task:completed, task:failed
  - rehype-sanitize@^6.0.0 installed in apps/web for UX6 XSS mitigation
  - apps/web/src/components/issues/detail/ scaffold directory for Wave 1-5 components
  - tests/e2e/issue-detail.spec.ts scaffold with 8 verbatim test.skip titles matching VALIDATION map
  - issues.detail.* + chat.composer.* i18n keys authored in en, mirrored to 5 locales as en-placeholders
affects: [24-01, 24-02, 24-03, 24-04, 24-05, 24-06]

# Tech tracking
tech-stack:
  added: [rehype-sanitize@^6.0.0]
  patterns:
    - "Byte-bounded truncation at the INSERT path; original preserved in a sibling overflow table keyed on (task_id, seq) with FK CASCADE"
    - "WS subscribe_task replay-live ordering: install buffer synchronously → await DB rows → emit replay_truncated sentinel → flush replay rows → drain buffer → switch to live-only"
    - "REST ASC replay + WS DESC-LIMIT-500 replay: two distinct helpers (listMessagesAfterSeq vs listRecentMessagesAfterSeq) enforce distinct pagination/capping semantics per surface"
    - "WsEventType additive extension (same pattern as Phase 23 for issue:*): existing clients continue to ignore new literals"
    - "i18n parity gated via scripts/check-i18n-parity.mjs; new locales added as en-placeholders until Phase 24-06 ships native translations"

key-files:
  created:
    - apps/server/src/services/task-message-store.ts
    - apps/server/src/db/migrations/010_task_message_overflow.ts
    - apps/server/src/routes/tasks.ts
    - apps/server/tests/unit/task-message-truncation.test.ts
    - apps/server/tests/unit/task-messages-replay.test.ts
    - apps/server/tests/unit/ws-subscribe-task.test.ts
    - apps/web/src/components/issues/detail/.gitkeep
    - tests/e2e/issue-detail.spec.ts
    - .planning/phases/24-issue-detail-ui-task-message-streaming/24-00-SUMMARY.md
  modified:
    - apps/server/src/task-dispatch/task-message-batcher.ts
    - apps/server/src/ws/index.ts
    - apps/server/src/server-core.ts
    - packages/shared/src/types.ts
    - apps/web/package.json
    - apps/web/src/i18n/locales/en.json
    - apps/web/src/i18n/locales/zh.json
    - apps/web/src/i18n/locales/fr.json
    - apps/web/src/i18n/locales/de.json
    - apps/web/src/i18n/locales/es.json
    - apps/web/src/i18n/locales/it.json
    - package-lock.json

key-decisions:
  - "Replaced `broadcast(workspaceId, ...)` with `broadcastTaskMessage(workspaceId, taskId, ...)` in the batcher (option (b) per UI-SPEC §ST2): only clients that sent subscribe_task receive per-message events. Backwards-compat verified — no apps/web consumer references task:message."
  - "Single-transaction overflow write in flushOne: task_messages INSERT + task_message_overflow INSERT both inside the existing withImmediateTx so a truncated row never exists without its overflow blob (SQ5 safety)."
  - "REPLAY_ROW_CAP = 500 shared between REST (hasMore signal) and WS (listRecentMessagesAfterSeq limit). Keeps the client story uniform: any single fetch returns at most 500 rows."
  - "Multi-byte UTF-8 truncation walks back to the last start-of-codepoint byte using the UTF-8 continuation-byte mask (0b1100_0000 / 0b1000_0000). Prevents Buffer.toString('utf8') from emitting a replacement character at the tail."
  - "getFullMessage merges overflow fields selectively (content / input_json / output are independently nullable) so partial overflow rows round-trip correctly when only one field exceeded the limit."
  - "lazy `await import('../services/task-message-store.js')` inside the subscribe_task handler avoids a circular-import between ws/index.ts and the store."

patterns-established:
  - "Per-task WS subscription state: WsClient.taskSubscriptions: Map<taskId, {lastSeq, paused, replayBuffer: unknown[] | null}>. replayBuffer !== null signals 'buffer live broadcasts'; null means 'live-only'."
  - "Spoofing guard for inbound WS numeric fields: Math.max(0, Math.floor(msg.lastSeq)) coerces negative / NaN / fractional values."
  - "Per-plan Playwright spec scaffolding: 8 test.skip stubs with verbatim VALIDATION titles + cloned API/DB helpers from the prior phase's spec (Phase 23 pattern)."

requirements-completed: [UI-05, UI-06, UI-07, UI-08]

# Metrics
duration: ~45 min
completed: 2026-04-17
---

# Phase 24 Plan 00: Issue Detail Wave 0 Server Foundation + Scaffolds Summary

**Server-side 16 KB task_message truncation with overflow preservation, WS subscribe_task replay/pause/resume handlers enforcing strict buffer-replay-live ordering (capped 500 rows + replay_truncated sentinel), REST /api/tasks/:id/messages and /full + /cancel routes, plus web scaffolds (rehype-sanitize, component directory, 8-scenario Playwright spec, ~70 i18n keys across 6 locales)**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-17 (session)
- **Completed:** 2026-04-17
- **Tasks:** 3
- **Files modified:** 18 (9 created, 9 modified)

## Accomplishments

- 16 KB UX6 truncation landed at the batcher INSERT path with a UTF-8-safe byte slicer; originals preserved in `task_message_overflow(task_id, seq PK, FK CASCADE on agent_task_queue)` via migration 010.
- WS `subscribe_task` handler implements the strict 6-step ST2 ordering invariant (install buffer synchronously → DB query → replay_truncated sentinel → flush replay rows → drain buffer → switch to live-only). Test 1 seeds 10 rows + 3 concurrent live broadcasts and asserts strict seq-ASC delivery of all 13 frames. Test 3 seeds 600 rows and asserts the sentinel fires BEFORE the most-recent 500 rows (seq 101..600) with `olderOmittedCount = 100`.
- REST replay endpoint returns `{ messages, hasMore }` with a 500-row cap per call; separate `/full` endpoint merges overflow onto the truncated row with a 1 MB absolute cap (413 on overflow).
- `listTaskMessagesOfKind(taskId, kind)` shipped so Wave 5 hosted + daemon completion routes can reconstruct agent final text from the DB without depending on in-memory batcher state.
- 13 unit tests green (5 truncation + 5 replay + 3 WS); existing 5 batcher tests still green (no regression).
- `rehype-sanitize@^6.0.0` installed; `apps/web/src/components/issues/detail/` scaffold created; Playwright spec `tests/e2e/issue-detail.spec.ts` seeded with 8 verbatim `test.skip` titles; `issues.detail.*` (~70 keys) + `chat.composer.*` (~8 keys) authored in en with en-placeholder mirrors in zh/fr/de/es/it.
- i18n parity script exits 0 (2049 keys × 6 locales); server typecheck green; `npm run build:ce -w @aquarium/web` green.

## Task Commits

1. **Task 1 RED** — `1e2218e` (test): failing truncation + replay tests referencing task-message-store symbols that don't yet exist.
2. **Task 1 GREEN** — `bd71cd6` (feat): task-message-store + truncateForStorage + 4 replay helpers + migration 010 + batcher truncation hook + /api/tasks router + server-core mount.
3. **Task 2 RED** — `beb77b6` (test): failing WS ordering + pause + DESC-500 sentinel tests referencing `broadcastTaskMessage` export.
4. **Task 2 GREEN** — `32fb5ea` (feat): WsClient.taskSubscriptions map + subscribe_task / pause_stream / resume_stream handlers + broadcastTaskMessage + WsEventType extension + batcher broadcast swap.
5. **Task 3** — `bdfbb6f` (feat): rehype-sanitize install + scaffold dir + Playwright spec + 6 locale updates.

## Files Created/Modified

### Created
- `apps/server/src/services/task-message-store.ts` — `TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384`, `REPLAY_ROW_CAP = 500`, `FULL_MESSAGE_ABSOLUTE_CAP_BYTES = 1 MB`, `truncateForStorage` (UTF-8-safe), `listMessagesAfterSeq` (ASC paginated REST), `listRecentMessagesAfterSeq` (DESC-LIMIT-500 WS), `listTaskMessagesOfKind` (completion-path helper), `getFullMessage` (overflow-first uncapped lookup).
- `apps/server/src/db/migrations/010_task_message_overflow.ts` — `task_message_overflow(task_id, seq PK; content / input_json / output nullable TEXT; original_bytes; FK CASCADE on agent_task_queue)`.
- `apps/server/src/routes/tasks.ts` — `GET /:id/messages?afterSeq=N`, `GET /:id/messages/:seq/full`, `POST /:id/cancel` (requireAuth).
- `apps/server/tests/unit/task-message-truncation.test.ts` — 5 tests (LIMIT constant, 20 KB→truncated+overflow, 10 KB→verbatim, tool_use 20 KB JSON, multi-byte UTF-8 boundary).
- `apps/server/tests/unit/task-messages-replay.test.ts` — 5 tests (ASC paginated, hasMore@cap, overflow-first full, DESC-500 + olderOmittedCount, kind-filter incl. empty).
- `apps/server/tests/unit/ws-subscribe-task.test.ts` — 3 tests (replay-live ordering 13 frames, pause+resume gap replay, 500-DESC cap + sentinel + REST ASC independence).
- `apps/web/src/components/issues/detail/.gitkeep` — Wave 1-5 scaffold marker.
- `tests/e2e/issue-detail.spec.ts` — 8 verbatim `test.skip` stubs + cloned helpers.

### Modified
- `apps/server/src/task-dispatch/task-message-batcher.ts` — `flushOne` calls `truncateForStorage` before bulk INSERT; overflow rows written in the same `withImmediateTx`; broadcast swapped from `broadcast(...)` to `broadcastTaskMessage(...)`.
- `apps/server/src/ws/index.ts` — `WsClient.taskSubscriptions: Map` added; inbound handlers for `subscribe_task` / `pause_stream` / `resume_stream`; `broadcastTaskMessage` export honours pause + replay buffer state.
- `apps/server/src/server-core.ts` — mounted `/api/tasks` router after `/api/comments`.
- `packages/shared/src/types.ts` — `WsEventType` additively extended with `task:message`, `task:dispatched`, `task:started`, `task:completed`, `task:failed`.
- `apps/web/package.json` — `rehype-sanitize@^6.0.0` under `dependencies`.
- `apps/web/src/i18n/locales/en.json` — new `issues.detail.*` subtree (~70 keys) + `chat.composer` subtree (~8 keys) merged into the existing `chat` namespace (avoiding duplicate top-level keys).
- `apps/web/src/i18n/locales/{zh,fr,de,es,it}.json` — same key structure mirrored with en placeholders; plan 24-06 will ship native translations.

## Decisions Made

Covered in detail in the frontmatter `key-decisions` list. Principal choices:

1. **Option (b) for broadcast routing** — `broadcastTaskMessage` only reaches clients that sent `subscribe_task`. Workspace subscribers who never sent subscribe_task get no `task:message` events (verified safe: `grep -rn 'task:message' apps/web/` returns zero matches).
2. **Single-transaction overflow** — truncated row + overflow blob write inside one `withImmediateTx` to preserve the table-pair invariant under crash.
3. **UTF-8 byte slicer** — walks the continuation-byte mask backwards so truncation never emits a replacement character; tested with a U+3042 (3-byte) boundary case.
4. **lazy imports inside subscribe_task** — `await import('../services/task-message-store.js')` + `await import('../db/index.js')` inside the handler avoids a circular import between ws/index.ts and the store.
5. **i18n: fix duplicate `chat` key** — initial edit had produced a duplicate top-level `"chat": {...}` in `en.json` (silent JSON overwrite); merged `composer` into the existing chat block to keep parity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Timing shim for early-flush soft-cap race in replay tests**
- **Found during:** Task 1 GREEN (first replay test run showed only 500/600 rows in DB).
- **Issue:** Appending > `BUFFER_SOFT_CAP` (500) rows triggers a fire-and-forget early flush. My first-pass tests called `flushTaskMessages(taskId)` immediately after, but re-entrance guard returned early while the fire-and-forget flush was still draining the buffer — residual rows never flushed.
- **Fix:** Added `await new Promise((r) => setTimeout(r, 50))` before the residual `flushTaskMessages(taskId)` to let the early flush settle (mirrors the existing pattern in `task-message-batcher.test.ts`'s "overflow early flush" test).
- **Files modified:** `apps/server/tests/unit/task-messages-replay.test.ts`.
- **Verification:** All 5 replay tests pass.
- **Committed in:** `bd71cd6` (Task 1 GREEN commit).

**2. [Rule 3 - Blocking] Test-timing for WS buffer-replay-live ordering invariant**
- **Found during:** Task 2 GREEN (initial test hung — only 10 replay rows arrived, no live).
- **Issue:** My first-pass test fired `broadcastTaskMessage(...)` SYNCHRONOUSLY after `ws.send('subscribe_task')`. Since WS frames are async, the server hadn't yet installed `taskSubscriptions.get(taskId).replayBuffer = []` when the live broadcasts fired → they were dropped rather than buffered.
- **Fix:** `await sendJson(subscribe_task)` + `await setTimeout(5ms)` to let the server consume the frame and run step 1 (buffer install), then fire the 3 live broadcasts. The handler's subsequent `await import(...)` + `await listRecentMessagesAfterSeq(...)` forms the buffering window during which the test's live broadcasts land in the buffer. Final drain happens in handler step 5.
- **Files modified:** `apps/server/tests/unit/ws-subscribe-task.test.ts`.
- **Verification:** All 3 WS tests pass; ordering invariant confirmed (13 frames in strict ASC order: 10 replay + 3 buffered-then-drained live).
- **Committed in:** `32fb5ea` (Task 2 GREEN commit).

**3. [Rule 1 - Bug] Duplicate top-level `chat` key in en.json**
- **Found during:** Task 3 (i18n parity script initially reported 68 gaps).
- **Issue:** First-pass Edit to `en.json` appended a second `"chat": { "composer": {...} }` block at the document tail. JSON.parse silently kept only the last duplicate, dropping all existing `chat.*` keys used across 5 locales → every locale lost parity.
- **Fix:** Removed the duplicate block and merged the `composer` subtree into the existing `chat` namespace at its natural location (after `scrollToBottom`). Re-ran mirror script to propagate only the `composer` subtree (not replace the whole chat block) to the other 5 locales.
- **Files modified:** `apps/web/src/i18n/locales/{en,zh,fr,de,es,it}.json`.
- **Verification:** `node apps/web/scripts/check-i18n-parity.mjs` → `OK: 2049 keys checked across 6 locales`.
- **Committed in:** `bdfbb6f` (Task 3 commit).

---

**Total deviations:** 3 auto-fixed (2 blocking test-timing issues + 1 bug).
**Impact on plan:** All three are test/data-plumbing fixes — not scope creep. Test-timing fixes preserve the behaviour-under-test unchanged; the duplicate-key fix only relocates an already-authored namespace to the canonical place in the JSON tree.

## Issues Encountered

None that required problem-solving beyond the deviations above. The hardcoded invariants (migration 010, LIMIT=16_384, REPLAY_ROW_CAP=500, `listRecentMessagesAfterSeq` for WS and `listMessagesAfterSeq` for REST) held end-to-end — grep-level invariants all pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 0 done. Waves 1-5 can merge trivially:
- Component scaffold dir exists at `apps/web/src/components/issues/detail/` — Waves 1-5 only ADD files.
- Playwright spec exists at `tests/e2e/issue-detail.spec.ts` — each downstream plan flips `test.skip` → `test` for its verbatim-named scenario.
- i18n keys shipped in all 6 locales — UI code can reference them today; Plan 24-06 replaces zh/fr/de/es/it placeholder strings with native-quality translations.
- `WsEventType` extension propagated — Wave 1's `addHandler('task:message', ...)` typechecks without retrofit.
- `listTaskMessagesOfKind` available for Wave 5 completion callbacks.
- Server-side surfaces (`/api/tasks/:id/messages`, `/:seq/full`, `/:id/cancel`, WS `subscribe_task` / `pause_stream` / `resume_stream`) are all live and test-covered.

No blockers. Wave 0 carries zero known defects into Wave 1.

## Self-Check: PASSED

**File existence:**
- FOUND: `apps/server/src/services/task-message-store.ts`
- FOUND: `apps/server/src/db/migrations/010_task_message_overflow.ts`
- FOUND: `apps/server/src/routes/tasks.ts`
- FOUND: `apps/server/tests/unit/task-message-truncation.test.ts`
- FOUND: `apps/server/tests/unit/task-messages-replay.test.ts`
- FOUND: `apps/server/tests/unit/ws-subscribe-task.test.ts`
- FOUND: `apps/web/src/components/issues/detail/.gitkeep`
- FOUND: `tests/e2e/issue-detail.spec.ts`

**Commits:**
- FOUND: `1e2218e` (Task 1 RED)
- FOUND: `bd71cd6` (Task 1 GREEN)
- FOUND: `beb77b6` (Task 2 RED)
- FOUND: `32fb5ea` (Task 2 GREEN)
- FOUND: `bdfbb6f` (Task 3)

**Acceptance checks (all grep invariants):**
- `TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384`: 1 match in task-message-store.ts
- All 5 `export async function` replay/kind/full symbols present: 5/5
- Migration 010 exists; no 036 migration on disk
- `/api/tasks` mounted in server-core: 1
- Router endpoints `/:id/messages` (2 occurrences) + `/:id/cancel` (2): present
- WS handlers `subscribe_task` (6), `pause_stream` (3), `resume_stream` (3): present
- `listRecentMessagesAfterSeq` in ws/index.ts: 2 (import + call); `listMessagesAfterSeq\b` in ws/index.ts: 0 (HARD invariant)
- `replay_truncated` sentinel emitted in ws/index.ts: 2
- `export function broadcastTaskMessage` in ws/index.ts: 1
- `broadcastTaskMessage` used in task-message-batcher.ts: 3
- WsEventType extended with `task:message` / `task:dispatched` / `task:started` / `task:completed` / `task:failed`: 1 each
- `rehype-sanitize` in apps/web/package.json: 1 (dependencies)
- `test.skip(` count in tests/e2e/issue-detail.spec.ts: 8 (all 8 verbatim titles present)
- Zero `dangerouslySetInnerHTML` under apps/web/src/components/issues/detail/: 0 (directory contains only .gitkeep)

**Test / build sweep:**
- 13/13 Phase 24-00 unit tests pass (`task-message-truncation.test.ts` + `task-messages-replay.test.ts` + `ws-subscribe-task.test.ts`).
- 5/5 Phase 18-02 `task-message-batcher.test.ts` still green (no regression).
- `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium` exits 0.
- `npm run build:ce -w @aquarium/web` exits 0 (rehype-sanitize resolves).
- `node apps/web/scripts/check-i18n-parity.mjs` exits 0 (2049 keys × 6 locales).

---
*Phase: 24-issue-detail-ui-task-message-streaming*
*Completed: 2026-04-17*
