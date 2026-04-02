import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '../../context/WebSocketContext.js';
import { rpc } from '../../utils/rpc.js';
import { api } from '../../api.js';
import { MessageRenderer } from './MessageRenderer.js';
import { MODEL_SUGGESTIONS } from '../../constants/models.js';
import { SessionDrawer } from './SessionDrawer.js';
import type { Instance, WsMessage } from '@aquarium/shared';
import { isImageMime, ALLOWED_ATTACHMENT_TYPES, MAX_FILE_UPLOAD_SIZE, FILE_INPUT_ACCEPT } from '@aquarium/shared';

interface ChatMessage {
  role: 'user' | 'agent' | 'assistant';
  content: unknown;
  timestamp?: string;
}

interface ChatAttachment {
  id: string;
  type: string; // MIME type
  data: string; // Base64 (without prefix)
  preview: string; // Data URL for display
  name: string;
}

/** Returns true if a message content value contains image blocks with actual data. */
function contentHasImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b: Record<string, unknown>) =>
      b && typeof b === 'object' && b.type === 'image' && (b.content || (b as { source?: { data?: string } }).source?.data),
  );
}

/** Gateway doesn't persist image data in chat.history — imageStore (ref) survives React state clears. */
function mergeHistoryPreservingImages(
  historyMsgs: ChatMessage[],
  imageStore: Map<number, unknown>,
): ChatMessage[] {
  if (imageStore.size === 0) return historyMsgs;

  let historyUserIdx = 0;
  return historyMsgs.map(hm => {
    if (hm.role !== 'user') return hm;
    const storedContent = imageStore.get(historyUserIdx);
    historyUserIdx++;
    if (storedContent && !contentHasImages(hm.content)) {
      return { ...hm, content: storedContent };
    }
    return hm;
  });
}

/**
 * Extract visible text from message content (used for streaming delta text extraction).
 * Handles both plain strings and arrays of content blocks
 * (text, thinking, tool_use, tool_result, etc.) matching OpenClaw's approach.
 */
function extractText(content: unknown): string {
  const replyTagRe = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

  if (typeof content === 'string') {
    return content.replace(replyTagRe, '').trim();
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (
        (b.type === 'text' || b.type === 'output_text' || b.type === 'input_text') &&
        typeof b.text === 'string'
      ) {
        parts.push(b.text);
      }
    }
    if (parts.length > 0) {
      return parts.join('\n').replace(replyTagRe, '').trim();
    }
    return '';
  }

  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text.replace(replyTagRe, '').trim();
    if (typeof c.content === 'string') return c.content.replace(replyTagRe, '').trim();
    // Gateway wraps delta content as { role, content: [{type:"text",text:"..."}], timestamp }
    if (Array.isArray(c.content)) return extractText(c.content);
  }

  return '';
}

function formatMessageTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getDocumentTypeLabel(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'XLS';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

interface ChatTabProps {
  instanceId: string;
  instanceStatus: Instance['status'];
  initialSessionKey?: string | null;
  onSessionKeyConsumed?: () => void;
}

export function ChatTab({ instanceId, instanceStatus, initialSessionKey, onSessionKeyConsumed }: ChatTabProps) {
  const { t } = useTranslation();
  const { isConnected, addHandler, removeHandler, subscribeChatSession, unsubscribeChatSession } = useWebSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const abortedRunIdsRef = useRef<Set<string>>(new Set());
  const imageStoreRef = useRef<Map<number, unknown>>(new Map());
  const chatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const storageKey = `chat-session-${instanceId}`;
  const [sessionKey, setSessionKey] = useState(() => {
    if (initialSessionKey) return initialSessionKey;
    return localStorage.getItem(storageKey) || `chat-${Date.now()}`;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, sessionKey);
  }, [storageKey, sessionKey]);

  // Consume initialSessionKey on mount (clear parent's pendingSessionKey)
  useEffect(() => {
    if (initialSessionKey && sessionKey === initialSessionKey) {
      onSessionKeyConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Handle initialSessionKey changes after mount (e.g., user picks another session while ChatTab is mounted)
  useEffect(() => {
    if (initialSessionKey && initialSessionKey !== sessionKey) {
      setSessionKey(initialSessionKey);
      setMessages([]);
      imageStoreRef.current = new Map();
      setStreamText(null);
      activeRunIdRef.current = null;
      setError(null);
      onSessionKeyConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionKey]);

  useEffect(() => {
    subscribeChatSession(instanceId, sessionKey);
    return () => unsubscribeChatSession(instanceId, sessionKey);
  }, [instanceId, sessionKey, subscribeChatSession, unsubscribeChatSession]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionRefreshFlag, setSessionRefreshFlag] = useState(0);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const maxAttachments = 5;

    if (attachments.length + files.length > maxAttachments) {
      setError(t('chat.attachments.maxReached'));
      return;
    }

    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setError(t('chat.attachments.invalidType'));
        return;
      }
      const maxSize = isImageMime(file.type) ? 5 * 1024 * 1024 : MAX_FILE_UPLOAD_SIZE;
      if (file.size > maxSize) {
        setError(t('chat.attachments.tooLarge'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // extract base64 data
        const base64 = result.split(',')[1];
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          type: file.type,
          data: base64,
          preview: result,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, [attachments.length, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      processFiles(e.clipboardData.files);
    }
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);


  const handleCopyMessage = useCallback((content: unknown, idx: number) => {
    const text = extractText(content);
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(prev => prev === idx ? null : prev), 2000);
  }, []);

  const isStreaming = streamText !== null || sending;

  const loadHistory = useCallback(async () => {
    if (instanceStatus !== 'running') return;
    try {
      const res = await rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(
        instanceId, 'chat.history', { sessionKey, limit: 50 },
      );
      if (res.messages) {
        const historyMsgs = res.messages.map(m => ({
          role: m.role === 'user' ? 'user' as const : 'agent' as const,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        }));
        setMessages(() => mergeHistoryPreservingImages(historyMsgs, imageStoreRef.current));
      }
    } catch { /* history may not exist yet */ }
  }, [instanceId, instanceStatus, sessionKey]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Reconnection-aware history reload: detect isConnected false->true transitions
  const prevConnectedRef = useRef(isConnected);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const streamTextRef = useRef(streamText);
  streamTextRef.current = streamText;

  useEffect(() => {
    if (isConnected && !prevConnectedRef.current) {
      // Reconnected after a drop -- reload history to catch any missed messages
      // If streaming was in progress, clear streaming state (stream is lost)
      if (streamTextRef.current !== null || sendingRef.current) {
        setSending(false);
        setStreamText(null);
        activeRunIdRef.current = null;
      }
      loadHistory();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, loadHistory]);

  useEffect(() => {
    if (instanceStatus !== 'running') return;

    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== instanceId) return;
      const payload = msg.payload as { event?: string; data?: Record<string, unknown> };
      if (!payload.event || !payload.data) return;

      const { event, data } = payload;

      if (event === 'chat') {
        const chatData = data as {
          runId?: string;
          sessionKey?: string;
          state?: 'delta' | 'final' | 'aborted' | 'error';
          content?: unknown;
          message?: unknown;
          errorMessage?: string;
        };
        if (chatData.sessionKey !== sessionKey) return;
        if (chatData.runId && abortedRunIdsRef.current.has(chatData.runId)) return;

        if (chatData.state === 'delta') {
          // Clear the no-response timeout — we're receiving data
          if (chatTimeoutRef.current) {
            clearTimeout(chatTimeoutRef.current);
            chatTimeoutRef.current = null;
          }
          const text = extractText(chatData.content ?? chatData.message);
          if (text) {
            setStreamText(prev => {
              // Gateway sends full accumulated text per delta, not incremental.
              // Length check prevents out-of-order WebSocket frames from overwriting newer content.
              if (!prev || text.length >= prev.length) return text;
              return prev;
            });
          }
        } else if (chatData.state === 'final') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null);
          activeRunIdRef.current = null;
          setSending(false);
          loadHistory();
        } else if (chatData.state === 'aborted') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null);
          activeRunIdRef.current = null;
          setSending(false);
        } else if (chatData.state === 'error') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null);
          activeRunIdRef.current = null;
          setSending(false);
          setError(chatData.errorMessage ?? t('chat.chatError'));
        }
      }
    };

    addHandler('instance:gateway_event', handler);
    return () => removeHandler('instance:gateway_event', handler);
  }, [instanceId, instanceStatus, sessionKey, addHandler, removeHandler, loadHistory, t]);

  const handleNewChat = (): string => {
    const newKey = `chat-${Date.now()}`;
    if (isStreaming) return newKey;
    setSessionKey(newKey);
    setMessages([]);
    imageStoreRef.current = new Map();
    setStreamText(null);
    activeRunIdRef.current = null;
    setError(null);
    return newKey;
  };

  const handleSelectSession = useCallback((key: string) => {
    if (isStreaming) return;
    setSessionKey(key);
    setMessages([]);
    imageStoreRef.current = new Map();
    setStreamText(null);
    activeRunIdRef.current = null;
    setError(null);
    setDrawerOpen(false);
  }, [isStreaming]);

  // --- Inline session settings ---
  const [showSettings, setShowSettings] = useState(false);
  const [sessionModel, setSessionModel] = useState('');
  const [sessionThinking, setSessionThinking] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const allModelSuggestions = Object.values(MODEL_SUGGESTIONS).flat();

  useEffect(() => {
    if (!showSettings) return;
    rpc<{ sessions?: Array<{ key: string; model?: string; thinkingLevel?: string }> }>(
      instanceId, 'sessions.list', { limit: 50, includeGlobal: true }
    ).then(res => {
      const session = res.sessions?.find(s => s.key === sessionKey);
      if (session) {
        setSessionModel(session.model || '');
        setSessionThinking(session.thinkingLevel || '');
      }
    }).catch(() => {});
  }, [showSettings, instanceId, sessionKey]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await rpc(instanceId, 'sessions.patch', {
        key: sessionKey,
        model: sessionModel || null,
        thinkingLevel: sessionThinking || null,
      });
      setShowSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.failedToUpdateSettings'));
    } finally {
      setSavingSettings(false);
    }
  };

  const messagesEndRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);
    setError(null);

    let content: unknown = text;
    if (currentAttachments.length > 0) {
      const parts: unknown[] = [];
      if (text) parts.push({ type: 'text', text });
      currentAttachments.forEach(a => {
        parts.push({
          type: isImageMime(a.type) ? 'image' : 'file',
          mimeType: a.type,
          content: a.data,
          fileName: a.name,
        });
      });
      content = parts;
    }

    const userMsg: ChatMessage = { role: 'user', content, timestamp: new Date().toISOString() };
    setMessages(prev => {
      if (contentHasImages(content)) {
        const userIdx = prev.filter(m => m.role === 'user').length;
        imageStoreRef.current.set(userIdx, content);
      }
      return [...prev, userMsg];
    });
    setSending(true);

    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setStreamText('');

    try {
      const documentAttachments = currentAttachments.filter(a => !isImageMime(a.type));
      const uploadedPaths = new Map<string, string>();

      if (documentAttachments.length > 0) {
        await Promise.all(documentAttachments.map(async (a) => {
          const result = await api.uploadFile(instanceId, a.name, a.data, a.type);
          uploadedPaths.set(a.id, result.path);
        }));
      }

      const payload: Record<string, unknown> = {
        sessionKey,
        message: text,
        idempotencyKey: runId,
      };

      if (uploadedPaths.size > 0) {
        const fileList = Array.from(uploadedPaths.values())
          .map(p => `- ${p}`)
          .join('\n');
        payload.message = `[Uploaded files to workspace:\n${fileList}]\n\n${text}`;
      }

      if (currentAttachments.length > 0) {
        const imageAttachments = currentAttachments
          .filter(a => isImageMime(a.type))
          .map(a => ({
            type: 'image' as const,
            mimeType: a.type,
            content: a.data,
            fileName: a.name,
          }));
        if (imageAttachments.length > 0) {
          payload.attachments = imageAttachments;
        }
      }

      await rpc(instanceId, 'chat.send', payload);
      setSessionRefreshFlag(f => f + 1);

      // Start a no-response timeout — if no chat events arrive within 60s,
      // the persistent WebSocket relay likely isn't connected. Reset UI.
      chatTimeoutRef.current = setTimeout(() => {
        chatTimeoutRef.current = null;
        if (activeRunIdRef.current === runId) {
          setError(t('chat.noResponseError'));
          setSending(false);
          setStreamText(null);
          activeRunIdRef.current = null;
        }
      }, 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.failedToSend'));
      setSending(false);
      setStreamText(null);
      activeRunIdRef.current = null;
    }
  };

  const handleAbort = useCallback(() => {
    // 1. Client-first: immediately clear UI state
    if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
    setSending(false);
    setStreamText(null);
    const runIdToAbort = activeRunIdRef.current;
    activeRunIdRef.current = null;

    // 2. Track aborted runId to ignore late-arriving events
    if (runIdToAbort) {
      abortedRunIdsRef.current.add(runIdToAbort);
      setTimeout(() => abortedRunIdsRef.current.delete(runIdToAbort), 2000);
    }

    // 3. Fire-and-forget: propagate abort to gateway via double-hop
    const abortParams = runIdToAbort
      ? { sessionKey, runId: runIdToAbort }
      : { sessionKey };
    rpc(instanceId, 'chat.abort', abortParams).catch(() => {});

    // 4. Reload history to show whatever the gateway saved
    loadHistory();
  }, [instanceId, sessionKey, loadHistory]);

  if (instanceStatus !== 'running') {
    return <div className="info-message">{t('chat.startRequired')}</div>;
  }

  return (
    <div className="chat-container">
      <SessionDrawer
        instanceId={instanceId}
        currentSessionKey={sessionKey}
        isOpen={drawerOpen}
        isStreaming={isStreaming}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onClose={() => setDrawerOpen(false)}
        refreshFlag={sessionRefreshFlag}
        mode="overlay"
      />
      <div className="chat-header">
        <div className="chat-session-info">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="btn-icon btn-small"
            title={t('chat.sessionDrawer.toggleSessions')}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="btn-icon btn-small"
            title={t('chat.settings')}
          >
            {t('chat.settings')}
          </button>
        </div>
        <button onClick={handleNewChat} disabled={isStreaming} className="btn-secondary btn-small">
          {t('chat.newChat')}
        </button>
      </div>
      {showSettings && (
        <div className="chat-settings-panel">
          <div className="chat-settings-field">
            <label>{t('chat.sessionSettings.modelLabel')}</label>
            <input
              type="text"
              value={sessionModel}
              onChange={e => setSessionModel(e.target.value)}
              placeholder={t('chat.sessionSettings.modelPlaceholder')}
              list="model-suggestions"
            />
            <datalist id="model-suggestions">
              {allModelSuggestions.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="chat-settings-field">
            <label>{t('chat.sessionSettings.thinkingLevelLabel')}</label>
            <select value={sessionThinking} onChange={e => setSessionThinking(e.target.value)}>
              <option value="">{t('chat.sessionSettings.thinkingLevels.default')}</option>
              <option value="off">{t('chat.sessionSettings.thinkingLevels.off')}</option>
              <option value="low">{t('chat.sessionSettings.thinkingLevels.low')}</option>
              <option value="medium">{t('chat.sessionSettings.thinkingLevels.medium')}</option>
              <option value="high">{t('chat.sessionSettings.thinkingLevels.high')}</option>
            </select>
          </div>
          <div className="chat-settings-actions">
            <button onClick={handleSaveSettings} disabled={savingSettings} className="btn-primary btn-small">
              {savingSettings ? t('chat.sessionSettings.saving') : t('chat.sessionSettings.save')}
            </button>
            <button onClick={() => setShowSettings(false)} className="btn-small">{t('common.buttons.cancel')}</button>
          </div>
        </div>
      )}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-empty">{t('chat.emptyState')}</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-message-content">
              <MessageRenderer content={msg.content} />
            </div>
            <button
              className="chat-msg-copy-btn"
              onClick={() => handleCopyMessage(msg.content, i)}
              title={t('chat.copyMessage')}
            >
              {copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
            </button>
            {msg.timestamp && (
              <span className="chat-msg-timestamp" title={msg.timestamp}>
                {formatMessageTime(msg.timestamp)}
              </span>
            )}
          </div>
        ))}
        {streamText !== null && (
          <div className="chat-message agent streaming">
            <div className="chat-message-content">
              {streamText
                ? <MessageRenderer content={streamText} isStreaming />
                : <span className="spinner" />
              }
            </div>
          </div>
        )}
        {sending && streamText === null && (
          <div className="chat-message agent">
            <div className="chat-message-content">
              <span className="spinner" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}
      <div 
        className="chat-input-row" 
        style={{ alignItems: 'flex-end' }}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        ref={dropZoneRef}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={e => processFiles(e.target.files)}
          accept={FILE_INPUT_ACCEPT}
          multiple
          style={{ display: 'none' }}
        />
        
        <button 
          className="btn-icon" 
          onClick={() => fileInputRef.current?.click()}
          title={t('chat.attachments.attachFile')}
          disabled={isStreaming}
          style={{ marginRight: '8px', marginBottom: '6px' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
           {attachments.length > 0 && (
             <div style={{ display: 'flex', gap: '8px', padding: '4px 0', overflowX: 'auto' }}>
               {attachments.map(a => (
                 <div key={a.id} style={{ position: 'relative', width: '60px', height: '60px', flexShrink: 0 }}>
                   {isImageMime(a.type) ? (
                     <img src={a.preview} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                   ) : (
                     <div style={{
                       width: '100%', height: '100%', borderRadius: '4px',
                       background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)',
                       display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                       gap: '2px', padding: '4px', overflow: 'hidden',
                        fontSize: '0.55rem', color: 'var(--color-text-secondary)', textAlign: 'center',
                      }}>
                        <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>
                          {getDocumentTypeLabel(a.type)}
                        </span>
                       <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                         {a.name}
                       </span>
                     </div>
                   )}
                    <button 
                      onClick={() => removeAttachment(a.id)}
                      title={t('chat.attachments.removeAttachment')}
                     style={{
                       position: 'absolute', top: -6, right: -6, background: 'var(--surface-color)', 
                       border: '1px solid var(--border-color)', borderRadius: '50%', width: '18px', height: '18px',
                       display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
                       fontSize: '14px', lineHeight: 1
                     }}
                   >
                     ×
                   </button>
                 </div>
               ))}
             </div>
           )}
           
           <textarea
             ref={textareaRef}
             value={input}
             onChange={e => setInput(e.target.value)}
             onKeyDown={e => {
               if (e.key === 'Enter' && !e.shiftKey) {
                 e.preventDefault();
                 sendMessage();
               }
             }}
             placeholder={attachments.length > 0 ? t('chat.inputPlaceholder') : (t('chat.attachments.dropHint') || t('chat.inputPlaceholder'))}
             disabled={isStreaming}
             rows={1}
             style={{
               width: '100%',
               resize: 'none',
               minHeight: '2.5rem',
               maxHeight: '200px',
               fontFamily: 'inherit',
               fontSize: '0.9rem',
               lineHeight: '1.4',
               overflowY: 'auto',
             }}
           />
        </div>

        {isStreaming ? (
          <button onClick={handleAbort} className="danger" style={{ marginLeft: '8px', marginBottom: '2px' }}>{t('common.buttons.stop')}</button>
        ) : (
          <button onClick={sendMessage} disabled={(!input.trim() && attachments.length === 0)} style={{ marginLeft: '8px', marginBottom: '2px' }}>{t('common.buttons.send')}</button>
        )}
      </div>
    </div>
  );
}
