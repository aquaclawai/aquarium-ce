# Server Source — AGENTS.md

> Parent: `../../AGENTS.md` (module flow, init order, critical gotchas)

## Entry Point: `index.ts`

Startup sequence is ORDER-SENSITIVE (see root AGENTS.md). Key: reconciliation before health monitor.

```
index.ts
├── config.ts          ← all env vars, typed. ONLY place to read process.env
├── db/                ← knex instance + migrations (auto-run on boot)
├── middleware/         ← auth.ts: requireAuth (JWT cookie), requireAdmin (email allowlist)
├── routes/            ← 18 route files, one per domain. Export default router.
├── services/          ← business logic (see services/AGENTS.md)
├── agent-types/       ← manifest + adapter registry (see agent-types/AGENTS.md)
├── runtime/           ← Docker/K8s abstraction (see runtime/AGENTS.md)
└── ws/                ← WebSocket server: auth → subscribe(instanceId) → broadcast
```

## Route Map (18 files)

| Route File | Domain | Auth |
|------------|--------|------|
| `auth.ts` | signup, login, logout, session | None (public) |
| `instances.ts` | Instance CRUD, lifecycle, logs | `requireAuth` |
| `credentials.ts` | Instance credential management | `requireAuth` |
| `user-credentials.ts` | User vault (cross-instance) | `requireAuth` |
| `channels.ts` | Telegram, WhatsApp, Discord config | `requireAuth` |
| `oauth.ts` | OpenAI device-code, Google PKCE | `requireAuth` |
| `templates.ts` | Template marketplace CRUD, fork | `requireAuth` |
| `agent-types.ts` | Agent type manifests + schemas | `requireAuth` |
| `rpc-proxy.ts` | JSON-RPC proxy to gateway | `requireAuth` |
| `ui-proxy.ts` | Reverse proxy for agent web UI | `requireAuth` |
| `instance-proxy.ts` | HTTP proxy to instance endpoints | `requireAuth` |
| `group-chats.ts` | Multi-agent chat routing | `requireAuth` |
| `usage.ts` | LiteLLM spend tracking | `requireAuth` |
| `notifications.ts` | Notification CRUD, alerts | `requireAuth` |
| `metadata.ts` | Instance metadata CRUD | `requireAuth` |
| `snapshots.ts` | Config snapshot/restore | `requireAuth` |
| `users.ts` | User profile management | `requireAuth` |
| `admin.ts` | Platform stats, user list | `requireAdmin` |

All routes: thin controllers → call service functions → return `ApiResponse<T>`.

## Middleware Stack

Applied in order in `index.ts`:
1. `express.json()` — body parsing
2. `cookieParser()` — JWT in httpOnly cookie
3. CORS — `config.corsOrigin`
4. Route-level: `requireAuth`, `requireAdmin`

## WebSocket (`ws/index.ts`)

- Auth: first message must be `{ type: "auth", token }` — validates JWT
- Rooms: `subscribe` to instanceId → receives all events for that instance
- Server-side emit: `emitter.emit('ws:send', { instanceId, type, ...data })`
- Client receives filtered by subscribed rooms

## Database (`db/`)

- `knexfile.ts`: config for CLI and programmatic use
- Migrations auto-run via `db.migrate.latest()` in index.ts startup
- 14 migration files — some duplicate numbers from merge conflicts (check existing before creating new)
- Schema: additive only (no destructive migrations in prod)
- JSONB columns: `instances.config`, `templates.tags`, `templates.required_credentials`
