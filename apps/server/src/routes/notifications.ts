import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listNotifications,
  getNotification,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  getUnreadCount,
} from '../services/notification-store.js';
import type { ApiResponse, Notification, NotificationSummary, PaginatedResponse } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// GET / — list notifications for the current user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const unreadOnly = req.query.unread === 'true';

    const result = await listNotifications(userId, { page, limit, unreadOnly });
    res.json({ ok: true, data: result } satisfies ApiResponse<PaginatedResponse<NotificationSummary>>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] List error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /unread-count — number of unread notifications
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const count = await getUnreadCount(userId);
    res.json({ ok: true, data: { count } } satisfies ApiResponse<{ count: number }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Unread count error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /read-all — mark all notifications as read
// IMPORTANT: Must be registered BEFORE GET /:id to avoid Express matching "read-all" as :id
router.post('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const count = await markAllAsRead(userId);
    res.json({ ok: true, data: { count } } satisfies ApiResponse<{ count: number }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Mark all read error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:id — single notification detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const notificationId = String(req.params.id);
    const notification = await getNotification(notificationId, userId);

    if (!notification) {
      res.status(404).json({ ok: false, error: 'Notification not found' } satisfies ApiResponse);
      return;
    }

    res.json({ ok: true, data: notification } satisfies ApiResponse<Notification>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Get error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/read — mark single notification as read
router.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const notificationId = String(req.params.id);
    const success = await markAsRead(notificationId, userId);

    if (!success) {
      res.status(404).json({ ok: false, error: 'Notification not found or already read' } satisfies ApiResponse);
      return;
    }

    res.json({ ok: true, data: { success: true } } satisfies ApiResponse<{ success: boolean }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Mark read error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/dismiss — dismiss notification (hide permanently)
router.post('/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const notificationId = String(req.params.id);
    const success = await dismissNotification(notificationId, userId);

    if (!success) {
      res.status(404).json({ ok: false, error: 'Notification not found or already dismissed' } satisfies ApiResponse);
      return;
    }

    res.json({ ok: true, data: { success: true } } satisfies ApiResponse<{ success: boolean }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Dismiss error:', err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
