import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';

interface VaultConfigSectionProps {
  instanceId: string;
  disabled?: boolean;
}

type VaultType = 'onepassword' | 'hashicorp';
type HashiAuthMethod = 'token' | 'approle' | 'cli';

interface VaultConfig {
  type: VaultType;
  address?: string;
  namespace?: string;
  authMethod?: HashiAuthMethod;
  mountPath?: string;
}

export function VaultConfigSection({ instanceId, disabled }: VaultConfigSectionProps) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [formType, setFormType] = useState<VaultType>('onepassword');
  const [formAddress, setFormAddress] = useState('');
  const [formNamespace, setFormNamespace] = useState('');
  const [formAuthMethod, setFormAuthMethod] = useState<HashiAuthMethod>('token');
  const [formMountPath, setFormMountPath] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get<{ vaultConfig: VaultConfig | null }>(`/instances/${instanceId}/vault-config`)
      .then(data => {
        setVaultConfig(data.vaultConfig);
        if (data.vaultConfig) {
          setFormType(data.vaultConfig.type);
          setFormAddress(data.vaultConfig.address ?? '');
          setFormNamespace(data.vaultConfig.namespace ?? '');
          setFormAuthMethod(data.vaultConfig.authMethod ?? 'token');
          setFormMountPath(data.vaultConfig.mountPath ?? '');
        }
      })
      .catch(() => setVaultConfig(null))
      .finally(() => setLoading(false));
  }, [instanceId]);

  const handleEdit = () => {
    if (vaultConfig) {
      setFormType(vaultConfig.type);
      setFormAddress(vaultConfig.address ?? '');
      setFormNamespace(vaultConfig.namespace ?? '');
      setFormAuthMethod(vaultConfig.authMethod ?? 'token');
      setFormMountPath(vaultConfig.mountPath ?? '');
    } else {
      setFormType('onepassword');
      setFormAddress('');
      setFormNamespace('');
      setFormAuthMethod('token');
      setFormMountPath('');
    }
    setEditing(true);
    setError(null);
    setSuccessMessage(null);
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
    setSuccessMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const body: Record<string, unknown> = { type: formType };
      if (formType === 'hashicorp') {
        if (formAddress.trim()) body.address = formAddress.trim();
        if (formNamespace.trim()) body.namespace = formNamespace.trim();
        body.authMethod = formAuthMethod;
        if (formMountPath.trim()) body.mountPath = formMountPath.trim();
      }
      const data = await api.put<{ vaultConfig: VaultConfig }>(`/instances/${instanceId}/vault-config`, body);
      setVaultConfig(data.vaultConfig);
      setEditing(false);
      setSuccessMessage(t('extensions.vault.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.vault.save'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t('extensions.vault.removeConfirm'))) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.delete(`/instances/${instanceId}/vault-config`);
      setVaultConfig(null);
      setEditing(false);
      setSuccessMessage(t('extensions.vault.removed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.vault.remove'));
    } finally {
      setSaving(false);
    }
  };

  const vaultTypeLabel = (type: VaultType) =>
    type === 'onepassword' ? t('extensions.vault.onepassword') : t('extensions.vault.hashicorp');

  if (loading) {
    return (
      <div className="vault-config-section">
        <div className="vault-config-section__header">
          <h4 className="vault-config-section__title">{t('extensions.vault.title')}</h4>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
          {t('common.loading')}
        </p>
      </div>
    );
  }

  return (
    <div className="vault-config-section">
      <div className="vault-config-section__header">
        <h4 className="vault-config-section__title">{t('extensions.vault.title')}</h4>
        <div className="vault-config-section__status">
          {vaultConfig && !editing && (
            <span className="vault-config-section__configured">
              {vaultTypeLabel(vaultConfig.type)}
            </span>
          )}
          {!editing && (
            <button
              className="btn btn--sm btn--cancel"
              onClick={handleEdit}
              disabled={disabled || saving}
            >
              {vaultConfig ? t('extensions.vault.edit') : t('extensions.vault.configure')}
            </button>
          )}
          {!editing && vaultConfig && (
            <button
              className="btn btn--sm btn--cancel"
              onClick={() => void handleRemove()}
              disabled={disabled || saving}
            >
              {t('extensions.vault.remove')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="vault-config-section__error" role="alert">{error}</p>
      )}
      {successMessage && (
        <p className="vault-config-section__success" role="status">{successMessage}</p>
      )}

      {editing && (
        <div className="vault-config-form">
          {/* Vault Type */}
          <div className="credential-panel__field">
            <label htmlFor={`vault-type-${instanceId}`} className="credential-panel__label">
              {t('extensions.vault.type')}
            </label>
            <select
              id={`vault-type-${instanceId}`}
              className="credential-panel__input"
              value={formType}
              onChange={(e) => setFormType(e.target.value as VaultType)}
              disabled={disabled || saving}
            >
              <option value="onepassword">{t('extensions.vault.onepassword')}</option>
              <option value="hashicorp">{t('extensions.vault.hashicorp')}</option>
            </select>
          </div>

          {formType === 'onepassword' && (
            <p className="vault-config-section__note">{t('extensions.vault.opNote')}</p>
          )}

          {formType === 'hashicorp' && (
            <>
              <div className="credential-panel__field">
                <label htmlFor={`vault-address-${instanceId}`} className="credential-panel__label">
                  {t('extensions.vault.address')}
                </label>
                <input
                  id={`vault-address-${instanceId}`}
                  type="text"
                  className="credential-panel__input"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder={t('extensions.vault.addressPlaceholder')}
                  disabled={disabled || saving}
                />
              </div>

              <div className="credential-panel__field">
                <label htmlFor={`vault-namespace-${instanceId}`} className="credential-panel__label">
                  {t('extensions.vault.namespace')}
                </label>
                <input
                  id={`vault-namespace-${instanceId}`}
                  type="text"
                  className="credential-panel__input"
                  value={formNamespace}
                  onChange={(e) => setFormNamespace(e.target.value)}
                  placeholder={t('extensions.vault.namespacePlaceholder')}
                  disabled={disabled || saving}
                />
              </div>

              <div className="credential-panel__field">
                <label htmlFor={`vault-auth-${instanceId}`} className="credential-panel__label">
                  {t('extensions.vault.authMethod')}
                </label>
                <select
                  id={`vault-auth-${instanceId}`}
                  className="credential-panel__input"
                  value={formAuthMethod}
                  onChange={(e) => setFormAuthMethod(e.target.value as HashiAuthMethod)}
                  disabled={disabled || saving}
                >
                  <option value="token">{t('extensions.vault.authToken')}</option>
                  <option value="approle">{t('extensions.vault.authAppRole')}</option>
                  <option value="cli">{t('extensions.vault.authCli')}</option>
                </select>
              </div>

              <div className="credential-panel__field">
                <label htmlFor={`vault-mount-${instanceId}`} className="credential-panel__label">
                  {t('extensions.vault.mountPath')}
                </label>
                <input
                  id={`vault-mount-${instanceId}`}
                  type="text"
                  className="credential-panel__input"
                  value={formMountPath}
                  onChange={(e) => setFormMountPath(e.target.value)}
                  placeholder={t('extensions.vault.mountPathPlaceholder')}
                  disabled={disabled || saving}
                />
              </div>

              <p className="vault-config-section__note">{t('extensions.vault.vaultNote')}</p>
            </>
          )}

          <div className="vault-config-section__actions">
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void handleSave()}
              disabled={disabled || saving || (formType === 'hashicorp' && !formAddress.trim())}
            >
              {saving ? t('extensions.vault.saving') : t('extensions.vault.save')}
            </button>
            <button
              className="btn btn--sm btn--cancel"
              onClick={handleCancel}
              disabled={saving}
            >
              {t('common.buttons.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
