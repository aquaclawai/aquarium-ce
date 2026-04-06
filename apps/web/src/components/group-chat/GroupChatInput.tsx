import { useRef, type FormEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isImageMime, FILE_INPUT_ACCEPT } from '@aquarium/shared';
import './group-chat.css';

export interface LocalAttachment {
  id: string;
  type: string;
  data: string;
  preview: string;
  name: string;
}

export interface GroupChatInputProps {
  chat: { members: { id: string; displayName: string }[] } | null;
  inputValue: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent) => void;
  sending: boolean;
  gcAttachments: LocalAttachment[];
  onRemoveAttachment: (id: string) => void;
  onProcessFiles: (files: FileList | null) => void;
  showMentionDropdown: boolean;
  mentionFilter: string;
  onMentionSelect: (displayName: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function getDocumentTypeLabel(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'XLS';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

export function GroupChatInput({
  chat,
  inputValue,
  onInputChange,
  onSubmit,
  sending,
  gcAttachments,
  onRemoveAttachment,
  onProcessFiles,
  showMentionDropdown,
  mentionFilter,
  onMentionSelect,
  onPaste,
  onDrop,
  inputRef,
}: GroupChatInputProps) {
  const { t } = useTranslation();
  const gcFileInputRef = useRef<HTMLInputElement>(null);

  const filteredMembers = chat?.members.filter(m =>
    m.displayName.toLowerCase().includes(mentionFilter)
  ) ?? [];

  return (
    <div
      className="gc-input-area"
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
    >
      {showMentionDropdown && filteredMembers.length > 0 && (
        <div className="gc-mention-dropdown">
          {filteredMembers.map(member => (
            <div
              key={member.id}
              onClick={() => onMentionSelect(member.displayName)}
              className="gc-mention-item"
            >
              {member.displayName}
            </div>
          ))}
        </div>
      )}

      {gcAttachments.length > 0 && (
        <div className="gc-attachment-preview">
          {gcAttachments.map(a => (
            <div key={a.id} className="gc-attachment-thumb">
              {isImageMime(a.type) ? (
                <img
                  src={a.preview}
                  alt={a.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%', height: '100%', borderRadius: '4px',
                    background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '2px', padding: '4px', overflow: 'hidden',
                    fontSize: '0.55rem', color: 'var(--color-text-secondary)', textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{getDocumentTypeLabel(a.type)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{a.name}</span>
                </div>
              )}
              <button
                onClick={() => onRemoveAttachment(a.id)}
                title={t('chat.attachments.removeAttachment')}
                className="gc-attachment-remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="gc-input-form">
        <input
          type="file"
          ref={gcFileInputRef}
          onChange={e => onProcessFiles(e.target.files)}
          accept={FILE_INPUT_ACCEPT}
          multiple
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="gc-attach-btn"
          onClick={() => gcFileInputRef.current?.click()}
          title={t('chat.attachments.attachFile')}
          disabled={sending}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <label htmlFor="chat-message-input" className="visually-hidden">Message</label>
        <input
          ref={inputRef}
          id="chat-message-input"
          type="text"
          value={inputValue}
          onChange={onInputChange}
          placeholder={t('groupChat.detail.messagePlaceholder')}
          className="gc-input-field"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || (!inputValue.trim() && gcAttachments.length === 0)}
          className="gc-send-btn"
        >
          {t('common.buttons.send')}
        </button>
      </form>
    </div>
  );
}
