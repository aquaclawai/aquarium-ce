---
phase: 24
slug: issue-detail-ui-task-message-streaming
status: draft
shadcn_initialized: true
preset: aquarium-warm-claude (pre-existing, defined in apps/web/src/index.css — inherited from Phase 23)
created: 2026-04-17
---

# Phase 24 — UI Design Contract: Issue Detail + Task Message Streaming

> Visual and interaction contract for the issue detail page, threaded comments timeline, live task panel, task message stream, truncation + XSS hardening, and chat-on-issue composer.
>
> Research gate: SKIP (per ROADMAP). Scope is unambiguous — 5 SCs + 6 REQ IDs (UI-04..UI-08 + CHAT-01) + 3 owned pitfalls (ST2, ST3, UX6) with concrete prevention patterns. Produced in `--auto` mode; no interactive questions.
>
> **Reuses Phase 23's design system verbatim.** Do NOT introduce new color tokens, new fonts, or new spacing scales. Extends copywriting namespaces, component inventory, and WsEventType only. All Phase 24–owned pitfalls have explicit mitigations embedded inline.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui (already initialized; primitives at `apps/web/src/components/ui/*`) |
| Preset | Project-native `aquarium-warm-claude` — defined in `apps/web/src/index.css`, inherited from Phase 23 |
| Component library | `@radix-ui` primitives wrapped by `apps/web/src/components/ui/*` (button, card, badge, dialog, dropdown-menu, scroll-area, separator, tooltip, sheet, sidebar, skeleton, sonner, tabs, input, popover, table, select). **Reuse verbatim. Do NOT hand-roll.** |
| Icon library | `lucide-react@^0.577.0` (already installed) |
| Font | Same as Phase 23 — serif headings (`--font-serif`), system-ui body (`--font-sans`), JetBrains Mono (`--font-mono`) for tool JSON pre-blocks. CJK override (`:lang(zh)`) already in `index.css:574-580`. |
| Markdown renderer | `react-markdown@^10.1.0` (already installed) + `rehype-sanitize` (ADD in Wave 0 — see Registry Safety) + `remark-gfm@^4.0.1` (already installed) + `rehype-highlight@^7.0.2` (already installed) |
| Virtualization | `@tanstack/react-virtual@^3.13.24` (already installed — reuse from Phase 23; DO NOT add react-virtuoso) |

**Existing primitives to reuse (located at `apps/web/src/components/ui/`):**
- `card.tsx` — IssueHeader surface, comment surface, task message row container, task panel card
- `badge.tsx` — status + priority + task-state badges (variants: default, secondary, destructive, outline)
- `button.tsx` — CTAs (back button, assign agent, cancel task, send chat, show full)
- `scroll-area.tsx` — comments timeline, task message list (outside virtualizer)
- `separator.tsx` — between timeline sections (description → comments → tasks)
- `skeleton.tsx` — initial page load, per-section loading
- `sonner.tsx` — toasts on send failure, cancel failure, reconnect banner (reuse existing Toaster)
- `tooltip.tsx` — hover hints on status icons, cancel button confirmation hint, truncation marker
- `input.tsx` + plain `<textarea>` (shadcn does not ship a textarea primitive in this repo; use `<textarea className="..." />` styled via Tailwind) — ChatComposer
- `dropdown-menu.tsx` — action sidebar menus (assign, change status)
- `dialog.tsx` — destructive confirm (cancel task, delete issue)

**Web workspace deps confirmed present (from `apps/web/package.json` 2026-04-17):**
- react 19.2.0, react-dom 19.2.0 → `useTransition` + `useDeferredValue` available
- react-i18next 16.5.8, i18next 25.8.18 — 6 locales already wired
- `@tanstack/react-virtual` 3.13.24, `sonner` 2.0.7, `react-markdown` 10.1.0, `remark-gfm` 4.0.1, `rehype-highlight` 7.0.2
- `rehype-sanitize` — NOT YET installed; Wave 0 must `npm install rehype-sanitize` (current version ^6.0.0)

---

## Spacing Scale

Same 4-point grid as Phase 23. Tailwind v4 defaults + `--space-*` CSS vars in `index.css`.

**Detail page layout values:**

| Element | Value | Rationale |
|---------|-------|-----------|
| Page root padding | `p-6` (24 top/left/right) / `pb-8` (32 bottom) | Matches `IssuesBoardPage`; extra bottom room for ChatComposer sticky zone |
| Page max-width | `max-w-[1200px] mx-auto` | Optimal reading width for issue prose + task stream; keeps sidebar ≤ 320px from main content |
| Main/sidebar split gap | `gap-6` (24) | Two-column grid on ≥1024px |
| Section vertical rhythm (header → description → comments → tasks → composer) | `space-y-6` (24) | Consistent with existing pages (`InstancePage`, `ChatHubPage`) |
| Header internal gap | `gap-3` (12) between title row, metadata row, action row |
| Header metadata row inline gap | `gap-2` (8) badge/icon spacing |
| Comment card padding | `p-3` (12) |
| Comment thread indent per level | `pl-6` (24 — one multiple of 4, visible but not wasteful); max 3 visible levels |
| Inter-comment gap (within thread) | `gap-3` (12) |
| Inter-thread gap (top-level comments) | `gap-4` (16) |
| Task panel card padding | `p-4` (16) |
| Task message row padding | `px-3 py-2` (12/8) — compact; dense log-like feel |
| Task message vertical gap | `gap-1` (4) — tight list rhythm |
| Task message left-gutter icon width | `w-6` (24) — aligns icon column across kinds |
| Composer padding | `p-3` (12) inside a bordered card; sticky bottom `mt-6` from task panel |
| Composer textarea min-height | `min-h-[80px]` (20-row-height multiple of 4) |
| Sidebar card padding | `p-4` (16) |
| Sidebar item vertical gap | `gap-2` (8) |

**Exceptions:** None. All values land on the 4-point grid.

---

## Typography

Inherits Phase 23's type scale. Adds no new sizes; reuses 11/12/14 + 20 (new — for detail H2 section headers that Phase 23 did not need). Keeps the 4-size discipline.

| Role | Size | Weight | Line Height | Utility | Applied To |
|------|------|--------|-------------|---------|------------|
| Display (issue title) | 28px / 1.75rem | 500 | 1.10 | `h1` via `index.css` rule | `<h1>` in `IssueHeader` — issue title with `#{issueNumber}` prefix |
| H2 (section headers) | 20px / 1.25rem | 600 | 1.20 | `text-xl font-semibold` | "Comments", "Active task", "Task history" — **new size used here, stays within 4-size cap** |
| Heading (comment author, sidebar label) | 14px | 600 | 1.20 | `text-sm font-semibold` | Author line, sidebar labels |
| Body (comment content, task message text) | 14px | 400 | 1.50 | `text-sm leading-relaxed` | Comment body, `text` kind task message, description prose |
| Body-small (metadata, timestamps, assignee line) | 12px | 400 | 1.40 | `text-xs text-muted-foreground` | "posted 2h ago · by @user", "seq 42 · tool_use: Read" |
| Label (status/priority/task-state badge) | 11px | 500 | 1.0 | `text-[11px] font-medium uppercase tracking-wide` | Badges; existing shadcn Badge handles sizing |
| Mono (tool_use args, tool_result JSON, markdown code blocks) | 12px | 400 | 1.50 | `text-xs font-mono leading-relaxed` | `<pre>` blocks, code fences in markdown |

**Font sizes used across Phases 23 + 24:** 11, 12, 14, 20, 28 — **5 distinct sizes** (Phase 23 used 4; Phase 24 adds 20 for H2 section headers). Still disciplined; H2 is semantically needed on the detail page and unused on the kanban.

**Font weights:** 400 (body + mono), 500 (display + labels), 600 (headings) — 3 weights, same as Phase 23.

**Hard rules:**
- NEVER render task_message content or comment content with `dangerouslySetInnerHTML`. React auto-escaping only for plain text; `react-markdown` + `rehype-sanitize` for markdown kinds.
- `thinking` kind renders in italic (`italic`) via a wrapper className — inherits `text-sm leading-relaxed` size/weight.
- `tool_use.input` JSON: `<pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto">` with `JSON.stringify(input, null, 2)` as text child — auto-escaped.
- `tool_result.content`: render inside `<pre>` by default (truncated to 2 KB visual preview + "Show full" affordance); IF `tool_result.metadata.contentType === 'text/markdown'` the Wave 4 plan may opt into markdown rendering (still with `rehype-sanitize`). Default behaviour is text-only `<pre>`.

---

## Color

Reuses Phase 23's Oxide palette verbatim — no new hues introduced.

| Role | CSS Variable | Light | Dark | Usage on Detail Page |
|------|-------------|-------|------|---------------------|
| Dominant (60%) — page surface | `--background` | `30 100% 97%` | `60 3% 8%` | Detail page background |
| Dominant (60%) — content well | `--card` | `50 33% 97%` | `60 2% 18%` | IssueHeader card, comment cards, task panel card, composer card |
| Secondary (30%) — muted surfaces | `--muted` | `43 11% 91%` | `60 2% 18%` | Task message alternating row bg (`even:bg-muted/40`); comment thread indent wells |
| Secondary (30%) — borders | `--border` | `43 18% 92%` | `40 5% 25%` | Card outlines, separator, comment thread guides (`border-l border-border pl-6`) |
| Accent (10%) — brand terracotta | `--primary` | `19 100% 60%` | `21 100% 69%` | **RESERVED — see explicit list below** |
| Destructive | `--destructive` | `0 53% 46%` | `0 62% 30%` | Cancel-task CTA, error-kind task message icon + left accent, error toasts |
| Focus ring | `--ring` | same as `--primary` | same as `--primary` | `:focus-visible` on composer textarea, Send button, Cancel button, Show-full link |
| Info-subtle (running badge) | `--color-info-subtle-bg` + `--color-info-subtle-text` | `#155e75` family | `#67e8f9` family | Task state "running" badge (existing token from Phase 23 status palette) |
| Success-subtle (completed badge) | `--color-success-subtle-bg` + `--color-success-subtle-text` | `#065f46` family | `#6ee7b7` family | Task state "completed" badge |
| Warning-subtle (blocked / reconnecting) | `--color-warning-subtle-bg` + `--color-warning-subtle-text` | `#92400e` family | `#d7ba7d` family | "Reconnecting…" banner; "truncated" marker tint |

**Accent (`--primary` terracotta) RESERVED exclusively for:**
1. Primary CTA "Send" button in `ChatComposer` when composer has content
2. Active keyboard focus ring on composer textarea (`ring-2 ring-[var(--ring)]`)
3. "Show full" / "Expand" link text on truncated task messages (`text-[var(--color-primary)] hover:underline`)
4. Live task panel header accent bar (3px top border) when `taskState === 'running'`
5. Current streaming message row pulse (a 300ms opacity fade from 0.6→1.0 on fresh append)
6. Anchor link color in `react-markdown` rendered body (via custom `components.a`)

**Accent is NOT used for:**
- Comment posted timestamps (use `text-muted-foreground`)
- Assignee avatar fallbacks (use `bg-secondary`)
- Status or priority badges (use existing Badge variants / subtle status tokens)
- Task panel card background (use `--card`)
- Tool_use JSON pre-blocks (use `bg-muted` or default)

**Per-task-state accents (task panel state badge + optional top border):**

| Task state | Badge variant | Optional 3px top-border on task panel |
|------------|--------------|---------------------------------------|
| `idle` (no task) | `variant="outline"` muted | none |
| `queued` | `variant="secondary"` | `border-t-muted-foreground` |
| `dispatched` | `variant="secondary"` + pulse-dot | `border-t-[var(--color-info)]` |
| `running` | `bg-[var(--color-info-subtle-bg)] text-[var(--color-info-subtle-text)]` | `border-t-[var(--color-primary)]` |
| `completed` | `bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)]` | `border-t-[var(--color-success)]` |
| `failed` | `variant="destructive"` | `border-t-[var(--color-destructive)]` |
| `cancelled` | `variant="outline"` with `opacity-70` | none |

**Per-task-message-kind left-gutter accent (3px):**

| Kind | Icon (lucide) | Left border | Text treatment |
|------|--------------|-------------|----------------|
| `text` | `MessageSquare` 14px | none | body 14/400 |
| `thinking` | `Brain` 14px | `border-l-2 border-muted` | italic + `text-muted-foreground` |
| `tool_use` | `Wrench` 14px | `border-l-2 border-[var(--color-info)]` | body + collapsible JSON block |
| `tool_result` | `CheckCircle2` 14px (success) / `AlertCircle` 14px (error) | `border-l-2 border-[var(--color-success)]` / `border-l-2 border-[var(--color-destructive)]` (isError) | `<pre>` block |
| `error` | `XCircle` 14px | `border-l-2 border-[var(--color-destructive)]` | `text-[var(--color-destructive)] font-medium` |

**Light + dark theme:** Every value resolves via existing `:root` / `:root.dark` blocks — zero new dark-theme overrides.

---

## Z-Index Ladder

Reuses the Phase 23 ladder (`--z-base` through `--z-critical-alert` in `apps/web/src/index.css`).

**Detail page application:**

| Element | Value |
|---------|-------|
| Page content | `--z-base` (implicit) |
| Sticky ChatComposer footer card | `style={{ zIndex: 'var(--z-sticky)' }}` (20) |
| Action sidebar dropdowns (Assign agent / Change status) | Radix auto-portals to `--z-dropdown` (10) |
| Destructive-confirm Dialog (Cancel task) | Radix Dialog auto-portals to `--z-modal` (1000) |
| Toasts (Sonner) | `--z-toast` (7000) — already set via Phase 23 migration |

**No new z-index tokens introduced by Phase 24.**

---

## Copywriting Contract

Every new string is an i18n key in `issues.detail.*` or `chat.*`. All keys ship in 6 locales (`en, zh, fr, de, es, it`) and are enforced by `apps/web/scripts/check-i18n-parity.mjs` + CI (UX5, inherited from Phase 23).

### Page scaffolding

| Element | Key | en (source) |
|---------|-----|-------------|
| Back-to-board button | `issues.detail.back` | `Back to Issues` |
| Document title suffix | `issues.detail.titleSuffix` | `Issue #{{issueNumber}} · {{workspaceName}}` (rendered via `<title>` effect) |
| Issue not found | `issues.detail.notFound` | `Issue not found` |
| Initial load failed | `issues.detail.loadFailed` | `Couldn't load this issue` |

### IssueHeader

| Element | Key | en |
|---------|-----|----|
| Issue number prefix | `issues.detail.issueNumber` | `#{{number}}` |
| Posted metadata | `issues.detail.postedMeta` | `Created {{relativeTime}} by {{author}}` |
| Assignee label | `issues.detail.assignee` | `Assignee` |
| Unassigned value | `issues.detail.unassigned` | `Unassigned` |
| Priority label | `issues.detail.priority` | `Priority` |
| Status label | `issues.detail.status` | `Status` |
| Due date label | `issues.detail.dueDate` | `Due` |
| Action: edit issue | `issues.detail.actions.edit` | `Edit` |
| Action: assign agent | `issues.detail.actions.assignAgent` | `Assign agent` |
| Action: change status | `issues.detail.actions.changeStatus` | `Change status` |
| Action: delete issue | `issues.detail.actions.delete` | `Delete issue` |

### Comments timeline

| Element | Key | en |
|---------|-----|----|
| Section header | `issues.detail.comments.header` | `Comments` |
| Count pill | `issues.detail.comments.count` | `{{count}}` |
| Empty state heading | `issues.detail.comments.empty.heading` | `No comments yet` |
| Empty state body | `issues.detail.comments.empty.body` | `Ask the assigned agent a question or leave a note to start the conversation.` |
| Author line — user | `issues.detail.comments.author.user` | `{{displayName}}` |
| Author line — agent | `issues.detail.comments.author.agent` | `{{agentName}} · agent` |
| Author line — system | `issues.detail.comments.author.system` | `System` |
| Relative time | `issues.detail.comments.postedAt` | `{{relativeTime}}` (uses `Intl.RelativeTimeFormat` helper) |
| Reply button | `issues.detail.comments.reply` | `Reply` |
| Edit button | `issues.detail.comments.edit` | `Edit` |
| Delete button | `issues.detail.comments.delete` | `Delete` |
| Cancel reply button | `issues.detail.comments.cancelReply` | `Cancel` |
| Reply composer placeholder | `issues.detail.comments.replyPlaceholder` | `Reply to {{authorName}}…` |
| Collapsed thread toggle | `issues.detail.comments.showMore` | `Show {{count}} more replies` |
| System-comment — status change | `issues.detail.comments.system.statusChange` | `Status changed from {{from}} to {{to}}` *(rendered read-only — key added for i18n parity but the server produces the string in en; the UI renders server text directly. Key exists so UI controls the label style.)* |
| Post comment failure | `issues.detail.comments.postFailed` | `Couldn't post comment — please try again` |
| Delete confirm title | `issues.detail.comments.confirmDelete.title` | `Delete this comment?` |
| Delete confirm body | `issues.detail.comments.confirmDelete.body` | `This cannot be undone.` |
| Delete confirm ok | `issues.detail.comments.confirmDelete.confirm` | `Delete` |
| Delete confirm cancel | `common.buttons.cancel` | `Cancel` (reuse existing common namespace) |

### Task panel

| Element | Key | en |
|---------|-----|----|
| Section header | `issues.detail.task.header` | `Active task` |
| No active task (idle) | `issues.detail.task.idle` | `No active task` |
| Idle body copy | `issues.detail.task.idleBody` | `Assign this issue to an agent or chat below to start a task.` |
| State: queued | `issues.detail.task.state.queued` | `Queued` |
| State: dispatched | `issues.detail.task.state.dispatched` | `Dispatched` |
| State: running | `issues.detail.task.state.running` | `Running` |
| State: completed | `issues.detail.task.state.completed` | `Completed` |
| State: failed | `issues.detail.task.state.failed` | `Failed` |
| State: cancelled | `issues.detail.task.state.cancelled` | `Cancelled` |
| Started at | `issues.detail.task.startedAt` | `Started {{relativeTime}}` |
| Completed at | `issues.detail.task.completedAt` | `Completed {{relativeTime}}` |
| Cancel button | `issues.detail.task.cancel` | `Cancel task` |
| Cancel confirm title | `issues.detail.task.cancelConfirm.title` | `Cancel this task?` |
| Cancel confirm body | `issues.detail.task.cancelConfirm.body` | `The agent will stop as soon as possible. Partial results are preserved.` |
| Cancel confirm ok | `issues.detail.task.cancelConfirm.confirm` | `Cancel task` |
| Cancel failure toast | `issues.detail.task.cancelFailed` | `Couldn't cancel — please try again` |
| Task history header | `issues.detail.task.historyHeader` | `Task history` |
| Task history empty | `issues.detail.task.historyEmpty` | `No prior tasks` |

### Task messages (stream)

| Element | Key | en |
|---------|-----|----|
| Stream empty (waiting) | `issues.detail.task.stream.waiting` | `Waiting for the agent to respond…` |
| Stream stalled hint | `issues.detail.task.stream.stalled` | `No activity for {{seconds}}s` |
| Kind label: text | `issues.detail.task.kind.text` | `reply` |
| Kind label: thinking | `issues.detail.task.kind.thinking` | `thinking` |
| Kind label: tool_use | `issues.detail.task.kind.tool_use` | `{{toolName}}` |
| Kind label: tool_result | `issues.detail.task.kind.tool_result` | `{{toolName}} result` |
| Kind label: error | `issues.detail.task.kind.error` | `error` |
| Kind meta (seq + time) | `issues.detail.task.seqMeta` | `seq {{seq}} · {{relativeTime}}` |
| Truncation marker | `issues.detail.task.truncated` | `⋯ truncated (showing {{shown}} of {{total}} bytes)` |
| Show-full link | `issues.detail.task.showFull` | `Show full` |
| Show-full loading | `issues.detail.task.showFullLoading` | `Loading…` |
| Show-full failed | `issues.detail.task.showFullFailed` | `Couldn't load the full message` |
| Collapse full content | `issues.detail.task.collapse` | `Collapse` |
| Tool input label | `issues.detail.task.toolInputLabel` | `Input` |
| Tool output label | `issues.detail.task.toolOutputLabel` | `Output` |

### Reconnect + backpressure

| Element | Key | en |
|---------|-----|----|
| Reconnecting banner | `issues.detail.ws.reconnecting` | `Reconnecting — replaying missed messages…` |
| Reconnected replay done | `issues.detail.ws.replayDone` | `Caught up` (fades after 1.5s) |
| Background-tab paused | `issues.detail.ws.paused` | `Paused while in background` (shown only if tab is explicitly paused) |
| Resumed notice | `issues.detail.ws.resumed` | `Resumed` (fades after 1.5s) |

### Chat on issue composer (`chat.*`)

| Element | Key | en |
|---------|-----|----|
| Composer section header (sr-only) | `chat.composer.srHeader` | `Chat with the assigned agent` |
| Placeholder | `chat.composer.placeholder` | `Type a message… (⌘⏎ to send)` |
| Send button | `chat.composer.send` | `Send` |
| Sending state | `chat.composer.sending` | `Sending…` |
| No assignee warning | `chat.composer.noAssignee` | `Assign an agent to this issue before chatting` |
| Send failed | `chat.composer.sendFailed` | `Couldn't send — please try again` |
| Character counter (hidden until near cap) | `chat.composer.chars` | `{{count}} / {{max}}` |
| Keyboard hint | `chat.composer.hint` | `Enter for newline · ⌘⏎ to send` |

### Destructive confirmation pattern

All destructive confirmations use a `Dialog` with:
- **Title:** `{action}?` (e.g., "Cancel this task?")
- **Body:** ≤ 1 short sentence explaining effect
- **Cancel button:** `t('common.buttons.cancel')` (`Cancel`)
- **Confirm button:** destructive variant, text = primary action verb (e.g., "Cancel task", "Delete")

Destructive actions in Phase 24 scope:
1. Cancel running/dispatched task — `issues.detail.task.cancelConfirm.*`
2. Delete comment — `issues.detail.comments.confirmDelete.*`
3. Delete issue — (keys already defined in Phase 23 header; UI lives on detail page via dropdown menu): `issues.board.confirm.delete.title` / `issues.board.confirm.delete.body` — reuse verbatim.

### Accessibility announcements

| Event | Key | en |
|-------|-----|----|
| New task message appended (sr-only, rate-limited to every 5s during burst) | `issues.detail.a11y.newMessages` | `{{count}} new agent messages` |
| Task completed (live region) | `issues.detail.a11y.taskCompleted` | `Task completed` |
| Task failed | `issues.detail.a11y.taskFailed` | `Task failed` |
| Task cancelled | `issues.detail.a11y.taskCancelled` | `Task cancelled` |
| Reconnect replay started | `issues.detail.a11y.replaying` | `Reconnecting and replaying missed messages` |
| Reconnect replay done | `issues.detail.a11y.replayDone` | `Caught up with agent` |

**Announcer host:** Reuse the existing `.visually-hidden` class (defined in `index.css:584-594`) inside a `<div role="status" aria-live="polite">` wrapper at the top of `IssueDetailPage`.

---

## Component Inventory

Components to create under `apps/web/src/components/issues/detail/` (NEW subdirectory — keeps Phase 23 components untouched):

| Component | File | Responsibilities | Props (key shapes) |
|-----------|------|------------------|---------------------|
| `IssueDetailPage` | `apps/web/src/pages/IssueDetailPage.tsx` | Route component for `/issues/:id`. `GET /api/issues/:id` + `GET /api/issues/:id/comments` on mount. Orchestrates all child sections. Sets `<title>`. | — (reads `useParams<{ id: string }>()`) |
| `IssueHeader` | `apps/web/src/components/issues/detail/IssueHeader.tsx` | Title (`#N · {title}`), status badge, priority badge, assignee, due date, action dropdown menu | `{ issue: Issue; onEdit: () => void; onDelete: () => void; onAssign: () => void; onChangeStatus: (s: IssueStatus) => void }` |
| `IssueDescription` | `apps/web/src/components/issues/detail/IssueDescription.tsx` | Renders `issue.description` via `react-markdown` + `rehype-sanitize`. Falls back to "No description" if null/empty | `{ description: string \| null }` |
| `CommentsTimeline` | `apps/web/src/components/issues/detail/CommentsTimeline.tsx` | Section container; groups comments into threads by `parent_id`; renders one `<CommentThread>` per top-level comment. Posts new comments via `POST /api/issues/:id/comments`. | `{ issueId: string; comments: Comment[]; onPost: (content: string, parentId?: string) => Promise<void>; loadingIds: Set<string> }` |
| `CommentThread` | `apps/web/src/components/issues/detail/CommentThread.tsx` | Recursive thread renderer: root + nested children (max 3 visible levels before collapse). Collapse toggles via `issues.detail.comments.showMore` affordance. | `{ root: Comment; children: CommentTreeNode[]; depth: number; onReply: (parentId: string) => void; activeReplyTarget: string \| null; onPost: ...; onEdit: ...; onDelete: ... }` |
| `CommentCard` | `apps/web/src/components/issues/detail/CommentCard.tsx` | One comment row (user / agent / system). Avatar + author line + body (markdown) + actions. Memoized on `comment.id + comment.updatedAt`. | `{ comment: Comment; isActiveReplyTarget: boolean; onReply: () => void; onEdit: () => void; onDelete: () => void }` |
| `CommentComposer` | `apps/web/src/components/issues/detail/CommentComposer.tsx` | Inline textarea + Post button for top-level comments and for reply composers. Auto-grows up to 6 rows. | `{ onSubmit: (content: string) => Promise<void>; placeholderKey: string; autoFocus?: boolean; onCancel?: () => void }` |
| `TaskPanel` | `apps/web/src/components/issues/detail/TaskPanel.tsx` | Wraps the latest active task + its stream. If no active task, renders idle state + "History" link. Subscribes via `subscribeTask(taskId, lastSeq)`. | `{ issueId: string; latestTask: AgentTask \| null; onCancel: (taskId: string) => void; onShowHistory: () => void }` |
| `TaskStateBadge` | `apps/web/src/components/issues/detail/TaskStateBadge.tsx` | Badge styled per task state (see Color table). | `{ state: TaskStatus }` |
| `TaskMessageList` | `apps/web/src/components/issues/detail/TaskMessageList.tsx` | Message stream container. Virtualized via `@tanstack/react-virtual` when `messages.length > 100`. Wrapped in `useTransition`. Exposes `lastSeenSeqRef` and `messagesRef` to `useTaskStream`. | `{ taskId: string; messages: TaskMessage[]; isReplaying: boolean }` |
| `TaskMessageItem` | `apps/web/src/components/issues/detail/TaskMessageItem.tsx` | One row, dispatches on `kind`. Kind-specific sub-renderers: `TextMessage`, `ThinkingMessage`, `ToolUseMessage`, `ToolResultMessage`, `ErrorMessage`. Memoized on `message.id + message.seq + expandedState`. | `{ message: TaskMessage; isLatest: boolean }` |
| `TruncationMarker` | `apps/web/src/components/issues/detail/TruncationMarker.tsx` | Inline "⋯ truncated" + "Show full" link. On click, fetches `GET /api/tasks/:id/messages/:seq/full` and replaces body. | `{ taskId: string; seq: number; shownBytes: number; totalBytes: number; onLoad: (full: TaskMessage) => void }` |
| `ReconnectBanner` | `apps/web/src/components/issues/detail/ReconnectBanner.tsx` | Visible only while `isReconnecting || isReplaying`. Uses warning-subtle tokens. Also renders "Caught up" toast-style fade on replay end. | `{ isReconnecting: boolean; isReplaying: boolean }` |
| `ChatComposer` | `apps/web/src/components/issues/detail/ChatComposer.tsx` | Sticky-ish card at the bottom of the main column. Textarea + Send + char counter. On submit: 1) `POST /api/issues/:id/comments` with content; 2) pass response's `enqueuedTask.id` up so `TaskPanel` subscribes. Disabled if no assignee. ⌘⏎ submits. | `{ issue: Issue; onSubmit: (content: string) => Promise<{ commentId: string; taskId: string \| null }>; disabled: boolean }` |
| `IssueActionSidebar` | `apps/web/src/components/issues/detail/IssueActionSidebar.tsx` | Right-column sticky card with assignee, priority, status, due date, labels pseudo-section (deferred). | `{ issue: Issue; onPatch: (patch: UpdateIssuePatch) => Promise<void> }` |
| `useTaskStream` (hook) | `apps/web/src/components/issues/detail/useTaskStream.ts` | All stream state + WS subscribe + replay fetch + visibility backpressure. Returns `{ messages, isReplaying, isReconnecting, pauseStream, resumeStream }`. | `{ taskId: string \| null }` |
| `useIssueDetail` (hook) | `apps/web/src/components/issues/detail/useIssueDetail.ts` | Issue + comments fetch + WS reconciliation for `issue:updated`, `issue:deleted`, `comment:posted/updated/deleted`, `task:*`. Returns `{ issue, comments, latestTask, refetch }`. | `{ issueId: string }` |

**Directory structure (planner consumes):**

```
apps/web/src/
├── pages/
│   └── IssueDetailPage.tsx                                  [new]
├── components/issues/detail/                                [NEW subdir]
│   ├── IssueHeader.tsx
│   ├── IssueDescription.tsx
│   ├── CommentsTimeline.tsx
│   ├── CommentThread.tsx
│   ├── CommentCard.tsx
│   ├── CommentComposer.tsx
│   ├── TaskPanel.tsx
│   ├── TaskStateBadge.tsx
│   ├── TaskMessageList.tsx
│   ├── TaskMessageItem.tsx
│   ├── TruncationMarker.tsx
│   ├── ReconnectBanner.tsx
│   ├── ChatComposer.tsx
│   ├── IssueActionSidebar.tsx
│   ├── useTaskStream.ts
│   ├── useIssueDetail.ts
│   └── markdown.tsx                                          [shared react-markdown config + rehype-sanitize allowlist]
└── components/issues/IssueCard.tsx                          [MODIFY: add onClick → navigate(`/issues/${issue.id}`)]
```

**Route addition (modify `apps/web/src/App.tsx`):**

```tsx
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage').then(m => ({ default: m.IssueDetailPage })));
// inside <Route element={<AppLayout />}>, AFTER /issues:
<Route path="/issues/:id" element={<IssueDetailPage />} />
```

**Navigation entry (modify `apps/web/src/components/issues/IssueCard.tsx`):**

Add an onClick handler that navigates via `useNavigate()` to `/issues/${issue.id}`. CRITICAL: must coexist with `@dnd-kit` drag — use `onClick` but check `activeId` is null (or delegate to the card body, not the drag handle area). A minimally invasive pattern: wrap the title `<h3>` in a `<button type="button" className="text-left focus-visible:outline-none" onClick={...}>` so drag listeners on the card root remain the drag affordance, and the title area itself is the click target. Verify `pointerDistance: 5` in `useSortable` activation constraint already prevents a click from being interpreted as a drag.

---

## Interaction Contract

### Routing + page boot

1. On `/issues/:id` mount: call `api.get<Issue>('/issues/' + id)` and `api.get<Comment[]>('/issues/' + id + '/comments')` in parallel. Show `Skeleton` per section until both resolve. 404 → render `issues.detail.notFound` empty state with a back button.
2. Set `document.title = t('issues.detail.titleSuffix', { issueNumber, workspaceName: 'Aquarium' })` via effect. Restore on unmount.
3. WS subscribe: `subscribe('AQ')` on mount (same channel Phase 23 uses). Plus `subscribeTask(taskId, lastSeq)` inside `useTaskStream` when a task becomes active (see WebSocket Contract).

### Comments interactions

| Event | Handler |
|-------|---------|
| Click "Reply" on `CommentCard` | Set `activeReplyTarget = comment.id`; render `CommentComposer` inline below that card with autofocus |
| Submit reply composer | `POST /api/issues/:id/comments` with `{ content, parentId: activeReplyTarget }`. On success, clear `activeReplyTarget`; WS `comment:posted` will render the new row. On failure, `toast.error(t('issues.detail.comments.postFailed'))`. |
| Cross-level reply click | Same flow; depth capped at 3 visible levels — deeper replies render as depth-3 children with a leading "Re: @author" inline marker instead of further indent |
| `Enter` on composer textarea | Default: insert newline |
| `⌘⏎` / `Ctrl+Enter` on composer textarea | Submit |
| Click "Delete" on own comment | Opens Dialog (destructive confirm). On confirm: `DELETE /api/comments/:id` |
| Click "Edit" on own comment | Inline editor state; `PATCH /api/comments/:id` on save |
| System comments | Render as compact timeline row (no avatar, no actions, `text-muted-foreground`, no reply affordance — client refuses to set `parentId: systemCommentId` via a guard matching the server's `parent must be user comment` rule) |

### Task panel interactions

| Event | Handler |
|-------|---------|
| `latestTask.status === 'running' or 'dispatched'` | Show "Cancel task" button in panel header |
| Click Cancel | Dialog confirm → `POST /api/tasks/:taskId/cancel` (or existing endpoint; planner verifies in Wave 0) → optimistic state update → server broadcasts `task:cancelled` |
| `latestTask.status` changes via WS `task:cancelled` / `task:completed` / `task:failed` | Update badge, stop subscription at seq MAX, announce via sr-only live region |
| Click "Task history" | Opens a `Popover` or `Sheet` with a list of prior tasks (no expansion inline); each row links back to the same URL with a `?taskId=<id>` query param to pin history view (planner: stretch goal — out-of-scope if over budget) |

### Task message stream interactions

| Event | Handler |
|-------|---------|
| New WS `task:message` event | Dispatched by `useTaskStream`; pushed into buffer, then `startTransition(() => setMessages(...))`. Virtualized list auto-scrolls to bottom only if user is already at bottom (`scrollTop + clientHeight >= scrollHeight - 32`); otherwise a "↓ Jump to latest" affordance appears |
| Scroll to top | No infinite-scroll upward (stream is tail-only); history scrolls to `seq=1` only if the buffer holds it (first fetch on mount includes `GET /api/tasks/:id/messages?afterSeq=0` up to a server cap e.g. 500 rows) |
| Click truncation "Show full" | Loading spinner inline on the link → `GET /api/tasks/:id/messages/:seq/full` → replace the item body with full content; button flips to "Collapse" |
| Click tool_use to expand | Toggle `expandedToolUse: Set<messageId>` local state; collapsed default shows toolName + first 60 chars of JSON preview |
| Click tool_result to expand | Same pattern as tool_use |
| Document visibility → hidden | Send `{ type: 'pause_stream', taskId }` to WS; record `pausedAt` timestamp. Client does NOT tear down subscription — just signals server to stop pushing. |
| Document visibility → visible | Send `{ type: 'subscribe_task', taskId, lastSeq: currentMaxSeq }` (re-subscribe with latest seen seq). Server replays gap + resumes live. Announce `issues.detail.a11y.replaying`. |

### ChatComposer interactions

| Event | Handler |
|-------|---------|
| Type in textarea | Update local state; show char counter only when `content.length > MAX - 200` (MAX = 8000 client-side) |
| `⌘⏎` / `Ctrl+Enter` | Submit; if `issue.assigneeId == null`, toast `chat.composer.noAssignee` and don't submit |
| Submit | 1) `POST /api/issues/:id/comments { content, triggerCommentId: <last-user-comment-id or null> }`; response is `{ comment, enqueuedTask }`. 2) If `enqueuedTask`, pass `enqueuedTask.id` up so `TaskPanel` subscribes. 3) Clear composer. On error, `toast.error(t('chat.composer.sendFailed'))` and keep content. |
| Disabled state | `disabled={issue.assigneeId == null}`; render `<p className="text-xs text-muted-foreground mt-2">{t('chat.composer.noAssignee')}</p>` below |

### Reduced motion

Existing `@media (prefers-reduced-motion: reduce)` rule (`index.css:598-607`) already neutralizes Tailwind transitions. The streaming "pulse" on fresh messages uses `animate-pulse` which that rule disables. No extra work.

### Responsive

| Viewport | Behavior |
|----------|----------|
| ≥ 1024px | Two-column grid: main content (flex-1) + sticky `IssueActionSidebar` (`w-[280px]`) |
| 768–1023px | Single column: main content full width; sidebar collapses into a `Popover` triggered by an "Actions" button in the header |
| < 768px | Same single-column layout; composer becomes full-width; message list keeps vertical layout |

---

## Task Message Stream — Hard Invariants

These invariants are the Phase 24 pitfall mitigations. Planner MUST embed them in plans; executor MUST implement; checker MUST verify.

### ST2 — WS Reconnect Replay Ordering (HARD)

**Server side (`apps/server/src/ws/index.ts` + task-message-store + new route):**

1. New WS inbound message type `subscribe_task`:
   ```ts
   { type: 'subscribe_task', taskId: string, lastSeq: number }
   ```
2. Handler sequence (strictly ordered):
   - **Step 1**: Create an in-memory replay buffer for this client+task pair (`replayBuffers: Map<"<clientId>:<taskId>", WsMessage[]>`).
   - **Step 2**: Any live `task:message` broadcast for that taskId → if a replay buffer exists, `push` instead of sending.
   - **Step 3**: Query DB: `SELECT * FROM task_messages WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT 1000`.
   - **Step 4**: Send every replay row to the client in seq order, each as `{ type: 'task:message', taskId, seq, payload: <TaskMessage> }`.
   - **Step 5**: Drain + send the live buffer (still in arrival order) to the client.
   - **Step 6**: Remove the buffer entry; switch the client to live-only mode.
3. New REST endpoint `GET /api/tasks/:id/messages?afterSeq=N` — returns `{ messages: TaskMessage[], hasMore: boolean }`, used on initial page mount to hydrate the first 500 historical messages (pre-subscribe) without relying on WS.
4. New inbound `pause_stream { type: 'pause_stream', taskId }` handler — marks the client's taskId subscription as paused; server suppresses live broadcasts for that subscription. No DB action. On next `subscribe_task` resubscribe, buffer-replay-live sequence runs as normal.

**Client side (`apps/web/src/components/issues/detail/useTaskStream.ts`):**

1. On hook mount with a non-null `taskId`:
   - Fetch initial history: `const initial = await api.get('/tasks/' + taskId + '/messages?afterSeq=0');`
   - Seed `messages` state with `initial.messages`; `lastSeqRef.current = max(seq)`.
   - Send WS `{ type: 'subscribe_task', taskId, lastSeq: lastSeqRef.current }`.
   - Register `addHandler('task:message', ...)` — on each message, update `lastSeqRef.current = Math.max(current, msg.seq)`.
2. On WS reconnect (`isConnected` flips false → true): immediately re-send `{ type: 'subscribe_task', taskId, lastSeq: lastSeqRef.current }`. Server-side buffer-replay-live sequence closes any gap.
3. On `document.visibilitychange`:
   - `hidden` → send `{ type: 'pause_stream', taskId }`; set `isPaused = true`.
   - `visible` → send `{ type: 'subscribe_task', taskId, lastSeq: lastSeqRef.current }`; set `isPaused = false`; set `isReplaying = true` until the next idle frame (~16 ms without a new task:message arrival). The ReconnectBanner reflects `isReplaying`.
4. Dedupe on write: before inserting into `messages` array, ignore any incoming message whose `seq` is ≤ current max (guards against double-delivery during reconnect edge cases).

**Acceptance (machine-checkable in the plan):**
- Playwright `-g "reconnect replay"`: simulate WS drop mid-stream via server-side force-close; assert client ends with the exact set of `seq` values 1..N (no gaps, no duplicates).
- Playwright `-g "replay no reorder"`: during replay, drive new live broadcasts; assert the client's final `messages` array is sorted by seq ascending.

### UX6 — XSS Prevention (HARD)

**Rendering rules (enforced by grep in CI):**

1. **Zero `dangerouslySetInnerHTML`** anywhere under `apps/web/src/components/issues/detail/`.
   ```
   ! grep -r "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/
   ```
2. Centralised markdown config at `apps/web/src/components/issues/detail/markdown.tsx`:
   ```tsx
   import ReactMarkdown from 'react-markdown';
   import remarkGfm from 'remark-gfm';
   import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
   import rehypeHighlight from 'rehype-highlight';
   
   // Extend the default allowlist minimally — add `className` on code/pre for hljs
   const SAFE_SCHEMA = {
     ...defaultSchema,
     attributes: {
       ...defaultSchema.attributes,
       code: [...(defaultSchema.attributes?.code || []), 'className'],
       pre: [...(defaultSchema.attributes?.pre || []), 'className'],
     },
     // Explicitly disallow: script, iframe, object, embed, form, link (handled by default)
     // Explicitly allow anchor rel + target to be sanitized down to safe values (default behavior)
   };
   
   export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
     return (
       <ReactMarkdown
         className={className}
         remarkPlugins={[remarkGfm]}
         rehypePlugins={[[rehypeSanitize, SAFE_SCHEMA], rehypeHighlight]}
         components={{
           a: ({ href, children, ...rest }) => (
             <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--color-primary)] hover:underline" {...rest}>
               {children}
             </a>
           ),
         }}
       >
         {children}
       </ReactMarkdown>
     );
   }
   ```
3. `text` kind task message: render with `<SafeMarkdown>{message.content ?? ''}</SafeMarkdown>`.
4. `thinking` kind: `<span className="italic text-muted-foreground"><SafeMarkdown>{...}</SafeMarkdown></span>` (markdown allowed but still sanitized).
5. `tool_use.input`: plain `<pre>{JSON.stringify(input, null, 2)}</pre>` — NEVER markdown, NEVER innerHTML.
6. `tool_result.content`: default `<pre>{content}</pre>`. Opt-in markdown only if `metadata.contentType === 'text/markdown'` AND the wave-4 plan explicitly greenlights — still through `SafeMarkdown`.
7. `error` kind: plain `<span>{error}</span>`.
8. Comment body: `<SafeMarkdown>{comment.content}</SafeMarkdown>` for all author types (user, agent, system). System-authored `status_change` copy comes from the server and is plain text, but still sanitized by the markdown pass.

**Acceptance:**
- Build-time grep: `! grep -r "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/` (added to VALIDATION row 24-04-01).
- Playwright `-g "xss hardening"`: seed a task_message with `content = "<script>window.__pwned=true</script>normal text"`; open detail; wait 500ms; assert `await page.evaluate(() => (window as unknown as { __pwned?: true }).__pwned)` is `undefined`.

### UX6 — Truncation (HARD)

**Server-side (`apps/server/src/services/task-message-store.ts` / `task-dispatch/task-message-batcher.ts`):**

1. Constant: `export const TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384;` (16 KB) — declared once in a shared location and imported by all writers.
2. Truncation applies on the INSERT path (batcher + hosted worker + daemon route `POST /api/daemon/tasks/:id/messages`). For each `PendingTaskMessage`:
   - For `content` string fields: if `Buffer.byteLength(content, 'utf8') > LIMIT`, truncate to the largest safe prefix ≤ LIMIT bytes (avoid splitting a multi-byte code point — planner chooses: slice to byte budget then `.toString('utf8')` which drops a trailing partial code point).
   - For `output` (tool_result) if it's a string: same rule.
   - For `input` (tool_use) objects: serialize to JSON first, check JSON byte-length, truncate the string form if over (the truncated marker is then rendered against the serialized form).
   - Set `metadata.truncated = true` and `metadata.originalBytes = <pre-truncation byte length>` on every truncated row.
3. NEW endpoint `GET /api/tasks/:id/messages/:seq/full` — returns the UN-truncated row from a separate `task_message_blobs` table OR (simpler path the planner chooses): return the truncated-to-LIMIT version + `metadata.originalBytes`, AND store the original blob in a new `task_message_overflow` table keyed on `(task_id, seq)` when the original exceeded the limit. Response shape: `{ seq, kind, content, input, output, metadata }` (full, unbounded by UI — but server still caps at e.g. 1 MB to prevent abuse).
4. Rate limiting on `GET /full`: reuse existing global rate limiter; planner confirms it's not on the daemon exemption list.

**Client-side:**

- If `message.metadata.truncated === true`, render `<TruncationMarker>` inline at end of the content block with text:
  ```
  ⋯ truncated (showing {shown} of {total} bytes)  [Show full]
  ```
- On click: set row-local `expanded = true`; show spinner inline on the link text; call `api.get('/tasks/' + taskId + '/messages/' + seq + '/full')`; on success, replace the rendered content with the full response's content; swap link to "Collapse".
- Full content still rendered through `SafeMarkdown` or `<pre>` per kind.
- Hard byte cap on client render of a SINGLE message to 256 KB (guard against extreme server responses) — beyond that, show truncated + re-offer "Show full" (pointing out it was clipped for rendering).

**Acceptance:**
- Server unit test `task-message-truncation.test.ts`: insert a 20 KB `text` content → row stored at ≤ 16 KB bytes AND `metadata.truncated === true` AND `metadata.originalBytes === 20480`.
- Playwright `-g "truncation marker"`: seed a task_message with 20 KB content; open detail; assert `data-truncated="true"` attribute is present; click "Show full"; assert full content renders; assert link flips to "Collapse".

### ST3 — Background-Tab Backpressure (HARD)

**Client-side invariants:**

1. `TaskMessageList` always wraps setMessages via `startTransition`:
   ```tsx
   const [isPending, startTransition] = useTransition();
   const onIncoming = useCallback((msg: TaskMessage) => {
     startTransition(() => setMessages(prev => [...prev, msg]));
   }, []);
   ```
2. Rendered array uses `const rendered = useDeferredValue(messages)`.
3. Virtualization threshold: plain `.map()` for `messages.length ≤ 100`; `useVirtualizer({ count, estimateSize: () => 56, overscan: 12 })` once > 100.
4. Visibility handler:
   ```tsx
   useEffect(() => {
     const onVis = () => {
       if (document.hidden) pauseStream();
       else resumeStream();
     };
     document.addEventListener('visibilitychange', onVis);
     return () => document.removeEventListener('visibilitychange', onVis);
   }, [pauseStream, resumeStream]);
   ```
5. Announcer rate-limit: `IssueDetailPage` live region announces `a11y.newMessages` at most every 5s during a burst (debounce) — avoids screen-reader flooding.

**Acceptance:**
- Playwright `-g "background tab recovery"` (skipped in CI; manual-only per VALIDATION row 24-02-02's "Manual-Only Verifications"): open detail with a seeded 500-msg task; tab-switch for 60s; return; assert DevTools Performance reports no main-thread task ≥ 500ms in the resume window.

### CHAT-01 — Threading Invariant

1. User types "What should I do next?" in `ChatComposer`; composer submits.
2. Client sends `POST /api/issues/:id/comments` with `{ content, triggerCommentId: null }` (first message) or `{ content, triggerCommentId: <last-user-comment-id> }` (subsequent — the anchor).
3. Server-side (Phase 17-04 already shipped): `createUserComment` creates the comment; if the issue has an assignee, it ALSO enqueues a task with `trigger_comment_id = <newly created comment.id>`; returns `{ comment, enqueuedTask }`.
4. Client captures `enqueuedTask.id`; `TaskPanel` begins streaming.
5. Stream completes. **Wave-5 plan adds the completion callback** in `apps/server/src/task-dispatch/hosted-task-worker.ts` (and in the daemon completion path via route handler) that:
   ```ts
   if (task.metadata?.triggerCommentId) {
     await createAgentComment({
       workspaceId, issueId: task.issueId, authorAgentId: task.agentId,
       content: finalAgentText, parentId: task.triggerCommentId, trx,
     });
   }
   ```
   Wave 5 plan also introduces `createAgentComment` in `apps/server/src/services/comment-store.ts` (Phase 17-04 left this as a "Downstream Readiness" extension point — documented; not yet implemented). The new comment's `parent_id` makes the agent reply thread nicely under the user prompt.
6. Client's WS handler `comment:posted` appends the agent comment; indentation matches `parent_id` depth; thread shows user → agent visually nested.

**Acceptance:**
- Playwright `-g "chat on issue"`: submit a chat; wait for task to complete (fake hosted worker); assert the post-completion comment has `author_type='agent'`, `parent_id` equals the user comment id, and renders nested in the thread.

---

## WebSocket Event Contract

**Existing events consumed (no new server work):**

| Event | Source phase | Action on detail page |
|-------|--------------|-----------------------|
| `issue:updated` | Phase 17-03 | Replace issue state in `useIssueDetail` |
| `issue:deleted` | Phase 17-03 | Navigate back to `/issues`; toast "Issue deleted" |
| `comment:posted` | Phase 17-04 | Append to `comments` state; scroll into view if near bottom |
| `comment:updated` | Phase 17-04 | Replace comment in place |
| `comment:deleted` | Phase 17-04 | Remove from state |
| `task:cancelled` | Phase 18-04 | Update task state + badge |

**NEW events (Wave 0 extends `WsEventType` in `packages/shared/src/types.ts`):**

| Event | Payload | Emitted by |
|-------|---------|-----------|
| `task:message` | `{ taskId, issueId, seq, payload: TaskMessage }` | task-message-batcher broadcast (Phase 18-02 already emits `task:message` via broadcast — Wave 0 just adds the literal to `WsEventType` union if missing) |
| `task:dispatched` | `{ taskId, issueId, payload: AgentTask }` | task-queue-store lifecycle (Phase 18-01 already broadcasts — Wave 0 adds literal if missing) |
| `task:started` | `{ taskId, issueId, payload: AgentTask }` | Phase 18-01 (verify literal present) |
| `task:completed` | `{ taskId, issueId, payload: AgentTask }` | Phase 18-01 |
| `task:failed` | `{ taskId, issueId, payload: { error: string } }` | Phase 18-01 |

**Wave 0 verification gate (mandatory):** Planner Wave 0 reads `packages/shared/src/types.ts` and the existing broadcast call sites in `apps/server/src/services/task-queue-store.ts` + `apps/server/src/task-dispatch/task-message-batcher.ts`. If any of the 5 literals above are not already in `WsEventType`, add them additively (same pattern as Phase 23 Wave 0). Document findings in a `24-00-A1-VERIFIED.md` mirroring Phase 23's doc.

**Subscribe pattern inside `useTaskStream`:**

```tsx
// On hook mount with taskId != null:
subscribe('AQ');  // workspace channel (reuses Phase 23 A1 finding)
// No new `subscribeTask` method on WebSocketContext — task:message broadcasts
// already route through the workspace subscription. The server's replay logic
// (ST2 above) runs on the workspace-scoped client.

// BUT: subscribe_task inbound message to TRIGGER replay. This is a REQUEST,
// not a subscription topic. Client sends it via the raw WS:
//   ws.send(JSON.stringify({ type: 'subscribe_task', taskId, lastSeq }));
// Since WebSocketContext does not expose the raw socket, Wave 0 ADDS a new
// method: `sendRaw(message: object): void` (guarded — only allowed message
// types: 'subscribe_task', 'pause_stream') or — preferred — a dedicated
// `requestTaskReplay(taskId, lastSeq)` + `pauseTaskStream(taskId)` +
// `resumeTaskStream(taskId, lastSeq)` method trio.

// Planner picks: add the explicit trio to WebSocketContext. Naming chosen
// to avoid confusion with the existing `subscribe` (which manages
// subscription topic sets, not one-shot requests).
```

---

## Virtualization Contract (reuses Phase 23 pattern)

| Threshold | Strategy |
|-----------|----------|
| `messages.length ≤ 100` | Plain `.map()` render |
| `messages.length > 100` | `useVirtualizer({ count, estimateSize: () => 56, overscan: 12 })` — 56px default row (dense log-style); `measureElement` used for variable heights of long tool_result previews |
| During replay (`isReplaying`) | Bump `overscan` temporarily to 24 so the catch-up scroll doesn't blank-flash |

**Verification (test in Wave 2):** Seed 500 messages → open detail → `document.querySelectorAll('[data-task-message-seq]').length ≤ 30`. Attribute added per row for Playwright.

---

## Data-Attribute Markers (for Playwright)

Each component exposes deterministic attributes for Playwright selectors:

| Element | Attribute |
|---------|-----------|
| Page root | `data-testid="issue-detail"`, `data-issue-id={id}` |
| Issue header card | `data-issue-header={id}` |
| Comment card | `data-comment={id}`, `data-comment-author-type={user\|agent\|system}`, `data-comment-parent={parentId \| ''}` |
| Comment thread root | `data-comment-thread={rootId}` |
| Collapsed thread toggle | `data-comment-collapsed={count}` |
| Task panel | `data-task-panel={taskId \| 'idle'}`, `data-task-state={queued\|dispatched\|running\|completed\|failed\|cancelled\|idle}` |
| Task message row | `data-task-message-seq={seq}`, `data-task-message-kind={text\|thinking\|tool_use\|tool_result\|error}`, `data-task-message-truncated={true\|false}` |
| Truncation marker | `data-truncated="true"`, `data-original-bytes={N}` |
| Show-full button | `data-action="show-full"`, `data-task-id={taskId}`, `data-seq={seq}` |
| Reconnect banner | `data-reconnect-banner={reconnecting\|replaying\|caught-up}` |
| Chat composer | `data-chat-composer`, `data-disabled={true\|false}` |
| Send button | `data-action="chat-send"` |

---

## Design Tokens Summary

**New CSS variables added in Phase 24:** NONE. Phase 24 reuses Phase 23's ladder + Oxide tokens verbatim.

**New Tailwind classes used:** No new utility classes beyond Tailwind v4 defaults. All colors expressed as `text-[var(--color-info-subtle-text)]` / `border-l-[var(--color-destructive)]` patterns identical to Phase 23.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official (existing primitives) | Reuse only — card, badge, button, dropdown-menu, tooltip, scroll-area, skeleton, sonner, dialog, separator, input, popover, select | Not required — all primitives already in repo; no new `npx shadcn add` calls |
| Third-party registry | None | Not applicable — vetting gate not invoked |

**Non-registry npm deps (Wave 0 adds one):**

| Package | Version | Safety Note |
|---------|---------|-------------|
| `rehype-sanitize` | `^6.0.0` | Part of the rehype/unified ecosystem (same publishers as `rehype-highlight` and `remark-gfm` already installed). Published 2023-08, MIT, weekly downloads ~4M, widely audited. Default schema is the GitHub-safe allowlist — the only sanitizer Wave-4 XSS mitigation should use. |

Already installed (verified 2026-04-17 in `apps/web/package.json`): `react-markdown@10.1.0`, `remark-gfm@4.0.1`, `rehype-highlight@7.0.2`, `@tanstack/react-virtual@3.13.24`, `sonner@2.0.7`, plus `@dnd-kit/*` (not used on detail page but present).

**Safety gate:** Not invoked — no third-party registries declared.

---

## Security Contract (V5 Input Validation)

| Surface | Rule |
|---------|------|
| `issue.title` (header) | Plain text via React interpolation — auto-escaped |
| `issue.description` (IssueDescription) | `<SafeMarkdown>` — sanitized |
| `comment.content` (all author types) | `<SafeMarkdown>` — sanitized |
| `task_message.content` text/thinking kinds | `<SafeMarkdown>` — sanitized |
| `task_message.input` tool_use | `JSON.stringify(..., null, 2)` inside `<pre>` — text-only |
| `task_message.output` tool_result | Plain `<pre>{output}</pre>` by default — text-only |
| `task_message.error` | Plain `<span>{error}</span>` — text-only |
| Chat composer draft | Client-side `content.trim().slice(0, 8000)` before POST; server re-validates |
| Show-full response | Full content passes through same SafeMarkdown / `<pre>` path — never raw innerHTML |
| WS payloads | Trust only typed fields from `WsMessage`; every content render goes through a text or SafeMarkdown path |
| Navigation click on IssueCard | `useNavigate` call — no URL string concatenation with user input |

**Grep invariants (added to VALIDATION + CI):**
1. `! grep -r "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/` → must return 0 hits
2. `! grep -r "dangerouslySetInnerHTML" apps/web/src/pages/IssueDetailPage.tsx` → must return 0 hits
3. Every `<ReactMarkdown>` usage in `apps/web/src/components/issues/detail/**` must go through the `SafeMarkdown` wrapper (grep for raw `<ReactMarkdown` in this dir → must return 0 hits; all consumers use `<SafeMarkdown>`). Enforced by CI lint rule or simple grep test.

---

## Dimensional Summary (for checker)

| Dimension | Compliance |
|-----------|-----------|
| **Copywriting** | 70+ keys in `issues.detail.*` + `chat.*` namespaces; CTAs verb+noun ("Send", "Cancel task", "Show full"); empty states explain next step; error copy explains problem + solution; destructive confirm pattern defined for cancel-task / delete-comment; keyboard shortcut hint on composer; a11y live-region announcements itemized |
| **Visuals** | 15+ components listed with file paths + typed props; reuses Phase 23 primitives verbatim; no new shadcn primitives added; per-task-state + per-kind visual treatments tabulated |
| **Color** | 60/30/10 split defined reusing Oxide tokens; accent reserved for explicit list of 6 elements (Send CTA, composer focus, Show-full link, running-state top border, pulse fade, markdown anchor); per-task-state + per-kind accents use existing `--color-*-subtle-*` tokens; dark mode inherits from `:root.dark`; no new color tokens |
| **Typography** | 5 sizes (11/12/14/20/28) — adds 20 for H2 section headers (Phase 23 used 4); 3 weights (400/500/600); CJK override already handled in `index.css:574-580`; mono font reserved for tool JSON and markdown code blocks |
| **Spacing** | All values on 4-point grid; per-element table specifies exact px; no exceptions |
| **Registry Safety** | No new shadcn blocks added; 1 new npm dep (`rehype-sanitize` ^6.0.0) documented with audit note; no third-party registries — gate not invoked |

---

## Pre-Populated From

| Source | Decisions Used |
|--------|----------------|
| REQUIREMENTS.md | UI-04, UI-05, UI-06, UI-07, UI-08, CHAT-01 requirement text |
| ROADMAP.md | 5 Phase 24 success criteria |
| 24-VALIDATION.md | 13-row Verification Map, component scaffold paths, data-attribute markers, Wave 0 deliverables |
| PITFALLS.md §ST2 | Reconnect replay ordering invariant |
| PITFALLS.md §ST3 | Background-tab backpressure + useTransition + useDeferredValue |
| PITFALLS.md §UX6 | XSS prevention (no innerHTML) + 16 KB truncation + "Show full" affordance |
| 23-UI-SPEC.md | Design system, spacing scale, Oxide token palette, z-index ladder, typography scale, registry safety pattern, component inventory pattern, data-attribute convention |
| 23-00-SUMMARY.md | Phase 23 Wave 0 shipped: i18n parity CI, WsEventType union, `subscribe('AQ')` A1 pattern, `@tanstack/react-virtual` installed, sonner z-index |
| 17-04-SUMMARY.md | Comments service surface + `createUserComment` returns `{ comment, enqueuedTask }`, threaded by `parent_id`, system comments distinguished by `author_type='system'`, `triggerCommentId` semantics |
| 18-02-SUMMARY.md | `task_messages` batcher + monotonic seq + broadcast pattern, `(task_id, seq)` unique index for replay |
| 20-02-SUMMARY.md | Hosted driver `chat.send` translation into `task_message` rows matches `AgentMessage` union (text/thinking/tool_use/tool_result/error) |
| apps/web/package.json | Confirmed Tailwind v4 + React 19.2 + shadcn/radix + react-markdown + remark-gfm + rehype-highlight + @tanstack/react-virtual + sonner; `rehype-sanitize` NOT YET installed (Wave 0 action) |
| apps/web/src/index.css | Oxide tokens, HSL vars, `:root.dark`, `.visually-hidden`, reduced-motion rule, `:focus-visible`, z-index ladder — all reused |
| apps/web/src/components/ui/ | shadcn primitive inventory — reused verbatim |
| apps/web/src/components/issues/ | Phase 23 shipped `IssueBoard`, `IssueCard`, `IssueColumn`, `useBoardReconciler`, `useIssueBoard` — modify `IssueCard` to add onClick navigation |
| apps/web/src/context/WebSocketContext.tsx | `subscribe/unsubscribe/addHandler/removeHandler` pattern; Wave 0 adds `requestTaskReplay` + `pauseTaskStream` + `resumeTaskStream` |
| apps/web/src/App.tsx | Existing lazy-route pattern; add `/issues/:id` inside the `<AppLayout>` block |
| apps/server/src/routes/issues.ts + comments.ts | Existing REST surface — no new issue/comment routes needed; Wave 0 adds `GET /api/tasks/:id/messages?afterSeq=N` + `GET /api/tasks/:id/messages/:seq/full` + potentially `POST /api/tasks/:id/cancel` (verify Phase 18-04 shipped a cancel route — else add) |
| apps/server/src/ws/index.ts | Existing subscribe/broadcast pattern — Wave 0 extends `ws.on('message')` handler to accept `subscribe_task` + `pause_stream` + `resume_stream` inbound types |
| packages/shared/src/v14-types.ts | `TaskMessage` + `TaskMessageType` + `AgentMessage` + `AgentTask` shapes |
| packages/shared/src/types.ts | Existing `WsEventType` union — Wave 0 verifies/adds `task:message`, `task:dispatched`, `task:started`, `task:completed`, `task:failed` |
| CLAUDE.md | 6-locale i18n rule; `apps/web/src/api.ts` wrapper; no raw `fetch()`; Playwright-only E2E; ESM `.js` import extension on server |
| User input (auto mode) | All defaults inferred per `<auto_mode_defaults>` in the orchestrator prompt — no interactive questions asked |

---

## Planner Hand-Off: Recommended Wave Structure

(Non-normative — the planner may re-slice. Included here to help the planner see the natural boundaries the invariants create.)

- **Wave 0 — Foundation** (VALIDATION rows 24-00-01..04)
  - Install `rehype-sanitize`; verify React 19 peer-compat
  - Extend `WsEventType` with any missing `task:*` literals; update `packages/shared/src/types.ts`
  - Add server-side 16 KB truncation constant + logic in `task-message-store` / batcher
  - Add `GET /api/tasks/:id/messages?afterSeq=N` endpoint + `GET /api/tasks/:id/messages/:seq/full` endpoint (+ overflow storage if planner picks that route)
  - Add `subscribe_task` / `pause_stream` / `resume_stream` inbound WS handlers with buffer-replay-live ordering
  - Add `requestTaskReplay` / `pauseTaskStream` / `resumeTaskStream` methods to `WebSocketContext`
  - Scaffold `apps/web/src/components/issues/detail/` directory + 16 component stubs
  - Scaffold `tests/e2e/issue-detail.spec.ts` with 7 `test.skip(...)` scenarios matching VALIDATION row titles verbatim
  - Add `issues.detail.*` + `chat.*` i18n namespaces (en) + placeholders in 5 locales; run i18n parity script to confirm 0 drift
  - Server unit tests: `task-message-truncation.test.ts`, `task-messages-replay.test.ts`, `ws-subscribe-task.test.ts`
  - Verify: `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run build:ce -w @aquarium/web && node apps/web/scripts/check-i18n-parity.mjs && npx tsx --test apps/server/tests/unit/*.test.ts` all green

- **Wave 1 — Read-only detail page** (VALIDATION rows 24-01-01, 24-01-02)
  - `IssueDetailPage` + `IssueHeader` + `IssueDescription` + `CommentsTimeline` + `CommentThread` + `CommentCard` (markdown rendered via `SafeMarkdown`)
  - Route in `App.tsx`; `onClick` navigation on `IssueCard`
  - `useIssueDetail` hook: initial fetch + WS reconciliation for `issue:*` + `comment:*` (no task wiring yet)
  - Playwright: un-skip `issue detail renders` + `threaded comments`

- **Wave 2 — Live task stream** (VALIDATION rows 24-02-01, 24-02-02)
  - `TaskPanel` + `TaskStateBadge` + `TaskMessageList` (virtualized) + `TaskMessageItem` with kind dispatchers
  - `useTaskStream` hook: initial history fetch + `subscribe_task` + handle `task:message` events + `useTransition` + `useDeferredValue`
  - Visibility handler: `pause_stream` / resume with `subscribe_task` replay
  - Playwright: un-skip `task stream live` + `background tab recovery` (CI-skipped; manual-only)

- **Wave 3 — Reconnect replay** (VALIDATION rows 24-03-01, 24-03-02)
  - Server-side buffer-replay-live ordering invariant (ST2)
  - Client-side `lastSeqRef` + reconnect → re-subscribe + dedupe on write
  - Playwright: un-skip `reconnect replay` + `replay no reorder`

- **Wave 4 — XSS + truncation hardening** (VALIDATION rows 24-04-01, 24-04-02)
  - `SafeMarkdown` wrapper — enforce across all rendering paths
  - `TruncationMarker` component + server `/full` endpoint wiring
  - Grep guard: `! grep -r "dangerouslySetInnerHTML" apps/web/src/components/issues/detail/` added to CI
  - Playwright: un-skip `truncation marker` + (optional) `xss hardening` scenario

- **Wave 5 — Chat on issue** (VALIDATION row 24-05-01)
  - `ChatComposer` + integration with `POST /api/issues/:id/comments` → `{ comment, enqueuedTask }`
  - Server: implement `createAgentComment` + completion callback that posts threaded reply via `parent_id`
  - Playwright: un-skip `chat on issue`

- **Wave 6 — i18n polish** (VALIDATION row 24-06-01)
  - Translate `issues.detail.*` + `chat.*` across zh/fr/de/es/it
  - `node apps/web/scripts/check-i18n-parity.mjs` exits 0
  - Playwright: confirm all prior scenarios still green in a non-en locale (smoke)

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

## UI-SPEC COMPLETE
