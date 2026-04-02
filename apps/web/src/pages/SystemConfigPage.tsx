import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { SystemConfig, RateLimitConfig, PlatformApiKey, StorageStats, AdminUserWithRole, UserRole } from '@aquarium/shared';
import './SystemConfigPage.css';

type NavSection = 'general' | 'api' | 'notifications' | 'security' | 'data' | 'permissions';

const NAV_SECTIONS: NavSection[] = ['general', 'api', 'notifications', 'security', 'data', 'permissions'];

const TIMEZONE_OPTIONS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
];

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
];

const DEFAULT_RATE_LIMIT_GENERAL: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 300 };
const DEFAULT_RATE_LIMIT_LOGIN: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 };
const DEFAULT_RATE_LIMIT_CREDENTIALS: RateLimitConfig = { windowMs: 60 * 1000, max: 30 };

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
  const [userSearch, setUserSearch] = useState('');
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

  useEffect(() => {
    loadConfig().finally(() => setLoading(false));
  }, []);

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
    if (activeSection === 'data' && !storageStats) {
      loadStorageStats();
    }
    if (activeSection === 'permissions' && usersWithRoles.length === 0) {
      loadUsersWithRoles();
    }
  }, [activeSection, storageStats, usersWithRoles.length, loadStorageStats, loadUsersWithRoles]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const data = await api.put<SystemConfig>('/admin/config', config);
      const merged = { ...DEFAULT_CONFIG, ...data };
      setConfig(merged);
      setSavedConfig(merged);
      setSuccessMsg(t('systemConfig.saved'));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemConfig.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({ ...savedConfig });
    setError(null);
    setSuccessMsg(null);
  };

  const handleAddCorsOrigin = () => {
    const origin = newCorsOrigin.trim();
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      setCorsError(t('systemConfig.api.invalidOrigin'));
      return;
    }
    setCorsError(null);
    const existing = config.corsOrigins ?? [];
    if (!existing.includes(origin)) {
      setConfig({ ...config, corsOrigins: [...existing, origin] });
    }
    setNewCorsOrigin('');
  };

  const handleRemoveCorsOrigin = (origin: string) => {
    const existing = config.corsOrigins ?? [];
    setConfig({ ...config, corsOrigins: existing.filter(o => o !== origin) });
  };

  const handleGenerateApiKey = async () => {
    const name = newKeyName.trim();
    if (!name) return;
    setError(null);
    try {
      const result = await api.post<PlatformApiKey & { fullKey: string }>('/admin/config/api-keys', { name });
      setGeneratedKey(result.fullKey);
      setNewKeyName('');
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
    setCleaningUp(true);
    setError(null);
    try {
      const result = await api.post<{ deletedEvents: number; deletedAuthEvents: number; deletedAuditLog: number }>('/admin/cleanup');
      setSuccessMsg(
        t('systemConfig.data.cleanupSuccess', {
          events: result.deletedEvents,
          authEvents: result.deletedAuthEvents,
          auditLog: result.deletedAuditLog,
        })
      );
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
      const url = `/admin/export/${type}?format=${exportFormat}`;
      const response = await fetch(`/api${url}`, { credentials: 'include' });
      if (!response.ok) throw new Error(t('systemConfig.data.exportFailed'));
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${type}.${exportFormat}`;
      a.click();
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

  const getRateLimit = (field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials'): RateLimitConfig => {
    const defaults: Record<string, RateLimitConfig> = {
      rateLimitGeneral: DEFAULT_RATE_LIMIT_GENERAL,
      rateLimitLogin: DEFAULT_RATE_LIMIT_LOGIN,
      rateLimitCredentials: DEFAULT_RATE_LIMIT_CREDENTIALS,
    };
    return config[field] ?? defaults[field];
  };

  const setRateLimit = (field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials', value: RateLimitConfig) => {
    setConfig({ ...config, [field]: value });
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(savedConfig);

  if (loading) {
    return <div className="sys-config">{t('admin.loading')}</div>;
  }

  const renderRateLimitGroup = (
    label: string,
    field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials',
  ) => {
    const rl = getRateLimit(field);
    return (
      <div className="sys-config__rate-group">
        <h3 className="sys-config__rate-group-title">{label}</h3>
        <div className="sys-config__rate-fields">
          <div className="sys-config__field">
            <label>{t('systemConfig.api.windowMinutes')}</label>
            <input
              type="number"
              min={1}
              value={Math.round(rl.windowMs / 60000)}
              onChange={e => setRateLimit(field, { ...rl, windowMs: (parseInt(e.target.value, 10) || 1) * 60000 })}
            />
          </div>
          <div className="sys-config__field">
            <label>{t('systemConfig.api.maxRequests')}</label>
            <input
              type="number"
              min={1}
              value={rl.max}
              onChange={e => setRateLimit(field, { ...rl, max: parseInt(e.target.value, 10) || 1 })}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderApiTab = () => {
    const corsOrigins = config.corsOrigins ?? [];
    const apiKeys = config.apiKeys ?? [];

    return (
      <>
        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.api.rateLimiting')}</h2>
          {renderRateLimitGroup(t('systemConfig.api.rateLimitGeneral'), 'rateLimitGeneral')}
          {renderRateLimitGroup(t('systemConfig.api.rateLimitLogin'), 'rateLimitLogin')}
          {renderRateLimitGroup(t('systemConfig.api.rateLimitCredentials'), 'rateLimitCredentials')}
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.api.corsOrigins')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.api.corsOriginsDesc')}</p>

          {corsOrigins.length > 0 && (
            <ul className="sys-config__list">
              {corsOrigins.map(origin => (
                <li key={origin} className="sys-config__list-item">
                  <span>{origin}</span>
                  <button
                    className="sys-config__btn sys-config__btn--danger sys-config__btn--sm"
                    onClick={() => handleRemoveCorsOrigin(origin)}
                  >
                    {t('systemConfig.api.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="sys-config__add-row">
            <input
              type="text"
              value={newCorsOrigin}
              onChange={e => { setNewCorsOrigin(e.target.value); setCorsError(null); }}
              placeholder={t('systemConfig.api.originPlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCorsOrigin(); }}
            />
            <button
              className="sys-config__btn sys-config__btn--primary sys-config__btn--sm"
              onClick={handleAddCorsOrigin}
              disabled={!newCorsOrigin.trim()}
            >
              {t('systemConfig.api.addOrigin')}
            </button>
          </div>
          {corsError && <div className="error-message" style={{ marginTop: '0.5rem' }}>{corsError}</div>}
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.api.webhookUrl')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.api.webhookUrlDesc')}</p>
          <div className="sys-config__field">
            <input
              type="text"
              value={config.webhookUrl ?? ''}
              onChange={e => setConfig({ ...config, webhookUrl: e.target.value })}
              placeholder={t('systemConfig.api.webhookPlaceholder')}
            />
          </div>
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.api.apiKeys')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.api.apiKeysDesc')}</p>

          <table className="sys-config__table">
            <thead>
              <tr>
                <th>{t('systemConfig.api.keyName')}</th>
                <th>{t('systemConfig.api.keyPrefix')}</th>
                <th>{t('systemConfig.api.createdAt')}</th>
                <th>{t('systemConfig.api.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="sys-config__table-empty">
                    {t('systemConfig.api.noKeys')}
                  </td>
                </tr>
              ) : (
                apiKeys.map((key: PlatformApiKey) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td><code>{key.prefix}...</code></td>
                    <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="sys-config__btn sys-config__btn--danger sys-config__btn--sm"
                        onClick={() => handleRevokeApiKey(key.id)}
                      >
                        {t('systemConfig.api.revoke')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="sys-config__add-row">
            <input
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder={t('systemConfig.api.keyNamePlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerateApiKey(); }}
            />
            <button
              className="sys-config__btn sys-config__btn--primary sys-config__btn--sm"
              onClick={handleGenerateApiKey}
              disabled={!newKeyName.trim()}
            >
              {t('systemConfig.api.generateKey')}
            </button>
          </div>

          {generatedKey && (
            <div className="sys-config__key-display">
              <p>{t('systemConfig.api.generatedKeyMsg')}</p>
              <code>{generatedKey}</code>
            </div>
          )}
        </section>
      </>
    );
  };

  const renderDataTab = () => (
    <>
      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.retentionPolicies')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.retentionPoliciesDesc')}</p>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.eventLogRetention')}</label>
          <input
            type="number"
            min={1}
            value={config.dataRetentionEventsDays ?? 90}
            onChange={e => setConfig({ ...config, dataRetentionEventsDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.authEventRetention')}</label>
          <input
            type="number"
            min={1}
            value={config.dataRetentionAuthEventsDays ?? 90}
            onChange={e => setConfig({ ...config, dataRetentionAuthEventsDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.auditLogRetention')}</label>
          <input
            type="number"
            min={1}
            value={config.dataRetentionAuditLogDays ?? 90}
            onChange={e => setConfig({ ...config, dataRetentionAuditLogDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__toggle-row">
          <div className="sys-config__toggle-info">
            <span className="sys-config__toggle-label">{t('systemConfig.data.autoCleanup')}</span>
            <span className="sys-config__toggle-desc">{t('systemConfig.data.autoCleanupDesc')}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.dataAutoCleanupEnabled ?? false}
            className={`sys-config__switch${config.dataAutoCleanupEnabled ? ' sys-config__switch--on' : ''}`}
            onClick={() => setConfig({ ...config, dataAutoCleanupEnabled: !config.dataAutoCleanupEnabled })}
          >
            <span className="sys-config__switch-thumb" />
          </button>
        </div>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.storageUsage')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.storageUsageDesc')}</p>

        {loadingStats ? (
          <p className="sys-config__loading-text">{t('systemConfig.data.loadingStats')}</p>
        ) : storageStats ? (
          <>
            <table className="sys-config__table">
              <thead>
                <tr>
                  <th>{t('systemConfig.data.tableName')}</th>
                  <th>{t('systemConfig.data.tableSize')}</th>
                  <th>{t('systemConfig.data.tableRows')}</th>
                </tr>
              </thead>
              <tbody>
                {storageStats.tables.map(tbl => (
                  <tr key={tbl.table}>
                    <td><code>{tbl.table}</code></td>
                    <td>{tbl.sizeFormatted}</td>
                    <td>{tbl.rowCount.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="sys-config__table-total">
                  <td><strong>{t('systemConfig.data.totalSize')}</strong></td>
                  <td><strong>{storageStats.totalSizeFormatted}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
            <button
              className="sys-config__btn sys-config__btn--secondary sys-config__btn--sm"
              onClick={loadStorageStats}
              disabled={loadingStats}
            >
              {t('systemConfig.data.refreshStats')}
            </button>
          </>
        ) : null}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.manualCleanup')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.manualCleanupDesc')}</p>
        <button
          className="sys-config__btn sys-config__btn--danger"
          onClick={handleCleanup}
          disabled={cleaningUp}
        >
          {cleaningUp ? '...' : t('systemConfig.data.runCleanup')}
        </button>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.dataExport')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.dataExportDesc')}</p>

        <div className="sys-config__export-controls">
          <div className="sys-config__field" style={{ marginBottom: 'var(--spacing-md)' }}>
            <label>{t('systemConfig.data.exportFormat')}</label>
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as 'json' | 'csv')}
              style={{ width: 'auto', minWidth: 120 }}
            >
              <option value="json">{t('systemConfig.data.formatJson')}</option>
              <option value="csv">{t('systemConfig.data.formatCsv')}</option>
            </select>
          </div>

          <div className="sys-config__export-buttons">
            <button
              className="sys-config__btn sys-config__btn--secondary"
              onClick={() => handleExport('users')}
            >
              {t('systemConfig.data.exportUsers')}
            </button>
            <button
              className="sys-config__btn sys-config__btn--secondary"
              onClick={() => handleExport('instances')}
            >
              {t('systemConfig.data.exportInstances')}
            </button>
            <button
              className="sys-config__btn sys-config__btn--secondary"
              onClick={() => handleExport('events')}
            >
              {t('systemConfig.data.exportEvents')}
            </button>
          </div>
        </div>
      </section>
    </>
  );

  const renderPermissionsTab = () => {
    const filteredUsers = usersWithRoles.filter(u =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.displayName.toLowerCase().includes(userSearch.toLowerCase())
    );

    return (
      <>
        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.permissions.adminEmails')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.permissions.adminEmailsDesc')}</p>
          {adminEmails.length > 0 ? (
            <ul className="sys-config__list">
              {adminEmails.map((email: string) => (
                <li key={email} className="sys-config__list-item">
                  <span>{email}</span>
                  <span className="sys-config__role-badge sys-config__role-badge--admin">
                    {t('systemConfig.permissions.roleAdmin')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sys-config__empty-text">{t('systemConfig.permissions.noAdminEmails')}</p>
          )}
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.permissions.roleManagement')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.permissions.roleManagementDesc')}</p>

          <div className="sys-config__field" style={{ marginBottom: 'var(--spacing-md)' }}>
            <input
              type="text"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder={t('systemConfig.permissions.searchUsers')}
            />
          </div>

          {loadingUsers ? (
            <p className="sys-config__loading-text">{t('systemConfig.permissions.loadingUsers')}</p>
          ) : (
            <table className="sys-config__table">
              <thead>
                <tr>
                  <th>{t('systemConfig.permissions.userName')}</th>
                  <th>{t('systemConfig.permissions.userEmail')}</th>
                  <th>{t('systemConfig.permissions.userRole')}</th>
                  <th>{t('systemConfig.permissions.userInstances')}</th>
                  <th>{t('systemConfig.permissions.userJoined')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="sys-config__table-empty">
                      {userSearch ? t('systemConfig.permissions.noMatchingUsers') : t('systemConfig.permissions.noUsersFound')}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => (
                    <tr key={user.id}>
                      <td>{user.displayName}</td>
                      <td><code>{user.email}</code></td>
                      <td>
                        <select
                          className="sys-config__role-select"
                          value={user.role}
                          onChange={e => handleRoleChange(user.id, e.target.value as UserRole)}
                          disabled={roleUpdating === user.id}
                        >
                          <option value="admin">{t('systemConfig.permissions.roleAdmin')}</option>
                          <option value="user">{t('systemConfig.permissions.roleUser')}</option>
                          <option value="viewer">{t('systemConfig.permissions.roleViewer')}</option>
                        </select>
                      </td>
                      <td>{user.instanceCount}</td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.permissions.instanceQuota')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.permissions.instanceQuotaDesc')}</p>
          <div className="sys-config__field">
            <label>{t('systemConfig.permissions.quotaPerUser')}</label>
            <input
              type="number"
              min={0}
              value={config.instanceQuotaPerUser ?? 0}
              onChange={e => setConfig({ ...config, instanceQuotaPerUser: parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        </section>

        <section className="sys-config__section">
          <h2 className="sys-config__section-title">{t('systemConfig.permissions.defaultRole')}</h2>
          <p className="sys-config__field-desc">{t('systemConfig.permissions.defaultRoleDesc')}</p>
          <div className="sys-config__field">
            <select
              value={config.defaultUserRole ?? 'user'}
              onChange={e => setConfig({ ...config, defaultUserRole: e.target.value as UserRole })}
            >
              <option value="admin">{t('systemConfig.permissions.roleAdmin')}</option>
              <option value="user">{t('systemConfig.permissions.roleUser')}</option>
              <option value="viewer">{t('systemConfig.permissions.roleViewer')}</option>
            </select>
          </div>
        </section>
      </>
    );
  };

  return (
    <main className="sys-config">
      <header className="sys-config__header">
        <div className="sys-config__header-left">
          <h1>{t('systemConfig.title')}</h1>
          <span className="sys-config__admin-badge">{t('systemConfig.adminBadge')}</span>
        </div>
        <p className="sys-config__subtitle">{t('systemConfig.subtitle')}</p>
        <div className="sys-config__header-actions">
          <button
            className="sys-config__btn sys-config__btn--secondary"
            onClick={handleReset}
            disabled={saving || !hasChanges}
          >
            {t('systemConfig.resetDefaults')}
          </button>
          <button
            className="sys-config__btn sys-config__btn--primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? t('systemConfig.saving') : t('systemConfig.saveConfig')}
          </button>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}
      {successMsg && <div className="success-message" role="status">{successMsg}</div>}

      <div className="sys-config__body">
        <nav className="sys-config__nav">
          {NAV_SECTIONS.map(section => (
            <button
              key={section}
              className={`sys-config__nav-item${activeSection === section ? ' sys-config__nav-item--active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {t(`systemConfig.nav.${section}`)}
            </button>
          ))}
        </nav>

        <div className="sys-config__content">
          {activeSection === 'general' ? (
            <>
              <section className="sys-config__section">
                <h2 className="sys-config__section-title">{t('systemConfig.general.basicSettings')}</h2>

                <div className="sys-config__field">
                  <label htmlFor="platform-name">{t('systemConfig.general.platformName')}</label>
                  <input
                    id="platform-name"
                    type="text"
                    value={config.platformName ?? ''}
                    onChange={e => setConfig({ ...config, platformName: e.target.value })}
                    placeholder={t('systemConfig.general.platformNamePlaceholder')}
                  />
                </div>

                <div className="sys-config__field">
                  <label htmlFor="platform-desc">{t('systemConfig.general.platformDescription')}</label>
                  <textarea
                    id="platform-desc"
                    value={config.platformDescription ?? ''}
                    onChange={e => setConfig({ ...config, platformDescription: e.target.value })}
                    placeholder={t('systemConfig.general.platformDescriptionPlaceholder')}
                    rows={3}
                  />
                </div>

                <div className="sys-config__field">
                  <label htmlFor="timezone">{t('systemConfig.general.timezone')}</label>
                  <select
                    id="timezone"
                    value={config.timezone ?? 'UTC'}
                    onChange={e => setConfig({ ...config, timezone: e.target.value })}
                  >
                    {TIMEZONE_OPTIONS.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>

                <div className="sys-config__field">
                  <label htmlFor="language">{t('systemConfig.general.language')}</label>
                  <select
                    id="language"
                    value={config.language ?? 'zh'}
                    onChange={e => setConfig({ ...config, language: e.target.value })}
                  >
                    {LANGUAGE_OPTIONS.map(lang => (
                      <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="sys-config__section">
                <h2 className="sys-config__section-title">{t('systemConfig.general.featureToggles')}</h2>

                <div className="sys-config__toggle-row">
                  <div className="sys-config__toggle-info">
                    <span className="sys-config__toggle-label">{t('systemConfig.general.enableUserRegistration')}</span>
                    <span className="sys-config__toggle-desc">{t('systemConfig.general.enableUserRegistrationDesc')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.enableUserRegistration ?? true}
                    className={`sys-config__switch${config.enableUserRegistration !== false ? ' sys-config__switch--on' : ''}`}
                    onClick={() => setConfig({ ...config, enableUserRegistration: !(config.enableUserRegistration ?? true) })}
                  >
                    <span className="sys-config__switch-thumb" />
                  </button>
                </div>
              </section>
            </>
          ) : activeSection === 'api' ? (
            renderApiTab()
          ) : activeSection === 'data' ? (
            renderDataTab()
          ) : activeSection === 'permissions' ? (
            renderPermissionsTab()
          ) : (
            <div className="sys-config__coming-soon">
              {t('common.comingSoon')}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
