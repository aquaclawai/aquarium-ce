import { useTranslation } from 'react-i18next';
import { Bot, MessageSquare, CreditCard, Activity } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { QuickStartBanner } from '../components/dashboard/QuickStartBanner';
import { KPICard } from '../components/dashboard/KPICard';
import { UsageChart } from '../components/dashboard/UsageChart';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import './WorkbenchPage.css';

function formatCurrency(amount: number, locale: string): string {
  const currency = locale.startsWith('zh') ? 'CNY' : 'USD';
  if (amount === 0) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(0);
  }
  if (amount < 1) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(amount);
}

function formatNumber(n: number, locale: string): string {
  if (locale.startsWith('zh') && n >= 10000) {
    return `${(n / 10000).toFixed(1)}万`;
  }
  if (!locale.startsWith('zh') && n >= 1000) {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  return n.toLocaleString(locale);
}

export function WorkbenchPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { kpi, chartData, activities, loading, error } = useDashboardData();

  if (loading) {
    return (
      <main className="workbench-page">
        <div className="workbench-page__loading">{t('dashboard.loading')}</div>
      </main>
    );
  }

  return (
    <main className="workbench-page">
      <header className="workbench-page__header">
        <h1 className="workbench-page__title">{t('dashboard.title')}</h1>
        <p className="workbench-page__subtitle">{t('dashboard.subtitle')}</p>
      </header>

      {error && (
        <div className="workbench-page__error" role="alert">{error}</div>
      )}

      <QuickStartBanner />

      <div className="workbench-kpi-grid">
        <KPICard
          icon={<Bot size={22} />}
          value={kpi.activeAssistants}
          label={t('dashboard.kpi.activeAssistants')}
          trend={kpi.trends.activeAssistants}
        />
        <KPICard
          icon={<MessageSquare size={22} />}
          value={kpi.messageGroups}
          label={t('dashboard.kpi.messageGroups')}
          trend={kpi.trends.messageGroups}
        />
        <KPICard
          icon={<CreditCard size={22} />}
          value={formatCurrency(kpi.todaySpend, locale)}
          label={t('dashboard.kpi.todaySpend')}
          trend={kpi.trends.todaySpend}
        />
        <KPICard
          icon={<Activity size={22} />}
          value={formatNumber(kpi.apiCalls, locale)}
          label={t('dashboard.kpi.apiCalls')}
          trend={kpi.trends.apiCalls}
        />
      </div>

      <div className="workbench-bottom-row">
        <UsageChart
          data={chartData}
          trendPercent={18}
        />
        <ActivityFeed activities={activities} />
      </div>
    </main>
  );
}
