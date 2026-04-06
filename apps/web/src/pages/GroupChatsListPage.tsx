import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, MessageSquare } from 'lucide-react';
import { api } from '../api';
import type { InstancePublic, GroupChat, CreateGroupChatRequest, UserSearchResult, AddGroupChatMemberRequest } from '@aquarium/shared';
import '../components/group-chat/group-chat.css';
import './GroupChatsListPage.css';
import { PageHeader } from '../components/PageHeader';
import { PageHeaderSkeleton, ListSkeleton } from '@/components/skeletons';
import { EmptyState } from '../components/EmptyState';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';

export function GroupChatsListPage() {
  const { t } = useTranslation();

  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [instances, setInstances] = useState<InstancePublic[]>([]);
  const [newChatName, setNewChatName] = useState('');
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  const [instanceDisplayNames, setInstanceDisplayNames] = useState<Record<string, string>>({});
  const [instanceRoles, setInstanceRoles] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const [humanSearchEmail, setHumanSearchEmail] = useState('');
  const [humanSearchResults, setHumanSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedHumans, setSelectedHumans] = useState<UserSearchResult[]>([]);
  const [humanSearching, setHumanSearching] = useState(false);

  useEffect(() => {
    fetchGroupChats();
  }, []);

  useEffect(() => {
    if (showCreateModal) {
      fetchInstances();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (humanSearchEmail.length < 2) {
      setHumanSearchResults([]);
      return;
    }
    setHumanSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.get<UserSearchResult[]>('/users/search?email=' + encodeURIComponent(humanSearchEmail));
        setHumanSearchResults(results.filter(r => !selectedHumans.some(s => s.id === r.id)));
      } catch {
        setHumanSearchResults([]);
      } finally {
        setHumanSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [humanSearchEmail, selectedHumans]);

  const fetchGroupChats = async () => {
    try {
      const data = await api.get<GroupChat[]>('/group-chats');
      setGroupChats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('groupChat.create.failedToLoadGroupChats'));
    } finally {
      setLoading(false);
    }
  };

  const fetchInstances = async () => {
    try {
      const data = await api.get<InstancePublic[]>('/instances');
      setInstances(data);
      const initialDisplayNames: Record<string, string> = {};
      data.forEach(inst => {
        initialDisplayNames[inst.id] = inst.name;
      });
      setInstanceDisplayNames(prev => ({ ...initialDisplayNames, ...prev }));
    } catch (err) {
      console.error('Failed to load instances:', err);
    }
  };

  const handleInstanceToggle = (instanceId: string) => {
    const newSelected = new Set(selectedInstanceIds);
    if (newSelected.has(instanceId)) {
      newSelected.delete(instanceId);
    } else {
      newSelected.add(instanceId);
    }
    setSelectedInstanceIds(newSelected);
  };

  const handleDisplayNameChange = (instanceId: string, name: string) => {
    setInstanceDisplayNames(prev => ({
      ...prev,
      [instanceId]: name
    }));
  };

  const handleRoleChange = (instanceId: string, role: string) => {
    setInstanceRoles(prev => ({
      ...prev,
      [instanceId]: role
    }));
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (selectedInstanceIds.size === 0) {
      setError(t('groupChat.create.selectAtLeastOne'));
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const selectedDisplayNames: Record<string, string> = {};
      selectedInstanceIds.forEach(id => {
        selectedDisplayNames[id] = instanceDisplayNames[id] || instances.find(i => i.id === id)?.name || 'Bot';
      });

      const roles: Record<string, string> = {};
      selectedInstanceIds.forEach(id => {
        if (instanceRoles[id]) {
          roles[id] = instanceRoles[id];
        }
      });

      const request: CreateGroupChatRequest = {
        name: newChatName,
        instanceIds: Array.from(selectedInstanceIds),
        displayNames: selectedDisplayNames,
        roles: Object.keys(roles).length > 0 ? roles : undefined,
        defaultMentionMode: 'broadcast',
        maxBotChainDepth: 3
      };

      const chat = await api.post<GroupChat>('/group-chats', request);

      if (selectedHumans.length > 0) {
        await Promise.all(selectedHumans.map(human =>
          api.post(`/group-chats/${chat.id}/members`, {
            userId: human.id,
            displayName: human.displayName,
            isHuman: true
          } satisfies AddGroupChatMemberRequest)
        ));
      }

      setShowCreateModal(false);
      setNewChatName('');
      setSelectedInstanceIds(new Set());
      setInstanceDisplayNames({});
      setInstanceRoles({});
      setHumanSearchEmail('');
      setHumanSearchResults([]);
      setSelectedHumans([]);
      await fetchGroupChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('groupChat.create.failedToCreate'));
    } finally {
      setCreating(false);
    }
  };

  if (loading) return (
    <div className="dashboard-page">
      <PageHeaderSkeleton />
      <ListSkeleton rows={6} showIcon />
    </div>
  );

  return (
    <main className="dashboard-page">
      <PageHeader
        title={t('groupChat.list.title')}
        subtitle={t('groupChat.list.subtitle')}
        action={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            {t('groupChat.list.createButton')}
          </Button>
        }
      />

      {error && <div className="error-message" role="alert">{error}</div>}

      {groupChats.length === 0 && (
        <EmptyState
          icon={<MessageSquare size={24} />}
          title={t('groupChat.list.emptyTitle')}
          description={t('groupChat.list.emptyDescription')}
          action={
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus size={16} />
              {t('groupChat.list.createButton')}
            </Button>
          }
        />
      )}

      <div className="instances-grid">
        {groupChats.map(chat => (
          <Link key={chat.id} to={`/group-chats/${chat.id}`} className="instance-card">
            <div className="instance-header">
              <h3>{chat.name}</h3>
              <span className="status-badge status-running">
                {t('groupChat.list.memberCount', { count: chat.members.length })}
              </span>
            </div>
            <div className="instance-details">
              <p>{t('groupChat.list.created', { date: new Date(chat.createdAt).toLocaleDateString() })}</p>
              <p>{t('groupChat.list.mode', { mode: chat.defaultMentionMode })}</p>
            </div>
          </Link>
        ))}
      </div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="gc-create-dialog">
          <DialogHeader>
            <DialogTitle>{t('groupChat.create.title')}</DialogTitle>
            <DialogDescription>{t('groupChat.create.selectInstances')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="chat-name">{t('groupChat.create.chatNameLabel')}</label>
                <Input
                  type="text"
                  id="chat-name"
                  value={newChatName}
                  onChange={e => setNewChatName(e.target.value)}
                  required
                  placeholder={t('groupChat.create.chatNamePlaceholder')}
                />
              </div>

              <div className="form-group">
                <label>{t('groupChat.create.selectInstances')}</label>
                <div className="gc-list-dialog__instance-list">
                  {instances.length === 0 ? (
                    <p>{t('groupChat.create.noInstances')}</p>
                  ) : (
                    instances.map(inst => (
                      <div key={inst.id} className="gc-list-dialog__instance-item">
                        <div className="gc-list-dialog__instance-row">
                          <input type="checkbox"
                            id={`inst-${inst.id}`}
                            checked={selectedInstanceIds.has(inst.id)}
                            onChange={() => handleInstanceToggle(inst.id)}
                            className="gc-list-dialog__instance-checkbox"
                          />
                          <label htmlFor={`inst-${inst.id}`} className="gc-list-dialog__instance-label">
                            {inst.name}
                          </label>
                          <span className={`status-badge status-${inst.status} gc-list-dialog__instance-status`}>
                            {t('common.status.' + inst.status)}
                          </span>
                        </div>

                         {selectedInstanceIds.has(inst.id) && (
                           <div className="gc-list-dialog__instance-fields">
                             <div className="gc-list-dialog__field">
                               <label>{t('groupChat.create.displayNameInChat')}</label>
                               <Input
                                 type="text"
                                 value={instanceDisplayNames[inst.id] || ''}
                                 onChange={e => handleDisplayNameChange(inst.id, e.target.value)}
                                 placeholder={inst.name}
                               />
                             </div>
                             <div className="gc-list-dialog__field">
                               <label>{t('groupChat.create.roleLabel')}</label>
                               <Input
                                 type="text"
                                 value={instanceRoles[inst.id] || ''}
                                 onChange={e => handleRoleChange(inst.id, e.target.value)}
                                 placeholder={t('groupChat.create.rolePlaceholder')}
                               />
                             </div>
                           </div>
                         )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>{t('groupChat.create.inviteHumans')}</label>
                <Input
                  type="text"
                  value={humanSearchEmail}
                  onChange={e => setHumanSearchEmail(e.target.value)}
                  placeholder={t('groupChat.create.searchByEmail')}
                />
                {humanSearching && <div className="gc-list-dialog__search-hint">{t('groupChat.create.searching')}</div>}
                {humanSearchResults.length > 0 && (
                  <div className="gc-list-dialog__search-results">
                    {humanSearchResults.map(u => (
                      <div
                        key={u.id}
                        onClick={() => {
                          setSelectedHumans(prev => [...prev, u]);
                          setHumanSearchEmail('');
                          setHumanSearchResults([]);
                        }}
                        className="gc-list-dialog__search-item"
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedHumans(prev => [...prev, u]);
                            setHumanSearchEmail('');
                            setHumanSearchResults([]);
                          }
                        }}
                      >
                        {u.displayName} ({u.email})
                      </div>
                    ))}
                  </div>
                )}
                {selectedHumans.length > 0 && (
                  <div className="gc-list-dialog__selected-humans">
                    <label className="gc-list-dialog__selected-humans-label">{t('groupChat.create.selectedHumans')}</label>
                    <div className="gc-list-dialog__selected-chips">
                      {selectedHumans.map(h => (
                        <span key={h.id} className="status-badge status-running gc-list-dialog__chip">
                          {h.displayName}
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setSelectedHumans(prev => prev.filter(x => x.id !== h.id))}
                            aria-label={t('groupChat.create.removeHuman', { name: h.displayName })}
                          >
                            ×
                          </Button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {(selectedInstanceIds.size > 0 || selectedHumans.length > 0) && (
                <div className="gc-context-preview">
                  <div className="gc-context-preview-title">
                    {t('groupChat.create.preview', { name: newChatName || t('groupChat.create.untitledChat') })}
                  </div>
                  <div className="gc-context-preview-members">
                    {Array.from(selectedInstanceIds).map(instId => {
                      const inst = instances.find(i => i.id === instId);
                      const name = instanceDisplayNames[instId] || inst?.name || 'Bot';
                      const role = instanceRoles[instId];
                      return (
                        <div key={instId} className="gc-context-preview-member">
                          <span className="gc-context-preview-dot gc-context-preview-dot--bot" />
                          <span className="gc-context-preview-name">{name}</span>
                          {role && <span className="gc-context-preview-role">— {role}</span>}
                        </div>
                      );
                    })}
                    {selectedHumans.map(h => (
                      <div key={h.id} className="gc-context-preview-member">
                        <span className="gc-context-preview-dot gc-context-preview-dot--human" />
                        <span className="gc-context-preview-name">{h.displayName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)} disabled={creating}>{t('common.buttons.cancel')}</Button>
                <Button type="submit" disabled={creating || selectedInstanceIds.size === 0}>
                  {creating ? t('groupChat.create.creating') : selectedHumans.length > 0 ? t('groupChat.create.createAndInvite') : t('groupChat.create.createGroupChat')}
                </Button>
              </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
