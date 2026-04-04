import { useTranslation } from 'react-i18next';
import type { ExtensionCredentialRequirement, ExtensionKind } from '@aquarium/shared';

interface CatalogExtensionRowProps {
  extensionKind: ExtensionKind;
  id: string;
  name: string;
  description: string;
  source: 'bundled' | 'clawhub';
  requiredCredentials: ExtensionCredentialRequirement[];
  capabilities?: string[];
  requiredBinaries?: string[];
  onInstall: (id: string, source: string) => void;
  installing: boolean;
  disabled: boolean;
}

export function CatalogExtensionRow({
  extensionKind,
  id,
  name,
  description,
  source,
  requiredCredentials,
  capabilities,
  requiredBinaries,
  onInstall,
  installing,
  disabled,
}: CatalogExtensionRowProps) {
  const { t } = useTranslation();

  const sourceBadgeClass = source === 'bundled'
    ? 'source-badge source-badge--bundled'
    : 'source-badge source-badge--clawhub';

  const sourceBadgeText = source === 'bundled'
    ? t('extensions.catalog.bundled')
    : t('extensions.catalog.clawhub');

  const requiresCredentials = requiredCredentials.length > 0;

  return (
    <div className="skill-row catalog-skill-row">
      <div className="skill-row__icon">
        <span className="skill-icon">{name[0]?.toUpperCase() ?? '?'}</span>
      </div>
      <div className="skill-row__info">
        <span className="skill-row__name">{name}</span>
        <span className="skill-row__description">{description}</span>
        {extensionKind === 'plugin' && capabilities && capabilities.length > 0 && (
          <div className="capability-badges">
            {capabilities.map(cap => (
              <span key={cap} className="capability-badge">{cap}</span>
            ))}
          </div>
        )}
        {extensionKind === 'skill' && requiredBinaries && requiredBinaries.length > 0 && (
          <span className="skill-row__description">
            {t('extensions.catalog.requires')}: {requiredBinaries.join(', ')}
          </span>
        )}
      </div>
      <div className="skill-row__meta">
        <span className={sourceBadgeClass}>{sourceBadgeText}</span>
        {requiresCredentials && (
          <span className="credential-indicator" title={t('extensions.catalog.requiresCredentials')}>
            &#128273; {t('extensions.catalog.requiresCredentials')}
          </span>
        )}
      </div>
      <div className="skill-row__actions">
        <div className="catalog-install-block">
          <button
            className="btn btn--primary btn--sm"
            onClick={() => onInstall(id, source)}
            disabled={disabled || installing}
          >
            {installing ? t('extensions.actions.installing') : t('extensions.actions.install')}
          </button>
          {extensionKind === 'plugin' && (
            <span className="catalog-restart-note">{t('extensions.plugins.requiresRestart')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
