/**
 * Internal sub-sections for StepConfirm — memory module, platform model list, BYOK form.
 * Kept in a separate file to keep StepConfirm.tsx under 300 LOC.
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatModelDisplayName } from '../../utils/provider-display';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import type { StepConfirmProps, AvailableModel, ProviderModel } from './types';

export function WizardMemorySection({ memoryModule, onChange }: {
  memoryModule: 'native' | 'memos' | 'memos-cloud';
  onChange: (v: 'native' | 'memos' | 'memos-cloud') => void;
}) {
  const { t } = useTranslation();
  const checkMark = (
    <span className="wiz-toggle-check">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
  return (
    <>
      <p className="wiz-section-title">{t('wizard.confirm.memorySection')}</p>
      <div className="wiz-toggle-cards">
        {(['native', 'memos', 'memos-cloud'] as const).map(mod => (
          <Button key={mod} type="button" variant="outline"
            className={`wiz-toggle-card${memoryModule === mod ? ' wiz-toggle-card--active' : ''}`}
            onClick={() => onChange(mod)}
          >
            {memoryModule === mod && checkMark}
            <span className="wiz-toggle-card__title">{t(`wizard.confirm.memory${mod === 'native' ? 'Native' : mod === 'memos' ? 'Memos' : 'Cloud'}Title`)}</span>
            <span className="wiz-toggle-card__desc">{t(`wizard.confirm.memory${mod === 'native' ? 'Native' : mod === 'memos' ? 'Memos' : 'Cloud'}Desc`)}</span>
          </Button>
        ))}
      </div>
    </>
  );
}

export function PlatformModelSection({ state, setState, platformModels, platformModelsLoading, groupedModels }: {
  state: StepConfirmProps['state'];
  setState: StepConfirmProps['setState'];
  platformModels: AvailableModel[];
  platformModelsLoading: boolean;
  groupedModels: Map<string, AvailableModel[]>;
}) {
  const { t } = useTranslation();
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const filtered = useMemo(() => {
    if (!modelSearchQuery) return groupedModels;
    const q = modelSearchQuery.toLowerCase();
    const result = new Map<string, AvailableModel[]>();
    for (const [provider, models] of groupedModels) {
      const matches = models.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
      if (matches.length > 0) result.set(provider, matches);
    }
    return result;
  }, [groupedModels, modelSearchQuery]);

  return (
    <div className="wiz-field">
      <label className="wiz-field-label" htmlFor="wiz-platform-model">{t('wizard.confirm.modelLabel')}</label>
      {platformModelsLoading ? (
        <div className="wiz-model-loading">{t('wizard.confirm.modelsLoading')}</div>
      ) : platformModels.length > 0 ? (
        <>
          {platformModels.length > 10 && (
            <Input className="wiz-input wiz-model-search" type="text"
              placeholder={t('wizard.confirm.modelSearchPlaceholder')}
              value={modelSearchQuery} onChange={e => setModelSearchQuery(e.target.value)}
            />
          )}
          <div className="wiz-model-list">
            <Button type="button" variant="ghost"
              className={`wiz-model-item${state.model === 'auto' || !state.model ? ' wiz-model-item--active' : ''}`}
              onClick={() => setState(prev => ({ ...prev, model: 'auto' }))}
            >
              <span className="wiz-model-item__name">{t('wizard.confirm.modelAuto')}</span>
              <span className="wiz-model-item__id">{t('wizard.confirm.modelAutoDesc')}</span>
            </Button>
            {[...filtered.entries()].map(([provider, models]) => (
              <div key={provider} className="wiz-model-group">
                <div className="wiz-model-group__label">{provider}</div>
                {models.map(m => (
                  <Button key={m.id} type="button" variant="ghost"
                    className={`wiz-model-item${state.model === m.id ? ' wiz-model-item--active' : ''}`}
                    onClick={() => setState(prev => ({ ...prev, model: m.id }))}
                  >
                    <span className="wiz-model-item__name">{m.name}</span>
                    <span className="wiz-model-item__id">{formatModelDisplayName(m.id)}</span>
                    {m.recommended && <span className="wiz-model-item__badge">{t('wizard.confirm.modelRecommended')}</span>}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="wiz-model-loading">{t('wizard.confirm.modelAuto')}</div>
      )}
    </div>
  );
}

export function ByokSection({ state, setState, providers }: {
  state: StepConfirmProps['state'];
  setState: StepConfirmProps['setState'];
  providers: StepConfirmProps['providers'];
}) {
  const { t } = useTranslation();
  const selectedProvider = providers.find(p => p.name === state.byokProvider);
  const authMethod = selectedProvider?.authMethods?.[0];
  const isOAuth = authMethod?.type === 'oauth';
  const isEndpoint = authMethod?.type === 'custom-endpoint';
  const credLabel = authMethod?.label ?? t('wizard.confirm.byokApiKey');
  const credPlaceholder = authMethod?.hint ?? t('wizard.confirm.byokApiKeyPlaceholder');
  const byokModels: ProviderModel[] = selectedProvider?.models ?? [];

  return (
    <div className="wiz-byok-form">
      <div className="wiz-field">
        <label className="wiz-field-label" htmlFor="wiz-byok-provider">{t('wizard.confirm.byokProvider')}</label>
        <Select value={state.byokProvider} onValueChange={v => setState(prev => ({ ...prev, byokProvider: v, model: '', byokApiKey: '' }))}>
          <SelectTrigger id="wiz-byok-provider" className="wiz-select">
            <SelectValue placeholder={t('wizard.confirm.byokProviderPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {providers.map(p => (
              <SelectItem key={p.name} value={p.name}>
                {p.displayName} ({t('wizard.confirm.byokModelCount', { count: p.models.length })})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selectedProvider && (
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
              <Input id="wiz-byok-key" className="wiz-input"
                type={isEndpoint ? 'text' : 'password'}
                placeholder={credPlaceholder} value={state.byokApiKey}
                onChange={e => setState(prev => ({ ...prev, byokApiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
          )}
          {byokModels.length > 0 && (
            <div className="wiz-field">
              <label className="wiz-field-label">{t('wizard.confirm.byokModelLabel')}</label>
              <div className="wiz-model-list">
                <Button type="button" variant="ghost"
                  className={`wiz-model-item${!state.model ? ' wiz-model-item--active' : ''}`}
                  onClick={() => setState(prev => ({ ...prev, model: '' }))}
                >
                  <span className="wiz-model-item__name">{t('wizard.confirm.byokModelPlaceholder')}</span>
                </Button>
                {byokModels.map(m => (
                  <Button key={m.id} type="button" variant="ghost"
                    className={`wiz-model-item${state.model === m.id ? ' wiz-model-item--active' : ''}`}
                    onClick={() => setState(prev => ({ ...prev, model: m.id }))}
                  >
                    <span className="wiz-model-item__name">{m.displayName || formatModelDisplayName(m.id)}</span>
                    <span className="wiz-model-item__id">{m.id}</span>
                    {m.isDefault && <span className="wiz-model-item__badge">{t('wizard.confirm.modelRecommended')}</span>}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
