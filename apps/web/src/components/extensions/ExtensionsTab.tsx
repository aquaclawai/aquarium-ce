import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { InstanceSkill, SkillCatalogEntry, GatewayExtensionInfo } from '@aquarium/shared';
import { SkillRow } from './SkillRow';
import { CatalogSkillRow } from './CatalogSkillRow';
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
  const [managedSkills, setManagedSkills] = useState<InstanceSkill[]>([]);
  const [gatewayBuiltins, setGatewayBuiltins] = useState<GatewayExtensionInfo[]>([]);
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [configuringSkillId, setConfiguringSkillId] = useState<string | null>(null);

  const isRunning = instanceStatus === 'running';
  const mutationsDisabled = !isRunning;

  const fetchData = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [instanceId, isRunning, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleInstall = useCallback(async (skillId: string, source: string) => {
    setInstalling(skillId);
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/skills/install`, { skillId, source });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.installFailed'));
    } finally {
      setInstalling(null);
    }
  }, [instanceId, fetchData, t]);

  const handleToggle = useCallback(async (skillId: string, enabled: boolean) => {
    setError(null);
    try {
      await api.put(`/instances/${instanceId}/skills/${skillId}`, { enabled });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.toggleFailed'));
    }
  }, [instanceId, fetchData, t]);

  const handleUninstall = useCallback(async (skillId: string) => {
    setError(null);
    try {
      await api.delete(`/instances/${instanceId}/skills/${skillId}`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.uninstallFailed'));
    }
  }, [instanceId, fetchData, t]);

  const handleConfigure = useCallback((skillId: string) => {
    setConfiguringSkillId(skillId);
  }, []);

  // Filter catalog to exclude already-installed skills
  const installedSkillIds = new Set(managedSkills.map(s => s.skillId));
  const availableCatalog = catalog.filter(entry => !installedSkillIds.has(entry.slug));

  return (
    <div className="extensions-tab">
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
          onClick={() => void fetchData()}
          title={t('extensions.actions.refresh')}
          aria-label={t('extensions.actions.refresh')}
        >
          &#8635;
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">{error}</div>
      )}

      {/* Hidden configuringSkillId state — consumed by CredentialConfigPanel in Plan 01-06 */}
      {configuringSkillId && (
        <div data-configuring-skill-id={configuringSkillId} style={{ display: 'none' }} />
      )}

      {subTab === 'plugins' && (
        <div className="extensions-tab__coming-soon">
          <p>{t('extensions.plugins.comingSoon')}</p>
        </div>
      )}

      {subTab === 'skills' && (
        <>
          {/* Installed Skills */}
          <section className="extensions-section">
            <h3 className="section-header">{t('extensions.sections.installed')}</h3>
            {loading ? (
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
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    onToggle={handleToggle}
                    onUninstall={handleUninstall}
                    onConfigure={handleConfigure}
                    disabled={mutationsDisabled}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Gateway Built-ins */}
          <section className="extensions-section gateway-builtins">
            <h3 className="section-header">{t('extensions.sections.gatewayBuiltins')}</h3>
            {loading ? (
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
            ) : loading ? (
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
