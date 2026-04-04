import type { SkillCatalogEntry } from '@aquarium/shared';
import { CatalogExtensionRow } from './CatalogExtensionRow';

interface CatalogSkillRowProps {
  entry: SkillCatalogEntry;
  onInstall: (skillId: string, source: string) => void;
  installing: boolean;
  disabled: boolean;
}

export function CatalogSkillRow({ entry, onInstall, installing, disabled }: CatalogSkillRowProps) {
  return (
    <CatalogExtensionRow
      extensionKind="skill"
      id={entry.slug}
      name={entry.name}
      description={entry.description}
      source={entry.source}
      requiredCredentials={entry.requiredCredentials}
      requiredBinaries={entry.requiredBinaries}
      onInstall={onInstall}
      installing={installing}
      disabled={disabled}
    />
  );
}
