import { useTranslation } from 'react-i18next';
import type { SkillCatalogEntry } from '@aquarium/shared';

interface CatalogSkillRowProps {
  entry: SkillCatalogEntry;
  onInstall: (skillId: string, source: string) => void;
  installing: boolean;
  disabled: boolean;
}

export function CatalogSkillRow({ entry, onInstall, installing, disabled }: CatalogSkillRowProps) {
  const { t } = useTranslation();

  const sourceBadgeClass = entry.source === 'bundled'
    ? 'source-badge source-badge--bundled'
    : 'source-badge source-badge--clawhub';

  const sourceBadgeText = entry.source === 'bundled'
    ? t('extensions.catalog.bundled')
    : t('extensions.catalog.clawhub');

  const requiresCredentials = entry.requiredCredentials.length > 0;

  return (
    <div className="skill-row catalog-skill-row">
      <div className="skill-row__icon">
        <span className="skill-icon">{entry.name[0]?.toUpperCase() ?? '?'}</span>
      </div>
      <div className="skill-row__info">
        <span className="skill-row__name">{entry.name}</span>
        <span className="skill-row__description">{entry.description}</span>
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
        <button
          className="btn btn--primary btn--sm"
          onClick={() => onInstall(entry.slug, entry.source)}
          disabled={disabled || installing}
        >
          {installing ? t('extensions.actions.installing') : t('extensions.actions.install')}
        </button>
      </div>
    </div>
  );
}
