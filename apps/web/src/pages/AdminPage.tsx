import './AdminPage.css';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { AdminStats, AdminUser } from '@aquarium/shared';
import { PageHeader } from '../components/PageHeader';
import { PageHeaderSkeleton, TabsSkeleton, TableSkeleton } from '@/components/skeletons';
import { OverviewTab } from '../components/admin/OverviewTab';
import { UsersTab } from '../components/admin/UsersTab';
import { LlmKeysTab } from '../components/admin/LlmKeysTab';
import { LitellmUiTab } from '../components/admin/LitellmUiTab';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';

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

  if (loading) return (
    <div className="admin-page">
      <PageHeaderSkeleton />
      <TabsSkeleton count={4} />
      <TableSkeleton />
    </div>
  );

  return (
    <main className="admin-page">
      <PageHeader
        title={t('admin.title')}
        subtitle={t('admin.subtitle')}
        action={
          <div className="admin-page__header-actions">
            {user && <span className="user-greeting">{t('admin.greeting', { name: user.displayName })}</span>}
            <Button variant="secondary" onClick={logout}>{t('common.buttons.logout')}</Button>
          </div>
        }
      />
      <Link to="/" className="admin-back-link">{t('common.buttons.backToInstances')}</Link>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="tabs">
        <Button variant="ghost" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Overview</Button>
        <Button variant="ghost" className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>Users</Button>
        <Button variant="ghost" className={activeTab === 'llm-keys' ? 'active' : ''} onClick={() => setActiveTab('llm-keys')}>LLM Keys</Button>
        <Button variant="ghost" className={activeTab === 'litellm-ui' ? 'active' : ''} onClick={() => setActiveTab('litellm-ui')}>LiteLLM UI</Button>
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

      <Dialog open={!!budgetUserId} onOpenChange={open => { if (!open) setBudgetUserId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.budget.title')}</DialogTitle>
            <DialogDescription>{t('admin.budget.description', { email: budgetUserEmail })}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSetBudget}>
            <div className="form-group">
              <label>{t('admin.budget.limitLabel')}</label>
              <Input
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
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setBudgetUserId(null)}>
                {t('common.buttons.cancel')}
              </Button>
              <Button type="submit" disabled={budgetSaving}>
                {budgetSaving ? t('admin.budget.saving') : t('admin.budget.saveButton')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
