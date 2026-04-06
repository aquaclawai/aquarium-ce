import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { rpc } from '../../utils/rpc';
import { useWebSocket } from '../../context/WebSocketContext';
import { classifyChatError } from '../chat/classifyError';
import { isImageMime, ALLOWED_ATTACHMENT_TYPES, MAX_FILE_UPLOAD_SIZE } from '@aquarium/shared';
import type { InstancePublic, WsMessage, AgentTypeInfo, ChatErrorCategory } from '@aquarium/shared';

export interface ChatMessage {
  role: 'user' | 'agent' | 'assistant';
  content: unknown;
  timestamp?: string;
}

export interface ChatAttachment {
  id: string;
  type: string;
  data: string;
  preview: string;
  name: string;
}

export interface ChatError {
  message: string;
  category: ChatErrorCategory;
  lastUserMessage?: string;
  timestamp: number;
}

export function getDocumentTypeLabel(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'XLS';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

export function formatTime(isoString?: string): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function extractText(content: unknown): string {
  const re = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;
  if (typeof content === 'string') return content.replace(re, '').trim();
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .filter(b => ['text', 'output_text', 'input_text'].includes(b.type as string) && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('\n').replace(re, '').trim();
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text.replace(re, '').trim();
    if (typeof c.content === 'string') return c.content.replace(re, '').trim();
    if (Array.isArray(c.content)) return extractText(c.content);
  }
  return '';
}

function contentHasImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b: Record<string, unknown>) =>
      b && typeof b === 'object' && b.type === 'image' &&
      (b.content || (b as { source?: { data?: string } }).source?.data),
  );
}

function mergeHistoryPreservingImages(msgs: ChatMessage[], store: Map<number, unknown>): ChatMessage[] {
  if (store.size === 0) return msgs;
  let userIdx = 0;
  return msgs.map(m => {
    if (m.role !== 'user') return m;
    const stored = store.get(userIdx++);
    return stored && !contentHasImages(m.content) ? { ...m, content: stored } : m;
  });
}

function toHistoryMsgs(raw: Array<{ role: string; content: unknown; timestamp?: number }>): ChatMessage[] {
  return raw.map(m => ({
    role: m.role === 'user' ? 'user' as const : 'agent' as const,
    content: m.content,
    timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
  }));
}

export interface UseChatSessionReturn {
  instance: InstancePublic | null;
  loading: boolean;
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  streamText: string | null;
  chatError: ChatError | null;
  setChatError: (err: ChatError | null) => void;
  isStreaming: boolean;
  isAtBottom: boolean;
  retrying: boolean;
  copiedIdx: number | null;
  attachments: ChatAttachment[];
  sessionKey: string;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  sessionRefreshFlag: number;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  sessionModel: string;
  setSessionModel: (v: string) => void;
  sessionThinking: string;
  setSessionThinking: (v: string) => void;
  savingSettings: boolean;
  modelSuggestions: string[];
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  sendMessage: (text?: string) => Promise<void>;
  handleAbort: () => void;
  loadHistory: () => Promise<void>;
  handleNewChat: () => string;
  handleSelectSession: (key: string) => void;
  handleCopyMessage: (content: unknown, idx: number) => void;
  processFiles: (files: FileList | null) => void;
  removeAttachment: (id: string) => void;
  handleSaveSettings: () => Promise<void>;
  handleRetry: () => Promise<void>;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  handleMessagesScroll: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  suggestions: string[];
}

export function useChatSession(instanceId: string | undefined): UseChatSessionReturn {
  const { t } = useTranslation();
  const { subscribe, unsubscribe, addHandler, removeHandler, isConnected, subscribeChatSession, unsubscribeChatSession } = useWebSocket();

  const [instance, setInstance] = useState<InstancePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const storageKey = `chat-session-${instanceId}`;
  const [sessionKey, setSessionKey] = useState(() => localStorage.getItem(storageKey) || `chat-${Date.now()}`);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionRefreshFlag, setSessionRefreshFlag] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionModel, setSessionModel] = useState('');
  const [sessionThinking, setSessionThinking] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [rpcModels, setRpcModels] = useState<string[]>([]);

  const activeRunIdRef = useRef<string | null>(null);
  const abortedRunIdsRef = useRef<Set<string>>(new Set());
  const imageStoreRef = useRef<Map<number, unknown>>(new Map());
  const chatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevConnectedRef = useRef(isConnected);

  const isStreaming = streamText !== null || sending;

  useEffect(() => { localStorage.setItem(storageKey, sessionKey); }, [storageKey, sessionKey]);
  useEffect(() => () => { if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current); }, []);

  useEffect(() => {
    if (!instanceId) return;
    api.get<InstancePublic>(`/instances/${instanceId}`)
      .then(inst => {
        setInstance(inst);
        api.get<AgentTypeInfo>(`/agent-types/${inst.agentType}`)
          .then(at => setChatSuggestions(at.wizard?.chatSuggestions ?? []))
          .catch(() => setChatSuggestions([]));
      })
      .catch(() => setInstance(null))
      .finally(() => setLoading(false));
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    subscribe(instanceId);
    return () => unsubscribe(instanceId);
  }, [instanceId, subscribe, unsubscribe]);

  useEffect(() => {
    if (!instanceId) return;
    subscribeChatSession(instanceId, sessionKey);
    return () => unsubscribeChatSession(instanceId, sessionKey);
  }, [instanceId, sessionKey, subscribeChatSession, unsubscribeChatSession]);

  useEffect(() => {
    if (!instanceId) return;
    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== instanceId) return;
      const p = msg.payload as { status?: string; statusMessage?: string };
      if (p.status) setInstance(prev => prev ? { ...prev, status: p.status as InstancePublic['status'], statusMessage: (p.statusMessage as string) ?? null } : null);
    };
    addHandler('instance:status', handler);
    return () => removeHandler('instance:status', handler);
  }, [instanceId, addHandler, removeHandler]);

  const loadHistory = useCallback(async () => {
    if (!instanceId || instance?.status !== 'running') return;
    try {
      const res = await rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(instanceId, 'chat.history', { sessionKey, limit: 50 });
      if (res.messages) setMessages(() => mergeHistoryPreservingImages(toHistoryMsgs(res.messages!), imageStoreRef.current));
    } catch { /* history may not exist yet */ }
  }, [instanceId, instance?.status, sessionKey]);

  useEffect(() => {
    let cancelled = false;
    if (!instanceId || instance?.status !== 'running') return;
    rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(instanceId, 'chat.history', { sessionKey, limit: 50 })
      .then(res => { if (!cancelled && res.messages) setMessages(() => mergeHistoryPreservingImages(toHistoryMsgs(res.messages!), imageStoreRef.current)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [instanceId, instance?.status, sessionKey]);

  useEffect(() => {
    if (!isConnected || prevConnectedRef.current || !instanceId || instance?.status !== 'running') {
      prevConnectedRef.current = isConnected; return;
    }
    prevConnectedRef.current = isConnected;
    let cancelled = false;
    rpc<{ messages?: Array<{ role: string; content: unknown; timestamp?: number }> }>(instanceId, 'chat.history', { sessionKey, limit: 50 })
      .then(res => { if (!cancelled && res.messages) setMessages(() => mergeHistoryPreservingImages(toHistoryMsgs(res.messages!), imageStoreRef.current)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isConnected, instanceId, instance?.status, sessionKey]);

  useEffect(() => {
    if (!instanceId || instance?.status !== 'running') return;
    const handler = (msg: WsMessage) => {
      if (msg.instanceId !== instanceId) return;
      const p = msg.payload as { event?: string; data?: Record<string, unknown> };
      if (!p.event || !p.data || p.event !== 'chat') return;
      const d = p.data as { runId?: string; sessionKey?: string; state?: 'delta' | 'final' | 'aborted' | 'error'; content?: unknown; message?: unknown; errorMessage?: string; };
      const evtKey = d.sessionKey ?? '';
      if (evtKey !== sessionKey && !sessionKey.endsWith(evtKey) && !evtKey.endsWith(sessionKey)) return;
      if (d.runId && abortedRunIdsRef.current.has(d.runId)) return;
      if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
      if (d.state === 'delta') {
        const text = extractText(d.content ?? d.message);
        if (text) setStreamText(prev => (!prev || text.length >= prev.length) ? text : prev);
      } else if (d.state === 'final') {
        setStreamText(null); activeRunIdRef.current = null; setSending(false); loadHistory();
      } else if (d.state === 'aborted') {
        setStreamText(null); activeRunIdRef.current = null; setSending(false);
      } else if (d.state === 'error') {
        setStreamText(null); activeRunIdRef.current = null; setSending(false);
        const errMsg = d.errorMessage ?? t('chat.chatError');
        setChatError({ message: errMsg, category: classifyChatError(errMsg), timestamp: Date.now() });
      }
    };
    addHandler('instance:gateway_event', handler);
    return () => removeHandler('instance:gateway_event', handler);
  }, [instanceId, instance?.status, sessionKey, addHandler, removeHandler, loadHistory, t]);

  useEffect(() => {
    if (instance?.status !== 'running' || !instanceId) { setRpcModels([]); return; }
    if (instance.billingMode === 'platform') {
      api.get<{ models: string[] }>('/litellm/models').then(r => setRpcModels(r.models)).catch(() => setRpcModels([]));
    } else {
      rpc<{ models?: Array<{ id?: string; name?: string }> }>(instanceId, 'models.list', {})
        .then(r => setRpcModels((r.models ?? []).map(m => m.id ?? m.name).filter((v): v is string => !!v)))
        .catch(() => setRpcModels([]));
    }
  }, [instanceId, instance?.status, instance?.billingMode]);

  useEffect(() => {
    if (!showSettings || !instanceId) return;
    rpc<{ sessions?: Array<{ key: string; model?: string; thinkingLevel?: string }> }>(instanceId, 'sessions.list', { limit: 50, includeGlobal: true })
      .then(r => { const s = r.sessions?.find(s => s.key === sessionKey); if (s) { setSessionModel(s.model || ''); setSessionThinking(s.thinkingLevel || ''); } })
      .catch(() => {});
  }, [showSettings, instanceId, sessionKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      messagesContainerRef.current?.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior });
    });
  }, []);

  // Auto-scroll to bottom on initial load (instant) and on new messages (smooth)
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      scrollToBottom('instant');
      return;
    }
    if (isAtBottom) scrollToBottom('smooth');
  }, [messages, streamText, isAtBottom, scrollToBottom]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || !files.length) return;
    if (attachments.length + files.length > 5) {
      setChatError({ message: t('chat.attachments.maxReached'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() }); return;
    }
    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) { setChatError({ message: t('chat.attachments.invalidType'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() }); return; }
      const maxSize = isImageMime(file.type) ? 5 * 1024 * 1024 : MAX_FILE_UPLOAD_SIZE;
      if (file.size > maxSize) { setChatError({ message: t('chat.attachments.tooLarge'), category: 'unknown' as ChatErrorCategory, timestamp: Date.now() }); return; }
      const reader = new FileReader();
      reader.onload = e => {
        const result = e.target?.result as string;
        setAttachments(prev => [...prev, { id: crypto.randomUUID(), type: file.type, data: result.split(',')[1], preview: result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  }, [attachments.length, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => { if (e.clipboardData.files.length > 0) { e.preventDefault(); processFiles(e.clipboardData.files); } }, [processFiles]);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files); }, [processFiles]);
  const removeAttachment = useCallback((id: string) => setAttachments(prev => prev.filter(a => a.id !== id)), []);

  const handleNewChat = useCallback((): string => {
    const newKey = `chat-${Date.now()}`;
    if (isStreaming) return newKey;
    setSessionKey(newKey); setMessages([]); imageStoreRef.current = new Map(); setStreamText(null); activeRunIdRef.current = null; setChatError(null);
    initialScrollDone.current = false;
    return newKey;
  }, [isStreaming]);

  const handleSelectSession = useCallback((key: string) => {
    if (isStreaming) return;
    setSessionKey(key); setMessages([]); imageStoreRef.current = new Map(); setStreamText(null); activeRunIdRef.current = null; setChatError(null);
    initialScrollDone.current = false;
    if (window.innerWidth < 768) setDrawerOpen(false);
  }, [isStreaming]);

  const handleCopyMessage = useCallback((content: unknown, idx: number) => {
    navigator.clipboard.writeText(extractText(content));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(prev => prev === idx ? null : prev), 2000);
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if ((!msg && attachments.length === 0) || isStreaming || !instanceId) return;
    setInput(''); const currentAttachments = [...attachments]; setAttachments([]); setChatError(null);
    let content: unknown = msg;
    if (currentAttachments.length > 0) {
      const parts: unknown[] = [];
      if (msg) parts.push({ type: 'text', text: msg });
      currentAttachments.forEach(a => parts.push({ type: isImageMime(a.type) ? 'image' : 'file', mimeType: a.type, content: a.data, fileName: a.name }));
      content = parts;
    }
    setMessages(prev => {
      if (contentHasImages(content)) imageStoreRef.current.set(prev.filter(m => m.role === 'user').length, content);
      return [...prev, { role: 'user', content, timestamp: new Date().toISOString() }];
    });
    setSending(true); const runId = crypto.randomUUID(); activeRunIdRef.current = runId; setStreamText('');
    try {
      const docs = currentAttachments.filter(a => !isImageMime(a.type));
      const uploadedPaths = new Map<string, string>();
      if (docs.length > 0) await Promise.all(docs.map(async a => { const r = await api.uploadFile(instanceId, a.name, a.data, a.type); uploadedPaths.set(a.id, r.path); }));
      const payload: Record<string, unknown> = { sessionKey, message: msg, idempotencyKey: runId };
      if (uploadedPaths.size > 0) payload.message = `[Uploaded files to workspace:\n${Array.from(uploadedPaths.values()).map(p => `- ${p}`).join('\n')}]\n\n${msg}`;
      const imgs = currentAttachments.filter(a => isImageMime(a.type)).map(a => ({ type: 'image' as const, mimeType: a.type, content: a.data, fileName: a.name }));
      if (imgs.length > 0) payload.attachments = imgs;
      await rpc(instanceId, 'chat.send', payload);
      setSessionRefreshFlag(f => f + 1);
      chatTimeoutRef.current = setTimeout(() => {
        chatTimeoutRef.current = null;
        if (activeRunIdRef.current === runId) { setChatError({ message: t('chat.noResponseError'), category: 'timeout' as ChatErrorCategory, lastUserMessage: msg, timestamp: Date.now() }); setSending(false); setStreamText(null); activeRunIdRef.current = null; }
      }, 60_000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('chat.failedToSend');
      setChatError({ message: errMsg, category: classifyChatError(errMsg), lastUserMessage: msg, timestamp: Date.now() });
      setSending(false); setStreamText(null); activeRunIdRef.current = null;
    }
  }, [input, attachments, isStreaming, instanceId, sessionKey, t]);

  const handleAbort = useCallback(() => {
    if (chatTimeoutRef.current) { clearTimeout(chatTimeoutRef.current); chatTimeoutRef.current = null; }
    setSending(false); setStreamText(null);
    const runIdToAbort = activeRunIdRef.current; activeRunIdRef.current = null;
    if (runIdToAbort) { abortedRunIdsRef.current.add(runIdToAbort); setTimeout(() => abortedRunIdsRef.current.delete(runIdToAbort), 2000); }
    if (instanceId) rpc(instanceId, 'chat.abort', runIdToAbort ? { sessionKey, runId: runIdToAbort } : { sessionKey }).catch(() => {});
    loadHistory();
  }, [instanceId, sessionKey, loadHistory]);

  const handleSaveSettings = useCallback(async () => {
    if (!instanceId) return;
    setSavingSettings(true);
    try {
      await rpc(instanceId, 'sessions.patch', { key: sessionKey, model: sessionModel || null, thinkingLevel: sessionThinking || null });
      setShowSettings(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('chat.failedToUpdateSettings');
      setChatError({ message: errMsg, category: classifyChatError(errMsg), timestamp: Date.now() });
    } finally { setSavingSettings(false); }
  }, [instanceId, sessionKey, sessionModel, sessionThinking, t]);

  const handleRetry = useCallback(async () => {
    if (!chatError?.lastUserMessage) return;
    setRetrying(true); setChatError(null);
    try { await sendMessage(chatError.lastUserMessage); } finally { setRetrying(false); }
  }, [chatError, sendMessage]);

  const defaultSuggestions = [t('assistantChat.suggestion1'), t('assistantChat.suggestion2'), t('assistantChat.suggestion3'), t('assistantChat.suggestion4')];
  const suggestions = chatSuggestions.length > 0 ? chatSuggestions : defaultSuggestions;

  return {
    instance, loading, messages, input, setInput, sending, streamText, chatError, setChatError, isStreaming, isAtBottom,
    retrying, copiedIdx, attachments, sessionKey, drawerOpen, setDrawerOpen, sessionRefreshFlag, showSettings, setShowSettings,
    sessionModel, setSessionModel, sessionThinking, setSessionThinking, savingSettings, modelSuggestions: rpcModels,
    messagesContainerRef, textareaRef, fileInputRef,
    sendMessage, handleAbort, loadHistory, handleNewChat, handleSelectSession, handleCopyMessage,
    processFiles, removeAttachment, handleSaveSettings, handleRetry, scrollToBottom, handleMessagesScroll,
    handlePaste, handleDrop, suggestions,
  };
}
