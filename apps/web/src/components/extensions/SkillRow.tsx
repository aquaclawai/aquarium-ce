import { useTranslation } from 'react-i18next';
import type { InstanceSkill, ExtensionStatus } from '@aquarium/shared';

interface SkillRowProps {
  skill: InstanceSkill;
  onToggle: (skillId: string, enabled: boolean) => void;
  onUninstall: (skillId: string) => void;
  onConfigure: (skillId: string) => void;
  disabled: boolean;
}

function getStatusDotClass(status: ExtensionStatus): string {
  switch (status) {
    case 'active':
      return 'status-dot status-dot--active';
    case 'installed':
    case 'degraded':
      return 'status-dot status-dot--warning';
    case 'failed':
      return 'status-dot status-dot--error';
    case 'pending':
    case 'disabled':
    default:
      return 'status-dot status-dot--disabled';
  }
}

export function SkillRow({ skill, onToggle, onUninstall, onConfigure, disabled }: SkillRowProps) {
  const { t } = useTranslation();

  const truncatedDescription = skill.skillId.length > 60
    ? skill.skillId.slice(0, 60) + '…'
    : skill.skillId;

  const handleUninstall = () => {
    if (window.confirm(t('extensions.confirm.uninstall'))) {
      onUninstall(skill.skillId);
    }
  };

  const statusKey = `extensions.status.${skill.status}` as const;

  return (
    <div className="skill-row">
      <div className="skill-row__icon">
        <span className="skill-icon">{skill.skillId[0]?.toUpperCase() ?? '?'}</span>
      </div>
      <div className="skill-row__info">
        <span className="skill-row__name">{skill.skillId}</span>
        <span className="skill-row__description" title={skill.skillId}>{truncatedDescription}</span>
      </div>
      <div className="skill-row__status">
        <span className={getStatusDotClass(skill.status)} aria-hidden="true" />
        <span className="skill-row__status-text">{t(statusKey)}</span>
      </div>
      <div className="skill-row__actions">
        <label className="toggle-switch" title={skill.enabled ? t('extensions.actions.disable') : t('extensions.actions.enable')}>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={(e) => onToggle(skill.skillId, e.target.checked)}
            disabled={disabled || skill.status === 'failed'}
          />
          <span className="toggle-switch__track" />
        </label>
        <button
          className="icon-button"
          title={t('extensions.actions.configure')}
          onClick={() => onConfigure(skill.skillId)}
          disabled={disabled}
          aria-label={t('extensions.actions.configure')}
        >
          &#9881;
        </button>
        <button
          className="icon-button icon-button--danger"
          title={t('extensions.actions.uninstall')}
          onClick={handleUninstall}
          disabled={disabled}
          aria-label={t('extensions.actions.uninstall')}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
