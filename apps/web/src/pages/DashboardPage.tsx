import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { BurnRateCard } from '../components/BurnRateCard';
import type { InstancePublic, WsMessage, UsageSummary, SecuritySummary } from '@aquarium/shared';

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();
  const [instances, setInstances] = useState<InstancePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<InstancePublic[]>('/instances'),
      api.get<UsageSummary>('/usage').catch(() => null),
      api.get<SecuritySummary>('/security/summary').catch(() => null),
    ])
      .then(([inst, usage, sec]) => {
        setInstances(inst);
        if (usage) setUsageSummary(usage);
        if (sec) setSecuritySummary(sec);
      })
      .catch(err => setError(err instanceof Error ? err.message : t('common.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    for (const inst of instances) {
      subscribe(inst.id);
    }
    return () => {
      for (const inst of instances) {
        unsubscribe(inst.id);
      }
    };
  }, [instances, subscribe, unsubscribe]);

  const handleStatusUpdate = useCallback((message: WsMessage) => {
    const { instanceId, payload } = message;
    setInstances(prev => prev.map(inst =>
      inst.id === instanceId
        ? { ...inst, status: payload.status as InstancePublic['status'], statusMessage: (payload.statusMessage as string) ?? null }
        : inst,
    ));
  }, []);

  useEffect(() => {
    addHandler('instance:status', handleStatusUpdate);
    return () => removeHandler('instance:status', handleStatusUpdate);
  }, [addHandler, removeHandler, handleStatusUpdate]);

  if (loading) return <div className="dashboard-page">{t('common.labels.loading')}</div>;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        <div className="dashboard-header-actions">
          <button onClick={() => navigate('/create')}>{t('common.buttons.createInstance')}</button>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      {usageSummary && (usageSummary.totalSpendUsd ?? 0) > 0 && (
        <div className="dashboard-usage-summary" style={{
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--spacing-lg)',
          marginBottom: 'var(--spacing-lg)',
        }}>
          <h3 style={{ margin: '0 0 var(--spacing-md) 0', fontSize: '1rem', fontWeight: 600 }}>{t('dashboard.platformUsage')}</h3>
          <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                {(usageSummary.totalSpendUsd ?? 0) < 0.01 ? `$${(usageSummary.totalSpendUsd ?? 0).toFixed(4)}` : `$${(usageSummary.totalSpendUsd ?? 0).toFixed(2)}`}
              </span>
              <span style={{ marginLeft: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{t('dashboard.totalSpend')}</span>
            </div>
            {usageSummary.budgetLimitUsd != null && (
              <div>
                <span style={{ fontSize: '1rem', color: 'var(--color-text-secondary)' }}>
                  {t('dashboard.ofBudget', { amount: usageSummary.budgetLimitUsd.toFixed(2) })}
                </span>
              </div>
            )}
          </div>
          {usageSummary.budgetLimitUsd != null && (
            <div style={{ marginTop: 'var(--spacing-sm)' }}>
              <div style={{ height: '6px', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(usageSummary.budgetUsedPercent ?? 0, 100)}%`,
                  background: (usageSummary.budgetUsedPercent ?? 0) > 90 ? 'var(--color-danger)' : (usageSummary.budgetUsedPercent ?? 0) > 70 ? 'var(--color-warning)' : 'var(--color-primary)',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'width 0.3s ease-out',
                }} />
              </div>
            </div>
          )}
        </div>
      )}

      {usageSummary && (usageSummary.budgetLimitUsd ?? 0) > 0 && (
        <BurnRateCard />
      )}

      {securitySummary && securitySummary.totalEvents > 0 && (
        <div className="dashboard-security-panel">
          <h3>{t('instance.security.dashboard.title')}</h3>
          <div className="dashboard-security-stats">
            <div>
              <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{securitySummary.totalEvents}</span>
              <span style={{ marginLeft: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{t('instance.security.dashboard.totalEvents')}</span>
            </div>
            {securitySummary.recentCritical > 0 && (
              <div>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-danger, #ef4444)' }}>{securitySummary.recentCritical}</span>
                <span style={{ marginLeft: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{t('instance.security.dashboard.criticalRecent')}</span>
              </div>
            )}
            {Object.entries(securitySummary.bySeverity).map(([sev, count]) => (
              <div key={sev}>
                <span style={{ fontSize: '1rem', fontWeight: 600 }}>{count}</span>
                <span style={{ marginLeft: 'var(--spacing-xs)', color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{t(`instance.security.severity.${sev}`, { defaultValue: sev })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {instances.length === 0 && (
        <div className="info-message">{t('dashboard.noInstances')}</div>
      )}

      <div className="instances-grid">
        {instances.map(inst => (
          <Link key={inst.id} to={`/instances/${inst.id}`} className="instance-card">
            <div className="instance-header">
              <h3>{inst.name}</h3>
              <span className={`status-badge status-${inst.status}`}>
                {(inst.status === 'starting' || inst.status === 'stopping') && <span className="spinner" />}{' '}
                {t(`common.status.${inst.status}`)}
              </span>
            </div>
            <div className="instance-details">
              <p>{t('common.labels.type')}: {inst.agentType}</p>
              <p>{t('common.labels.image')}: {inst.imageTag}</p>
              {inst.status === 'starting' && inst.statusMessage && (
                <p className="status-message">{inst.statusMessage}</p>
              )}
              <p>{t('common.labels.created')}: {new Date(inst.createdAt).toLocaleDateString()}</p>
            </div>
          </Link>
        ))}
      </div>

    </main>
  );
}
