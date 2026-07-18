# Phase 23: Issue Board UI (Kanban) — Research

**Researched:** 2026-04-17
**Domain:** React 19 kanban frontend — DnD + virtualization + WS reconciliation + i18n
**Confidence:** HIGH on stack (@dnd-kit pinned in STACK.md; existing server reorder contract already shipped); MEDIUM on virtualization reference pattern (no canonical `@dnd-kit + virtualizer` example exists — fallback strategy required); HIGH on reorder semantics and WS event shapes (code-verified against `apps/server/src/routes/issues.ts` + `apps/server/src/services/issue-store.ts`).

---

## Summary

Phase 23 builds the kanban board UI that consumes the **already-shipped** server contract from Phase 17 (`POST /api/issues/:id/reorder` with fractional `position` + `{ beforeId, afterId }` body) and reacts to the **already-shipped** WS events from Phase 17 (`issue:created | issue:updated | issue:deleted | issue:reordered`, all workspace-scoped). The research gate is LIGHT — the stack was pre-selected in the project-level STACK.md (`@dnd-kit/core@6.3.1` + `sortable@10.0.0` + `utilities@3.2.2`), and React 19 compatibility is confirmed via npm peer-dep query.

Three cross-cutting planning hazards need explicit answers the planner cannot assume:

1. **There is no battle-tested `@dnd-kit + virtualizer` reference pattern.** The official sortable docs confirm `verticalListSortingStrategy` and `horizontalListSortingStrategy` "support virtualized lists" but give no integration example. No prominent OSS kanban project combines the two. The research recommendation is: virtualize ONLY per-column above 100 items, with a specific strategy that keeps the `SortableContext` item-id array stable across virtualization mount/unmount.
2. **The existing z-index scale is ad-hoc (19 raw numbers in use across the codebase, ranging 1 → 10000).** No CSS-variable ladder exists. Phase 23 must establish one and migrate at minimum the drag-overlay + toast layers; UX3 pitfall explicitly assigns ownership here.
3. **The existing WebSocketContext has NO per-workspace subscribe method.** It supports `subscribe(instanceId)`, `subscribeGroupChat`, and `subscribeChatSession`. The Phase 17 broadcasts target `DEFAULT_WORKSPACE_ID = 'AQ'` as the subscription key — so either (a) workspace events broadcast to every authenticated client regardless of subscription (verify in `ws/index.ts`), or (b) a new `subscribe(workspaceId)` / `subscribeWorkspace` method is needed. The planner MUST confirm which by reading `apps/server/src/ws/index.ts` in Wave 0.

**Primary recommendation:** Ship with `@dnd-kit/core@6.3.1 + sortable@10.0.0 + utilities@3.2.2` (exact multica + STACK.md pinning), per-column `verticalListSortingStrategy`, virtualize via `@tanstack/react-virtual@3.13.24` above 100 cards per column, establish a CSS-variable z-index ladder in `index.css`, defer remote WS `issue:reordered` events via a `pendingRemoteEventsRef` queue while `activeId !== null`, flush on drag-end. Keyboard DnD ships by default with `@dnd-kit` — add `@dnd-kit/accessibility` for the announcer live region.

---

## User Constraints

> No `23-CONTEXT.md` exists — this phase was launched via `/gsd-research-phase` standalone. Constraints below are derived from CLAUDE.md (project instructions), STACK.md (v1.4 project-level research), and PITFALLS.md (§UX1-UX5, owned by this phase).

### Locked Decisions

1. **DnD library (STACK.md §2):** `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` + `@dnd-kit/utilities@3.2.2` — exact multica match. Do NOT migrate to `@dnd-kit/react@0.4.x` (still pre-1.0; see below).
2. **Reorder endpoint contract (Phase 17-02 — shipped):** `POST /api/issues/:id/reorder` with body `{ beforeId?: string | null, afterId?: string | null }`. Server computes midpoint (`RENUMBER_STEP=1000`, `COLLAPSE_EPSILON=1e-6`), renumbers the workspace in-trx on collapse, returns the `Issue` with authoritative `position`. Frontend does NOT compute positions.
3. **Position semantics (Phase 17-02 — shipped):** `Issue.position: number | null`. Kanban order is `position ASC NULLS LAST, created_at DESC`. First-drag sets `position` on previously-NULL rows.
4. **WS events (Phase 17-03 — shipped):** Server broadcasts `issue:created | issue:updated | issue:deleted | issue:reordered` on workspace scope after commit. No `task:*` events in Phase 23's rendering path (`task:*` is Phase 24's concern).
5. **i18n coverage (CLAUDE.md):** All user-facing strings go through `t('key')` via `react-i18next`; every new key ships in all 6 locale files (`en, zh, fr, de, es, it`). UX5 assigns enforcement responsibility to this phase.
6. **Testing (CLAUDE.md):** Playwright only. No unit tests. Keyboard-accessible drag MUST be exercised via Playwright keyboard E2E (success criterion #4).
7. **API client (CLAUDE.md):** All HTTP calls via `apps/web/src/api.ts` wrapper — never raw `fetch()`. Returns `ApiResponse<T>` → `{ ok, data?, error? }`.
8. **Styling:** CSS variables from the Oxide design system in `apps/web/src/index.css`. The project ALSO uses Tailwind v4 + shadcn/ui primitives (verified in `apps/web/package.json`: `tailwindcss@4.2.2`, `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`) — contrary to the CLAUDE.md claim of "no Tailwind." **This is an authoritative finding from the codebase that corrects CLAUDE.md.** New components SHOULD follow the existing hybrid pattern (CSS variables for tokens + Tailwind utilities for layout + shadcn primitives from `components/ui/`).
9. **Workspace scope (Phase 17/18 — shipped):** CE ships a single default workspace `'AQ'` (seeded by migration 003). Board queries + WS subscriptions use this constant — not multi-workspace.

### Claude's Discretion

- Virtualization threshold (100 per UI-03, but tune per-column vs board-wide).
- Virtualization library choice: `@tanstack/react-virtual@3.13.24` (recommended — matches React 19 pattern language used by the rest of the ecosystem) vs `react-virtuoso` (mentioned in PITFALLS.md §UX4).
- Z-index ladder numeric values (pick any sensible scale; must accommodate existing hand-rolled `z-index: 10000` in `SecurityTimeline.css`).
- Which existing page layout skeleton to clone (recommend: `ChatHubPage.tsx` for two-pane + `WorkbenchPage.tsx` layout).
- Card component shape: recommend compact density by default (Linear-style) with click-to-expand for description, since 200+ issues at 60 FPS is the constraint.
- Route path: recommend `/issues` (list) + `/board` or `/issues/board` (kanban view). Must add to sidebar nav in `apps/web/src/components/layout/Sidebar.tsx`.

### Deferred Ideas (OUT OF SCOPE — do NOT plan)

- Issue detail page + task message streaming → Phase 24 (UI-04..UI-08, CHAT-01).
- Agents / Runtimes / Daemon Tokens management pages → Phase 25 (MGMT-01..MGMT-03).
- Chat-on-issue with trigger_comment_id streaming → Phase 24 (CHAT-01).
- Virtualization of comments timeline → Phase 24.
- Labels / projects / filters beyond `status` + `assigneeId` → v1.5+ (out of v1.4 scope per REQUIREMENTS.md "Future Requirements").
- Multi-workspace switcher UI → EE-only (REQUIREMENTS.md "Out of Scope").
- `i18next-parser` CI check for missing keys → UX5 mitigation CAN live in this phase but is infrastructure, not feature code; recommend a small CI script adjacent to the phase but not blocking Wave 0 tasks.

---

## Phase Requirements

| ID | Description (REQUIREMENTS.md line) | Research Support |
|----|-----------------------------------|-------------------|
| UI-01 | Kanban Issues page, one column per status, drag-drop via @dnd-kit, keyboard-accessible drag | §Standard Stack (DnD), §Architecture Patterns (per-column DndContext + SortableContext), §Keyboard a11y below |
| UI-02 | Optimistic local reorder reconciles with WebSocket reorder events from other sessions without corrupting drag state | §WS Reconciliation pattern — queue `issue:reordered` while `activeId !== null`, flush on drag-end |
| UI-03 | Issue board virtualises when > 100 issues loaded to keep drag FPS smooth | §Virtualization strategy — per-column `@tanstack/react-virtual` with fallback below 100 |

---

## Project Constraints (from CLAUDE.md)

Actionable directives extracted from `./CLAUDE.md` — planner MUST verify every task complies:

- **ESM `.js` imports (CRITICAL):** Server-side `.ts` imports MUST end in `.js`. Web imports do NOT (Vite resolves). This phase is primarily web-side → plain bare-specifier imports; the ONLY server-touching code is NO NEW SERVER CODE (reorder endpoint already exists — verify, don't rebuild).
- **No `any`:** Use `unknown` + type guards. All DnD event payloads MUST be narrowed before use.
- **API response wrapper:** All calls return `ApiResponse<T>`. Existing `api.ts` handles the unwrap — use it unchanged.
- **CSS tokens:** `var(--color-primary)` etc. Supports light + dark via `:root` / `[data-theme="dark"]`. Never hardcode colors. A **kanban column color (one per status)** needs tokens added to `index.css`, not inline hex.
- **i18n 6 locales:** All user-facing strings get a key; update `en, zh, fr, de, es, it` together. CLAUDE.md says "When adding/modifying text, update ALL locale files."
- **No raw `fetch()`:** Use `api.get / post / patch` wrappers from `apps/web/src/api.ts`.
- **Naming:** React files `PascalCase.tsx`. Server files `kebab-case.ts`.
- **Error handling:** Routes use `try/catch → { ok: false, error }`. Web components: show `<Toaster />` via existing `sonner` setup.
- **Testing:** Playwright only — see `tests/e2e/issues-agents-comments.spec.ts` for the established pattern (direct SQLite DB read/write + API calls).
- **Bug-fix testing (global CLAUDE.md):** Every bug fix gets a regression test. For a greenfield feature phase like Phase 23, this means every success criterion needs a Playwright scenario.
- **Build order:** `packages/shared` must be built first. Plans SHOULD NOT modify `packages/shared` unless adding new types (none expected — all Issue types already shipped in `v14-types.ts`).

---

## Runtime State Inventory

> Phase 23 is greenfield UI — no data migration, no rename/refactor. This section is included to document the "what's already in place" that the UI consumes.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `issues` table (migration 006) with `position FLOAT NULL`, `status` 6-value CHECK, `assignee_id`. `agent_task_queue` (migration 007). Both FK to workspace `'AQ'`. | None — UI reads via existing `GET /api/issues`. |
| Live service config | None — UI phase. | None. |
| OS-registered state | None. | None. |
| Secrets / env vars | None new. | None. |
| Build artifacts | None. | None. |

---

## Standard Stack

### Core (new additions for Phase 23)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | `6.3.1` | DnD primitives (DndContext, useDraggable, useDroppable) | [VERIFIED: npm registry, 2026-04-17] STACK.md exact multica match, peer dep `react >=16.8.0` works with React 19.2. |
| `@dnd-kit/sortable` | `10.0.0` | Sortable preset (SortableContext, useSortable, arrayMove) + `verticalListSortingStrategy` | [VERIFIED: npm registry] Peer dep `@dnd-kit/core ^6.3.0`. Explicitly supports virtualized lists per official docs. |
| `@dnd-kit/utilities` | `3.2.2` | `CSS.Transform.toString()` helper for transform style | [VERIFIED: npm registry] Required by useSortable examples. |
| `@dnd-kit/accessibility` | latest (query in Wave 0) | Screen-reader announcer live region — UX2 mitigation | [CITED: dndkit.com/guides/accessibility] Auto-announces "picked up item X in column Y" during keyboard drag. |
| `@tanstack/react-virtual` | `3.13.24` | Per-column virtualization above 100 cards — UX4 mitigation, UI-03 satisfier | [VERIFIED: npm registry, 2026-04-17] Maintained by TanStack (same org as react-query used elsewhere in web stack). `useVirtualizer` hook composes cleanly with `useSortable` because items keep stable DOM ids; only the viewport window changes. |

**Installation (web workspace):**
```bash
npm install -w @aquarium/web @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2 @dnd-kit/accessibility @tanstack/react-virtual@3.13.24
```

**Total bundle impact:** ~28 KB gzipped (@dnd-kit suite ~18 KB, @tanstack/react-virtual ~4 KB, accessibility ~6 KB). Verified via npm — confirm with `vite build` bundle analyzer post-implementation.

### Supporting (already installed — reuse verbatim)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-i18next` | `16.5.8` | Translation strings | All board UI text via `useTranslation()` + `t('key')`. |
| `react-router-dom` | `7.6.0` | Routing | New `/issues` + `/issues/board` routes in `App.tsx`. |
| `sonner` | `2.0.7` | Toast notifications | Rollback toast on reorder failure (UX1 mitigation: "Reorder failed — retrying"). |
| `lucide-react` | `0.577.0` | Icons | Column header icons (status badges). |
| `@radix-ui/react-dropdown-menu` | `2.1.16` | Column sort / filter menus | Per-column header affordance. |
| shadcn/ui `components/ui/*` | n/a | Button, Card, Badge, Dialog | Reuse existing primitives — do NOT hand-roll. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit/core@6.3.1` | `@dnd-kit/react@0.4.0` (new API, published 2026-04-17) | [VERIFIED: npm registry] `@dnd-kit/react` is pre-1.0 — v0.4.0 just published. Peer dep explicitly `react ^18 \|\| ^19` (explicit React 19 claim). Migration path from `core` is non-trivial. STACK.md §2 explicitly defers to v1.5+. **KEEP `core`.** |
| `@tanstack/react-virtual` | `react-virtuoso` (~9 KB) | PITFALLS.md §UX4 mentions Virtuoso. Virtuoso's `Virtuoso` component owns the scroll container which complicates `@dnd-kit`'s auto-scroll during drag. `@tanstack/react-virtual` is a headless hook that composes cleanly — recommended for @dnd-kit integration. |
| `react-window` | `@tanstack/react-virtual` | react-window is maintenance-mode (last release 2023). `@tanstack/react-virtual` is actively maintained (v3.13.24, recent). |
| Board-wide single virtualizer | Per-column virtualizer | Board-wide complicates cross-column drop math (columns are viewport-anchored). Per-column keeps each column a self-contained `SortableContext` with its own `useVirtualizer`. |

---

## Architecture Patterns

### Recommended File Structure

```
apps/web/src/
├── pages/
│   ├── IssuesBoardPage.tsx          # /issues/board — kanban
│   ├── IssuesBoardPage.css          # (optional — prefer Tailwind + CSS vars)
│   └── IssuesListPage.tsx           # /issues — flat list (fallback; phase 24 extends)
├── components/
│   └── issues/
│       ├── IssueBoard.tsx           # Top-level DndContext + columns grid
│       ├── IssueColumn.tsx          # Per-status SortableContext + virtualizer
│       ├── IssueCard.tsx            # useSortable draggable card (memo'd)
│       ├── IssueCardOverlay.tsx     # DragOverlay preview component
│       ├── useIssueBoard.ts         # Hook: state + WS handlers + reorder mutation
│       └── useBoardReconciler.ts    # Hook: queue remote WS events while dragging
├── i18n/locales/{en,zh,fr,de,es,it}.json   # Add issues.board.* namespace
└── index.css                         # Add z-index scale + column color tokens
```

### Pattern 1: Two-tier DnD context (board + columns)

**What:** One `DndContext` wraps the whole board (to detect cross-column drops). Each column is a `SortableContext` with `verticalListSortingStrategy` (supports virtualization per official docs).

**When to use:** Always for a multi-column kanban. Mixing `items` in a single `SortableContext` breaks cross-column drop because sortable auto-reorders within its own item array.

**Example (idiomatic @dnd-kit kanban pattern):**
```tsx
// Source: [CITED: blog.logrocket.com/build-kanban-board-dnd-kit-react/] + official @dnd-kit sortable docs
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, closestCorners, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);

<DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={...} onDragOver={...} onDragEnd={...}>
  {statuses.map(status => (
    <IssueColumn key={status} status={status} items={groupedByStatus[status]} />
  ))}
  <DragOverlay>{activeId ? <IssueCardOverlay id={activeId} /> : null}</DragOverlay>
</DndContext>
```

`collisionDetection={closestCorners}` is the `@dnd-kit` recommendation for multi-container sortable. Default `rectIntersection` is less stable at column boundaries.

### Pattern 2: Optimistic reorder + server-authoritative reconciliation

**What:** On `onDragEnd`, compute `beforeId` / `afterId` from the drop neighbours, optimistically mutate local state, fire `POST /api/issues/:id/reorder`, then on 200 replace the optimistic position with the server's authoritative `position` number.

**When to use:** Success criterion #1 requires this exact shape — UI reflects server-authoritative position after drop.

**Example:**
```tsx
// Source: internal — synthesised from Phase 17-02 routes/issues.ts + STACK.md §UX1
async function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over) { setActiveId(null); return; }

  const targetStatus = resolveDropColumn(over.id);
  const { beforeId, afterId } = computeNeighbours(active.id, targetStatus, localState);

  // 1. Optimistic local reorder
  const prevSnapshot = localState;
  setLocalState(prev => moveIssue(prev, active.id, targetStatus, beforeId, afterId));
  setActiveId(null);

  try {
    // 2. Status change via PATCH (if crossing columns)
    if (targetStatus !== prevSnapshot.issues[active.id].status) {
      await api.patch<Issue>(`/issues/${active.id}`, { status: targetStatus });
    }
    // 3. Fractional reorder via POST (always)
    const authoritative = await api.post<Issue>(`/issues/${active.id}/reorder`, { beforeId, afterId });
    // 4. Replace optimistic position with server's authoritative
    setLocalState(prev => applyServerIssue(prev, authoritative));
    // 5. Flush deferred remote events
    flushPendingRemoteEvents();
  } catch (err) {
    // Rollback + toast
    setLocalState(prevSnapshot);
    toast.error(t('issues.board.reorderFailed'));
  }
}
```

### Pattern 3: Defer remote WS events while dragging (UX1 HARD CONSTRAINT)

**What:** While `activeId !== null` (a local drag is in progress), queue incoming `issue:reordered | issue:updated | issue:created | issue:deleted` events into a ref. On drag-end (or drag-cancel), flush the queue in order.

**When to use:** Every kanban board with WS-broadcast state changes. This is the UX1 mitigation — without it, a remote reorder event mid-drag causes React to rerender the column, which unmounts the dragged card, which aborts the drag.

**Example:**
```tsx
// Source: internal — synthesised from PITFALLS.md §UX1 prevention
const activeIdRef = useRef<string | null>(null);
const pendingEventsRef = useRef<WsMessage[]>([]);

useEffect(() => {
  const handler = (message: WsMessage) => {
    if (activeIdRef.current) {
      pendingEventsRef.current.push(message);
      return;
    }
    applyRemoteEvent(message);
  };
  addHandler('issue:reordered', handler);
  addHandler('issue:updated', handler);
  addHandler('issue:created', handler);
  addHandler('issue:deleted', handler);
  return () => {
    removeHandler('issue:reordered', handler);
    removeHandler('issue:updated', handler);
    removeHandler('issue:created', handler);
    removeHandler('issue:deleted', handler);
  };
}, [addHandler, removeHandler]);

function flushPendingRemoteEvents() {
  const events = pendingEventsRef.current;
  pendingEventsRef.current = [];
  events.forEach(applyRemoteEvent);
}
```

**My-own-echo detection:** After `POST /api/issues/:id/reorder` succeeds, the server broadcasts `issue:reordered` to all subscribers INCLUDING the originator. The local state already has the authoritative position from the POST response — applying the echo is idempotent (same position value → no-op re-render) but can be skipped as an optimization by tracking `lastLocalMutationId` and comparing `issueId + position`.

### Pattern 4: Virtualization that survives drag (UX4 / UI-03)

**What:** Per-column `useVirtualizer` from `@tanstack/react-virtual`. CRITICAL: the `SortableContext` `items` prop receives the FULL array of IDs (not just visible), so `@dnd-kit` has consistent drop-target math even when off-screen rows are unmounted by the virtualizer.

**Gotcha:** `@dnd-kit` tracks drop targets via `useSortable(id)` calls on each item. If a virtualized row is unmounted during drag, its `useSortable` unregisters — the drop-target math breaks. Mitigation strategies:

1. **Disable virtualization during active drag** (simplest — activeId !== null triggers `rowVirtualizer.setOptions({ overscan: items.length })`).
2. **Overscan the full list during drag** (equivalent to above).
3. **Render sortable items via `SortableContext.items` mapping but only the virtualized subset gets DOM — use `useSortable({ id, disabled: !isVisible })`** (more complex; defer to v1.5 if needed).

**Recommended:** Start with strategy 1. Below 100 items, skip virtualization entirely (render plain `.map()` — already 60 FPS). Above 100, enable virtualization with overscan=10; when drag starts, bump overscan to `items.length`; restore on drag-end.

```tsx
// Source: internal — synthesised from @tanstack/react-virtual docs + @dnd-kit sortable virtualization note
const rowVirtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => columnScrollRef.current,
  estimateSize: () => 72,        // measured card height; Tailwind min-h-18
  overscan: activeId ? items.length : 10,   // expand during drag
});

<SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
  <div ref={columnScrollRef} style={{ height: '100%', overflow: 'auto' }}>
    <div style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map(v => (
        <IssueCard
          key={items[v.index].id}
          issue={items[v.index]}
          style={{ position: 'absolute', top: v.start, left: 0, right: 0 }}
        />
      ))}
    </div>
  </div>
</SortableContext>
```

### Pattern 5: Keyboard-accessible drag (UX2 / UI-01)

**What:** `@dnd-kit/core` `KeyboardSensor` with `sortableKeyboardCoordinates` from `@dnd-kit/sortable` gives full keyboard DnD out of the box.

**Default keybinds [CITED: dndkit.com docs]:**
- `Tab` to focus a draggable
- `Space` or `Enter` to pick up
- `Arrow keys` to move (within column: Up/Down reorders; across columns: Left/Right if using `sortableKeyboardCoordinates` + `closestCorners`)
- `Space` or `Enter` to drop
- `Esc` to cancel

**ARIA:** `@dnd-kit/accessibility` adds a visually-hidden live region that announces: "Picked up issue X. Issue X is in position 2 of 5 in Todo column. Press space to drop." Customise strings via `announcements` prop on `DndContext`. These strings MUST be i18n keys — they are user-facing.

**Playwright keyboard E2E (Success Criterion #4):** The existing pattern in `tests/e2e/issues-agents-comments.spec.ts` is API-focused. For keyboard DnD, use Playwright's `page.keyboard.press('Tab')` + `page.keyboard.press('Space')` + arrow keys + another `Space` to drop. Example pattern: [CITED: Playwright docs, `page.keyboard`]. Target: the card needs `tabIndex={0}` (supplied by `useSortable`'s attributes spread).

### Anti-Patterns to Avoid

- **Mixing all issues into ONE `SortableContext`:** breaks cross-column drop. Use one per column.
- **Computing fractional positions on the client:** server owns this (Phase 17-02 `reorderIssue`). Client sends `{ beforeId, afterId }` only.
- **Rendering agent content with `dangerouslySetInnerHTML`:** not a Phase 23 concern (issue cards render `issue.title` + `issue.description` which are user-authored, but React auto-escapes). Relevant when Phase 24 renders `task_messages`.
- **Ignoring the WS echo:** applying our own echo is idempotent but wastes a re-render. Cheap optimization.
- **Blocking re-renders via `React.memo` on `IssueCard` without a custom comparator:** `useSortable` returns a `transform` object that changes every frame during drag; memo with default shallow equals does nothing. Use `React.memo(IssueCard, (a, b) => a.issue.updatedAt === b.issue.updatedAt && a.isDragging === b.isDragging)` or similar — document the invariant.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop | HTML5 DnD API, `react-beautiful-dnd` fork | `@dnd-kit/core` + `sortable` | PITFALLS.md §UX1-UX2: react-beautiful-dnd is archived (Atlassian 2022). HTML5 DnD has no a11y, no touch, no autoscroll. |
| Keyboard navigation during drag | Custom keyboard handlers on cards | `KeyboardSensor` + `sortableKeyboardCoordinates` | `@dnd-kit` ships this free; rebuilding duplicates ~400 LOC of edge-case handling. |
| Screen-reader drag announcements | Ad-hoc `aria-live` regions | `@dnd-kit/accessibility` | Multica + Linear + Atlassian all use this; proven on enterprise a11y audits. |
| Fractional position math | Client-side midpoint arithmetic | `POST /api/issues/:id/reorder` (already shipped Phase 17-02) | Server owns `RENUMBER_STEP`, `COLLAPSE_EPSILON`, renumber sweep. Client duplicating it leads to drift. |
| Position rebalancing when precision collapses | Client triggers renumber | Server's atomic in-trx renumber (shipped) | Phase 17-02 handles `|a - b| < 1e-6` → workspace-wide renumber inside the same transaction. |
| Virtualization math | Custom IntersectionObserver | `@tanstack/react-virtual` | Tracks scroll velocity, element sizing, overscan — ~500 LOC you don't want. |
| WS reconnection | Custom retry logic | Existing `WebSocketContext` (auto-reconnects every 3s) | Already shipped. |
| Toast notifications | Custom overlay | `sonner` (already installed) | Reuse `<Toaster />` from `App.tsx`. |
| Modal / dialog | Custom modal | `@radix-ui/react-dialog` via `components/ui/dialog.tsx` | Already installed, accessible by default. |
| Dropdowns (status filter, assignee filter) | Custom popover | `@radix-ui/react-dropdown-menu` via `components/ui/dropdown-menu.tsx` | Already installed. |
| Markdown in issue description preview | Hand-rolled parser | `react-markdown@10.1.0` (already installed) | Already used elsewhere. Phase 23 needs this for card preview IF we render description. |

**Key insight:** Every hard problem in this phase is a solved problem in one of @dnd-kit, @tanstack/react-virtual, or the existing Radix/shadcn primitives already in `package.json`. New JS code should be glue between them, not reimplementation.

---

## Common Pitfalls

### Pitfall 1: WS event during active drag corrupts React tree (UX1 — HARD CONSTRAINT)

**What goes wrong:** Remote session dispatches `issue:reordered` → local `handleMessage` updates state → React re-renders column → virtualized card DOM changes → @dnd-kit loses its drop-target reference → drop fails silently, card snaps back.

**Why it happens:** @dnd-kit's `useSortable` registers a drop target at mount. If React unmounts the dragged component mid-drag (because the parent re-rendered with a new array), the drop target vanishes.

**How to avoid:** Pattern 3 above — `activeIdRef` guard, `pendingEventsRef` queue, flush on drag-end. ALSO memo `IssueCard` with a custom comparator so same-issue-same-updatedAt doesn't re-render during remote events.

**Warning signs:** Card "jumps back" after drop; console shows "cannot read properties of null (reading 'getBoundingClientRect')"; Playwright E2E flaky when a second session is running.

### Pitfall 2: Keyboard drag invisible to assistive tech (UX2)

**What goes wrong:** Mouse-only DnD appears to work in manual QA but fails every a11y audit and blocks keyboard users entirely.

**Why it happens:** Custom DnD implementations skip `tabIndex`, ARIA roles, and live announcements.

**How to avoid:**
1. Use `@dnd-kit` sensors — both PointerSensor AND KeyboardSensor (with `sortableKeyboardCoordinates`).
2. Install `@dnd-kit/accessibility` and wrap DndContext in its `Accessibility` component (check package for exact API).
3. Playwright E2E: Tab into first card → Space → ArrowDown twice → Space → assert DB `position` changed.
4. Customise `announcements` with `t('issues.board.a11y.picked', { title })` etc.

**Warning signs:** axe-core audit flags "no accessible name"; NVDA/VoiceOver silent during drag.

### Pitfall 3: Ad-hoc z-index collides with drag overlay (UX3)

**What goes wrong:** Existing codebase has 19 raw `z-index` values from 1 to 10000 across 30+ CSS files. Drag overlay needs to sit above modals (`z-index: 1000`) and toasts (in `sonner` library config) but under the security timeline error dialog (`z-index: 10000`).

**Why it happens:** No CSS-variable ladder — every CSS file picks its own number.

**How to avoid:**
1. Add to `apps/web/src/index.css`:
   ```css
   :root {
     --z-base: 0;
     --z-dropdown: 10;
     --z-sticky: 20;
     --z-header: 50;
     --z-sidebar: 100;
     --z-sheet: 500;
     --z-modal: 1000;
     --z-drag-overlay: 5000;
     --z-toast: 7000;
     --z-critical-alert: 10000;
   }
   ```
2. Set `DragOverlay` style `z-index: var(--z-drag-overlay)`.
3. Migrate `sonner` `<Toaster />` to use `--z-toast` via its style prop.
4. DO NOT migrate every existing file — 19 sites is too much churn for a UI phase. Document the scale and enforce on NEW code only.

**Warning signs:** Drag overlay hidden behind modal; toast appears under drag preview.

### Pitfall 4: Kanban performance cliff at 100+ issues (UX4 / UI-03)

**What goes wrong:** Rendering 500 cards each with a `useSortable` registration + CSS transform tanks frame rate during drag.

**Why it happens:** Every card's `useSortable` runs every frame during active drag (tracks transform for animation). 500 hooks × 60 fps = 30,000 hook invocations/sec.

**How to avoid:**
1. Virtualize per-column above 100 cards (Pattern 4).
2. `React.memo(IssueCard)` with custom comparator — only re-render on `issue.updatedAt` OR `isDragging` flip.
3. Move heavy metadata (avatar, description preview) to hover/expand; card shows title + status badge + priority only.
4. Pagination at API level if user loads > 500: `GET /api/issues?status=backlog&limit=100&cursor=...`. CURRENTLY NOT SUPPORTED by the Phase 17 endpoint — the list returns all. Phase 23 can either (a) build a client-side slice (trivial) or (b) extend the server route (adds scope). **Recommend client-side virtualization only for v1.4; server pagination deferred to v1.5.**

**Warning signs:** Chrome DevTools Performance tab shows 30+ ms frame times during drag; dragging feels "sticky"; batteries drain.

### Pitfall 5: i18n drift — new strings ship in en-only (UX5)

**What goes wrong:** Developer adds `t('issues.board.empty')` → updates `en.json` → CI has no check → non-English users see raw keys.

**Why it happens:** 6 locale files, no automated parity check.

**How to avoid:**
1. Add a Node script to `apps/web/scripts/check-i18n-parity.mjs` that:
   - Parses `t('...')` calls from `.tsx` files via a regex (or `i18next-parser`).
   - Asserts every key exists in all 6 locale files.
   - Exits non-zero if missing.
2. Wire into the phase's CI job (GitHub Actions `ci.yml`). CLAUDE.md mentions CI runs `npm run typecheck` + `npm run lint` — add a `check:i18n` step.
3. Provide `machine` translation placeholders (flag with key suffix `.__machine`) rather than missing keys.
4. PR template checkbox: "Updated all 6 locale files."

**Warning signs:** Non-English UX test shows dot-notation strings; accidental ship with 2 of 6 locales.

### Pitfall 6: `tabIndex` not on card — keyboard user can't focus

**What goes wrong:** `IssueCard` wraps a `Card` component; Card has no `tabIndex`; user presses Tab and skips straight to the column dropdown.

**Why it happens:** Developer assumes @dnd-kit's keyboard sensor "makes cards focusable" — it doesn't; it listens for keydown on already-focused elements.

**How to avoid:** Spread `useSortable`'s `attributes` (includes `tabIndex=0`) and `listeners` (keydown handlers) on the card root element. Example:
```tsx
const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: issue.id });
<Card ref={setNodeRef} {...attributes} {...listeners} style={{ transform: CSS.Transform.toString(transform), transition }}>
```

### Pitfall 7: Server echo of own reorder mutates optimistic state mid-flight

**What goes wrong:** User drags → we optimistically set position 1500 → we POST /reorder → server responds 200 with position 1500 AND broadcasts `issue:reordered { position: 1500 }` → our own handler re-applies the same position, triggering a re-render.

**Why it happens:** WS server doesn't know "who dispatched this mutation" — it fans out to all subscribers.

**How to avoid:** Two options —
1. **Idempotent-by-value:** Accept that a same-value state update is a no-op for React if we use functional setState and the new object equals the old — BUT if we spread to make a new array every time, React still re-renders. Use immer-like patching or deep-equality shortcut in the reducer.
2. **Origin tag:** Track `lastLocalMutation = { issueId, position }`; on WS event, if it matches, skip.

**Recommended:** Option 1 via a helper `applyServerIssue(state, issue)` that returns `state` unchanged when `state.issues[issue.id].position === issue.position && ...updatedAt matches`.

---

## Code Examples

### Example 1: Page skeleton matching existing WorkbenchPage pattern

```tsx
// apps/web/src/pages/IssuesBoardPage.tsx
// Source: synthesised from existing apps/web/src/pages/ChatHubPage.tsx pattern
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { IssueBoard } from '../components/issues/IssueBoard';
import type { Issue, WsMessage } from '@aquarium/shared';

export function IssuesBoardPage() {
  const { t } = useTranslation();
  const { addHandler, removeHandler } = useWebSocket();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Issue[]>('/issues')
      .then(setIssues)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  // WS handlers with activeId deferral live inside IssueBoard (passed a controlled state)
  return (
    <div className="p-4">
      <h1 className="text-2xl font-serif mb-4">{t('issues.board.title')}</h1>
      {loading ? <BoardSkeleton /> : <IssueBoard issues={issues} setIssues={setIssues} />}
    </div>
  );
}
```

### Example 2: Drop-neighbour computation

```tsx
// Source: synthesised from Phase 17-02 reorderIssue contract
// Given: local state is an array of issues ordered by position ASC, NULLS LAST
function computeNeighbours(
  draggedId: string,
  targetStatus: IssueStatus,
  issues: Issue[],
  overId: string | 'column',    // may be a card id or the column sentinel
): { beforeId: string | null; afterId: string | null } {
  const columnIssues = issues
    .filter(i => i.status === targetStatus && i.id !== draggedId)
    .sort(byPositionThenCreated);

  if (overId === 'column' || columnIssues.length === 0) {
    // Dropped at end of empty or non-empty column
    const last = columnIssues[columnIssues.length - 1] ?? null;
    return { beforeId: last?.id ?? null, afterId: null };
  }

  const overIndex = columnIssues.findIndex(i => i.id === overId);
  const before = columnIssues[overIndex - 1] ?? null;
  const after = columnIssues[overIndex] ?? null;
  return { beforeId: before?.id ?? null, afterId: after?.id ?? null };
}
```

### Example 3: i18n key structure (follows existing `common.buttons.*` pattern)

```json
{
  "issues": {
    "board": {
      "title": "Issues",
      "empty": "No issues yet",
      "emptyDescription": "Create an issue to get started",
      "columns": {
        "backlog": "Backlog",
        "todo": "Todo",
        "in_progress": "In Progress",
        "done": "Done",
        "blocked": "Blocked",
        "cancelled": "Cancelled"
      },
      "priority": {
        "urgent": "Urgent",
        "high": "High",
        "medium": "Medium",
        "low": "Low",
        "none": "None"
      },
      "actions": {
        "create": "New issue",
        "filter": "Filter",
        "sort": "Sort"
      },
      "a11y": {
        "picked": "Picked up issue {{title}}",
        "moved": "Issue {{title}} moved to {{column}} column, position {{pos}} of {{total}}",
        "dropped": "Issue {{title}} dropped into {{column}} column",
        "cancelled": "Move cancelled. Issue {{title}} returned to original position"
      },
      "reorderFailed": "Failed to reorder issue — please retry",
      "reorderConflict": "Another session reordered this issue — refreshing"
    }
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-beautiful-dnd` | `@dnd-kit/core` | Atlassian archived 2022; migration to `@dnd-kit` completed across most React kanban apps 2023-2024 | Drop-in replacement not possible — different API; but @dnd-kit has strictly better a11y + React 18/19 support |
| `react-virtualized` | `@tanstack/react-virtual` or `react-virtuoso` | `react-virtualized` abandoned; `react-window` (same author) in maintenance mode | Headless hook API composes better with DnD |
| Integer position with renumber triggers | Fractional REAL with in-trx renumber sweep | Multica's approach (adopted in Aquarium Phase 17-02) | Avoids cascade renumbers on every move; only renumbers on precision collapse |
| Custom keyboard DnD | `KeyboardSensor` + `sortableKeyboardCoordinates` | 2021+ a11y best practice | Zero-code keyboard DnD |

**Deprecated / outdated:**
- `react-beautiful-dnd`: archived 2022, no React 18/19 support upstream.
- `@hello-pangea/dnd` (fork): maintenance mode, declining contributor activity per 2026 audits.
- `react-window`: last release 2023; use `@tanstack/react-virtual` instead.

---

## WebSocket Subscription Semantics (OPEN QUESTION)

**Problem:** Phase 17 broadcasts use `broadcast(DEFAULT_WORKSPACE_ID, { type: 'issue:*', ... })`. The existing `WebSocketContext` has `subscribe(instanceId)`, `subscribeGroupChat`, `subscribeChatSession` — but no `subscribeWorkspace`.

**Possibilities (planner MUST verify in Wave 0):**

1. **Broadcast fans out to all authenticated clients by default** — Phase 17 events reach the board without any client-side subscribe. Most likely given the shipped events work from the Phase 17 E2E tests.
2. **Workspace key reuses the `subscribe(id)` channel** — calling `subscribe('AQ')` enrolls the client. Need to verify in `apps/server/src/ws/index.ts`.
3. **New subscribe method needed** — add `subscribeWorkspace(workspaceId)` to `WebSocketContext`. Minor type change in `WsEventType`.

**Action:** Wave 0 of the plan MUST read `apps/server/src/ws/index.ts` and `apps/server/src/ws/broadcast.ts` (or wherever `broadcast()` lives) to confirm workspace-broadcast semantics before writing Phase 23 WS handlers.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.x + better-sqlite3 for DB assertions |
| Config file | `playwright.config.ts` (root) — Chromium only, fullyParallel, CI mode retries=2 workers=1 |
| Quick run command | `npx playwright test tests/e2e/issues-board.spec.ts -g "<scenario>"` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Drag card Todo → In Progress via mouse; server position + status updated | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "mouse drag"` | ❌ Wave 0 |
| UI-01 | Keyboard-only drag: Tab → Space → ArrowRight → Space changes column | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "keyboard drag"` | ❌ Wave 0 |
| UI-02 | Second session reorders during local drag; local drag completes uncorrupted | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "concurrent reorder"` | ❌ Wave 0 (requires two Playwright contexts) |
| UI-03 | 200 issues seeded; drag FPS stays smooth (assert virtualizer DOM ≤ 20 cards on screen) | e2e | `npx playwright test tests/e2e/issues-board.spec.ts -g "virtualization"` | ❌ Wave 0 |
| Success criterion #5 | All 6 locales load without raw-key leakage on board | script | `node apps/web/scripts/check-i18n-parity.mjs` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test tests/e2e/issues-board.spec.ts -g "<single scenario>"` (< 30s per scenario)
- **Per wave merge:** Full `tests/e2e/issues-board.spec.ts` + `npm run build -w @aquarium/web` + typecheck
- **Phase gate:** Full Playwright suite green + i18n parity script green + visual-regression screenshot review

### Wave 0 Gaps

- [ ] `tests/e2e/issues-board.spec.ts` — new Playwright spec covering UI-01..UI-03 + success criteria 1-5
- [ ] `apps/web/scripts/check-i18n-parity.mjs` — Node script asserting every `t('key')` exists in all 6 locale JSONs
- [ ] Wire `check-i18n-parity` into `.github/workflows/ci.yml` (UX5 mitigation)
- [ ] `apps/web/src/components/issues/` directory (IssueBoard / IssueColumn / IssueCard / hooks)
- [ ] 6 locale file patches adding `issues.board.*` namespace
- [ ] `apps/web/src/index.css` z-index scale addition (UX3 mitigation)
- [ ] `apps/web/src/App.tsx` route additions (`/issues`, `/issues/board`)
- [ ] `apps/web/src/components/layout/Sidebar.tsx` navigation entry

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Cookie JWT via existing `requireAuth` on `/api/issues/*` — Phase 17 already enforces; Phase 23 reuses unchanged |
| V3 Session Management | no | No new session state |
| V4 Access Control | yes | Workspace-scoped reads (`DEFAULT_WORKSPACE_ID='AQ'`) — Phase 17 enforces server-side; client trusts server to filter |
| V5 Input Validation | yes | `POST /reorder` body `{ beforeId, afterId }` validated server-side (Phase 17-02); client passes strings only |
| V6 Cryptography | no | No client crypto |

### Known Threat Patterns for kanban UI stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via `issue.description` rendering | Tampering | React auto-escapes string rendering. If description is ever rendered as markdown, use `react-markdown` with default-safe plugins. DO NOT use `dangerouslySetInnerHTML`. (UX6 ownership is Phase 24 but applies here if description rendered.) |
| XSS via `issue.title` in drag overlay | Tampering | Same — React auto-escapes. |
| CSRF on `POST /reorder` | Tampering | Existing cookie+CSRF pattern from `requireAuth` middleware (Phase 19 plus). Reuse. |
| WS message spoofing | Spoofing | Authenticated WS channel — existing middleware. Client does NOT act on untrusted WS data beyond updating local state. |
| Authorization bypass | Elevation | Server-side workspace filter on every `/api/issues/*` route (shipped). Client cannot bypass. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build / Vite | ✓ | 22+ (per CLAUDE.md) | — |
| npm workspaces | Monorepo install | ✓ | npm 10+ | — |
| Playwright (+ Chromium) | E2E tests | ✓ | installed (per existing specs) | — |
| better-sqlite3 | E2E DB fixtures | ✓ | installed (tests/e2e/issues-agents-comments.spec.ts pattern) | — |
| `@dnd-kit/core@6.3.1` | DnD | ✗ (new install) | `6.3.1` | None — hard requirement |
| `@dnd-kit/sortable@10.0.0` | Sortable preset | ✗ (new install) | `10.0.0` | None |
| `@dnd-kit/utilities@3.2.2` | CSS transforms | ✗ (new install) | `3.2.2` | None |
| `@dnd-kit/accessibility` | Live region | ✗ (new install) | latest (~3.1.x; verify in Wave 0) | Hand-written aria-live (degrades UX2) |
| `@tanstack/react-virtual@3.13.24` | Virtualization | ✗ (new install) | `3.13.24` | Non-virtualized render (fails UI-03 above 100 issues) |

**Missing dependencies with no fallback:** `@dnd-kit/*` — DnD is the core feature.

**Missing dependencies with fallback:** `@tanstack/react-virtual` (degrades UI-03 only above 100 issues; acceptable for MVP if phase timeline tight).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | WS broadcasts reach all authenticated clients without explicit per-workspace subscribe | §WebSocket Subscription Semantics | HIGH — if wrong, board shows stale state until reload. Wave 0 MUST verify in `apps/server/src/ws/index.ts`. |
| A2 | `@dnd-kit/accessibility` latest version is ~3.1.x and compatible with `@dnd-kit/core@6.3.1` | §Standard Stack | LOW — install in Wave 0 and version-verify; if incompatible, hand-roll aria-live region. |
| A3 | `@tanstack/react-virtual@3.13.24` `useVirtualizer` composes cleanly with `useSortable` when overscan bumped during active drag | §Pattern 4 | MEDIUM — no canonical reference found. Wave 0 should prototype with 200 issues BEFORE writing full spec. |
| A4 | Disabling virtualization during drag (overscan=items.length) avoids the card-unmount-mid-drag problem | §Pattern 4 | MEDIUM — if false at extreme counts (>500), fall back to "disabled virtualization AND ask user to filter by status first." |
| A5 | Existing CLAUDE.md claim "no Tailwind" is OUTDATED — actual stack uses Tailwind v4 + shadcn/ui primitives | §Locked Decisions #8 | LOW — confirmed by `apps/web/package.json`. Planner should follow codebase reality, not CLAUDE.md. |
| A6 | Playwright keyboard drag via `page.keyboard.press('Space'; 'ArrowRight'; 'Space')` triggers `@dnd-kit` KeyboardSensor reliably | §Pattern 5 | MEDIUM — validated in Wave 0. If flaky, use `page.locator('...').focus()` + keystrokes. |
| A7 | `sonner` (toast lib) z-index can be overridden to use the new `--z-toast` CSS var | §Pitfall 3 | LOW — `sonner` supports `toastOptions.className` / `style`. Verify with their docs. |
| A8 | `issue:created | issue:updated | issue:deleted | issue:reordered` are the ONLY WS events the board needs | §User Constraints #4 | LOW — Phase 17-03 SUMMARY confirms this is the complete set. |
| A9 | Rendering plain `issue.title` + `issue.description` strings in React is XSS-safe via auto-escaping | §Security Domain | HIGH if wrong — but React auto-escape is a well-known guarantee. Applies only if we avoid `dangerouslySetInnerHTML`. |
| A10 | Server pagination NOT needed for v1.4 — client-side virtualization of up to ~1000 issues is acceptable | §Pitfall 4 | LOW — current single-user CE workloads are small; revisit in v1.5 with telemetry. |

---

## Open Questions

1. **Workspace subscribe semantics**
   - What we know: Phase 17 broadcasts use `broadcast(DEFAULT_WORKSPACE_ID, ...)`. Events work (verified by Phase 17 E2E).
   - What's unclear: Whether authenticated clients automatically receive workspace events, or whether a `subscribe('AQ')` call is required.
   - Recommendation: Plan 23-01 reads `apps/server/src/ws/index.ts` + `apps/server/src/ws/broadcast.ts` in its first task. Adjust `WebSocketContext` only if needed.

2. **Virtualization-during-drag safety**
   - What we know: Official dnd-kit docs say verticalListSortingStrategy "supports virtualized lists"; no concrete integration example.
   - What's unclear: Exact overscan behaviour needed for 200-500 items with active cross-column drag.
   - Recommendation: Wave 0 prototype (`apps/web/scripts/playground.tsx` or Storybook-style) with 200 synthetic issues and measured FPS. Treat virtualization strategy as a spike before committing plan structure.

3. **`@dnd-kit/accessibility` current version + API surface**
   - What we know: Referenced in PITFALLS.md §UX2 and official @dnd-kit docs.
   - What's unclear: Latest npm version as of April 2026; whether it exposes a component or just `announcements` props.
   - Recommendation: Wave 0 Task 1 — `npm view @dnd-kit/accessibility version` + official docs read.

4. **Card height for virtualizer estimate**
   - What we know: Virtualizer wants a consistent `estimateSize`.
   - What's unclear: Final card render shape determines this. If cards have variable heights (e.g., 1-line vs 3-line titles), use `measureElement` callback instead.
   - Recommendation: Start with fixed-height cards (e.g., `min-h-18` ≈ 72px) — simpler, matches Linear's aesthetic.

5. **Status column order + empty-state handling**
   - What we know: 6 statuses — `backlog | todo | in_progress | done | blocked | cancelled`.
   - What's unclear: Are `done` + `cancelled` shown by default (cluttering) or collapsed? Is there a "done today" filter?
   - Recommendation: Plan decision point — default show all 6 columns with a "hide done/cancelled" toggle; persist in localStorage. `cancelled` cards shown grey/struck-through.

6. **Real-user keybinds vs `@dnd-kit` defaults**
   - What we know: `@dnd-kit` Space/Enter-to-pickup is standard.
   - What's unclear: Does the app already have conflicting global keybinds (e.g., `/` for search)?
   - Recommendation: Grep codebase for `keydown` + `keyCode`; ensure no collision. If `Space` is problematic (e.g., user focused inside a `<textarea>` to edit inline), gate activation with `activationConstraint`.

---

## Sources

### Primary (HIGH confidence)

- **Codebase (verified by direct read 2026-04-17):**
  - `apps/server/src/routes/issues.ts` — reorder endpoint signature + broadcast events
  - `apps/server/src/services/issue-store.ts` — `reorderIssue` + `RENUMBER_STEP=1000`, `COLLAPSE_EPSILON=1e-6`
  - `apps/web/src/api.ts` — ApiResponse<T> wrapper
  - `apps/web/src/context/WebSocketContext.tsx` — existing subscribe methods
  - `apps/web/src/App.tsx` — route structure
  - `apps/web/src/components/layout/AppLayout.tsx` + `Sidebar.tsx` — layout + nav pattern
  - `apps/web/src/pages/ChatHubPage.tsx` — WS handler pattern to clone
  - `apps/web/src/i18n/index.ts` — react-i18next init
  - `apps/web/src/index.css` — design tokens
  - `apps/web/package.json` — confirmed Tailwind v4, shadcn primitives, React 19.2
  - `packages/shared/src/v14-types.ts` — Issue / IssueStatus / IssuePriority / WS event types
  - `tests/e2e/issues-agents-comments.spec.ts` — Playwright pattern
- **npm registry (queried 2026-04-17):**
  - `@dnd-kit/core@6.3.1` published 2024-12-05 — peer `react >=16.8.0`
  - `@dnd-kit/sortable@10.0.0` — peer `@dnd-kit/core ^6.3.0`
  - `@dnd-kit/utilities@3.2.2`
  - `@dnd-kit/react@0.4.0` published 2026-04-17 — peer `react ^18 || ^19` (pre-1.0, defer)
  - `@tanstack/react-virtual@3.13.24`
  - `react-virtuoso@4.18.5`
- **Project-level research (HIGH):**
  - `.planning/research/STACK.md` — @dnd-kit pinning + multica alignment
  - `.planning/research/PITFALLS.md` §UX1-UX5 — owned pitfalls
  - `.planning/phases/17-agent-issue-comment-services/17-02-SUMMARY.md` — reorder endpoint contract
  - `.planning/phases/17-agent-issue-comment-services/17-03-SUMMARY.md` — WS broadcast contract

### Secondary (MEDIUM confidence)

- [Build a Kanban board with dnd kit and React (LogRocket)](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) — common DndContext + collisionDetection=closestCorners pattern
- [Building a Drag-and-Drop Kanban Board with React and dnd-kit (radzion.com)](https://radzion.com/blog/kanban/) — multi-container sortable reference
- [React dnd-kit Tailwind shadcn-ui (GitHub: Georgegriff/react-dnd-kit-tailwind-shadcn-ui)](https://github.com/Georgegriff/react-dnd-kit-tailwind-shadcn-ui) — closest matching real-world reference to our stack (Tailwind + shadcn)
- [Sortable preset docs (dndkit.com/legacy)](https://dndkit.com/legacy/presets/sortable/overview/) — confirmed `verticalListSortingStrategy` supports virtualized lists
- [Top 5 Drag-and-Drop Libraries for React in 2026 (Puck)](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — @dnd-kit default recommendation 2026

### Tertiary (LOW confidence — flag for validation)

- [Clarification on roadmap: @dnd-kit/react vs @dnd-kit/core (GitHub Discussion #1842)](https://github.com/clauderic/dnd-kit/discussions/1842) — page would not load; roadmap posture inferred from npm publish timeline only
- [Trouble installing @dnd-kit/react (GitHub Issue #1444)](https://github.com/clauderic/dnd-kit/issues/1444) — reinforces "do not use @dnd-kit/react yet"
- `@dnd-kit/accessibility` exact API surface — needs Wave 0 verification

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — exact versions verified via npm query today; STACK.md pre-committed choices match.
- Architecture patterns: HIGH for two-tier DndContext + optimistic reorder (well-documented); MEDIUM for virtualization integration (no canonical reference — Wave 0 prototype recommended).
- Pitfalls: HIGH — PITFALLS.md §UX1-UX5 explicitly owned; mitigations mapped to code patterns.
- WS integration: MEDIUM — subscribe semantics need Wave 0 verification.
- i18n: HIGH — existing pattern documented in `apps/web/src/i18n/index.ts`.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — @dnd-kit/core 6.x is stable; watch for @dnd-kit/react 1.0 which may change recommendations)

## RESEARCH COMPLETE
