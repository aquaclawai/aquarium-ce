import { useTranslation } from 'react-i18next';
import type { ChannelStatusDetail } from '@aquarium/shared';

interface ChannelStatusBadgeProps {
  status: ChannelStatusDetail | null;
  hasCredentials: boolean;
  applying?: boolean;
}

export function ChannelStatusBadge({ status, hasCredentials, applying }: ChannelStatusBadgeProps) {
  const { t } = useTranslation();

  if (applying) {
    return (
      <span className="channel-status channel-status--applying">
        <span className="channel-status__dot" />
        {t('channels.status.applying')}
      </span>
    );
  }

  if (!status && !hasCredentials) {
    return (
      <span className="channel-status channel-status--unconfigured">
        <span className="channel-status__dot" />
        {t('channels.status.notConfigured')}
      </span>
    );
  }

  if (!status && !hasCredentials) {
    return (
      <span className="channel-status channel-status--unconfigured">
        <span className="channel-status__dot" />
        {t('channels.status.notConfigured')}
      </span>
    );
  }

  if (!status && hasCredentials) {
    return (
      <span className="channel-status channel-status--stopped">
        <span className="channel-status__dot" />
        {t('channels.status.pendingRestart', 'Saved — restart to activate')}
      </span>
    );
  }

  // After early returns, status is guaranteed non-null
  if (!status) return null;

  if (status.connected) {
    return (
      <span className="channel-status channel-status--connected">
        <span className="channel-status__dot" />
        {t('channels.status.connected')}
        {status.displayName && <span className="channel-status__name"> &middot; {status.displayName}</span>}
      </span>
    );
  }

  if (status.configured && status.running) {
    return (
      <span className="channel-status channel-status--disconnected">
        <span className="channel-status__dot" />
        {t('channels.status.disconnected')}
        {status.lastError && <span className="channel-status__error"> &middot; {status.lastError}</span>}
      </span>
    );
  }

  return (
    <span className="channel-status channel-status--stopped">
      <span className="channel-status__dot" />
      {status.configured ? t('channels.status.stopped') : t('channels.status.notConfigured')}
    </span>
  );
}
