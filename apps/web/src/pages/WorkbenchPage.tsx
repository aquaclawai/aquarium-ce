import { useTranslation } from 'react-i18next';
import { Bot, MessageSquare, CreditCard, Activity } from 'lucide-react';
import { useDashboardData } from '../hooks/useDashboardData';
import { PageHeader } from '../components/PageHeader';
import { QuickStartBanner } from '../components/dashboard/QuickStartBanner';
import { KPICard } from '../components/KPICard';
import { UsageChart } from '../components/dashboard/UsageChart';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import { PageHeaderSkeleton, KPICardSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';
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
        <PageHeaderSkeleton />
        <div className="workbench-kpi-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <KPICardSkeleton key={i} />
          ))}
        </div>
        <div className="workbench-bottom-row">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </main>
    );
  }

  return (
    <main className="workbench-page">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
      />

      {error && (
        <div className="workbench-page__error" role="alert">{error}</div>
      )}

      <QuickStartBanner />

      <div className="workbench-kpi-grid">
        <KPICard
          icon={<Bot size={22} />}
          value={kpi.activeAssistants}
          label={t('dashboard.kpi.activeAssistants')}
          trend={kpi.trends.activeAssistants.value}
        />
        <KPICard
          icon={<MessageSquare size={22} />}
          value={kpi.messageGroups}
          label={t('dashboard.kpi.messageGroups')}
          trend={kpi.trends.messageGroups.value}
        />
        <KPICard
          icon={<CreditCard size={22} />}
          value={formatCurrency(kpi.todaySpend, locale)}
          label={t('dashboard.kpi.todaySpend')}
          trend={kpi.trends.todaySpend.value}
        />
        <KPICard
          icon={<Activity size={22} />}
          value={formatNumber(kpi.apiCalls, locale)}
          label={t('dashboard.kpi.apiCalls')}
          trend={kpi.trends.apiCalls.value}
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
