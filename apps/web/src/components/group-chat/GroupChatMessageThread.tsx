import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupChat, GroupChatMessage, DeliveryStatusValue } from '@aquarium/shared';
import { MessageRenderer } from '../chat/MessageRenderer';
import './group-chat.css';

export interface GroupChatMessageThreadProps {
  chat: GroupChat | null;
  messages: GroupChatMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

function getStatusIcon(status: DeliveryStatusValue, t: (key: string) => string): string {
  switch (status) {
    case 'pending': return t('groupChat.delivery.pending');
    case 'delivered': return t('groupChat.delivery.delivered');
    case 'processing': return t('groupChat.delivery.processing');
    case 'completed': return t('groupChat.delivery.completed');
    case 'error': return t('groupChat.delivery.error');
    default: return '';
  }
}

function resolveSenderInfo(
  msg: GroupChatMessage,
  chat: GroupChat | null,
  t: (key: string) => string
) {
  const isOwner = msg.senderType === 'user';
  const isSystem = msg.senderType === 'system';
  const member = chat?.members.find(m =>
    msg.senderInstanceId ? m.instanceId === msg.senderInstanceId : m.userId === msg.senderUserId
  );
  const isHumanMember = member?.isHuman && !isOwner;

  let variant: 'user' | 'bot' | 'human' | 'system';
  if (isOwner) variant = 'user';
  else if (isSystem) variant = 'system';
  else if (isHumanMember) variant = 'human';
  else variant = 'bot';

  const senderName = isOwner
    ? (msg.senderDisplayName || t('groupChat.detail.senderYou'))
    : (member?.displayName || msg.senderDisplayName || t('groupChat.detail.senderUnknown'));

  return { variant, senderName, role: member?.role };
}

export function GroupChatMessageThread({
  chat,
  messages,
  hasMore,
  loadingMore,
  onLoadMore,
  messagesContainerRef,
  messagesEndRef,
}: GroupChatMessageThreadProps) {
  const { t } = useTranslation();

  return (
    <div className="gc-messages" ref={messagesContainerRef}>
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('groupChat.detail.loadingMessages') : t('groupChat.detail.loadOlderMessages')}
          </button>
        </div>
      )}
      {messages.map(msg => {
        const { variant, senderName, role } = resolveSenderInfo(msg, chat, t);

        return (
          <div key={msg.id} className={`gc-msg-wrapper gc-msg-wrapper--${variant}`}>
            <div className={`gc-msg-bubble gc-msg-bubble--${variant}`}>
              {variant !== 'system' && (
                <div className="gc-msg-header">
                  <span className="gc-msg-sender">{senderName}</span>
                  {variant !== 'user' && (
                    <span className={`gc-msg-type-badge gc-msg-type-badge--${variant === 'human' ? 'human' : 'bot'}`}>
                      {variant === 'human' ? t('groupChat.detail.typeBadgeHuman') : t('groupChat.detail.typeBadgeBot')}
                    </span>
                  )}
                  {role && <span className="gc-msg-role">{role}</span>}
                </div>
              )}
              <div className="gc-msg-content"><MessageRenderer content={msg.content} /></div>
            </div>

            {msg.deliveryStatus && msg.deliveryStatus.length > 0 && (
              <div className="gc-delivery">
                {msg.deliveryStatus.map(status => (
                  <span
                    key={status.id}
                    className={`gc-delivery-item gc-delivery-item--${status.status}`}
                    title={`${status.targetDisplayName}: ${status.status}${status.errorMessage ? ` - ${status.errorMessage}` : ''}${status.retryCount > 0 ? ` (retry ${status.retryCount}/${status.maxRetries})` : ''}`}
                  >
                    <span>{status.targetDisplayName}</span>
                    <span className="gc-delivery-icon">{getStatusIcon(status.status, t)}</span>
                    {status.retryCount > 0 && status.status === 'error' && (
                      <span className="gc-retry-progress">
                        <span className="gc-retry-bar">
                          {Array.from({ length: status.maxRetries }, (_, i) => (
                            <span
                              key={i}
                              className={`gc-retry-dot ${i < status.retryCount ? 'gc-retry-dot--used' : ''}`}
                            />
                          ))}
                        </span>
                        <span className="gc-retry-label">{status.retryCount}/{status.maxRetries}</span>
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
