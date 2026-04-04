import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type {
  InstanceSkill,
  SkillCatalogEntry,
  GatewayExtensionInfo,
  InstancePlugin,
  PluginCatalogEntry,
} from '@aquarium/shared';
import { SkillRow } from './SkillRow';
import { CatalogSkillRow } from './CatalogSkillRow';
import { ExtensionRow } from './ExtensionRow';
import { CatalogExtensionRow } from './CatalogExtensionRow';
import { CredentialConfigPanel } from './CredentialConfigPanel';
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

  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [configuringExtension, setConfiguringExtension] = useState<ConfiguringExtension | null>(null);

  const isRunning = instanceStatus === 'running';
  const mutationsDisabled = !isRunning;

  const fetchSkillData = useCallback(async () => {
    setSkillsLoading(true);
    setError(null);
    try {
      const skillsData = await api.get<SkillsResponse>(`/instances/${instanceId}/skills`);
      setManagedSkills(skillsData.managed);
      setGatewayBuiltins(skillsData.gatewayBuiltins);

      if (isRunning) {
        const catalogData = await api.get<SkillCatalogEntry[]>(`/instances/${instanceId}/skills/catalog`);
        setCatalog(catalogData);
      } else {
        setCatalog([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setSkillsLoading(false);
    }
  }, [instanceId, isRunning, t]);

  const fetchPluginData = useCallback(async () => {
    setPluginsLoading(true);
    setError(null);
    try {
      const pluginsData = await api.get<PluginsResponse>(`/instances/${instanceId}/plugins`);
      setManagedPlugins(pluginsData.managed);
      setPluginBuiltins(pluginsData.gatewayBuiltins);

      if (isRunning) {
        const catalogData = await api.get<PluginCatalogEntry[]>(`/instances/${instanceId}/plugins/catalog`);
        setPluginCatalog(catalogData);
      } else {
        setPluginCatalog([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setPluginsLoading(false);
    }
  }, [instanceId, isRunning, t]);

  useEffect(() => {
    void fetchSkillData();
  }, [fetchSkillData]);

  useEffect(() => {
    void fetchPluginData();
  }, [fetchPluginData]);

  // Skills handlers
  const handleInstall = useCallback(async (skillId: string, source: string) => {
    setInstalling(skillId);
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/skills/install`, { skillId, source });
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
      await api.post(`/instances/${instanceId}/plugins/install`, { pluginId, source });
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.pluginInstallFailed'));
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
    setConfirmActivatePluginId(null);
    setActivatingPlugin(pluginId);
    try {
      await api.post(`/instances/${instanceId}/plugins/${pluginId}/activate`);
      // Success handled by RestartBanner polling (02-04)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.pluginActivateFailed'));
    } finally {
      setActivatingPlugin(null);
    }
  }, [confirmActivatePluginId, instanceId, t]);

  const handlePluginToggle = useCallback(async (pluginId: string, enabled: boolean) => {
    setError(null);
    try {
      await api.put(`/instances/${instanceId}/plugins/${pluginId}`, { enabled });
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.pluginToggleFailed'));
    }
  }, [instanceId, fetchPluginData, t]);

  const handlePluginUninstall = useCallback(async (pluginId: string) => {
    setError(null);
    try {
      await api.delete(`/instances/${instanceId}/plugins/${pluginId}`);
      await fetchPluginData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.pluginUninstallFailed'));
    }
  }, [instanceId, fetchPluginData, t]);

  const handlePluginConfigure = useCallback((pluginId: string) => {
    setConfiguringExtension(prev =>
      prev?.id === pluginId && prev.kind === 'plugin' ? null : { id: pluginId, kind: 'plugin' }
    );
  }, []);

  const handleRefresh = useCallback(() => {
    if (subTab === 'skills') {
      void fetchSkillData();
    } else {
      void fetchPluginData();
    }
  }, [subTab, fetchSkillData, fetchPluginData]);

  // Filter catalog to exclude already-installed skills
  const installedSkillIds = new Set(managedSkills.map(s => s.skillId));
  const availableCatalog = catalog.filter(entry => !installedSkillIds.has(entry.slug));

  // Filter plugin catalog to exclude already-installed plugins
  const installedPluginIds = new Set(managedPlugins.map(p => p.pluginId));
  const availablePluginCatalog = pluginCatalog.filter(entry => !installedPluginIds.has(entry.id));

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
      {alertSkills.map(skill => (
        <div
          key={skill.skillId}
          className={`extension-alert extension-alert--${skill.status}`}
          role="alert"
        >
          <span className="extension-alert__icon" aria-hidden="true">
            {skill.status === 'failed' ? '✕' : '⚠'}
          </span>
          <span className="extension-alert__message">
            {skill.status === 'failed'
              ? t('extensions.alerts.failed', { name: skill.skillId, error: skill.errorMessage ?? '' })
              : t('extensions.alerts.degraded', { name: skill.skillId })}
          </span>
          {skill.status === 'failed' && (
            <button
              className="btn btn--sm extension-alert__retry"
              onClick={() => void api.post(`/instances/${instanceId}/skills/install`, { skillId: skill.skillId, source: 'bundled' }).then(() => void fetchSkillData())}
            >
              {t('extensions.alerts.retry')}
            </button>
          )}
        </div>
      ))}

      {alertPlugins.map(plugin => (
        <div
          key={plugin.pluginId}
          className={`extension-alert extension-alert--${plugin.status}`}
          role="alert"
        >
          <span className="extension-alert__icon" aria-hidden="true">
            {plugin.status === 'failed' ? '✕' : '⚠'}
          </span>
          <span className="extension-alert__message">
            {plugin.status === 'failed'
              ? t('extensions.alerts.failed', { name: plugin.pluginId, error: plugin.errorMessage ?? '' })
              : t('extensions.alerts.degraded', { name: plugin.pluginId })}
          </span>
        </div>
      ))}

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
        >
          &#8635;
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">{error}</div>
      )}

      {subTab === 'plugins' && (
        <>
          {/* Confirmation dialog rendered by 02-04 — wires confirmActivatePluginId and handlePluginActivateConfirm */}
          {confirmActivatePluginId !== null && (
            <div data-testid="confirm-activate-placeholder" style={{ display: 'none' }}>
              <button onClick={() => void handlePluginActivateConfirm()} />
            </div>
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
            ) : pluginsLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : availablePluginCatalog.length === 0 ? (
              <p className="empty-state">{t('extensions.catalog.noResults')}</p>
            ) : (
              <div className="skill-list">
                {availablePluginCatalog.map(entry => (
                  <CatalogExtensionRow
                    key={entry.id}
                    extensionKind="plugin"
                    id={entry.id}
                    name={entry.name}
                    description={entry.description}
                    source={entry.source}
                    requiredCredentials={entry.requiredCredentials}
                    capabilities={entry.capabilities}
                    onInstall={handlePluginInstall}
                    installing={installingPlugin === entry.id}
                    disabled={mutationsDisabled}
                  />
                ))}
              </div>
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
            ) : skillsLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : availableCatalog.length === 0 ? (
              <p className="empty-state">{t('extensions.catalog.noResults')}</p>
            ) : (
              <div className="skill-list">
                {availableCatalog.map(entry => (
                  <CatalogSkillRow
                    key={entry.id}
                    entry={entry}
                    onInstall={handleInstall}
                    installing={installing === entry.slug}
                    disabled={mutationsDisabled}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Export for use by plan 02-04 (ConfirmRestartDialog)
export type { ConfiguringExtension };
export { type PluginsResponse };
