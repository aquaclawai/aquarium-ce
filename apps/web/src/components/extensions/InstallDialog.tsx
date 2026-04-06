import { useTranslation } from 'react-i18next';
import type { ExtensionKind, PluginCatalogEntry, SkillCatalogEntry, TrustTier, TrustSignals } from '@aquarium/shared';
import { TrustBadgeRow } from './TrustBadges';

interface InstallDialogProps {
  extensionKind: ExtensionKind;
  entry: PluginCatalogEntry | SkillCatalogEntry;
  onConfirm: () => void;
  onCancel: () => void;
  installing: boolean;
  trustTier?: TrustTier;
  trustSignals?: TrustSignals;
}

export function InstallDialog({ extensionKind, entry, onConfirm, onCancel, installing, trustTier, trustSignals }: InstallDialogProps) {
  const { t } = useTranslation();

  const sourceBadgeClass = entry.source === 'bundled'
    ? 'source-badge source-badge--bundled'
    : 'source-badge source-badge--clawhub';

  const sourceBadgeText = entry.source === 'bundled'
    ? t('extensions.catalog.bundled')
    : t('extensions.catalog.clawhub');

  return (
    <div className="install-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title">
      <div className="install-dialog">
        <div className="install-dialog__header">
          <h2 id="install-dialog-title" className="install-dialog__title">
            {t('extensions.installDialog.title', { name: entry.name })}
          </h2>
        </div>

        <div className="install-dialog__body">
          <div className="install-dialog__row">
            <span className="install-dialog__label">{t('extensions.installDialog.source')}</span>
            <span className={sourceBadgeClass}>{sourceBadgeText}</span>
          </div>

          <div className="install-dialog__row">
            <span className="install-dialog__label">{t('extensions.installDialog.version')}</span>
            <span className="install-dialog__value">v{entry.version}</span>
          </div>

          {trustTier !== undefined && (
            <div className="install-dialog__row">
              <span className="install-dialog__label">{t('extensions.trust.trustSummary')}</span>
              <TrustBadgeRow trustTier={trustTier} trustSignals={trustSignals} source={entry.source} />
            </div>
          )}

          <div className="install-dialog__credentials">
            <span className="install-dialog__label">{t('extensions.installDialog.requiredCredentials')}</span>
            {entry.requiredCredentials.length === 0 ? (
              <p className="install-dialog__no-credentials">{t('extensions.installDialog.noCredentials')}</p>
            ) : (
              <ul className="install-dialog__credentials-list">
                {entry.requiredCredentials.map((cred) => (
                  <li key={cred.field} className="install-dialog__credential-item">
                    <span className="install-dialog__credential-field">{cred.field}</span>
                    <span className="install-dialog__credential-type">{cred.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {extensionKind === 'plugin' && (
            <p className="install-dialog__warning">
              {t('extensions.installDialog.restartWarning')}
            </p>
          )}
        </div>

        <div className="install-dialog__footer">
          <button
            className="btn btn--sm"
            onClick={onCancel}
            disabled={installing}
          >
            {t('extensions.installDialog.cancel')}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={onConfirm}
            disabled={installing}
          >
            {installing
              ? t('extensions.installDialog.installing')
              : t('extensions.installDialog.install')}
          </button>
        </div>
      </div>
    </div>
  );
}
