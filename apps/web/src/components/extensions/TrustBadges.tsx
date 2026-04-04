import { useTranslation } from 'react-i18next';
import type { TrustTier, TrustSignals } from '@aquarium/shared';

interface TrustBadgeRowProps {
  trustTier?: TrustTier;
  trustSignals?: TrustSignals;
  source: 'bundled' | 'clawhub';
}

export function TrustBadgeRow({ trustTier, trustSignals, source }: TrustBadgeRowProps) {
  const { t } = useTranslation();

  if (source === 'bundled') {
    return (
      <span className="trust-badge trust-badge--bundled">
        {t('extensions.trust.bundled')}
      </span>
    );
  }

  return (
    <span className="trust-badge-row">
      {trustTier === 'verified' && (
        <span className="trust-badge trust-badge--verified">
          &#10003; {t('extensions.trust.verified')}
        </span>
      )}
      {trustTier === 'community' && (
        <span className="trust-badge trust-badge--community">
          {t('extensions.trust.unverified')}
        </span>
      )}
      {trustTier === 'unscanned' && (
        <span className="trust-badge trust-badge--unscanned">
          {t('extensions.trust.scanFailed')}
        </span>
      )}
      {trustSignals && (
        <>
          {trustSignals.virusTotalPassed === true && (
            <span className="trust-badge trust-badge--scanned">
              &#128737; {t('extensions.trust.scanned')}
            </span>
          )}
          {trustSignals.virusTotalPassed === false && (
            <span className="trust-badge trust-badge--scan-failed">
              &#128737; {t('extensions.trust.scanFailed')}
            </span>
          )}
          {trustSignals.downloadCount > 100 && (
            <span className="trust-badge trust-badge--downloads">
              {t('extensions.trust.downloads', { count: trustSignals.downloadCount })}
            </span>
          )}
          {trustSignals.ageInDays > 90 && (
            <span className="trust-badge trust-badge--age">
              {t('extensions.trust.age', { days: trustSignals.ageInDays })}
            </span>
          )}
        </>
      )}
    </span>
  );
}
