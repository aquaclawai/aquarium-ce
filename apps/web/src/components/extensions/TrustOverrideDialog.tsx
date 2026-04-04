import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { ExtensionKind } from '@aquarium/shared';

interface TrustOverrideDialogProps {
  extensionId: string;
  extensionKind: ExtensionKind;
  extensionName: string;
  instanceId: string;
  onOverrideComplete: () => void;
  onCancel: () => void;
}

export function TrustOverrideDialog({
  extensionId,
  extensionKind,
  extensionName,
  instanceId,
  onOverrideComplete,
  onCancel,
}: TrustOverrideDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const canSubmit = acknowledged && reason.trim().length > 0;

  const handleApprove = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.put(
        `/instances/${instanceId}/${extensionKind}s/${extensionId}/trust-override`,
        { action: 'allow', reason: reason.trim(), credentialAccessAcknowledged: true }
      );
      onOverrideComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('extensions.errors.fetchFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="install-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="trust-override-dialog-title">
      <div className="install-dialog trust-override-dialog">
        <div className="install-dialog__header">
          <h2 id="trust-override-dialog-title" className="install-dialog__title">
            {t('extensions.trust.override')}: {extensionName}
          </h2>
        </div>

        <div className="install-dialog__body">
          <p className="trust-override-dialog__warning">
            {t('extensions.trust.credentialAccessWarning')}
          </p>

          <label className="trust-override-dialog__acknowledge">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={submitting}
            />
            <span>{t('extensions.trust.acknowledgeCheckbox')}</span>
          </label>

          <div className="credential-panel__field">
            <label className="credential-panel__label" htmlFor="override-reason">
              {t('extensions.trust.reasonPlaceholder')}
            </label>
            <textarea
              id="override-reason"
              className="credential-panel__input trust-override-dialog__reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('extensions.trust.reasonPlaceholder')}
              rows={3}
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="credential-panel__error">{error}</p>
          )}
        </div>

        <div className="install-dialog__footer">
          <button
            className="btn btn--sm btn--cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            {t('extensions.installDialog.cancel')}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => { void handleApprove(); }}
            disabled={!canSubmit || submitting}
          >
            {submitting ? t('extensions.actions.installing') : t('extensions.trust.approveOverride')}
          </button>
        </div>
      </div>
    </div>
  );
}
