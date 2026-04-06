import '../../pages/CreateWizardPage.css';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import type { StepConfirmProps, AvailableModel } from './types';
import { WizardMemorySection, PlatformModelSection, ByokSection } from './StepConfirmSections';

export function StepConfirm({
  state,
  setState,
  providers,
  temperaturePresets,
  contextOptions,
  userCredentials,
  credentialsLoading,
  platformModels,
  platformModelsLoading,
}: StepConfirmProps) {
  const { t } = useTranslation();

  const groupedModels = useMemo(() => {
    const groups = new Map<string, AvailableModel[]>();
    for (const m of platformModels) {
      const existing = groups.get(m.provider) ?? [];
      existing.push(m);
      groups.set(m.provider, existing);
    }
    return groups;
  }, [platformModels]);

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
          <div className="wiz-summary-row">
            <span className="wiz-summary-label">{t('wizard.confirm.summaryMemory')}</span>
            <span className="wiz-summary-value">
              {state.memoryModule === 'memos-cloud'
                ? t('wizard.confirm.memoryCloudTitle')
                : state.memoryModule === 'memos'
                  ? t('wizard.confirm.memoryMemosTitle')
                  : t('wizard.confirm.memoryNativeTitle')}
            </span>
          </div>
        </div>
      </div>

      <WizardMemorySection
        memoryModule={state.memoryModule}
        onChange={mod => setState(prev => ({ ...prev, memoryModule: mod }))}
      />

      <p className="wiz-section-title">{t('wizard.confirm.credentialSection')}</p>
      <div className="wiz-cred-cards">
        <Button type="button" variant="outline"
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
        </Button>
        <Button type="button" variant="outline"
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
        </Button>
      </div>

      {state.credentialMode === 'platform' && !credentialsLoading && (
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

      {state.credentialMode === 'platform' && (
        <PlatformModelSection
          state={state}
          setState={setState}
          platformModels={platformModels}
          platformModelsLoading={platformModelsLoading}
          groupedModels={groupedModels}
        />
      )}

      {state.credentialMode === 'byok' && (
        <ByokSection state={state} setState={setState} providers={providers} />
      )}

      <div className="wiz-field">
        <div className="wiz-param-row">
          <div className="wiz-param-row__left">
            <span className="wiz-param-label">{t('wizard.confirm.contextLabel')}</span>
            <span className="wiz-param-hint">{t('wizard.confirm.contextHint')}</span>
          </div>
          <Select value={state.contextLength} onValueChange={v => setState(prev => ({ ...prev, contextLength: v }))}>
            <SelectTrigger className="wiz-select wiz-select--compact">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contextOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.label}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <Button key={preset.key} type="button" variant="outline"
                className={`wiz-temp-btn${state.temperaturePreset === preset.key ? ' wiz-temp-btn--active' : ''}`}
                onClick={() => setState(prev => ({ ...prev, temperaturePreset: preset.key }))}
              >
                <span className="wiz-temp-btn__name">{t(`wizard.confirm.temp_${preset.key}`, { defaultValue: preset.label })}</span>
                <span className="wiz-temp-btn__sub">{t(`wizard.confirm.temp_${preset.key}_sub`, { defaultValue: '' })}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
