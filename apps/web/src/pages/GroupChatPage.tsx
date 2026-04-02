import { useState, useEffect, useCallback, useRef, type FormEvent, type ChangeEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import type {
  GroupChat,
  GroupChatMessage,
  GroupChatMessagesResponse,
  GroupChatMessageSentResponse,
  WsMessage,
  DeliveryStatusValue,
  GroupChatWsMessage,
  GroupChatDeliveryWsMessage,
  GroupChatMember,
  InstancePublic,
  UserSearchResult
} from '@aquarium/shared';
import {
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  ALLOWED_ATTACHMENT_TYPES,
  isImageMime,
  FILE_INPUT_ACCEPT,
} from '@aquarium/shared';
import { MessageRenderer } from '../components/chat/MessageRenderer';
import './group-chat.css';

const optimisticImageContentByMsgId = new Map<string, unknown>();

function getDocumentTypeLabel(mime: string): string {
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'XLS';
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

interface LocalAttachment {
  id: string;
  type: string;
  data: string;
  preview: string;
  name: string;
}

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
  const [activeTab, setActiveTab] = useState<'bot' | 'human'>('bot');
  const [availableInstances, setAvailableInstances] = useState<InstancePublic[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [newMemberDisplayName, setNewMemberDisplayName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('');

  const [searchEmail, setSearchEmail] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gcFileInputRef = useRef<HTMLInputElement>(null);

  const [gcAttachments, setGcAttachments] = useState<LocalAttachment[]>([]);

  const fetchInstances = useCallback(async () => {
    try {
      const instances = await api.get<InstancePublic[]>('/instances');

      if (chat) {
        const existingInstanceIds = new Set(chat.members.map(m => m.instanceId).filter(Boolean));
        setAvailableInstances(instances.filter(i => !existingInstanceIds.has(i.id)));
      } else {
        setAvailableInstances(instances);
      }
    } catch (err) {
      console.error('Failed to fetch instances:', err);
    }
  }, [chat]);

  useEffect(() => {
    if (showAddMemberModal) {
      fetchInstances();
    }
  }, [showAddMemberModal, fetchInstances]);

  useEffect(() => {
    if (!searchEmail || searchEmail.length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.get<UserSearchResult[]>('/users/search?email=' + encodeURIComponent(searchEmail));
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchEmail]);

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!chat) return;

    setAddingMember(true);
    try {
      if (activeTab === 'bot') {
        if (!selectedInstanceId) return;
        const instance = availableInstances.find(i => i.id === selectedInstanceId);
        if (!instance) return;

        await api.post(`/group-chats/${chat.id}/members`, {
          instanceId: selectedInstanceId,
          displayName: newMemberDisplayName || instance.name,
          role: newMemberRole
        });
      } else {
        if (!selectedUser) return;

        await api.post(`/group-chats/${chat.id}/members`, {
          userId: selectedUser.id,
          displayName: newMemberDisplayName || selectedUser.displayName,
          role: newMemberRole,
          isHuman: true
        });
      }

      const updatedChat = await api.get<GroupChat>(`/group-chats/${chat.id}`);
      setChat(updatedChat);
      setShowAddMemberModal(false);

      setSelectedInstanceId('');
      setNewMemberDisplayName('');
      setNewMemberRole('');
      setSearchEmail('');
      setSearchResults([]);
      setSelectedUser(null);
    } catch (err) {
      console.error('Failed to add member:', err);
      setError(t('groupChat.detail.failedToAddMember'));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!chat || !confirm(t('groupChat.detail.removeMemberConfirm'))) return;

    try {
      await api.delete(`/group-chats/${chat.id}/members/${memberId}`);
      const updatedChat = await api.get<GroupChat>(`/group-chats/${chat.id}`);
      setChat(updatedChat);
    } catch (err) {
      console.error('Failed to remove member:', err);
      setError(t('groupChat.detail.failedToRemoveMember'));
    }
  };

  const handleUpdateMember = async (memberId: string) => {
    if (!chat) return;

    try {
      await api.put(`/group-chats/${chat.id}/members/${memberId}`, {
        displayName: editDisplayName,
        role: editRole
      });

      const updatedChat = await api.get<GroupChat>(`/group-chats/${chat.id}`);
      setChat(updatedChat);
      setEditingMemberId(null);
    } catch (err) {
      console.error('Failed to update member:', err);
      setError(t('groupChat.detail.failedToUpdateMember'));
    }
  };

  const startEditing = (member: GroupChatMember) => {
    setEditingMemberId(member.id);
    setEditDisplayName(member.displayName);
    setEditRole(member.role || '');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (messages.length > 0 && !isLoadingMoreRef.current) {
      scrollToBottom();
    }
    isLoadingMoreRef.current = false;
  }, [messages]);

  const mergeMessages = useCallback((fetched: GroupChatMessage[]) => {
    setMessages(prev => {
      const existing = new Map(prev.map(m => [m.id, m]));
      let changed = false;
      for (const msg of fetched) {
        if (!existing.has(msg.id)) {
          existing.set(msg.id, msg);
          changed = true;
        }
      }
      if (!changed) return prev;
      return Array.from(existing.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (!id || loadingMore || !hasMore || messages.length === 0) return;
    const oldestMessage = messages[0];
    setLoadingMore(true);
    isLoadingMoreRef.current = true;

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    try {
      const data = await api.get<GroupChatMessagesResponse>(
        `/group-chats/${id}/messages?limit=50&before=${oldestMessage.id}`
      );
      setHasMore(data.hasMore);
      mergeMessages(data.messages);

      // Restore scroll position so the view doesn't jump
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('groupChat.detail.failedToLoadOlderMessages'));
    } finally {
      setLoadingMore(false);
    }
  }, [id, loadingMore, hasMore, messages, mergeMessages, t]);

  const handleMessage = useCallback((message: WsMessage) => {
    if (message.groupChatId !== id) return;

    if (message.type === 'group_chat:message') {
      const payload = (message as unknown as GroupChatWsMessage).payload;
      const newMessage: GroupChatMessage = {
        id: payload.messageId,
        groupChatId: id!,
        senderType: payload.senderType,
        senderInstanceId: payload.senderInstanceId,
        senderUserId: payload.senderUserId || null,
        senderDisplayName: payload.senderName,
        content: payload.content,
        mentionedInstanceIds: [],
        replyToMessageId: null,
        chainDepth: payload.chainDepth,
        createdAt: payload.createdAt,
        deliveryStatus: payload.deliveryStatus?.map(ds => ({
          id: `${payload.messageId}-${ds.targetInstanceId}`,
          messageId: payload.messageId,
          targetInstanceId: ds.targetInstanceId,
          targetDisplayName: ds.targetDisplayName,
          status: ds.status,
          errorMessage: ds.errorMessage || null,
          responseMessageId: null,
          retryCount: 0,
          maxRetries: 3,
          nextRetryAt: null,
          deliveredAt: null,
          processingAt: null,
          completedAt: null,
          errorAt: null,
          createdAt: payload.createdAt
        }))
      };

      setMessages(prev => {
        const existingIdx = prev.findIndex(m => m.id === newMessage.id);
        if (existingIdx >= 0) {
          const updated = [...prev];
          const localContent = optimisticImageContentByMsgId.get(newMessage.id);
          updated[existingIdx] = localContent
            ? { ...newMessage, content: localContent as string }
            : newMessage;
          return updated;
        }
        return [...prev, newMessage];
      });
    } else if (message.type === 'group_chat:delivery_status') {
      const payload = (message as unknown as GroupChatDeliveryWsMessage).payload;

      setMessages(prev => prev.map(msg => {
        if (msg.id !== payload.messageId) return msg;

        const existingStatus = msg.deliveryStatus || [];
        const statusIndex = existingStatus.findIndex(s => s.targetInstanceId === payload.targetInstanceId);

        const newStatus = [...existingStatus];

        if (statusIndex >= 0) {
          newStatus[statusIndex] = {
            ...newStatus[statusIndex],
            status: payload.status,
            errorMessage: payload.errorMessage || null,
            responseMessageId: payload.responseMessageId || null,
            retryCount: (payload as GroupChatDeliveryWsMessage['payload'] & { retryCount?: number }).retryCount ?? newStatus[statusIndex].retryCount,
            maxRetries: (payload as GroupChatDeliveryWsMessage['payload'] & { maxRetries?: number }).maxRetries ?? newStatus[statusIndex].maxRetries,
            nextRetryAt: (payload as GroupChatDeliveryWsMessage['payload'] & { nextRetryAt?: string | null }).nextRetryAt ?? newStatus[statusIndex].nextRetryAt
          };
        } else {
          newStatus.push({
            id: `${payload.messageId}-${payload.targetInstanceId}`,
            messageId: payload.messageId,
            targetInstanceId: payload.targetInstanceId,
            targetDisplayName: payload.targetDisplayName,
            status: payload.status,
            errorMessage: payload.errorMessage || null,
            responseMessageId: payload.responseMessageId || null,
            retryCount: 0,
            maxRetries: 3,
            nextRetryAt: null,
            deliveredAt: null,
            processingAt: null,
            completedAt: null,
            errorAt: null,
            createdAt: payload.timestamp
          });
        }

        return { ...msg, deliveryStatus: newStatus };
      }));

      if (payload.status === 'error' && payload.errorMessage) {
        setError(payload.errorMessage);
      }
    }
  }, [id]);

  // ORDERING CRITICAL: handlers must be registered before subscribe to avoid missing messages
  useEffect(() => {
    if (!id) return;

    addHandler('group_chat:message', handleMessage);
    addHandler('group_chat:delivery_status', handleMessage);
    subscribeGroupChat(id);

    const fetchChatData = async () => {
      try {
        const [chatData, messagesData] = await Promise.all([
          api.get<GroupChat>(`/group-chats/${id}`),
          api.get<GroupChatMessagesResponse>(`/group-chats/${id}/messages?limit=50`)
        ]);

        setChat(chatData);
        setMessages(messagesData.messages);
        setHasMore(messagesData.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('groupChat.detail.failedToLoadChat'));
      } finally {
        setLoading(false);
      }
    };

    fetchChatData();

    return () => {
      removeHandler('group_chat:message', handleMessage);
      removeHandler('group_chat:delivery_status', handleMessage);
      unsubscribeGroupChat(id);
    };
  }, [id, subscribeGroupChat, unsubscribeGroupChat, addHandler, removeHandler, handleMessage]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

    if (lastAtSymbol >= 0 && lastAtSymbol >= textBeforeCursor.lastIndexOf(' ')) {
      const filter = textBeforeCursor.slice(lastAtSymbol + 1);
      setMentionFilter(filter.toLowerCase());
      setMentionCursorPos(lastAtSymbol);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const handleMentionSelect = (displayName: string) => {
    const beforeMention = inputValue.slice(0, mentionCursorPos);
    const afterMention = inputValue.slice(mentionCursorPos + mentionFilter.length + 1);
    const newValue = `${beforeMention}@${displayName} ${afterMention}`;

    setInputValue(newValue);
    setShowMentionDropdown(false);
    inputRef.current?.focus();
  };

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (gcAttachments.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(t('chat.attachments.maxReached'));
      return;
    }

    Array.from(files).forEach(file => {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setError(t('chat.attachments.invalidType'));
        return;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setError(t('chat.attachments.tooLarge'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const base64 = result.split(',')[1];
        setGcAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          type: file.type,
          data: base64,
          preview: result,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, [gcAttachments.length, t]);

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
    setGcAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }, []);

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && gcAttachments.length === 0) || !id) return;

    const content = inputValue;
    const currentAttachments = [...gcAttachments];
    setSending(true);
    setInputValue('');
    setGcAttachments([]);
    try {
      const reqBody: Record<string, unknown> = { content };
      if (currentAttachments.length > 0) {
        reqBody.attachments = currentAttachments.map(a => ({
          type: (isImageMime(a.type) ? 'image' : 'file') as 'image' | 'file',
          mimeType: a.type,
          content: a.data,
          fileName: a.name,
        }));
      }

      const result = await api.post<GroupChatMessageSentResponse>(`/group-chats/${id}/messages`, reqBody);

      let displayContent: string | unknown = content;
      if (currentAttachments.length > 0) {
        const blocks: unknown[] = [];
        if (content.trim()) {
          blocks.push({ type: 'text', text: content });
        }
        for (const a of currentAttachments) {
          blocks.push({
            type: isImageMime(a.type) ? 'image' : 'file',
            mimeType: a.type,
            content: a.data,
            fileName: a.name,
          });
        }
        displayContent = blocks;
        optimisticImageContentByMsgId.set(result.messageId, blocks);
      }

      const optimisticMessage: GroupChatMessage = {
        id: result.messageId,
        groupChatId: id,
        senderType: 'user',
        senderInstanceId: null,
        senderUserId: null,
        senderDisplayName: t('groupChat.detail.senderYou'),
        content: displayContent as string,
        mentionedInstanceIds: [],
        replyToMessageId: null,
        chainDepth: 0,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => {
        if (prev.some(m => m.id === result.messageId)) return prev;
        return [...prev, optimisticMessage];
      });

      // Catch-up poll: fetch messages that may have been broadcast before WS subscription was established
      setTimeout(async () => {
        try {
          const data = await api.get<GroupChatMessagesResponse>(`/group-chats/${id}/messages?limit=50`);
          mergeMessages(data.messages);
        } catch { /* best effort */ }
      }, 2000);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : t('groupChat.detail.failedToSendMessage'));
      setInputValue(content);
      setGcAttachments(currentAttachments);
    } finally {
      setSending(false);
    }
  };

  const getStatusIcon = (status: DeliveryStatusValue) => {
    switch (status) {
      case 'pending': return t('groupChat.delivery.pending');
      case 'delivered': return t('groupChat.delivery.delivered');
      case 'processing': return t('groupChat.delivery.processing');
      case 'completed': return t('groupChat.delivery.completed');
      case 'error': return t('groupChat.delivery.error');
      default: return '';
    }
  };

  const resolveSenderInfo = (msg: GroupChatMessage) => {
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

    return { variant, senderName, role: member?.role, isHumanMember };
  };

  const handleDeleteChat = async () => {
    if (!id || !window.confirm(t('groupChat.detail.deleteChatConfirm'))) return;
    try {
      await api.delete(`/group-chats/${id}`);
      navigate('/group-chats');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.deleteFailed'));
    }
  };

  if (loading) return <div className="dashboard-page">{t('groupChat.detail.loadingChat')}</div>;
  if (!chat) return <div className="dashboard-page error-message">{t('groupChat.detail.chatNotFound')}</div>;

  const isOwner = user?.id === chat.userId;

  const filteredMembers = chat.members.filter(m =>
    m.displayName.toLowerCase().includes(mentionFilter)
  );

  return (
    <main className="dashboard-page gc-page">
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/group-chats" style={{ textDecoration: 'none', fontSize: '1.2rem' }}>←</Link>
          <h1>{chat.name}</h1>
        </div>
        <div className="dashboard-header-actions">
          <span className="status-badge status-running">{t('groupChat.list.memberCount', { count: chat.members.length })}</span>
          {isOwner && (
            <button className="btn btn-danger" onClick={handleDeleteChat}>{t('groupChat.detail.deleteChat')}</button>
          )}
        </div>
      </header>

      {error && <div className="error-message" role="alert" style={{ margin: '1rem' }}>{error}</div>}

      <div className="gc-body">
        <div className="gc-messages" ref={messagesContainerRef}>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={loadMoreMessages}
                disabled={loadingMore}
              >
                {loadingMore ? t('groupChat.detail.loadingMessages') : t('groupChat.detail.loadOlderMessages')}
              </button>
            </div>
          )}
          {messages.map(msg => {
            const { variant, senderName, role } = resolveSenderInfo(msg);

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
                        <span className="gc-delivery-icon">{getStatusIcon(status.status)}</span>
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

        <div className="gc-sidebar">
          <div className="gc-sidebar-header">
            <h3 className="gc-sidebar-title">{t('groupChat.members.title')}</h3>
            {isOwner && (
              <button
                onClick={() => setShowAddMemberModal(true)}
                className="gc-sidebar-add-btn"
                title={t('groupChat.members.addButton')}
              >
                +
              </button>
            )}
          </div>

          {chat.members.map((member: GroupChatMember) => (
            <div key={member.id} className="gc-member">
              {editingMemberId === member.id ? (
                <div className="gc-member-edit">
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={e => setEditDisplayName(e.target.value)}
                    placeholder={t('groupChat.members.displayNameLabel')}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editRole}
                    onChange={e => setEditRole(e.target.value)}
                    placeholder={t('groupChat.members.roleLabel')}
                    style={{ fontSize: '0.75rem' }}
                  />
                  <div className="gc-member-edit-actions">
                    <button
                      onClick={() => setEditingMemberId(null)}
                      className="gc-member-edit-btn gc-member-edit-btn--cancel"
                    >
                      {t('groupChat.members.cancel')}
                    </button>
                    <button
                      onClick={() => handleUpdateMember(member.id)}
                      className="gc-member-edit-btn gc-member-edit-btn--save"
                    >
                      {t('groupChat.members.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gc-member-row">
                  <div className={`gc-member-dot gc-member-dot--${member.isHuman ? 'human' : 'bot'}`} />
                  <div className="gc-member-info">
                    <div className="gc-member-name-row">
                      <div className="gc-member-name-left">
                        <span className="gc-member-name">{member.displayName}</span>
                        <span className={`gc-member-type gc-member-type--${member.isHuman ? 'human' : 'bot'}`}>
                          {member.isHuman ? t('groupChat.detail.typeBadgeHuman') : t('groupChat.detail.typeBadgeBot')}
                        </span>
                      </div>
                    </div>
                    {member.role && (
                      <div className="gc-member-role">{member.role}</div>
                    )}
                  </div>

                  {isOwner && (
                    <div className="gc-member-actions">
                      <button
                        onClick={() => startEditing(member)}
                        title={t('groupChat.members.editTitle')}
                        className="gc-member-action-btn"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        title={t('groupChat.members.removeTitle')}
                        className="gc-member-action-btn gc-member-action-btn--danger"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="gc-input-area"
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        {showMentionDropdown && filteredMembers.length > 0 && (
          <div className="gc-mention-dropdown">
            {filteredMembers.map(member => (
              <div
                key={member.id}
                onClick={() => handleMentionSelect(member.displayName)}
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
                  onClick={() => removeAttachment(a.id)}
                  title={t('chat.attachments.removeAttachment')}
                  className="gc-attachment-remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSendMessage} className="gc-input-form">
          <input
            type="file"
            ref={gcFileInputRef}
            onChange={e => processFiles(e.target.files)}
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
            onChange={handleInputChange}
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

      {showAddMemberModal && (
        <div className="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <h2>{t('groupChat.members.addTitle')}</h2>

            <div className="gc-tab-bar">
              <button
                onClick={() => {
                  setActiveTab('bot');
                  setNewMemberDisplayName('');
                  setSearchEmail('');
                  setSearchResults([]);
                  setSelectedUser(null);
                }}
                className={`gc-tab ${activeTab === 'bot' ? 'gc-tab--active' : ''}`}
              >
                {t('groupChat.members.tabBot')}
              </button>
              <button
                onClick={() => {
                  setActiveTab('human');
                  setNewMemberDisplayName('');
                  setSearchEmail('');
                  setSearchResults([]);
                  setSelectedUser(null);
                }}
                className={`gc-tab ${activeTab === 'human' ? 'gc-tab--active' : ''}`}
              >
                {t('groupChat.members.tabHuman')}
              </button>
            </div>

            <form onSubmit={handleAddMember}>
              {activeTab === 'bot' ? (
                <div className="form-group">
                  <label>{t('groupChat.members.selectInstance')}</label>
                  <select
                    value={selectedInstanceId}
                    onChange={e => {
                      const instId = e.target.value;
                      setSelectedInstanceId(instId);
                      const inst = availableInstances.find(i => i.id === instId);
                      if (inst) setNewMemberDisplayName(inst.name);
                    }}
                    required
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="">{t('groupChat.members.selectInstancePlaceholder')}</option>
                    {availableInstances.map(inst => (
                      <option key={inst.id} value={inst.id}>{inst.name} ({t('common.status.' + inst.status)})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label>{t('groupChat.members.searchUserByEmail')}</label>
                  {!selectedUser ? (
                    <>
                      <input
                        type="text"
                        value={searchEmail}
                        onChange={e => {
                          setSearchEmail(e.target.value);
                          setSelectedUser(null);
                        }}
                        placeholder={t('groupChat.members.searchPlaceholder')}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                        autoFocus
                      />
                      {searching && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>{t('groupChat.create.searching')}</div>}

                      {searchResults.length > 0 && (
                        <div className="gc-user-search-results">
                          {searchResults.map(result => (
                            <div
                              key={result.id}
                              onClick={() => {
                                setSelectedUser(result);
                                setNewMemberDisplayName(result.displayName);
                                setSearchResults([]);
                              }}
                              className="gc-user-search-item"
                            >
                              <div className="gc-user-search-name">{result.displayName}</div>
                              <div className="gc-user-search-email">{result.email}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="gc-selected-user">
                      <div>
                        <div className="gc-selected-user-name">{selectedUser.displayName}</div>
                        <div className="gc-selected-user-email">{selectedUser.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUser(null);
                          setSearchEmail('');
                        }}
                        className="gc-selected-user-remove"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="form-group">
                <label>{t('groupChat.members.displayNameLabel')}</label>
                <input
                  type="text"
                  value={newMemberDisplayName}
                  onChange={e => setNewMemberDisplayName(e.target.value)}
                  placeholder={activeTab === 'bot' ? t('groupChat.members.displayNamePlaceholderBot') : t('groupChat.members.displayNamePlaceholderHuman')}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div className="form-group">
                <label>{t('groupChat.members.roleLabel')}</label>
                <input
                  type="text"
                  value={newMemberRole}
                  onChange={e => setNewMemberRole(e.target.value)}
                  placeholder={t('groupChat.members.rolePlaceholder')}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                />
              </div>

              <div className="modal-actions">
                <button type="button" onClick={() => setShowAddMemberModal(false)} className="btn-secondary">{t('groupChat.members.cancel')}</button>
                <button
                  type="submit"
                  disabled={addingMember || (activeTab === 'bot' && !selectedInstanceId) || (activeTab === 'human' && !selectedUser)}
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: addingMember ? 'not-allowed' : 'pointer'
                  }}
                >
                  {addingMember ? t('groupChat.members.adding') : t('groupChat.members.addMember')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
