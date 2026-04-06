import '../../pages/CreateWizardPage.css';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import type { StepAgentTypeProps } from './types';

export function StepAgentType({ allTypes, selectedId, onSelect }: StepAgentTypeProps) {
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
            <Button
              key={at.id}
              type="button"
              variant="outline"
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
            </Button>
          );
        })}
      </div>
    </div>
  );
}
