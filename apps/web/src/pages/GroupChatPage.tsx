import { useState, useEffect, useCallback, useRef, type FormEvent, type ChangeEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import type {
  GroupChat, GroupChatMessage, GroupChatMessagesResponse,
  GroupChatMessageSentResponse, WsMessage, GroupChatWsMessage,
  GroupChatDeliveryWsMessage, GroupChatMember,
} from '@aquarium/shared';
import { MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS_PER_MESSAGE, ALLOWED_ATTACHMENT_TYPES, isImageMime } from '@aquarium/shared';
import { GroupChatSidebar } from '../components/group-chat/GroupChatSidebar';
import { GroupChatMessageThread } from '../components/group-chat/GroupChatMessageThread';
import { GroupChatInput } from '../components/group-chat/GroupChatInput';
import type { LocalAttachment } from '../components/group-chat/GroupChatInput';
import { AddMemberDialog } from '../components/group-chat/AddMemberDialog';
import { buildMessageFromWs, applyDeliveryStatus } from '../components/group-chat/group-chat-utils';
import type { DeliveryPayload } from '../components/group-chat/group-chat-utils';
import { ChatSkeleton } from '@/components/skeletons';
import '../components/group-chat/group-chat.css';

const optimisticImageContentByMsgId = new Map<string, unknown>();

export function GroupChatPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { subscribeGroupChat, unsubscribeGroupChat, addHandler, removeHandler } = useWebSocket();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [chat, setChat] = useState<GroupChat | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [gcAttachments, setGcAttachments] = useState<LocalAttachment[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mergeMessages = useCallback((fetched: GroupChatMessage[]) => {
    setMessages(prev => {
      const existing = new Map(prev.map(m => [m.id, m]));
      let changed = false;
      for (const msg of fetched) {
        if (!existing.has(msg.id)) { existing.set(msg.id, msg); changed = true; }
      }
      if (!changed) return prev;
      return Array.from(existing.values()).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (!id || loadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    setLoadingMore(true);
    isLoadingMoreRef.current = true;
    const container = messagesContainerRef.current;
    const prevH = container?.scrollHeight ?? 0;
    try {
      const data = await api.get<GroupChatMessagesResponse>(`/group-chats/${id}/messages?limit=50&before=${oldest.id}`);
      setHasMore(data.hasMore);
      mergeMessages(data.messages);
      requestAnimationFrame(() => { if (container) container.scrollTop = container.scrollHeight - prevH; });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('groupChat.detail.failedToLoadOlderMessages'));
    } finally { setLoadingMore(false); }
  }, [id, loadingMore, hasMore, messages, mergeMessages, t]);

  const handleMessage = useCallback((message: WsMessage) => {
    if (message.groupChatId !== id) return;
    if (message.type === 'group_chat:message') {
      const payload = (message as unknown as GroupChatWsMessage).payload;
      const newMsg = buildMessageFromWs(payload, id!);
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === newMsg.id);
        if (idx >= 0) {
          const updated = [...prev];
          const local = optimisticImageContentByMsgId.get(newMsg.id);
          updated[idx] = local ? { ...newMsg, content: local as string } : newMsg;
          return updated;
        }
        return [...prev, newMsg];
      });
    } else if (message.type === 'group_chat:delivery_status') {
      const payload = (message as unknown as GroupChatDeliveryWsMessage).payload as DeliveryPayload;
      setMessages(prev => applyDeliveryStatus(prev, payload));
      if (payload.status === 'error' && payload.errorMessage) setError(payload.errorMessage);
    }
  }, [id]);

  // ORDERING CRITICAL: handlers registered before subscribe to avoid missing messages
  useEffect(() => {
    if (!id) return;
    addHandler('group_chat:message', handleMessage);
    addHandler('group_chat:delivery_status', handleMessage);
    subscribeGroupChat(id);
    const fetchChatData = async () => {
      try {
        const [chatData, msgsData] = await Promise.all([
          api.get<GroupChat>(`/group-chats/${id}`),
          api.get<GroupChatMessagesResponse>(`/group-chats/${id}/messages?limit=50`),
        ]);
        setChat(chatData); setMessages(msgsData.messages); setHasMore(msgsData.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('groupChat.detail.failedToLoadChat'));
      } finally { setLoading(false); }
    };
    fetchChatData();
    return () => {
      removeHandler('group_chat:message', handleMessage);
      removeHandler('group_chat:delivery_status', handleMessage);
      unsubscribeGroupChat(id);
    };
  }, [id, subscribeGroupChat, unsubscribeGroupChat, addHandler, removeHandler, handleMessage, t]);

  useEffect(() => {
    if (messages.length > 0 && !isLoadingMoreRef.current)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isLoadingMoreRef.current = false;
  }, [messages]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const cursorPos = e.target.selectionStart || 0;
    const before = value.slice(0, cursorPos);
    const lastAt = before.lastIndexOf('@');
    if (lastAt >= 0 && lastAt >= before.lastIndexOf(' ')) {
      setMentionFilter(before.slice(lastAt + 1).toLowerCase());
      setMentionCursorPos(lastAt);
      setShowMentionDropdown(true);
    } else { setShowMentionDropdown(false); }
  };

  const handleMentionSelect = (displayName: string) => {
    const before = inputValue.slice(0, mentionCursorPos);
    const after = inputValue.slice(mentionCursorPos + mentionFilter.length + 1);
    setInputValue(`${before}@${displayName} ${after}`);
    setShowMentionDropdown(false);
    inputRef.current?.focus();
  };

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (gcAttachments.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) { setError(t('chat.attachments.maxReached')); return; }
    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) { setError(t('chat.attachments.invalidType')); return; }
      if (file.size > MAX_ATTACHMENT_SIZE) { setError(t('chat.attachments.tooLarge')); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        setGcAttachments(prev => [...prev, { id: crypto.randomUUID(), type: file.type, data: result.split(',')[1], preview: result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  }, [gcAttachments.length, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) { e.preventDefault(); processFiles(e.clipboardData.files); }
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && gcAttachments.length === 0) || !id) return;
    const content = inputValue;
    const currentAttachments = [...gcAttachments];
    setSending(true); setInputValue(''); setGcAttachments([]);
    try {
      const reqBody: Record<string, unknown> = { content };
      if (currentAttachments.length > 0) {
        reqBody.attachments = currentAttachments.map(a => ({
          type: (isImageMime(a.type) ? 'image' : 'file') as 'image' | 'file', mimeType: a.type, content: a.data, fileName: a.name,
        }));
      }
      const result = await api.post<GroupChatMessageSentResponse>(`/group-chats/${id}/messages`, reqBody);
      let displayContent: string | unknown = content;
      if (currentAttachments.length > 0) {
        const blocks: unknown[] = [];
        if (content.trim()) blocks.push({ type: 'text', text: content });
        for (const a of currentAttachments) blocks.push({ type: isImageMime(a.type) ? 'image' : 'file', mimeType: a.type, content: a.data, fileName: a.name });
        displayContent = blocks;
        optimisticImageContentByMsgId.set(result.messageId, blocks);
      }
      const optimistic: GroupChatMessage = {
        id: result.messageId, groupChatId: id, senderType: 'user', senderInstanceId: null, senderUserId: null,
        senderDisplayName: t('groupChat.detail.senderYou'), content: displayContent as string,
        mentionedInstanceIds: [], replyToMessageId: null, chainDepth: 0, createdAt: new Date().toISOString(),
      };
      setMessages(prev => prev.some(m => m.id === result.messageId) ? prev : [...prev, optimistic]);
      setTimeout(async () => {
        try { mergeMessages((await api.get<GroupChatMessagesResponse>(`/group-chats/${id}/messages?limit=50`)).messages); } catch { /* best effort */ }
      }, 2000);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : t('groupChat.detail.failedToSendMessage'));
      setInputValue(content); setGcAttachments(currentAttachments);
    } finally { setSending(false); }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!chat || !confirm(t('groupChat.detail.removeMemberConfirm'))) return;
    try {
      await api.delete(`/group-chats/${chat.id}/members/${memberId}`);
      setChat(await api.get<GroupChat>(`/group-chats/${chat.id}`));
    } catch (err) { console.error('Failed to remove member:', err); setError(t('groupChat.detail.failedToRemoveMember')); }
  };

  const handleUpdateMember = async (memberId: string) => {
    if (!chat) return;
    try {
      await api.put(`/group-chats/${chat.id}/members/${memberId}`, { displayName: editDisplayName, role: editRole });
      setChat(await api.get<GroupChat>(`/group-chats/${chat.id}`));
      setEditingMemberId(null);
    } catch (err) { console.error('Failed to update member:', err); setError(t('groupChat.detail.failedToUpdateMember')); }
  };

  const startEditing = (member: GroupChatMember) => {
    setEditingMemberId(member.id); setEditDisplayName(member.displayName); setEditRole(member.role || '');
  };

  const handleDeleteChat = async () => {
    if (!id || !window.confirm(t('groupChat.detail.deleteChatConfirm'))) return;
    try { await api.delete(`/group-chats/${id}`); navigate('/group-chats'); }
    catch (err) { setError(err instanceof Error ? err.message : t('common.errors.deleteFailed')); }
  };

  if (loading) return <div className="dashboard-page"><ChatSkeleton /></div>;
  if (!chat) return <div className="dashboard-page error-message">{t('groupChat.detail.chatNotFound')}</div>;

  const isOwner = user?.id === chat.userId;

  return (
    <main className="dashboard-page gc-page">
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/group-chats" style={{ textDecoration: 'none', fontSize: '1.2rem' }}>←</Link>
          <h1>{chat.name}</h1>
        </div>
        <div className="dashboard-header-actions">
          <span className="status-badge status-running">{t('groupChat.list.memberCount', { count: chat.members.length })}</span>
          {isOwner && <button className="btn btn-danger" onClick={handleDeleteChat}>{t('groupChat.detail.deleteChat')}</button>}
        </div>
      </header>

      {error && <div className="error-message" role="alert" style={{ margin: '1rem' }}>{error}</div>}

      <div className="gc-body">
        <GroupChatMessageThread
          chat={chat} messages={messages} hasMore={hasMore} loadingMore={loadingMore}
          onLoadMore={loadMoreMessages} messagesContainerRef={messagesContainerRef} messagesEndRef={messagesEndRef}
        />
        <GroupChatSidebar
          chat={chat} isOwner={isOwner} editingMemberId={editingMemberId}
          editDisplayName={editDisplayName} editRole={editRole}
          onSetEditDisplayName={setEditDisplayName} onSetEditRole={setEditRole}
          onStartEdit={startEditing} onCancelEdit={() => setEditingMemberId(null)}
          onSaveEdit={handleUpdateMember} onRemoveMember={handleRemoveMember}
          onShowAddMember={() => setShowAddMemberModal(true)}
        />
      </div>

      <GroupChatInput
        chat={chat} inputValue={inputValue} onInputChange={handleInputChange}
        onSubmit={handleSendMessage} sending={sending} gcAttachments={gcAttachments}
        onRemoveAttachment={aid => setGcAttachments(prev => prev.filter(a => a.id !== aid))}
        onProcessFiles={processFiles} showMentionDropdown={showMentionDropdown}
        mentionFilter={mentionFilter} onMentionSelect={handleMentionSelect}
        onPaste={handlePaste} onDrop={handleDrop} inputRef={inputRef}
      />

      <AddMemberDialog
        open={showAddMemberModal} onOpenChange={setShowAddMemberModal}
        chat={chat} onMemberAdded={updatedChat => setChat(updatedChat)}
      />
    </main>
  );
}
