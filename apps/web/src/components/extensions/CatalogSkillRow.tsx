import type { SkillCatalogEntry, TrustSignals, TrustTier } from '@aquarium/shared';
import { CatalogExtensionRow } from './CatalogExtensionRow';

interface CatalogSkillRowProps {
  entry: SkillCatalogEntry;
  onInstall: (skillId: string, source: string) => void;
  installing: boolean;
  disabled: boolean;
  trustTier?: TrustTier;
  trustSignals?: TrustSignals;
  blocked?: boolean;
  blockReason?: string;
  onRequestOverride?: (id: string) => void;
}

export function CatalogSkillRow({
  entry,
  onInstall,
  installing,
  disabled,
  trustTier,
  trustSignals,
  blocked,
  blockReason,
  onRequestOverride,
}: CatalogSkillRowProps) {
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
      trustTier={trustTier}
      trustSignals={trustSignals}
      blocked={blocked}
      blockReason={blockReason}
      onRequestOverride={onRequestOverride}
    />
  );
}
