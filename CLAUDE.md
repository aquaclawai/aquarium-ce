# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aquarium CE (Community Edition) -- a self-hosted AI agent management platform. TypeScript monorepo with Express backend, React frontend, SQLite database, and Docker runtime.

**Tech Stack**: Node.js 22+, TypeScript 5.7+, Express 4, React 19, SQLite (via better-sqlite3), Docker

## Monorepo Structure

```
apps/server/     -> @aquaclawai/aquarium  (Express backend + CLI, port 3001)
apps/web/        -> @aquarium/web         (React + Vite frontend, port 5173)
packages/shared/ -> @aquarium/shared      (Shared TypeScript types)
tests/e2e/       -> Playwright E2E tests
openclaw/        -> Gateway Docker image build (Makefile + templates)
```

Sub-module guidance: `apps/server/src/AGENTS.md`, `apps/web/src/AGENTS.md`, and deeper (`services/`, `runtime/`, `agent-types/`).

## Build & Run Commands

```bash
# Setup & dev
npm install                                    # From root (npm workspaces)
npm run dev                                    # Backend only (port 3001, tsx watch)
npm run dev:web                                # Frontend only (port 5173, Vite)

# IMPORTANT: Build shared FIRST -- server and web depend on it
npm run build -w @aquarium/shared     # tsc -> packages/shared/dist/

# Database
npm run migrate -w @aquaclawai/aquarium   # Run pending migrations
npm run migrate:make -w @aquaclawai/aquarium -- migration_name

# Type checking & builds
npm run typecheck                     # Build shared + typecheck server (tsc --noEmit)
npm run lint                          # Lint web (ESLint 9 flat config, no linter for server)
npm run build                         # Full build: shared -> server -> web (CE)

# Workspace-specific builds
npm run build -w @aquarium/web        # tsc -b && vite build (standard)
npm run build:ce -w @aquarium/web     # tsc -b && vite build --config vite.config.ce.ts (CE-specific)
npm run build -w @aquaclawai/aquarium # tsc -> apps/server/dist/

# CLI (run locally)
npx .                                 # Runs CLI from local build
```

Note: Server dev command requires `NODE_OPTIONS=--no-experimental-require-module` (set automatically by the `dev` script).

### Pre-push Checks

Run the same checks as CI (`.github/workflows/ci.yml` runs on push/PR to main):
```bash
npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium & npm run lint -w @aquarium/web & wait
```

### Releasing

Releases are published via GitHub Actions CI/CD (`.github/workflows/release.yml`), **not** via local `npm publish`. To release:

1. Bump version in `apps/server/package.json`
2. Commit: `git commit -m "chore: bump version to X.Y.Z"`
3. Tag and push: `git tag vX.Y.Z && git push origin main --tags`

The `v*` tag triggers the release workflow which publishes to npm (`@aquaclawai/aquarium`) and pushes a Docker image to `ghcr.io/aquaclawai/aquarium`.

## Testing

Playwright only. No unit tests. Config at root `playwright.config.ts` (Chromium only, `fullyParallel: true`). Vite dev server auto-starts via `webServer` config. Server must be running separately.

```bash
npx playwright test                             # All tests
npx playwright test tests/e2e/api.spec.ts       # Single file
npx playwright test -g "should create instance" # By test name grep
npx playwright test --headed                    # Watch in browser
npx playwright test --debug                     # Step-through debugger
```

**CI mode** (`CI=true`): retries=2, workers=1, skips tests requiring Docker or external services (instance-lifecycle, litellm-lifecycle, credential-secretref, oauth-smoke, etc.).

## Code Style

### ESM Import Rules (CRITICAL)

Server `.ts` imports MUST use `.js` extension (NodeNext ESM resolution). Web app does NOT (Vite resolves bare specifiers).
```typescript
// apps/server/
import { config } from './config.js';  // REQUIRED
import { config } from './config';     // WRONG - runtime crash

// apps/web/
import { api } from './api';           // Vite handles this
```

### Import Order

1. Node builtins (`node:fs`) -> 2. External (`express`) -> 3. Workspace (`@aquarium/shared`) -> 4. Local (`./config.js`) -> 5. Type-only (`import type`)

### TypeScript

- Root `tsconfig.json`: `target: ES2022`, `module: NodeNext`, `strict: true`
- **Never** `any` -- use `unknown` + type guards
- `interface` for shapes, `type` for unions/intersections
- All API responses: `ApiResponse<T>` -> `{ ok: boolean, data?: T, error?: string }`
- Shared types in `packages/shared/src/types.ts` -- import as `@aquarium/shared`

### Naming

| Category | Convention | Example |
|----------|-----------|---------|
| Variables/functions | `camelCase` | `getInstance` |
| Types/interfaces | `PascalCase` | `InstanceStatus` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Files (server TS) | `kebab-case.ts` | `instance-manager.ts` |
| Files (React) | `PascalCase.tsx` | `DashboardPage.tsx` |
| DB columns | `snake_case` | `created_at` |

### Error Handling

- Routes: try/catch -> `{ ok: false, error: message }`
- Never: empty catch blocks, `as any`, `@ts-ignore`, `@ts-expect-error`

### Server Patterns

- **Request flow**: Routes -> Services -> Runtime/DB. Never call runtime or DB from route handlers directly.
- **Config**: `config` object from `apps/server/src/config.ts` -- never `process.env` directly
- **Database**: Knex query builder via DbAdapter, always parameterized -- never string-concat SQL. CE uses SQLite.
- **Instance lifecycle**: Only through `InstanceManager` -- never update `instances.status` directly.
- **Routes**: 23 files in `src/routes/`, thin controllers calling service functions. Each exports a default router.

### Frontend Patterns

- Functional components, named exports: `export function ComponentName() {}`
- Props interface above component, one component per file
- Global state via Context (`AuthContext`, `WebSocketContext`)
- CSS variables from Oxide design system (`index.css`) -- no Tailwind, no component library
- Use `var(--color-primary)` etc. -- never hardcode colors. Supports light + dark themes.
- API calls via centralized `api.ts` wrapper -- never raw `fetch()`
- **i18n**: `react-i18next` with 6 locales (`en`, `zh`, `fr`, `de`, `es`, `it`) in `apps/web/src/i18n/locales/`. All user-facing strings use `t('key')`. When adding/modifying text, update ALL locale files.

## Architecture

### CE-Specific Details

- **Database**: SQLite via better-sqlite3 (file at `~/.aquarium/aquarium.db`)
- **Auth**: Cookie-based JWT auth (no external auth provider)
- **Entry point**: `apps/server/src/cli.ts` -> `apps/server/src/index.ce.ts` -> `server-core.ts`
- **CLI flags**: `--port`, `--data-dir`, `--host`, `--open`
- **npm package**: Published as `@aquaclawai/aquarium` -- run with `npx @aquaclawai/aquarium`

### Key Flows
- **Server startup** (ORDER-SENSITIVE): `db.migrate.latest()` -> state reconciliation -> health monitor -> gateway event relay -> HTTP + WS server
- **Request flow**: Routes (HTTP parsing) -> Services (business logic) -> Runtime/DB
- **Instance states**: `created` -> `starting` -> `running` -> `stopping` -> `stopped`; any -> `error`
- **Runtime abstraction**: `RuntimeEngine` interface -> Docker or K8s via `RuntimeEngineFactory.getEngine()`. Never import engines directly.
- **Docker network**: Requires pre-created `openclaw-net` bridge network. Port range 19000-19999 for instance containers.
- **WebSocket events**: Service emits -> WS server broadcasts -> Frontend `WebSocketContext` receives

### Key Files
- `apps/server/src/services/instance-manager.ts` -- Instance lifecycle (only place that transitions state)
- `apps/server/src/config.ts` -- Centralized env config (only place to read `process.env`)
- `apps/server/src/runtime/factory.ts` -- Runtime engine factory
- `apps/server/src/agent-types/registry.ts` -- Agent type registry
- `apps/server/src/db/adapter.ts` -- Database abstraction layer (DbAdapter)
- `apps/server/src/db/sqlite-adapter.ts` -- SQLite implementation
- `apps/server/src/cli.ts` -- CLI entry point
- `apps/server/src/index.ce.ts` -- CE server entry point
- `packages/shared/src/types.ts` -- All shared TypeScript types
- `apps/web/src/index.css` -- Design system CSS tokens (Oxide)
- `apps/web/src/api.ts` -- Centralized fetch wrapper

## Manual UAT via Chrome DevTools MCP

Use `chrome-devtools-mcp` to drive the running app as a real user when a
human walkthrough is what you need (finding visible bugs, reproducing a
UI regression, exercising keyboard a11y, spot-checking across all 6
locales). This is a live recipe — steps here have been run end-to-end
and surfaced five real bugs in one session.

### Prerequisites

- **Express API running on :3001.** `npm run dev` (the script sets
  `NODE_OPTIONS=--no-experimental-require-module`). If the port is busy
  with a stale process, `lsof -ti:3001` and `kill <pid>`; Playwright's
  webServer config reuses the existing one when `CI` is unset but the
  Express side is separate.
- **Vite web on :5173.** `npm run dev:web`. Only needed for MCP UAT —
  Playwright starts it automatically, MCP does not.
- **MCP Chrome profile clean.** The server-launched Chrome lives at
  `~/.cache/chrome-devtools-mcp/chrome-profile`. If `mcp__chrome-devtools__new_page`
  errors with *"The browser is already running for …/chrome-profile"*, a
  prior MCP Chrome is still alive. Find it:
  `ls -la ~/.cache/chrome-devtools-mcp/chrome-profile/SingletonLock`
  points at `s-MacBook-…-<PID>`. `kill <PID>` then retry the tool.

### Typical walkthrough skeleton

1. **Open the app.** `mcp__chrome-devtools__new_page` with
   `url: http://localhost:5173`. In CE the auto-auth middleware signs
   you in as the first `users` row (`admin@localhost` on a fresh DB).
2. **Get structure via snapshot, pixels via screenshot.** Prefer
   `take_snapshot` — it returns the accessibility tree with stable
   `uid` handles you pass to `click` / `fill` / `fill_form`. Use
   `take_screenshot` (`filePath: /tmp/<label>.png` + `fullPage: true`)
   only when you need visual confirmation or to spot a bug the a11y
   tree hides (icons, hover states, badge colors). Then `Read` the PNG
   to see what the browser rendered.
3. **Interact — snapshot → click → snapshot.** Every click can change
   `uid`s; pass `includeSnapshot: true` on click/fill to fold the
   post-state snapshot into the same tool call. For keyboard flows
   (drag-and-drop, tab focus), MCP's `click` fires a real mousedown
   which may navigate before a `press_key` can fire — grab focus via
   `evaluate_script` (`document.querySelector('…').focus()`) first,
   then `press_key`. This is how the kanban DnD got verified:
   focus the sortable, `Space` to grab, `ArrowRight` to move column,
   `Space` to drop, read the `aria-live` announcement.
4. **Check the plumbing.** After any mutation, pull
   `list_console_messages({ types: ['error','warn'] })` and
   `list_network_requests({ resourceTypes: ['fetch','xhr'] })`. 200/304
   on every API call + no console errors is the baseline; anything
   else is a bug or a latent one.
5. **Poke at specific pages.** Hit each sidebar entry. In this repo
   the seven worth exercising are: Chat, Issues, Agents, Runtimes,
   Daemon Tokens, Dashboard, and an Issue detail page. Every create
   surface (button, dialog) should be present and wired; every list
   should be filterable if it can grow unbounded.
6. **Sanity-check via curl when the UI is unclear.** E.g. if the page
   renders a raw UUID, `curl -s http://localhost:3001/api/issues/<id>`
   tells you whether the bug is on the serializer or the client.
   Reproduce the failing interaction via curl before editing code.

### Signals worth chasing

- **Raw IDs in the UI.** If you see a UUID, almost certainly the
  serializer didn't LEFT JOIN the source row — check the relevant
  `*-store.ts` `to*()` function and its query paths.
- **Literal `{{placeholder}}` strings.** i18n key expected an
  interpolation option that the caller didn't pass. Grep the key in
  `apps/web/src/i18n/locales/en.json` + its call sites in
  `apps/web/src/components/**`.
- **"X time ago" that looks off by hours.** SQLite stores
  `YYYY-MM-DD HH:MM:SS` (UTC, no TZ) via `db.fn.now()`; the client
  parses as local. Pipe through `toIsoUtc()` in
  `apps/server/src/db/timestamps.ts` from every affected serializer.
- **A management page without a create or search control.** Compare
  against Agents and Runtimes which already have both — missing
  controls are Phase-23/25 gaps, not platform constraints.
- **Count mismatches after a mutation.** If the list count briefly
  doubles then settles, you're probably optimistically prepending +
  letting the WebSocket echo land a duplicate. De-dupe by `id` in the
  `setState` reducer.

### Don't waste moves

- Don't reach for `take_screenshot` for state inspection — the
  accessibility `take_snapshot` is cheaper and usable by `click` /
  `fill`. Screenshots are for rendering, not navigation.
- Don't try to recreate the Playwright suite in MCP — Playwright is
  for regression (fast, headless, deterministic), MCP is for
  exploratory "as a user" work. One run surfaces bugs Playwright
  couldn't see because the tests never rendered the broken path.
- Don't trust the page `reload` to reset server state. Restart the
  Express server (kill, `npm run build -w @aquarium/shared`,
  `npm run dev`) after any change to serializers, migrations, or
  middleware — otherwise you'll see stale output that looks like your
  fix didn't land.

## Common Pitfalls

- **Build shared first**: `packages/shared` must be built before server typecheck or web build. CI does this automatically, but manual runs need it.
- **Build artifacts in src/**: `tsc -b` from root generates `.js`/`.d.ts` in `src/` dirs, breaking Vite and Knex. Clean with: `find apps/web/src apps/server/src -name "*.js" -o -name "*.d.ts" -o -name "*.js.map" | xargs rm`
- **Gateway schema strictness**: `additionalProperties: false` -- do NOT add unknown fields to gateway configs. `client.id` for event relay MUST be `'gateway-client'`.
- **Credential placeholders**: `${CREDENTIAL:provider:type}` in MCP configs -> resolved at startup via `adapter.ts`. 3-layer resolution: instance creds -> user vault -> error.
- **Migration numbering**: 35 migrations with duplicate numbers at 021 and 027 from merge conflicts. Always check existing migration files before creating new ones.
- **Stub agent types**: `opencode` and `claude-code` have manifests but NO adapters. Code calling adapter methods must null-check: `agentType.adapter?.seedConfig?.(...)`.
