import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import type { NotificationSummary, PaginatedResponse, WsMessage } from '@aquarium/shared';

function severityIcon(severity: NotificationSummary['severity']): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'warn': return '⚠️';
    case 'info': return 'ℹ️';
    default: return '🔔';
  }
}

export function NotificationBell() {
  const { t } = useTranslation();
  const { addHandler, removeHandler } = useWebSocket();
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const timeAgo = useCallback((dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('common.time.justNow');
    if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('common.time.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('common.time.daysAgo', { count: days });
  }, [t]);

  useEffect(() => {
    api.get<PaginatedResponse<NotificationSummary>>('/notifications?limit=20')
      .then(data => setNotifications(data.items))
      .catch(err => { console.error('[NotificationBell] Failed to load notifications:', err); });

    api.get<{ count: number }>('/notifications/unread-count')
      .then(data => setUnreadCount(data.count))
      .catch(err => { console.error('[NotificationBell] Failed to load unread count:', err); });
  }, []);

  const handleNotification = useCallback((msg: WsMessage) => {
    const payload = msg.payload as { notification: NotificationSummary };
    if (payload?.notification) {
      setNotifications(prev => [payload.notification, ...prev].slice(0, 20));
      setUnreadCount(prev => prev + 1);
    }
  }, []);

  useEffect(() => {
    addHandler('notification', handleNotification);
    return () => removeHandler('notification', handleNotification);
  }, [addHandler, removeHandler, handleNotification]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      await api.post('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('[NotificationBell] Failed to mark all as read:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('[NotificationBell] Failed to mark notification as read:', err);
    }
  };

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button
        className="notification-bell-button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={unreadCount > 0 ? t('notifications.buttonLabelWithCount', { count: unreadCount }) : t('notifications.buttonLabel')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? t('notifications.unreadBadge') : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <span className="notification-dropdown-title">{t('notifications.title')}</span>
            {unreadCount > 0 && (
              <button
                className="notification-mark-all-btn"
                onClick={handleMarkAllRead}
                disabled={loading}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="notification-dropdown-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">{t('notifications.empty')}</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`notification-item ${n.isRead ? '' : 'notification-item--unread'}`}
                  onClick={() => !n.isRead && handleMarkRead(n.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' && !n.isRead) handleMarkRead(n.id); }}
                >
                  <span className="notification-item-icon">{severityIcon(n.severity)}</span>
                  <div className="notification-item-content">
                    <span className="notification-item-title">{n.title}</span>
                    <span className="notification-item-time">{timeAgo(n.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
