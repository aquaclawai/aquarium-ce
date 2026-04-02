# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Project Overview

Aquarium CE (Community Edition) -- a self-hosted AI agent management platform. TypeScript monorepo with Express backend, React frontend, SQLite database, and Docker runtime.

**Tech Stack**: Node.js 22+, TypeScript 5.7+, Express 4, React 19, SQLite (via better-sqlite3), Docker

## Monorepo Structure

```
apps/server/     -> @aquarium/server  (Express backend, port 3001)
apps/web/        -> @aquarium/web     (React + Vite frontend, port 5173)
packages/shared/ -> @aquarium/shared  (Shared TypeScript types)
tests/e2e/       -> Playwright E2E tests
openclaw/        -> Gateway Docker image build (Makefile + templates)
```

Sub-module guidance: `apps/server/src/AGENTS.md`, `apps/web/src/AGENTS.md`, and deeper (`services/`, `runtime/`, `agent-types/`).

## Build & Run Commands

```bash
# Setup & dev
npm install                                    # From root (npm workspaces)
npm run dev -w @aquarium/server       # Backend (port 3001, tsx watch)
npm run dev -w @aquarium/web          # Frontend (port 5173, Vite)

# IMPORTANT: Build shared FIRST -- server and web depend on it
npm run build -w @aquarium/shared     # tsc -> packages/shared/dist/

# Database
npm run migrate -w @aquarium/server   # Run pending migrations
npm run migrate:make -w @aquarium/server -- migration_name

# Type checking & builds
npm run typecheck -w @aquarium/server # tsc --noEmit (server only)
npm run build -w @aquarium/web        # tsc -b && vite build
npm run build -w @aquarium/server     # tsc -> apps/server/dist/

# Lint (web only -- no linter configured for server)
npm run lint -w @aquarium/web         # ESLint 9 flat config

# CLI (run locally)
npx .                                 # Runs CLI from local build
```

### Pre-push Checks

Run the same checks as CI before pushing:
```bash
npm run build -w @aquarium/shared && npm run typecheck -w @aquarium/server & npm run lint -w @aquarium/web & wait
```

## Testing

Playwright only. No unit tests. Config at root `playwright.config.ts` (Chromium only, `fullyParallel: true`). Vite dev server auto-starts via `webServer` config. Server must be running separately.

```bash
npx playwright test                             # All tests
npx playwright test tests/e2e/api.spec.ts       # Single file
npx playwright test -g "should create instance" # By test name grep
npx playwright test --headed                    # Watch in browser
npx playwright test --debug                     # Step-through debugger
```

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
- **Routes**: 18 files in `src/routes/`, thin controllers calling service functions. Each exports a default router.

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

## Common Pitfalls

- **Build shared first**: `packages/shared` must be built before server typecheck or web build. CI does this automatically, but manual runs need it.
- **Build artifacts in src/**: `tsc -b` from root generates `.js`/`.d.ts` in `src/` dirs, breaking Vite and Knex. Clean with: `find apps/web/src apps/server/src -name "*.js" -o -name "*.d.ts" -o -name "*.js.map" | xargs rm`
- **Gateway schema strictness**: `additionalProperties: false` -- do NOT add unknown fields to gateway configs. `client.id` for event relay MUST be `'gateway-client'`.
- **Credential placeholders**: `${CREDENTIAL:provider:type}` in MCP configs -> resolved at startup via `adapter.ts`. 3-layer resolution: instance creds -> user vault -> error.
- **Migration numbering**: 30+ migrations with some duplicate numbers from merge conflicts. Always check existing migration files before creating new ones.
- **Stub agent types**: `opencode` and `claude-code` have manifests but NO adapters. Code calling adapter methods must null-check: `agentType.adapter?.seedConfig?.(...)`.
