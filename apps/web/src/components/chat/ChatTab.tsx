import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../../context/WebSocketContext.js';
import { rpc } from '../../utils/rpc.js';
import { api } from '../../api.js';
import { MessageRenderer } from './MessageRenderer.js';
import { ChatErrorBanner } from './ChatErrorBanner.js';
import { classifyChatError } from './classifyError.js';
import { useInstanceModels } from '../../hooks/useInstanceModels';
import { SessionDrawer } from './SessionDrawer.js';
import type { Instance, WsMessage, ChatErrorCategory } from '@aquarium/shared';
import { isImageMime, ALLOWED_ATTACHMENT_TYPES, MAX_FILE_UPLOAD_SIZE, FILE_INPUT_ACCEPT } from '@aquarium/shared';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';
import '../../pages/AssistantChatPage.css';

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

/** Filter raw history messages: remove tool messages and empty assistant messages. */
function filterHistoryMessages(raw: Array<{ role: string; content: unknown; timestamp?: number }>): ChatMessage[] {
  return raw
    .filter(m => {
      if (m.role === 'user') return true;
      if (m.role === 'tool' || m.role === 'toolResult') return false;
      // Filter out assistant messages with no visible text (only thinking + toolCall)
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const hasText = m.content.some(
          (b: Record<string, unknown>) => b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0,
        );
        if (!hasText) return false;
      }
      return true;
    })
    .map(m => ({
      role: m.role === 'user' ? 'user' as const : 'agent' as const,
      content: m.content,
      timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
    }));
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

const AgentAvatarSvg = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="5.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 5.5V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

interface ChatTabProps {
  instanceId: string;
  instanceStatus: Instance['status'];
  initialSessionKey?: string | null;
  onSessionKeyConsumed?: () => void;
  /** 'tab' = embedded in a page (default), 'page' = standalone full-page layout */
  mode?: 'tab' | 'page';
  /** Instance name shown in page mode topbar */
  instanceName?: string;
  /** Quick suggestions shown on empty chat state in page mode */
  suggestions?: string[];
}

export function ChatTab({ instanceId, instanceStatus, initialSessionKey, onSessionKeyConsumed, mode = 'tab', instanceName, suggestions }: ChatTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isConnected, addHandler, removeHandler, subscribeChatSession, unsubscribeChatSession } = useWebSocket();

  // --- Core chat state ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [retrying, setRetrying] = useState(false);

  // --- Session state ---
  const storageKey = `chat-session-${instanceId}`;
  const [sessionKey, setSessionKey] = useState(() => {
    if (initialSessionKey) return initialSessionKey;
    return localStorage.getItem(storageKey) || `chat-${Date.now()}`;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionRefreshFlag, setSessionRefreshFlag] = useState(0);

  // --- Settings state ---
  const [showSettings, setShowSettings] = useState(false);
  const [sessionModel, setSessionModel] = useState('');
  const [sessionThinking, setSessionThinking] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // --- Attachment state ---
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  // --- Refs ---
  const activeRunIdRef = useRef<string | null>(null);
  const abortedRunIdsRef = useRef<Set<string>>(new Set());
  const imageStoreRef = useRef<Map<number, unknown>>(new Map());
  const chatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const prevConnectedRef = useRef(isConnected);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const streamTextRef = useRef(streamText);
  streamTextRef.current = streamText;

  const isStreaming = streamText !== null || sending;
  const isRunning = instanceStatus === 'running';
  const { models: gatewayModels } = useInstanceModels(instanceId, instanceStatus);

  // --- Effects: session persistence ---
  useEffect(() => { localStorage.setItem(storageKey, sessionKey); }, [storageKey, sessionKey]);
  useEffect(() => () => { if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current); }, []);

  // Consume initialSessionKey on mount
  useEffect(() => {
    if (initialSessionKey && sessionKey === initialSessionKey) {
      onSessionKeyConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle initialSessionKey changes after mount
  useEffect(() => {
    if (initialSessionKey && initialSessionKey !== sessionKey) {
      setSessionKey(initialSessionKey);
      setMessages([]);
      imageStoreRef.current = new Map();
      setStreamText(null);
      activeRunIdRef.current = null;
      setChatError(null);
      initialScrollDone.current = false;
      onSessionKeyConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionKey]);

  // --- Effects: WebSocket subscriptions ---
  useEffect(() => {
    subscribeChatSession(instanceId, sessionKey);
    return () => unsubscribeChatSession(instanceId, sessionKey);
  }, [instanceId, sessionKey, subscribeChatSession, unsubscribeChatSession]);

  // --- Effects: textarea auto-resize ---
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // --- File handling ---
  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (attachments.length + files.length > 5) {
      setChatError({ message: t('chat.attachments.maxReached'), category: 'unknown', timestamp: Date.now() });
      return;
    }
    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setChatError({ message: t('chat.attachments.invalidType'), category: 'unknown', timestamp: Date.now() });
        return;
      }
      const maxSize = isImageMime(file.type) ? 5 * 1024 * 1024 : MAX_FILE_UPLOAD_SIZE;
      if (file.size > maxSize) {
        setChatError({ message: t('chat.attachments.tooLarge'), category: 'unknown', timestamp: Date.now() });
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
    if (e.clipboardData.files.length > 0) { e.preventDefault(); processFiles(e.clipboardData.files); }
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // --- Copy ---
  const handleCopyMessage = useCallback((content: unknown, idx: number) => {
    navigator.clipboard.writeText(extractText(content));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(prev => prev === idx ? null : prev), 2000);
  }, []);

  // --- History loading ---
  const loadHistory = useCallback(async () => {
    if (instanceStatus !== 'running') return;
    try {
      const res = await rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(
        instanceId, 'chat.history', { sessionKey, limit: 50 },
      );
      if (res.messages) {
        const historyMsgs = filterHistoryMessages(res.messages);
        setMessages(() => mergeHistoryPreservingImages(historyMsgs, imageStoreRef.current));
      }
    } catch { /* history may not exist yet */ }
  }, [instanceId, instanceStatus, sessionKey]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // --- Reconnection-aware history reload ---
  useEffect(() => {
    if (isConnected && !prevConnectedRef.current) {
      if (streamTextRef.current !== null || sendingRef.current) {
        setSending(false);
        setStreamText(null);
        activeRunIdRef.current = null;
      }
      loadHistory();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, loadHistory]);

  // --- WebSocket chat event handler ---
  useEffect(() => {
    if (instanceStatus !== 'running') return;
    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== instanceId) return;
      const payload = msg.payload as { event?: string; data?: Record<string, unknown> };
      if (!payload.event || !payload.data) return;
      if (payload.event !== 'chat') return;

      const chatData = payload.data as {
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
    };
    addHandler('instance:gateway_event', handler);
    return () => removeHandler('instance:gateway_event', handler);
  }, [instanceId, instanceStatus, sessionKey, addHandler, removeHandler, loadHistory, t]);

  // --- Session management ---
  const handleNewChat = useCallback((): string => {
    const newKey = `chat-${Date.now()}`;
    if (isStreaming) return newKey;
    setSessionKey(newKey);
    setMessages([]);
    imageStoreRef.current = new Map();
    setStreamText(null);
    initialScrollDone.current = false;
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
    initialScrollDone.current = false;
    activeRunIdRef.current = null;
    setChatError(null);
    if (mode === 'page' && window.innerWidth < 768) setDrawerOpen(false);
    else if (mode === 'tab') setDrawerOpen(false);
  }, [isStreaming, mode]);

  // --- Settings ---
  useEffect(() => {
    if (!showSettings) return;
    rpc<{ sessions?: Array<{ key: string; model?: string; thinkingLevel?: string }> }>(
      instanceId, 'sessions.list', { limit: 50, includeGlobal: true },
    ).then(res => {
      const session = res.sessions?.find(s => s.key === sessionKey);
      if (session) {
        setSessionModel(session.model || '');
        setSessionThinking(session.thinkingLevel || '');
      }
    }).catch(() => {});
  }, [showSettings, instanceId, sessionKey]);

  const handleSaveSettings = useCallback(async () => {
    setSavingSettings(true);
    try {
      await rpc(instanceId, 'sessions.patch', {
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
  }, [instanceId, sessionKey, sessionModel, sessionThinking, t]);

  // --- Scroll management ---
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      messagesContainerRef.current?.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior });
    });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  useEffect(() => {
    if (messages.length > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      scrollToBottom('instant');
      return;
    }
    if (isAtBottom) scrollToBottom('smooth');
  }, [messages, streamText, isAtBottom, scrollToBottom]);

  // --- Send message ---
  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || isStreaming) return;
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
      if (documentAttachments.length > 0) {
        await Promise.all(documentAttachments.map(async (a) => {
          const result = await api.uploadFile(instanceId, a.name, a.data, a.type);
          uploadedPaths.set(a.id, result.path);
        }));
      }

      const payload: Record<string, unknown> = {
        sessionKey,
        message: msg,
        idempotencyKey: runId,
      };

      if (uploadedPaths.size > 0) {
        const fileList = Array.from(uploadedPaths.values()).map(p => `- ${p}`).join('\n');
        payload.message = `[Uploaded files to workspace:\n${fileList}]\n\n${msg}`;
      }

      const imageAttachments = currentAttachments
        .filter(a => isImageMime(a.type))
        .map(a => ({ type: 'image' as const, mimeType: a.type, content: a.data, fileName: a.name }));
      if (imageAttachments.length > 0) payload.attachments = imageAttachments;

      await rpc(instanceId, 'chat.send', payload);
      setSessionRefreshFlag(f => f + 1);

      chatTimeoutRef.current = setTimeout(() => {
        chatTimeoutRef.current = null;
        if (activeRunIdRef.current === runId) {
          setChatError({ message: t('chat.noResponseError'), category: 'timeout', lastUserMessage: msg, timestamp: Date.now() });
          setSending(false); setStreamText(null); activeRunIdRef.current = null;
        }
      }, 60_000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('chat.failedToSend');
      setChatError({ message: errMsg, category: classifyChatError(errMsg), lastUserMessage: msg, timestamp: Date.now() });
      setSending(false); setStreamText(null); activeRunIdRef.current = null;
    }
  }, [input, attachments, isStreaming, instanceId, sessionKey, t]);

  // --- Abort ---
  const handleAbort = useCallback(() => {
    if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
    setSending(false);
    setStreamText(null);
    const runIdToAbort = activeRunIdRef.current;
    activeRunIdRef.current = null;
    if (runIdToAbort) {
      abortedRunIdsRef.current.add(runIdToAbort);
      setTimeout(() => abortedRunIdsRef.current.delete(runIdToAbort), 2000);
    }
    rpc(instanceId, 'chat.abort', runIdToAbort ? { sessionKey, runId: runIdToAbort } : { sessionKey }).catch(() => {});
    loadHistory();
  }, [instanceId, sessionKey, loadHistory]);

  // --- Retry ---
  const handleRetry = useCallback(async () => {
    if (!chatError?.lastUserMessage) return;
    setRetrying(true); setChatError(null);
    try { await sendMessage(chatError.lastUserMessage); } finally { setRetrying(false); }
  }, [chatError, sendMessage]);

  // --- Shared rendered elements ---

  const settingsPanel = (
    <div className={mode === 'page' ? 'achat-settings-panel' : 'chat-settings-panel'}>
      <div className={mode === 'page' ? 'achat-settings-field' : 'chat-settings-field'}>
        <label>{t('chat.sessionSettings.modelLabel')}</label>
        <Input
          type="text"
          value={sessionModel}
          onChange={e => setSessionModel(e.target.value)}
          placeholder={t('chat.sessionSettings.modelPlaceholder')}
          list={`model-suggestions-${instanceId}`}
        />
        <datalist id={`model-suggestions-${instanceId}`}>
          {gatewayModels.map(m => (
            <option key={m.name} value={m.name} label={m.provider ? `${m.provider}/${m.name}${m.usable ? '' : ' (no key)'}` : m.name} />
          ))}
        </datalist>
      </div>
      <div className={mode === 'page' ? 'achat-settings-field' : 'chat-settings-field'}>
        <label>{t('chat.sessionSettings.thinkingLevelLabel')}</label>
        <Select value={sessionThinking || '__default__'} onValueChange={(val) => setSessionThinking(val === '__default__' ? '' : val)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">{t('chat.sessionSettings.thinkingLevels.default')}</SelectItem>
            <SelectItem value="off">{t('chat.sessionSettings.thinkingLevels.off')}</SelectItem>
            <SelectItem value="low">{t('chat.sessionSettings.thinkingLevels.low')}</SelectItem>
            <SelectItem value="medium">{t('chat.sessionSettings.thinkingLevels.medium')}</SelectItem>
            <SelectItem value="high">{t('chat.sessionSettings.thinkingLevels.high')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className={mode === 'page' ? 'achat-settings-actions' : 'chat-settings-actions'}>
        <Button size="sm" className={mode === 'page' ? 'achat-settings-save-btn' : undefined} onClick={handleSaveSettings} disabled={savingSettings}>
          {savingSettings ? t('chat.sessionSettings.saving') : t('chat.sessionSettings.save')}
        </Button>
        <Button variant={mode === 'page' ? 'ghost' : 'secondary'} size="sm" onClick={() => setShowSettings(false)}>{t('common.buttons.cancel')}</Button>
      </div>
    </div>
  );

  const errorBanner = chatError && (
    <ChatErrorBanner
      errorMessage={chatError.message}
      category={chatError.category}
      onRetry={chatError.lastUserMessage ? handleRetry : undefined}
      onDismiss={() => setChatError(null)}
      onNavigate={(path) => navigate(path)}
      onOpenSettings={() => setShowSettings(true)}
      instanceId={instanceId}
      retrying={retrying}
    />
  );

  const scrollToBottomButton = !isAtBottom && (
    <Button
      variant="ghost"
      size="sm"
      className="achat-scroll-bottom-btn"
      onClick={() => scrollToBottom('smooth')}
      aria-label={t('chat.scrollToBottom')}
      title={t('chat.scrollToBottom')}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 3v12M4 10l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Button>
  );

  // ==================== PAGE MODE ====================
  if (mode === 'page') {
    if (!isRunning) {
      return (
        <div className="achat-page">
          <header className="achat-topbar">
            <Button variant="ghost" className="achat-topbar__back" onClick={() => navigate('/assistants')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
            <div className="achat-topbar__avatar">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="3" y="7" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="achat-topbar__info">
              <span className="achat-topbar__name">{instanceName ?? ''}</span>
              <span className="achat-topbar__status">
                {t(`common.status.${instanceStatus}`)}
              </span>
            </div>
          </header>
          <div className="achat-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div className="achat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              <div className="achat-messages">
                <div className="achat-not-running">{t('assistantChat.notRunning')}</div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="achat-page">
        {/* Topbar */}
        <header className="achat-topbar">
          <Button variant="ghost" className="achat-topbar__back" onClick={() => navigate('/assistants')}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <div className="achat-topbar__avatar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="7" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="achat-topbar__info">
            <span className="achat-topbar__name">{instanceName ?? ''}</span>
            <span className="achat-topbar__status">
              <span className="achat-topbar__dot" />
              {`${t('assistantChat.online')} · ${t('assistantChat.alwaysReady')}`}
            </span>
          </div>
          <Button variant="ghost" className="achat-settings-btn" onClick={() => setShowSettings(!showSettings)}>
            {t('chat.settings')}
          </Button>
          <Button
            variant="ghost"
            className={`achat-drawer-toggle${drawerOpen ? ' achat-drawer-toggle--shifted' : ''}`}
            onClick={() => setDrawerOpen(!drawerOpen)}
            title={t('chat.sessionDrawer.toggleSessions')}
            aria-label={t('chat.sessionDrawer.toggleSessions')}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Button>
        </header>

        {showSettings && settingsPanel}

        <div className="achat-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <SessionDrawer
            instanceId={instanceId}
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
            {/* Messages */}
            <div className="achat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
              {messages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={i} className={`achat-msg achat-msg--${isUser ? 'user' : 'agent'}`}>
                    <div className="achat-msg__row">
                      {!isUser && (
                        <div className="achat-msg__avatar"><AgentAvatarSvg /></div>
                      )}
                      <div className="achat-msg__bubble">
                        <MessageRenderer content={msg.content} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="achat-msg-copy-btn"
                      onClick={() => handleCopyMessage(msg.content, i)}
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
                        {formatMessageTime(msg.timestamp)}
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
              {errorBanner}
            </div>

            {scrollToBottomButton}

            {/* Suggestions */}
            {messages.length === 0 && !isStreaming && suggestions && suggestions.length > 0 && (
              <div className="achat-suggestions">
                <div className="achat-suggestions__label">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M8 2L4 8h4l-2 4 6-6H8l2-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('assistantChat.quickSuggestions')}
                </div>
                <div className="achat-suggestions__list">
                  {suggestions.map((s, i) => (
                    <Button key={i} variant="ghost" className="achat-suggestions__item" onClick={() => sendMessage(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Input bar */}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="achat-attachment-remove"
                        onClick={() => removeAttachment(a.id)}
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="achat-input-bar__icon"
                  onClick={loadHistory}
                  disabled={!isRunning}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M16 3v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 9a7 7 0 0 1 12-4.9L16 7M2 15v-4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M16 9a7 7 0 0 1-12 4.9L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Button>
                {isStreaming || sending ? (
                  <Button variant="ghost" size="sm" className="achat-input-bar__send achat-input-bar__send--stop" onClick={handleAbort}>
                    <span className="achat-stop-icon" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="achat-input-bar__send"
                    onClick={() => sendMessage()}
                    disabled={(!input.trim() && attachments.length === 0) || !isRunning}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M2 2l14 7-14 7V10.5l10-1.5-10-1.5V2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Button>
                )}
              </div>
              <div className="achat-disclaimer">{t('assistantChat.disclaimer')}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== TAB MODE (default) ====================
  if (!isRunning) {
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(!drawerOpen)}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('chat.sessionDrawer.toggleSessions')}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="chat-header-sep" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('chat.settings')}</TooltipContent>
          </Tooltip>
        </div>
        <Button variant="outline" size="sm" onClick={handleNewChat} disabled={isStreaming}>
          {t('chat.newChat')}
        </Button>
      </div>
      {showSettings && settingsPanel}
      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {messages.length === 0 && !isStreaming && (
          <div className="chat-empty">{t('chat.emptyState')}</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-message-content">
              <MessageRenderer content={msg.content} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="chat-msg-copy-btn"
              onClick={() => handleCopyMessage(msg.content, i)}
              title={t('chat.copyMessage')}
            >
              {copiedIdx === i ? t('common.buttons.copied') : t('common.buttons.copy')}
            </Button>
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
        {errorBanner}
      </div>
      {scrollToBottomButton}
      <div className="chat-input-area">
      <div
        className="chat-input-row"
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        ref={dropZoneRef}
      >
        <input type="file"
          ref={fileInputRef}
          onChange={e => processFiles(e.target.files)}
          accept={FILE_INPUT_ACCEPT}
          multiple
          style={{ display: 'none' }}
        />

        <Button
          variant="ghost"
          size="icon"
          className="chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title={t('chat.attachments.attachFile')}
          disabled={isStreaming}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </Button>

        <div className="chat-input-wrapper">
           {attachments.length > 0 && (
             <div className="chat-attachments-row">
               {attachments.map(a => (
                 <div key={a.id} className="chat-attachment-thumb">
                   {isImageMime(a.type) ? (
                     <img src={a.preview} alt={a.name} className="chat-attachment-img" />
                   ) : (
                     <div className="chat-attachment-doc">
                        <span className="chat-attachment-doc-type">
                          {getDocumentTypeLabel(a.type)}
                        </span>
                       <span className="chat-attachment-doc-name">
                         {a.name}
                       </span>
                     </div>
                   )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="chat-attachment-remove"
                      onClick={() => removeAttachment(a.id)}
                      title={t('chat.attachments.removeAttachment')}
                   >
                     ×
                   </Button>
                 </div>
               ))}
             </div>
           )}

           <textarea
             ref={textareaRef}
             className="chat-textarea"
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
           />
        </div>

        {isStreaming ? (
          <Button variant="destructive" onClick={handleAbort} className="chat-send-btn danger">{t('common.buttons.stop')}</Button>
        ) : (
          <Button onClick={() => sendMessage()} disabled={(!input.trim() && attachments.length === 0)} className="chat-send-btn">{t('common.buttons.send')}</Button>
        )}
      </div>
      </div>
    </div>
  );
}
