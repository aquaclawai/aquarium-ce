import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { InstanceSecuritySummary, InstanceEvent } from '@aquarium/shared';

interface SecurityStatusBadgeProps {
  instanceId: string;
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PROTECTION_KEYS = ['trustLayers', 'injectionDetection', 'outputFiltering', 'dlpScanning', 'configIntegrity'] as const;

export function SecurityStatusBadge({ instanceId }: SecurityStatusBadgeProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<InstanceSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<InstanceSecuritySummary>(`/instances/${instanceId}/security-summary`)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [instanceId]);

  if (loading) return <div className="security-status"><div>{t('common.labels.loading')}</div></div>;
  if (!summary) return null;

  return (
    <div className="security-status">
      <div className="security-status-card">
        <h4>{t('instance.security.status.events24h')}</h4>
        <div className="security-stats-grid">
          <div className="security-stat">
            <span className="security-stat-value security-stat-value--total">{summary.totalEvents24h}</span>
            <span className="security-stat-label">{t('instance.security.status.events24h')}</span>
          </div>
          <div className="security-stat">
            <span className="security-stat-value security-stat-value--critical">{summary.bySeverity.critical ?? 0}</span>
            <span className="security-stat-label">{t('instance.security.status.criticalEvents')}</span>
          </div>
          <div className="security-stat">
            <span className="security-stat-value security-stat-value--warning">{summary.bySeverity.warning ?? 0}</span>
            <span className="security-stat-label">{t('instance.security.status.warningEvents')}</span>
          </div>
          <div className="security-stat">
            <span className="security-stat-value security-stat-value--info">{summary.bySeverity.info ?? 0}</span>
            <span className="security-stat-label">{t('instance.security.status.infoEvents')}</span>
          </div>
        </div>
      </div>

      <div className="security-status-card">
        <h4>{t('instance.security.status.protectionIndicators')}</h4>
        <div className="security-protection-list">
          {PROTECTION_KEYS.map(key => {
            const enabled = summary.protection[key];
            const boolEnabled = typeof enabled === 'boolean' ? enabled : Boolean(enabled);
            return (
              <div key={key} className="security-protection-item">
                <span>{t(`instance.security.status.${key}`)}</span>
                <span className={`security-protection-badge security-protection-badge--${boolEnabled ? 'enabled' : 'disabled'}`}>
                  {t(`instance.security.status.${boolEnabled ? 'enabled' : 'disabled'}`)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {summary.topEvents.length > 0 && (
        <div className="security-status-card">
          <h4>{t('instance.security.status.recentEvents')}</h4>
          <div className="security-event-list">
            {summary.topEvents.slice(0, 3).map((event: InstanceEvent) => {
              const sev = (event.metadata?.severity as string) ?? 'info';
              return (
                <div key={event.id} className={`security-event-item security-event-item--${sev}`}>
                  <div className={`security-event-severity security-event-severity--${sev}`} />
                  <div className="security-event-body">
                    <div className="security-event-type">
                      {t(`instance.security.eventType.${event.eventType}`, { defaultValue: event.eventType })}
                    </div>
                    <div className="security-event-time">{formatEventTime(event.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
