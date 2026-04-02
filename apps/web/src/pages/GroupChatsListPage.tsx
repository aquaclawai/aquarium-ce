import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { InstancePublic, GroupChat, CreateGroupChatRequest, UserSearchResult, AddGroupChatMemberRequest } from '@aquarium/shared';
import './group-chat.css';

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

  if (loading) return <div className="dashboard-page">{t('groupChat.list.loading')}</div>;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <h1>{t('groupChat.list.title')}</h1>
        <div className="dashboard-header-actions">
          <button onClick={() => setShowCreateModal(true)}>{t('groupChat.list.createButton')}</button>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      {groupChats.length === 0 && (
        <div className="info-message">{t('groupChat.list.noChats')}</div>
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

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-chat-title" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <h2 id="create-chat-title">{t('groupChat.create.title')}</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="chat-name">{t('groupChat.create.chatNameLabel')}</label>
                <input
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
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ccc', padding: '10px', borderRadius: '4px' }}>
                  {instances.length === 0 ? (
                    <p>{t('groupChat.create.noInstances')}</p>
                  ) : (
                    instances.map(inst => (
                      <div key={inst.id} style={{ marginBottom: '10px', padding: '8px', borderBottom: '1px solid #eee' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                          <input
                            type="checkbox"
                            id={`inst-${inst.id}`}
                            checked={selectedInstanceIds.has(inst.id)}
                            onChange={() => handleInstanceToggle(inst.id)}
                            style={{ marginRight: '10px' }}
                          />
                          <label htmlFor={`inst-${inst.id}`} style={{ fontWeight: 'bold', flex: 1 }}>
                            {inst.name}
                          </label>
                          <span className={`status-badge status-${inst.status}`} style={{ fontSize: '0.8em' }}>
                            {t('common.status.' + inst.status)}
                          </span>
                        </div>

                         {selectedInstanceIds.has(inst.id) && (
                           <div style={{ marginLeft: '25px' }}>
                             <label style={{ fontSize: '0.9em', display: 'block', marginBottom: '2px' }}>{t('groupChat.create.displayNameInChat')}</label>
                             <input
                               type="text"
                               value={instanceDisplayNames[inst.id] || ''}
                               onChange={e => handleDisplayNameChange(inst.id, e.target.value)}
                               placeholder={inst.name}
                               style={{ width: '100%', padding: '4px' }}
                             />
                             <div style={{ marginTop: '5px' }}>
                               <label style={{ fontSize: '0.9em', display: 'block', marginBottom: '2px' }}>{t('groupChat.create.roleLabel')}</label>
                               <input
                                 type="text"
                                 value={instanceRoles[inst.id] || ''}
                                 onChange={e => handleRoleChange(inst.id, e.target.value)}
                                 placeholder={t('groupChat.create.rolePlaceholder')}
                                 style={{ width: '100%', padding: '4px' }}
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
                <input
                  type="text"
                  value={humanSearchEmail}
                  onChange={e => setHumanSearchEmail(e.target.value)}
                  placeholder={t('groupChat.create.searchByEmail')}
                />
                {humanSearching && <div style={{ fontSize: '0.8em', color: '#666', marginTop: '4px' }}>{t('groupChat.create.searching')}</div>}
                {humanSearchResults.length > 0 && (
                  <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #ccc', marginTop: '5px', borderRadius: '4px' }}>
                    {humanSearchResults.map(u => (
                      <div
                        key={u.id}
                        onClick={() => {
                          setSelectedHumans(prev => [...prev, u]);
                          setHumanSearchEmail('');
                          setHumanSearchResults([]);
                        }}
                        style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
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
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontSize: '0.9em' }}>{t('groupChat.create.selectedHumans')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '5px' }}>
                      {selectedHumans.map(h => (
                        <span key={h.id} className="status-badge status-running" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          {h.displayName}
                          <button
                            type="button"
                            onClick={() => setSelectedHumans(prev => prev.filter(x => x.id !== h.id))}
                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '1.2em', lineHeight: 1 }}
                            aria-label={t('groupChat.create.removeHuman', { name: h.displayName })}
                          >
                            ×
                          </button>
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

              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} disabled={creating}>{t('common.buttons.cancel')}</button>
                <button type="submit" disabled={creating || selectedInstanceIds.size === 0}>
                  {creating ? t('groupChat.create.creating') : selectedHumans.length > 0 ? t('groupChat.create.createAndInvite') : t('groupChat.create.createGroupChat')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
