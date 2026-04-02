import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { broadcastToUser } from '../ws/index.js';
import type {
  BudgetNotificationMetadata,
  Notification,
  NotificationSummary,
  NotificationType,
  NotificationSeverity,
  PaginatedResponse,
  WsNotificationMessage,
} from '@aquarium/shared';

interface CreateNotificationParams {
  userId: string;
  instanceId?: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  metadata?: BudgetNotificationMetadata | Record<string, unknown>;
}

function severityRank(s: string): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export async function createNotification(params: CreateNotificationParams): Promise<Notification | null> {
  const { userId, instanceId, type, severity, title, body, metadata } = params;
  const adapter = getAdapter();

  try {
    let row: Record<string, unknown>;

    if (adapter.dialect === 'pg') {
      const [inserted] = await db('notifications')
        .insert({
          id: adapter.generateId(),
          user_id: userId,
          instance_id: instanceId || null,
          type,
          severity,
          title,
          body: body || null,
          metadata: metadata || {},
        })
        .onConflict(db.raw("(user_id, type, (timezone('UTC', created_at)::date)) WHERE dismissed_at IS NULL"))
        .merge({
          severity: db.raw(`
            CASE WHEN (CASE EXCLUDED.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            > (CASE notifications.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            THEN EXCLUDED.severity ELSE notifications.severity END
          `),
          title: db.raw(`
            CASE WHEN (CASE EXCLUDED.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            > (CASE notifications.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            THEN EXCLUDED.title ELSE notifications.title END
          `),
          body: db.raw(`
            CASE WHEN (CASE EXCLUDED.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            > (CASE notifications.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            THEN EXCLUDED.body ELSE notifications.body END
          `),
          metadata: db.raw(`
            CASE WHEN (CASE EXCLUDED.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            > (CASE notifications.severity
              WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END)
            THEN EXCLUDED.metadata ELSE notifications.metadata END
          `),
        })
        .returning('*');
      row = inserted;
    } else {
      // SQLite: select-then-update/insert pattern (SQLite lacks EXCLUDED in CASE expressions)
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const existing = await db('notifications')
        .where({ user_id: userId, type })
        .whereRaw("date(created_at) = ?", [today])
        .whereNull('dismissed_at')
        .first();

      if (existing) {
        if (severityRank(severity) > severityRank(existing.severity as string)) {
          await db('notifications').where({ id: existing.id }).update({
            severity,
            title,
            body: body || null,
            metadata: JSON.stringify(metadata || {}),
          });
          row = await db('notifications').where({ id: existing.id }).first();
        } else {
          row = existing;
        }
      } else {
        const [inserted] = await db('notifications')
          .insert({
            id: adapter.generateId(),
            user_id: userId,
            instance_id: instanceId || null,
            type,
            severity,
            title,
            body: body || null,
            metadata: JSON.stringify(metadata || {}),
          })
          .returning('*');
        row = inserted;
      }
    }

    if (!row) {
      return null;
    }

    const notification = mapRowToNotification(row);

    const summary: NotificationSummary = {
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    };

    const wsMessage: WsNotificationMessage = {
      type: 'notification',
      payload: { notification: summary },
    };

    broadcastToUser(userId, wsMessage);

    return notification;
  } catch (err) {
    console.error('[notification-store] Failed to create notification:', err);
    return null;
  }
}

export async function listNotifications(
  userId: string,
  options: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  } = {}
): Promise<PaginatedResponse<NotificationSummary>> {
  const { page = 1, limit = 20, unreadOnly = false } = options;
  const offset = (page - 1) * limit;

  let query = db('notifications')
    .where('user_id', userId)
    .whereNull('dismissed_at');

  if (unreadOnly) {
    query = query.whereNull('read_at');
  }

  const [{ count }] = await query.clone().count('* as count');
  const total = Number(count);

  const rows = await query
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .select('id', 'type', 'severity', 'title', 'read_at', 'created_at');

  const items: NotificationSummary[] = rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    type: row.type as NotificationType,
    severity: row.severity as NotificationSeverity,
    title: row.title as string,
    isRead: row.read_at !== null,
    createdAt: (row.created_at as Date).toISOString(),
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getNotification(notificationId: string, userId: string): Promise<Notification | null> {
  const row = await db('notifications')
    .where({ id: notificationId, user_id: userId })
    .first();

  if (!row) return null;
  return mapRowToNotification(row);
}

export async function markAsRead(notificationId: string, userId: string): Promise<boolean> {
  const updated = await db('notifications')
    .where({ id: notificationId, user_id: userId })
    .whereNull('read_at')
    .update({ read_at: db.fn.now() });

  return updated > 0;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const updated = await db('notifications')
    .where({ user_id: userId })
    .whereNull('read_at')
    .whereNull('dismissed_at')
    .update({ read_at: db.fn.now() });

  return updated;
}

export async function dismissNotification(notificationId: string, userId: string): Promise<boolean> {
  const updated = await db('notifications')
    .where({ id: notificationId, user_id: userId })
    .whereNull('dismissed_at')
    .update({ dismissed_at: db.fn.now() });

  return updated > 0;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [{ count }] = await db('notifications')
    .where({ user_id: userId })
    .whereNull('read_at')
    .whereNull('dismissed_at')
    .count('* as count');

  return Number(count);
}

export async function cleanupOldNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const deleted = await db('notifications')
    .where('created_at', '<', cutoff)
    .delete();

  return deleted;
}

function mapRowToNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    instanceId: (row.instance_id as string) || null,
    type: row.type as NotificationType,
    severity: row.severity as NotificationSeverity,
    title: row.title as string,
    body: (row.body as string) || null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    isRead: row.read_at !== null,
    isDismissed: row.dismissed_at !== null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
