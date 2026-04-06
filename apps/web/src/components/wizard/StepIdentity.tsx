import '../../pages/CreateWizardPage.css';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import type { StepIdentityProps } from './types';

export function StepIdentity({ state, setState, identityTemplates }: StepIdentityProps) {
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
              <Button
                key={tmpl}
                type="button"
                variant="outline"
                className="wiz-chip"
                onClick={() => setState(prev => ({ ...prev, identityDescription: tmpl }))}
              >
                {tmpl}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
