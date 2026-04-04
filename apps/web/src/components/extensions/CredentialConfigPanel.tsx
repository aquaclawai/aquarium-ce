import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { ExtensionStatus, ExtensionKind, TrustOverride } from '@aquarium/shared';

interface UpgradeCheckResult {
  upToDate: boolean;
  currentVersion?: string;
  newVersion?: string;
}

interface CredentialConfigPanelProps {
  instanceId: string;
  extensionId: string;
  extensionName: string;
  extensionKind: ExtensionKind;
  status: ExtensionStatus;
  onClose: () => void;
  onSaved: () => void;
  disabled: boolean;
  lockedVersion?: string | null;
  integrityHash?: string | null;
  trustOverride?: TrustOverride | null;
}

function truncateHash(hash: string): string {
  // Remove "sha512-" prefix if present for display, then truncate
  const raw = hash.startsWith('sha512-') ? hash.slice(7) : hash;
  if (raw.length <= 24) return `sha512-${raw}`;
  return `sha512-${raw.slice(0, 16)}...${raw.slice(-8)}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function CredentialConfigPanel({
  instanceId,
  extensionId,
  extensionName,
  extensionKind,
  status,
  onClose,
  onSaved,
  disabled,
  lockedVersion,
  integrityHash,
  trustOverride,
}: CredentialConfigPanelProps) {
  const { t } = useTranslation();
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Upgrade workflow state
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [upgradeAvailable, setUpgradeAvailable] = useState<{ currentVersion: string; newVersion: string } | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradedVersion, setUpgradedVersion] = useState<string | null>(null);

  const handleSave = async () => {
    if (!field.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.post(`/instances/${instanceId}/extension-credentials`, {
        provider: extensionId,
        credentialType: 'api_key',
        value,
        extensionKind,
        extensionId,
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

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    setUpgradeAvailable(null);
    setUpToDate(false);
    setUpgradeError(null);
    setUpgradedVersion(null);
    try {
      const kindSegment = extensionKind === 'plugin' ? 'plugins' : 'skills';
      const result = await api.put<UpgradeCheckResult>(
        `/instances/${instanceId}/${kindSegment}/${extensionId}/upgrade`,
        { dryRun: true }
      );
      if (result.upToDate) {
        setUpToDate(true);
      } else if (result.currentVersion && result.newVersion) {
        setUpgradeAvailable({ currentVersion: result.currentVersion, newVersion: result.newVersion });
      } else {
        setUpToDate(true);
      }
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : t('extensions.version.upgradeFailed'));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const kindSegment = extensionKind === 'plugin' ? 'plugins' : 'skills';
      const result = await api.put<UpgradeCheckResult>(
        `/instances/${instanceId}/${kindSegment}/${extensionId}/upgrade`,
        { dryRun: false }
      );
      const newVer = result.newVersion ?? upgradeAvailable?.newVersion ?? '';
      setUpgradedVersion(newVer);
      setUpgradeAvailable(null);
      setUpToDate(false);
      onSaved();
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : t('extensions.version.upgradeFailed'));
    } finally {
      setUpgrading(false);
    }
  };

  const displayVersion = upgradedVersion ?? lockedVersion;

  return (
    <div className="credential-panel" role="region" aria-label={t('extensions.credentials.title')}>
      <div className="credential-panel__header">
        <h4 className="credential-panel__title">
          {t('extensions.credentials.title')}: {extensionName}
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

      {/* Version info section — only shown when extension has a locked/pinned version */}
      {displayVersion != null && (
        <div className="credential-panel__version">
          <div className="credential-panel__version-row">
            <span className="credential-panel__version-label">
              {t('extensions.version.pinned', { version: displayVersion })}
            </span>
          </div>
          <div className="credential-panel__version-row">
            <span className="credential-panel__version-label credential-panel__hash">
              {integrityHash
                ? t('extensions.version.integrity', { hash: truncateHash(integrityHash) })
                : t('extensions.version.integrityUnavailable')}
            </span>
          </div>

          {/* Upgrade status messages */}
          {upToDate && !upgradedVersion && (
            <div className="credential-panel__version-row">
              <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>
                {t('extensions.version.upToDate')}
              </span>
            </div>
          )}
          {upgradedVersion && (
            <div className="credential-panel__version-row">
              <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>
                {t('extensions.version.upgradeSuccess', { version: upgradedVersion })}
              </span>
            </div>
          )}
          {upgradeAvailable && (
            <div className="credential-panel__upgrade-diff">
              <span>
                {t('extensions.version.upgradeAvailable', {
                  current: upgradeAvailable.currentVersion,
                  latest: upgradeAvailable.newVersion,
                })}
              </span>
            </div>
          )}
          {upgradeError && (
            <p className="credential-panel__error" role="alert">{upgradeError}</p>
          )}

          {/* Upgrade action buttons */}
          <div className="credential-panel__version-row" style={{ marginTop: '6px', gap: '8px' }}>
            {!upgradeAvailable && !upgrading && (
              <button
                className="btn btn--sm btn--cancel"
                onClick={() => void handleCheckForUpdates()}
                disabled={disabled || checkingUpdate || upgrading}
              >
                {checkingUpdate
                  ? t('extensions.version.checking')
                  : t('extensions.version.checkForUpdates')}
              </button>
            )}
            {upgradeAvailable && (
              <button
                className="btn btn--sm btn--primary"
                onClick={() => void handleUpgrade()}
                disabled={disabled || upgrading}
              >
                {upgrading
                  ? t('extensions.version.upgrading')
                  : t('extensions.version.upgrade')}
              </button>
            )}
            {upgradeAvailable && !upgrading && (
              <button
                className="btn btn--sm btn--cancel"
                onClick={() => { setUpgradeAvailable(null); setUpToDate(false); }}
                disabled={upgrading}
              >
                {t('extensions.actions.configure')}
              </button>
            )}
          </div>

          {/* Restart note for plugins */}
          {extensionKind === 'plugin' && upgradeAvailable && (
            <p className="catalog-restart-note" style={{ marginTop: '4px' }}>
              {t('extensions.version.restartRequired')}
            </p>
          )}
        </div>
      )}

      {status === 'installed' && (
        <p className="credential-panel__hint">
          {t('extensions.credentials.requiresCredentials')}
        </p>
      )}

      <div className="credential-panel__form">
        <div className="credential-panel__field">
          <label htmlFor={`cred-field-${extensionId}`} className="credential-panel__label">
            {t('extensions.credentials.fieldLabel')}
          </label>
          <input
            id={`cred-field-${extensionId}`}
            type="text"
            className="credential-panel__input"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="OPENAI_API_KEY"
            disabled={disabled || saving}
          />
        </div>

        <div className="credential-panel__field">
          <label htmlFor={`cred-value-${extensionId}`} className="credential-panel__label">
            {t('extensions.credentials.valueLabel')}
          </label>
          <input
            id={`cred-value-${extensionId}`}
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

      {/* Trust override audit trail — only shown when admin has approved this extension */}
      {trustOverride != null && (
        <div className="credential-panel__audit" role="note">
          {t('extensions.trust.auditTrail', {
            userId: trustOverride.userId,
            date: formatDate(trustOverride.createdAt),
            reason: trustOverride.reason,
          })}
        </div>
      )}
    </div>
  );
}
