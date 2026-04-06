import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, KeyRound } from 'lucide-react';
import { api } from '../api';
import type { UserCredentialExtended, CredentialRole, CredentialStatus } from '@aquarium/shared';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { TabsSkeleton, CardSkeleton } from '@/components/skeletons';
import './CredentialsPage.css';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';

const PROVIDERS = ['openai', 'anthropic', 'google', 'azure', 'deepseek', 'groq', 'mistral', 'xai', 'feishu', 'dingtalk', 'wecom', 'tikhub', 'custom'] as const;
const CRED_TYPES = ['api_key', 'refresh_token', 'oauth_token', 'webhook_url'] as const;
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
  feishu: '#3370ff',
  dingtalk: '#0089ff',
  wecom: '#07c160',
  tikhub: '#ff4757',
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
      <PageHeader
        title={t('credentials.title')}
        subtitle={t('credentials.subtitle')}
        action={
          activeTab === 'credentials' ? (
            <Button onClick={openAddModal}>
              <Plus size={16} />
              {t('credentials.addCredential')}
            </Button>
          ) : undefined
        }
      />

      <div className="creds-page__tabs">
        <Button
          variant="ghost"
          className={`creds-page__tab ${activeTab === 'credentials' ? 'creds-page__tab--active' : ''}`}
          onClick={() => setActiveTab('credentials')}
        >
          {t('credentials.tabs.myCredentials')}
        </Button>
        <Button
          variant="ghost"
          className={`creds-page__tab ${activeTab === 'subscriptions' ? 'creds-page__tab--active' : ''}`}
          onClick={() => setActiveTab('subscriptions')}
        >
          {t('credentials.tabs.mySubscriptions')}
        </Button>
      </div>

      {message && (
        <div className={`creds-page__message creds-page__message--${message.type}`}>
          {message.text}
        </div>
      )}

      {activeTab === 'credentials' && (
        <div className="creds-page__content">
          {loading ? (
            <>
              <TabsSkeleton count={2} />
              <div className="creds-page__grid">
                {Array.from({ length: 4 }, (_, i) => (
                  <CardSkeleton key={i} lines={4} showBadge showAction />
                ))}
              </div>
            </>
          ) : error ? (
            <div className="creds-page__error">
              {error}
              <Button variant="secondary" onClick={loadCredentials}>
                {t('common.buttons.retry')}
              </Button>
            </div>
          ) : credentials.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={24} />}
              title={t('credentials.emptyTitle')}
              description={t('credentials.emptyDescription')}
              action={
                <Button onClick={openAddModal}>
                  <Plus size={16} />
                  {t('credentials.addCredential')}
                </Button>
              }
            />
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
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleToggleStatus(cred)}
                      >
                        {cred.status === 'active' ? t('credentials.disableCredential') : t('credentials.enableCredential')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditModal(cred)}
                      >
                        {t('credentials.editCredential')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteConfirmId(cred.id)}
                      >
                        {t('common.buttons.delete')}
                      </Button>
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
          <EmptyState
            icon={<KeyRound size={24} />}
            title={t('credentials.subscriptions.emptyTitle')}
            description={t('credentials.subscriptions.emptyDescription')}
          />
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="creds-modal">
          <DialogHeader>
            <DialogTitle>{editingId ? t('credentials.editCredential') : t('credentials.addCredential')}</DialogTitle>
            <DialogDescription>{t('credentials.valueHelpText')}</DialogDescription>
          </DialogHeader>

          <div className="creds-modal__field">
            <label>{t('credentials.provider')}</label>
            <Select
              value={form.provider}
              onValueChange={value => setForm(prev => ({ ...prev, provider: value }))}
              disabled={!!editingId}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map(p => (
                  <SelectItem key={p} value={p}>
                    {t(`credentials.providerOptions.${p}`, p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="creds-modal__field">
            <label>{t('credentials.credentialType')}</label>
            <Select
              value={form.credentialType}
              onValueChange={value => setForm(prev => ({ ...prev, credentialType: value }))}
              disabled={!!editingId}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRED_TYPES.map(ct => (
                  <SelectItem key={ct} value={ct}>
                    {t(`credentials.typeOptions.${ct}`, ct)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="creds-modal__field">
            <label>{t('credentials.displayName')}</label>
            <Input
              type="text"
              value={form.displayName}
              onChange={e => setForm(prev => ({ ...prev, displayName: e.target.value }))}
              placeholder={t('credentials.displayNamePlaceholder')}
            />
          </div>

          <div className="creds-modal__field">
            <label>{t('credentials.value')}</label>
            <Input
              type="password"
              value={form.value}
              onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
              placeholder={editingId ? '••••••••' : t('credentials.valuePlaceholder')}
              required={!editingId}
            />
          </div>

          <div className="creds-modal__field">
            <label>{t('credentials.role.label')}</label>
            <Select
              value={form.role}
              onValueChange={value => setForm(prev => ({ ...prev, role: value as CredentialRole }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map(r => (
                  <SelectItem key={r} value={r}>
                    {t(`credentials.role.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t('common.buttons.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!editingId && !form.value)}
            >
              {saving ? t('common.buttons.saving') : t('common.buttons.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="creds-modal">
          <DialogHeader>
            <DialogTitle>{t('common.buttons.delete')}</DialogTitle>
            <DialogDescription>{t('credentials.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteConfirmId(null)}>
              {t('common.buttons.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteConfirmId!)}>
              {t('common.buttons.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
