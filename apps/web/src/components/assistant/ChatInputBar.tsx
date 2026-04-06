import { useTranslation } from 'react-i18next';
import type { InstancePublic } from '@aquarium/shared';
import { isImageMime, FILE_INPUT_ACCEPT } from '@aquarium/shared';
import { Button } from '@/components/ui';
import type { ChatAttachment } from './useChatSession';
import { getDocumentTypeLabel } from './useChatSession';
import '../../pages/AssistantChatPage.css';

export interface ChatInputBarProps {
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  sending: boolean;
  isStreaming: boolean;
  attachments: ChatAttachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelect: (files: FileList | null) => void;
  onLoadHistory: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  instance: InstancePublic | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function ChatInputBar({
  inputValue,
  onInputChange,
  onSend,
  onAbort,
  sending,
  isStreaming,
  attachments,
  onRemoveAttachment,
  onFileSelect,
  onLoadHistory,
  onPaste,
  onDrop,
  instance,
  textareaRef,
  fileInputRef,
}: ChatInputBarProps) {
  const { t } = useTranslation();
  const isRunning = instance?.status === 'running';

  return (
    <div className="achat-input-bar" onPaste={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={e => onFileSelect(e.target.files)}
        accept={FILE_INPUT_ACCEPT}
        multiple
        style={{ display: 'none' }}
      />
      {attachments.length > 0 && (
        <div className="achat-attachment-preview">
          {attachments.map(a => (
            <div key={a.id} className="achat-attachment-thumb">
              {isImageMime(a.type) ? (
                <img src={a.preview} alt={a.name} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', borderRadius: '4px',
                  background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px', padding: '4px', overflow: 'hidden',
                  fontSize: '0.55rem', color: 'var(--color-text-secondary)', textAlign: 'center',
                }}>
                  <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{getDocumentTypeLabel(a.type)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{a.name}</span>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="achat-attachment-remove"
                onClick={() => onRemoveAttachment(a.id)}
                aria-label={t('chat.attachments.removeAttachment')}
              >
                &times;
              </Button>
              <span className="achat-attachment-name">{a.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="achat-input-bar__row">
        <Button
          variant="ghost"
          size="sm"
          className={`achat-input-bar__icon${isStreaming || !isRunning ? ' achat-input-bar__icon--disabled' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || !isRunning}
          title={t('chat.attachments.attachFile')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </Button>
        <textarea
          ref={textareaRef}
          className="achat-input-bar__textarea"
          value={inputValue}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (isStreaming) onAbort();
              else onSend();
            }
          }}
          placeholder={t('assistantChat.inputPlaceholder')}
          disabled={!isRunning || isStreaming}
          rows={1}
        />
        <Button
          variant="ghost"
          size="sm"
          className="achat-input-bar__icon"
          onClick={onLoadHistory}
          disabled={!isRunning}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M16 3v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 9a7 7 0 0 1 12-4.9L16 7M2 15v-4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 9a7 7 0 0 1-12 4.9L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        {isStreaming || sending ? (
          <Button variant="ghost" size="sm" className="achat-input-bar__send achat-input-bar__send--stop" onClick={onAbort}>
            <span className="achat-stop-icon" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="achat-input-bar__send"
            onClick={onSend}
            disabled={(!inputValue.trim() && attachments.length === 0) || !isRunning}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 7-14 7V10.5l10-1.5-10-1.5V2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        )}
      </div>
      <div className="achat-disclaimer">{t('assistantChat.disclaimer')}</div>
    </div>
  );
}
