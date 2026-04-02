import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { ChartDataPoint } from '../../hooks/useDashboardData';
import './UsageChart.css';

interface UsageChartProps {
  data: ChartDataPoint[];
  trendPercent?: number;
}

export function UsageChart({ data, trendPercent }: UsageChartProps) {
  const { t } = useTranslation();

  const hasData = data.length > 0;

  return (
    <div className="usage-chart">
      <div className="usage-chart__header">
        <div>
          <h3 className="usage-chart__title">{t('dashboard.chart.title')}</h3>
          <p className="usage-chart__subtitle">{t('dashboard.chart.subtitle')}</p>
        </div>
        {trendPercent != null && (
          <div className={`usage-chart__trend ${trendPercent >= 0 ? 'usage-chart__trend--positive' : 'usage-chart__trend--negative'}`}>
            <TrendingUp size={16} />
            <span>{trendPercent > 0 ? '+' : ''}{trendPercent}%</span>
          </div>
        )}
      </div>

      <div className="usage-chart__body">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0052FF" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#0052FF" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--dashboard-chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'var(--dashboard-chart-axis-text)' }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'var(--dashboard-chart-axis-text)' }}
                dx={-4}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-card-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  boxShadow: 'var(--shadow-md)',
                }}
                labelStyle={{ color: 'var(--color-text)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--color-text-secondary)' }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#0052FF"
                strokeWidth={2.5}
                fill="url(#chartAreaGradient)"
                dot={false}
                activeDot={{ r: 5, fill: '#0052FF', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="usage-chart__empty">
            <p>{t('dashboard.chart.noData')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
