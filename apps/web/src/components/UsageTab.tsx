import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../utils/rpc.js';
import { api } from '../api';
import { BurnRateCard } from './BurnRateCard';
import type { Instance, BillingMode, UsageSummary } from '@aquarium/shared';

/* ─── Types ─── */

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
}

interface DailyAggregate {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
  errors: number;
}

interface ModelBreakdown {
  provider: string;
  model: string;
  count: number;
  totals: { totalTokens: number; totalCost: number; input: number; output: number };
}

interface UsageData {
  updatedAt: number;
  startDate: string;
  endDate: string;
  totals: UsageTotals;
  aggregates: {
    messages: { total: number; user: number; assistant: number; toolCalls: number; toolResults: number; errors: number };
    tools: { totalCalls: number; uniqueTools: number; tools: Array<{ name: string; count: number }> };
    byModel: ModelBreakdown[];
    daily: DailyAggregate[];
  };
}

/* ─── PlatformSpendSection ─── */

function PlatformSpendSection({ spend, loading, error }: { spend: UsageSummary | null; loading: boolean; error: string | null }) {
  const { t } = useTranslation();
  if (loading) return <div className="usage-chart-section"><div>{t('instance.usage.loadingPlatformSpend')}</div></div>;
  if (error) return <div className="usage-chart-section"><div className="error-message" role="alert">{error}</div></div>;
  if (!spend) return null;

  const budgetPercent = spend.budgetUsedPercent ?? 0;
  const budgetColor = budgetPercent > 90 ? 'var(--color-danger)' : budgetPercent > 70 ? 'var(--color-warning)' : 'var(--color-primary)';
  const formatCost = (v: number | undefined | null) => {
    const n = v ?? 0;
    return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  };

  return (
    <div className="usage-chart-section">
      <h4>{t('instance.usage.platformSpend')}</h4>
      <div className="usage-summary-grid">
        <div className="usage-stat-card">
          <span className="usage-stat-value">{formatCost(spend.totalSpendUsd)}</span>
          <span className="usage-stat-label">{t('instance.usage.totalSpend')}</span>
        </div>
        {spend.budgetLimitUsd != null && (
          <div className="usage-stat-card">
            <span className="usage-stat-value">{formatCost(spend.budgetLimitUsd)}</span>
            <span className="usage-stat-label">{t('instance.usage.budgetLimit')}</span>
          </div>
        )}
      </div>
      {spend.budgetLimitUsd != null && (
        <div style={{ margin: 'var(--spacing-md) 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <span>{t('instance.usage.used', { amount: formatCost(spend.totalSpendUsd) })}</span>
            <span>{t('instance.usage.limit', { amount: formatCost(spend.budgetLimitUsd) })}</span>
          </div>
          <div style={{ height: '8px', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(budgetPercent, 100)}%`, background: budgetColor, borderRadius: 'var(--radius-sm)', transition: 'width 0.3s ease-out' }} />
          </div>
        </div>
      )}
      {Object.keys(spend.spendByModel).length > 0 && (
        <table className="usage-breakdown-table" style={{ marginTop: 'var(--spacing-md)' }}>
          <thead>
            <tr><th>{t('instance.usage.columns.model')}</th><th>{t('instance.usage.columns.spend')}</th></tr>
          </thead>
          <tbody>
            {Object.entries(spend.spendByModel).sort((a, b) => b[1] - a[1]).map(([model, cost]) => (
              <tr key={model}>
                <td><strong>{model}</strong></td>
                <td>{formatCost(cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── UsageTab ─── */

interface UsageTabProps {
  instanceId: string;
  instanceStatus: Instance['status'];
  billingMode?: BillingMode;
}

export function UsageTab({ instanceId, instanceStatus, billingMode }: UsageTabProps) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(sevenDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const [platformSpend, setPlatformSpend] = useState<UsageSummary | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);

  useEffect(() => {
    if (billingMode !== 'platform') return;
    setPlatformLoading(true);
    api.get<UsageSummary>(`/usage/instances/${instanceId}`)
      .then(data => setPlatformSpend(data))
      .catch(err => setPlatformError(err instanceof Error ? err.message : t('common.errors.failedToLoad')))
      .finally(() => setPlatformLoading(false));
  }, [billingMode, instanceId]);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<UsageData>(instanceId, 'sessions.usage', {
        startDate,
        endDate,
        limit: 100,
      });
      setUsage(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [instanceId, startDate, endDate]);

  useEffect(() => {
    if (instanceStatus === 'running') fetchUsage();
    else setLoading(false);
  }, [instanceStatus, fetchUsage]);

  if (instanceStatus !== 'running') {
    return (
      <div className="usage-container">
        {billingMode === 'platform' && <PlatformSpendSection spend={platformSpend} loading={platformLoading} error={platformError} />}
        {billingMode === 'platform' && <BurnRateCard instanceId={instanceId} />}
        {billingMode === 'byok' && (
          <div className="info-message">{t('instance.usage.byokMessage')}</div>
        )}
        <div className="info-message">{t('instance.usage.startRequired')}</div>
      </div>
    );
  }

  if (loading) return <div>{t('instance.usage.loading')}</div>;

  if (!usage) {
    return (
      <div className="usage-container">
        <h3>{t('instance.usage.title')}</h3>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="info-message">{t('instance.usage.noData')}</div>
      </div>
    );
  }

  const { totals, aggregates } = usage;
  const daily = aggregates?.daily || [];
  const maxDailyTokens = Math.max(...daily.map(d => d.tokens), 1);
  const maxDailyCost = Math.max(...daily.map(d => d.cost), 0.001);

  const formatCost = (v: number) => v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  const formatDate = (d: string) => {
    const parts = d.split('-');
    return `${parts[1]}/${parts[2]}`;
  };

  return (
    <div className="usage-container">
      {billingMode === 'platform' && <PlatformSpendSection spend={platformSpend} loading={platformLoading} error={platformError} />}
      {billingMode === 'platform' && <BurnRateCard instanceId={instanceId} />}
      {billingMode === 'byok' && (
        <div className="info-message" style={{ marginBottom: 'var(--spacing-md)' }}>{t('instance.usage.byokMessage')}</div>
      )}
      <div className="sessions-header">
        <h3>{t('instance.usage.title')}</h3>
        <div className="usage-date-range">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <span>{t('instance.usage.dateRangeTo')}</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <button onClick={fetchUsage}>{t('common.buttons.refresh')}</button>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="usage-summary-grid">
        <div className="usage-stat-card">
          <span className="usage-stat-value">{totals.totalTokens.toLocaleString()}</span>
          <span className="usage-stat-label">{t('instance.usage.totalTokens')}</span>
        </div>
        <div className="usage-stat-card">
          <span className="usage-stat-value">{formatCost(totals.totalCost)}</span>
          <span className="usage-stat-label">{t('instance.usage.totalCost')}</span>
        </div>
        <div className="usage-stat-card">
          <span className="usage-stat-value">{aggregates?.messages?.total?.toLocaleString() || '0'}</span>
          <span className="usage-stat-label">{t('instance.usage.messages')}</span>
        </div>
        <div className="usage-stat-card">
          <span className="usage-stat-value">{aggregates?.tools?.totalCalls?.toLocaleString() || '0'}</span>
          <span className="usage-stat-label">{t('instance.usage.toolCalls')}</span>
        </div>
      </div>

      {daily.length > 0 && (
        <>
          <div className="usage-chart-section">
            <h4>{t('instance.usage.dailyTokens')}</h4>
            <div className="usage-chart">
              {daily.map(d => (
                <div key={d.date} className="usage-chart-bar-group" title={`${d.date}: ${d.tokens.toLocaleString()} tokens`}>
                  <div
                    className="usage-chart-bar"
                    style={{ height: `${(d.tokens / maxDailyTokens) * 180}px` }}
                  />
                  <span className="usage-chart-bar-label">{formatDate(d.date)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="usage-chart-section">
            <h4>{t('instance.usage.dailyCost')}</h4>
            <div className="usage-chart">
              {daily.map(d => (
                <div key={d.date} className="usage-chart-bar-group" title={`${d.date}: ${formatCost(d.cost)}`}>
                  <div
                    className="usage-chart-bar cost"
                    style={{ height: `${(d.cost / maxDailyCost) * 180}px` }}
                  />
                  <span className="usage-chart-bar-label">{formatDate(d.date)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {aggregates?.byModel && aggregates.byModel.length > 0 && (
        <div className="usage-chart-section">
          <h4>{t('instance.usage.byModel')}</h4>
          <table className="usage-breakdown-table">
            <thead>
              <tr>
                <th>{t('instance.usage.columns.model')}</th>
                <th>{t('instance.usage.columns.provider')}</th>
                <th>{t('instance.usage.columns.requests')}</th>
                <th>{t('instance.usage.columns.tokens')}</th>
                <th>{t('instance.usage.columns.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.byModel.map(m => (
                <tr key={`${m.provider}/${m.model}`}>
                  <td><strong>{m.model}</strong></td>
                  <td>{m.provider}</td>
                  <td>{m.count}</td>
                  <td>{m.totals.totalTokens.toLocaleString()}</td>
                  <td>{formatCost(m.totals.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aggregates?.tools?.tools && aggregates.tools.tools.length > 0 && (
        <div className="usage-chart-section">
          <h4>{t('instance.usage.topTools')}</h4>
          <table className="usage-breakdown-table">
            <thead>
              <tr>
                <th>{t('instance.usage.columns.tool')}</th>
                <th>{t('instance.usage.columns.calls')}</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.tools.tools.slice(0, 15).map(t => (
                <tr key={t.name}>
                  <td><code>{t.name}</code></td>
                  <td>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="usage-chart-section">
        <h4>{t('instance.usage.tokenBreakdown')}</h4>
        <table className="usage-breakdown-table">
          <thead>
            <tr><th>{t('instance.usage.columns.category')}</th><th>{t('instance.usage.columns.tokens')}</th><th>{t('instance.usage.columns.cost')}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('instance.usage.tokenCategories.input')}</td>
              <td>{totals.input.toLocaleString()}</td>
              <td>{formatCost(totals.inputCost)}</td>
            </tr>
            <tr>
              <td>{t('instance.usage.tokenCategories.output')}</td>
              <td>{totals.output.toLocaleString()}</td>
              <td>{formatCost(totals.outputCost)}</td>
            </tr>
            <tr>
              <td>{t('instance.usage.tokenCategories.cacheRead')}</td>
              <td>{totals.cacheRead.toLocaleString()}</td>
              <td>{formatCost(totals.cacheReadCost)}</td>
            </tr>
            <tr>
              <td>{t('instance.usage.tokenCategories.cacheWrite')}</td>
              <td>{totals.cacheWrite.toLocaleString()}</td>
              <td>{formatCost(totals.cacheWriteCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
