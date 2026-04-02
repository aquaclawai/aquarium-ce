import { Router } from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import type { ApiResponse, User, UserExtended, LoginHistoryEntry, UpdateProfileRequest } from '@aquarium/shared';
import crypto from 'node:crypto';

const router = Router();

// ── Test-only auth routes (NODE_ENV=test) ──────────────────────────────────
// These routes bypass Clerk entirely to allow E2E tests to create users and
// authenticate without a real Clerk instance.  They are NEVER registered in
// production — the guard is at route-registration time, not just runtime.

if (config.nodeEnv === 'test' || !config.clerk.secretKey) {
  /**
   * POST /api/auth/test-signup
   * Creates a local user and sets the __test_auth cookie.
   * Body: { email, password?, displayName? }
   */
  router.post('/test-signup', async (req, res) => {
    try {
      const { email, password, displayName } = req.body as {
        email?: string;
        password?: string;
        displayName?: string;
      };

      if (!email) {
        res.status(400).json({ ok: false, error: 'Email is required' } satisfies ApiResponse);
        return;
      }

      // Check for duplicate
      const existing = await db('users').where({ email: email.toLowerCase() }).first();
      if (existing) {
        res.status(409).json({ ok: false, error: 'Email already exists' } satisfies ApiResponse);
        return;
      }

      const [newUser] = await db('users')
        .insert({
          email: email.toLowerCase(),
          password_hash: password ? `test:${password}` : null,
          display_name: displayName ?? email.split('@')[0],
          clerk_id: `test_${crypto.randomUUID()}`,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['id', 'email', 'display_name']);

      // Insert auth_events record for signup
      await db('auth_events').insert({
        event_type: 'signup',
        user_id: newUser.id,
        email: email.toLowerCase(),
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
        created_at: new Date(),
      });

      const token = `test:${newUser.id}`;
      res.cookie('token', token, { httpOnly: true, path: '/' });

      const user: User = {
        id: newUser.id,
        email: newUser.email,
        displayName: newUser.display_name,
        createdAt: new Date().toISOString(),
      };

      res.status(201).json({
        ok: true,
        data: { user, token },
      } satisfies ApiResponse<{ user: User; token: string }>);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
    }
  });

  /**
   * POST /api/auth/test-login
   * Looks up a user by email and sets the __test_auth cookie.
   * Body: { email, password? }
   */
  router.post('/test-login', async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };

      if (!email) {
        res.status(400).json({ ok: false, error: 'Email is required' } satisfies ApiResponse);
        return;
      }

      const row = await db('users').where({ email: email.toLowerCase() }).first();
      if (!row) {
        res.status(401).json({ ok: false, error: 'Invalid credentials' } satisfies ApiResponse);
        return;
      }

      // If password stored, validate (simple comparison for test passwords)
      if (password && row.password_hash && row.password_hash.startsWith('test:')) {
        const storedPassword = row.password_hash.slice(5);
        if (storedPassword !== password) {
          res.status(401).json({ ok: false, error: 'Invalid credentials' } satisfies ApiResponse);
          return;
        }
      }

      // Insert auth_events record for login
      await db('auth_events').insert({
        event_type: 'login',
        user_id: row.id,
        email: email.toLowerCase(),
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
        created_at: new Date(),
      });

      const token = `test:${row.id}`;
      res.cookie('token', token, { httpOnly: true, path: '/' });

      const user: User = {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        createdAt: String(row.created_at),
      };

      res.json({
        ok: true,
        data: { user, token },
      } satisfies ApiResponse<{ user: User; token: string }>);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
    }
  });

  /**
   * PUT /api/auth/password
   * Change password for the authenticated user (test mode only).
   * Body: { currentPassword, newPassword }
   */
  router.put('/password', requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!currentPassword || !newPassword) {
        res.status(400).json({ ok: false, error: 'currentPassword and newPassword are required' } satisfies ApiResponse);
        return;
      }

      const row = await db('users').where({ id: req.auth!.userId }).first();
      if (!row) {
        res.status(404).json({ ok: false, error: 'User not found' } satisfies ApiResponse);
        return;
      }

      // Validate current password (test format: "test:<password>")
      if (row.password_hash && row.password_hash.startsWith('test:')) {
        const storedPassword = row.password_hash.slice(5);
        if (storedPassword !== currentPassword) {
          res.status(401).json({ ok: false, error: 'Current password is incorrect' } satisfies ApiResponse);
          return;
        }
      }

      await db('users')
        .where({ id: req.auth!.userId })
        .update({
          password_hash: `test:${newPassword}`,
          password_changed_at: new Date(),
          updated_at: new Date(),
        });

      res.json({ ok: true } satisfies ApiResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
    }
  });
}

// ── Standard routes ─────────────────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.clearCookie('__session');
  res.json({ ok: true } satisfies ApiResponse);
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const row = await db('users').where({ id: req.auth!.userId }).first();
    if (!row) {
      res.status(404).json({ ok: false, error: 'User not found' } satisfies ApiResponse);
      return;
    }

    const isAdmin = config.adminEmails.includes(row.email);
    const userExtended: UserExtended = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: String(row.created_at),
      avatarUrl: row.avatar_url ?? null,
      passwordChangedAt: row.password_changed_at ? String(row.password_changed_at) : null,
      totpEnabled: row.totp_enabled ?? false,
      role: isAdmin ? 'admin' : 'user',
      clerkId: row.clerk_id ?? null,
      authProvider: 'clerk',
    };

    res.json({ ok: true, data: { user: userExtended } } satisfies ApiResponse<{ user: UserExtended }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body as UpdateProfileRequest;

    if (!displayName || displayName.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'Display name is required' } satisfies ApiResponse);
      return;
    }

    const [row] = await db('users')
      .where({ id: req.auth!.userId })
      .update({ display_name: displayName.trim(), updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(404).json({ ok: false, error: 'User not found' } satisfies ApiResponse);
      return;
    }

    const user: User = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: String(row.created_at),
    };

    res.json({ ok: true, data: user } satisfies ApiResponse<User>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/login-history', requireAuth, async (req, res) => {
  try {
    const rows = await db('auth_events')
      .where({ user_id: req.auth!.userId })
      .orderBy('created_at', 'desc')
      .limit(50);

    const entries: LoginHistoryEntry[] = rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      eventType: String(r.event_type),
      ipAddress: r.ip_address != null ? String(r.ip_address) : null,
      userAgent: r.user_agent != null ? String(r.user_agent) : null,
      createdAt: String(r.created_at),
      ...(r.failure_reason != null ? { failureReason: String(r.failure_reason) } : {}),
    }));

    res.json({ ok: true, data: entries } satisfies ApiResponse<LoginHistoryEntry[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
