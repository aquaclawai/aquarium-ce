---
phase: 25
slug: management-uis
status: draft
shadcn_initialized: true
preset: aquarium-warm-claude (inherited from Phase 23 / Phase 24; defined in apps/web/src/index.css)
created: 2026-04-17
---

# Phase 25 — UI Design Contract: Management UIs (Agents / Runtimes / Daemon Tokens)

> Visual and interaction contract for the three management pages introduced by Phase 25 — Agents, Runtimes, and Daemon Tokens. Produced by `gsd-ui-researcher` in `--auto` mode inside a plan-phase chain. Consumed by `gsd-planner`, `gsd-executor`, `gsd-ui-checker`, and `gsd-ui-auditor`.
>
> **Research gate: SKIP** (per ROADMAP). Scope is unambiguous — 4 SCs + 3 REQ IDs (MGMT-01, MGMT-02, MGMT-03) + 12-row Verification Map. All server endpoints are shipped from Phases 16 / 17 / 19. This is pure frontend + wiring.
>
> **Reuses Phase 23 + Phase 24 design system verbatim.** Do NOT introduce new color tokens, new fonts, or new spacing scales. Extends the copywriting namespace, component inventory, and Playwright data-attribute markers only. Every Phase 25–owned hard-invariant (copy-once security; no `dangerouslySetInnerHTML`; unified runtimes list; i18n parity; soft-archive semantics) has an explicit mitigation embedded below.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui (already initialized; primitives at `apps/web/src/components/ui/*`) |
| Preset | Project-native `aquarium-warm-claude` — defined in `apps/web/src/index.css`; inherited from Phases 23 + 24. No preset changes. |
| Component library | `@radix-ui` primitives wrapped by `apps/web/src/components/ui/*`: `button`, `card`, `badge`, `dialog`, `dropdown-menu`, `input`, `popover`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `table`, `tabs`, `tooltip`. **Reuse verbatim. Do NOT hand-roll.** |
| Icon library | `lucide-react@^0.577.0` (already installed). New icon imports for Phase 25: `Bot`, `Server`, `KeyRound`, `Archive`, `ArchiveRestore`, `Pencil`, `MoreHorizontal`, `Plus`, `Copy`, `CheckCircle2`, `XCircle`, `AlertTriangle`, `ShieldOff`, `Clock`, `Globe`, `Monitor`, `Filter`, `ArrowUpDown`. |
| Font | Same as Phases 23 + 24 — serif headings (`--font-serif`), system-ui body (`--font-sans`), JetBrains Mono (`--font-mono`) for device_info JSON preview + `adt_...` plaintext token block. CJK override (`:lang(zh)`) already in `index.css:574-580`. |
| Markdown renderer | `react-markdown@^10.1.0` + `rehype-sanitize` + `remark-gfm@^4.0.1` — reuse `apps/web/src/components/issues/detail/markdown.tsx` wrapper from Phase 24 for rendering `agent.instructions` preview. **Never** `dangerouslySetInnerHTML`. |
| Copy-to-clipboard | `navigator.clipboard.writeText()` — native browser API. No new dep. Fallback-free per DAEMON-10 (plaintext shown in a selectable `<pre>` so manual copy works even if clipboard API is denied). |

**Existing primitives reused verbatim:**

- `card.tsx` — page surface, row card (list layout), form surface, empty-state card
- `table.tsx` — Agents / Runtimes / Daemon Tokens row rendering (Headless Table primitive shipped in Phase 18 research; verified present)
- `badge.tsx` — runtime-kind badge, status badge, archived badge, token-status badge
- `button.tsx` — "New Agent", "New Token", Archive, Revoke, Copy, "I've saved it"
- `dialog.tsx` — Archive confirm, Revoke confirm, New Token create+copy-once modal
- `dropdown-menu.tsx` — Per-row action menu (Edit / Archive / Restore)
- `input.tsx` — text fields (name, friendly name, filter search)
- `select.tsx` — runtime-selector dropdown inside Agent form
- `popover.tsx` — expiry date picker (native `<input type="date">` inside popover)
- `separator.tsx` — between form sections (Instructions / Runtime / Env+Args / Limits)
- `skeleton.tsx` — loading state per page
- `tabs.tsx` — Agents page "Active / Archived" toggle
- `tooltip.tsx` — truncated device_info hover; last_heartbeat_at absolute-time hover
- `scroll-area.tsx` — form body when agent form exceeds viewport inside Dialog
- `sonner.tsx` — success toasts (token created, agent saved, runtime refreshed), error toasts

**No new shadcn registry adds.** No third-party registries declared. Registry safety gate: not invoked.

---

## Spacing Scale

Same 4-point grid as Phases 23 + 24. Tailwind v4 defaults + `--space-*` CSS vars in `index.css`.

### Page-level layout values (shared across all three pages)

| Element | Value | Rationale |
|---------|-------|-----------|
| Page root padding | `p-6` (24 all sides) / `pb-8` (32 bottom) | Matches `IssuesBoardPage` / `IssueDetailPage` |
| Page max-width | `max-w-[1200px] mx-auto` | Tables read best at ≤ 1200px; keeps the layout centred on wide monitors |
| Header-to-toolbar gap | `mb-4` (16) | Page title → filter toolbar |
| Toolbar-to-table gap | `mb-6` (24) | Filter toolbar → data table |
| Toolbar internal gap | `gap-3` (12) | Between search input, filter chips, primary CTA |
| Table row padding | `px-4 py-3` (16/12) | Comfortable row height; aligns with shadcn `<TableCell>` defaults |
| Inter-row divider | `border-b` (1px) via `border-border` | Subtle row separation — existing `--border` HSL |
| Column gap within rows | `gap-3` (12) | Icon-to-text, badge-to-text |
| Empty state card padding | `p-8` (32) | Generous padding on empty-state card; matches Phase 23 board empty state |
| Skeleton row gap | `gap-2` (8) | Between skeleton rows during load |

### Agent form (Dialog body) values

| Element | Value | Rationale |
|---------|-------|-----------|
| Dialog max-width | `max-w-[640px]` | Matches `shadcn` Dialog defaults; fits 32-char name + multi-row textareas without horizontal scroll |
| Dialog body padding | `p-6` (24) | Standard shadcn Dialog internal padding |
| Form field vertical gap | `space-y-4` (16) | Between Label + Input groups |
| Label-to-input gap | `space-y-2` (8) | Inside each Label + Input cell |
| Textarea min-height | `min-h-[120px]` for `instructions` | Encourages multi-line content; ~6 rows at leading-relaxed |
| Env key-value row gap | `gap-2` (8) | Horizontal between Key / Value / Remove |
| Env key-value inter-row gap | `gap-2` (8) | Vertical between rows |
| Custom args tag-row gap | `gap-2` (8) | Tag pill spacing |
| Form footer separator | `mt-6 pt-4 border-t border-border` | Clear visual break before Save / Cancel |
| Form actions gap | `gap-3` (12) | Between Cancel and Save (Save rightmost) |

### Daemon Token create/copy-once modal values

| Element | Value | Rationale |
|---------|-------|-----------|
| Dialog max-width | `max-w-[520px]` | Narrower than agent form — single-purpose modal |
| Copy-once `<pre>` padding | `p-4` (16) | Room around the `adt_...` plaintext block |
| Copy-once `<pre>` margin above + below | `my-4` (16) | Separates the block visually from the "Copy to clipboard" button below |
| Warning callout padding | `p-3` (12) | Warning-subtle-tinted callout above the plaintext block |
| Warning callout gap | `gap-2` (8) | Between icon and message text |

**Exceptions:** None. All values on the 4-point grid. No ad-hoc pixel values.

---

## Typography

Inherits the Phase 23 + 24 type scale. Adds no new sizes or weights. Stays within the 5-size (11/12/14/20/28) + 3-weight (400/500/600) discipline already established.

| Role | Size | Weight | Line Height | Utility | Applied To |
|------|------|--------|-------------|---------|------------|
| Display (page title) | 28px / 1.75rem | 500 | 1.10 | `h1` via `index.css` rule | "Agents" / "Runtimes" / "Daemon Tokens" |
| H2 (section headers, modal titles) | 20px / 1.25rem | 600 | 1.20 | `text-xl font-semibold` | "Create agent" / "New daemon token" / "Revoke this token?" |
| Heading (table column headers, form labels) | 14px | 600 | 1.20 | `text-sm font-semibold` | `<th>`, `<Label>` |
| Body (table cell text, form inputs, dialog body) | 14px | 400 | 1.50 | `text-sm leading-relaxed` | `<td>`, `<Input>`, dialog descriptions |
| Body-small (metadata: created/lastUsed/heartbeat, char counter, hints) | 12px | 400 | 1.40 | `text-xs text-muted-foreground` | Meta rows under table cells, character counter, help text |
| Label (status/kind/priority badge) | 11px | 500 | 1.0 | `text-[11px] font-medium uppercase tracking-wide` | Badges via existing shadcn `Badge` primitive |
| Mono (device_info JSON preview, adt_ token plaintext) | 12px | 400 | 1.50 | `text-xs font-mono leading-relaxed` | `<pre>` blocks for device_info expanded view + token plaintext |

**Hard typographic rules (Phase 25-specific):**

- NEVER render `agent.name`, `agent.instructions`, `runtime.name`, `runtime.deviceInfo`, `daemonToken.name`, or the plaintext `adt_...` token with `dangerouslySetInnerHTML`. React auto-escaping only for plain text. When `agent.instructions` is rendered in a preview (e.g., on hover-tooltip or below the form), use the shared `SafeMarkdown` component from `apps/web/src/components/issues/detail/markdown.tsx` (react-markdown + rehype-sanitize allowlist).
- `agent.instructions` inside the form Textarea: plain `<textarea>`, no markdown preview in-form. Optional live preview pane is OUT OF SCOPE for Phase 25.
- `device_info` JSON: `<pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto">` with `JSON.stringify(deviceInfo, null, 2)` as text child — auto-escaped.
- `adt_...` plaintext token: `<pre className="text-xs font-mono bg-muted p-4 rounded select-all break-all">` — rendered as plain text; `select-all` enables double-click selection; NEVER inserted via `innerHTML`.
- Character counter on `agent.instructions` Textarea: only shown when `value.length > 3500` (80% of the 4096-char soft cap) to avoid visual noise when the user is far below the limit.

---

## Color

Reuses the Oxide palette from Phase 23 verbatim — zero new hues.

| Role | CSS Variable | Light | Dark | Usage on Management Pages |
|------|--------------|-------|------|----------------------------|
| Dominant (60%) — page surface | `--background` | `30 100% 97%` | `60 3% 8%` | Page root background |
| Dominant (60%) — content well | `--card` | `50 33% 97%` | `60 2% 18%` | Table wrapper card, form card, empty-state card |
| Secondary (30%) — muted surfaces | `--muted` | `43 11% 91%` | `60 2% 18%` | Alternating `<tr>` (`even:bg-muted/30`) on Agents / Runtimes / Daemon Tokens tables; Token plaintext `<pre>` background |
| Secondary (30%) — borders | `--border` | `43 18% 92%` | `40 5% 25%` | Card outlines, row dividers, form field borders |
| Accent (10%) — brand terracotta | `--primary` | `19 100% 60%` | `21 100% 69%` | **RESERVED — see explicit list below** |
| Destructive | `--destructive` | `0 53% 46%` | `0 62% 30%` | Archive / Revoke CTAs in confirmation Dialog; destructive badge for `revoked` and `expired` token statuses; error toasts |
| Focus ring | `--ring` | same as `--primary` | same as `--primary` | `:focus-visible` on all Inputs, Buttons, Select triggers |
| Info-subtle (runtime online, daemon kind) | `--color-info-subtle-bg` + `--color-info-subtle-text` | `#155e75` family | `#67e8f9` family | `online` runtime status badge; `daemon` kind badge background |
| Success-subtle (active token, agent active) | `--color-success-subtle-bg` + `--color-success-subtle-text` | `#065f46` family | `#6ee7b7` family | `active` token status; "agent active" indicator |
| Warning-subtle (offline runtime, degraded, expiring soon) | `--color-warning-subtle-bg` + `--color-warning-subtle-text` | `#92400e` family | `#d7ba7d` family | `offline` runtime status; `expiring soon` (<7d) token badge; copy-once warning callout |

**Accent (`--primary` terracotta) RESERVED exclusively for:**

1. Primary CTA buttons — "New Agent" (Agents page header), "New Token" (Daemon Tokens page header), "Save" (Agent form footer), "Create Token" (Token modal footer)
2. Active "Copy to clipboard" button in the copy-once token modal (becomes `variant="secondary"` after the user has clicked it and the clipboard write succeeded)
3. Active keyboard focus ring on all interactive Inputs and Buttons (`ring-2 ring-[var(--ring)]`)
4. Selected tab underline on Agents page "Active / Archived" tabs (Radix Tabs indicator)
5. Selected chip on Runtimes page kind-filter chip group (e.g., "All" vs "Daemon" selected state)
6. Row hover on table rows: `hover:bg-[var(--color-primary)]/5` (5% tint — subtle, doesn't fight per-row accents)

**Accent is NOT used for:**

- Table column header text (use `text-foreground font-semibold`)
- Secondary buttons / Cancel / Archive / Revoke (use `variant="outline"` / `variant="ghost"` / `variant="destructive"`)
- Status badges (use subtle status tokens — info-subtle / success-subtle / warning-subtle / destructive)
- Metadata rows (use `text-muted-foreground`)
- device_info JSON `<pre>` background (use `bg-muted`)

### Per-runtime-kind badge

| Kind | Badge classes | Icon (lucide-react) | Label (i18n key) |
|------|--------------|---------------------|-------------------|
| `hosted_instance` | `bg-[var(--color-info-subtle-bg)] text-[var(--color-info-subtle-text)]` | `Server` (14px) | `management.runtimes.kind.hostedInstance` — "Hosted" |
| `local_daemon` | `bg-secondary text-secondary-foreground` | `Monitor` (14px) | `management.runtimes.kind.localDaemon` — "Local daemon" |
| `external_cloud_daemon` | `bg-muted text-muted-foreground` | `Globe` (14px) | `management.runtimes.kind.externalCloudDaemon` — "Cloud daemon" |

### Per-runtime-status badge

| Status | Badge classes | Icon | Label (i18n key) |
|--------|---------------|------|-------------------|
| `online` | `bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)]` | `CheckCircle2` (12px) + pulse-dot when freshly heartbeated | `management.runtimes.status.online` — "Online" |
| `offline` | `bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)]` | `Clock` (12px) | `management.runtimes.status.offline` — "Offline" |
| `error` | `variant="destructive"` | `XCircle` (12px) | `management.runtimes.status.error` — "Error" |

### Per-agent-status presentation (Agents table)

| Column value | Presentation |
|--------------|--------------|
| `archivedAt` is non-null | Row tinted `opacity-70`, `text-muted-foreground`; badge `variant="outline"` with label `t('management.agents.archived')` = "Archived" |
| `archivedAt` is null, agent has recent task activity | Green dot indicator + `text-foreground` |
| `archivedAt` is null, agent idle | Plain `text-foreground` |

### Per-daemon-token-status badge (derived client-side)

| Derived status | Condition | Badge classes | Icon | Label (i18n key) |
|----------------|-----------|----------------|------|-------------------|
| `active` | `revokedAt === null` AND (`expiresAt === null` OR `expiresAt > now`) | `bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)]` | `CheckCircle2` (12px) | `management.daemonTokens.status.active` — "Active" |
| `expiring_soon` | `active` AND `expiresAt` within 7 days | `bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)]` | `Clock` (12px) | `management.daemonTokens.status.expiringSoon` — "Expires soon" |
| `expired` | `revokedAt === null` AND `expiresAt <= now` | `variant="destructive"` | `AlertTriangle` (12px) | `management.daemonTokens.status.expired` — "Expired" |
| `revoked` | `revokedAt !== null` | `variant="outline"` with `text-muted-foreground opacity-70` | `ShieldOff` (12px) | `management.daemonTokens.status.revoked` — "Revoked" |

**Light + dark theme:** Every value resolves via existing `:root` / `:root.dark` blocks — zero new dark-theme overrides.

---

## Z-Index Ladder

Reuses the Phase 23 ladder (`--z-base` through `--z-critical-alert` in `apps/web/src/index.css`).

**Management-page application:**

| Element | Value |
|---------|-------|
| Page content | `--z-base` (implicit) |
| Sidebar nav (AppLayout) | `--z-sidebar` (100) — already applied |
| Agent form Dialog (create / edit) | Radix Dialog auto-portals to `--z-modal` (1000) |
| Archive confirmation Dialog | Radix Dialog auto-portals to `--z-modal` (1000) |
| Token create + copy-once Dialog | Radix Dialog auto-portals to `--z-modal` (1000) |
| Revoke confirmation Dialog | Radix Dialog auto-portals to `--z-modal` (1000) |
| Per-row action Dropdown Menu | Radix auto-portals to `--z-dropdown` (10) |
| Runtime device_info hover Tooltip | Radix auto-portals to `--z-dropdown` (10) |
| Toasts (Sonner) | `--z-toast` (7000) — already configured |

**No new z-index tokens introduced by Phase 25.**

---

## Copywriting Contract

Every new string is an i18n key in `management.agents.*`, `management.runtimes.*`, `management.daemonTokens.*`, or additional `sidebar.*` entries. All keys ship in 6 locales (`en`, `zh`, `fr`, `de`, `es`, `it`) and are enforced by `apps/web/scripts/check-i18n-parity.mjs` + CI (UI-08 carry-forward). Wave 0 ships `en` complete + 5-locale placeholders; Wave 4 ships the real translations.

### Sidebar (extensions to existing `sidebar` namespace)

| Element | Key | en (source) |
|---------|-----|-------------|
| Agents nav entry | `sidebar.agents` | `Agents` |
| Runtimes nav entry | `sidebar.runtimes` | `Runtimes` |
| Daemon Tokens nav entry | `sidebar.daemonTokens` | `Daemon Tokens` |
| (existing) Workspace group label | `sidebar.workspaceGroup` (reuse) | `Workspace` |

### `management.agents.*`

#### Page scaffolding

| Element | Key | en |
|---------|-----|----|
| Page `<title>` / `<h1>` | `management.agents.title` | `Agents` |
| Page description | `management.agents.description` | `Agents define what work gets done and how. Assign one to an issue and it starts a task.` |
| Primary CTA | `management.agents.actions.create` | `New agent` |
| Tab — active agents | `management.agents.tabs.active` | `Active` |
| Tab — archived agents | `management.agents.tabs.archived` | `Archived` |
| Filter search placeholder | `management.agents.filter.search` | `Search agents…` |

#### Table columns

| Element | Key | en |
|---------|-----|----|
| Column: name | `management.agents.columns.name` | `Name` |
| Column: runtime | `management.agents.columns.runtime` | `Runtime` |
| Column: max concurrent | `management.agents.columns.maxConcurrent` | `Max concurrent` |
| Column: updated | `management.agents.columns.updated` | `Updated` |
| Column: actions (sr-only header) | `management.agents.columns.actions` | `Actions` |
| No runtime assigned | `management.agents.noRuntime` | `No runtime` |
| Archived badge | `management.agents.archived` | `Archived` |

#### Empty states

| State | Key | en |
|-------|-----|----|
| Empty (active tab, zero agents) — heading | `management.agents.empty.heading` | `No agents yet` |
| Empty — body | `management.agents.empty.body` | `Create your first agent to start assigning work.` |
| Empty — CTA | `management.agents.empty.cta` | `New agent` (reuse `management.agents.actions.create`) |
| No search matches — heading | `management.agents.noMatches.heading` | `No agents match your search` |
| No search matches — body | `management.agents.noMatches.body` | `Try a different name.` |
| No search matches — clear button | `management.agents.noMatches.clear` | `Clear search` |
| Archived tab empty | `management.agents.archivedEmpty` | `No archived agents` |

#### Form labels (create + edit share one form)

| Element | Key | en |
|---------|-----|----|
| Dialog title — create | `management.agents.form.titleCreate` | `Create agent` |
| Dialog title — edit | `management.agents.form.titleEdit` | `Edit agent` |
| Name label | `management.agents.form.name.label` | `Name` |
| Name placeholder | `management.agents.form.name.placeholder` | `e.g. Code reviewer` |
| Name hint | `management.agents.form.name.hint` | `A short, human-friendly name. Must be unique in your workspace.` |
| Instructions label | `management.agents.form.instructions.label` | `Instructions` |
| Instructions placeholder | `management.agents.form.instructions.placeholder` | `Describe what this agent should do and how it should behave. Markdown is supported.` |
| Instructions hint | `management.agents.form.instructions.hint` | `Markdown is supported. This text is sent to the agent on every task.` |
| Instructions counter (shown > 3500 chars) | `management.agents.form.instructions.counter` | `{{count}} / {{max}} characters` |
| Runtime label | `management.agents.form.runtime.label` | `Runtime` |
| Runtime placeholder (Select trigger) | `management.agents.form.runtime.placeholder` | `Choose a runtime` |
| Runtime no-selection option | `management.agents.form.runtime.none` | `No runtime (agent can't run tasks until assigned)` |
| Runtime hint | `management.agents.form.runtime.hint` | `Runtimes are where the agent's code actually executes. Add one from the Runtimes page.` |
| Custom env section header | `management.agents.form.customEnv.label` | `Environment variables` |
| Custom env hint | `management.agents.form.customEnv.hint` | `Passed to daemon runtimes when a task starts. Hosted instances ignore these with a warning.` |
| Custom env — key placeholder | `management.agents.form.customEnv.keyPlaceholder` | `KEY` |
| Custom env — value placeholder | `management.agents.form.customEnv.valuePlaceholder` | `value` |
| Custom env — add row | `management.agents.form.customEnv.addRow` | `Add variable` |
| Custom env — remove row (aria-label) | `management.agents.form.customEnv.removeRow` | `Remove variable` |
| Custom env — duplicate key warning | `management.agents.form.customEnv.duplicateKey` | `Duplicate key "{{key}}" — only the last value is kept` |
| Custom args section header | `management.agents.form.customArgs.label` | `Command-line arguments` |
| Custom args hint | `management.agents.form.customArgs.hint` | `Extra arguments appended when the CLI is invoked. One per tag.` |
| Custom args — input placeholder | `management.agents.form.customArgs.placeholder` | `Type an argument and press Enter` |
| Custom args — remove (aria-label) | `management.agents.form.customArgs.remove` | `Remove argument "{{arg}}"` |
| Max concurrent label | `management.agents.form.maxConcurrent.label` | `Max concurrent tasks` |
| Max concurrent hint | `management.agents.form.maxConcurrent.hint` | `How many tasks this agent can run at once. Must be between 1 and 16.` |
| Max concurrent validation | `management.agents.form.maxConcurrent.validation` | `Must be between 1 and 16` |
| Save button — create | `management.agents.form.actions.create` | `Create agent` |
| Save button — edit | `management.agents.form.actions.save` | `Save changes` |
| Cancel button | `common.buttons.cancel` (reuse) | `Cancel` |
| Form validation: name required | `management.agents.form.validation.nameRequired` | `Name is required` |
| Form save success toast | `management.agents.form.saveSuccess` | `Agent saved` |
| Form save failure toast | `management.agents.form.saveFailed` | `Couldn't save the agent — please try again` |
| Form save UNIQUE collision | `management.agents.form.nameCollision` | `An agent with this name already exists in your workspace` |

#### Row actions

| Element | Key | en |
|---------|-----|----|
| Row menu: edit | `management.agents.actions.edit` | `Edit` |
| Row menu: archive | `management.agents.actions.archive` | `Archive` |
| Row menu: restore | `management.agents.actions.restore` | `Restore` |

#### Archive / Restore confirmation

| Element | Key | en |
|---------|-----|----|
| Archive dialog title | `management.agents.archiveConfirm.title` | `Archive "{{name}}"?` |
| Archive dialog body | `management.agents.archiveConfirm.body` | `This preserves all historical tasks and comments, but you can't assign new work until you restore it. Any queued tasks stay in the queue.` |
| Archive confirm button | `management.agents.archiveConfirm.confirm` | `Archive agent` |
| Archive success toast | `management.agents.archive.success` | `Agent archived` |
| Archive failure toast | `management.agents.archive.failed` | `Couldn't archive — please try again` |
| Restore dialog title | `management.agents.restoreConfirm.title` | `Restore "{{name}}"?` |
| Restore dialog body | `management.agents.restoreConfirm.body` | `The agent becomes assignable again. Existing archived issues stay archived.` |
| Restore confirm button | `management.agents.restoreConfirm.confirm` | `Restore agent` |
| Restore success toast | `management.agents.restore.success` | `Agent restored` |
| Restore failure toast | `management.agents.restore.failed` | `Couldn't restore — please try again` |
| Load failure banner | `management.agents.loadFailed` | `Couldn't load agents. {{retry}}` |

### `management.runtimes.*`

#### Page scaffolding

| Element | Key | en |
|---------|-----|----|
| Page title | `management.runtimes.title` | `Runtimes` |
| Page description | `management.runtimes.description` | `Runtimes are where agents execute. They're added automatically when an instance starts or a daemon registers.` |
| Filter search placeholder | `management.runtimes.filter.search` | `Search runtimes…` |

#### Kind-filter chip group (MGMT-02 — unified list)

| Chip | Key | en |
|------|-----|----|
| All | `management.runtimes.filter.all` | `All` |
| Hosted | `management.runtimes.filter.hostedInstance` | `Hosted` |
| Local daemon | `management.runtimes.filter.localDaemon` | `Local daemon` |
| Cloud daemon | `management.runtimes.filter.externalCloudDaemon` | `Cloud daemon` |
| Chip count suffix | `management.runtimes.filter.count` | `{{count}}` |

#### Table columns

| Element | Key | en |
|---------|-----|----|
| Column: name | `management.runtimes.columns.name` | `Name` |
| Column: kind | `management.runtimes.columns.kind` | `Kind` |
| Column: provider | `management.runtimes.columns.provider` | `Provider` |
| Column: status | `management.runtimes.columns.status` | `Status` |
| Column: device | `management.runtimes.columns.device` | `Device` |
| Column: last heartbeat | `management.runtimes.columns.lastHeartbeat` | `Last heartbeat` |
| Column: actions (sr-only) | `management.runtimes.columns.actions` | `Actions` |
| Never — heartbeat | `management.runtimes.neverHeartbeat` | `Never` |
| Just now — heartbeat | `management.runtimes.heartbeatJustNow` | `Just now` |
| Relative heartbeat | `management.runtimes.heartbeatRelative` | `{{relativeTime}}` |
| Heartbeat tooltip — absolute | `management.runtimes.heartbeatAbsolute` | `{{absoluteTime}}` |
| No device info | `management.runtimes.noDeviceInfo` | `—` |

#### Kind labels

(already declared above in the Color section — repeated here for the copywriting catalogue)

| Key | en |
|-----|----|
| `management.runtimes.kind.hostedInstance` | `Hosted` |
| `management.runtimes.kind.localDaemon` | `Local daemon` |
| `management.runtimes.kind.externalCloudDaemon` | `Cloud daemon` |

#### Status labels

| Key | en |
|-----|----|
| `management.runtimes.status.online` | `Online` |
| `management.runtimes.status.offline` | `Offline` |
| `management.runtimes.status.error` | `Error` |

#### Empty states

| State | Key | en |
|-------|-----|----|
| Empty (zero runtimes) — heading | `management.runtimes.empty.heading` | `No runtimes yet` |
| Empty — body | `management.runtimes.empty.body` | `Start an Aquarium instance or run `aquarium daemon start` on your machine to add a runtime.` |
| No matches (after filter) — heading | `management.runtimes.noMatches.heading` | `No runtimes match your filter` |
| No matches — clear | `management.runtimes.noMatches.clear` | `Clear filter` |
| Load failure | `management.runtimes.loadFailed` | `Couldn't load runtimes. {{retry}}` |

#### Detail drawer (Sheet)

| Element | Key | en |
|---------|-----|----|
| Drawer header | `management.runtimes.detail.title` | `{{name}}` (passthrough; runtime name is the header) |
| Detail: kind | `management.runtimes.detail.kind` | `Kind` |
| Detail: provider | `management.runtimes.detail.provider` | `Provider` |
| Detail: status | `management.runtimes.detail.status` | `Status` |
| Detail: runtime id | `management.runtimes.detail.id` | `Runtime ID` |
| Detail: daemon id | `management.runtimes.detail.daemonId` | `Daemon ID` |
| Detail: instance id | `management.runtimes.detail.instanceId` | `Instance ID` |
| Detail: created | `management.runtimes.detail.createdAt` | `Created` |
| Detail: last heartbeat | `management.runtimes.detail.lastHeartbeatAt` | `Last heartbeat` |
| Detail: device info header | `management.runtimes.detail.deviceInfoHeader` | `Device info` |
| Detail: metadata header | `management.runtimes.detail.metadataHeader` | `Metadata` |
| Detail: close button (sr-only) | `management.runtimes.detail.close` | `Close details` |

### `management.daemonTokens.*`

#### Page scaffolding

| Element | Key | en |
|---------|-----|----|
| Page title | `management.daemonTokens.title` | `Daemon Tokens` |
| Page description | `management.daemonTokens.description` | `Daemon tokens let the Aquarium CLI connect this machine or another to your workspace. Each token appears in plaintext only when you create it — store it somewhere safe.` |
| Primary CTA | `management.daemonTokens.actions.create` | `New token` |

#### Table columns

| Element | Key | en |
|---------|-----|----|
| Column: name | `management.daemonTokens.columns.name` | `Name` |
| Column: created | `management.daemonTokens.columns.created` | `Created` |
| Column: expires | `management.daemonTokens.columns.expires` | `Expires` |
| Column: last used | `management.daemonTokens.columns.lastUsed` | `Last used` |
| Column: status | `management.daemonTokens.columns.status` | `Status` |
| Column: actions (sr-only) | `management.daemonTokens.columns.actions` | `Actions` |
| Expires — never | `management.daemonTokens.neverExpires` | `Never` |
| Last used — never | `management.daemonTokens.neverUsed` | `Never` |
| Relative time | `management.daemonTokens.relative` | `{{relativeTime}}` |

#### Status labels

(declared in Color section; catalogued here)

| Key | en |
|-----|----|
| `management.daemonTokens.status.active` | `Active` |
| `management.daemonTokens.status.expiringSoon` | `Expires soon` |
| `management.daemonTokens.status.expired` | `Expired` |
| `management.daemonTokens.status.revoked` | `Revoked` |

#### Empty states

| State | Key | en |
|-------|-----|----|
| Empty — heading | `management.daemonTokens.empty.heading` | `No tokens yet` |
| Empty — body | `management.daemonTokens.empty.body` | `Create a token to connect a daemon to this workspace.` |
| Empty — CTA | `management.daemonTokens.empty.cta` | `New token` |
| Load failure | `management.daemonTokens.loadFailed` | `Couldn't load tokens. {{retry}}` |

#### Create modal (two-step — form then copy-once)

| Element | Key | en |
|---------|-----|----|
| Create dialog title | `management.daemonTokens.createModal.title` | `New daemon token` |
| Name label | `management.daemonTokens.createModal.name.label` | `Friendly name` |
| Name placeholder | `management.daemonTokens.createModal.name.placeholder` | `e.g. My laptop` |
| Name hint | `management.daemonTokens.createModal.name.hint` | `A label you'll recognise on the list. Max 100 characters.` |
| Name validation required | `management.daemonTokens.createModal.name.required` | `Name is required` |
| Name validation too long | `management.daemonTokens.createModal.name.tooLong` | `Name must be 100 characters or fewer` |
| Expiry label | `management.daemonTokens.createModal.expiry.label` | `Expires` |
| Expiry placeholder (Never) | `management.daemonTokens.createModal.expiry.never` | `Never` |
| Expiry hint | `management.daemonTokens.createModal.expiry.hint` | `Optional. After this date the token stops working.` |
| Expiry clear button | `management.daemonTokens.createModal.expiry.clear` | `Clear date` |
| Expiry must-be-future | `management.daemonTokens.createModal.expiry.future` | `Expiry must be in the future` |
| Create button | `management.daemonTokens.createModal.actions.create` | `Create token` |
| Creating state | `management.daemonTokens.createModal.actions.creating` | `Creating…` |
| Cancel | `common.buttons.cancel` (reuse) | `Cancel` |
| Create failure toast | `management.daemonTokens.createModal.createFailed` | `Couldn't create token — please try again` |

#### Copy-once state (MGMT-03 HARD SECURITY INVARIANT)

| Element | Key | en |
|---------|-----|----|
| Copy-once dialog title | `management.daemonTokens.copyOnce.title` | `Copy your new token` |
| Copy-once warning callout | `management.daemonTokens.copyOnce.warning` | `This is the only time you'll see this token. Copy it now and store it somewhere safe — we can't show it again.` |
| Copy-once warning icon label (sr-only) | `management.daemonTokens.copyOnce.warningIcon` | `Warning` |
| Token block label | `management.daemonTokens.copyOnce.tokenLabel` | `Token` |
| Copy to clipboard button | `management.daemonTokens.copyOnce.copyButton` | `Copy to clipboard` |
| Copy success state | `management.daemonTokens.copyOnce.copied` | `Copied to clipboard` |
| Copy failure state | `management.daemonTokens.copyOnce.copyFailed` | `Couldn't copy — select the text and copy manually` |
| Dismiss / acknowledge button | `management.daemonTokens.copyOnce.dismiss` | `I've saved it` |
| Dismiss re-confirm title (if user tries to close without clicking "I've saved it") | `management.daemonTokens.copyOnce.confirmClose.title` | `Close without saving the token?` |
| Dismiss re-confirm body | `management.daemonTokens.copyOnce.confirmClose.body` | `You won't see this token again. If you close now, you'll need to create a new one.` |
| Dismiss re-confirm ok | `management.daemonTokens.copyOnce.confirmClose.confirm` | `Close anyway` |
| Dismiss re-confirm cancel | `management.daemonTokens.copyOnce.confirmClose.cancel` | `Keep showing` |

#### Revoke confirmation

| Element | Key | en |
|---------|-----|----|
| Row menu: revoke | `management.daemonTokens.actions.revoke` | `Revoke` |
| Revoke dialog title | `management.daemonTokens.revokeConfirm.title` | `Revoke "{{name}}"?` |
| Revoke dialog body | `management.daemonTokens.revokeConfirm.body` | `The daemon using this token loses access within one second. Already-running tasks continue. This can't be undone.` |
| Revoke confirm button | `management.daemonTokens.revokeConfirm.confirm` | `Revoke token` |
| Revoke success toast | `management.daemonTokens.revoke.success` | `Token revoked` |
| Revoke failure toast | `management.daemonTokens.revoke.failed` | `Couldn't revoke — please try again` |

### Destructive confirmation pattern (inherited from Phase 24)

All destructive confirmations in Phase 25 use a shadcn `Dialog` with:

- **Title:** `{action}?` (e.g., "Archive \"Code reviewer\"?" / "Revoke \"My laptop\"?")
- **Body:** 1–2 short sentences — describes the effect, mentions whether it's reversible
- **Cancel button:** `t('common.buttons.cancel')` (`Cancel`)
- **Confirm button:** destructive variant, text = primary action verb (e.g., "Archive agent", "Revoke token")

Destructive actions in Phase 25 scope:

1. Archive agent — `management.agents.archiveConfirm.*` (reversible via Restore)
2. Restore agent — `management.agents.restoreConfirm.*` (uses `variant="default"` not destructive — restoration is positive)
3. Revoke daemon token — `management.daemonTokens.revokeConfirm.*` (NOT reversible — body text calls this out explicitly)
4. Close token-copy-once modal without saving — `management.daemonTokens.copyOnce.confirmClose.*` (implicit destruction of plaintext visibility)

### Accessibility announcements (sr-only live region)

Reuse the existing `.visually-hidden` class + `<div role="status" aria-live="polite">` wrapper pattern from Phase 24.

| Event | Key | en |
|-------|-----|----|
| Agent saved | `management.agents.a11y.saved` | `Agent "{{name}}" saved` |
| Agent archived | `management.agents.a11y.archived` | `Agent "{{name}}" archived` |
| Agent restored | `management.agents.a11y.restored` | `Agent "{{name}}" restored` |
| Runtime status changed (WS — optional in Wave 2) | `management.runtimes.a11y.statusChanged` | `Runtime "{{name}}" is now {{status}}` |
| Token created (post-dismiss announcement; does NOT include plaintext) | `management.daemonTokens.a11y.created` | `Token "{{name}}" created` |
| Token revoked | `management.daemonTokens.a11y.revoked` | `Token "{{name}}" revoked` |
| Token plaintext copied (announces success; does NOT include plaintext) | `management.daemonTokens.a11y.copied` | `Token copied to clipboard` |

**CRITICAL:** Announcements MUST NEVER embed the `adt_...` plaintext. Only the friendly name.

---

## Component Inventory

Components to create under `apps/web/src/components/management/` (NEW directory — isolates Phase 25 from Phases 23 + 24).

### Agents page

| Component | File | Responsibilities | Props (key shapes) |
|-----------|------|------------------|---------------------|
| `AgentsPage` | `apps/web/src/pages/AgentsPage.tsx` | Route component for `/agents`. `GET /api/agents` + `GET /api/agents?includeArchived=true` on tab change. Tabs: Active / Archived. Orchestrates list + form + archive-confirm. | — (reads `useSearchParams()` for optional `?tab=archived`) |
| `AgentList` | `apps/web/src/components/management/AgentList.tsx` | shadcn `<Table>` with columns Name / Runtime / MaxConcurrent / Updated / Actions. Empty + no-match states via inline `EmptyState`. Row click → open Edit form (non-drag-free, plain click). | `{ agents: Agent[]; runtimes: Runtime[]; isLoading: boolean; onEdit: (a: Agent) => void; onArchive: (a: Agent) => void; onRestore: (a: Agent) => void; archivedView: boolean; searchQuery: string }` |
| `AgentRow` | inline inside `AgentList.tsx` (memoized) | One row. Name + runtime badge (with `Server` / `Monitor` / `Globe` icon per kind) + max concurrent + relative updated time + actions dropdown. Memoized on `(agent.id, agent.updatedAt)`. | `{ agent: Agent; runtime: Runtime \| null; archivedView: boolean; onEdit: () => void; onArchive: () => void; onRestore: () => void }` |
| `AgentFormDialog` | `apps/web/src/components/management/AgentFormDialog.tsx` | shadcn `<Dialog>` hosting the full form. Handles create + edit via `mode: 'create' \| 'edit'`. Submits via `POST /api/agents` or `PATCH /api/agents/:id`. Validates locally (name required, maxConcurrent 1..16, env key dedup). Closes on success. | `{ mode: 'create' \| 'edit'; agent?: Agent; runtimes: Runtime[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (agent: Agent) => void }` |
| `AgentFormBody` | inline inside `AgentFormDialog.tsx` | The fields themselves. Split from the Dialog shell for unit-of-rendering clarity and easier sub-component testing. | `{ value: AgentFormValue; onChange: (v: AgentFormValue) => void; runtimes: Runtime[]; errors: AgentFormErrors }` |
| `CustomEnvEditor` | `apps/web/src/components/management/CustomEnvEditor.tsx` | Key-value editor. Renders one `<input>` pair per row; `+` adds; `×` removes. Duplicate-key warning inline (non-blocking). | `{ value: Record<string, string>; onChange: (v: Record<string, string>) => void }` |
| `CustomArgsEditor` | `apps/web/src/components/management/CustomArgsEditor.tsx` | Tag-input. Text input; Enter adds; Backspace on empty input removes last; click × removes any. | `{ value: string[]; onChange: (v: string[]) => void }` |
| `ArchiveConfirmDialog` | `apps/web/src/components/management/ArchiveConfirmDialog.tsx` | shadcn `<Dialog>` for archive / restore confirmation. Uses `variant="destructive"` button on Archive and `variant="default"` on Restore. | `{ agent: Agent \| null; mode: 'archive' \| 'restore'; onConfirm: () => Promise<void>; onOpenChange: (open: boolean) => void }` |
| `useAgents` (hook) | `apps/web/src/components/management/useAgents.ts` | Fetch + cache + WS reconciliation (optional — Phase 25 accepts full refetch on mutation). Returns `{ active, archived, isLoading, error, refetch, create, update, archive, restore }`. | `{}` |

### Runtimes page

| Component | File | Responsibilities | Props |
|-----------|------|------------------|-------|
| `RuntimesPage` | `apps/web/src/pages/RuntimesPage.tsx` | Route component for `/runtimes`. `GET /api/runtimes` on mount. Reads `?kind=` query param for deep-linking filter state. | — (uses `useSearchParams()`) |
| `RuntimeList` | `apps/web/src/components/management/RuntimeList.tsx` | shadcn `<Table>` with columns Name / Kind / Provider / Status / Device / Heartbeat / Actions (sr-only). Row click → open detail Sheet. | `{ runtimes: Runtime[]; isLoading: boolean; activeKindFilter: RuntimeKind \| 'all'; searchQuery: string; onRowClick: (r: Runtime) => void }` |
| `RuntimeRow` | inline in `RuntimeList.tsx` (memoized) | One row. Kind badge with icon, provider name, status badge, device summary (`os/arch` truncated to 28 chars + tooltip for full `JSON.stringify(deviceInfo)`), relative heartbeat + tooltip with absolute time. | `{ runtime: Runtime; onClick: () => void }` |
| `KindFilterChips` | `apps/web/src/components/management/KindFilterChips.tsx` | Chip group (radix-toggle-group semantics via `Button variant="outline"` with active-state). Four chips: All / Hosted / Local daemon / Cloud daemon. Each shows live count. | `{ counts: Record<RuntimeKind \| 'all', number>; value: RuntimeKind \| 'all'; onChange: (v: RuntimeKind \| 'all') => void }` |
| `RuntimeDetailSheet` | `apps/web/src/components/management/RuntimeDetailSheet.tsx` | shadcn `<Sheet>` (right-side drawer). Shows full `Runtime` shape: IDs (runtime / daemon / instance), timestamps, device_info JSON in a `<pre>`, metadata JSON. Read-only. | `{ runtime: Runtime \| null; open: boolean; onOpenChange: (open: boolean) => void }` |
| `useRuntimes` (hook) | `apps/web/src/components/management/useRuntimes.ts` | Fetch + 30-second poll (status updates visible without manual refresh). WS reconciliation optional in Wave 2. | `{}` |

### Daemon Tokens page

| Component | File | Responsibilities | Props |
|-----------|------|------------------|-------|
| `DaemonTokensPage` | `apps/web/src/pages/DaemonTokensPage.tsx` | Route component for `/daemon-tokens`. `GET /api/daemon-tokens` on mount. | — |
| `DaemonTokenList` | `apps/web/src/components/management/DaemonTokenList.tsx` | shadcn `<Table>` Name / Created / Expires / LastUsed / Status / Actions. Empty state + loading skeleton. | `{ tokens: DaemonToken[]; isLoading: boolean; onRevoke: (t: DaemonToken) => void }` |
| `DaemonTokenRow` | inline in `DaemonTokenList.tsx` (memoized) | One row. Derived status badge (active / expiring_soon / expired / revoked). `lastUsedAt` relative + absolute tooltip. | `{ token: DaemonToken; onRevoke: () => void }` |
| `DaemonTokenCreateModal` | `apps/web/src/components/management/DaemonTokenCreateModal.tsx` | **Two-step stateful Dialog**. Step A: form (name + optional expiry via `<input type="date">`). Step B: copy-once view. **State machine is local to this component**; plaintext never escapes in a callback. Parent only receives the `DaemonToken` projection (post-dismiss). See Security Contract for invariants. | `{ open: boolean; onOpenChange: (open: boolean) => void; onCreated: (token: DaemonToken) => void }` |
| `TokenPlaintextDisplay` | inline inside `DaemonTokenCreateModal.tsx` | `<pre>` block rendering the plaintext + "Copy" button + "Copied" state + "I've saved it" button. **Does NOT persist plaintext** anywhere — lives in a `useState` inside the parent modal and is cleared on dismiss. | `{ plaintext: string; onCopy: () => void; copyState: 'idle' \| 'copied' \| 'failed'; onDismiss: () => void }` |
| `RevokeConfirmDialog` | `apps/web/src/components/management/RevokeConfirmDialog.tsx` | shadcn `<Dialog>` — destructive. | `{ token: DaemonToken \| null; onConfirm: () => Promise<void>; onOpenChange: (open: boolean) => void }` |
| `useDaemonTokens` (hook) | `apps/web/src/components/management/useDaemonTokens.ts` | Fetch + optimistic revoke. Never holds plaintext (plaintext is owned by `DaemonTokenCreateModal` state only). | `{}` |

### Shared helpers

| Helper | File | Responsibilities |
|--------|------|------------------|
| `formatRelativeTime(ts: string \| null)` | `apps/web/src/components/management/time.ts` | `Intl.RelativeTimeFormat` based "2m ago" / "Just now" / "Never" logic. Used across all three pages. Reuses existing `Intl.RelativeTimeFormat` helper from Phase 24 if one exists — otherwise define here. |
| `deriveTokenStatus(token: DaemonToken, now: Date)` | `apps/web/src/components/management/tokenStatus.ts` | Returns `'active' \| 'expiring_soon' \| 'expired' \| 'revoked'`. Pure function. Covered by one unit test in Wave 3. |
| `EmptyState` | `apps/web/src/components/management/EmptyState.tsx` (NEW shared component under management) OR reuse Phase 23 `EmptyState` if one was exported — check Wave 0. | Card-styled empty state with optional icon, heading, body, CTA. |

### Directory structure (planner consumes)

```
apps/web/src/
├── pages/
│   ├── AgentsPage.tsx                                           [new]
│   ├── RuntimesPage.tsx                                         [new]
│   └── DaemonTokensPage.tsx                                     [new]
├── components/management/                                        [NEW dir]
│   ├── AgentList.tsx
│   ├── AgentFormDialog.tsx
│   ├── CustomEnvEditor.tsx
│   ├── CustomArgsEditor.tsx
│   ├── ArchiveConfirmDialog.tsx
│   ├── useAgents.ts
│   ├── RuntimeList.tsx
│   ├── KindFilterChips.tsx
│   ├── RuntimeDetailSheet.tsx
│   ├── useRuntimes.ts
│   ├── DaemonTokenList.tsx
│   ├── DaemonTokenCreateModal.tsx
│   ├── RevokeConfirmDialog.tsx
│   ├── useDaemonTokens.ts
│   ├── EmptyState.tsx
│   ├── time.ts
│   └── tokenStatus.ts
└── components/layout/Sidebar.tsx                                [MODIFY — add 3 nav entries]
```

### Route addition (modify `apps/web/src/App.tsx`)

```tsx
const AgentsPage = lazy(() => import('./pages/AgentsPage').then(m => ({ default: m.AgentsPage })));
const RuntimesPage = lazy(() => import('./pages/RuntimesPage').then(m => ({ default: m.RuntimesPage })));
const DaemonTokensPage = lazy(() => import('./pages/DaemonTokensPage').then(m => ({ default: m.DaemonTokensPage })));

// Inside <Route element={<AppLayout />}>, alongside /issues and /issues/:id:
<Route path="/agents" element={<AgentsPage />} />
<Route path="/runtimes" element={<RuntimesPage />} />
<Route path="/daemon-tokens" element={<DaemonTokensPage />} />
```

### Sidebar nav extension (modify `apps/web/src/components/layout/Sidebar.tsx`)

Add three entries to `workspaceItems` array inside `NavMain()`, placed AFTER the existing `/issues` entry:

```tsx
import { Bot, Server, KeyRound } from 'lucide-react';

const workspaceItems: NavItemDef[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
  { to: '/issues', icon: Kanban, label: t('sidebar.issues') },
  { to: '/agents', icon: Bot, label: t('sidebar.agents') },
  { to: '/runtimes', icon: Server, label: t('sidebar.runtimes') },
  { to: '/daemon-tokens', icon: KeyRound, label: t('sidebar.daemonTokens') },
  { to: '/templates', icon: Store, label: t('sidebar.skills') },
  { to: '/assistants', icon: Bot, label: t('sidebar.assistants') },
];
```

**NOTE:** The existing User dropdown already imports `KeyRound` for Credentials — do NOT remove that import; icon is shared. `Bot` is already used for `/assistants` — re-importing is fine (single import at top).

---

## Interaction Contract

### Routing + page boot

- `/agents` → `AgentsPage`; on mount: `GET /api/agents` (active) and `GET /api/agents?includeArchived=true` (archived). Use the active list for the default "Active" tab; compute archived = `includeArchived - active`.
- `/agents?tab=archived` → mount with the Archived tab pre-selected (via `useSearchParams`).
- `/runtimes` → `RuntimesPage`; on mount: `GET /api/runtimes`.
- `/runtimes?kind=daemon` → mount with `kind-filter` pre-selected to `local_daemon` (deep-link support). Query values: `all` (default), `hosted_instance`, `local_daemon`, `external_cloud_daemon`. Chip clicks push `history.pushState` to keep deep links stable.
- `/daemon-tokens` → `DaemonTokensPage`; on mount: `GET /api/daemon-tokens`.

### Keyboard

| Surface | Keyboard Contract |
|---------|-------------------|
| All tables | Native Tab order through focusable cells; row-level click target is the `<tr>` (not the whole row — only title cell). Action dropdown opens on focus + Enter/Space. |
| Agent form Dialog | Escape closes (Radix default); focus trap (Radix default); initial focus on Name input |
| Token copy-once modal | Escape triggers the "Close without saving?" confirmation instead of dismissing directly (see Security Contract); initial focus on Copy button (so one keystroke copies); `Ctrl/Cmd+C` is a natural fallback (plaintext is in a `<pre>` with `select-all`) |
| Custom env / args editors | Enter in the tag input adds; Backspace on empty input removes last tag; `Shift+Tab` cycles back through tags |
| Kind-filter chips | Arrow-left / Arrow-right cycle through chips; Enter/Space activates |
| Revoke confirm | Focus trap to Cancel by default (NOT the destructive Revoke button — per shadcn accessibility guidance) |
| Archive confirm | Focus trap to Cancel by default |

### Clipboard contract (MGMT-03)

```tsx
// Inside DaemonTokenCreateModal (step B only):
async function handleCopy(plaintext: string) {
  try {
    await navigator.clipboard.writeText(plaintext);
    setCopyState('copied');
  } catch {
    // Permissions denied or non-HTTPS context; user falls back to manual select
    setCopyState('failed');
  }
}
```

Fallback: plaintext `<pre>` has `className="... select-all"` so double-click selects the entire token string; user can `Cmd/Ctrl+C` manually even if the Clipboard API is blocked.

### Responsive

| Viewport | Behavior |
|----------|----------|
| ≥ 1024px | Standard desktop table layout; sidebar visible |
| 768px – 1023px | Sidebar collapses to icon-only (existing AppLayout behaviour); table gains horizontal scroll if needed (`overflow-x-auto`). No mobile card-list rewrite — deferred. |
| < 768px | Same as 768–1023px; table scrolls horizontally. Phase 25 is desktop-first; phone-layout redesign is explicitly out of scope (Playwright runs Chromium only). |

### Reduced motion

Existing `@media (prefers-reduced-motion: reduce)` rule in `index.css` already neutralizes animations. No Phase 25 animations add new motion beyond shadcn primitives (which respect the rule by default).

---

## WebSocket Contract (Phase 25 — OPTIONAL)

**Phase 25 does NOT subscribe to WebSocket events in the initial waves**. All three pages use polling / full-refresh on mutation:

- Agents: full refetch on create / update / archive / restore
- Runtimes: 30-second interval poll + full refetch on mount
- Daemon Tokens: full refetch on create / revoke

**OPTIONAL Wave 2 enhancement:** If Phase 16's `runtime:status_changed` WS event is already broadcast, `useRuntimes` MAY subscribe for real-time status updates. This is tagged as a nice-to-have; polling at 30 s is the baseline.

**If subscribed:** use the same `useWebSocket` pattern as Phase 23 + 24 — no new types, no new subscribe verbs. The reconcile pattern is simpler than Phase 23 because there's no drag state to defer.

---

## Security Contract (MGMT-03 HARD INVARIANTS + UI-07 carry-forward)

### 1. Plaintext daemon token (MGMT-03 SHOWN ONCE)

**Invariants enforced by component structure:**

| Invariant | Mechanism | Grep-verifiable |
|-----------|-----------|-----------------|
| Plaintext lives in React state only | `const [plaintext, setPlaintext] = useState<string \| null>(null)` inside `DaemonTokenCreateModal`; cleared via `setPlaintext(null)` on dismiss | — |
| NEVER written to `localStorage` | No `localStorage` or `sessionStorage` references in `apps/web/src/components/management/*` | `rg "localStorage\|sessionStorage" apps/web/src/components/management` → 0 matches |
| NEVER embedded in URL | No `navigate()` or `history.push` call with plaintext in path or query | `rg "token=\$\{.*plaintext" apps/web/src/components/management` → 0 matches; `rg "\?.*token" apps/web/src/components/management/DaemonTokenCreateModal.tsx` → 0 matches of plaintext interpolation |
| NEVER logged to console | No `console.log` in the modal component | `rg "console\\.(log\|warn\|error).*plaintext" apps/web/src/components/management/DaemonTokenCreateModal.tsx` → 0 matches |
| NEVER set as `document.title` | No `document.title =` mutation | `rg "document\\.title" apps/web/src/components/management` → 0 matches |
| NEVER escapes via props callback | Parent `onCreated(token: DaemonToken)` callback receives the `DaemonToken` projection (no `plaintext` field — see `packages/shared/src/v14-types.ts:173-185`) | Type-level enforcement — `DaemonToken` has no `plaintext` key |
| NEVER inserted via `dangerouslySetInnerHTML` | Plaintext rendered as React text child inside `<pre>` | `rg "dangerouslySetInnerHTML" apps/web/src/components/management` → 0 matches |
| Dismiss clears the state | `onDismiss()` calls `setPlaintext(null)` before `onOpenChange(false)` | — |
| Escape key does NOT silently lose plaintext | Intercept Dialog's `onOpenChange(false)` while `plaintext !== null` — show `ConfirmCloseDialog`; user must explicitly confirm close | UX invariant, not grep-verifiable |
| a11y announcer does NOT embed plaintext | `management.daemonTokens.a11y.copied` key is `"Token copied to clipboard"` — no `{{plaintext}}` interpolation | Locale-file grep: `rg "\{\{plaintext\}\}" apps/web/src/i18n/locales` → 0 matches |

**CI guard to add in Wave 0:**

Extend `.github/workflows/ci.yml` (or the existing dangerously-set-innerHTML grep from Phase 24) with:

```yaml
- name: Verify plaintext token never leaks to browser storage
  run: |
    ! grep -rE "localStorage|sessionStorage" apps/web/src/components/management
- name: Verify no dangerouslySetInnerHTML in management pages
  run: |
    ! grep -rE "dangerouslySetInnerHTML" apps/web/src/components/management
```

### 2. React XSS (carry-forward from Phase 24 UI-07)

- NEVER `dangerouslySetInnerHTML` anywhere in `apps/web/src/components/management/**`
- `agent.instructions` rendered via plain `<textarea>` in the form. A hypothetical future "preview" pane would use the `SafeMarkdown` component from `apps/web/src/components/issues/detail/markdown.tsx` (react-markdown + rehype-sanitize) — out of Phase 25 scope.
- `runtime.deviceInfo` rendered via `JSON.stringify(deviceInfo, null, 2)` inside `<pre>` — auto-escaped
- `agent.name` / `runtime.name` / `daemonToken.name` rendered as plain React text — auto-escaped
- Any URL-like content (e.g., `deviceInfo.hostname` inside tooltip) rendered as text, never as `href`

### 3. Archive semantics (MGMT-01)

- Archive calls `DELETE /api/agents/:id` (server-side soft-archive per Phase 17 — sets `archived_at`)
- Restore calls `POST /api/agents/:id/restore`
- Archived agents are filtered OUT of the default Active tab; appear in the Archived tab (via `GET /api/agents?includeArchived=true` client-side split)
- Confirmation copy explicitly says "preserves all historical tasks and comments" — sets user expectation correctly
- Archive does NOT cascade-cancel queued tasks (per Phase 17 summary — soft-archive preserves FKs). Confirmation copy mentions "queued tasks stay in the queue" to make the behaviour explicit.

### 4. Unified runtimes list (MGMT-02)

- Do NOT split hosted and daemon runtimes into separate routes or separate server calls
- Single `GET /api/runtimes` populates one list; kind filter is client-side
- Chip group uses radio semantics (exactly one active filter at a time; "All" is the fourth option)
- Deep-link via `?kind=hosted_instance|local_daemon|external_cloud_daemon|all` — preserves state on share / refresh

### 5. i18n parity (UI-08 carry-forward)

- All new strings ship in all 6 locales before merge
- Wave 0 adds the full `en` namespace + 5-locale **placeholder** copies (just copy the en values) so `check-i18n-parity.mjs` stays green through feature waves
- Wave 4 translates zh / fr / de / es / it for real
- CI enforces parity — no new keys can exist in `en.json` without matching structure in the other five

---

## Design Tokens Summary (added / used)

**No new CSS variables introduced by Phase 25.** Everything reuses the Phase 23 ladder + Oxide palette.

**Reused:**
- Spacing: Tailwind v4 defaults (4-point grid) + `--space-*` CSS vars
- Color: `--background`, `--card`, `--muted`, `--border`, `--primary`, `--destructive`, `--ring`, plus all `--color-*-subtle-*` status tints
- Typography: `--font-sans`, `--font-serif`, `--font-mono`
- Z-index: `--z-base`, `--z-sticky`, `--z-sidebar`, `--z-modal`, `--z-toast`

**New i18n namespaces:**
- `management.agents.*` (~70 keys)
- `management.runtimes.*` (~30 keys)
- `management.daemonTokens.*` (~40 keys)
- 3 new keys under existing `sidebar.*`

Total approx. 143 new keys × 6 locales = 858 locale entries. Wave 0 ships `en` + 5-locale placeholder dup; Wave 4 ships real translations.

---

## Data-Attribute Markers (for Playwright)

Playwright selectors for the Phase 25 spec (`tests/e2e/management-uis.spec.ts`):

### Shared

| Marker | Applied to | Used by scenario |
|--------|------------|-------------------|
| `data-page="agents"` | `AgentsPage` root `<main>` | `sidebar nav` assert-page-loaded |
| `data-page="runtimes"` | `RuntimesPage` root | — |
| `data-page="daemon-tokens"` | `DaemonTokensPage` root | — |

### Sidebar

| Marker | Applied to | Used by scenario |
|--------|------------|-------------------|
| `data-nav="agents"` | Sidebar `<SidebarMenuButton>` for `/agents` | `sidebar nav` |
| `data-nav="runtimes"` | Sidebar button for `/runtimes` | `sidebar nav` |
| `data-nav="daemon-tokens"` | Sidebar button for `/daemon-tokens` | `sidebar nav` |

### Agents

| Marker | Applied to | Used by scenario |
|--------|------------|-------------------|
| `data-agent-row={id}` | Each `<tr>` in `AgentList` | `agents list renders`, `agent archive`, `agent form create` (find created row) |
| `data-agent-tab={active\|archived}` | Tabs trigger | `agent archive` (switch to Archived tab, assert row present) |
| `data-agent-action={edit\|archive\|restore}` | DropdownMenuItem within row | `agent archive` (click archive), `agent form create` (click edit) |
| `data-agent-form-submit` | Save / Create button in form | `agent form create` |
| `data-agent-form-cancel` | Cancel button | `agent form create` (defensive) |
| `data-agent-form-field={name\|instructions\|runtime\|maxConcurrent}` | Corresponding Input / Textarea / Select trigger | `agent form create` (fill fields) |
| `data-agent-env-add` | `+ Add variable` button | `agent form create` (add env row) |
| `data-agent-env-row={index}` | Each env row container | `agent form create` |
| `data-agent-args-input` | Custom args text input | `agent form create` |
| `data-agent-archive-confirm` | Confirm button in archive dialog | `agent archive` |
| `data-agent-restore-confirm` | Confirm button in restore dialog | (future) |

### Runtimes

| Marker | Applied to | Used by scenario |
|--------|------------|-------------------|
| `data-runtime-row={id}` | Each `<tr>` in `RuntimeList` | `runtimes unified list`, `runtime row details` |
| `data-runtime-kind={hosted_instance\|local_daemon\|external_cloud_daemon}` | Each row (same `<tr>`, additional attribute) | `runtimes unified list` (assert all three kinds present) |
| `data-kind-filter={all\|hosted_instance\|local_daemon\|external_cloud_daemon}` | Each `KindFilterChips` chip button | `runtimes unified list` (click filter) |
| `data-runtime-device-tooltip` | Truncated device cell (tooltip trigger) | `runtime row details` |
| `data-runtime-detail-sheet` | Sheet content when open | `runtime row details` (open detail drawer) |

### Daemon Tokens

| Marker | Applied to | Used by scenario |
|--------|------------|-------------------|
| `data-token-row={id}` | Each `<tr>` in `DaemonTokenList` | `token revoke`, `token copy once` (assert list updated) |
| `data-token-status={active\|expiring_soon\|expired\|revoked}` | Each row | `token copy once` (assert newly-created token shows active) |
| `data-token-create-open` | "New token" page button | `token create form`, `token copy once` |
| `data-token-form-field={name\|expiresAt}` | Form inputs | `token create form` |
| `data-token-form-submit` | Create button | `token create form`, `token copy once` |
| `data-token-plaintext` | `<pre>` block in step B (visible only during copy-once state) | `token copy once` (assert plaintext appears) |
| `data-token-copy-button` | Copy to clipboard button | `token copy once` (optional — can also test via sr-announcer) |
| `data-token-dismiss` | "I've saved it" button | `token copy once` (click dismiss, then assert plaintext element absent) |
| `data-token-close-confirm-ok` | Confirm-close Dialog ok button | (edge case — attempt-to-close-without-dismiss) |
| `data-token-revoke-open={id}` | Revoke action menu item | `token revoke` |
| `data-token-revoke-confirm` | Revoke dialog confirm button | `token revoke` |

---

## Interaction Flows (page-by-page narrative)

### Agents page (MGMT-01)

1. **Mount** → `GET /api/agents` (active) + `GET /api/agents?includeArchived=true`; split into `active` and `archived` arrays client-side. Render Active tab by default.
2. **Create agent:** Click "New agent" → `AgentFormDialog` opens in `mode='create'`. User fills name (required), instructions (markdown textarea), runtime (Select from `runtimes`), custom env (key-value rows), custom args (tag input), max concurrent (number input 1..16, default 1). Client-side validation. Click Create → `POST /api/agents` → on 201 refetch list, close dialog, toast "Agent saved", sr-announce "Agent ... saved". On 400 (UNIQUE collision, validation) surface the error inline above the form. On 500 toast error.
3. **Edit agent:** Click row or click "Edit" in row menu → `AgentFormDialog` opens in `mode='edit'` pre-populated. Click Save → `PATCH /api/agents/:id` → refetch + close.
4. **Archive agent:** Click "Archive" in row menu → `ArchiveConfirmDialog` opens. Title uses `agent.name`. Body explains reversibility. Confirm → `DELETE /api/agents/:id` → refetch + toast + sr-announce. Archived row disappears from Active tab, appears in Archived tab.
5. **Restore agent:** Archived tab → click "Restore" on row → restore confirm dialog → `POST /api/agents/:id/restore` → refetch + toast.

### Runtimes page (MGMT-02)

1. **Mount** → `GET /api/runtimes`. Set default filter from `?kind=` query param. Render kind-filter chip group (with live counts) + table.
2. **Filter:** Click a chip → filter `runtimes` client-side to that kind (or show all); push `history.pushState({}, '', '?kind=...')`. Clear-filter link in no-match empty state.
3. **Poll:** Every 30 s refetch `GET /api/runtimes`. Dedupe by id and diff-apply so row references stay stable (important for the WS-subscribe Wave 2 upgrade).
4. **Row click:** Open `RuntimeDetailSheet` with the full `Runtime` shape + pretty-printed `device_info` and `metadata`. Sheet is read-only (no create/edit — runtimes are managed server-side only).

### Daemon Tokens page (MGMT-03)

1. **Mount** → `GET /api/daemon-tokens`. Compute derived status per row via `deriveTokenStatus(token, now)`.
2. **Create token:** Click "New token" → `DaemonTokenCreateModal` opens in step A (form). User fills friendly name (required, max 100 chars) and optional expiry via `<input type="date">` (cleared → null → "Never"). Click "Create token" → `POST /api/daemon-tokens` with `{ name, expiresAt }` → on 200 `{ token, plaintext }`:
   - Modal transitions to step B (copy-once view)
   - `plaintext` is stored in local `useState` only — NEVER in localStorage, sessionStorage, URL, or document.title
   - Parent's `onCreated(token)` callback fires with the `DaemonToken` projection only (no plaintext field — type-enforced)
   - Copy button: `await navigator.clipboard.writeText(plaintext)`; on success set `copyState='copied'` + sr-announce; on failure show `copyState='failed'` (user can still manually select the `<pre>` which uses `select-all`)
   - User clicks "I've saved it" → `setPlaintext(null)` → `onOpenChange(false)` → modal unmounts → list refetches (the new row appears with status=active)
   - If user attempts to close without dismissing (Escape / click-outside / X button): show `ConfirmCloseDialog` — "Close without saving the token?" — user must explicitly confirm close (which clears plaintext) OR cancel (returns to step B)
3. **Revoke token:** Click "Revoke" in row menu → `RevokeConfirmDialog` → Confirm → `DELETE /api/daemon-tokens/:id` → refetch (row's derived status flips to `revoked`) + toast.
4. **Expired rendering:** Client-side `deriveTokenStatus` watches `expiresAt`; rows automatically show the expired badge once the date passes. No server action — the server already blocks auth with an expired token.

---

## Loading + Error States

Every page must handle four states. Contracts below.

### Loading

| State | Presentation |
|-------|--------------|
| Initial load (no data yet) | 5–7 skeleton rows via `<Skeleton>` primitives, same column layout as the real table |
| Mutation pending (e.g., Archive in-flight) | Confirm button shows inline spinner `t('common.buttons.saving')`; dialog does NOT close until server confirms |
| Create token pending | Create button shows `management.daemonTokens.createModal.actions.creating`; other inputs are disabled |

### Empty

Every page has an empty state with:
- Small card (not full-page wipe)
- Heading (h2) + 1 sentence body + primary CTA
- Icon appropriate to the domain (`Bot` for Agents, `Server` for Runtimes, `KeyRound` for Daemon Tokens) at 48px, `text-muted-foreground`, above heading

### No matches (filter / search)

Tables with a search or filter in play AND empty results show:
- Muted centered text `management.*.noMatches.heading`
- `Clear search/filter` button (restore to default filter)

### Error

| State | Presentation |
|-------|--------------|
| Initial load failed | Full-page card with `management.*.loadFailed` heading + retry button (triggers refetch) |
| Mutation failed (save / archive / revoke) | Toast.error with the server-provided error message OR a canonical `*.saveFailed` / `*.archiveFailed` / `*.revokeFailed` key; modal/dialog stays open so user can retry |

---

## Dimensional Summary (for checker)

| Dimension | Compliance |
|-----------|-----------|
| **Copywriting** | ~143 keys across 3 namespaces + 3 sidebar keys. Every CTA is verb+noun ("New agent", "Revoke token", "Archive agent"). Empty states specify next step. Error copy explains the problem + a solution path. Destructive confirmations follow the Phase 24 pattern (title = `{action}?`, destructive variant button). Copy-once modal has explicit reversibility copy ("can't be shown again"). |
| **Visuals** | 18 components inventoried across 3 pages + directory layout. All primitives reused from shadcn — no hand-rolled UI. Two-step modal (token create + copy-once) documented. Empty/loading/error states specified per page. Data-attribute markers complete for Playwright. |
| **Color** | 60/30/10 split applied verbatim from Phase 23. Accent reserved for exactly 6 elements (CTAs + focus ring + selected tab/chip + row hover). Per-runtime-kind, per-runtime-status, per-token-status badges all use existing `--color-*-subtle-*` tokens. Dark mode inherits via `:root.dark`. |
| **Typography** | 5 sizes (11 / 12 / 14 / 20 / 28) and 3 weights (400 / 500 / 600). Inherits Phase 23 + 24 rules. Mono font used only for device_info JSON and plaintext token. CJK override already works via `index.css`. |
| **Spacing** | All values on 4-point grid. Page layout, dialog layout, form field gaps, and tag/row gaps all specified. No exceptions. |
| **Registry Safety** | shadcn primitives already present (no new `npx shadcn add` calls). No third-party registries declared. Safety gate: not applicable — NOT INVOKED. |

---

## Hard-Invariant Summary (scoped to Phase 25)

| Invariant | Mechanism | Grep / CI Guard |
|-----------|-----------|-----------------|
| **Plaintext daemon token lives only in React state** (MGMT-03) | `useState<string \| null>` inside `DaemonTokenCreateModal`; cleared on dismiss; type-enforced via `DaemonToken` projection | `rg "localStorage\|sessionStorage" apps/web/src/components/management` → 0 matches (CI step) |
| **No `dangerouslySetInnerHTML`** (UI-07 carry-forward) | Only React text children + `SafeMarkdown` reuse | `rg "dangerouslySetInnerHTML" apps/web/src/components/management` → 0 matches (CI step) |
| **Plaintext never announced via a11y live region** | `management.daemonTokens.a11y.copied` interpolates NO plaintext | Locale grep — `rg "\{\{plaintext" apps/web/src/i18n/locales` → 0 matches |
| **Unified runtimes list** (MGMT-02) | Single `/runtimes` route, single `GET /api/runtimes`, chip filter is client-side | Route count: `rg "runtimes/hosted\|runtimes/daemon" apps/web/src/App.tsx` → 0 |
| **i18n parity for all new keys** (UI-08) | Wave 0 ships placeholders; Wave 4 translates; CI runs `check-i18n-parity.mjs` | `node apps/web/scripts/check-i18n-parity.mjs` → exit 0 |
| **Archive is soft (FK-preserving)** (MGMT-01) | Client calls `DELETE /api/agents/:id` which the server soft-archives (per Phase 17); confirmation copy explicitly says "historical tasks preserved" | Server-side invariant; UI behaviour tested via `agent archive` Playwright scenario + re-verifying row appears in Archived tab |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official (via pre-installed primitives) | `button`, `card`, `badge`, `dialog`, `dropdown-menu`, `input`, `popover`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `table`, `tabs`, `tooltip` | Not required — primitives present in repo from prior phases; Phase 25 adds no new `npx shadcn add` invocations |
| None (third-party) | — | Not applicable — no third-party registry declared |

**Third-party block safety gate:** NOT INVOKED — no third-party registries in scope for Phase 25.

**Non-registry npm deps (UI libraries):** none added in Phase 25. All dependencies present from prior phases:

| Package | Version | Phase introduced |
|---------|---------|--------------------|
| `react` | 19.2.0 | pre-existing |
| `react-dom` | 19.2.0 | pre-existing |
| `react-i18next` | 16.5.8 | pre-existing |
| `i18next` | 25.8.18 | pre-existing |
| `lucide-react` | ^0.577.0 | pre-existing |
| `react-router-dom` | pre-existing | |
| `sonner` | 2.0.7 | pre-existing |
| `react-markdown` + `rehype-sanitize` + `remark-gfm` | pre-existing (Phase 24 confirmed) | |

---

## Pre-Populated From

| Source | Decisions Used |
|--------|----------------|
| ROADMAP.md (Phase 25 block) | 4 SCs (Agents page contract, Runtimes unified list, Daemon Tokens copy-once + list + revoke, i18n parity across 6 locales) |
| REQUIREMENTS.md | MGMT-01 (agent browse/create/edit/archive + form fields), MGMT-02 (unified runtimes list with status badges + kind filter), MGMT-03 (token issue w/ name + optional expiry + copy once + revoke); DAEMON-10 (plaintext-once wire contract); UI-08 carry-forward (i18n parity) |
| 25-VALIDATION.md | 12-row Verification Map (Wave 0–4 task IDs, Playwright scenario names, i18n parity requirement); data-attribute marker naming |
| 23-UI-SPEC.md | Design system (preset, component primitives, fonts); spacing scale; color palette (Oxide hsl vars, accent reserved list pattern); z-index ladder (reused verbatim); i18n 6-locale + parity script; sidebar nav pattern + lucide icon convention |
| 24-UI-SPEC.md | Component inventory structure; ReconnectBanner pattern (not reused here — but the sr-announcer pattern is inherited); destructive-confirmation Dialog pattern; SafeMarkdown reuse for any future instructions preview; `data-*` attribute naming convention; Dialog sizing defaults; sticky composer vs modal pattern |
| Phase 16 summaries | `runtimes` table shape — kinds = hosted_instance / local_daemon / external_cloud_daemon; derived status via JOIN for hosted_instance (status auto-updates via poll); `device_info` JSON; `last_heartbeat_at` timestamp semantics |
| Phase 17 summaries | Agent fields — name / instructions / runtime_id / custom_env / custom_args / max_concurrent_tasks (1..16) / visibility / archived_at / archived_by; soft-archive preserves FKs |
| Phase 19 summaries | Daemon tokens: POST returns plaintext exactly once as `{ token: DaemonToken, plaintext: 'adt_...' }`; GETs return `DaemonToken` projection with no plaintext or hash; DELETE is idempotent; expiresAt optional; name max 100 chars |
| apps/server/src/routes/agents.ts | Confirmed endpoints: GET /, GET /:id, POST /, PATCH /:id, DELETE /:id (soft-archive), POST /:id/restore; validation error → 400 |
| apps/server/src/routes/runtimes.ts | Confirmed endpoints: GET /, GET /:id; returns `Runtime[]` with derived status for hosted_instance |
| apps/server/src/routes/daemon-tokens.ts | Confirmed endpoints: POST / → `DaemonTokenCreatedResponse`, GET /, DELETE /:id (idempotent); name required + max 100 |
| packages/shared/src/v14-types.ts | Exact type shapes for `Agent`, `Runtime` (RuntimeKind / RuntimeProvider / RuntimeStatus / RuntimeDeviceInfo), `DaemonToken`, `DaemonTokenCreatedResponse` |
| apps/web/src/App.tsx | Lazy-load + `<Route element={<AppLayout />}>` pattern — 3 new routes plug in alongside `/issues` and `/issues/:id` |
| apps/web/src/components/layout/Sidebar.tsx | `workspaceItems` array extension pattern; lucide-react icon convention (`Bot`, `Server`, `KeyRound` selected) |
| apps/web/src/components/ui/*.tsx | Confirmed presence of all 17 shadcn primitives required by this phase |
| apps/web/src/api.ts | Centralized `api.get` / `api.post` / `api.patch` / `api.delete` wrapper reused in all hooks (`useAgents`, `useRuntimes`, `useDaemonTokens`) |
| apps/web/src/i18n/locales/en.json | Existing `sidebar.*` + `common.buttons.*` keys reused; 3 new keys added to `sidebar`; `management.*` root added |
| apps/web/scripts/check-i18n-parity.mjs | Existing parity script consumed verbatim; Wave 0 adds `management.*` keys to `en` + placeholder dup to zh/fr/de/es/it to keep CI green |
| CLAUDE.md | i18n 6-locale rule; `apps/web/src/api.ts` wrapper (no raw `fetch`); CSS tokens only (no hardcoded colors); ESM `.js` extension rule (server-side, not web) |
| Auto-mode defaults (supplied in orchestrator prompt) | Routes `/agents`, `/runtimes`, `/daemon-tokens`; sidebar icons (Bot / Server / KeyRound); page layout (header + toolbar + table + empty state); form fields + validation; copy-once flow; 5-wave plan outline |
| User input | None — `--auto` mode; no interactive questions asked |

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
