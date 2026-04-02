import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

type AuthHandler = (req: Request, res: Response, next: NextFunction) => void;
let _authHandler: AuthHandler | null = null;

/**
 * Register a custom auth handler (used by EE entry to plug in Clerk auth).
 * CE mode never calls this — routes are open for the single local user.
 */
export function setAuthHandler(handler: AuthHandler): void {
  _authHandler = handler;
}

/**
 * Shared requireAuth middleware — pluggable between CE and EE.
 *
 * Flow:
 *   - Test mode (NODE_ENV=test or no Clerk secret): test cookie → OK; no cookie + no handler → pass-through (CE); no cookie + handler → reject (EE test)
 *   - Production CE (no Clerk secret key): no handler registered → pass-through (open access)
 *   - Production EE (Clerk secret present): delegate to registered Clerk auth handler
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Test-mode bypass: if NODE_ENV=test, check for test auth cookie first.
  // The test cookie has the format `test:<userId>` set by /api/auth/test-signup.
  if (config.nodeEnv === 'test' || !config.clerk.secretKey) {
    const tokenCookie = req.cookies?.token as string | undefined;
    if (tokenCookie && tokenCookie.startsWith('test:')) {
      const testUserId = tokenCookie.slice(5);
      db('users')
        .where({ id: testUserId })
        .first()
        .then((row: { id: string; email: string } | undefined) => {
          if (!row) {
            res.status(401).json({ ok: false, error: 'Authentication required' });
            return;
          }
          req.auth = { userId: row.id, email: row.email };
          next();
        })
        .catch(() => {
          res.status(500).json({ ok: false, error: 'Authentication failed' });
        });
      return;
    }
    // No test cookie — if no auth handler registered, pass through (CE mode)
    if (!_authHandler) {
      // CE mode: auto-authenticate as the first user in the DB (single-user self-hosted)
      if (!req.auth) {
        try {
          const firstUser = await db('users').select('id', 'email').first() as { id: string; email: string } | undefined;
          if (firstUser) {
            req.auth = { userId: firstUser.id, email: firstUser.email };
          }
        } catch {
          // DB may not be ready yet — pass through without auth
        }
      }
      next();
      return;
    }
    // In test mode with no test cookie but a handler exists (EE test), reject
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }

  // Production: delegate to registered auth handler
  if (!_authHandler) {
    // No handler = CE mode = pass through (open access for single local user)
    if (!req.auth) {
      try {
        const firstUser = await db('users').select('id', 'email').first() as { id: string; email: string } | undefined;
        if (firstUser) {
          req.auth = { userId: firstUser.id, email: firstUser.email };
        }
      } catch {
        // DB may not be ready yet
      }
    }
    next();
    return;
  }
  _authHandler(req, res, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }
  const email = req.auth.email.toLowerCase();
  const isEnvAdmin = config.adminEmails.length > 0 && config.adminEmails.includes(email);

  if (isEnvAdmin) {
    next();
    return;
  }

  db('users')
    .where({ id: req.auth.userId })
    .select('role')
    .first()
    .then((user: { role?: string } | undefined) => {
      if (user?.role === 'admin') {
        next();
      } else {
        res.status(403).json({ ok: false, error: 'Admin access required' });
      }
    })
    .catch(() => {
      res.status(500).json({ ok: false, error: 'Failed to verify admin status' });
    });
}
