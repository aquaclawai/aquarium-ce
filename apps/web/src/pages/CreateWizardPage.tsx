import './CreateWizardPage.css';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatModelDisplayName } from '../utils/provider-display';
import { api } from '../api';
import { AvatarPicker } from '../components/AvatarPicker';
import type { AgentTypeInfo, BillingMode, CreateInstanceRequest, UserCredential } from '@aquarium/shared';

const isEE = import.meta.env.VITE_EDITION !== 'ce';

type WizardStep = 'agentType' | 'naming' | 'principles' | 'identity' | 'confirm';

const STEP_IDS: WizardStep[] = ['agentType', 'naming', 'principles', 'identity', 'confirm'];

type PrinciplesMode = 'default' | 'custom';

interface TemperaturePreset {
  key: string;
  label: string;
  value: number;
}

interface ProviderModel {
  id: string;
  displayName: string;
  isDefault?: boolean;
}

interface ProviderAuthMethod {
  value: string;
  label: string;
  hint: string;
  type: string;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  recommended: boolean;
}

interface WizardState {
  name: string;
  avatar: string;
  principlesMode: PrinciplesMode;
  customPrinciples: string;
  identityDescription: string;
  credentialMode: 'platform' | 'byok';
  byokProvider: string;
  byokApiKey: string;
  model: string;
  contextLength: string;
  temperaturePreset: string;
}

const DEFAULT_STATE: WizardState = {
  name: '',
  avatar: 'preset:robot',
  principlesMode: 'default',
  customPrinciples: '',
  identityDescription: '',
  credentialMode: isEE ? 'platform' : 'byok',
  byokProvider: '',
  byokApiKey: '',
  model: '',
  contextLength: '128K Tokens',
  temperaturePreset: 'life',
};

const CONTEXT_OPTIONS_FALLBACK = [
  { value: 4096, label: '4K Tokens' },
  { value: 8192, label: '8K Tokens' },
  { value: 16384, label: '16K Tokens' },
  { value: 32768, label: '32K Tokens' },
  { value: 131072, label: '128K Tokens' },
];

interface StepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

interface StepPrinciplesProps extends StepProps {
  defaultPrinciples: string[];
}

interface StepIdentityProps extends StepProps {
  identityTemplates: string[];
}

interface ContextOption {
  value: number;
  label: string;
  description?: string;
}

interface StepConfirmProps extends StepProps {
  providers: Array<{ name: string; displayName: string; authMethods?: ProviderAuthMethod[]; models: ProviderModel[] }>;
  temperaturePresets: TemperaturePreset[];
  contextOptions: ContextOption[];
  userCredentials: UserCredential[];
  credentialsLoading: boolean;
  platformModels: AvailableModel[];
  platformModelsLoading: boolean;
}

interface StepAgentTypeProps {
  allTypes: AgentTypeInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function StepAgentType({ allTypes, selectedId, onSelect }: StepAgentTypeProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.agentType.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.agentType.subtitle')}</p>
      </div>
      <div className="wiz-agent-cards">
        {allTypes.map(at => {
          const disabled = at.implemented === false;
          const selected = at.id === selectedId && !disabled;
          return (
            <button
              key={at.id}
              type="button"
              className={`wiz-agent-card${selected ? ' wiz-agent-card--active' : ''}${disabled ? ' wiz-agent-card--disabled' : ''}`}
              onClick={() => { if (!disabled) onSelect(at.id); }}
              disabled={disabled}
            >
              {disabled && (
                <span className="wiz-agent-card__badge">{t('wizard.agentType.comingSoon')}</span>
              )}
              {selected && (
                <span className="wiz-toggle-check">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
              <span className="wiz-agent-card__name">{at.name}</span>
              <span className="wiz-agent-card__desc">{at.description}</span>
              <span className="wiz-agent-card__version">v{at.version}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepNaming({ state, setState }: StepProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.naming.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.naming.subtitle')}</p>
      </div>
      <div className="wiz-field">
        <label className="wiz-field-label" htmlFor="wiz-name">
          {t('wizard.naming.nameLabel')}<span className="wiz-required">*</span>
        </label>
        <input
          id="wiz-name"
          className="wiz-input"
          type="text"
          placeholder={t('wizard.naming.namePlaceholder')}
          value={state.name}
          onChange={e => setState(prev => ({ ...prev, name: e.target.value }))}
          autoFocus
          autoComplete="off"
        />
        <p className="wiz-field-hint">{t('wizard.naming.nameHint')}</p>
      </div>
      <div className="wiz-field">
        <label className="wiz-field-label">
          {t('wizard.naming.avatarLabel')}
        </label>
        <AvatarPicker
          value={state.avatar || null}
          onChange={(val) => setState(prev => ({ ...prev, avatar: val || '' }))}
        />
      </div>
    </div>
  );
}

function StepPrinciples({ state, setState, defaultPrinciples }: StepPrinciplesProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.principles.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.principles.subtitle')}</p>
      </div>

      <div className="wiz-toggle-cards">
        <button
          type="button"
          className={`wiz-toggle-card${state.principlesMode === 'default' ? ' wiz-toggle-card--active' : ''}`}
          onClick={() => setState(prev => ({ ...prev, principlesMode: 'default' }))}
        >
          {state.principlesMode === 'default' && (
            <span className="wiz-toggle-check">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          )}
          <span className="wiz-toggle-card__title">{t('wizard.principles.defaultTitle')}</span>
          <span className="wiz-toggle-card__desc">{t('wizard.principles.defaultDesc')}</span>
        </button>
        <button
          type="button"
          className={`wiz-toggle-card${state.principlesMode === 'custom' ? ' wiz-toggle-card--active' : ''}`}
          onClick={() => setState(prev => ({ ...prev, principlesMode: 'custom' }))}
        >
          {state.principlesMode === 'custom' && (
            <span className="wiz-toggle-check">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          )}
          <span className="wiz-toggle-card__title">{t('wizard.principles.customTitle')}</span>
          <span className="wiz-toggle-card__desc">{t('wizard.principles.customDesc')}</span>
        </button>
      </div>

      {state.principlesMode === 'default' && defaultPrinciples.length > 0 && (
        <div className="wiz-principles-preview">
          <p className="wiz-principles-preview__label">{t('wizard.principles.previewLabel')}</p>
          <div className="wiz-principles-preview__box">
            <ol className="wiz-principles-list">
              {defaultPrinciples.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {state.principlesMode === 'custom' && (
        <div className="wiz-field">
          <label className="wiz-field-label" htmlFor="wiz-principles">
            {t('wizard.principles.customLabel')}
          </label>
          <textarea
            id="wiz-principles"
            className="wiz-textarea wiz-textarea--tall"
            placeholder={t('wizard.principles.customPlaceholder')}
            value={state.customPrinciples}
            onChange={e => setState(prev => ({ ...prev, customPrinciples: e.target.value }))}
          />
          <p className="wiz-field-hint">{t('wizard.principles.customHint')}</p>
        </div>
      )}
    </div>
  );
}

function StepIdentity({ state, setState, identityTemplates }: StepIdentityProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.identity.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.identity.subtitle')}</p>
      </div>

      <div className="wiz-field">
        <label className="wiz-field-label" htmlFor="wiz-identity">
          {t('wizard.identity.descLabel')}<span className="wiz-required">*</span>
        </label>
        <textarea
          id="wiz-identity"
          className="wiz-textarea wiz-textarea--tall"
          placeholder={t('wizard.identity.descPlaceholder')}
          value={state.identityDescription}
          onChange={e => setState(prev => ({ ...prev, identityDescription: e.target.value }))}
        />
      </div>

      {identityTemplates.length > 0 && (
        <div className="wiz-quick-templates">
          <span className="wiz-quick-templates__label">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v2M6.5 10v2M1 6.5h2M10 6.5h2M2.93 2.93l1.41 1.41M8.66 8.66l1.41 1.41M2.93 10.07l1.41-1.41M8.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            {t('wizard.identity.quickTemplates')}
          </span>
          <div className="wiz-quick-templates__chips">
            {identityTemplates.map(tmpl => (
              <button
                key={tmpl}
                type="button"
                className="wiz-chip"
                onClick={() => setState(prev => ({ ...prev, identityDescription: tmpl }))}
              >
                {tmpl}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepConfirm({ state, setState, providers, temperaturePresets, contextOptions, userCredentials, credentialsLoading, platformModels, platformModelsLoading }: StepConfirmProps) {
  const { t } = useTranslation();
  const [modelSearchQuery, setModelSearchQuery] = useState('');

  const filteredPlatformModels = useMemo(() => {
    if (!modelSearchQuery) return platformModels;
    const q = modelSearchQuery.toLowerCase();
    return platformModels.filter(m =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [platformModels, modelSearchQuery]);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, AvailableModel[]>();
    for (const m of filteredPlatformModels) {
      const existing = groups.get(m.provider) ?? [];
      existing.push(m);
      groups.set(m.provider, existing);
    }
    return groups;
  }, [filteredPlatformModels]);
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.confirm.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.confirm.subtitle')}</p>
      </div>

      <div>
        <p className="wiz-section-title">{t('wizard.confirm.summaryTitle')}</p>
        <div className="wiz-summary-table">
          <div className="wiz-summary-row">
            <span className="wiz-summary-label">{t('wizard.confirm.summaryName')}</span>
            <span className="wiz-summary-value">{state.name || '—'}</span>
          </div>
          <div className="wiz-summary-row">
            <span className="wiz-summary-label">{t('wizard.confirm.summaryPrinciples')}</span>
            <span className="wiz-summary-value">{state.principlesMode === 'default' ? t('wizard.confirm.summaryDefault') : t('wizard.confirm.summaryCustom')}</span>
          </div>
          <div className="wiz-summary-row">
            <span className="wiz-summary-label">{t('wizard.confirm.summaryIdentity')}</span>
            <span className="wiz-summary-value wiz-summary-value--clamp">{state.identityDescription || '—'}</span>
          </div>
        </div>
      </div>

      <p className="wiz-section-title">{t('wizard.confirm.credentialSection')}</p>
      <div className="wiz-cred-cards">
          {isEE && (
          <button
            type="button"
            className={`wiz-cred-card${state.credentialMode === 'platform' ? ' wiz-cred-card--active' : ''}`}
            onClick={() => setState(prev => ({ ...prev, credentialMode: 'platform', byokProvider: '', byokApiKey: '', model: '' }))}
          >
            <span className="wiz-cred-card__icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2a5 5 0 0 1 5 5v1h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v1h6V7a3 3 0 0 0-3-3z" fill="currentColor"/></svg>
            </span>
            <span>
              <span className="wiz-cred-card__title">{t('wizard.confirm.platformTitle')}</span>
              <span className="wiz-cred-card__desc">{t('wizard.confirm.platformDesc')}</span>
            </span>
            {state.credentialMode === 'platform' && (
              <span className="wiz-cred-card__check">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            )}
          </button>
          )}
          <button
            type="button"
            className={`wiz-cred-card${state.credentialMode === 'byok' ? ' wiz-cred-card--active' : ''}`}
            onClick={() => setState(prev => ({ ...prev, credentialMode: 'byok', model: '' }))}
          >
            <span className="wiz-cred-card__icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 15l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 12l1.5 1.5L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <span>
              <span className="wiz-cred-card__title">{t('wizard.confirm.byokTitle')}</span>
              <span className="wiz-cred-card__desc">{t('wizard.confirm.byokDesc')}</span>
            </span>
            {state.credentialMode === 'byok' && (
              <span className="wiz-cred-card__check">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            )}
          </button>
        </div>

      {isEE && state.credentialMode === 'platform' && !credentialsLoading && (
        <div className="wiz-cred-info">
          <div className="wiz-cred-info__header">
            <span className="wiz-cred-info__key-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM1 12l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <span className="wiz-cred-info__title">{t('wizard.confirm.platformCredInfo')}</span>
            <span className="wiz-cred-info__badge">{t('wizard.confirm.platformCredBadge')}</span>
          </div>
          <div className="wiz-cred-info__rows">
            <div className="wiz-cred-info__row">
              <span>{t('wizard.confirm.credInfoName')}</span>
              <span>{userCredentials[0]?.displayName ?? '—'}</span>
            </div>
            <div className="wiz-cred-info__row">
              <span>{t('wizard.confirm.credInfoProvider')}</span>
              <span>{userCredentials[0]?.provider ?? '—'}</span>
            </div>
            <div className="wiz-cred-info__row">
              <span>{t('wizard.confirm.credInfoBalance')}</span>
              <span className="wiz-cred-info__balance">{t('wizard.confirm.platformCredReady')}</span>
            </div>
          </div>
        </div>
      )}

      {isEE && state.credentialMode === 'platform' && (
        <div className="wiz-field">
          <label className="wiz-field-label" htmlFor="wiz-platform-model">
            {t('wizard.confirm.modelLabel')}
          </label>
          {platformModelsLoading ? (
            <div className="wiz-model-loading">{t('wizard.confirm.modelsLoading')}</div>
          ) : platformModels.length > 0 ? (
            <>
              {platformModels.length > 10 && (
                <input
                  className="wiz-input wiz-model-search"
                  type="text"
                  placeholder={t('wizard.confirm.modelSearchPlaceholder')}
                  value={modelSearchQuery}
                  onChange={e => setModelSearchQuery(e.target.value)}
                />
              )}
              <div className="wiz-model-list">
                <button
                  type="button"
                  className={`wiz-model-item${state.model === 'auto' || !state.model ? ' wiz-model-item--active' : ''}`}
                  onClick={() => setState(prev => ({ ...prev, model: 'auto' }))}
                >
                  <span className="wiz-model-item__name">{t('wizard.confirm.modelAuto')}</span>
                  <span className="wiz-model-item__id">{t('wizard.confirm.modelAutoDesc')}</span>
                </button>
                {[...groupedModels.entries()].map(([provider, models]) => (
                  <div key={provider} className="wiz-model-group">
                    <div className="wiz-model-group__label">{provider}</div>
                    {models.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        className={`wiz-model-item${state.model === m.id ? ' wiz-model-item--active' : ''}`}
                        onClick={() => setState(prev => ({ ...prev, model: m.id }))}
                      >
                        <span className="wiz-model-item__name">{m.name}</span>
                        <span className="wiz-model-item__id">{formatModelDisplayName(m.id)}</span>
                        {m.recommended && <span className="wiz-model-item__badge">{t('wizard.confirm.modelRecommended')}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="wiz-model-loading">{t('wizard.confirm.modelAuto')}</div>
          )}
        </div>
      )}

      {state.credentialMode === 'byok' && (
        <div className="wiz-byok-form">
          <div className="wiz-field">
            <label className="wiz-field-label" htmlFor="wiz-byok-provider">
              {t('wizard.confirm.byokProvider')}
            </label>
            <select
              id="wiz-byok-provider"
              className="wiz-select"
              value={state.byokProvider}
              onChange={e => setState(prev => ({ ...prev, byokProvider: e.target.value, model: '', byokApiKey: '' }))}
            >
              <option value="">{t('wizard.confirm.byokProviderPlaceholder')}</option>
              {providers.map(p => (
                <option key={p.name} value={p.name}>
                  {p.displayName} ({t('wizard.confirm.byokModelCount', { count: p.models.length })})
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const selectedByokProviderInfo = providers.find(p => p.name === state.byokProvider);
            if (!selectedByokProviderInfo) return null;
            const authMethod = selectedByokProviderInfo.authMethods?.[0];
            const isOAuth = authMethod?.type === 'oauth';
            const isEndpoint = authMethod?.type === 'custom-endpoint';
            const credLabel = authMethod?.label ?? t('wizard.confirm.byokApiKey');
            const credPlaceholder = authMethod?.hint ?? t('wizard.confirm.byokApiKeyPlaceholder');
            const byokModels = selectedByokProviderInfo.models;
            return (
              <>
                {isOAuth ? (
                  <div className="wiz-field">
                    <label className="wiz-field-label">{credLabel}</label>
                    <div className="wiz-oauth-info">{credPlaceholder}</div>
                  </div>
                ) : (
                  <div className="wiz-field">
                    <label className="wiz-field-label" htmlFor="wiz-byok-key">
                      {credLabel}<span className="wiz-required">*</span>
                    </label>
                    <input
                      id="wiz-byok-key"
                      className="wiz-input"
                      type={isEndpoint ? 'text' : 'password'}
                      placeholder={credPlaceholder}
                      value={state.byokApiKey}
                      onChange={e => setState(prev => ({ ...prev, byokApiKey: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                )}
                {byokModels.length > 0 && (
                  <div className="wiz-field">
                    <label className="wiz-field-label">
                      {t('wizard.confirm.byokModelLabel')}
                    </label>
                    <div className="wiz-model-list">
                      <button
                        type="button"
                        className={`wiz-model-item${!state.model ? ' wiz-model-item--active' : ''}`}
                        onClick={() => setState(prev => ({ ...prev, model: '' }))}
                      >
                        <span className="wiz-model-item__name">{t('wizard.confirm.byokModelPlaceholder')}</span>
                      </button>
                      {byokModels.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className={`wiz-model-item${state.model === m.id ? ' wiz-model-item--active' : ''}`}
                          onClick={() => setState(prev => ({ ...prev, model: m.id }))}
                        >
                          <span className="wiz-model-item__name">{m.displayName || formatModelDisplayName(m.id)}</span>
                          <span className="wiz-model-item__id">{m.id}</span>
                          {m.isDefault && <span className="wiz-model-item__badge">{t('wizard.confirm.modelRecommended')}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div className="wiz-field">
        <div className="wiz-param-row">
          <div className="wiz-param-row__left">
            <span className="wiz-param-label">{t('wizard.confirm.contextLabel')}</span>
            <span className="wiz-param-hint">{t('wizard.confirm.contextHint')}</span>
          </div>
          <select
            className="wiz-select wiz-select--compact"
            value={state.contextLength}
            onChange={e => setState(prev => ({ ...prev, contextLength: e.target.value }))}
          >
            {contextOptions.map(opt => (
              <option key={opt.value} value={opt.label}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {temperaturePresets.length > 0 && (
        <div className="wiz-temp-section">
          <div className="wiz-temp-label-row">
            <div className="wiz-param-row__left">
              <span className="wiz-param-label">{t('wizard.confirm.tempLabel')}</span>
              <span className="wiz-param-hint">{t('wizard.confirm.tempHint')}</span>
            </div>
            <span className="wiz-temp-current">
              {(() => { const p = temperaturePresets.find(pr => pr.key === state.temperaturePreset); return p ? `${t('wizard.confirm.temperatureCurrent')} ${p.value}` : ''; })()}
            </span>
          </div>
          <div className="wiz-temp-presets">
            {temperaturePresets.map(preset => (
              <button
                key={preset.key}
                type="button"
                className={`wiz-temp-btn${state.temperaturePreset === preset.key ? ' wiz-temp-btn--active' : ''}`}
                onClick={() => setState(prev => ({ ...prev, temperaturePreset: preset.key }))}
              >
                <span className="wiz-temp-btn__name">{t(`wizard.confirm.temp_${preset.key}`, { defaultValue: preset.label })}</span>
                <span className="wiz-temp-btn__sub">{t(`wizard.confirm.temp_${preset.key}_sub`, { defaultValue: '' })}</span>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export function CreateWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [agentType, setAgentType] = useState<AgentTypeInfo | null>(null);
  const [allAgentTypes, setAllAgentTypes] = useState<AgentTypeInfo[]>([]);
  const [agentTypeLoading, setAgentTypeLoading] = useState(true);
  const [agentTypeError, setAgentTypeError] = useState<string | null>(null);
  const [userCredentials, setUserCredentials] = useState<UserCredential[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(true);

  const [currentStep, setCurrentStep] = useState<WizardStep>('agentType');
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [platformModels, setPlatformModels] = useState<AvailableModel[]>([]);
  const [platformModelsLoading, setPlatformModelsLoading] = useState(isEE);

  const currentIndex = STEP_IDS.indexOf(currentStep);

  useEffect(() => {
    api.get<AgentTypeInfo[]>('/agent-types')
      .then(types => {
        setAllAgentTypes(types);
        setAgentType(types.find(t => t.id === 'openclaw') ?? types[0] ?? null);
      })
      .catch((err) => setAgentTypeError(err instanceof Error ? err.message : t('wizard.errors.failedToLoadAgentTypes')))
      .finally(() => setAgentTypeLoading(false));

    api.get<UserCredential[]>('/credentials')
      .then(creds => setUserCredentials(creds))
      .catch(() => {})
      .finally(() => setCredentialsLoading(false));
  }, []);

  useEffect(() => {
    if (!isEE) return;
    if (state.credentialMode !== 'platform') return;
    let cancelled = false;
    api.get<{ models: AvailableModel[]; source: string }>('/litellm/models/available')
      .then(data => {
        if (!cancelled && data.models.length > 0) setPlatformModels(data.models);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPlatformModelsLoading(false); });
    return () => { cancelled = true; };
  }, [state.credentialMode]);

  const defaultPrinciples = agentType?.wizard?.defaultPrinciples ?? [];
  const identityTemplates = agentType?.wizard?.identityTemplates ?? [];
  const temperaturePresets = agentType?.wizard?.temperaturePresets ?? [];
  const providers = agentType?.wizard?.providers ?? [];
  const contextOptions = agentType?.wizard?.contextOptions ?? CONTEXT_OPTIONS_FALLBACK;

  function canProceed(): boolean {
    switch (currentStep) {
      case 'agentType': return agentType !== null;
      case 'naming': return state.name.trim().length >= 1;
      case 'principles': return state.principlesMode === 'default' || state.customPrinciples.trim().length >= 1;
      case 'identity': return true;
      case 'confirm': {
        if (state.credentialMode === 'platform') return true;
        if (!state.byokProvider) return false;
        const selectedProvider = providers.find(p => p.name === state.byokProvider);
        const isOAuth = selectedProvider?.authMethods?.[0]?.type === 'oauth';
        return isOAuth || state.byokApiKey.trim().length >= 1;
      }
      default: return true;
    }
  }

  function goNext() {
    if (currentIndex < STEP_IDS.length - 1) setCurrentStep(STEP_IDS[currentIndex + 1]);
  }

  function goBack() {
    if (currentIndex > 0) setCurrentStep(STEP_IDS[currentIndex - 1]);
  }

  async function handleCreate() {
    if (!agentType) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const billingMode: BillingMode = state.credentialMode === 'platform' ? 'platform' : 'byok';
      const config: Record<string, unknown> = {};
      if (state.model && state.model !== 'auto') config.defaultModel = state.model;
      if (state.identityDescription) {
        config.agentName = state.identityDescription;
        // Inject identity into IDENTITY.md template so adapter writes it to workspace
        config.identitymd = `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:**
  ${state.identityDescription}
- **Creature:**
  _(AI? robot? familiar? ghost in the machine? something weirder?)_
- **Vibe:**
  _(how do you come across? sharp? warm? chaotic? calm?)_
- **Emoji:**
  _(your signature — pick one that feels right)_
- **Avatar:**
  _(workspace-relative path, http(s) URL, or data URI)_

---

This isn't just metadata. It's the start of figuring out who you are.
`;
      }
      if (state.principlesMode === 'custom' && state.customPrinciples) {
        config.customPrinciples = state.customPrinciples;
        // Inject custom principles into SOUL.md template so adapter writes it to workspace
        config.soulmd = `# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

${state.customPrinciples}

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.

## Continuity

Each session, you wake up fresh. These files _are_ your memory. Read them. Update them. They're how you persist.

If you change this file, tell the user — it's your soul, and they should know.

---

_This file is yours to evolve. As you learn who you are, update it._
`;
      }
      if (state.credentialMode === 'byok' && state.byokProvider) {
        config.defaultProvider = state.byokProvider;
      }

      const temperaturePreset = temperaturePresets.find(p => p.key === state.temperaturePreset);
      if (temperaturePreset) config.temperature = temperaturePreset.value;

      const contextOption = contextOptions.find(o => o.label === state.contextLength);
      if (contextOption) config.contextLength = contextOption.value;

      const body: CreateInstanceRequest = {
        name: state.name.trim(),
        agentType: agentType.id,
        imageTag: agentType.defaultImageTag,
        billingMode,
        config,
        avatar: state.avatar || undefined,
      };

      const instance = await api.post<{ id: string }>('/instances', body);

      if (state.credentialMode === 'byok' && state.byokApiKey && state.byokProvider) {
        try {
          await api.post(`/instances/${instance.id}/credentials`, {
            provider: state.byokProvider,
            credentialType: 'api_key',
            value: state.byokApiKey,
          });
        } catch {
          // Best-effort credential save — instance already created
        }
      }

      navigate(`/instances/${instance.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('wizard.errors.failedToCreate'));
      setSubmitting(false);
    }
  }

  const STEP_LABEL_KEYS: Record<WizardStep, string> = {
    agentType: 'wizard.steps.agentType',
    naming: 'wizard.steps.naming',
    principles: 'wizard.steps.principles',
    identity: 'wizard.steps.identity',
    confirm: 'wizard.steps.confirm',
  };

  const STEP_ICONS: Record<WizardStep, React.ReactNode> = {
    agentType: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="6" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    naming: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M13 2.5a1.414 1.414 0 0 1 2 2L6 13.5l-3 1 1-3L13 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    principles: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2l1.8 3.6L15 6.3l-3 2.9.7 4.1L9 11.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    identity: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 16c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    confirm: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 6h12M3 9h8M3 12h5M15 10v6M12 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  };

  if (agentTypeLoading) {
    return (
      <main className="wiz-page">
        <div style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--space-10)' }}>{t('common.loading')}</div>
      </main>
    );
  }

  if (agentTypeError || !agentType) {
    return (
      <main className="wiz-page">
        <div className="error-message" role="alert" style={{ marginTop: 'var(--space-10)' }}>
          {agentTypeError ?? t('wizard.errors.failedToLoadAgentTypes')}
        </div>
        <button type="button" className="wiz-back-link" onClick={() => navigate('/assistants')} style={{ marginTop: 'var(--space-4)' }}>
          {t('wizard.navigation.backToAssistants')}
        </button>
      </main>
    );
  }

  return (
    <main className="wiz-page">
      <div className="wiz-topbar">
        <button type="button" className="wiz-back-link" onClick={() => navigate('/assistants')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 13L5 8l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {t('wizard.navigation.backToAssistants')}
        </button>
      </div>

      <div className="wiz-header">
        <h1 className="wiz-title">{t('wizard.pageTitle')}</h1>
        <p className="wiz-subtitle">{t('wizard.pageSubtitle')}</p>
      </div>

      <div className="wiz-stepper">
        <div className="wiz-stepper__track">
          {STEP_IDS.map((stepId, i) => (
            <div key={stepId} className="wiz-stepper__track-item">
              <div className="wiz-stepper__node">
                <div className={`wiz-stepper__circle${
                  i < currentIndex ? ' wiz-stepper__circle--done'
                  : stepId === currentStep ? ' wiz-stepper__circle--active'
                  : ' wiz-stepper__circle--pending'
                }`}>
                  {i < currentIndex
                    ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9l3.5 3.5L14 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : STEP_ICONS[stepId]
                  }
                </div>
                <span className={`wiz-stepper__label${
                  stepId === currentStep ? ' wiz-stepper__label--active'
                  : i < currentIndex ? ' wiz-stepper__label--done'
                  : ''
                }`}>
                  {t(STEP_LABEL_KEYS[stepId])}
                </span>
              </div>
              {i < STEP_IDS.length - 1 && (
                <div className={`wiz-stepper__line${i < currentIndex ? ' wiz-stepper__line--done' : ''}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="wiz-card">
        {currentStep === 'agentType' && (
          <StepAgentType
            allTypes={allAgentTypes}
            selectedId={agentType?.id ?? ''}
            onSelect={(id) => {
              const selected = allAgentTypes.find(t => t.id === id);
              if (selected) setAgentType(selected);
            }}
          />
        )}
        {currentStep === 'naming' && <StepNaming state={state} setState={setState} />}
        {currentStep === 'principles' && (
          <StepPrinciples state={state} setState={setState} defaultPrinciples={defaultPrinciples} />
        )}
        {currentStep === 'identity' && (
          <StepIdentity state={state} setState={setState} identityTemplates={identityTemplates} />
        )}
        {currentStep === 'confirm' && (
          <StepConfirm
            state={state}
            setState={setState}
            providers={providers}
            temperaturePresets={temperaturePresets}
            contextOptions={contextOptions}
            userCredentials={userCredentials}
            credentialsLoading={credentialsLoading}
            platformModels={platformModels}
            platformModelsLoading={platformModelsLoading}
          />
        )}

        {submitError && (
          <div className="error-message" role="alert" style={{ margin: '0 var(--space-8) var(--space-4)' }}>
            {submitError}
          </div>
        )}

        <div className="wiz-footer">
          <button
            type="button"
            className="wiz-btn-cancel"
            onClick={currentIndex === 0 ? () => navigate('/assistants') : goBack}
          >
            {currentIndex === 0 ? t('common.buttons.cancel') : t('wizard.navigation.back')}
          </button>

          {currentStep === 'confirm' ? (
            <button
              type="button"
              className="btn-finish"
              onClick={handleCreate}
              disabled={submitting || !canProceed()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 10.667A1.333 1.333 0 0 1 12.667 12H4.667L2 14.667V3.333A1.333 1.333 0 0 1 3.333 2h9.334A1.333 1.333 0 0 1 14 3.333v7.334z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {submitting ? t('wizard.navigation.creating') : t('wizard.navigation.finish')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary-wiz"
              onClick={goNext}
              disabled={!canProceed()}
            >
              {t('wizard.navigation.next')}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
