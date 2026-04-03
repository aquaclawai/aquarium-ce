import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { api } from '../api';
import { rpc } from '../utils/rpc';
import { useWebSocket } from '../context/WebSocketContext';
import { MessageRenderer } from '../components/chat/MessageRenderer';
import { ChatErrorBanner } from '../components/chat/ChatErrorBanner';
import { classifyChatError } from '../components/chat/classifyError';
import { SessionDrawer } from '../components/chat/SessionDrawer';
import { isImageMime, ALLOWED_ATTACHMENT_TYPES, MAX_FILE_UPLOAD_SIZE, FILE_INPUT_ACCEPT } from '@aquarium/shared';
import type { InstancePublic, WsMessage, AgentTypeInfo, ChatErrorCategory } from '@aquarium/shared';
import './MyAssistantsPage.css';

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

interface ChatError {
  message: string;
  category: ChatErrorCategory;
  lastUserMessage?: string;
  timestamp: number;
}

function extractText(content: unknown): string {
  const replyTagRe = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;
  if (typeof content === 'string') return content.replace(replyTagRe, '').trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if ((b.type === 'text' || b.type === 'output_text' || b.type === 'input_text') && typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
    return parts.join('\n').replace(replyTagRe, '').trim();
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text.replace(replyTagRe, '').trim();
    if (typeof c.content === 'string') return c.content.replace(replyTagRe, '').trim();
    if (Array.isArray(c.content)) return extractText(c.content);
  }
  return '';
}

function getDocumentTypeLabel(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'XLS';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

function formatTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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

export function AssistantChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscribe, unsubscribe, addHandler, removeHandler, isConnected, subscribeChatSession, unsubscribeChatSession } = useWebSocket();

  const [instance, setInstance] = useState<InstancePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const activeRunIdRef = useRef<string | null>(null);
  const abortedRunIdsRef = useRef<Set<string>>(new Set());
  const imageStoreRef = useRef<Map<number, unknown>>(new Map());
  const chatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const storageKey = `chat-session-${id}`;
  const [sessionKey, setSessionKey] = useState(() => {
    return localStorage.getItem(storageKey) || `chat-${Date.now()}`;
  });

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionRefreshFlag, setSessionRefreshFlag] = useState(0);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const maxAttachments = 5;

    if (attachments.length + files.length > maxAttachments) {
      setChatError({ message: t('chat.attachments.maxReached'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() });
      return;
    }

    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setChatError({ message: t('chat.attachments.invalidType'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() });
        return;
      }
      const maxSize = isImageMime(file.type) ? 5 * 1024 * 1024 : MAX_FILE_UPLOAD_SIZE;
      if (file.size > maxSize) {
        setChatError({ message: t('chat.attachments.tooLarge'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const base64 = result.split(',')[1];
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          type: file.type,
          data: base64,
          preview: result,
          name: file.name,
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

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }, []);

  // --- Inline session settings ---
  const [showSettings, setShowSettings] = useState(false);
  const [sessionModel, setSessionModel] = useState('');
  const [sessionThinking, setSessionThinking] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [rpcModels, setRpcModels] = useState<string[]>([]);

  useEffect(() => {
    if (instance?.status !== 'running') { setRpcModels([]); return; }
    if (!id) return;
    if (instance.billingMode === 'platform') {
      api.get<{ models: string[] }>('/litellm/models')
        .then(res => setRpcModels(res.models))
        .catch(() => setRpcModels([]));
    } else {
      rpc<{ models?: Array<{ id?: string; name?: string }> }>(id, 'models.list', {})
        .then(res => {
          const ids = (res.models ?? []).map(m => m.id ?? m.name).filter((v): v is string => !!v);
          setRpcModels(ids);
        })
        .catch(() => setRpcModels([]));
    }
  }, [id, instance?.status, instance?.billingMode]);

  const modelSuggestions = rpcModels;

  const isStreaming = streamText !== null || sending;

  useEffect(() => {
    return () => {
      if (chatTimeoutRef.current) {
        clearTimeout(chatTimeoutRef.current);
        chatTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, sessionKey);
  }, [storageKey, sessionKey]);

  useEffect(() => {
    if (!id) return;
    api.get<InstancePublic>(`/instances/${id}`)
      .then(inst => {
        setInstance(inst);
        api.get<AgentTypeInfo>(`/agent-types/${inst.agentType}`)
          .then(agentType => {
            const suggestions = agentType.wizard?.chatSuggestions ?? [];
            setChatSuggestions(suggestions);
          })
          .catch(() => setChatSuggestions([]));
      })
      .catch(() => setInstance(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    subscribe(id);
    return () => unsubscribe(id);
  }, [id, subscribe, unsubscribe]);

  useEffect(() => {
    if (!id) return;
    subscribeChatSession(id, sessionKey);
    return () => unsubscribeChatSession(id, sessionKey);
  }, [id, sessionKey, subscribeChatSession, unsubscribeChatSession]);

  useEffect(() => {
    if (!id) return;
    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== id) return;
      const payload = msg.payload as { status?: string; statusMessage?: string };
      if (payload.status) {
        setInstance(prev => prev ? { ...prev, status: payload.status as InstancePublic['status'], statusMessage: (payload.statusMessage as string) ?? null } : null);
      }
    };
    addHandler('instance:status', handler);
    return () => removeHandler('instance:status', handler);
  }, [id, addHandler, removeHandler]);

  const loadHistory = useCallback(async () => {
    if (!id || instance?.status !== 'running') return;
    try {
      const res = await rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(
        id, 'chat.history', { sessionKey, limit: 50 },
      );
      if (res.messages) {
        const historyMsgs = res.messages
          .filter(m => {
            if (m.role === 'user') return true;
            if (m.role === 'tool' || m.role === 'toolResult') return false;
            return extractText(m.content).length > 0;
          })
          .map(m => ({
            role: m.role === 'user' ? 'user' as const : 'agent' as const,
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
          }));
        setMessages(() => mergeHistoryPreservingImages(historyMsgs, imageStoreRef.current));
      }
    } catch { /* history may not exist yet */ }
  }, [id, instance?.status, sessionKey]);

  useEffect(() => {
    let cancelled = false;
    if (!id || instance?.status !== 'running') return;
    rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(
      id, 'chat.history', { sessionKey, limit: 50 },
    ).then(res => {
      if (cancelled || !res.messages) return;
      const historyMsgs = res.messages
        .filter(m => {
          if (m.role === 'user') return true;
          if (m.role === 'tool') return false;
          return extractText(m.content).length > 0;
        })
        .map(m => ({
          role: m.role === 'user' ? 'user' as const : 'agent' as const,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        }));
      setMessages(() => mergeHistoryPreservingImages(historyMsgs, imageStoreRef.current));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, instance?.status, sessionKey]);

  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (!isConnected || prevConnectedRef.current || !id || instance?.status !== 'running') {
      prevConnectedRef.current = isConnected;
      return;
    }
    prevConnectedRef.current = isConnected;
    let cancelled = false;
    rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(
      id, 'chat.history', { sessionKey, limit: 50 },
    ).then(res => {
      if (cancelled || !res.messages) return;
      const historyMsgs = res.messages
        .filter(m => {
          if (m.role === 'user') return true;
          if (m.role === 'tool') return false;
          return extractText(m.content).length > 0;
        })
        .map(m => ({
          role: m.role === 'user' ? 'user' as const : 'agent' as const,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        }));
      setMessages(() => mergeHistoryPreservingImages(historyMsgs, imageStoreRef.current));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isConnected, id, instance?.status, sessionKey]);

  useEffect(() => {
    if (!id || instance?.status !== 'running') return;
    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== id) return;
      const payload = msg.payload as { event?: string; data?: Record<string, unknown> };
      if (!payload.event || !payload.data) return;
      const { event, data } = payload;
      if (event === 'chat') {
        const chatData = data as {
          runId?: string; sessionKey?: string;
          state?: 'delta' | 'final' | 'aborted' | 'error';
          content?: unknown; message?: unknown; errorMessage?: string;
        };
        // Gateway chat events use unprefixed keys (e.g. "chat-123") while
        // the frontend may hold a prefixed key (e.g. "agent:main:chat-123")
        // from sessions.list. Accept if either matches exactly or one is a
        // suffix of the other.
        const evtKey = chatData.sessionKey ?? '';
        if (evtKey !== sessionKey && !sessionKey.endsWith(evtKey) && !evtKey.endsWith(sessionKey)) return;
        if (chatData.runId && abortedRunIdsRef.current.has(chatData.runId)) return;

        if (chatData.state === 'delta') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          const text = extractText(chatData.content ?? chatData.message);
          if (text) {
            setStreamText(prev => (!prev || text.length >= prev.length) ? text : prev);
          }
        } else if (chatData.state === 'final') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null); activeRunIdRef.current = null; setSending(false);
          loadHistory();
        } else if (chatData.state === 'aborted') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null); activeRunIdRef.current = null; setSending(false);
        } else if (chatData.state === 'error') {
          if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
          setStreamText(null); activeRunIdRef.current = null; setSending(false);
          const errMsg = chatData.errorMessage ?? t('chat.chatError');
          setChatError({ message: errMsg, category: classifyChatError(errMsg), timestamp: Date.now() });
        }
      }
    };
    addHandler('instance:gateway_event', handler);
    return () => removeHandler('instance:gateway_event', handler);
  }, [id, instance?.status, sessionKey, addHandler, removeHandler, loadHistory, t]);

  const handleNewChat = useCallback((): string => {
    const newKey = `chat-${Date.now()}`;
    if (isStreaming) return newKey;
    setSessionKey(newKey);
    setMessages([]);
    imageStoreRef.current = new Map();
    setStreamText(null);
    activeRunIdRef.current = null;
    setChatError(null);
    return newKey;
  }, [isStreaming]);

  const handleSelectSession = useCallback((key: string) => {
    if (isStreaming) return;
    setSessionKey(key);
    setMessages([]);
    imageStoreRef.current = new Map();
    setStreamText(null);
    activeRunIdRef.current = null;
    setChatError(null);
    if (window.innerWidth < 768) setDrawerOpen(false);
  }, [isStreaming]);

  const handleCopyMessage = useCallback((content: unknown, idx: number) => {
    const text = extractText(content);
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(prev => prev === idx ? null : prev), 2000);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    if (!id) return;
    rpc<{ sessions?: Array<{ key: string; model?: string; thinkingLevel?: string }> }>(
      id, 'sessions.list', { limit: 50, includeGlobal: true }
    ).then(res => {
      const session = res.sessions?.find(s => s.key === sessionKey);
      if (session) {
        setSessionModel(session.model || '');
        setSessionThinking(session.thinkingLevel || '');
      }
    }).catch(() => {});
  }, [showSettings, id, sessionKey]);

  const handleSaveSettings = async () => {
    if (!id) return;
    setSavingSettings(true);
    try {
      await rpc(id, 'sessions.patch', {
        key: sessionKey,
        model: sessionModel || null,
        thinkingLevel: sessionThinking || null,
      });
      setShowSettings(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('chat.failedToUpdateSettings');
      setChatError({ message: errMsg, category: classifyChatError(errMsg), timestamp: Date.now() });
    } finally {
      setSavingSettings(false);
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || isStreaming || !id) return;
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);
    setChatError(null);

    let content: unknown = msg;
    if (currentAttachments.length > 0) {
      const parts: unknown[] = [];
      if (msg) parts.push({ type: 'text', text: msg });
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

    setMessages(prev => {
      if (contentHasImages(content)) {
        const userIdx = prev.filter(m => m.role === 'user').length;
        imageStoreRef.current.set(userIdx, content);
      }
      return [...prev, { role: 'user', content, timestamp: new Date().toISOString() }];
    });
    setSending(true);
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setStreamText('');
    try {
      const documentAttachments = currentAttachments.filter(a => !isImageMime(a.type));
      const uploadedPaths = new Map<string, string>();

      if (documentAttachments.length > 0 && id) {
        await Promise.all(documentAttachments.map(async (a) => {
          const result = await api.uploadFile(id, a.name, a.data, a.type);
          uploadedPaths.set(a.id, result.path);
        }));
      }

      const payload: Record<string, unknown> = { sessionKey, message: msg, idempotencyKey: runId };

      if (uploadedPaths.size > 0) {
        const fileList = Array.from(uploadedPaths.values())
          .map(p => `- ${p}`)
          .join('\n');
        payload.message = `[Uploaded files to workspace:\n${fileList}]\n\n${msg}`;
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
      await rpc(id, 'chat.send', payload);
      setSessionRefreshFlag(f => f + 1);
      chatTimeoutRef.current = setTimeout(() => {
        chatTimeoutRef.current = null;
        if (activeRunIdRef.current === runId) {
          setChatError({ message: t('chat.noResponseError'), category: 'timeout' as ChatErrorCategory, lastUserMessage: msg, timestamp: Date.now() });
          setSending(false); setStreamText(null); activeRunIdRef.current = null;
        }
      }, 60_000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('chat.failedToSend');
      setChatError({ message: errMsg, category: classifyChatError(errMsg), lastUserMessage: msg, timestamp: Date.now() });
      setSending(false); setStreamText(null); activeRunIdRef.current = null;
    }
  };

  const handleAbort = useCallback(() => {
    if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
    setSending(false); setStreamText(null);
    const runIdToAbort = activeRunIdRef.current;
    activeRunIdRef.current = null;
    if (runIdToAbort) {
      abortedRunIdsRef.current.add(runIdToAbort);
      setTimeout(() => abortedRunIdsRef.current.delete(runIdToAbort), 2000);
    }
    if (id) {
      const abortParams = runIdToAbort ? { sessionKey, runId: runIdToAbort } : { sessionKey };
      rpc(id, 'chat.abort', abortParams).catch(() => {});
    }
    loadHistory();
  }, [id, sessionKey, loadHistory]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  // --- Scroll management ---
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 60;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom('smooth');
  }, [messages, streamText, isAtBottom, scrollToBottom]);

  // --- Retry handler ---
  const handleRetry = useCallback(async () => {
    if (!chatError?.lastUserMessage) return;
    setRetrying(true);
    setChatError(null);
    try {
      await sendMessage(chatError.lastUserMessage);
    } finally {
      setRetrying(false);
    }
  }, [chatError, sendMessage]);

  const defaultSuggestions = [
    t('assistantChat.suggestion1'),
    t('assistantChat.suggestion2'),
    t('assistantChat.suggestion3'),
    t('assistantChat.suggestion4'),
  ];
  const suggestions = chatSuggestions.length > 0 ? chatSuggestions : defaultSuggestions;

  if (loading) return <div className="achat-page"><div className="achat-loading">{t('common.labels.loading')}</div></div>;
  if (!instance) return <div className="achat-page"><div className="achat-loading">{t('instance.notFound')}</div></div>;

  const isRunning = instance.status === 'running';

  return (
    <div className="achat-page">
      <header className="achat-topbar">
        <button className="achat-topbar__back" onClick={() => navigate('/assistants')}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="achat-topbar__avatar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="7" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </div>
        <div className="achat-topbar__info">
          <span className="achat-topbar__name">{instance.name}</span>
          <span className="achat-topbar__status">
            {isRunning && <span className="achat-topbar__dot" />}
            {isRunning
              ? `${t('assistantChat.online')} · ${t('assistantChat.alwaysReady')}`
              : t(`common.status.${instance.status}`)}
          </span>
        </div>
        <button className="achat-settings-btn" onClick={() => setShowSettings(!showSettings)}>
          {t('chat.settings')}
        </button>
        <button className={`achat-drawer-toggle${drawerOpen ? ' achat-drawer-toggle--shifted' : ''}`} onClick={() => setDrawerOpen(!drawerOpen)} title={t('chat.sessionDrawer.toggleSessions')} aria-label={t('chat.sessionDrawer.toggleSessions')}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </header>

      {showSettings && (
        <div className="achat-settings-panel">
          <div className="achat-settings-field">
            <label>{t('chat.sessionSettings.modelLabel')}</label>
            <input
              type="text"
              value={sessionModel}
              onChange={e => setSessionModel(e.target.value)}
              placeholder={t('chat.sessionSettings.modelPlaceholder')}
              list="achat-model-suggestions"
            />
            <datalist id="achat-model-suggestions">
              {modelSuggestions.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="achat-settings-field">
            <label>{t('chat.sessionSettings.thinkingLevelLabel')}</label>
            <select value={sessionThinking} onChange={e => setSessionThinking(e.target.value)}>
              <option value="">{t('chat.sessionSettings.thinkingLevels.default')}</option>
              <option value="off">{t('chat.sessionSettings.thinkingLevels.off')}</option>
              <option value="low">{t('chat.sessionSettings.thinkingLevels.low')}</option>
              <option value="medium">{t('chat.sessionSettings.thinkingLevels.medium')}</option>
              <option value="high">{t('chat.sessionSettings.thinkingLevels.high')}</option>
            </select>
          </div>
          <div className="achat-settings-actions">
            <button className="achat-settings-save-btn" onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? t('chat.sessionSettings.saving') : t('chat.sessionSettings.save')}
            </button>
            <button onClick={() => setShowSettings(false)}>{t('common.buttons.cancel')}</button>
          </div>
        </div>
      )}

      <div className="achat-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <SessionDrawer
          instanceId={id!}
          currentSessionKey={sessionKey}
          isOpen={drawerOpen}
          isStreaming={isStreaming}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onClose={() => setDrawerOpen(false)}
          refreshFlag={sessionRefreshFlag}
          mode="sidebar"
        />
        <div className="achat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

      <div className="achat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {!isRunning && (
          <div className="achat-not-running">{t('assistantChat.notRunning')}</div>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className={`achat-msg achat-msg--${isUser ? 'user' : 'agent'}`}>
              <div className="achat-msg__row">
                {!isUser && <div className="achat-msg__avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5.5V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></div>}
                <div className="achat-msg__bubble">
                  <MessageRenderer content={msg.content} />
                </div>
              </div>
              <button
                className="achat-msg-copy-btn"
                onClick={() => handleCopyMessage(msg.content, i)}
                title={copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
                aria-label={copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
              >
                {copiedIdx === i
                  ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M5 10.5H4.5A1 1 0 0 1 3.5 9.5V4A1 1 0 0 1 4.5 3H10a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                }
              </button>
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
              <div className="achat-msg__avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5.5V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></div>
              <div className="achat-msg__bubble achat-msg__bubble--streaming">
                {streamText ? <MessageRenderer content={streamText} isStreaming /> : <span className="spinner" />}
              </div>
            </div>
          </div>
        )}
        {sending && streamText === null && (
          <div className="achat-msg achat-msg--agent">
            <div className="achat-msg__row">
              <div className="achat-msg__avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5.5V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></div>
              <div className="achat-msg__bubble"><span className="spinner" /></div>
            </div>
          </div>
        )}
        {chatError && (
          <ChatErrorBanner
            errorMessage={chatError.message}
            category={chatError.category}
            onRetry={chatError.lastUserMessage ? handleRetry : undefined}
            onDismiss={() => setChatError(null)}
            onNavigate={(path) => navigate(path)}
            onOpenSettings={() => setShowSettings(true)}
            instanceId={id}
            retrying={retrying}
          />
        )}
      </div>

      {!isAtBottom && (
        <button className="achat-scroll-bottom-btn" onClick={() => scrollToBottom('smooth')} aria-label={t('chat.scrollToBottom')} title={t('chat.scrollToBottom')}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M4 10l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}

      {isRunning && messages.length === 0 && !isStreaming && (
        <div className="achat-suggestions">
          <div className="achat-suggestions__label">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8 2L4 8h4l-2 4 6-6H8l2-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('assistantChat.quickSuggestions')}
          </div>
          <div className="achat-suggestions__list">
            {suggestions.map((s, i) => (
              <button key={i} className="achat-suggestions__item" onClick={() => sendMessage(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="achat-input-bar" onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={e => processFiles(e.target.files)}
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
                <button className="achat-attachment-remove" onClick={() => removeAttachment(a.id)} aria-label={t('chat.attachments.removeAttachment')}>×</button>
                <span className="achat-attachment-name">{a.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="achat-input-bar__row">
          <button
            className={`achat-input-bar__icon${isStreaming || !isRunning ? ' achat-input-bar__icon--disabled' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || !isRunning}
            title={t('chat.attachments.attachFile')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <textarea
            ref={textareaRef}
            className="achat-input-bar__textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isStreaming) handleAbort();
                else sendMessage();
              }
            }}
            placeholder={t('assistantChat.inputPlaceholder')}
            disabled={!isRunning || isStreaming}
            rows={1}
          />
          <button className="achat-input-bar__icon" onClick={() => loadHistory()} disabled={!isRunning}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 3v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 9a7 7 0 0 1 12-4.9L16 7M2 15v-4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 9a7 7 0 0 1-12 4.9L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {isStreaming ? (
            <button className="achat-input-bar__send achat-input-bar__send--stop" onClick={handleAbort}>
              <span className="achat-stop-icon" />
            </button>
          ) : (
            <button className="achat-input-bar__send" onClick={() => sendMessage()} disabled={(!input.trim() && attachments.length === 0) || !isRunning}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 7-14 7V10.5l10-1.5-10-1.5V2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
        <div className="achat-disclaimer">{t('assistantChat.disclaimer')}</div>
      </div>
        </div>
      </div>
    </div>
  );
}
