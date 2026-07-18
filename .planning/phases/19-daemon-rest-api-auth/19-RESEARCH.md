# Phase 19: Daemon REST API & Auth — Research

**Researched:** 2026-04-16
**Domain:** Express-based REST auth / rate-limiting / token lifecycle over better-sqlite3
**Confidence:** HIGH (everything verified against installed dependency source + existing codebase)
**Research gate (from ROADMAP):** LIGHT — verify Express rate-limiter stack supports per-route exemption with per-token bucket

## Summary

Phase 19 adds ten REST endpoints — nine daemon-auth endpoints under `/api/daemon/*` plus three user-auth endpoints under `/api/daemon-tokens` — that together expose Phase 18's task-queue lifecycle to an external daemon runtime and let a web user mint/revoke the bearer tokens the daemon uses. The work reduces to three engineering problems:

1. **A new middleware `requireDaemonAuth`** that verifies `Authorization: Bearer adt_<32>` headers against the `daemon_tokens` table (migration 008 is already shipped — SHA-256 hash column, `revoked_at`, `last_used_at`). No cookie-JWT fallback. Attaches `workspace_id` + `daemon_token_id` + `daemon_id` to `req`.
2. **A rate-limiter topology change** — `/api/daemon/*` exempt from the global 300-req/15-min limiter (set up in `server-core.ts:120` and `dynamic-middleware.ts`), replaced by a per-token ~1000/min bucket keyed by `token_hash`. `express-rate-limit` v8.3.2 (already installed) supports both `skip:` and `keyGenerator:` as `ValueDeterminingMiddleware<boolean|string>` — no new dep needed.
3. **Wiring Phase 18's existing service functions** (`claimTask`, `startTask`, `completeTask`, `failTask`, `isTaskCancelled`, `appendTaskMessage`) to HTTP endpoints plus Phase 16's existing runtime writers (`upsertDaemonRuntime`, `updateHeartbeat`, `setRuntimeOffline`) for register/heartbeat/deregister. The service layer already implements `{ discarded: true }` for complete/fail-of-cancelled (TASK-06).

**Primary recommendation:** Do not introduce a new rate-limiter library and do not add a new auth framework. Use `express-rate-limit` v8.3.2 `skip:` on the global limiter + a second per-token `express-rate-limit` instance mounted at `/api/daemon/*` with `keyGenerator` returning the token hash. Introduce one new middleware file `apps/server/src/middleware/daemon-auth.ts` that mirrors the `requireAuth` shape from `middleware/auth.ts`. Two route files: `routes/daemon.ts` (nine daemon endpoints) and `routes/daemon-tokens.ts` (three user endpoints). Everything else plugs into existing Phase 16/17/18 services.

## Rate-Limiter Topology

### Current state (verified)

**File:** `apps/server/src/server-core.ts:119-151`. Two layers, **production-only** (disabled in development and tests):

```typescript
// §6.2 static limiters — only installed when config.nodeEnv === 'production'
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 300, ... }));      // line 120 — the "global" 300-req/15-min
app.use('/api/auth/login', rateLimit({ windowMs: 15*60*1000, max: 100, skipSuccessfulRequests: true }));
app.use('/api/credentials', rateLimit({ windowMs: 60*1000, max: 30 }));

// Dynamic (admin-configurable) limiters — also prod-only
app.use('/api/', dynamicGeneralLimiter);   // line 148 — from middleware/dynamic-middleware.ts:23
app.use('/api/auth/login', dynamicLoginLimiter);
app.use('/api/credentials', dynamicCredentialsLimiter);
```

Both the static limiter (line 120) and the dynamic limiter (line 148) are mounted at `/api/` path and will intercept every `/api/daemon/*` request under production. The dev/test E2E flow is unaffected (no limiters wired).

### What `express-rate-limit@8.3.2` supports (VERIFIED against `node_modules/express-rate-limit/dist/index.d.ts`)

```typescript
// from dist/index.d.ts lines 179, 410, 439
export type ValueDeterminingMiddleware<T> = (request, response) => T | Promise<T>;

keyGenerator: ValueDeterminingMiddleware<string>;   // default is req.ip via ipKeyGenerator
skip:         ValueDeterminingMiddleware<boolean>;  // default: no skip
```

Both are async-capable. `keyGenerator` can return a hashed token and `skip` can return `true` for any request on `/api/daemon/*`. This library is sufficient — **no new dep required**. [VERIFIED: `node_modules/express-rate-limit/package.json` version 8.3.2; `dist/index.d.ts` lines 179, 410, 439]

### Recommended topology (DAEMON-08)

**Change A — exempt `/api/daemon/*` from the global limiters.** The cheapest way is `skip: (req) => req.path.startsWith('/api/daemon/')` on the two `/api/` limiters (static + dynamic). The path inspected is the sub-path *relative to the mount point* (`/api/`), so the actual comparison inside the callback is `req.path.startsWith('/daemon/')`. To avoid confusion, prefer `req.originalUrl.startsWith('/api/daemon/')` — `originalUrl` is unmutated by Express routing. The two global limiters (static on line 120 and dynamic on line 148) both need the `skip`.

**Change B — add a daemon-scoped per-token bucket.** Mount a new rate-limiter at `/api/daemon/` AFTER `requireDaemonAuth` has populated `req.daemonAuth.tokenHash`. `keyGenerator` returns that hash. One bucket per daemon token, independent of IP. A stolen token cannot DDoS the user's other tokens or the web UI's limiter.

```typescript
// Conceptual — actual placement is inside routes/daemon.ts after requireDaemonAuth
const daemonBucket = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,                  // DAEMON-08 target
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => req.daemonAuth!.tokenHash,  // safe — middleware above already ran
  // No `skip` — if this runs, it counts.
});
```

Why keying by token hash (not token id): the hash is already a 64-char hex string — the same identifier the DB stores. Exposing the opaque UUID `id` in memory is fine too, but hash is what the middleware already computed. Either works; pick one and document.

**Ordering** (mount order matters):
```
helmet → cors → cookieParser → json → healthCheck
  → [global limiters]              ← add `skip` to exclude /api/daemon/
  → requireDaemonAuth (inside routes/daemon.ts via router.use)
  → daemonBucket (per-token)
  → daemon route handlers
```

### Alternatives considered

| Library | Why rejected |
|---------|--------------|
| `rate-limiter-flexible` | More flexible buckets (Redis-backed, token-bucket), but adds a new dep for a problem `express-rate-limit`'s `keyGenerator` already solves in CE's single-process model. |
| Hand-rolled Map-per-token counter | Loses `standardHeaders` (rate-limit headers) the existing dashboard inspects; also re-implements window rotation. No upside. |

**Decision:** Stay on `express-rate-limit@8.3.2`. Use `skip` for exemption and a second `rateLimit(...)` instance with `keyGenerator` for the per-token bucket. [VERIFIED]

## requireDaemonAuth Middleware Spec

### File and signature

**New file:** `apps/server/src/middleware/daemon-auth.ts`

```typescript
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';

export interface DaemonAuthPayload {
  tokenId: string;          // daemon_tokens.id
  workspaceId: string;      // daemon_tokens.workspace_id
  daemonId: string | null;  // populated after first register
  tokenHash: string;        // sha256 hex — used as rate-limit key
}

declare global {
  namespace Express {
    interface Request {
      daemonAuth?: DaemonAuthPayload;
    }
  }
}

export const DAEMON_TOKEN_PREFIX = 'adt_';
```

### Exact pseudocode

```typescript
export async function requireDaemonAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. REJECT cookie auth explicitly — AUTH1 privilege-confusion HARD guard.
    //    (Defence-in-depth; the route doesn't call requireAuth either.)
    //    Note: we do NOT delete req.cookies — it may be needed by error logging.

    // 2. Extract bearer token.
    const authHeader = req.header('authorization') ?? '';
    const match = /^Bearer\s+(adt_[A-Za-z0-9_-]{32,})$/.exec(authHeader);
    if (!match) {
      res.status(401).json({ ok: false, error: 'daemon token required' });
      return;
    }
    const plaintext = match[1];

    // 3. Hash the FULL plaintext (including 'adt_' prefix).
    //    Rationale: the DB stores sha256 of the full plaintext. No ambiguity.
    const computedHash = createHash('sha256').update(plaintext).digest('hex');

    // 4. DB lookup — UNIQUE(token_hash) + revoked_at IS NULL predicate.
    //    Every request hits the DB (AUTH3 no-cache invariant — 1s revocation SLA).
    const row = await db('daemon_tokens')
      .where({ token_hash: computedHash })
      .whereNull('revoked_at')
      .first('id', 'workspace_id', 'daemon_id', 'token_hash', 'expires_at');

    if (!row) {
      res.status(401).json({ ok: false, error: 'invalid or revoked daemon token' });
      return;
    }

    // 5. timingSafeEqual — defence-in-depth. UNIQUE(token_hash) already
    //    made the lookup constant-time relative to token size, but the DB
    //    dialect comparison (=) may short-circuit. timingSafeEqual on the
    //    hex representation forecloses any residual timing channel.
    //    Both buffers are 64 bytes (sha256 hex) so no length mismatch.
    const storedBuf = Buffer.from(row.token_hash as string, 'utf8');
    const computedBuf = Buffer.from(computedHash, 'utf8');
    if (storedBuf.length !== computedBuf.length ||
        !timingSafeEqual(storedBuf, computedBuf)) {
      res.status(401).json({ ok: false, error: 'invalid or revoked daemon token' });
      return;
    }

    // 6. Expiry check.
    if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
      res.status(401).json({ ok: false, error: 'daemon token expired' });
      return;
    }

    // 7. Attach payload + fire-and-forget last_used_at update.
    req.daemonAuth = {
      tokenId: row.id as string,
      workspaceId: row.workspace_id as string,
      daemonId: (row.daemon_id as string) ?? null,
      tokenHash: computedHash,
    };

    // Fire-and-forget: don't await, don't block the request.
    // If the update fails we swallow; `last_used_at` is advisory telemetry.
    db('daemon_tokens')
      .where({ id: row.id })
      .update({ last_used_at: new Date().toISOString() })
      .catch((err) => console.warn('[daemon-auth] last_used_at update failed:', err));

    next();
  } catch (err) {
    // Any unexpected error → 401, never 500 (DAEMON-07 reject-only contract).
    console.warn('[daemon-auth] unexpected error:', err instanceof Error ? err.message : String(err));
    res.status(401).json({ ok: false, error: 'daemon authentication failed' });
  }
}
```

### Response-code contract (DAEMON-07)

| Condition | Status | Body |
|-----------|--------|------|
| Missing / malformed `Authorization: Bearer adt_...` | 401 | `{ ok: false, error: 'daemon token required' }` |
| Token hash not found OR `revoked_at IS NOT NULL` | 401 | `{ ok: false, error: 'invalid or revoked daemon token' }` |
| `timingSafeEqual` mismatch (belt-and-braces) | 401 | same |
| `expires_at` in the past | 401 | `{ ok: false, error: 'daemon token expired' }` |
| Any DB / runtime error | 401 | `{ ok: false, error: 'daemon authentication failed' }` |
| Valid token | → passes to next | `req.daemonAuth` populated |

**Never 403, never 500, never leak the token substring in an error message** (AUTH2 mitigation). [VERIFIED against `apps/server/src/db/migrations/008_daemon_tokens.ts` for column shape; timingSafeEqual+createHash from node:crypto per Node 22 docs]

## Cookie-JWT vs. Daemon-Token Separation

### The two middlewares (never share a route)

| Middleware | File | Authenticates | Populates | Rejects |
|---|---|---|---|---|
| `requireAuth` | `middleware/auth.ts` (existing) | Cookie JWT (CE pass-through; EE Clerk) | `req.auth = { userId, email }` | unauthenticated in EE prod; pass-through in CE |
| `requireDaemonAuth` | `middleware/daemon-auth.ts` (new) | `Authorization: Bearer adt_*` | `req.daemonAuth = { tokenId, workspaceId, daemonId, tokenHash }` | anything that isn't an `adt_*` bearer |

### Route mounting discipline (AUTH1 HARD)

**Rule:** No route mounts both middlewares.

- `/api/daemon/*` uses `requireDaemonAuth` only. Cookie JWT on this route → 401 (no `Authorization: Bearer adt_` header).
- `/api/daemon-tokens/*` (user token management) uses `requireAuth` only. An `adt_*` bearer on this route → the cookie-JWT handler inspects cookies, finds none (the daemon never sets the test cookie), and in production EE returns 401. In CE, `requireAuth` pass-through would otherwise auto-authenticate as the first user — a risk (see CE pitfall below).

### CE privilege-confusion risk (critical finding)

**Found during review:** `middleware/auth.ts:60-75` in CE mode has a pass-through that auto-authenticates as "the first user in the DB" when no Clerk handler is registered. A request to `/api/agents` carrying `Authorization: Bearer adt_xxx` (but no cookie) currently passes `requireAuth` unchallenged — because the middleware ignores `Authorization` entirely and auto-populates `req.auth` from `db('users').first()`.

This means the stated success criterion **SC-2 ("Cookie-authed user hitting /api/agents with an adt_ bearer instead of a cookie → 401")** is NOT satisfied by the current `requireAuth`. Phase 19 must either (a) reject requests carrying an `adt_*` bearer inside `requireAuth`, or (b) accept that CE pass-through is a known CE-single-user simplification and document SC-2 as an EE-only invariant.

**Recommended mitigation (adopt option a):** Add 3 lines at the top of `requireAuth`:

```typescript
// AUTH1 HARD — reject adt_* bearer tokens on user routes.
const h = req.header('authorization') ?? '';
if (/^Bearer\s+adt_/.test(h)) {
  res.status(401).json({ ok: false, error: 'daemon tokens not accepted on user routes' });
  return;
}
```

This closes the privilege-confusion door in *both* CE and EE without coupling `requireAuth` to `requireDaemonAuth`. The check is purely structural (string prefix), so no DB round-trip.

### Wiring

`routes/daemon.ts` begins with `router.use(requireDaemonAuth)` + `router.use(daemonBucket)` → all nine daemon endpoints inherit the guard (identical to `routes/runtimes.ts:7`: `router.use(requireAuth)`).

`routes/daemon-tokens.ts` begins with `router.use(requireAuth)` — standard user auth for token management UI calls.

`server-core.ts` mounts them after the existing routes:

```typescript
app.use('/api/daemon', daemonRoutes);          // new — 9 endpoints
app.use('/api/daemon-tokens', daemonTokenRoutes); // new — 3 endpoints
```

Both mounts go **before** `attachWebSocketProxy` + the static web handler (mirroring existing route order in `server-core.ts:154-184`).

## Token Generator & Storage Contract

### Token format (DAEMON-09)

Plaintext: `adt_<32 base64url chars>` — exactly 36 characters total.

**Math check.** `randomBytes(24)` yields 24 bytes = 192 bits of entropy. `toString('base64url')` encodes 24 bytes as `ceil(24 / 3) * 4 = 32` characters, with no trailing `=` padding because `24 % 3 === 0`. Total length `4 + 32 = 36`. [VERIFIED against `node_modules/@types/node/crypto.d.ts` for `randomBytes(size).toString('base64url')` contract]

```typescript
// apps/server/src/services/daemon-token-store.ts  (new file)
import { randomBytes, createHash } from 'node:crypto';

const PREFIX = 'adt_';

export function generateDaemonTokenPlaintext(): string {
  return PREFIX + randomBytes(24).toString('base64url');
}

export function hashDaemonToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
```

### Prefix handling

Hash the **full** plaintext (including the `adt_` prefix). One rule, zero ambiguity — no "did we strip the prefix this time?" bugs when a daemon forgets to include the prefix or a test fixture hardcodes one without it. The prefix is also what `requireAuth` inspects to reject bearer misuse (it does *not* need to hash anything — a purely structural check).

### Table shape (already shipped)

From `apps/server/src/db/migrations/008_daemon_tokens.ts` (migration ran in Phase 15):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (36 char) | primary key, server-generated |
| `workspace_id` | string(36) | FK → workspaces, CASCADE |
| `token_hash` | string(64) UNIQUE | sha256 hex of the full plaintext |
| `name` | string(100) | user-facing label |
| `daemon_id` | string(36) nullable | populated on first `register` call |
| `created_by_user_id` | UUID nullable | FK → users, SET NULL |
| `expires_at` | timestamptz nullable | NULL = no expiry |
| `last_used_at` | timestamptz nullable | touched by `requireDaemonAuth` |
| `revoked_at` | timestamptz nullable | `IS NOT NULL` → middleware rejects |
| `created_at`, `updated_at` | timestamptz | standard |

Indexes: `idx_daemon_tokens_workspace(workspace_id)`, `idx_daemon_tokens_revoked(revoked_at)`. UNIQUE(token_hash) provides O(log n) hot-path lookup.

### `timingSafeEqual` buffer contract

`crypto.timingSafeEqual(a, b)` requires `a.length === b.length`; mismatched lengths throw `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`. Both sides here are 64-byte SHA-256 hex strings, so the guard `storedBuf.length !== computedBuf.length` protects against the defensive case only — it cannot actually fail in production. We compare hex-string buffers (not raw bytes) because the DB stores the hex string; this is still timing-safe (the node impl compares byte arrays, oblivious to hex vs raw). [VERIFIED against Node.js 22 `crypto.timingSafeEqual` docs]

## Endpoint Map

### Daemon-auth endpoints (9) — `/api/daemon/*`, `requireDaemonAuth` only

| # | Req | Method | Path | Request | Response (ApiResponse<T>) |
|---|---|---|---|---|---|
| 1 | DAEMON-01 | POST | `/register` | `DaemonRegisterRequest` (shared type, v14-types.ts:195) — `{ workspaceId, daemonId, deviceName, cliVersion, launchedBy, runtimes: [{ name, provider, version, status }] }` | `{ runtimes: Runtime[] }` — one row per provider the daemon reported, upserted via `upsertDaemonRuntime` |
| 2 | DAEMON-02 | POST | `/heartbeat` | `{ runtimeIds: string[] }` — runtimes this daemon still owns | `{ pendingPings: [], pendingUpdates: [] }` — v1.4 ships empty arrays (scaffolding for server→daemon control loop) |
| 3 | DAEMON-03 | POST | `/deregister` | `{ runtimeIds: string[] }` — graceful shutdown | `{ ok: true }` — calls `setRuntimeOffline(id)` for each |
| 4 | DAEMON-04 | POST | `/runtimes/:id/tasks/claim` | (empty body) | `{ task: ClaimedTask \| null }` — delegates to `claimTask(runtimeId)` |
| 5 | DAEMON-05a | POST | `/tasks/:id/start` | (empty body) | `{ started: boolean, status: TaskStatus }` — delegates to `startTask(taskId)` |
| 6 | DAEMON-05b | POST | `/tasks/:id/progress` | `{ progress: number, note?: string }` | `{ ok: true }` — writes WS `task:progress` (no DB update; Phase 18 has no `progress` column) |
| 7 | DAEMON-05c | POST | `/tasks/:id/messages` | `{ messages: PendingTaskMessage[] }` — array to reduce HTTP overhead | `{ accepted: number }` — delegates to `appendTaskMessage` per row |
| 8 | DAEMON-05d+e | POST | `/tasks/:id/complete` AND `/tasks/:id/fail` | `{ result?: unknown }` or `{ error: string }` | `TerminalResult` (`{ discarded: boolean, status: TaskStatus }`) — HTTP 200 even when `discarded: true` |
| 9 | DAEMON-06 | GET | `/tasks/:id/status` | — | `{ status: TaskStatus, cancelled: boolean }` — read-only; feeds daemon 5-second cancel-detection loop (CLI-06) |

All responses use `ApiResponse<T> = { ok: true, data: T }` or `{ ok: false, error: string }` (shared type, unchanged from Phase 16/17 conventions). Workspace-scoping is enforced in the service layer: every route grabs `req.daemonAuth.workspaceId` and passes it into service calls that already filter by `workspace_id` (e.g., `runtime-registry.getById(workspaceId, id)`).

### User-auth endpoints (3) — `/api/daemon-tokens/*`, `requireAuth` only

| # | Req | Method | Path | Request | Response |
|---|---|---|---|---|---|
| 10a | DAEMON-10 | POST | `/` | `{ name: string, expiresAt?: string }` | `DaemonTokenCreatedResponse` (shared type, v14-types.ts:188) — `{ token: DaemonToken, plaintext: string }`. Plaintext shown ONLY here. |
| 10b | DAEMON-10 | GET | `/` | — | `DaemonToken[]` — no plaintext ever, even first-listing. Includes `lastUsedAt` + `revokedAt`. |
| 10c | DAEMON-10 | DELETE | `/:id` | — | `{ ok: true }` — sets `revoked_at = now()`; in-flight requests with this token fail at next DB lookup (≤ 1s). |

### Why not also a "regenerate" endpoint?

Revoke + create-new is the standard pattern (multica uses this; see PITFALLS AUTH3). Regenerate would need to handle in-flight requests using the old hash — rotation is safer as two steps. Explicitly out of scope per ROADMAP.

## Idempotency & Error Shapes

### `{ discarded: true }` on complete/fail of already-cancelled — HTTP 200 (TASK-06)

Phase 18 service functions already implement this. The route handler must NOT map `discarded: true` to an error status:

```typescript
// routes/daemon.ts — POST /tasks/:id/complete
const result = await completeTask(req.params.id, req.body.result);
// result: { discarded: boolean, status: TaskStatus }
res.json({ ok: true, data: result } satisfies ApiResponse<TerminalResult>);
// ^^^ always HTTP 200 — the daemon is reporting truthfully, server just
//     discarded the state change because the task was cancelled.
```

Same shape on `/tasks/:id/fail`. This matches `completeTask`'s contract in `task-queue-store.ts:626` and Phase 18 Plan 04 Summary's "discarded-completion pattern".

### Register idempotency (DAEMON-01)

`upsertDaemonRuntime` (runtime-registry.ts:205) uses `.onConflict(['workspace_id', 'daemon_id', 'provider']).merge(...)`. Same token + same `daemonId` + same providers → same runtime IDs. The handler returns the full `Runtime[]` (the projection Phase 16 ships), so the daemon can compare its cached runtime IDs to detect drift.

**Note:** The existing `DaemonRegisterRequest` shape (v14-types.ts:195) has `workspaceId` in the body. Since `requireDaemonAuth` already attached `req.daemonAuth.workspaceId` from the token row, the route should **reject or ignore** a body-level `workspaceId` that mismatches — prefer reject with 400 to catch daemon misconfiguration early. Alternatively drop the field from the request type (breaking shape change — flag for planner).

### Claim with unknown runtime ID (DAEMON-04)

If `runtimeId` doesn't exist or belongs to another workspace, the route must return 404, not 500. Pre-check via `runtime-registry.getById(req.daemonAuth.workspaceId, req.params.id)` before calling `claimTask` — this also enforces cross-workspace isolation.

### Messages batch size (DAEMON-05 messages)

Enforce `req.body.messages.length <= 100` and `JSON.stringify(req.body).length <= 64 * 1024` as defence against a compromised daemon fire-hosing the batcher (pairs with Phase 18's `BUFFER_SOFT_CAP = 500`). Reject with 413 on overflow.

### Global error shape

```typescript
interface ApiResponse<T = never> {
  ok: boolean;
  data?: T;
  error?: string;
}
```

Every daemon route follows `routes/issues.ts` / `routes/runtimes.ts` try/catch pattern: validation errors → 400, not-found → 404, auth → 401, anything else → 500 with `err.message`. Never echo request headers or the bearer token substring (AUTH2).

## Revocation Propagation

### No in-memory cache (AUTH3 1-second SLA)

Every daemon request performs exactly one indexed SELECT on `daemon_tokens`:

```sql
SELECT id, workspace_id, daemon_id, token_hash, expires_at
FROM daemon_tokens
WHERE token_hash = ? AND revoked_at IS NULL
LIMIT 1;
```

Backed by `UNIQUE(token_hash)` — O(log n), microsecond-range under SQLite WAL. The DELETE-daemon-token endpoint sets `revoked_at = now()` inside a single UPDATE; the **very next request** with that token misses the `WHERE revoked_at IS NULL` predicate and returns 401. SLA is bounded by the round-trip to the daemon + single SQLite write, both sub-millisecond locally. **≤1s is trivially satisfied** on modern hardware.

### Performance envelope

CE worst case: 1 daemon × 5 runtimes polling `claim` every 1s = 5 req/s = 5 DB lookups/s. SQLite WAL easily handles 10,000+ reads/sec. [ASSUMED performance headroom; local DB on local disk]

Two-daemon / multi-runtime stress test should measure actual p99 latency for the auth lookup alone — recommended as part of validation (see below).

### Broadcast on revoke (optional)

PITFALLS AUTH3 suggests emitting a WS event to the user's browser when a token revokes so the UI updates. Nice-to-have for Phase 25 UI; not required by DAEMON-10. Flag for planner's discretion.

## Pitfalls and Mitigations

| # | Pitfall | One-line mitigation in Phase 19 |
|---|---------|---------------------------------|
| AUTH1 | Token privilege confusion (daemon token on user route OR cookie JWT on daemon route) | Separate middlewares with no shared code; `requireAuth` gets a 3-line `adt_*` bearer reject at top; `/api/daemon/*` never mounts `requireAuth`. |
| AUTH2 | Token leakage in logs / error responses | Error-response contract never echoes `authorization` header or request body; redact any `adt_xxx` substring in catch-all log paths; verify existing `morgan`-style logger (if any) doesn't log headers. |
| AUTH3 | Revocation must fail in-flight requests | DB-backed lookup on every request, no cache; soft revoke via `revoked_at` column; `WHERE revoked_at IS NULL` predicate in middleware SELECT. |
| AUTH4 | Rate limiting on daemon endpoints must not throttle legitimate polling nor allow stolen-token DDoS | Exempt `/api/daemon/*` from global 300-req/15-min via `skip`; add per-token-hash bucket (~1000/min) via `keyGenerator` on a second `rateLimit` mount. |
| AUTH5 | Daemon spawns child process with token equivalent → secondary credential surface | **Out of scope for Phase 19.** Phase 21 (Daemon CLI) owns task-scoped token derivation. Flag explicitly so planner doesn't accidentally design endpoint for child-CLI callbacks now. |
| CE3 | Runtime abstraction must accommodate future drivers | Routes dispatch to generic service functions (`claimTask`, `completeTask`) that don't branch on `runtime.kind`; the discrimination lives in Phase 20's `HostedTaskWorker` vs. the daemon's own polling loop. No `if (kind === 'hosted_instance')` in any daemon route. |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` via `tsx` (zero new dev-deps) — matches Phase 18 harness |
| Config file | none (CLI-driven) |
| Quick run command | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/daemon-auth.test.ts` |
| Full unit run | `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts` |
| E2E | Playwright from repo root: `npx playwright test tests/e2e/daemon.spec.ts` (new) |
| Pre-push gate | `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web` |

### Phase Requirements → Test Map

| Req ID | Behaviour | Test Type | Automated Command | File Exists? |
|--------|-----------|-----------|-------------------|-------------|
| DAEMON-01 | `/register` upserts runtimes + returns ids | integration | `npx tsx --test apps/server/tests/unit/daemon-routes.test.ts` | ❌ Wave 0 |
| DAEMON-02 | `/heartbeat` updates `last_heartbeat_at`, flips offline→online | integration | same | ❌ Wave 0 |
| DAEMON-03 | `/deregister` marks runtimes offline | integration | same | ❌ Wave 0 |
| DAEMON-04 | `/claim` returns exactly one task or null; respects workspace scope | integration | same (reuses Phase 18 seed helpers) | ❌ Wave 0 |
| DAEMON-05 | `/start`, `/progress`, `/messages`, `/complete`, `/fail` with idempotent discarded semantics | integration | same | ❌ Wave 0 |
| DAEMON-06 | `/status` returns current status + cancelled flag | integration | same | ❌ Wave 0 |
| DAEMON-07 | `/api/daemon/*` rejects cookie JWT with 401 | integration | `daemon-auth.test.ts::rejects-cookie-jwt` | ❌ Wave 0 |
| DAEMON-08 | `/api/daemon/*` exempt from global limiter; per-token bucket counts only that token | integration | `rate-limit.test.ts::exempt-daemon-path-per-token-bucket` | ❌ Wave 0 |
| DAEMON-09 | Token is `adt_<32>`, SHA-256 stored, `timingSafeEqual` verifies | unit | `daemon-auth.test.ts::token-shape-and-timing-safe` | ❌ Wave 0 |
| DAEMON-10 | User can issue/list/revoke; plaintext shown once | integration | `daemon-tokens-routes.test.ts` | ❌ Wave 0 |
| SC-1 | Register with `adt_*` returns runtime IDs; cookie JWT returns 401 | integration | `daemon-routes.test.ts::sc-1-register-auth` | ❌ Wave 0 |
| SC-2 | Cookie user hitting `/api/agents` with `adt_*` bearer → 401 | integration | `daemon-auth.test.ts::sc-2-privilege-confusion-reject` | ❌ Wave 0 |
| SC-3 | Daemon at 1 req/s for 5 min against `/claim` never blocked | load | `rate-limit.test.ts::sc-3-5min-sustained-claim` | ❌ Wave 0 |
| SC-4 | Revoked token returns 401 on next request ≤ 1s | integration | `daemon-auth.test.ts::sc-4-revocation-sla` | ❌ Wave 0 |
| SC-5 | Plaintext on creation; later lists show hashed / last-used only | integration | `daemon-tokens-routes.test.ts::sc-5-plaintext-once` | ❌ Wave 0 |

**Unit-level coverage for `requireDaemonAuth` (mandatory)**:

- valid token (happy path — attaches `req.daemonAuth`)
- malformed `Authorization` header (wrong scheme, missing `Bearer`, wrong prefix) → 401
- unknown `token_hash` → 401
- `revoked_at IS NOT NULL` → 401
- `expires_at` in the past → 401
- presence of a test cookie + no `Authorization` → 401 (cookie-rejection contract)
- `timingSafeEqual` path asserted via intentional hash-corruption fixture
- `last_used_at` is updated fire-and-forget (asserted via polling the row after middleware completes)
- any thrown DB error → 401 (never 500 to the caller)

**Unit-level coverage for token generator/hash** (`daemon-token-store.test.ts`):

- `generateDaemonTokenPlaintext()` returns `adt_<32>` pattern, entropy check (no collisions across 10,000 generations)
- `hashDaemonToken('adt_foo')` is stable and matches `sha256('adt_foo').hex`
- Roundtrip: generated plaintext → hash → DB insert → hashDaemonToken(plaintext) → equal

**Integration-level coverage**:

- all 12 endpoints (9 daemon + 3 token-mgmt) — status codes, response shapes
- Cross-workspace spoof attempt: daemon A token tries to claim runtime owned by workspace B → 404 (runtime-registry filter kicks in first)
- Rate-limit exemption: 400 requests to `/api/daemon/heartbeat` in 60s succeeds (exceeds the global 300/15min); same workload to `/api/agents` is 429-throttled in production mode
- Rate-limit per-token bucket: 1001 requests from the same token in 60s → 429 on #1001; simultaneously 100 requests with a *different* token succeed

### Sampling Rate
- **Per task commit:** `NODE_OPTIONS=--no-experimental-require-module npx tsx --test apps/server/tests/unit/*.test.ts`
- **Per wave merge:** full unit suite + `npx playwright test tests/e2e/daemon.spec.ts` (if daemon E2E fixture exists)
- **Phase gate:** full unit + E2E + `npm run build -w @aquarium/shared && npm run typecheck -w @aquaclawai/aquarium && npm run lint -w @aquarium/web` all exit 0

### Wave 0 Gaps
- [ ] `apps/server/tests/unit/daemon-auth.test.ts` — middleware unit tests (covers DAEMON-07, -09, SC-2, SC-4)
- [ ] `apps/server/tests/unit/daemon-token-store.test.ts` — token gen + hash tests (covers DAEMON-09)
- [ ] `apps/server/tests/unit/daemon-routes.test.ts` — integration tests over the 9 daemon endpoints (covers DAEMON-01..06)
- [ ] `apps/server/tests/unit/daemon-tokens-routes.test.ts` — integration tests over the 3 user endpoints (covers DAEMON-10, SC-5)
- [ ] `apps/server/tests/unit/rate-limit.test.ts` — exemption + per-token bucket (covers DAEMON-08, SC-3)
- [ ] `tests/e2e/daemon.spec.ts` — single end-to-end "user creates token, daemon registers, claims, completes, user revokes" Playwright flow (ties SC-1..SC-5 together)
- [ ] Test fixtures: a helper `seedDaemonToken(ctx.db, { workspaceId, name }): { id, plaintext }` in `test-db.ts` (returns plaintext once, mirroring production contract) — enables the other tests

All Wave 0 test harness primitives (throwaway SQLite via `test-db.ts`, boot PRAGMA checks, `seedRuntime`/`seedAgent`/`seedIssue`/`seedTask`) are already in place from Phase 18 Plan 01.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer-token auth with `timingSafeEqual`-verified SHA-256 hashed credentials |
| V3 Session Management | partial | Tokens are long-lived bearer credentials (no session cookies on daemon routes) — explicit `expires_at` column + `revoked_at` soft-delete |
| V4 Access Control | yes | Per-workspace scoping: `req.daemonAuth.workspaceId` threads into every service call; cross-workspace claims 404 via runtime-registry filter |
| V5 Input Validation | yes | Express `body-parser` JSON limit already `10mb`; per-endpoint shape validation (manual) mirrors `routes/issues.ts` pattern |
| V6 Cryptography | yes | `crypto.createHash('sha256')`, `crypto.randomBytes(24)`, `crypto.timingSafeEqual` from `node:crypto` (never hand-roll) |

### Known Threat Patterns for Express + SQLite + Bearer Token

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token stuffing / credential replay across tenants | Elevation | Workspace scoping in every service call; token table FK to workspace |
| Timing-leak on token comparison | Information Disclosure | `timingSafeEqual` on hex-buffer pair of equal length |
| DDoS via stolen token | DoS | Per-token rate-limit bucket (~1000/min); token revocation via `revoked_at` takes effect ≤ 1s |
| SQL injection on token verify | Tampering | Parameterised `knex().where({ token_hash })` builder — never string-concat |
| Cookie-JWT → bearer upgrade | Elevation | `requireAuth` rejects `Authorization: Bearer adt_*` (top-of-handler string check) |
| Token exfiltration via error echo | Information Disclosure | Error responses use fixed-string `error` fields, never `err.message` for auth failures |
| Token exfiltration via logs | Information Disclosure | Audit existing logger config (`apps/server/src/index.ce.ts`, `server-core.ts`) — Aquarium uses bare `console.log` not morgan; ensure no Authorization header ever hits console |

## Open Questions for Planner

1. **DaemonRegisterRequest body vs. token scoping.** The current shape (`v14-types.ts:195`) has `workspaceId` in the body. Middleware already has it. Planner: reject mismatch (defence-in-depth) or drop from the request type (breaking change — but Phase 19 is first consumer so cheap)?
2. **`skip:` predicate authoring.** One `skip: (req) => req.originalUrl.startsWith('/api/daemon/')` on both the static and dynamic `/api/` limiters? Or wrap the current `app.use('/api/', ...)` registrations in a conditional mount that never sees `/api/daemon/*`? Recommend the `skip:` approach — smaller diff, easier to reason about.
3. **WS event on token revocation.** PITFALLS AUTH3 recommends emitting a `daemon-token:revoked` WS event so the UI refreshes immediately. Not in DAEMON-10 requirements. Ship now (single `broadcast(workspaceId, {...})` after the UPDATE) or defer to Phase 25?
4. **`progress` endpoint semantics.** Phase 18 schema has no `progress` column on `agent_task_queue`. Options: (a) store in `task_messages` as a new `type='progress'` row — but Phase 15 frozen the `TaskMessageType` union — OR (b) fire a pure WS event with no DB side-effect. Recommend (b).
5. **`/register` response shape: full `Runtime[]` or `{ runtimeId, provider }[]` map?** Existing `DaemonRegisterResponse` is `{ runtimes: Runtime[] }`. Full object is heavier; the daemon only needs the IDs. Flag — either is safe, full Runtime[] matches the shared type and doesn't need a new type.
6. **Rate-limit numeric target.** `~1000/min` per DAEMON-08 — planner pick exact figure. 1000/min supports 16 req/sec sustained, which handles 5 runtimes × 1Hz poll + 10× margin.
7. **`created_by_user_id`.** The column exists (migration 008). Planner: populate from `req.auth.userId` at token-creation time.
8. **Exposing `daemon_id`.** `DaemonAuthPayload.daemonId` is `string | null` — set only after first `/register`. Should `/heartbeat` reject until `/register` has populated it, or silently accept? Recommend: `/heartbeat` checks `req.daemonAuth.daemonId != null`, returns 409 if not — forces correct lifecycle.

## Project Constraints (from CLAUDE.md)

- Server ESM imports MUST use `.js` extension. New files: `daemon-auth.js`, `daemon-token-store.js`, `routes/daemon.js`, `routes/daemon-tokens.js`.
- No `any`, no `@ts-ignore`, no `@ts-expect-error`. Use `unknown` with type guards at every deserialisation boundary.
- Routes → services → runtime/DB. Routes never call DB or runtime directly — delegate to a new `daemon-token-store.ts` service for the three token-management endpoints.
- Never write `process.env` outside `config.ts`. If a new setting is needed (rate-limit numbers), add to `config.ts`.
- All API responses: `ApiResponse<T>`. Every route returns either `{ ok: true, data: T }` or `{ ok: false, error: string }`.
- Files: kebab-case for new server `.ts` files.
- No linter for server — but `npm run typecheck -w @aquaclawai/aquarium` is the CI gate.
- Testing: Playwright for E2E only; otherwise `node:test` via `tsx` per Phase 18 convention.
- Every bug fix needs a regression test (global preference).

## Sources

### Primary (HIGH confidence)
- `node_modules/express-rate-limit/dist/index.d.ts` (v8.3.2) — types for `skip`, `keyGenerator`, `ValueDeterminingMiddleware` [VERIFIED locally]
- `node_modules/express-rate-limit/package.json` — version 8.3.2 confirmed [VERIFIED locally]
- `apps/server/src/db/migrations/008_daemon_tokens.ts` — daemon_tokens table shape [VERIFIED — existing migration]
- `apps/server/src/services/task-queue-store.ts` — claim/lifecycle/isTaskCancelled contracts [VERIFIED — Phase 18 shipped]
- `apps/server/src/services/runtime-registry.ts` — upsertDaemonRuntime, updateHeartbeat, setRuntimeOffline [VERIFIED — Phase 16 shipped]
- `apps/server/src/middleware/auth.ts` — existing `requireAuth` shape [VERIFIED — current code]
- `apps/server/src/middleware/dynamic-middleware.ts` — existing limiter pattern [VERIFIED]
- `apps/server/src/server-core.ts:119-151` — current rate-limiter mount sites [VERIFIED]
- `packages/shared/src/v14-types.ts:174-230` — DaemonToken, DaemonRegisterRequest/Response, ClaimedTask [VERIFIED]
- `.planning/research/PITFALLS.md:362-430` — AUTH1-AUTH5 with prevention guidance [CITED]

### Secondary (MEDIUM confidence)
- `.planning/phases/18-task-queue-dispatch/18-01-SUMMARY.md` — `withImmediateTx` contract for tests [VERIFIED]
- `.planning/phases/18-task-queue-dispatch/18-04-SUMMARY.md` — TASK-05/06 discarded-completion pattern [VERIFIED]
- `.planning/phases/16-runtime-registry-runtime-bridge/16-03-SUMMARY.md` — thin-controller route pattern [VERIFIED]
- Node.js 22 `node:crypto` documented behaviour of `timingSafeEqual` (length-equal requirement, ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH) [CITED: Node.js docs]
- `randomBytes(24).toString('base64url')` → 32 chars (3-byte alignment, no padding) [CITED: RFC 4648 §5 + Node docs]

### Tertiary (LOW confidence — flagged as assumed)
- Performance headroom claim ("SQLite WAL handles 10,000+ reads/sec") [ASSUMED — not measured on Aquarium's actual hardware; recommend validation step if uncertainty matters]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SQLite WAL comfortably handles 5-100 daemon auth lookups/sec on CE deployments | Revocation Propagation §Performance envelope | Low — local SQLite is not the bottleneck at this scale on any machine that can run Aquarium at all. Worst case: measure at Phase 26 integration. |
| A2 | The existing `express-rate-limit` store (in-memory, per-process) is sufficient for the per-token bucket in CE single-process mode | Rate-Limiter Topology | Low for CE. For EE multi-replica, a Redis store is needed — out of scope for Phase 19 but flag in ROADMAP for EE. |
| A3 | No existing production code logs `req.headers.authorization` | Pitfall AUTH2 | Planner verification step: grep for `headers.authorization` and `req.headers` in logging code paths. |

## Metadata

**Confidence breakdown:**
- Rate-limiter topology: HIGH — confirmed against installed `express-rate-limit@8.3.2` types; no guessing
- `requireDaemonAuth` spec: HIGH — the column shape, SHA-256, and timingSafeEqual are all in migration 008 + standard `node:crypto`
- Cookie/daemon separation: HIGH — AUTH1 pattern is well-known; CE pass-through gap identified and mitigated with a 3-line addition
- Endpoint map: HIGH — every service function exists already (Phase 16/17/18); this phase is pure HTTP wrapping
- Idempotency / error shapes: HIGH — TASK-06 discarded semantics already shipped in Phase 18
- Revocation propagation: HIGH design / MEDIUM performance (SLA is trivially met at any plausible load)
- Pitfalls / ASVS: HIGH — direct from project PITFALLS.md; all 6 owned pitfalls have concrete mitigations
- Validation architecture: HIGH — test framework is already in place, gap list is concrete

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days; stable dependency versions, no fast-moving components)

## RESEARCH COMPLETE

**Phase:** 19 - Daemon REST API & Auth
**Confidence:** HIGH

### Key Findings

- `express-rate-limit@8.3.2` (already installed) supports `skip: ValueDeterminingMiddleware<boolean>` and `keyGenerator: ValueDeterminingMiddleware<string>`. DAEMON-08 solvable with the existing dep — no new library.
- The `daemon_tokens` table (migration 008) is shipped with `token_hash(64) UNIQUE`, `revoked_at`, `expires_at`, `last_used_at`. `requireDaemonAuth` is a ~40-LOC middleware over `node:crypto` primitives.
- A critical CE gap: the current `requireAuth` middleware auto-authenticates as the first user regardless of `Authorization` header contents. **SC-2 (privilege confusion rejection) fails today** — Phase 19 MUST add a 3-line `adt_*` bearer reject at the top of `requireAuth` to satisfy AUTH1.
- All 9 daemon endpoints dispatch to existing Phase 16/17/18 service functions — the route layer is a thin HTTP wrapper. TASK-06 `{ discarded: true }` semantics already shipped.
- Token format math: `randomBytes(24).toString('base64url')` yields exactly 32 chars → `adt_<32>` = 36 chars total, 192-bit entropy. [VERIFIED]

### File Created
`.planning/phases/19-daemon-rest-api-auth/19-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Rate-limiter stack | HIGH | Verified against installed `express-rate-limit@8.3.2` .d.ts |
| `requireDaemonAuth` spec | HIGH | Migration 008 column shape; node:crypto is standard |
| Cookie/daemon separation | HIGH | AUTH1 + CE pass-through gap identified and mitigated |
| Token generator | HIGH | Math verified for base64url encoding |
| Endpoint→service mapping | HIGH | All service functions exist today (Phase 16/17/18) |
| Idempotency (discarded) | HIGH | TASK-06 already implemented in task-queue-store |
| Rate-limit SLA proofs (SC-3, SC-4) | MEDIUM | Design is correct; measurement at CE scale assumed straightforward |
| Pitfalls & Validation | HIGH | Direct from PITFALLS.md + existing Wave 0 test infrastructure |

### Open Questions

See `## Open Questions for Planner` — 8 items, all narrow (body-scoping, WS on revoke, rate-limit target, progress endpoint semantics).

### Ready for Planning

Research complete. Planner can now create PLAN.md files. Estimated scope: **4 plans**:
1. Middleware + token-store service (`requireDaemonAuth`, `daemon-token-store`, CE AUTH1 guard in `requireAuth`)
2. Daemon routes (9 endpoints, rate-limit exemption + per-token bucket)
3. Daemon-token user routes (3 endpoints, plaintext-once contract)
4. Test wave (unit + integration + E2E + SC-1..5 proofs)
