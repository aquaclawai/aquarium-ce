import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Knex } from 'knex';
import { db as defaultDb } from '../db/index.js';

/**
 * requireDaemonAuth — Phase 19-01 Wave 1 middleware.
 *
 * Verifies `Authorization: Bearer adt_<32 base64url>` headers against the
 * `daemon_tokens` table (migration 008). Every request performs a single
 * indexed SELECT on `UNIQUE(token_hash)` with a `revoked_at IS NULL`
 * predicate — no in-memory cache — giving a ≤1s revocation SLA (AUTH3).
 *
 * Response contract (DAEMON-07):
 *   - missing / malformed header              → 401 "daemon token required"
 *   - unknown or revoked hash                  → 401 "invalid or revoked daemon token"
 *   - timingSafeEqual mismatch / length-skew   → 401 "invalid or revoked daemon token"
 *   - expires_at in the past                   → 401 "daemon token expired"
 *   - any unexpected runtime error             → 401 "daemon authentication failed"
 * Never 403, never 500. No request data (bearer substring, full header) is
 * echoed into error bodies (AUTH2); console.warn uses err.message only.
 *
 * On success, attaches:
 *   req.daemonAuth = { tokenId, workspaceId, daemonId, tokenHash }
 * and fires a non-awaited `last_used_at` UPDATE (advisory telemetry).
 *
 * The db override hook (`__setDaemonAuthDbForTests__`) lets unit tests swap
 * the production knex singleton for a throwaway SQLite fixture without
 * changing the Express signature every route consumer sees.
 */

export interface DaemonAuthPayload {
  tokenId: string;
  workspaceId: string;
  daemonId: string | null;
  tokenHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      daemonAuth?: DaemonAuthPayload;
    }
  }
}

export const DAEMON_TOKEN_PREFIX = 'adt_';

let activeDb: Knex = defaultDb;

/** Test hook — swap the knex instance the middleware queries. */
export function __setDaemonAuthDbForTests__(kx: Knex): void {
  activeDb = kx;
}

/** Test hook — restore the production knex singleton. */
export function __resetDaemonAuthDb__(): void {
  activeDb = defaultDb;
}

export async function requireDaemonAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. Structural bearer extraction — cheap reject on malformed headers.
    const authHeader = req.header('authorization') ?? '';
    const match = /^Bearer\s+(adt_[A-Za-z0-9_-]{32,})$/.exec(authHeader);
    if (!match) {
      res.status(401).json({ ok: false, error: 'daemon token required' });
      return;
    }
    const plaintext = match[1];

    // 2. Hash the FULL plaintext (including 'adt_' prefix) — sha256 hex.
    const computedHash = createHash('sha256').update(plaintext).digest('hex');

    // 3. DB lookup — UNIQUE(token_hash) + revoked_at IS NULL predicate.
    const row = await activeDb('daemon_tokens')
      .where({ token_hash: computedHash })
      .whereNull('revoked_at')
      .first('id', 'workspace_id', 'daemon_id', 'token_hash', 'expires_at');

    if (!row) {
      res.status(401).json({ ok: false, error: 'invalid or revoked daemon token' });
      return;
    }

    // 4. timingSafeEqual — defence-in-depth. Both values are sha256 hex (64
    //    bytes) in normal operation; the length-skew guard protects against
    //    ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH in pathological states.
    const storedBuf = Buffer.from(row.token_hash as string, 'utf8');
    const computedBuf = Buffer.from(computedHash, 'utf8');
    if (
      storedBuf.length !== computedBuf.length ||
      !timingSafeEqual(storedBuf, computedBuf)
    ) {
      res.status(401).json({ ok: false, error: 'invalid or revoked daemon token' });
      return;
    }

    // 5. Expiry check.
    if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
      res.status(401).json({ ok: false, error: 'daemon token expired' });
      return;
    }

    // 6. Attach payload.
    req.daemonAuth = {
      tokenId: row.id as string,
      workspaceId: row.workspace_id as string,
      daemonId: (row.daemon_id as string) ?? null,
      tokenHash: computedHash,
    };

    // 7. Fire-and-forget last_used_at update — intentionally unawaited so the
    //    middleware returns immediately; the UPDATE resolves on the next tick.
    activeDb('daemon_tokens')
      .where({ id: row.id })
      .update({ last_used_at: new Date().toISOString() })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[daemon-auth] last_used_at update failed:', msg);
      });

    next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[daemon-auth] unexpected error:', msg);
    res.status(401).json({ ok: false, error: 'daemon authentication failed' });
  }
}
