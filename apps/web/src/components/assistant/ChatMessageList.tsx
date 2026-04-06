import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InstancePublic } from '@aquarium/shared';
import { MessageRenderer } from '../chat/MessageRenderer';
import { ChatErrorBanner } from '../chat/ChatErrorBanner';
import { Button } from '@/components/ui';
import type { ChatMessage, ChatError } from './useChatSession';
import { formatTime } from './useChatSession';
import '../../pages/AssistantChatPage.css';
import '../../pages/MyAssistantsPage.css';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  streamText: string | null;
  isStreaming: boolean;
  sending: boolean;
  chatError: ChatError | null;
  onDismissError: () => void;
  onRetry: () => void;
  retrying: boolean;
  isAtBottom: boolean;
  onScrollToBottom: (behavior: ScrollBehavior) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  instance: InstancePublic | null;
  copiedIdx: number | null;
  onCopyMessage: (content: unknown, idx: number) => void;
  onSuggestionClick: (text: string) => void;
  onMessagesScroll: () => void;
  suggestions: string[];
  onOpenSettings: () => void;
}

const AgentAvatarSvg = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="5.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 5.5V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export function ChatMessageList({
  messages,
  streamText,
  isStreaming,
  sending,
  chatError,
  onDismissError,
  onRetry,
  retrying,
  isAtBottom,
  onScrollToBottom,
  messagesContainerRef,
  instance,
  copiedIdx,
  onCopyMessage,
  onSuggestionClick,
  onMessagesScroll,
  suggestions,
  onOpenSettings,
}: ChatMessageListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isRunning = instance?.status === 'running';

  return (
    <>
      <div className="achat-messages" ref={messagesContainerRef} onScroll={onMessagesScroll}>
        {!isRunning && (
          <div className="achat-not-running">{t('assistantChat.notRunning')}</div>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className={`achat-msg achat-msg--${isUser ? 'user' : 'agent'}`}>
              <div className="achat-msg__row">
                {!isUser && (
                  <div className="achat-msg__avatar">
                    <AgentAvatarSvg />
                  </div>
                )}
                <div className="achat-msg__bubble">
                  <MessageRenderer content={msg.content} />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="achat-msg-copy-btn"
                onClick={() => onCopyMessage(msg.content, i)}
                title={copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
                aria-label={copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
              >
                {copiedIdx === i
                  ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M5 10.5H4.5A1 1 0 0 1 3.5 9.5V4A1 1 0 0 1 4.5 3H10a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.3" /></svg>
                }
              </Button>
              {msg.timestamp && (
                <div className={`achat-msg__time${isUser ? ' achat-msg__time--right' : ' achat-msg__time--left'}`}>
                  {formatTime(msg.timestamp)}
                </div>
              )}
            </div>
          );
        })}
        {streamText !== null && (
          <div className="achat-msg achat-msg--agent">
            <div className="achat-msg__row">
              <div className="achat-msg__avatar"><AgentAvatarSvg /></div>
              <div className="achat-msg__bubble achat-msg__bubble--streaming">
                {streamText ? <MessageRenderer content={streamText} isStreaming /> : <span className="spinner" />}
              </div>
            </div>
          </div>
        )}
        {sending && streamText === null && (
          <div className="achat-msg achat-msg--agent">
            <div className="achat-msg__row">
              <div className="achat-msg__avatar"><AgentAvatarSvg /></div>
              <div className="achat-msg__bubble"><span className="spinner" /></div>
            </div>
          </div>
        )}
        {chatError && (
          <ChatErrorBanner
            errorMessage={chatError.message}
            category={chatError.category}
            onRetry={chatError.lastUserMessage ? onRetry : undefined}
            onDismiss={onDismissError}
            onNavigate={(path) => navigate(path)}
            onOpenSettings={onOpenSettings}
            instanceId={instance?.id}
            retrying={retrying}
          />
        )}
      </div>

      {!isAtBottom && (
        <Button
          variant="ghost"
          size="sm"
          className="achat-scroll-bottom-btn"
          onClick={() => onScrollToBottom('smooth')}
          aria-label={t('chat.scrollToBottom')}
          title={t('chat.scrollToBottom')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3v12M4 10l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      )}

      {isRunning && messages.length === 0 && !isStreaming && (
        <div className="achat-suggestions">
          <div className="achat-suggestions__label">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 2L4 8h4l-2 4 6-6H8l2-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('assistantChat.quickSuggestions')}
          </div>
          <div className="achat-suggestions__list">
            {suggestions.map((s, i) => (
              <Button key={i} variant="ghost" className="achat-suggestions__item" onClick={() => onSuggestionClick(s)}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
