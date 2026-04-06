import type { ChannelRegistryItem } from '@aquarium/shared';
import { ChannelCard } from './ChannelCard';

interface ChannelGridProps {
  channels: ChannelRegistryItem[];
  onSelect: (channelId: string) => void;
  disabled: boolean;
  applyingChannelId: string | null;
}

export function ChannelGrid({ channels, onSelect, disabled, applyingChannelId }: ChannelGridProps) {
  return (
    <div className="channel-grid">
      {channels.map(ch => (
        <ChannelCard
          key={ch.id}
          channel={ch}
          onSelect={onSelect}
          disabled={disabled}
          applying={ch.id === applyingChannelId}
        />
      ))}
    </div>
  );
}

export function ChannelGridSkeleton() {
  return (
    <div className="channel-grid">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="channel-card channel-card--skeleton" aria-hidden="true">
          <div className="channel-card__header">
            <div className="skeleton-pulse" style={{ width: 24, height: 24, borderRadius: 6 }} />
            <div className="skeleton-pulse" style={{ width: 100, height: 16, borderRadius: 4 }} />
          </div>
          <div className="channel-card__status">
            <div className="skeleton-pulse" style={{ width: 80, height: 14, borderRadius: 4 }} />
          </div>
          <div className="channel-card__capabilities">
            <div className="skeleton-pulse" style={{ width: 40, height: 12, borderRadius: 4 }} />
            <div className="skeleton-pulse" style={{ width: 50, height: 12, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
