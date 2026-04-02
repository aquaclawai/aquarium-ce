import { useTranslation } from 'react-i18next';
import type { ChatErrorCategory } from '@aquarium/shared';

interface ChatErrorBannerProps {
  errorMessage: string;
  category: ChatErrorCategory;
  onRetry?: () => void;
  onDismiss: () => void;
  onNavigate?: (path: string) => void;
  onOpenSettings?: () => void;
  instanceId?: string;
  retrying?: boolean;
}

function getNavigationTarget(
  category: ChatErrorCategory,
  instanceId?: string,
): { path?: string; i18nKey: string } | null {
  if (!instanceId) return null;
  switch (category) {
    case 'timeout':
    case 'auth':
    case 'quota':
      return { path: `/instances/${instanceId}`, i18nKey: 'chat.error.action.goToCredentials' };
    case 'gateway':
      return { path: `/instances/${instanceId}`, i18nKey: 'chat.error.action.goToOverview' };
    case 'model':
      return { i18nKey: 'chat.error.action.openSettings' };
    default:
      return null;
  }
}

export function ChatErrorBanner({
  errorMessage,
  category,
  onRetry,
  onDismiss,
  onNavigate,
  onOpenSettings,
  instanceId,
  retrying,
}: ChatErrorBannerProps) {
  const { t } = useTranslation();

  const navTarget = getNavigationTarget(category, instanceId);
  const title = t(`chat.error.title.${category}`);
  const description = category === 'unknown'
    ? errorMessage
    : t(`chat.error.description.${category}`);
  const suggestion = t(`chat.error.suggestion.${category}`);

  return (
    <div className="achat-error-banner">
      <div className="achat-error-banner__header">
        <span className="achat-error-banner__title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L1 13h12L7 1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="7" cy="10.5" r="0.5" fill="currentColor" />
          </svg>
          {title}
        </span>
        <button
          className="achat-error-banner__dismiss"
          onClick={onDismiss}
          aria-label={t('chat.error.action.dismiss')}
        >
          &times;
        </button>
      </div>
      <div className="achat-error-banner__body">{description}</div>
      <div className="achat-error-banner__suggestion">{suggestion}</div>
      <div className="achat-error-banner__actions">
        {onRetry && (
          <button
            className="achat-error-banner__retry"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? t('chat.error.action.retrying') : t('chat.error.action.retry')}
          </button>
        )}
        {navTarget && navTarget.path && onNavigate && (
          <button
            className="achat-error-banner__link"
            onClick={() => onNavigate(navTarget.path!)}
          >
            {t(navTarget.i18nKey)}
          </button>
        )}
        {navTarget && !navTarget.path && onOpenSettings && (
          <button
            className="achat-error-banner__link"
            onClick={onOpenSettings}
          >
            {t(navTarget.i18nKey)}
          </button>
        )}
      </div>
    </div>
  );
}
