import { useTranslation } from 'react-i18next';
import type { AdminStats } from '@aquarium/shared';

interface AdminUsageData {
  globalSpend: number;
  userCount: number;
  perUserSpend: Array<{ userId: string; email: string; displayName: string | null; totalSpend: number; usageLimitUsd: number | null }>;
}

interface OverviewTabProps {
  stats: AdminStats | null;
  usageData: AdminUsageData | null;
  onSetBudget: (userId: string, email: string, currentLimit: number | null) => void;
}

export function OverviewTab({ stats, usageData, onSetBudget }: OverviewTabProps) {
  const { t } = useTranslation();

  return (
    <>
      {stats && (
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <div className="admin-stat-value">{stats.totalUsers}</div>
            <div className="admin-stat-label">{t('admin.stats.totalUsers')}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-value">{stats.totalInstances}</div>
            <div className="admin-stat-label">{t('admin.stats.totalInstances')}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-value admin-stat-running">{stats.instancesByStatus['running'] ?? 0}</div>
            <div className="admin-stat-label">{t('admin.stats.running')}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-value admin-stat-stopped">{stats.instancesByStatus['stopped'] ?? 0}</div>
            <div className="admin-stat-label">{t('admin.stats.stopped')}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-value admin-stat-error">{stats.instancesByStatus['error'] ?? 0}</div>
            <div className="admin-stat-label">{t('admin.stats.error')}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-value">{stats.recentSignups}</div>
            <div className="admin-stat-label">{t('admin.stats.signups7d')}</div>
          </div>
        </div>
      )}

      {stats && Object.keys(stats.instancesByTarget).length > 0 && (
        <div className="admin-targets">
          <h3>{t('admin.deploymentTargets')}</h3>
          <div className="admin-target-badges">
            {Object.entries(stats.instancesByTarget).map(([target, count]) => (
              <span key={target} className="admin-target-badge">
                {target}: {String(count)}
              </span>
            ))}
          </div>
        </div>
      )}

      {usageData && (
        <div className="admin-usage-section" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <h2>{t('admin.platformUsage')}</h2>
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-value" style={{ color: 'var(--color-primary)' }}>
                {(usageData.globalSpend ?? 0) < 0.01
                  ? `$${(usageData.globalSpend ?? 0).toFixed(4)}`
                  : `$${(usageData.globalSpend ?? 0).toFixed(2)}`}
              </div>
              <div className="admin-stat-label">{t('admin.globalSpend')}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-value">{usageData.userCount}</div>
              <div className="admin-stat-label">{t('admin.activeSpenders')}</div>
            </div>
          </div>
          {usageData.perUserSpend.length > 0 && (
            <div className="admin-users-table-wrapper" style={{ marginTop: 'var(--spacing-md)' }}>
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>{t('admin.usageTable.user')}</th>
                    <th>{t('admin.usageTable.email')}</th>
                    <th style={{ textAlign: 'right' }}>{t('admin.usageTable.spend')}</th>
                    <th style={{ textAlign: 'right' }}>{t('admin.usageTable.budgetLimit')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {usageData.perUserSpend.map(u => (
                    <tr key={u.userId}>
                      <td className="admin-user-name">{u.displayName ?? '—'}</td>
                      <td>{u.email}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {(u.totalSpend ?? 0) < 0.01
                          ? `$${(u.totalSpend ?? 0).toFixed(4)}`
                          : `$${(u.totalSpend ?? 0).toFixed(2)}`}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {u.usageLimitUsd != null ? `$${u.usageLimitUsd.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <button
                          className="btn-small btn-secondary"
                          onClick={() => onSetBudget(u.userId, u.email, u.usageLimitUsd)}
                        >
                          {t('admin.usageTable.setBudget')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
