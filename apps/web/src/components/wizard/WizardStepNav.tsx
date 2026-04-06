import '../../pages/CreateWizardPage.css';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { STEP_IDS } from './types';
import type { WizardStep } from './types';

export interface WizardStepNavProps {
  currentStep: WizardStep;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void;
  canProceed: boolean;
  creating: boolean;
}

const STEP_LABEL_KEYS: Record<WizardStep, string> = {
  agentType: 'wizard.steps.agentType',
  naming: 'wizard.steps.naming',
  principles: 'wizard.steps.principles',
  identity: 'wizard.steps.identity',
  confirm: 'wizard.steps.confirm',
};

/** Vertical stepper — placed to the left of the wizard card. */
export function WizardStepper({ currentStep }: { currentStep: WizardStep }) {
  const { t } = useTranslation();
  const currentIndex = STEP_IDS.indexOf(currentStep);
  return (
    <nav aria-label="Progress" className="wiz-stepper">
      <ol role="list" className="wiz-stepper__list">
        {STEP_IDS.map((stepId, i) => {
          const status = i < currentIndex ? 'complete' : stepId === currentStep ? 'current' : 'upcoming';
          return (
            <li key={stepId} className="wiz-stepper__item">
              {status === 'complete' ? (
                <span className="wiz-stepper__row">
                  <span className="wiz-stepper__indicator">
                    <svg className="wiz-stepper__check-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <span className="wiz-stepper__label wiz-stepper__label--done">{t(STEP_LABEL_KEYS[stepId])}</span>
                </span>
              ) : status === 'current' ? (
                <span className="wiz-stepper__row" aria-current="step">
                  <span className="wiz-stepper__indicator">
                    <span className="wiz-stepper__dot-ring" />
                    <span className="wiz-stepper__dot" />
                  </span>
                  <span className="wiz-stepper__label wiz-stepper__label--active">{t(STEP_LABEL_KEYS[stepId])}</span>
                </span>
              ) : (
                <span className="wiz-stepper__row">
                  <span className="wiz-stepper__indicator">
                    <span className="wiz-stepper__dot wiz-stepper__dot--pending" />
                  </span>
                  <span className="wiz-stepper__label">{t(STEP_LABEL_KEYS[stepId])}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Navigation footer — back/next/create buttons. Place INSIDE wiz-card, at the bottom. */
export function WizardStepNav({
  currentStep,
  onBack,
  onNext,
  onCreate,
  canProceed,
  creating,
}: WizardStepNavProps) {
  const { t } = useTranslation();
  const currentIndex = STEP_IDS.indexOf(currentStep);
  return (
    <div className="wiz-footer">
      <Button
        type="button"
        variant="secondary"
        className="wiz-btn-cancel"
        onClick={onBack}
      >
        {currentIndex === 0 ? t('common.buttons.cancel') : t('wizard.navigation.back')}
      </Button>

      {currentStep === 'confirm' ? (
        <Button
          type="button"
          className="btn-finish"
          onClick={onCreate}
          disabled={creating || !canProceed}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 10.667A1.333 1.333 0 0 1 12.667 12H4.667L2 14.667V3.333A1.333 1.333 0 0 1 3.333 2h9.334A1.333 1.333 0 0 1 14 3.333v7.334z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {creating ? t('wizard.navigation.creating') : t('wizard.navigation.finish')}
        </Button>
      ) : (
        <Button
          type="button"
          className="btn-primary-wiz"
          onClick={onNext}
          disabled={!canProceed}
        >
          {t('wizard.navigation.next')}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </Button>
      )}
    </div>
  );
}
