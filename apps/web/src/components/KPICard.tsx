import type { ReactNode } from 'react';
import './KPICard.css';

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number | null;
  trendLabel?: string;
  subText?: string;
  icon?: ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'highlight';
}

export function KPICard({
  label,
  value,
  unit,
  trend,
  trendLabel,
  subText,
  icon,
  variant = 'default',
}: KPICardProps) {
  const trendDirection = trend != null ? (trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat') : null;

  return (
    <div className={`kpi-card kpi-card--${variant}`}>
      <div className="kpi-card__header">
        {icon && <span className="kpi-card__icon">{icon}</span>}
        <span className="kpi-card__label">{label}</span>
      </div>
      <div className="kpi-card__value-row">
        {unit && <span className="kpi-card__unit">{unit}</span>}
        <span className="kpi-card__value">{value}</span>
      </div>
      {(trend != null || subText) && (
        <div className="kpi-card__footer">
          {trend != null && (
            <span className={`kpi-card__trend kpi-card__trend--${trendDirection}`}>
              {trendDirection === 'up' && '↑'}
              {trendDirection === 'down' && '↓'}
              {trendDirection === 'flat' && '→'}
              {Math.abs(trend).toFixed(1)}%
              {trendLabel && <span className="kpi-card__trend-label"> {trendLabel}</span>}
            </span>
          )}
          {subText && <span className="kpi-card__sub-text">{subText}</span>}
        </div>
      )}
    </div>
  );
}
