# Architecture

This document describes the high-level architecture of Aquarium CE.

## Overview

Aquarium CE is a self-hosted platform for managing AI agent instances. It consists of three main components:

```
+-----------------+       +------------------+       +------------------+
|   React Web UI  | <---> |  Express Server  | <---> |   Docker Engine  |
|   (port 5173*)  |       |   (port 3001)    |       |                  |
+-----------------+       +------------------+       +------------------+
                                |                           |
                          +----------+              +-------------+
                          |  SQLite  |              |  OpenClaw   |
                          |   DB     |              |  Containers |
                          +----------+              +-------------+
```

*In production, the web UI is served as static files from the Express server on port 3001. Port 5173 is only used during development (Vite dev server).*

## Server Architecture

### Entry Points

The server has two entry points:

- **`cli.ts`** -- CLI entry point for `npx @aquaclawai/aquarium`. Parses flags (`--port`, `--data-dir`, `--host`, `--open`), sets environment variables, then dynamically imports `index.ce.ts`.
- **`index.ce.ts`** -- CE server entry point. Configures log redaction, creates the Express app via `server-core.ts`, mounts instance proxy routes, and starts the HTTP server.

### Request Flow

All requests follow a strict layered architecture:

```
HTTP Request
  -> Route Handler (apps/server/src/routes/)
    -> Service Function (apps/server/src/services/)
      -> DbAdapter (apps/server/src/db/adapter.ts)
      -> RuntimeEngine (apps/server/src/runtime/)
```

- **Route handlers** parse HTTP input, validate parameters, and call service functions. They never access the database or runtime directly.
- **Service functions** contain business logic. They call the DbAdapter for persistence and RuntimeEngine for container management.
- **DbAdapter** abstracts database operations. CE uses SQLite; the adapter pattern allows different backends.
- **RuntimeEngine** abstracts container management. CE primarily uses Docker; there is also a Kubernetes engine.

### Server Startup Sequence

The server starts in a specific order (defined in `server-core.ts`):

1. **Database migrations** -- `db.migrate.latest()` runs pending migrations
2. **State reconciliation** -- Checks running containers against database state, updates stale records
3. **Health monitor** -- Starts periodic health checks for running instances
4. **Gateway event relay** -- Connects to running gateway instances via WebSocket to relay events
5. **HTTP + WebSocket server** -- Binds to the configured port and starts accepting connections

### WebSocket Communication

The server maintains WebSocket connections for real-time updates:

- **Client WebSocket** (`/ws`) -- Pushes instance status changes, health updates, and chat events to the web UI
- **Gateway WebSocket** -- Connects to each running OpenClaw instance to relay events (messages, status changes, errors)

## Database Layer

### DbAdapter Pattern

All database access goes through `DbAdapter` (`apps/server/src/db/adapter.ts`), which provides a unified interface regardless of the underlying database engine.

CE uses **SQLite** via better-sqlite3. The database file lives at `~/.aquarium/aquarium.db` by default.

### Migrations

Migrations are managed by Knex and live in `apps/server/src/db/migrations/`. They use dialect-aware helpers from `migration-helpers.ts` to handle differences between SQLite and PostgreSQL syntax.

Key tables:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, hashed password) |
| `instances` | Agent instances (config, status, port) |
| `instance_credentials` | Encrypted API keys per instance |
| `user_credentials` | User-level credential vault |
| `templates` | Agent configuration templates |
| `group_chats` | Multi-agent chat sessions |
| `snapshots` | Instance configuration snapshots |
| `notifications` | User notification queue |

## Runtime Abstraction

### RuntimeEngine Interface

The `RuntimeEngine` interface (`apps/server/src/runtime/types.ts`) defines operations for managing agent containers:

- `createInstance()` -- Pull image, create and start container
- `startInstance()` / `stopInstance()` -- Container lifecycle
- `removeInstance()` -- Delete container and cleanup
- `getInstanceStatus()` -- Check container health
- `getLogs()` -- Retrieve container logs

### Docker Engine

The Docker engine (`apps/server/src/runtime/docker.ts`) uses Dockerode to manage containers:

- Creates a dedicated Docker network per instance for isolation
- Maps host ports from a configurable range (default 19000-19999)
- Connects the platform container to instance networks when running inside Docker
- Handles image pulling, container creation, health monitoring

### Runtime Factory

`RuntimeEngineFactory.getEngine()` returns the appropriate engine based on configuration. Application code never imports engine implementations directly.

## Gateway Integration

### OpenClaw Gateway

Each agent instance runs an [OpenClaw](https://github.com/AquaClawAI/openclaw) container -- a gateway that:

- Connects to AI providers (OpenAI, Anthropic, Google, etc.)
- Manages messaging channels (WhatsApp, Telegram, Discord, etc.)
- Handles MCP (Model Context Protocol) tool integrations
- Provides a WebSocket RPC interface for the platform

### WebSocket RPC

The platform communicates with gateway instances via WebSocket RPC:

- **Direct chat**: Sends user messages and streams AI responses
- **Configuration**: Updates provider settings, channel configs, etc.
- **Health**: Monitors instance health and connection status
- **Events**: Receives real-time events (new messages, errors, etc.)

### Credential Resolution

Gateway configurations use placeholders like `${CREDENTIAL:openai:api_key}`. At instance startup, Aquarium resolves these:

1. Check instance-specific credentials
2. Fall back to user credential vault
3. Error if no matching credential found

## Frontend Architecture

### React Application

The web UI is a single-page React application built with Vite:

- **Routing**: React Router v7 with layout routes (`AppLayout` wrapping all authenticated pages)
- **State management**: React Context for global state (`AuthContext`, `WebSocketContext`)
- **API client**: Centralized `api.ts` wrapper around `fetch()` with automatic error handling
- **Styling**: Custom CSS using the Oxide design system tokens (CSS variables). No Tailwind or component library.
- **i18n**: react-i18next with 6 locales (en, zh, fr, de, es, it)

### Key Pages

| Page | Purpose |
|------|---------|
| `DashboardPage` | Overview with KPIs, activity feed, usage charts |
| `WorkbenchPage` | List and manage agent instances |
| `InstancePage` | Instance detail with 10 tabs (overview, config, chat, logs, etc.) |
| `TemplatesPage` | Browse and deploy template configurations |
| `CredentialsPage` | Manage API keys and credentials |
| `ChatHubPage` | Multi-instance chat interface |
| `CreateWizardPage` | Step-by-step instance creation |

### Design System

The Oxide design system is defined in `apps/web/src/index.css` using CSS custom properties:

- Colors: `--color-primary`, `--color-surface`, `--color-text`, etc.
- Spacing: `--spacing-xs`, `--spacing-sm`, `--spacing-md`, etc.
- Typography: `--font-size-sm`, `--font-size-md`, `--font-weight-bold`, etc.
- Supports both light and dark themes via `prefers-color-scheme`

All components use these variables -- never hardcoded color values.
