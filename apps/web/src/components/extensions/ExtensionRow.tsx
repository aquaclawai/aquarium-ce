import { useTranslation } from 'react-i18next';
import type { ExtensionStatus, ExtensionKind } from '@aquarium/shared';

interface ExtensionRowProps {
  extensionKind: ExtensionKind;
  extensionId: string;
  extensionName: string;
  status: ExtensionStatus;
  enabled: boolean;
  errorMessage: string | null;
  onToggle: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onConfigure: (id: string) => void;
  onActivate?: (id: string) => void;
  disabled: boolean;
  activating?: boolean;
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

export function ExtensionRow(props: ExtensionRowProps) {
  const {
    extensionKind,
    extensionId,
    extensionName,
    status,
    enabled,
    onToggle,
    onUninstall,
    onConfigure,
    onActivate,
    disabled,
    activating,
  } = props;
  const { t } = useTranslation();

  const displayName = extensionName || extensionId;
  const truncatedDescription = displayName.length > 60
    ? displayName.slice(0, 60) + '…'
    : displayName;

  const handleUninstall = () => {
    const confirmMsg = extensionKind === 'plugin'
      ? t('extensions.confirm.uninstallPlugin')
      : t('extensions.confirm.uninstall');
    if (window.confirm(confirmMsg)) {
      onUninstall(extensionId);
    }
  };

  const statusKey = `extensions.status.${status}` as const;

  // For plugins with 'installed' status, show Activate button instead of toggle
  const showActivateButton = extensionKind === 'plugin' && status === 'installed';

  return (
    <div className="skill-row">
      <div className="skill-row__icon">
        <span className="skill-icon">{displayName[0]?.toUpperCase() ?? '?'}</span>
      </div>
      <div className="skill-row__info">
        <span className="skill-row__name">{displayName}</span>
        <span className="skill-row__description" title={displayName}>{truncatedDescription}</span>
      </div>
      <div className="skill-row__status">
        <span className={getStatusDotClass(status)} aria-hidden="true" />
        <span className="skill-row__status-text">{t(statusKey)}</span>
      </div>
      <div className="skill-row__actions">
        {showActivateButton ? (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => onActivate?.(extensionId)}
            disabled={disabled || activating}
            title={t('extensions.actions.activate')}
          >
            {activating ? t('extensions.actions.activating') : t('extensions.actions.activate')}
          </button>
        ) : (
          <label
            className="toggle-switch"
            title={enabled ? t('extensions.actions.disable') : t('extensions.actions.enable')}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(extensionId, e.target.checked)}
              disabled={disabled || status === 'failed'}
            />
            <span className="toggle-switch__track" />
          </label>
        )}
        <button
          className="icon-button"
          title={t('extensions.actions.configure')}
          onClick={() => onConfigure(extensionId)}
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
