import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { TemplateManifest, TemplateCategory, PaginatedResponse, InstantiateTemplateResponse, BillingMode, SecurityProfile, TemplateContent, TemplateSecurityConfig } from '@aquarium/shared';
import './TemplatesPage.css';

const SECURITY_PROFILES: SecurityProfile[] = ['strict', 'standard', 'developer', 'unrestricted'];

const CATEGORY_FILTERS: { key: string; value: TemplateCategory | '' }[] = [
  { key: 'templates.categories.all', value: '' },
  { key: 'templates.categories.customerService', value: 'customer-service' },
  { key: 'templates.categories.general', value: 'general' },
  { key: 'templates.categories.coding', value: 'coding' },
  { key: 'templates.categories.dataAnalysis', value: 'data-analysis' },
  { key: 'templates.categories.contentCreation', value: 'content-creation' },
];

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  'customer-service': 'templates.categories.customerService',
  'sales': 'templates.categories.sales',
  'marketing': 'templates.categories.marketing',
  'devops': 'templates.categories.devops',
  'education': 'templates.categories.education',
  'personal': 'templates.categories.personal',
  'custom': 'templates.categories.custom',
  'general': 'templates.categories.general',
  'coding': 'templates.categories.coding',
  'data-analysis': 'templates.categories.dataAnalysis',
  'content-creation': 'templates.categories.contentCreation',
};

const TEMPLATE_EMOJIS: Record<string, string> = {
  'customer-service': '💬',
  'sales': '📈',
  'marketing': '📣',
  'devops': '⚙️',
  'education': '📚',
  'personal': '👤',
  'general': '🤖',
  'coding': '💻',
  'data-analysis': '📊',
  'content-creation': '✍️',
  'custom': '🔧',
};

function getTemplateEmoji(template: TemplateManifest): string {
  return TEMPLATE_EMOJIS[template.category] ?? '🤖';
}

function formatUsageCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function getSecurityScoreColor(score: number): string {
  if (score === 0) return 'var(--color-text-secondary)';
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatSecurityScore(score: number): string {
  return score === 0 ? '—' : String(score);
}

export function TemplatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TemplateCategory | ''>('');

  const [billingMode, setBillingMode] = useState<BillingMode>('byok');
  const [instantiating, setInstantiating] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [instantiateError, setInstantiateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [securityProfile, setSecurityProfile] = useState<SecurityProfile>('standard');
  const [templateSecurity, setTemplateSecurity] = useState<TemplateSecurityConfig | null>(null);
  const [geoCredentialMode, setGeoCredentialMode] = useState<'apikey' | 'oauth'>('oauth');
  const [geoApiKey, setGeoApiKey] = useState('');
  const [geoConnected, setGeoConnected] = useState(false);
  const [geoConnecting, setGeoConnecting] = useState(false);

  const fetchTemplates = async (searchQuery?: string, categoryFilter?: TemplateCategory | '') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('limit', '50');
      const qs = params.toString();
      const data = await api.get<PaginatedResponse<TemplateManifest>>(`/templates${qs ? `?${qs}` : ''}`);
      setTemplates(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templates.instantiate.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates(search, category);
  }, [category]);

  const handleSearch = () => {
    fetchTemplates(search, category);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const doCreateInstance = async () => {
    if (!instantiating || !instanceName.trim()) return;
    setCreating(true);
    setInstantiateError(null);
    try {
      const result = await api.post<InstantiateTemplateResponse>(
        `/templates/${instantiating}/instantiate`,
        { instanceName: instanceName.trim(), billingMode, ...(templateSecurity ? { securityProfile } : {}) },
      );
      setInstantiating(null);
      setInstanceName('');
      setTemplateSecurity(null);
      navigate(`/instances/${result.instance.id}`);
    } catch (err) {
      setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.failedToCreate'));
    } finally {
      setCreating(false);
    }
  };

  const listenForOAuthResult = (onResult: (data: { code: string; state: string }) => void) => {
    let settled = false;
    const settle = (data: { type?: string; success?: boolean; code?: string; state?: string }) => {
      if (settled) return;
      if (data?.type !== 'salevoice_oauth_complete' || !data.success || !data.code || !data.state) return;
      settled = true;
      cleanup();
      onResult({ code: data.code, state: data.state });
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('salevoice_oauth');
      bc.onmessage = (e: MessageEvent) => settle(e.data);
    } catch { /* unsupported */ }

    const onWindowMessage = (e: MessageEvent) => settle(e.data);
    window.addEventListener('message', onWindowMessage);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'salevoice_oauth_result' || !e.newValue) return;
      try { settle(JSON.parse(e.newValue)); } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);

    const cleanup = () => {
      bc?.close();
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorage);
      try { localStorage.removeItem('salevoice_oauth_result'); } catch { /* ignore */ }
    };

    return cleanup;
  };

  const handleInstantiate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instantiating || !instanceName.trim()) return;

    if (needsSalevoice && !geoConnected) {
      setGeoConnecting(true);
      setInstantiateError(null);
      try {
        const data = await api.post<{ authUrl: string; state: string }>('/oauth/salevoice/authorize', {});

        const cleanup = listenForOAuthResult(async ({ code, state }) => {
          try {
            const tokenData = await api.post<{ accessToken: string; tokenType: string }>(
              '/oauth/salevoice/token',
              { code, state },
            );

            await api.post('/credentials', {
              provider: 'salevoice',
              credentialType: 'api_key',
              value: tokenData.accessToken,
              displayName: 'SaleVoice (OAuth)',
            });

            setGeoConnected(true);
            setGeoConnecting(false);
            doCreateInstance();
          } catch (err) {
            setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed'));
            setGeoConnecting(false);
          }
        });

        const popup = window.open(data.authUrl, 'salevoice_oauth', 'width=600,height=700,popup=yes');
        if (!popup) {
          cleanup();
          setInstantiateError(t('templates.instantiate.geoAuthFailed'));
          setGeoConnecting(false);
        }
      } catch (err) {
        setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed'));
        setGeoConnecting(false);
      }
      return;
    }

    await doCreateInstance();
  };

  const openInstantiateModal = async (template: TemplateManifest) => {
    setInstantiating(template.id);
    setInstanceName(`${template.name} Instance`);
    setBillingMode(template.billingMode ?? 'byok');
    setInstantiateError(null);
    setTemplateSecurity(null);
    setSecurityProfile('standard');
    setGeoCredentialMode('oauth');
    setGeoApiKey('');
    setGeoConnected(false);
    setGeoConnecting(false);

    try {
      const content = await api.get<TemplateContent>(`/templates/${template.id}/content`);
      if (content.security) {
        setTemplateSecurity(content.security);
        setSecurityProfile(content.security.minSecurityProfile ?? 'standard');
      }
    } catch { /* */ }
  };

  const handleSalevoiceOAuth = async () => {
    setGeoConnecting(true);
    try {
      const data = await api.post<{ authUrl: string; state: string }>('/oauth/salevoice/authorize', {});

      const cleanup = listenForOAuthResult(async ({ code, state }) => {
        try {
          const tokenData = await api.post<{ accessToken: string; tokenType: string }>(
            '/oauth/salevoice/token',
            { code, state },
          );

          await api.post('/credentials', {
            provider: 'salevoice',
            credentialType: 'api_key',
            value: tokenData.accessToken,
            displayName: 'SaleVoice (OAuth)',
          });

          setGeoConnected(true);
          setGeoConnecting(false);
        } catch (err) {
          setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed'));
          setGeoConnecting(false);
        }
      });

      const popup = window.open(data.authUrl, 'salevoice_oauth', 'width=600,height=700,popup=yes');
      if (!popup) {
        cleanup();
        setInstantiateError(t('templates.instantiate.geoAuthFailed'));
        setGeoConnecting(false);
      }
    } catch (err) {
      setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed'));
      setGeoConnecting(false);
    }
  };

  const handleSaveGeoApiKey = async () => {
    if (!geoApiKey.trim()) return;
    setGeoConnecting(true);
    try {
      await api.post('/credentials', {
        provider: 'salevoice',
        credentialType: 'api_key',
        value: geoApiKey.trim(),
        displayName: 'SaleVoice (API Key)',
      });
      setGeoConnected(true);
      setGeoConnecting(false);
    } catch (err) {
      setInstantiateError(err instanceof Error ? err.message : t('templates.instantiate.geoSaveFailed'));
      setGeoConnecting(false);
    }
  };

  const featuredTemplates = templates.filter(tmpl => tmpl.featured);
  const allTemplates = templates;
  const selectedTemplate = templates.find(tmpl => tmpl.id === instantiating);
  const needsSalevoice = selectedTemplate?.requiredCredentials.some(c => c.provider === 'salevoice') ?? false;

  if (loading && templates.length === 0) {
    return <div className="agent-market">{t('templates.loading')}</div>;
  }

  return (
    <main className="agent-market">
      <header className="agent-market__header">
        <h1>{t('templates.title')}</h1>
        <p className="agent-market__subtitle">{t('skillMarket.subtitle')}</p>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="agent-market__search">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('templates.searchPlaceholder')}
          className="agent-market__search-input"
        />
        <button className="agent-market__search-btn" onClick={handleSearch}>🔍</button>
      </div>

      <div className="agent-market__categories">
        {CATEGORY_FILTERS.map(({ key, value }) => (
          <button
            key={value}
            className={`agent-market__category-pill${category === value ? ' agent-market__category-pill--active' : ''}`}
            onClick={() => setCategory(value)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {featuredTemplates.length > 0 && (
        <section className="agent-market__section">
          <h2 className="agent-market__section-title">{t('skillMarket.featured')}</h2>
          <div className="agent-market__featured-grid">
            {featuredTemplates.map(template => (
              <div key={template.id} className="featured-card">
                <div className="featured-card__emoji">{getTemplateEmoji(template)}</div>
                <span className="featured-card__badge">{t('skillMarket.featuredBadge')}</span>
                <h3 className="featured-card__name">{template.name}</h3>
                <p className="featured-card__desc">{template.description}</p>
                <div className="featured-card__meta">
                  <span className="featured-card__rating">★ {template.rating.toFixed(1)}</span>
                  <span className="featured-card__usage">{formatUsageCount(template.usageCount)} {t('skillMarket.usageCount', { count: template.usageCount })}</span>
                  <span className="security-score-badge" style={{ color: getSecurityScoreColor(template.securityScore) }}>
                    🛡 {formatSecurityScore(template.securityScore)}
                  </span>
                </div>
                <button className="featured-card__cta" onClick={() => openInstantiateModal(template)}>
                  {t('templates.useTemplate')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="agent-market__section">
        <h2 className="agent-market__section-title">{t('skillMarket.allAssistants')}</h2>
        {allTemplates.length === 0 && !loading && (
          <div className="info-message">{t('templates.noTemplates')}</div>
        )}
        <div className="agent-market__grid">
          {allTemplates.map(template => (
            <div key={template.id} className="assistant-card">
              <div className="assistant-card__header">
                <span className="assistant-card__emoji">{getTemplateEmoji(template)}</span>
                <div className="assistant-card__title-row">
                  <h3 className="assistant-card__name">{template.name}</h3>
                  <span className="assistant-card__category-badge">
                    {t(CATEGORY_LABEL_KEYS[template.category] ?? 'templates.categories.custom')}
                  </span>
                </div>
                <span className="security-score-badge" style={{ color: getSecurityScoreColor(template.securityScore) }}>
                  🛡 {formatSecurityScore(template.securityScore)}
                </span>
                <span className="assistant-card__rating">★ {template.rating.toFixed(1)}</span>
              </div>
              <p className="assistant-card__desc">{template.description}</p>
              {template.tags.length > 0 && (
                <div className="assistant-card__tags">
                  {template.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="assistant-card__tag">{tag}</span>
                  ))}
                </div>
              )}
              <button className="assistant-card__cta" onClick={() => openInstantiateModal(template)}>
                {t('templates.useTemplate')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {instantiating && selectedTemplate && (
        <div className="modal-overlay" onClick={() => { setInstantiating(null); setTemplateSecurity(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="template-modal-title" onClick={e => e.stopPropagation()}>
            <h2 id="template-modal-title">{t('templates.instantiate.title')}</h2>
            <p className="template-meta">{t('templates.instantiate.templateLabel', { name: selectedTemplate.name, version: selectedTemplate.version })}</p>

            {selectedTemplate.requiredCredentials.filter(c => c.provider !== 'salevoice').length > 0 && (
              <div className="info-message" style={{ marginBottom: 'var(--spacing-md)' }}>
                {t('templates.instantiate.credentialsRequired', { credentials: selectedTemplate.requiredCredentials.filter(c => c.provider !== 'salevoice').map(c =>
                  `${c.provider} (${c.credentialType})`
                ).join(', ') })}
              </div>
            )}

            {instantiateError && <div className="error-message" role="alert">{instantiateError}</div>}

            {selectedTemplate.securityScore > 0 && selectedTemplate.securityScore < 40 && (
              <div className="security-warning" role="alert">
                ⚠️ {t('templates.instantiate.lowSecurityWarning')}
              </div>
            )}

            <form onSubmit={handleInstantiate}>
              <div className="form-group">
                <label htmlFor="instance-name">{t('templates.instantiate.instanceNameLabel')}</label>
                <input
                  type="text"
                  id="instance-name"
                  value={instanceName}
                  onChange={e => setInstanceName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>{t('templates.instantiate.billingModeLabel')}</label>
                <div className="billing-mode-options">
                  <button
                    type="button"
                    className={`billing-mode-option${billingMode === 'platform' ? ' selected' : ''}`}
                    onClick={() => setBillingMode('platform')}
                  >
                    <strong>{t('templates.instantiate.platformProvided')}</strong>
                    <span>{t('templates.instantiate.platformDescription')}</span>
                  </button>
                  <button
                    type="button"
                    className={`billing-mode-option${billingMode === 'byok' ? ' selected' : ''}`}
                    onClick={() => setBillingMode('byok')}
                  >
                    <strong>{t('templates.instantiate.bringYourOwnKey')}</strong>
                    <span>{t('templates.instantiate.byokDescription')}</span>
                  </button>
                </div>
              </div>

              {templateSecurity && (
                <div className="form-group">
                  <label>
                    {t('templates.instantiate.securityProfileLabel')}
                    {templateSecurity.minSecurityProfile && (
                      <span className="template-official-badge" style={{ marginLeft: 'var(--spacing-xs)', fontSize: '0.75rem' }}>
                        {t('templates.instantiate.minSecurityBadge', { profile: templateSecurity.minSecurityProfile })}
                      </span>
                    )}
                  </label>
                  <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>
                    {t('templates.instantiate.securityProfileDescription')}
                  </p>
                  <div className="wizard-provider-grid">
                    {SECURITY_PROFILES.map(profile => {
                      const profileIndex = SECURITY_PROFILES.indexOf(profile);
                      const minIndex = templateSecurity.minSecurityProfile
                        ? SECURITY_PROFILES.indexOf(templateSecurity.minSecurityProfile)
                        : SECURITY_PROFILES.length - 1;
                      const disabled = profileIndex > minIndex;
                      return (
                        <button
                          key={profile}
                          type="button"
                          className={`wizard-provider-card${securityProfile === profile ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                          onClick={() => !disabled && setSecurityProfile(profile)}
                          disabled={disabled}
                          title={disabled ? t('templates.instantiate.securityProfileDisabled') : undefined}
                        >
                          <strong>{t(`wizard.security.profiles.${profile}.title`)}</strong>
                          <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                            {t(`wizard.security.profiles.${profile}.description`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {needsSalevoice && (
                <div className="form-group" style={{ marginTop: 'var(--spacing-md)' }}>
                  <label>{t('templates.instantiate.geoCredentialLabel')}</label>
                  <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>
                    {t('templates.instantiate.geoCredentialDescription')}
                  </p>

                  {geoConnected ? (
                    <div className="info-message" style={{ color: 'var(--color-success)' }}>
                      ✓ {t('templates.instantiate.geoConnected')}
                    </div>
                  ) : (
                    <>
                      <div className="billing-mode-options" style={{ marginBottom: 'var(--spacing-sm)' }}>
                        <button
                          type="button"
                          className={`billing-mode-option${geoCredentialMode === 'oauth' ? ' selected' : ''}`}
                          onClick={() => setGeoCredentialMode('oauth')}
                        >
                          <strong>{t('templates.instantiate.geoOAuthLabel')}</strong>
                          <span>{t('templates.instantiate.geoOAuthDescription')}</span>
                        </button>
                        <button
                          type="button"
                          className={`billing-mode-option${geoCredentialMode === 'apikey' ? ' selected' : ''}`}
                          onClick={() => setGeoCredentialMode('apikey')}
                        >
                          <strong>{t('templates.instantiate.geoApiKeyLabel')}</strong>
                          <span>{t('templates.instantiate.geoApiKeyDescription')}</span>
                        </button>
                      </div>

                      {geoCredentialMode === 'oauth' ? (
                        <button
                          type="button"
                          className="featured-card__cta"
                          style={{ width: '100%' }}
                          onClick={handleSalevoiceOAuth}
                          disabled={geoConnecting}
                        >
                          {geoConnecting ? t('templates.instantiate.geoConnecting') : t('templates.instantiate.geoConnectButton')}
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                          <input
                            type="password"
                            value={geoApiKey}
                            onChange={e => setGeoApiKey(e.target.value)}
                            placeholder={t('templates.instantiate.geoApiKeyPlaceholder')}
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={handleSaveGeoApiKey}
                            disabled={!geoApiKey.trim() || geoConnecting}
                          >
                            {geoConnecting ? t('templates.instantiate.geoConnecting') : t('templates.instantiate.geoSaveButton')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" onClick={() => { setInstantiating(null); setTemplateSecurity(null); }} disabled={creating}>{t('common.buttons.cancel')}</button>
                <button type="submit" disabled={creating || geoConnecting || !instanceName.trim()}>
                  {geoConnecting ? t('templates.instantiate.geoConnecting') : creating ? t('templates.instantiate.creating') : t('templates.instantiate.createButton')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
