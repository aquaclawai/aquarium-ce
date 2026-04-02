import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { ActivityItem } from '../../hooks/useDashboardData';
import './ActivityFeed.css';

function formatRelativeTime(isoString: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('dashboard.activity.timeJustNow');
  if (diffMin < 60) return t('dashboard.activity.timeMinutesAgo', { count: diffMin });
  if (diffHour < 24) return t('dashboard.activity.timeHoursAgo', { count: diffHour });
  if (diffDay < 7) return t('dashboard.activity.timeDaysAgo', { count: diffDay });
  return new Date(isoString).toLocaleDateString();
}

function formatEventText(item: ActivityItem, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const key = `dashboard.activity.event.${item.eventType}`;
  const result = t(key, { name: item.instanceName, defaultValue: '' });
  if (result) return result;
  return `${item.instanceName}: ${item.eventType}`;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const { t } = useTranslation();

  return (
    <div className="activity-feed">
      <div className="activity-feed__header">
        <Clock size={18} />
        <h3 className="activity-feed__title">{t('dashboard.activity.title')}</h3>
      </div>

      {activities.length === 0 ? (
        <div className="activity-feed__empty">
          <p>{t('dashboard.activity.emptyGuide')}</p>
        </div>
      ) : (
        <ul className="activity-feed__list">
          {activities.map(item => (
            <li key={item.id} className="activity-feed__item">
              <span className="activity-feed__dot" />
              <div className="activity-feed__content">
                <p className="activity-feed__text">{formatEventText(item, t)}</p>
                <span className="activity-feed__time">{formatRelativeTime(item.createdAt, t)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
