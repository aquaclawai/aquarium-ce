import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { ApiResponse, UserSearchResult } from '@aquarium/shared';

const router = Router();

router.get('/search', requireAuth, async (req, res) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

    if (!email || email.length < 3) {
      res.status(400).json({ ok: false, error: 'Email query must be at least 3 characters' } satisfies ApiResponse);
      return;
    }

    const rows = await db('users')
      .whereRaw('LOWER(email) LIKE ?', [`%${email}%`])
      .where('id', '!=', req.auth!.userId)
      .select('id', 'email', 'display_name')
      .limit(10);

    const results: UserSearchResult[] = rows.map((row: { id: string; email: string; display_name: string }) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
    }));

    res.json({ ok: true, data: results } satisfies ApiResponse<UserSearchResult[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
