import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { AdminStats, AdminUser } from '@aquarium/shared';
import { OverviewTab } from '../components/admin/OverviewTab';
import { UsersTab } from '../components/admin/UsersTab';
import { LlmKeysTab } from '../components/admin/LlmKeysTab';
import { LitellmUiTab } from '../components/admin/LitellmUiTab';

interface AdminUsageData {
  globalSpend: number;
  userCount: number;
  perUserSpend: Array<{ userId: string; email: string; displayName: string | null; totalSpend: number; usageLimitUsd: number | null }>;
}

type AdminTabId = 'overview' | 'users' | 'llm-keys' | 'litellm-ui';

export function AdminPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<AdminUsageData | null>(null);
  const [budgetUserId, setBudgetUserId] = useState<string | null>(null);
  const [budgetUserEmail, setBudgetUserEmail] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetMsg, setBudgetMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [budgetSaving, setBudgetSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<AdminStats>('/admin/stats'),
      api.get<AdminUser[]>('/admin/users'),
      api.get<AdminUsageData>('/usage/admin').catch(() => null),
    ])
      .then(([s, u, usage]) => {
        setStats(s);
        setUsers(u);
        if (usage) setUsageData(usage);
      })
      .catch(err => setError(err instanceof Error ? err.message : t('admin.failedToLoad')))
      .finally(() => setLoading(false));
  }, []);

  const handleSetBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetUserId) return;
    setBudgetSaving(true);
    setBudgetMsg(null);
    try {
      const usageLimitUsd = budgetLimit.trim() === '' ? null : parseFloat(budgetLimit);
      if (usageLimitUsd !== null && (isNaN(usageLimitUsd) || usageLimitUsd < 0)) {
        setBudgetMsg({ type: 'error', text: t('admin.budget.invalidBudget') });
        return;
      }
      await api.put<void>(`/admin/users/${budgetUserId}/budget`, { usageLimitUsd });
      setBudgetMsg({ type: 'success', text: t('admin.budget.success', { email: budgetUserEmail }) });
      if (usageData) {
        setUsageData({
          ...usageData,
          perUserSpend: usageData.perUserSpend.map(u =>
            u.userId === budgetUserId ? { ...u, usageLimitUsd } : u
          ),
        });
      }
      setTimeout(() => setBudgetUserId(null), 1500);
    } catch (err) {
      setBudgetMsg({ type: 'error', text: err instanceof Error ? err.message : t('admin.budget.failed') });
    } finally {
      setBudgetSaving(false);
    }
  };

  if (loading) return <div className="admin-page">{t('admin.loading')}</div>;

  return (
    <main className="admin-page">
      <header className="dashboard-header">
        <div>
          <h1>{t('admin.title')}</h1>
          <Link to="/" className="admin-back-link">{t('common.buttons.backToInstances')}</Link>
        </div>
        <div className="dashboard-header-actions">
          {user && <span className="user-greeting">{t('admin.greeting', { name: user.displayName })}</span>}
          <button className="btn-secondary" onClick={logout}>{t('common.buttons.logout')}</button>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="tabs">
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>Users</button>
        <button className={activeTab === 'llm-keys' ? 'active' : ''} onClick={() => setActiveTab('llm-keys')}>LLM Keys</button>
        <button className={activeTab === 'litellm-ui' ? 'active' : ''} onClick={() => setActiveTab('litellm-ui')}>LiteLLM UI</button>
      </div>

      <div className="tab-content">
        {activeTab === 'overview' && (
          <OverviewTab
            stats={stats}
            usageData={usageData}
            onSetBudget={(userId, email, limit) => {
              setBudgetUserId(userId);
              setBudgetUserEmail(email);
              setBudgetLimit(limit != null ? String(limit) : '');
              setBudgetMsg(null);
            }}
          />
        )}
        {activeTab === 'users' && <UsersTab users={users} />}
        {activeTab === 'llm-keys' && <LlmKeysTab users={users} />}
        {activeTab === 'litellm-ui' && <LitellmUiTab />}
      </div>

      {budgetUserId && (
        <div className="modal-overlay" onClick={() => setBudgetUserId(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="budget-modal-title">{t('admin.budget.title')}</h2>
            <p>{t('admin.budget.description', { email: budgetUserEmail })}</p>
            <form onSubmit={handleSetBudget}>
              <div className="form-group">
                <label>{t('admin.budget.limitLabel')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t('admin.budget.limitPlaceholder')}
                  value={budgetLimit}
                  onChange={e => setBudgetLimit(e.target.value)}
                />
              </div>
              {budgetMsg && (
                <div
                  className={budgetMsg.type === 'success' ? 'success-message' : 'error-message'}
                  role="alert"
                >
                  {budgetMsg.text}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setBudgetUserId(null)}>
                  {t('common.buttons.cancel')}
                </button>
                <button type="submit" className="btn-primary" disabled={budgetSaving}>
                  {budgetSaving ? t('admin.budget.saving') : t('admin.budget.saveButton')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
