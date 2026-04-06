import '../../pages/CreateWizardPage.css';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import type { StepPrinciplesProps } from './types';

export function StepPrinciples({ state, setState, defaultPrinciples }: StepPrinciplesProps) {
  const { t } = useTranslation();
  return (
    <div className="wiz-step-body">
      <div className="wiz-step-header">
        <h2 className="wiz-step-heading">{t('wizard.principles.title')}</h2>
        <p className="wiz-step-desc">{t('wizard.principles.subtitle')}</p>
      </div>

      <div className="wiz-toggle-cards">
        <Button
          type="button"
          variant="outline"
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
        </Button>
        <Button
          type="button"
          variant="outline"
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
        </Button>
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
