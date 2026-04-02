import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { UserCredentialExtended, CredentialRole, CredentialStatus } from '@aquarium/shared';
import './CredentialsPage.css';

const PROVIDERS = ['openai', 'anthropic', 'google', 'azure', 'deepseek', 'groq', 'mistral', 'xai', 'custom'] as const;
const CRED_TYPES = ['api_key', 'refresh_token', 'oauth_token'] as const;
const ROLES: CredentialRole[] = ['default', 'backup', 'dedicated'];

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4a574',
  google: '#4285f4',
  azure: '#0078d4',
  deepseek: '#536dfe',
  groq: '#f55036',
  mistral: '#ff7000',
  xai: '#1d9bf0',
  custom: '#78716c',
};

interface CredentialForm {
  provider: string;
  credentialType: string;
  displayName: string;
  value: string;
  role: CredentialRole;
}

const EMPTY_FORM: CredentialForm = {
  provider: 'openai',
  credentialType: 'api_key',
  displayName: '',
  value: '',
  role: 'default',
};

export function CredentialsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'credentials' | 'subscriptions'>('credentials');
  const [credentials, setCredentials] = useState<UserCredentialExtended[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadCredentials = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<UserCredentialExtended[]>('/credentials');
      setCredentials(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('credentials.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEditModal = (cred: UserCredentialExtended) => {
    setEditingId(cred.id);
    setForm({
      provider: cred.provider,
      credentialType: cred.credentialType,
      displayName: cred.displayName ?? '',
      value: '',
      role: cred.role,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        const updated = await api.put<UserCredentialExtended>(`/credentials/${editingId}`, {
          displayName: form.displayName || undefined,
          value: form.value || undefined,
          role: form.role,
        });
        setCredentials(prev => prev.map(c => (c.id === editingId ? updated : c)));
      } else {
        const created = await api.post<UserCredentialExtended>('/credentials', {
          provider: form.provider,
          credentialType: form.credentialType,
          displayName: form.displayName || undefined,
          value: form.value,
          role: form.role,
        });
        setCredentials(prev => [...prev, created]);
      }
      showMessage('success', t('credentials.saveSuccess'));
      setModalOpen(false);
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('credentials.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (cred: UserCredentialExtended) => {
    const newStatus: CredentialStatus = cred.status === 'active' ? 'disabled' : 'active';
    try {
      const updated = await api.put<UserCredentialExtended>(`/credentials/${cred.id}/status`, { status: newStatus });
      setCredentials(prev => prev.map(c => (c.id === cred.id ? updated : c)));
      showMessage('success', t('credentials.statusUpdateSuccess'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('credentials.failedToUpdateStatus'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/credentials/${id}`);
      setCredentials(prev => prev.filter(c => c.id !== id));
      showMessage('success', t('credentials.deleteSuccess'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : t('credentials.failedToDelete'));
    } finally {
      setDeleteConfirmId(null);
    }
  };

  return (
    <main className="creds-page">
      <header className="creds-page__header">
        <div className="creds-page__header-left">
          <h1>{t('credentials.title')}</h1>
          <p className="creds-page__subtitle">{t('credentials.subtitle')}</p>
        </div>
        {activeTab === 'credentials' && (
          <button className="creds-page__btn creds-page__btn--primary" onClick={openAddModal}>
            + {t('credentials.addCredential')}
          </button>
        )}
      </header>

      <div className="creds-page__tabs">
        <button
          className={`creds-page__tab ${activeTab === 'credentials' ? 'creds-page__tab--active' : ''}`}
          onClick={() => setActiveTab('credentials')}
        >
          {t('credentials.tabs.myCredentials')}
        </button>
        <button
          className={`creds-page__tab ${activeTab === 'subscriptions' ? 'creds-page__tab--active' : ''}`}
          onClick={() => setActiveTab('subscriptions')}
        >
          {t('credentials.tabs.mySubscriptions')}
        </button>
      </div>

      {message && (
        <div className={`creds-page__message creds-page__message--${message.type}`}>
          {message.text}
        </div>
      )}

      {activeTab === 'credentials' && (
        <div className="creds-page__content">
          {loading ? (
            <div className="creds-page__loading">{t('common.loading')}</div>
          ) : error ? (
            <div className="creds-page__error">
              {error}
              <button className="creds-page__btn creds-page__btn--secondary" onClick={loadCredentials}>
                {t('common.buttons.retry')}
              </button>
            </div>
          ) : credentials.length === 0 ? (
            <div className="creds-page__empty">
              <p className="creds-page__empty-title">{t('credentials.noCredentials')}</p>
              <p className="creds-page__empty-desc">{t('credentials.noCredentialsDesc')}</p>
              <button className="creds-page__btn creds-page__btn--primary" onClick={openAddModal}>
                + {t('credentials.addCredential')}
              </button>
            </div>
          ) : (
            <>
              <div className="creds-page__grid">
                {credentials.map(cred => (
                  <div key={cred.id} className={`creds-card ${cred.status === 'disabled' ? 'creds-card--disabled' : ''}`}>
                    <div className="creds-card__header">
                      <div className="creds-card__provider">
                        <span
                          className="creds-card__provider-dot"
                          style={{ background: PROVIDER_COLORS[cred.provider] ?? PROVIDER_COLORS.custom }}
                        />
                        <span className="creds-card__provider-name">
                          {t(`credentials.providerOptions.${cred.provider}`, cred.provider)}
                        </span>
                      </div>
                      <div className="creds-card__badges">
                        <span className={`creds-card__badge creds-card__badge--role-${cred.role}`}>
                          {t(`credentials.role.${cred.role}`)}
                        </span>
                        <span className={`creds-card__badge creds-card__badge--status-${cred.status}`}>
                          {t(`credentials.status.${cred.status}`)}
                        </span>
                      </div>
                    </div>

                    <div className="creds-card__body">
                      {cred.displayName && (
                        <div className="creds-card__name">{cred.displayName}</div>
                      )}
                      <div className="creds-card__type">
                        {t(`credentials.typeOptions.${cred.credentialType}`, cred.credentialType)}
                      </div>
                      {cred.maskedValue && (
                        <div className="creds-card__masked">{cred.maskedValue}</div>
                      )}
                      <div className="creds-card__usage">
                        {t('credentials.usageCount')}: {cred.usageCount}
                      </div>
                    </div>

                    <div className="creds-card__actions">
                      <button
                        className="creds-page__btn creds-page__btn--secondary creds-page__btn--sm"
                        onClick={() => handleToggleStatus(cred)}
                      >
                        {cred.status === 'active' ? t('credentials.disableCredential') : t('credentials.enableCredential')}
                      </button>
                      <button
                        className="creds-page__btn creds-page__btn--secondary creds-page__btn--sm"
                        onClick={() => openEditModal(cred)}
                      >
                        {t('credentials.editCredential')}
                      </button>
                      <button
                        className="creds-page__btn creds-page__btn--danger creds-page__btn--sm"
                        onClick={() => setDeleteConfirmId(cred.id)}
                      >
                        {t('common.buttons.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="creds-page__security-tip">{t('credentials.securityTip')}</div>
            </>
          )}
        </div>
      )}

      {activeTab === 'subscriptions' && (
        <div className="creds-page__content">
          <div className="creds-page__empty">
            <p className="creds-page__empty-title">{t('credentials.subscriptions.noSubscriptions')}</p>
            <p className="creds-page__empty-desc">{t('credentials.subscriptions.noSubscriptionsDesc')}</p>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal creds-modal" onClick={e => e.stopPropagation()}>
            <h2>{editingId ? t('credentials.editCredential') : t('credentials.addCredential')}</h2>

            <div className="creds-modal__field">
              <label>{t('credentials.provider')}</label>
              <select
                value={form.provider}
                onChange={e => setForm(prev => ({ ...prev, provider: e.target.value }))}
                disabled={!!editingId}
              >
                {PROVIDERS.map(p => (
                  <option key={p} value={p}>
                    {t(`credentials.providerOptions.${p}`, p)}
                  </option>
                ))}
              </select>
            </div>

            <div className="creds-modal__field">
              <label>{t('credentials.credentialType')}</label>
              <select
                value={form.credentialType}
                onChange={e => setForm(prev => ({ ...prev, credentialType: e.target.value }))}
                disabled={!!editingId}
              >
                {CRED_TYPES.map(ct => (
                  <option key={ct} value={ct}>
                    {t(`credentials.typeOptions.${ct}`, ct)}
                  </option>
                ))}
              </select>
            </div>

            <div className="creds-modal__field">
              <label>{t('credentials.displayName')}</label>
              <input
                type="text"
                value={form.displayName}
                onChange={e => setForm(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder={t('credentials.displayNamePlaceholder')}
              />
            </div>

            <div className="creds-modal__field">
              <label>{t('credentials.value')}</label>
              <input
                type="password"
                value={form.value}
                onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
                placeholder={editingId ? '••••••••' : t('credentials.valuePlaceholder')}
                required={!editingId}
              />
              <span className="creds-modal__help">{t('credentials.valueHelpText')}</span>
            </div>

            <div className="creds-modal__field">
              <label>{t('credentials.role.label')}</label>
              <select
                value={form.role}
                onChange={e => setForm(prev => ({ ...prev, role: e.target.value as CredentialRole }))}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {t(`credentials.role.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="creds-page__btn creds-page__btn--secondary" onClick={() => setModalOpen(false)}>
                {t('common.buttons.cancel')}
              </button>
              <button
                className="creds-page__btn creds-page__btn--primary"
                onClick={handleSave}
                disabled={saving || (!editingId && !form.value)}
              >
                {saving ? t('common.buttons.saving') : t('common.buttons.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal creds-modal" onClick={e => e.stopPropagation()}>
            <h2>{t('common.buttons.delete')}</h2>
            <p>{t('credentials.deleteConfirm')}</p>
            <div className="modal-actions">
              <button className="creds-page__btn creds-page__btn--secondary" onClick={() => setDeleteConfirmId(null)}>
                {t('common.buttons.cancel')}
              </button>
              <button className="creds-page__btn creds-page__btn--danger" onClick={() => handleDelete(deleteConfirmId)}>
                {t('common.buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
