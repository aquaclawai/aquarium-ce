import { useTranslation } from 'react-i18next';
import type { ChannelRegistryItem } from '@aquarium/shared';
import { ChannelIcon } from './ChannelIcon';
import { ChannelStatusBadge } from './ChannelStatusBadge';

interface ChannelCardProps {
  channel: ChannelRegistryItem;
  onSelect: (channelId: string) => void;
  disabled: boolean;
  applying: boolean;
}

export function ChannelCard({ channel, onSelect, disabled, applying }: ChannelCardProps) {
  const { t } = useTranslation();

  const isConnected = channel.status?.connected ?? false;
  const hasError = channel.status != null && !channel.status.connected && channel.status.configured && channel.status.running;

  let cardClass = 'channel-card';
  if (disabled) cardClass += ' channel-card--disabled';
  else if (applying) cardClass += ' channel-card--applying';
  else if (isConnected) cardClass += ' channel-card--connected';
  else if (hasError) cardClass += ' channel-card--error';

  const needsPlugin = channel.pluginRequired && !channel.pluginInstalled;

  const capabilities = Object.entries(channel.capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .slice(0, 4);

  const lastActivity = channel.status?.lastInboundAt
    ? formatRelativeTime(channel.status.lastInboundAt)
    : null;

  return (
    <button
      className={cardClass}
      onClick={() => !disabled && onSelect(channel.id)}
      disabled={disabled}
      type="button"
    >
      <div className="channel-card__header">
        <ChannelIcon icon={channel.icon} />
        <span className="channel-card__name">{t(channel.labelKey, channel.label)}</span>
        {needsPlugin && <span className="channel-card__plugin-badge">{t('channels.drawer.pluginRequired')}</span>}
      </div>

      <div className="channel-card__status">
        <ChannelStatusBadge
          status={channel.status}
          hasCredentials={channel.hasCredentials}
          applying={applying}
        />
        {lastActivity && isConnected && (
          <span className="channel-card__activity">{t('channels.status.lastMessage', { time: lastActivity })}</span>
        )}
      </div>

      {capabilities.length > 0 && (
        <div className="channel-card__capabilities">
          {capabilities.map(cap => (
            <span key={cap} className="channel-card__cap-badge">
              {t(`channels.capabilities.${cap}`, cap)}
            </span>
          ))}
        </div>
      )}

      <div className="channel-card__action">
        {channel.hasCredentials
          ? t('channels.actions.configure')
          : t('channels.actions.setup')}
         &rarr;
      </div>
    </button>
  );
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return '<1m ago';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
