import '../../pages/CreateWizardPage.css';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import { AvatarPicker } from '../AvatarPicker';
import type { StepProps } from './types';

export function StepNaming({ state, setState }: StepProps) {
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
        <Input
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
