import type { ReactNode } from 'react';
import './KPICard.css';

interface KPITrend {
  value: number;
  type: 'absolute' | 'percent';
}

interface KPICardProps {
  icon: ReactNode;
  iconBgClass?: string;
  value: string | number;
  label: string;
  trend?: KPITrend;
}

function formatTrend(trend: KPITrend): string {
  const sign = trend.value > 0 ? '+' : '';
  return trend.type === 'percent'
    ? `${sign}${trend.value}%`
    : `${sign}${trend.value}`;
}

function trendDirection(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

export function KPICard({ icon, iconBgClass, value, label, trend }: KPICardProps) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__header">
        <div className={`kpi-card__icon ${iconBgClass ?? ''}`}>
          {icon}
        </div>
        {trend && (
          <span className={`kpi-card__trend kpi-card__trend--${trendDirection(trend.value)}`}>
            {formatTrend(trend)}
          </span>
        )}
      </div>
      <div className="kpi-card__value">{value}</div>
      <div className="kpi-card__label">{label}</div>
    </div>
  );
}
