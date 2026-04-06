# Development

This guide covers setting up a development environment for contributing to Aquarium CE.

## Prerequisites

- **Node.js 22+** -- Required (the codebase uses modern ESM features)
- **Docker** -- Required for running agent instances during development
- **Git** -- For version control

## Initial Setup

```bash
# Clone the repository
git clone https://github.com/aquaclawai/aquarium.git
cd aquarium

# Install all dependencies (npm workspaces handles monorepo linking)
npm install
```

## Monorepo Structure

Aquarium is a monorepo managed by npm workspaces:

```
aquarium/
  apps/
    server/          @aquaclawai/aquarium  Express backend
    web/             @aquarium/web       React frontend
  packages/
    shared/          @aquarium/shared    Shared TypeScript types
  tests/
    e2e/             Playwright tests
  openclaw/          Gateway image build
```

The workspace names matter -- you use them with the `-w` flag:

```bash
npm run dev -w @aquaclawai/aquarium    # Run command in server workspace
npm run dev -w @aquarium/web       # Run command in web workspace
npm run build -w @aquarium/shared  # Run command in shared workspace
```

## Building from Source

The shared package must be built first because both the server and web app depend on it:

```bash
# Step 1: Build shared types (ALWAYS first)
npm run build -w @aquarium/shared

# Step 2: Build server
npm run build -w @aquarium/server

# Step 3: Build web (CE edition)
npm run build:ce -w @aquarium/web

# Or build everything at once:
npm run build
```

## Running Dev Servers

You need two terminals for development:

```bash
# Terminal 1: Backend server (port 3001, auto-reloads on file changes)
npm run dev -w @aquarium/server

# Terminal 2: Frontend dev server (port 5173, HMR via Vite)
npm run dev -w @aquarium/web
```

The Vite dev server proxies `/api` requests to the backend server, so you access the app at http://localhost:5173 during development.

## Database Migrations

Aquarium CE uses SQLite. The database file is created at `~/.aquarium/aquarium.db` by default.

```bash
# Run pending migrations
npm run migrate -w @aquarium/server

# Create a new migration
npm run migrate:make -w @aquarium/server -- my_migration_name

# Rollback the last migration
npx knex migrate:rollback --knexfile apps/server/src/db/knexfile.ts
```

### Writing Migrations

Migrations live in `apps/server/src/db/migrations/`. They use Knex and must work with SQLite. Use the helpers from `migration-helpers.ts` for dialect-aware operations:

```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('my_table', (table) => {
    table.uuid('id').primary();
    table.string('name').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('my_table');
}
```

**Important**: Check existing migration file numbers before creating new ones. Some numbers have been reused due to merge conflicts.

## Adding New Features

### Adding a New API Route

1. Create the route file in `apps/server/src/routes/`:

   ```typescript
   // apps/server/src/routes/my-feature.ts
   import { Router } from 'express';
   import { authenticate } from '../middleware/auth.js';

   const router = Router();

   router.get('/', authenticate, async (req, res) => {
     try {
       // Call service function (never access DB directly)
       const data = await myService.getData(req.user!.id);
       res.json({ ok: true, data });
     } catch (err) {
       res.status(500).json({ ok: false, error: (err as Error).message });
     }
   });

   export default router;
   ```

2. Register the route in `apps/server/src/server-core.ts`:

   ```typescript
   import myFeatureRoutes from './routes/my-feature.js';
   // ...
   app.use('/api/my-feature', myFeatureRoutes);
   ```

### Adding a New Service

Services contain business logic and live in `apps/server/src/services/`:

```typescript
// apps/server/src/services/my-service.ts
import { db } from '../db/index.js';

export async function getData(userId: string) {
  return db.adapter.query('my_table', { user_id: userId });
}
```

### Adding a New Page

1. Create the page component in `apps/web/src/pages/`:

   ```tsx
   // apps/web/src/pages/MyPage.tsx
   import { useTranslation } from 'react-i18next';

   export function MyPage() {
     const { t } = useTranslation();
     return <h1>{t('myPage.title')}</h1>;
   }
   ```

2. Add the route in `apps/web/src/App.tsx`

3. Add i18n keys to all 6 locale files in `apps/web/src/i18n/locales/`

### Adding Shared Types

Shared types go in `packages/shared/src/types.ts`:

```typescript
export interface MyNewType {
  id: string;
  name: string;
  createdAt: string;
}
```

After modifying shared types, rebuild: `npm run build -w @aquarium/shared`

## Type Checking and Linting

```bash
# Type-check the server (includes building shared first)
npm run typecheck

# Lint the web app
npm run lint

# Run both (same as CI)
npm run build -w @aquarium/shared && npm run typecheck -w @aquarium/server & npm run lint -w @aquarium/web & wait
```

## Testing

See the [Contributing Guide](../CONTRIBUTING.md#testing) for testing instructions. Key points:

- Playwright only (no unit tests)
- Server must be running separately
- Vite dev server starts automatically
- Tests in `tests/e2e/`

## Debugging

### Server

The dev server runs via `tsx watch`, which supports Node.js debugging:

```bash
# Run with debug port
NODE_OPTIONS='--inspect --no-experimental-require-module' npx tsx watch apps/server/src/index.ce.ts
```

Then attach your debugger (VS Code, Chrome DevTools) to port 9229.

### Frontend

Use browser DevTools. The Vite dev server provides source maps for TypeScript files. React DevTools browser extension is recommended.

### Database

You can inspect the SQLite database directly:

```bash
sqlite3 ~/.aquarium/aquarium.db

# Example queries
.tables
SELECT * FROM instances;
SELECT * FROM users;
```

## Common Issues

### "Cannot find module" errors

Rebuild the shared package:

```bash
npm run build -w @aquarium/shared
```

### Build artifacts in src/ directories

If you see unexpected `.js` or `.d.ts` files in `src/` directories:

```bash
find apps/web/src apps/server/src -name "*.js" -o -name "*.d.ts" -o -name "*.js.map" | xargs rm
```

### Port already in use

Check if another process is using the port:

```bash
lsof -i :3001
lsof -i :5173
```
