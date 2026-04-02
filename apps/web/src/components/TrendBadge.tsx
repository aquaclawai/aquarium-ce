import type { BurnRateTrend } from '@aquarium/shared';

interface TrendBadgeProps {
  trend: BurnRateTrend;
}

const TREND_CONFIG: Record<BurnRateTrend, { icon: string; label: string; className: string }> = {
  fast_burn: { icon: '🔥', label: 'Fast burn', className: 'trend-badge--fast-burn' },
  rising: { icon: '▲', label: 'Rising', className: 'trend-badge--rising' },
  steady: { icon: '→', label: 'Steady', className: 'trend-badge--steady' },
  cooling: { icon: '▼', label: 'Cooling', className: 'trend-badge--cooling' },
  idle: { icon: '○', label: 'Idle', className: 'trend-badge--idle' },
};

export function TrendBadge({ trend }: TrendBadgeProps) {
  const config = TREND_CONFIG[trend];
  return (
    <span className={`trend-badge ${config.className}`}>
      <span className="trend-badge-icon">{config.icon}</span>
      <span className="trend-badge-label">{config.label}</span>
    </span>
  );
}
