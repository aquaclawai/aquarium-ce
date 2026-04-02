# Contributing to Aquarium CE

Thank you for your interest in contributing to Aquarium CE! This guide will help you get set up and understand the project conventions.

## Prerequisites

- **Node.js 22+** (required; earlier versions are not supported)
- **Docker** (required for running agent instances)
- **Git** (for version control)

## Getting Started

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/aquaclawai/aquarium.git
   cd aquarium
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build the shared package** (must be done before anything else):

   ```bash
   npm run build -w @aquarium/shared
   ```

4. **Start the development servers:**

   ```bash
   # Terminal 1: Backend (port 3001)
   npm run dev -w @aquarium/server

   # Terminal 2: Frontend (port 5173)
   npm run dev -w @aquarium/web
   ```

5. **Open your browser** at `http://localhost:5173`

## Project Structure

```
aquarium/
  apps/
    server/src/          Backend (Express, TypeScript)
      agent-types/       Agent type definitions and adapters
      db/                Database layer (Knex, SQLite)
      middleware/        Express middleware (auth, CORS, rate limiting)
      routes/            Route handlers (thin controllers)
      runtime/           Runtime engines (Docker, Kubernetes)
      services/          Business logic
      ws/                WebSocket server
      cli.ts             CLI entry point (npx @aquaclawai/aquarium)
      config.ts          Centralized configuration
      index.ce.ts        CE server entry point
      server-core.ts     Shared server setup
    web/src/             Frontend (React, Vite, TypeScript)
      components/        React components
      context/           React context providers
      hooks/             Custom React hooks
      i18n/              Internationalization (6 locales)
      pages/             Page components
      api.ts             Centralized API client
      App.tsx            Root component and routing
      index.css          Design system CSS tokens
  packages/
    shared/src/          Shared TypeScript types
  tests/
    e2e/                 Playwright end-to-end tests
```

## Development Workflow

### Build Commands

```bash
# Build shared types (MUST run first)
npm run build -w @aquarium/shared

# Type-check server
npm run typecheck -w @aquarium/server

# Lint web app
npm run lint -w @aquarium/web

# Full build (shared -> server -> web)
npm run build

# Run migrations
npm run migrate -w @aquarium/server

# Create a new migration
npm run migrate:make -w @aquarium/server -- migration_name
```

### Running Before Push

Before pushing your changes, run the same checks that CI will:

```bash
npm run build -w @aquarium/shared && npm run typecheck -w @aquarium/server & npm run lint -w @aquarium/web & wait
```

## Code Style

### ESM Import Rules (Critical)

The server uses NodeNext module resolution. All `.ts` imports in `apps/server/` **must** use the `.js` extension:

```typescript
// apps/server/ -- CORRECT
import { config } from './config.js';
import { db } from './db/index.js';

// apps/server/ -- WRONG (will crash at runtime)
import { config } from './config';
```

The web app uses Vite and does **not** need file extensions:

```typescript
// apps/web/ -- CORRECT
import { api } from './api';
```

### Import Order

1. Node builtins (`node:fs`, `node:path`)
2. External packages (`express`, `react`)
3. Workspace packages (`@aquarium/shared`)
4. Local imports (`./config.js`)
5. Type-only imports (`import type { ... }`)

### Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Variables / functions | `camelCase` | `getInstance` |
| Types / interfaces | `PascalCase` | `InstanceStatus` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Server files | `kebab-case.ts` | `instance-manager.ts` |
| React components | `PascalCase.tsx` | `DashboardPage.tsx` |
| Database columns | `snake_case` | `created_at` |

### TypeScript

- **Never** use `any` -- use `unknown` with type guards
- Use `interface` for object shapes, `type` for unions and intersections
- All API responses follow `ApiResponse<T>` pattern: `{ ok: boolean, data?: T, error?: string }`

### Error Handling

- Route handlers: wrap in try/catch, return `{ ok: false, error: message }`
- Never use empty catch blocks, `as any`, or `@ts-ignore`

### Frontend

- Functional components with named exports: `export function ComponentName() {}`
- Use CSS variables from the Oxide design system (`var(--color-primary)`) -- no Tailwind, no hardcoded colors
- API calls through the centralized `api.ts` wrapper -- never raw `fetch()`
- All user-facing strings must use `t('key')` for i18n

### Internationalization

The web app supports 6 locales: `en`, `zh`, `fr`, `de`, `es`, `it`. When adding or modifying user-facing text:

1. Add the key to all 6 locale files in `apps/web/src/i18n/locales/`
2. Use `t('your.key')` in the component

### Architecture Rules

- **Routes -> Services -> Runtime/DB**: Route handlers call service functions. Services access the database and runtime engines. Never skip layers.
- **Configuration**: Always use the `config` object from `config.ts`. Never read `process.env` directly.
- **Database**: Use the `DbAdapter` for all queries. Never use raw SQL string concatenation. Use Knex parameterized queries.
- **Instance lifecycle**: Only modify instance state through `InstanceManager`. Never update `instances.status` directly.

## Testing

The project uses Playwright for end-to-end testing. There are no unit tests.

```bash
# Run all tests
npx playwright test

# Run a specific test file
npx playwright test tests/e2e/api.spec.ts

# Run by test name
npx playwright test -g "should create instance"

# Run with browser visible
npx playwright test --headed

# Debug mode (step through)
npx playwright test --debug
```

The server must be running separately before running tests. The Vite dev server starts automatically via the Playwright `webServer` config.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type(scope): description

feat(server): add instance snapshot export
fix(web): resolve chat scroll position on new messages
docs: update configuration reference
chore: upgrade TypeScript to 5.9
refactor(db): extract migration helpers
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `style`

## Pull Request Process

1. **Create a branch** from `main` with a descriptive name (e.g., `feat/snapshot-export`, `fix/chat-scroll`)
2. **Make your changes** following the code style guidelines above
3. **Run checks locally** before pushing:
   ```bash
   npm run build -w @aquarium/shared && npm run typecheck -w @aquarium/server & npm run lint -w @aquarium/web & wait
   ```
4. **Push and open a PR** against `main`
5. **Fill out the PR template** with a summary, list of changes, and test plan
6. **Wait for CI** to pass (typecheck + lint)
7. **Address review feedback** with additional commits (do not force-push)

## Issue Guidelines

- **Bug reports**: Use the bug report template. Include version, OS, steps to reproduce, and expected vs. actual behavior.
- **Feature requests**: Use the feature request template. Describe the problem you want to solve and your proposed solution.
- **Questions**: Open a discussion instead of an issue.

## Common Pitfalls

- **Build shared first**: `packages/shared` must be built before server typecheck or web build will succeed.
- **Build artifacts in src/**: Running `tsc -b` from root can generate `.js`/`.d.ts` files in `src/` directories, which break Vite and Knex. Clean with: `find apps/web/src apps/server/src -name "*.js" -o -name "*.d.ts" -o -name "*.js.map" | xargs rm`
- **Migration numbering**: Check existing migration files before creating new ones -- some numbers have been reused due to merge conflicts.
- **Gateway config strictness**: OpenClaw gateway configs enforce `additionalProperties: false`. Do not add unknown fields.

## License

By contributing to Aquarium CE, you agree that your contributions will be licensed under the Apache 2.0 license.
