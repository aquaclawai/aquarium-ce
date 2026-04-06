import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { SystemConfig, PlatformApiKey, StorageStats, AdminUserWithRole, UserRole } from '@aquarium/shared';
import './SystemConfigPage.css';
import { Button } from '@/components/ui';
import { PageHeaderSkeleton, CardSkeleton } from '@/components/skeletons';
import { GeneralSection } from '../components/system-config/GeneralSection';
import { ApiSection } from '../components/system-config/ApiSection';
import { NotificationsSection } from '../components/system-config/NotificationsSection';
import { SecuritySection } from '../components/system-config/SecuritySection';
import { DataSection } from '../components/system-config/DataSection';
import { PermissionsSection } from '../components/system-config/PermissionsSection';

type NavSection = 'general' | 'api' | 'notifications' | 'security' | 'data' | 'permissions';
const NAV_SECTIONS: NavSection[] = ['general', 'api', 'notifications', 'security', 'data', 'permissions'];
const DEFAULT_CONFIG: SystemConfig = {
  platformName: '',
  platformDescription: '',
  timezone: 'UTC',
  language: 'zh',
  enableUserRegistration: true,
};

export function SystemConfigPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<NavSection>('general');
  const [config, setConfig] = useState<SystemConfig>({ ...DEFAULT_CONFIG });
  const [savedConfig, setSavedConfig] = useState<SystemConfig>({ ...DEFAULT_CONFIG });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [newCorsOrigin, setNewCorsOrigin] = useState('');
  const [corsError, setCorsError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [usersWithRoles, setUsersWithRoles] = useState<AdminUserWithRole[]>([]);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);

  const loadConfig = async () => {
    try {
      const data = await api.get<SystemConfig>('/admin/config');
      const merged = { ...DEFAULT_CONFIG, ...data };
      setConfig(merged);
      setSavedConfig(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.failedToLoad'));
    }
  };

  useEffect(() => { loadConfig().finally(() => setLoading(false)); }, []);

  const loadStorageStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await api.get<StorageStats>('/admin/storage-stats');
      setStorageStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.data.failedToLoadStats'));
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadUsersWithRoles = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await api.get<{ users: AdminUserWithRole[]; adminEmails: string[] }>('/admin/users-with-roles');
      setUsersWithRoles(data.users);
      setAdminEmails(data.adminEmails);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.permissions.failedToLoadUsers'));
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'data' && !storageStats) loadStorageStats();
    if (activeSection === 'permissions' && usersWithRoles.length === 0) loadUsersWithRoles();
  }, [activeSection, storageStats, usersWithRoles.length, loadStorageStats, loadUsersWithRoles]);

  const handleSave = async () => {
    setSaving(true); setError(null); setSuccessMsg(null);
    try {
      const data = await api.put<SystemConfig>('/admin/config', config);
      const merged = { ...DEFAULT_CONFIG, ...data };
      setConfig(merged); setSavedConfig(merged);
      setSuccessMsg(t('systemConfig.saved'));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => { setConfig({ ...savedConfig }); setError(null); setSuccessMsg(null); };

  const handleAddCorsOrigin = () => {
    const origin = newCorsOrigin.trim();
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      setCorsError(t('systemConfig.api.invalidOrigin')); return;
    }
    setCorsError(null);
    const existing = config.corsOrigins ?? [];
    if (!existing.includes(origin)) setConfig({ ...config, corsOrigins: [...existing, origin] });
    setNewCorsOrigin('');
  };

  const handleRemoveCorsOrigin = (origin: string) => {
    setConfig({ ...config, corsOrigins: (config.corsOrigins ?? []).filter(o => o !== origin) });
  };

  const handleGenerateApiKey = async () => {
    const name = newKeyName.trim();
    if (!name) return;
    setError(null);
    try {
      const result = await api.post<PlatformApiKey & { fullKey: string }>('/admin/config/api-keys', { name });
      setGeneratedKey(result.fullKey); setNewKeyName('');
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.api.failedToGenerateKey'));
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    setError(null);
    try {
      await api.delete(`/admin/config/api-keys/${keyId}`);
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.api.failedToRevokeKey'));
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm(t('systemConfig.data.cleanupConfirm'))) return;
    setCleaningUp(true); setError(null);
    try {
      const result = await api.post<{ deletedEvents: number; deletedAuthEvents: number; deletedAuditLog: number }>('/admin/cleanup');
      setSuccessMsg(t('systemConfig.data.cleanupSuccess', { events: result.deletedEvents, authEvents: result.deletedAuthEvents, auditLog: result.deletedAuditLog }));
      setTimeout(() => setSuccessMsg(null), 5000);
      await loadStorageStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.data.cleanupFailed'));
    } finally {
      setCleaningUp(false);
    }
  };

  const handleExport = async (type: 'users' | 'instances' | 'events') => {
    try {
      const response = await fetch(`/api/admin/export/${type}?format=${exportFormat}`, { credentials: 'include' });
      if (!response.ok) throw new Error(t('systemConfig.data.exportFailed'));
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${type}.${exportFormat}`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.data.exportFailed'));
    }
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setRoleUpdating(userId);
    try {
      await api.put(`/admin/users/${userId}/role`, { role });
      setUsersWithRoles(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
      setSuccessMsg(t('systemConfig.permissions.roleUpdated'));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.permissions.roleUpdateFailed'));
    } finally {
      setRoleUpdating(null);
    }
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(savedConfig);

  if (loading) return (
    <div className="sys-config">
      <PageHeaderSkeleton />
      <CardSkeleton lines={6} />
      <CardSkeleton lines={6} />
    </div>
  );

  const sp = { config, onConfigChange: setConfig, saving, onSave: handleSave, onReset: handleReset, hasChanges };

  return (
    <main className="sys-config">
      <header className="sys-config__header">
        <div className="sys-config__header-left">
          <h1>{t('systemConfig.title')}</h1>
          <span className="sys-config__admin-badge">{t('systemConfig.adminBadge')}</span>
        </div>
        <p className="sys-config__subtitle">{t('systemConfig.subtitle')}</p>
        <div className="sys-config__header-actions">
          <Button variant="secondary" onClick={handleReset} disabled={saving || !hasChanges}>
            {t('systemConfig.resetDefaults')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? t('systemConfig.saving') : t('systemConfig.saveConfig')}
          </Button>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}
      {successMsg && <div className="success-message" role="status">{successMsg}</div>}

      <div className="sys-config__body">
        <nav className="sys-config__nav">
          {NAV_SECTIONS.map(section => (
            <Button
              key={section}
              variant="ghost"
              className={`sys-config__nav-item${activeSection === section ? ' sys-config__nav-item--active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {t(`systemConfig.nav.${section}`)}
            </Button>
          ))}
        </nav>

        <div className="sys-config__content">
          {activeSection === 'general' && <GeneralSection {...sp} />}
          {activeSection === 'api' && (
            <ApiSection
              {...sp}
              generatedKey={generatedKey}
              apiKeys={config.apiKeys ?? []}
              newKeyName={newKeyName}
              onNewKeyNameChange={setNewKeyName}
              onGenerateKey={handleGenerateApiKey}
              onRevokeKey={handleRevokeApiKey}
              newCorsOrigin={newCorsOrigin}
              onNewCorsOriginChange={v => { setNewCorsOrigin(v); setCorsError(null); }}
              corsError={corsError}
              onAddCorsOrigin={handleAddCorsOrigin}
              onRemoveCorsOrigin={handleRemoveCorsOrigin}
            />
          )}
          {activeSection === 'notifications' && <NotificationsSection {...sp} />}
          {activeSection === 'security' && <SecuritySection {...sp} />}
          {activeSection === 'data' && (
            <DataSection
              {...sp}
              storageStats={storageStats}
              loadingStats={loadingStats}
              cleaningUp={cleaningUp}
              exportFormat={exportFormat}
              onExportFormatChange={setExportFormat}
              onCleanup={handleCleanup}
              onExport={handleExport}
              onRefreshStats={loadStorageStats}
            />
          )}
          {activeSection === 'permissions' && (
            <PermissionsSection
              {...sp}
              users={usersWithRoles}
              adminEmails={adminEmails}
              loadingUsers={loadingUsers}
              roleUpdating={roleUpdating}
              onRoleChange={handleRoleChange}
              currentUserId=""
            />
          )}
        </div>
      </div>
    </main>
  );
}
