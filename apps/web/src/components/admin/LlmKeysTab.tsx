import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type {
  AdminKeyInfo,
  AdminKeyCreateRequest,
  AdminKeyCreateResponse,
  AdminUser,
} from '@aquarium/shared';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';

interface LlmKeysTabProps {
  users: AdminUser[];
}

interface CreateForm {
  userId: string;
  models: string;
  maxBudget: string;
  keyAlias: string;
}

export function LlmKeysTab({ users }: LlmKeysTabProps) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<Record<string, AdminKeyInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    userId: users[0]?.id ?? '',
    models: '',
    maxBudget: '',
    keyAlias: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [editingKeyHash, setEditingKeyHash] = useState<string | null>(null);
  const [editBudgetValue, setEditBudgetValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshKeys = async () => {
    try {
      const data = await api.get<Record<string, AdminKeyInfo[]>>('/admin/keys');
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    }
  };

  useEffect(() => {
    api
      .get<Record<string, AdminKeyInfo[]>>('/admin/keys')
      .then(data => setKeys(data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load keys'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (actionError) {
      const timer = setTimeout(() => setActionError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionError]);

  const allKeys = Object.values(keys).flat();

  const filteredKeys =
    searchQuery.trim() === ''
      ? allKeys
      : allKeys.filter(k =>
          (k.userEmail ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        );

  const handleRevoke = async (key: AdminKeyInfo) => {
    if (!window.confirm(`Revoke key ${key.keyName}? This cannot be undone.`)) return;
    try {
      await api.delete<void>(`/admin/keys/${key.token}`);
      await refreshKeys();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  };

  const handleEditBudgetSave = async (keyHash: string) => {
    setEditSaving(true);
    try {
      const maxBudget =
        editBudgetValue.trim() === '' ? null : parseFloat(editBudgetValue) || null;
      await api.patch<AdminKeyInfo>(`/admin/keys/${keyHash}`, { maxBudget });
      await refreshKeys();
      setEditingKeyHash(null);
      setEditBudgetValue('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update budget');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.userId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body: AdminKeyCreateRequest = {
        userId: createForm.userId,
        ...(createForm.keyAlias.trim() && { keyAlias: createForm.keyAlias.trim() }),
        ...(createForm.models.trim() && {
          models: createForm.models
            .split(',')
            .map(m => m.trim())
            .filter(Boolean),
        }),
        ...(createForm.maxBudget.trim() && { maxBudget: parseFloat(createForm.maxBudget) }),
      };
      const response = await api.post<AdminKeyCreateResponse>('/admin/keys', body);
      setCreatedKey(response.key);
      setShowCreateModal(false);
      setCreateForm({ userId: users[0]?.id ?? '', models: '', maxBudget: '', keyAlias: '' });
      await refreshKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const formatSpend = (spend: number): string => {
    if (spend < 0.01 && spend > 0) return '$' + spend.toFixed(4);
    return '$' + spend.toFixed(2);
  };

  const truncate = (str: string, max: number): string =>
    str.length > max ? str.slice(0, max) + '...' : str;

  if (loading) return <TableSkeleton rows={5} columns={4} />;

  return (
    <div className="admin-keys-tab">
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {createdKey && (
        <div className="admin-key-created-banner">
          <strong>New key created!</strong> Copy it now — it won&apos;t be shown again:
          <code className="admin-key-value">{createdKey}</code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(createdKey);
            }}
          >
            Copy
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCreatedKey(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {actionError && (
        <div className="error-message" role="alert">
          {actionError}
        </div>
      )}

      <div className="admin-keys-toolbar">
        <Input
          type="text"
          placeholder="Filter by user email..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="admin-keys-search"
        />
        <Button onClick={() => setShowCreateModal(true)}>
          Create Key
        </Button>
      </div>

      {allKeys.length === 0 ? (
        <div className="admin-keys-empty">
          No virtual keys found. Create one to get started.
        </div>
      ) : (
        <div className="admin-users-table-wrapper">
          <table className="admin-users-table admin-keys-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Alias</th>
                <th>Key Name</th>
                <th>Spend</th>
                <th>Budget</th>
                <th>Models</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan={8} className="admin-keys-empty">
                    No keys match your filter.
                  </td>
                </tr>
              ) : (
                filteredKeys.map(key => (
                  <tr key={key.token}>
                    <td>{key.userEmail ?? '(unknown)'}</td>
                    <td>{key.keyAlias ?? '—'}</td>
                    <td>
                      <span title={key.keyName}>{truncate(key.keyName, 20)}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{formatSpend(key.spend)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {editingKeyHash === key.token ? (
                        <div className="inline-edit">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editBudgetValue}
                            onChange={e => setEditBudgetValue(e.target.value)}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            disabled={editSaving}
                            onClick={() => void handleEditBudgetSave(key.token)}
                          >
                            Save
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingKeyHash(null);
                              setEditBudgetValue('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : key.maxBudget != null ? (
                        '$' + key.maxBudget.toFixed(2)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span
                        className="models-cell"
                        title={key.models.length > 0 ? key.models.join(', ') : 'all'}
                      >
                        {key.models.length > 0 ? key.models.join(', ') : 'all'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-${key.status}`}>{t('common.status.' + key.status)}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingKeyHash(key.token);
                            setEditBudgetValue(
                              key.maxBudget != null ? String(key.maxBudget) : ''
                            );
                          }}
                        >
                          Edit Budget
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={key.status !== 'active'}
                          onClick={() => void handleRevoke(key)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showCreateModal} onOpenChange={(open) => {
        setShowCreateModal(open);
        if (!open) setCreateError(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Virtual Key</DialogTitle>
            <DialogDescription>
              Create a new virtual LLM API key for a user.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={e => void handleCreateSubmit(e)}>
            <div className="form-group">
              <label htmlFor="key-user-select">User *</label>
              <Select
                value={createForm.userId}
                onValueChange={(val) => setCreateForm(f => ({ ...f, userId: val }))}
              >
                <SelectTrigger id="key-user-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.email} ({u.displayName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="form-group">
              <label htmlFor="key-alias-input">Key Alias (optional)</label>
              <Input
                id="key-alias-input"
                type="text"
                value={createForm.keyAlias}
                onChange={e => setCreateForm(f => ({ ...f, keyAlias: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="key-models-input">Models (optional)</label>
              <Input
                id="key-models-input"
                type="text"
                placeholder="e.g. gpt-4o, claude-3.5-sonnet (leave empty for all)"
                value={createForm.models}
                onChange={e => setCreateForm(f => ({ ...f, models: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="key-budget-input">Max Budget (optional)</label>
              <Input
                id="key-budget-input"
                type="number"
                step="0.01"
                min="0"
                placeholder="No limit"
                value={createForm.maxBudget}
                onChange={e => setCreateForm(f => ({ ...f, maxBudget: e.target.value }))}
              />
            </div>
            {createError && (
              <div className="error-message" role="alert">
                {createError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create Key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
