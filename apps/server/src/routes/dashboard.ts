import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import type { ApiResponse } from '@aquarium/shared';

interface DashboardActivity {
  id: string;
  icon: 'bot' | 'message' | 'group' | 'billing';
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  instanceId: string;
  instanceName: string;
}

/** Event types visible to end-users on the dashboard activity feed.
 *  System/internal events (health_check_failed, security_audit, etc.)
 *  are excluded here but remain visible in the instance Events/Security tabs. */
const USER_VISIBLE_EVENTS: string[] = [
  // Lifecycle
  'created', 'started', 'stopped', 'deleted', 'purged', 'cloned',
  // User activity
  'CHAT_MESSAGE',
  // Budget alerts
  'BUDGET_WARNING', 'BUDGET_CRITICAL', 'BUDGET_EXHAUSTED',
];

const EVENT_ICON_MAP: Record<string, DashboardActivity['icon']> = {
  created: 'bot',
  started: 'bot',
  stopped: 'bot',
  deleted: 'bot',
  purged: 'bot',
  cloned: 'bot',
  CHAT_MESSAGE: 'message',
  BUDGET_EXHAUSTED: 'billing',
  BUDGET_CRITICAL: 'billing',
  BUDGET_WARNING: 'billing',
};

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const router = Router();
router.use(requireAuth);

router.get('/activity', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const rows = await db('instance_events as ie')
      .join('instances as i', 'ie.instance_id', 'i.id')
      .where('i.user_id', userId)
      .whereIn('ie.event_type', USER_VISIBLE_EVENTS)
      .orderBy('ie.created_at', 'desc')
      .limit(limit)
      .select(
        'ie.id',
        'ie.event_type',
        'ie.metadata',
        'ie.created_at',
        'ie.instance_id',
        'i.name as instance_name',
      );

    const activities: DashboardActivity[] = rows.map((row: Record<string, unknown>) => {
      const eventType = row.event_type as string;
      const instanceName = (row.instance_name as string) || 'Unknown';
      const metadata = safeParseJson(row.metadata);

      return {
        id: row.id as string,
        icon: EVENT_ICON_MAP[eventType] ?? 'bot',
        eventType,
        metadata,
        createdAt: row.created_at as string,
        instanceId: row.instance_id as string,
        instanceName,
      };
    });

    res.json({ ok: true, data: activities } satisfies ApiResponse<DashboardActivity[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dashboard] GET /activity error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
