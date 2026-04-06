import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { TrendBadge } from './TrendBadge';
import type { BurnRateApiData } from '@aquarium/shared';
import { KPICardSkeleton } from '@/components/skeletons';
import './BurnRateCard.css';

interface BurnRateCardProps {
  instanceId?: string;
}

function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function BurnRateCard({ instanceId }: BurnRateCardProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<BurnRateApiData | null>(null);
  const [settled, setSettled] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    const endpoint = instanceId
      ? `/usage/instances/${instanceId}/burn-rate`
      : '/usage/burn-rate';

    let cancelled = false;
    api.get<BurnRateApiData>(endpoint)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setSettled(true); });
    return () => { cancelled = true; };
  }, [instanceId]);

  if (!settled) {
    return (
      <div className="burn-rate-card">
        <h4 className="burn-rate-card-title">{t('burnRate.title')}</h4>
        <KPICardSkeleton />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="burn-rate-card">
        <h4 className="burn-rate-card-title">{t('burnRate.title')}</h4>
        <div className="burn-rate-card-error">{t('burnRate.fetchError')}</div>
      </div>
    );
  }

  if (!data?.burnRate) {
    if (data?.reason === 'not_provisioned' || data?.reason === 'no_team') {
      return (
        <div className="burn-rate-card">
          <h4 className="burn-rate-card-title">{t('burnRate.title')}</h4>
          <div className="burn-rate-card-info">{t('burnRate.notProvisioned')}</div>
        </div>
      );
    }
    if (data?.reason === 'no_usage') {
      return (
        <div className="burn-rate-card">
          <h4 className="burn-rate-card-title">{t('burnRate.title')}</h4>
          <div className="burn-rate-card-info">{t('burnRate.noUsage')}</div>
        </div>
      );
    }
    return null;
  }

  const { burnRate } = data;

  return (
    <div className="burn-rate-card">
      <h4 className="burn-rate-card-title">{t('burnRate.title')}</h4>
      <div className="burn-rate-card-rows">
        <div className="burn-rate-row">
          <span className="burn-rate-row-label">{t('burnRate.today')}</span>
          <span className="burn-rate-row-value">{formatUsd(burnRate.dailyRateToday)}</span>
        </div>
        <div className="burn-rate-row">
          <span className="burn-rate-row-label">{t('burnRate.sevenDayAvg')}</span>
          <span className="burn-rate-row-value">
            {formatUsd(burnRate.dailyRate7d)}
            <TrendBadge trend={burnRate.trend} />
          </span>
        </div>
        <div className="burn-rate-row">
          <span className="burn-rate-row-label">{t('burnRate.thirtyDayAvg')}</span>
          <span className="burn-rate-row-value">{formatUsd(burnRate.dailyRate30d)}</span>
        </div>

        <div className="burn-rate-divider" />

        {burnRate.daysUntilExhaustion !== null && (
          <div className="burn-rate-row">
            <span className="burn-rate-row-label">{t('burnRate.daysUntilExhaustion')}</span>
            <span className={`burn-rate-row-value ${burnRate.daysUntilExhaustion <= 3 ? 'burn-rate-row-value--danger' : ''}`}>
              {t('burnRate.daysCount', { count: burnRate.daysUntilExhaustion })}
            </span>
          </div>
        )}
        <div className="burn-rate-row">
          <span className="burn-rate-row-label">{t('burnRate.projectedMonthly')}</span>
          <span className="burn-rate-row-value">{formatUsd(burnRate.projectedMonthlySpend)}</span>
        </div>
      </div>
    </div>
  );
}
