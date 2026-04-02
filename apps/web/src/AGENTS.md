# Web Frontend — AGENTS.md

> Parent: `../../../AGENTS.md` (ESM import rules, design system tokens)

## Stack

React 19 + Vite + CSS variables (no Tailwind, no component library). Design system "Oxide" defined in `index.css`.

## Routing (`App.tsx`)

20+ lazy-loaded pages via `React.lazy()`. All wrapped in `AuthContext` + `WebSocketContext` providers.

```
/login, /signup              ← public
/dashboard                   ← ProtectedRoute → DashboardPage
/instances/:id               ← ProtectedRoute → InstancePage (1616 lines — complexity hotspot)
/admin                       ← ProtectedRoute + admin check → AdminPage
/templates                   ← ProtectedRoute → TemplatesPage
/group-chats                 ← ProtectedRoute → GroupChatsListPage
/group-chats/:id             ← ProtectedRoute → GroupChatPage
/profile                     ← ProtectedRoute → ProfilePage
/oauth/google/callback       ← GoogleOAuthCallback
/docs/*                      ← 8 documentation pages in pages/docs/
```

## Key Contexts

### AuthContext (`context/AuthContext.tsx`)
- Holds `user`, `isAuthenticated`, `isAdmin`
- `login()`, `logout()`, `signup()` methods
- JWT stored in httpOnly cookie (not accessible to JS — server manages it)

### WebSocketContext (`context/WebSocketContext.tsx`)
- Persistent WS connection to server
- Auto-reconnect on disconnect
- `subscribe(instanceId)` / `unsubscribe(instanceId)` for room-based events
- Components listen via `onMessage(type, callback)`

## API Client (`api.ts`)

Centralized fetch wrapper. Returns typed `ApiResponse<T>`. Handles:
- Cookie-based auth (credentials: 'include')
- Error parsing (server returns `{ ok: false, error: string }`)
- Base URL: empty in prod (same origin), Vite proxy in dev

## Styling: Oxide Design System

All tokens in `index.css`. Both light and dark themes maintained (`:root` and `[data-theme="dark"]`).

Key rules:
- Use CSS variables (`var(--color-primary)`) — never hardcode colors
- Spacing: 4px base scale (use `var(--space-*)`)
- No Tailwind classes — pure CSS with var() references

## Components (`components/`)

- `ProtectedRoute.tsx` — Auth guard HOC
- `AgentUIFrame.tsx` — Iframe wrapper for agent web UI (reverse-proxied)
- `chat/` — Chat interface components (ChatTab, message rendering, streaming)
- `SnapshotsTab.tsx`, `SnapshotCard.tsx`, `SnapshotDiffView.tsx` — Config snapshot UI
- `RestoreConfirmModal.tsx` — Confirmation dialog for snapshot restores
- `ThemeToggle.tsx` — Light/dark mode toggle

## Complexity Hotspot

`InstancePage.tsx` (1616 lines) — monolithic component with 10 tabs (overview, credentials, chat, channels, workspace, logs, events, health, usage, settings). Handles WebSocket subscriptions, multiple API calls, complex state. Prime candidate for decomposition.

## Dev Server

Vite on port 5173 proxies `/api/*` and `/ws` to Express on port 3001 (configured in `vite.config.ts`).
