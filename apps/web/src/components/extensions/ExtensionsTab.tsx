import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type {
  InstanceSkill,
  SkillCatalogEntry,
  GatewayExtensionInfo,
  InstancePlugin,
  PluginCatalogEntry,
  ExtensionKind,
} from '@aquarium/shared';
import { SkillRow } from './SkillRow';
import { CatalogSkillRow } from './CatalogSkillRow';
import { ExtensionRow } from './ExtensionRow';
import { CatalogExtensionRow } from './CatalogExtensionRow';
import { CredentialConfigPanel } from './CredentialConfigPanel';
import { ConfirmRestartDialog } from './ConfirmRestartDialog';
import { InstallDialog } from './InstallDialog';
import { RestartBanner } from './RestartBanner';
import { RollbackModal } from './RollbackModal';
import { TrustOverrideDialog } from './TrustOverrideDialog';
import './ExtensionsTab.css';

interface ExtensionsTabProps {
  instanceId: string;
  instanceStatus: string;
}

type SubTab = 'plugins' | 'skills';

interface SkillsResponse {
  managed: InstanceSkill[];
  gatewayBuiltins: GatewayExtensionInfo[];
}

interface PluginsResponse {
  managed: InstancePlugin[];
  gatewayBuiltins: GatewayExtensionInfo[];
}

interface ConfiguringExtension {
  id: string;
  kind: 'plugin' | 'skill';
}

interface RollbackError {
  pluginId: string;
  pluginName: string;
  errorMessage: string;
  technicalDetails?: string;
}

function SkeletonRow() {
  return (
    <div className="skill-row skeleton-row" aria-hidden="true">
      <div className="skeleton-row__icon skeleton-pulse" />
      <div className="skeleton-row__info">
        <div className="skeleton-pulse skeleton-row__name" />
        <div className="skeleton-pulse skeleton-row__description" />
      </div>
      <div className="skeleton-pulse skeleton-row__action" />
    </div>
  );
}

export function ExtensionsTab({ instanceId, instanceStatus }: ExtensionsTabProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<SubTab>('skills');

  // Skills state
  const [managedSkills, setManagedSkills] = useState<InstanceSkill[]>([]);
  const [gatewayBuiltins, setGatewayBuiltins] = useState<GatewayExtensionInfo[]>([]);
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);

  // Plugins state
  const [managedPlugins, setManagedPlugins] = useState<InstancePlugin[]>([]);
  const [pluginBuiltins, setPluginBuiltins] = useState<GatewayExtensionInfo[]>([]);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogEntry[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);
  const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
  const [activatingPlugin, setActivatingPlugin] = useState<string | null>(null);
  const [confirmActivatePluginId, setConfirmActivatePluginId] = useState<string | null>(null);

  // Restart/rollback state
  const [restartingPlugin, setRestartingPlugin] = useState<{ id: string; name: string } | null>(null);
  const [rollbackError, setRollbackError] = useState<RollbackError | null>(null);

  // Install dialog state
  const [installDialogEntry, setInstallDialogEntry] = useState<PluginCatalogEntry | SkillCatalogEntry | null>(null);
  const [installDialogKind, setInstallDialogKind] = useState<'plugin' | 'skill'>('skill');

  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // ClawHub pagination state
  const [clawHubPluginPage, setClawHubPluginPage] = useState(0);
  const [clawHubSkillPage, setClawHubSkillPage] = useState(0);
  const [clawHubPluginHasMore, setClawHubPluginHasMore] = useState(false);
  const [clawHubSkillHasMore, setClawHubSkillHasMore] = useState(false);
  const [loadingMorePlugins, setLoadingMorePlugins] = useState(false);
  const [loadingMoreSkills, setLoadingMoreSkills] = useState(false);

  // Trust override dialog state
  const [overrideTarget, setOverrideTarget] = useState<{ id: string; kind: ExtensionKind; name: string } | null>(null);

  // Vault config state
  const [vaultConfigured, setVaultConfigured] = useState(false);

  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [configuringExtension, setConfiguringExtension] = useState<ConfiguringExtension | null>(null);

  const isRunning = instanceStatus === 'running';
  const isRestarting = restartingPlugin !== null;
  const mutationsDisabled = !isRunning || isRestarting;

  const PAGE_LIMIT = 20;

  const fetchSkillData = useCallback(async () => {
    setSkillsLoading(true);
    setError(null);
    try {
      const skillsData = await api.get<SkillsResponse>(`/instances/${instanceId}/skills`);
      setManagedSkills(skillsData.managed);
      setGatewayBuiltins(skillsData.gatewayBuiltins);

      if (isRunning) {
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        params.set('page', '0');
        params.set('limit', String(PAGE_LIMIT));
        const query = params.toString();
        const catalogData = await api.get<{ catalog: SkillCatalogEntry[]; hasMore: boolean }>(`/instances/${instanceId}/skills/catalog${query ? `?${query}` : ''}`);
        setCatalog(catalogData.catalog);
        setClawHubSkillHasMore(catalogData.hasMore);
        setClawHubSkillPage(0);
      } else {
        setCatalog([]);
        setClawHubSkillHasMore(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setSkillsLoading(false);
    }
  }, [instanceId, isRunning, searchQuery, categoryFilter, t]);

  const fetchPluginData = useCallback(async () => {
    setPluginsLoading(true);
    setError(null);
    try {
      const pluginsData = await api.get<PluginsResponse>(`/instances/${instanceId}/plugins`);
      setManagedPlugins(pluginsData.managed);
      setPluginBuiltins(pluginsData.gatewayBuiltins);

      if (isRunning) {
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        params.set('page', '0');
        params.set('limit', String(PAGE_LIMIT));
        const query = params.toString();
        const catalogData = await api.get<{ catalog: PluginCatalogEntry[]; hasMore: boolean }>(`/instances/${instanceId}/plugins/catalog${query ? `?${query}` : ''}`);
        setPluginCatalog(catalogData.catalog);
        setClawHubPluginHasMore(catalogData.hasMore);
        setClawHubPluginPage(0);
      } else {
        setPluginCatalog([]);
        setClawHubPluginHasMore(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setPluginsLoading(false);
    }
  }, [instanceId, isRunning, searchQuery, categoryFilter, t]);

  useEffect(() => {
    void fetchSkillData();
  }, [fetchSkillData]);

  useEffect(() => {
    void fetchPluginData();
  }, [fetchPluginData]);

  useEffect(() => {
    api.get<{ vaultConfig: unknown }>(`/instances/${instanceId}/vault-config`)
      .then(data => setVaultConfigured(data.vaultConfig != null))
      .catch(() => setVaultConfigured(false));
  }, [instanceId]);

  // Load more handlers for ClawHub pagination
  const handleLoadMorePlugins = useCallback(async () => {
    setLoadingMorePlugins(true);
    try {
      const nextPage = clawHubPluginPage + 1;
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('page', String(nextPage));
      params.set('limit', String(PAGE_LIMIT));
      const query = params.toString();
      const moreData = await api.get<{ catalog: PluginCatalogEntry[]; hasMore: boolean }>(`/instances/${instanceId}/plugins/catalog?${query}`);
      setPluginCatalog(prev => [...prev, ...moreData.catalog]);
      setClawHubPluginHasMore(moreData.hasMore);
      setClawHubPluginPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setLoadingMorePlugins(false);
    }
  }, [instanceId, clawHubPluginPage, searchQuery, categoryFilter, t]);

  const handleLoadMoreSkills = useCallback(async () => {
    setLoadingMoreSkills(true);
    try {
      const nextPage = clawHubSkillPage + 1;
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('page', String(nextPage));
      params.set('limit', String(PAGE_LIMIT));
      const query = params.toString();
      const moreData = await api.get<{ catalog: SkillCatalogEntry[]; hasMore: boolean }>(`/instances/${instanceId}/skills/catalog?${query}`);
      setCatalog(prev => [...prev, ...moreData.catalog]);
      setClawHubSkillHasMore(moreData.hasMore);
      setClawHubSkillPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setLoadingMoreSkills(false);
    }
  }, [instanceId, clawHubSkillPage, searchQuery, categoryFilter, t]);

  // Skills handlers
  const handleInstall = useCallback(async (skillId: string, source: string) => {
    setInstalling(skillId);
    setError(null);
    try {
      const sourceObj = source === 'bundled' ? { type: 'bundled' } : { type: 'clawhub', spec: skillId };
      await api.post(`/instances/${instanceId}/skills/install`, { skillId, source: sourceObj });
      await fetchSkillData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.installFailed'));
    } finally {
      setInstalling(null);
    }
  }, [instanceId, fetchSkillData, t]);

  const handleToggle = useCallback(async (skillId: string, enabled: boolean) => {
    setError(null);
    try {
      await api.put(`/instances/${instanceId}/skills/${skillId}`, { enabled });
      await fetchSkillData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.toggleFailed'));
    }
  }, [instanceId, fetchSkillData, t]);

  const handleUninstall = useCallback(async (skillId: string) => {
    setError(null);
    try {
      await api.delete(`/instances/${instanceId}/skills/${skillId}`);
      await fetchSkillData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.uninstallFailed'));
    }
  }, [instanceId, fetchSkillData, t]);

  const handleConfigure = useCallback((skillId: string) => {
    setConfiguringExtension(prev =>
      prev?.id === skillId && prev.kind === 'skill' ? null : { id: skillId, kind: 'skill' }
    );
  }, []);

  // Plugin handlers
  const handlePluginInstall = useCallback(async (pluginId: string, source: string) => {
    setInstallingPlugin(pluginId);
    setError(null);
    try {
      const sourceObj = source === 'bundled' ? { type: 'bundled' } : { type: 'clawhub', spec: pluginId };
      await api.post(`/instances/${instanceId}/plugins/install`, { pluginId, source: sourceObj });
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.installPluginFailed'));
    } finally {
      setInstallingPlugin(null);
    }
  }, [instanceId, fetchPluginData, t]);

  const handlePluginActivateRequest = useCallback((pluginId: string) => {
    setConfirmActivatePluginId(pluginId);
  }, []);

  const handlePluginActivateConfirm = useCallback(async () => {
    if (!confirmActivatePluginId) return;
    const pluginId = confirmActivatePluginId;
    const pluginEntry = managedPlugins.find(p => p.pluginId === pluginId);
    const pluginName = pluginEntry?.pluginId ?? pluginId;
    setConfirmActivatePluginId(null);
    setActivatingPlugin(pluginId);
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/plugins/${pluginId}/activate`);
      // Show restart banner — polling happens in RestartBanner
      setRestartingPlugin({ id: pluginId, name: pluginName });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.activateFailed'));
    } finally {
      setActivatingPlugin(null);
    }
  }, [confirmActivatePluginId, instanceId, managedPlugins, t]);

  const handleRestartComplete = useCallback((success: boolean, errorMessage?: string) => {
    const completing = restartingPlugin;
    setRestartingPlugin(null);
    if (success) {
      void fetchPluginData();
    } else {
      setRollbackError({
        pluginId: completing?.id ?? '',
        pluginName: completing?.name ?? '',
        errorMessage: errorMessage ?? t('extensions.errors.activateFailed'),
      });
      void fetchPluginData();
    }
  }, [restartingPlugin, fetchPluginData, t]);

  const handlePluginToggle = useCallback(async (pluginId: string, enabled: boolean) => {
    setError(null);
    try {
      await api.put(`/instances/${instanceId}/plugins/${pluginId}`, { enabled });
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.togglePluginFailed'));
    }
  }, [instanceId, fetchPluginData, t]);

  const handlePluginUninstall = useCallback(async (pluginId: string) => {
    setError(null);
    try {
      await api.delete(`/instances/${instanceId}/plugins/${pluginId}`);
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.uninstallPluginFailed'));
    }
  }, [instanceId, fetchPluginData, t]);

  const handlePluginConfigure = useCallback((pluginId: string) => {
    setConfiguringExtension(prev =>
      prev?.id === pluginId && prev.kind === 'plugin' ? null : { id: pluginId, kind: 'plugin' }
    );
  }, []);

  // Filter catalog to exclude already-installed skills
  const installedSkillIds = new Set(managedSkills.map(s => s.skillId));
  const availableCatalog = catalog.filter(entry => !installedSkillIds.has(entry.slug));

  // Filter plugin catalog to exclude already-installed plugins
  const installedPluginIds = new Set(managedPlugins.map(p => p.pluginId));
  const availablePluginCatalog = pluginCatalog.filter(entry => !installedPluginIds.has(entry.id));

  // Compute unique categories for the current sub-tab
  const pluginCategories = [...new Set(availablePluginCatalog.map(e => e.category))].filter(Boolean);
  const skillCategories = [...new Set(availableCatalog.map(e => e.category))].filter(Boolean);

  // Apply client-side search + category filter (server-side for ClawHub; client-side for bundled fallback)
  const filteredPluginCatalog = availablePluginCatalog.filter(entry => {
    const matchesSearch = !searchQuery ||
      entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || entry.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const filteredSkillCatalog = availableCatalog.filter(entry => {
    const matchesSearch = !searchQuery ||
      entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || entry.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Install dialog handlers — open dialog instead of immediately installing
  const handleCatalogPluginInstallClick = useCallback((pluginId: string) => {
    const entry = availablePluginCatalog.find(e => e.id === pluginId);
    if (!entry) return;
    setInstallDialogEntry(entry);
    setInstallDialogKind('plugin');
  }, [availablePluginCatalog]);

  const handleCatalogSkillInstallClick = useCallback((skillId: string) => {
    const entry = availableCatalog.find(e => e.slug === skillId);
    if (!entry) return;
    setInstallDialogEntry(entry);
    setInstallDialogKind('skill');
  }, [availableCatalog]);

  const handleInstallDialogConfirm = useCallback(async () => {
    if (!installDialogEntry) return;
    const entry = installDialogEntry;
    setInstallDialogEntry(null);
    if (installDialogKind === 'plugin') {
      await handlePluginInstall(entry.id, entry.source);
    } else {
      // SkillCatalogEntry uses slug as the install id
      const skillEntry = entry as SkillCatalogEntry;
      await handleInstall(skillEntry.slug, skillEntry.source);
    }
  }, [installDialogEntry, installDialogKind, handlePluginInstall, handleInstall]);

  const handleRefresh = useCallback(() => {
    if (subTab === 'skills') {
      void fetchSkillData();
    } else {
      void fetchPluginData();
    }
  }, [subTab, fetchSkillData, fetchPluginData]);

  // Trust override handlers
  const handleRequestOverride = useCallback((id: string, kind: ExtensionKind) => {
    const name = kind === 'plugin'
      ? (availablePluginCatalog.find(e => e.id === id)?.name ?? id)
      : (availableCatalog.find(e => e.slug === id || e.id === id)?.name ?? id);
    setOverrideTarget({ id, kind, name });
  }, [availablePluginCatalog, availableCatalog]);

  const handleOverrideComplete = useCallback(() => {
    setOverrideTarget(null);
    if (overrideTarget?.kind === 'plugin') {
      void fetchPluginData();
    } else {
      void fetchSkillData();
    }
  }, [overrideTarget, fetchPluginData, fetchSkillData]);

  // Alert banners for failed/degraded skills
  const alertSkills = managedSkills.filter(
    s => s.status === 'failed' || s.status === 'degraded'
  );

  // Alert banners for failed/degraded plugins
  const alertPlugins = managedPlugins.filter(
    p => p.status === 'failed' || p.status === 'degraded'
  );

  return (
    <div className="extensions-tab">
      {/* Alert banners for failed/degraded extensions */}
      {alertSkills.map(skill => {
        const isIntegrityMismatch = skill.status === 'failed' && skill.errorMessage?.includes('Integrity mismatch');
        return (
          <div
            key={skill.skillId}
            className={`extension-alert extension-alert--${isIntegrityMismatch ? 'integrity' : skill.status}`}
            role="alert"
          >
            <span className="extension-alert__icon" aria-hidden="true">
              {isIntegrityMismatch ? '🛡' : skill.status === 'failed' ? '✕' : '⚠'}
            </span>
            <span className="extension-alert__message">
              {isIntegrityMismatch
                ? t('extensions.alerts.integrityMismatch') + `: ${skill.skillId}`
                : skill.status === 'failed'
                  ? t('extensions.alerts.failed', { name: skill.skillId, error: skill.errorMessage ?? '' })
                  : t('extensions.alerts.degraded', { name: skill.skillId })}
            </span>
            {skill.status === 'failed' && !isIntegrityMismatch && (
              <button
                className="btn btn--sm extension-alert__retry"
                onClick={() => void api.post(`/instances/${instanceId}/skills/install`, { skillId: skill.skillId, source: { type: 'bundled' } }).then(() => void fetchSkillData())}
              >
                {t('extensions.alerts.retry')}
              </button>
            )}
          </div>
        );
      })}

      {alertPlugins.map(plugin => {
        const isIntegrityMismatch = plugin.status === 'failed' && plugin.errorMessage?.includes('Integrity mismatch');
        return (
          <div
            key={plugin.pluginId}
            className={`extension-alert extension-alert--${isIntegrityMismatch ? 'integrity' : plugin.status}`}
            role="alert"
          >
            <span className="extension-alert__icon" aria-hidden="true">
              {isIntegrityMismatch ? '🛡' : plugin.status === 'failed' ? '✕' : '⚠'}
            </span>
            <span className="extension-alert__message">
              {isIntegrityMismatch
                ? t('extensions.alerts.integrityMismatch') + `: ${plugin.pluginId}`
                : plugin.status === 'failed'
                  ? t('extensions.alerts.failed', { name: plugin.pluginId, error: plugin.errorMessage ?? '' })
                  : t('extensions.alerts.degraded', { name: plugin.pluginId })}
            </span>
          </div>
        );
      })}

      {/* Restart banner — shown above header when gateway is restarting */}
      {restartingPlugin && (
        <RestartBanner
          pluginName={restartingPlugin.name}
          instanceId={instanceId}
          pluginId={restartingPlugin.id}
          onComplete={handleRestartComplete}
        />
      )}

      <div className="extensions-tab__header">
        <div className="sub-tab-toggle" role="tablist" aria-label={t('extensions.title')}>
          <button
            role="tab"
            aria-selected={subTab === 'skills'}
            className={subTab === 'skills' ? 'active' : ''}
            onClick={() => setSubTab('skills')}
          >
            {t('extensions.subTabs.skills')}
          </button>
          <button
            role="tab"
            aria-selected={subTab === 'plugins'}
            className={subTab === 'plugins' ? 'active' : ''}
            onClick={() => setSubTab('plugins')}
          >
            {t('extensions.subTabs.plugins')}
          </button>
        </div>
        <button
          className="icon-button refresh-button"
          onClick={handleRefresh}
          title={t('extensions.actions.refresh')}
          aria-label={t('extensions.actions.refresh')}
          disabled={isRestarting}
        >
          &#8635;
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">{error}</div>
      )}

      {subTab === 'plugins' && (
        <>
          {/* Activation confirmation dialog */}
          {confirmActivatePluginId !== null && (
            <ConfirmRestartDialog
              pluginName={managedPlugins.find(p => p.pluginId === confirmActivatePluginId)?.pluginId ?? confirmActivatePluginId}
              onConfirm={() => void handlePluginActivateConfirm()}
              onCancel={() => setConfirmActivatePluginId(null)}
            />
          )}

          {/* Rollback error modal */}
          {rollbackError !== null && (
            <RollbackModal
              pluginName={rollbackError.pluginName}
              errorMessage={rollbackError.errorMessage}
              technicalDetails={rollbackError.technicalDetails}
              onClose={() => setRollbackError(null)}
              onRetry={() => {
                setRollbackError(null);
                handlePluginActivateRequest(rollbackError.pluginId);
              }}
            />
          )}

          {/* Installed Plugins */}
          <section className="extensions-section">
            <h3 className="section-header">{t('extensions.sections.installed')}</h3>
            {pluginsLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : managedPlugins.length === 0 ? (
              <p className="empty-state">{t('extensions.empty.noPlugins')}</p>
            ) : (
              <div className="skill-list">
                {managedPlugins.map(plugin => (
                  <div key={plugin.id}>
                    <ExtensionRow
                      extensionKind="plugin"
                      extensionId={plugin.pluginId}
                      extensionName={plugin.pluginId}
                      status={plugin.status}
                      enabled={plugin.enabled}
                      errorMessage={plugin.errorMessage}
                      onToggle={handlePluginToggle}
                      onUninstall={handlePluginUninstall}
                      onConfigure={handlePluginConfigure}
                      onActivate={handlePluginActivateRequest}
                      disabled={mutationsDisabled}
                      activating={activatingPlugin === plugin.pluginId}
                    />
                    {configuringExtension?.id === plugin.pluginId && configuringExtension.kind === 'plugin' && (
                      <CredentialConfigPanel
                        instanceId={instanceId}
                        extensionId={plugin.pluginId}
                        extensionName={plugin.pluginId}
                        extensionKind="plugin"
                        status={plugin.status}
                        onClose={() => setConfiguringExtension(null)}
                        onSaved={() => { setConfiguringExtension(null); void fetchPluginData(); }}
                        disabled={mutationsDisabled}
                        lockedVersion={plugin.lockedVersion}
                        integrityHash={plugin.integrityHash}
                        trustOverride={plugin.trustOverride ?? null}
                        supportsOAuth={pluginCatalog.find(e => e.id === plugin.pluginId)?.requiredCredentials?.some(c => c.type === 'oauth_token') ?? false}
                        oauthProvider={pluginCatalog.find(e => e.id === plugin.pluginId)?.requiredCredentials?.find(c => c.type === 'oauth_token')?.field}
                        vaultConfigured={vaultConfigured}
                        isBundled={plugin.source?.type === 'bundled'}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gateway Built-in Plugins */}
          <section className="extensions-section gateway-builtins">
            <h3 className="section-header">{t('extensions.sections.gatewayBuiltins')}</h3>
            {pluginsLoading ? (
              <SkeletonRow />
            ) : pluginBuiltins.length === 0 ? (
              <p className="empty-state">{t('extensions.empty.noPluginBuiltins')}</p>
            ) : (
              <div className="skill-list">
                {pluginBuiltins.map(builtin => (
                  <div key={builtin.id} className="skill-row skill-row--readonly">
                    <div className="skill-row__icon">
                      <span className="skill-icon">{builtin.name[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div className="skill-row__info">
                      <span className="skill-row__name">{builtin.name}</span>
                      <span className="skill-row__description">{builtin.description}</span>
                    </div>
                    <div className="skill-row__status">
                      <span className={builtin.enabled ? 'status-dot status-dot--active' : 'status-dot status-dot--disabled'} aria-hidden="true" />
                      <span className="skill-row__status-text">
                        {builtin.enabled ? t('extensions.status.active') : t('extensions.status.disabled')}
                      </span>
                    </div>
                    <div className="skill-row__meta">
                      <span className="skill-row__version">v{builtin.version}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Available Plugin Catalog */}
          <section className="extensions-section">
            <h3 className="section-header">{t('extensions.sections.available')}</h3>
            {!isRunning ? (
              <p className="empty-state catalog-gated">{t('extensions.catalog.startInstance')}</p>
            ) : (
              <>
                <div className="catalog-filters">
                  <input
                    type="search"
                    className="catalog-search"
                    placeholder={t('extensions.catalog.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setClawHubPluginPage(0); }}
                    disabled={isRestarting}
                  />
                  <select
                    className="catalog-category-filter"
                    value={categoryFilter}
                    onChange={(e) => { setCategoryFilter(e.target.value); setClawHubPluginPage(0); }}
                    disabled={isRestarting}
                  >
                    <option value="all">{t('extensions.catalog.allCategories')}</option>
                    {pluginCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                {pluginsLoading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : filteredPluginCatalog.length === 0 ? (
                  <p className="empty-state">{t('extensions.catalog.noResults')}</p>
                ) : (
                  <>
                    <div className="skill-list">
                      {filteredPluginCatalog.map(entry => (
                        <CatalogExtensionRow
                          key={entry.id}
                          extensionKind="plugin"
                          id={entry.id}
                          name={entry.name}
                          description={entry.description}
                          source={entry.source}
                          requiredCredentials={entry.requiredCredentials}
                          capabilities={entry.capabilities}
                          trustTier={entry.trustTier}
                          trustSignals={entry.trustSignals}
                          blocked={entry.trustDecision === 'block'}
                          blockReason={entry.blockReason}
                          onInstall={(id) => handleCatalogPluginInstallClick(id)}
                          onRequestOverride={(id) => handleRequestOverride(id, 'plugin')}
                          installing={installingPlugin === entry.id}
                          disabled={mutationsDisabled}
                        />
                      ))}
                    </div>
                    {clawHubPluginHasMore && (
                      <button
                        className="load-more-btn"
                        onClick={() => void handleLoadMorePlugins()}
                        disabled={loadingMorePlugins || isRestarting}
                      >
                        {loadingMorePlugins ? t('extensions.actions.installing') : t('extensions.catalog.loadMore')}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {subTab === 'skills' && (
        <>
          {/* Installed Skills */}
          <section className="extensions-section">
            <h3 className="section-header">{t('extensions.sections.installed')}</h3>
            {skillsLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : managedSkills.length === 0 ? (
              <p className="empty-state">{t('extensions.empty.noInstalled')}</p>
            ) : (
              <div className="skill-list">
                {managedSkills.map(skill => (
                  <div key={skill.id}>
                    <SkillRow
                      skill={skill}
                      onToggle={handleToggle}
                      onUninstall={handleUninstall}
                      onConfigure={handleConfigure}
                      disabled={mutationsDisabled}
                    />
                    {configuringExtension?.id === skill.skillId && configuringExtension.kind === 'skill' && (
                      <CredentialConfigPanel
                        instanceId={instanceId}
                        extensionId={skill.skillId}
                        extensionName={skill.skillId}
                        extensionKind="skill"
                        status={skill.status}
                        onClose={() => setConfiguringExtension(null)}
                        onSaved={() => { setConfiguringExtension(null); void fetchSkillData(); }}
                        disabled={mutationsDisabled}
                        lockedVersion={skill.lockedVersion}
                        integrityHash={skill.integrityHash}
                        trustOverride={skill.trustOverride ?? null}
                        supportsOAuth={catalog.find(e => e.slug === skill.skillId || e.id === skill.skillId)?.requiredCredentials?.some(c => c.type === 'oauth_token') ?? false}
                        oauthProvider={catalog.find(e => e.slug === skill.skillId || e.id === skill.skillId)?.requiredCredentials?.find(c => c.type === 'oauth_token')?.field}
                        vaultConfigured={vaultConfigured}
                        isBundled={skill.source?.type === 'bundled'}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gateway Built-ins */}
          <section className="extensions-section gateway-builtins">
            <h3 className="section-header">{t('extensions.sections.gatewayBuiltins')}</h3>
            {skillsLoading ? (
              <SkeletonRow />
            ) : gatewayBuiltins.length === 0 ? (
              <p className="empty-state">{t('extensions.empty.noBuiltins')}</p>
            ) : (
              <div className="skill-list">
                {gatewayBuiltins.map(builtin => (
                  <div key={builtin.id} className="skill-row skill-row--readonly">
                    <div className="skill-row__icon">
                      <span className="skill-icon">{builtin.name[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div className="skill-row__info">
                      <span className="skill-row__name">{builtin.name}</span>
                      <span className="skill-row__description">{builtin.description}</span>
                    </div>
                    <div className="skill-row__status">
                      <span className={builtin.enabled ? 'status-dot status-dot--active' : 'status-dot status-dot--disabled'} aria-hidden="true" />
                      <span className="skill-row__status-text">
                        {builtin.enabled ? t('extensions.status.active') : t('extensions.status.disabled')}
                      </span>
                    </div>
                    <div className="skill-row__meta">
                      <span className="skill-row__version">v{builtin.version}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Available Catalog */}
          <section className="extensions-section">
            <h3 className="section-header">{t('extensions.sections.available')}</h3>
            {!isRunning ? (
              <p className="empty-state catalog-gated">{t('extensions.catalog.startInstance')}</p>
            ) : (
              <>
                <div className="catalog-filters">
                  <input
                    type="search"
                    className="catalog-search"
                    placeholder={t('extensions.catalog.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setClawHubSkillPage(0); }}
                  />
                  <select
                    className="catalog-category-filter"
                    value={categoryFilter}
                    onChange={(e) => { setCategoryFilter(e.target.value); setClawHubSkillPage(0); }}
                  >
                    <option value="all">{t('extensions.catalog.allCategories')}</option>
                    {skillCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                {skillsLoading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : filteredSkillCatalog.length === 0 ? (
                  <p className="empty-state">{t('extensions.catalog.noResults')}</p>
                ) : (
                  <>
                    <div className="skill-list">
                      {filteredSkillCatalog.map(entry => (
                        <CatalogSkillRow
                          key={entry.id}
                          entry={entry}
                          onInstall={(id) => handleCatalogSkillInstallClick(id)}
                          installing={installing === entry.slug}
                          disabled={mutationsDisabled}
                          trustTier={entry.trustTier}
                          trustSignals={entry.trustSignals}
                          blocked={entry.trustDecision === 'block'}
                          blockReason={entry.blockReason}
                          onRequestOverride={(id) => handleRequestOverride(id, 'skill')}
                        />
                      ))}
                    </div>
                    {clawHubSkillHasMore && (
                      <button
                        className="load-more-btn"
                        onClick={() => void handleLoadMoreSkills()}
                        disabled={loadingMoreSkills}
                      >
                        {loadingMoreSkills ? t('extensions.actions.installing') : t('extensions.catalog.loadMore')}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Install dialog — shown when a catalog entry's Install button is clicked */}
      {installDialogEntry !== null && (
        <InstallDialog
          extensionKind={installDialogKind}
          entry={installDialogEntry}
          trustTier={installDialogEntry.trustTier}
          trustSignals={installDialogEntry.trustSignals}
          onConfirm={() => void handleInstallDialogConfirm()}
          onCancel={() => setInstallDialogEntry(null)}
          installing={installDialogKind === 'plugin' ? installingPlugin === installDialogEntry.id : installing === (installDialogEntry as SkillCatalogEntry).slug}
        />
      )}

      {/* Trust override dialog */}
      {overrideTarget !== null && (
        <TrustOverrideDialog
          extensionId={overrideTarget.id}
          extensionKind={overrideTarget.kind}
          extensionName={overrideTarget.name}
          instanceId={instanceId}
          onOverrideComplete={handleOverrideComplete}
          onCancel={() => setOverrideTarget(null)}
        />
      )}
    </div>
  );
}

// Export for use by plan 02-04 (ConfirmRestartDialog)
export type { ConfiguringExtension };
export { type PluginsResponse };
