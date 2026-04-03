import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { ExtensionStatus } from '@aquarium/shared';

interface CredentialConfigPanelProps {
  instanceId: string;
  skillId: string;
  skillName: string;
  status: ExtensionStatus;
  onClose: () => void;
  onSaved: () => void;
  disabled: boolean;
}

export function CredentialConfigPanel({
  instanceId,
  skillId,
  skillName,
  status,
  onClose,
  onSaved,
  disabled,
}: CredentialConfigPanelProps) {
  const { t } = useTranslation();
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    if (!field.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.post(`/instances/${instanceId}/extension-credentials`, {
        provider: skillId,
        credentialType: 'api_key',
        value,
        extensionKind: 'skill',
        extensionId: skillId,
        targetField: field,
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.credentials.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="credential-panel" role="region" aria-label={t('extensions.credentials.title')}>
      <div className="credential-panel__header">
        <h4 className="credential-panel__title">
          {t('extensions.credentials.title')}: {skillName}
        </h4>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t('extensions.actions.configure')}
          title={t('extensions.actions.configure')}
        >
          &times;
        </button>
      </div>

      {status === 'installed' && (
        <p className="credential-panel__hint">
          {t('extensions.credentials.requiresCredentials')}
        </p>
      )}

      <div className="credential-panel__form">
        <div className="credential-panel__field">
          <label htmlFor={`cred-field-${skillId}`} className="credential-panel__label">
            {t('extensions.credentials.fieldLabel')}
          </label>
          <input
            id={`cred-field-${skillId}`}
            type="text"
            className="credential-panel__input"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="OPENAI_API_KEY"
            disabled={disabled || saving}
          />
        </div>

        <div className="credential-panel__field">
          <label htmlFor={`cred-value-${skillId}`} className="credential-panel__label">
            {t('extensions.credentials.valueLabel')}
          </label>
          <input
            id={`cred-value-${skillId}`}
            type="password"
            className="credential-panel__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            disabled={disabled || saving}
          />
        </div>
      </div>

      {error && (
        <p className="credential-panel__error" role="alert">{error}</p>
      )}
      {success && (
        <p className="credential-panel__success" role="status">{t('extensions.credentials.saved')}</p>
      )}

      <div className="credential-panel__actions">
        <button
          className="btn btn--primary btn--sm"
          onClick={() => void handleSave()}
          disabled={disabled || saving || !field.trim() || !value.trim()}
        >
          {saving ? t('extensions.credentials.saving') : t('extensions.credentials.save')}
        </button>
      </div>
    </div>
  );
}
