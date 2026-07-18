import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  issueDaemonToken,
  listDaemonTokens,
  revokeDaemonToken,
} from '../services/daemon-token-store.js';
import type {
  ApiResponse,
  DaemonToken,
  DaemonTokenCreatedResponse,
} from '@aquarium/shared';

/**
 * Phase 19-03 user-facing token-management API.
 *
 * Three endpoints under `/api/daemon-tokens/*` all gated by the standard
 * cookie-JWT `requireAuth` (these are user routes, not daemon routes).
 * An `adt_*` bearer on this surface is rejected by the AUTH1 guard inside
 * `requireAuth` (Phase 19-01), so the daemon can never reach these handlers.
 *
 * Contract (DAEMON-10, AUTH2, AUTH4):
 *   - POST /  → `{ token: DaemonToken, plaintext: 'adt_<32>' }` — plaintext
 *     leaves the server EXACTLY ONCE here; never in GET, never in any
 *     subsequent response body, never in a log line.
 *   - GET /   → `DaemonToken[]` — the shared projection has no `token_hash`
 *     and no `plaintext` fields by construction; the route returns it verbatim.
 *   - DELETE /:id → `{ ok: true }`. Soft revoke via `revoked_at = now()`.
 *     Idempotent: repeat DELETE still returns 200 (no 404 on double-revoke).
 *     Cross-workspace id → 404 (tenant boundary — AUTH4 / IDOR guard via the
 *     pre-check against the workspace-scoped `listDaemonTokens`).
 *
 * Workspace scoping matches the rest of the CE route layer (`routes/runtimes.ts`,
 * `routes/agents.ts`, `routes/issues.ts`): the constant `AQ` is the only
 * workspace in CE. EE will later plumb `req.auth.workspaceId`.
 */

const router = Router();
router.use(requireAuth);

// CE: single default workspace (seeded by migration 003, matches the rest of
// the route layer). TODO(EE): swap for `req.auth.workspaceId` once the auth
// payload carries it.
const DEFAULT_WORKSPACE_ID = 'AQ';

const MAX_NAME_LENGTH = 100;

// ── POST / — create token (plaintext returned ONCE) ───────────────────────
router.post('/', async (req, res) => {
  try {
    const rawName = (req.body as { name?: unknown } | undefined)?.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) {
      res.status(400).json({ ok: false, error: 'name required' } satisfies ApiResponse);
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      res.status(400).json({
        ok: false,
        error: `name too long (max ${MAX_NAME_LENGTH} chars)`,
      } satisfies ApiResponse);
      return;
    }
    const rawExpiresAt = (req.body as { expiresAt?: unknown } | undefined)?.expiresAt;
    const expiresAt = typeof rawExpiresAt === 'string' ? rawExpiresAt : null;
    const userId = req.auth?.userId ?? null;

    const payload = await issueDaemonToken({
      workspaceId: DEFAULT_WORKSPACE_ID,
      name,
      expiresAt,
      createdByUserId: userId,
    });

    res.json({ ok: true, data: payload } satisfies ApiResponse<DaemonTokenCreatedResponse>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── GET / — list (NEVER returns plaintext or token_hash) ──────────────────
router.get('/', async (_req, res) => {
  try {
    const tokens = await listDaemonTokens(DEFAULT_WORKSPACE_ID);
    // `listDaemonTokens` returns the `DaemonToken` projection (via
    // `rowToDaemonToken` from 19-01) — no `tokenHash`, no plaintext. The
    // route passes it through unchanged; no projection step is safer than
    // one that could accidentally add a field.
    res.json({ ok: true, data: tokens } satisfies ApiResponse<DaemonToken[]>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

// ── DELETE /:id — soft revoke ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Workspace-scope pre-check. `revokeDaemonToken(id, ws)` returns `false`
    // for both "not found" and "already revoked" — we want to distinguish
    // "not found" (404) from "already revoked" (200 idempotent). Looking
    // the id up via `listDaemonTokens` gives us a workspace-filtered existence
    // test without coupling the service layer to the route's 404 semantics.
    const tokens = await listDaemonTokens(DEFAULT_WORKSPACE_ID);
    const exists = tokens.some((t) => t.id === req.params.id);
    if (!exists) {
      res.status(404).json({ ok: false, error: 'token not found' } satisfies ApiResponse);
      return;
    }
    await revokeDaemonToken(req.params.id, DEFAULT_WORKSPACE_ID);
    // Swallow the boolean — idempotent by design. `revokeDaemonToken`
    // returns `false` on a double-revoke; the user already got "revoked"
    // the first time, so returning `ok: true` again is the correct UX.
    res.json({ ok: true, data: { ok: true } } satisfies ApiResponse<{ ok: boolean }>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

export default router;
