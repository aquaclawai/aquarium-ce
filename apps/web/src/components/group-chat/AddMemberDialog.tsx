import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupChat, InstancePublic, UserSearchResult } from '@aquarium/shared';
import { api } from '../../api';
import './group-chat.css';

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chat: GroupChat | null;
  onMemberAdded: (updatedChat: GroupChat) => void;
}

export function AddMemberDialog({ open, onOpenChange, chat, onMemberAdded }: AddMemberDialogProps) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<'bot' | 'human'>('bot');
  const [availableInstances, setAvailableInstances] = useState<InstancePublic[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [newMemberDisplayName, setNewMemberDisplayName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const [searchEmail, setSearchEmail] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);

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
    if (open) {
      fetchInstances();
    }
  }, [open, fetchInstances]);

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

  const resetForm = () => {
    setSelectedInstanceId('');
    setNewMemberDisplayName('');
    setNewMemberRole('');
    setSearchEmail('');
    setSearchResults([]);
    setSelectedUser(null);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleTabSwitch = (tab: 'bot' | 'human') => {
    setActiveTab(tab);
    setNewMemberDisplayName('');
    setSearchEmail('');
    setSearchResults([]);
    setSelectedUser(null);
  };

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
      onMemberAdded(updatedChat);
      handleClose();
    } catch (err) {
      console.error('Failed to add member:', err);
      setError(t('groupChat.detail.failedToAddMember'));
    } finally {
      setAddingMember(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <h2>{t('groupChat.members.addTitle')}</h2>

        {error && <div className="error-message" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div className="gc-tab-bar">
          <button
            onClick={() => handleTabSwitch('bot')}
            className={`gc-tab ${activeTab === 'bot' ? 'gc-tab--active' : ''}`}
          >
            {t('groupChat.members.tabBot')}
          </button>
          <button
            onClick={() => handleTabSwitch('human')}
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
            <button type="button" onClick={handleClose} className="btn-secondary">{t('groupChat.members.cancel')}</button>
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
  );
}
