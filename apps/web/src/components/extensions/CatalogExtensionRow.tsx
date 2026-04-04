import { useTranslation } from 'react-i18next';
import type { ExtensionCredentialRequirement, ExtensionKind, TrustTier, TrustSignals } from '@aquarium/shared';
import { TrustBadgeRow } from './TrustBadges';

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
  trustTier?: TrustTier;
  trustSignals?: TrustSignals;
  blocked?: boolean;
  blockReason?: string;
  onRequestOverride?: (id: string) => void;
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
  trustTier,
  trustSignals,
  blocked,
  blockReason,
  onRequestOverride,
}: CatalogExtensionRowProps) {
  const { t } = useTranslation();

  const requiresCredentials = requiredCredentials.length > 0;
  const rowClassName = `skill-row catalog-skill-row${blocked ? ' catalog-skill-row--blocked' : ''}`;

  return (
    <div className={rowClassName}>
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
        <TrustBadgeRow trustTier={trustTier} trustSignals={trustSignals} source={source} />
        {requiresCredentials && (
          <span className="credential-indicator" title={t('extensions.catalog.requiresCredentials')}>
            &#128273; {t('extensions.catalog.requiresCredentials')}
          </span>
        )}
      </div>
      <div className="skill-row__actions">
        {blocked ? (
          <div className="catalog-install-block">
            <span className="blocked-label">
              <span className="blocked-label__icon">&#128274;</span>
              <span>{blockReason ?? t('extensions.trust.blockedCommunity')}</span>
            </span>
            {trustTier === 'community' && onRequestOverride && (
              <button
                className="override-link"
                onClick={() => onRequestOverride(id)}
              >
                {t('extensions.trust.override')}
              </button>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
