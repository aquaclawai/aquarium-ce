import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { getProviderDisplayName, formatModelDisplayName } from '../utils/provider-display';
import type { Instance, Credential, SecurityProfile } from '@aquarium/shared';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';


/** Minimal provider info for OAuth detection */
const OAUTH_PROVIDERS: Record<string, { oauthFlow: 'device_code' | 'pkce' }> = {
  openai: { oauthFlow: 'device_code' },
  google: { oauthFlow: 'pkce' },
  'github-copilot': { oauthFlow: 'device_code' },
};

const SECURITY_PROFILE_COLORS: Record<SecurityProfile, { background: string; color: string }> = {
  strict: { background: 'var(--color-error-bg, #fde8e8)', color: 'var(--color-error, #c53030)' },
  standard: { background: 'var(--color-info-bg, #e8f0fe)', color: 'var(--color-info, #2b6cb0)' },
  developer: { background: 'var(--color-warning-bg, #fef3cd)', color: 'var(--color-warning, #b7791f)' },
  unrestricted: { background: 'var(--color-success-bg, #e6ffed)', color: 'var(--color-success, #276749)' },
};

interface OverviewTabProps {
  instance: Instance;
  onInstanceUpdate: () => void;
  onLifecycle: (action: 'start' | 'stop' | 'restart') => void;
  actionInProgress: 'start' | 'stop' | 'restart' | null;
  onClone: () => void;
  cloning: boolean;
}

export function OverviewTab({
  instance,
  onInstanceUpdate,
  onLifecycle,
  actionInProgress,
  onClone,
  cloning,
}: OverviewTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credLoading, setCredLoading] = useState(true);
  const [editingSecurity, setEditingSecurity] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<SecurityProfile>(instance.securityProfile ?? 'standard');

  const isRunning = instance.status === 'running';
  const isStopped = instance.status === 'stopped' || instance.status === 'created';
  const isError = instance.status === 'error';
  const isTransitioning = instance.status === 'starting' || instance.status === 'stopping';
  const isBusy = isTransitioning || actionInProgress !== null;

  const fetchCredentials = useCallback(async () => {
    try {
      const data = await api.get<Credential[]>(`/instances/${instance.id}/credentials`);
      setCredentials(data);
    } catch {
      // non-critical: oauth status check gracefully degrades
    } finally {
      setCredLoading(false);
    }
  }, [instance.id]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const rawProvider = instance.config?.defaultProvider as string | undefined;

  async function handleSecurityProfileSave() {
    setSavingSecurity(true);
    try {
      await api.patch(`/instances/${instance.id}/security-profile`, { securityProfile: pendingProfile });
      setEditingSecurity(false);
      onInstanceUpdate();
    } catch {
      // non-critical
    } finally {
      setSavingSecurity(false);
    }
  }

  const currentProfile: SecurityProfile = instance.securityProfile ?? 'standard';
  const provider = getProviderDisplayName(rawProvider, t) ?? rawProvider;
  const model = instance.config?.defaultModel as string | undefined;
  const hasOAuthCred = (p: string) => credentials.some(c => c.provider === p);
  const supportsOAuth = rawProvider ? rawProvider in OAUTH_PROVIDERS : false;
  const needsOAuth = supportsOAuth && !credLoading && !hasOAuthCred(provider!) && instance.billingMode !== 'platform';
  const hasOAuth = supportsOAuth && !credLoading && hasOAuthCred(provider!);

  return (
    <div className="details-tab">
      <div className="overview-actions">
        <Button onClick={() => onLifecycle('start')} disabled={!(isStopped || isError) || isBusy}>
          {(actionInProgress === 'start' || instance.status === 'starting') ? <><span className="spinner" /> {t('instance.overview.starting')}</> : t('instance.overview.start')}
        </Button>
        <Button onClick={() => onLifecycle('stop')} disabled={!(isRunning || isError) || isBusy}>
          {(actionInProgress === 'stop' || instance.status === 'stopping') ? <><span className="spinner" /> {t('instance.overview.stopping')}</> : t('instance.overview.stop')}
        </Button>
        <Button onClick={() => onLifecycle('restart')} disabled={!(isRunning || isError) || isBusy}>
          {actionInProgress === 'restart' ? <><span className="spinner" /> {t('instance.overview.restarting')}</> : t('instance.overview.restart')}
        </Button>
        <Button variant="secondary" onClick={onClone} disabled={cloning || isBusy}>
          {cloning ? <><span className="spinner" /> {t('instance.overview.cloning', 'Cloning...')}</> : t('instance.overview.clone', 'Clone')}
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/export/${instance.id}`)}>
          {t('instance.overview.exportTemplate', 'Export as Template')}
        </Button>
      </div>

      <h3>{t('instance.overview.title')}</h3>
      <table className="models-table">
        <tbody>
          <tr><td><strong>{t('instance.overview.fields.id')}</strong></td><td>{instance.id}</td></tr>
          <tr><td><strong>{t('instance.overview.fields.name')}</strong></td><td>{instance.name}</td></tr>
          <tr><td><strong>{t('instance.overview.fields.agentType')}</strong></td><td>{instance.agentType}</td></tr>
          <tr><td><strong>{t('instance.overview.fields.imageTag')}</strong></td><td>{instance.imageTag}</td></tr>
          <tr><td><strong>{t('instance.overview.fields.status')}</strong></td><td><span className={`status-${instance.status}`}>{t(`common.status.${instance.status}`)}</span></td></tr>
          <tr>
            <td><strong>{t('instance.overview.fields.securityProfile')}</strong></td>
            <td>
              {editingSecurity ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                  <Select
                    value={pendingProfile}
                    onValueChange={(val) => setPendingProfile(val as SecurityProfile)}
                    disabled={savingSecurity}
                  >
                    <SelectTrigger style={{ minWidth: '140px' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['strict', 'standard', 'developer', 'unrestricted'] as SecurityProfile[]).map(p => (
                        <SelectItem key={p} value={p}>{t(`instance.overview.securityProfiles.${p}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSecurityProfileSave}
                    disabled={savingSecurity || pendingProfile === currentProfile}
                  >
                    {savingSecurity ? t('instance.overview.savingSecurityProfile') : 'OK'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => { setEditingSecurity(false); setPendingProfile(currentProfile); }}
                    disabled={savingSecurity}
                  >
                    ✕
                  </Button>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    ...SECURITY_PROFILE_COLORS[currentProfile],
                  }}>
                    {t(`instance.overview.securityProfiles.${currentProfile}`)}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => { setEditingSecurity(true); setPendingProfile(currentProfile); }}
                  >
                    {t('instance.overview.changeSecurityProfile')}
                  </Button>
                </span>
              )}
            </td>
          </tr>
          <tr><td><strong>{t('instance.overview.fields.deployment')}</strong></td><td>{t('common.deploymentTarget.' + instance.deploymentTarget)}</td></tr>
          {provider && <tr><td><strong>{t('instance.overview.fields.aiProvider')}</strong></td><td>{provider}</td></tr>}
          {model && <tr><td><strong>{t('instance.overview.fields.defaultModel')}</strong></td><td>{formatModelDisplayName(model)}</td></tr>}
          <tr><td><strong>{t('instance.overview.fields.created')}</strong></td><td>{new Date(instance.createdAt).toLocaleString()}</td></tr>
          <tr><td><strong>{t('instance.overview.fields.updated')}</strong></td><td>{new Date(instance.updatedAt).toLocaleString()}</td></tr>
        </tbody>
      </table>

      {hasOAuth && (
        <div className="oauth-section">
          <div className="oauth-status">{t('instance.overview.oauthAuthenticated', { provider: rawProvider })}</div>
        </div>
      )}

      {needsOAuth && (
        <div className="setup-required">
          <h3>{t('instance.overview.setupRequired', { provider: rawProvider })}</h3>
          <p>{t('instance.overview.setupRequiredDescription', { provider: rawProvider })}</p>
          {provider === 'github-copilot' && (
            <GitHubOAuthFlow
              instanceId={instance.id}
              onComplete={() => {
                fetchCredentials();
                onInstanceUpdate();
              }}
            />
          )}
          {provider === 'openai' && (
            <OpenAIOAuthFlow
              instanceId={instance.id}
              onComplete={() => {
                fetchCredentials();
                onInstanceUpdate();
              }}
            />
          )}
          {provider === 'google' && (
            <GoogleOAuthFlow
              instanceId={instance.id}
              onComplete={() => {
                fetchCredentials();
                onInstanceUpdate();
              }}
            />
          )}
        </div>
      )}

    </div>
  );
}

/* ─── Webhook Credentials Section ─── */

// WebhookCredentialsSection and ApiKeyCredentialsSection removed — EE-only features

interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

function GitHubOAuthFlow({ instanceId, onComplete }: { instanceId: string; onComplete: () => void }) {
  const { t } = useTranslation();
  const [deviceData, setDeviceData] = useState<DeviceCodeData | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const startFlow = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<DeviceCodeData>('/oauth/github/device-code', {});
      setDeviceData(data);
      setPolling(true);
      window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('instance.oauth.github.failedToStart'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const copyCode = useCallback(() => {
    if (!deviceData) return;
    navigator.clipboard.writeText(deviceData.userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [deviceData]);

  useEffect(() => {
    if (!polling || !deviceData) return;

    const interval = Math.max((deviceData.interval || 5) * 1000, 5000);
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api.post<{ status: string; accessToken?: string; description?: string }>(
          '/oauth/github/poll',
          { deviceCode: deviceData.deviceCode },
        );
        if (cancelled) return;

        if (result.status === 'success' && result.accessToken) {
          await api.post(`/instances/${instanceId}/credentials`, {
            provider: 'github-copilot',
            credentialType: 'oauth_token',
            value: result.accessToken,
          });
          setPolling(false);
          onComplete();
          return;
        }

        if (result.status === 'authorization_pending' || result.status === 'slow_down') {
          setTimeout(poll, interval);
          return;
        }

        setError(result.description || t('instance.oauth.github.oauthError', { status: result.status }));
        setPolling(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('instance.oauth.github.pollingFailed'));
          setPolling(false);
        }
      }
    };

    const timer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, deviceData, instanceId, onComplete, t]);

  const handleCancel = () => {
    setPolling(false);
    setDeviceData(null);
  };

  return (
    <div className="oauth-section">
      <h4>{t('instance.oauth.github.title')}</h4>
      {error && <div className="error-message" role="alert">{error}</div>}

      {!deviceData && (
        <div>
          <p style={{ marginBottom: '0.75rem', color: '#666' }}>
            {t('instance.oauth.github.description')}
          </p>
          <Button onClick={startFlow} disabled={loading}>
            {loading ? t('instance.oauth.github.startingButton') : t('instance.oauth.github.authenticateButton')}
          </Button>
        </div>
      )}

      {deviceData && (
        <div className="device-code-display">
          <div className="device-code-steps">
            <p><strong>{t('instance.oauth.github.step1')}</strong> {t('instance.oauth.github.step1Text')}</p>
            <div className="user-code-row">
              <div className="user-code">{deviceData.userCode}</div>
              <Button variant="ghost" size="sm" className="btn-copy" onClick={copyCode}>
                {copied ? t('instance.oauth.github.copiedCode') : t('common.buttons.copy')}
              </Button>
            </div>
            <p><strong>{t('instance.oauth.github.step2')}</strong> {t('instance.oauth.github.step2Text')}</p>
            <p>
              <a href={deviceData.verificationUri} target="_blank" rel="noopener noreferrer">
                {deviceData.verificationUri}
              </a>
              {' '}
              <Button variant="secondary" size="sm" onClick={() => window.open(deviceData.verificationUri, '_blank', 'noopener,noreferrer')}>
                {t('instance.oauth.github.openAgain')}
              </Button>
            </p>
            <p><strong>{t('instance.oauth.github.step3')}</strong> {t('instance.oauth.github.step3Text')}</p>
          </div>
          {polling && (
            <p style={{ marginTop: '1rem' }}><span className="spinner" /> {t('instance.oauth.github.waitingForAuth')}</p>
          )}
          <div style={{ marginTop: '1rem' }}>
            <Button variant="secondary" onClick={handleCancel}>{t('common.buttons.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── OpenAI Codex OAuth (Device Code Flow) ─── */

interface OpenAIDeviceCodeData {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}

function OpenAIOAuthFlow({ instanceId, onComplete }: { instanceId: string; onComplete: () => void }) {
  const { t } = useTranslation();
  const [deviceData, setDeviceData] = useState<OpenAIDeviceCodeData | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const startFlow = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<OpenAIDeviceCodeData>('/oauth/openai/device-code', {});
      setDeviceData(data);
      setPolling(true);
      window.open(data.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('instance.oauth.openai.failedToStart'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const copyCode = useCallback(() => {
    if (!deviceData) return;
    navigator.clipboard.writeText(deviceData.userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [deviceData]);

  useEffect(() => {
    if (!polling || !deviceData) return;

    const interval = Math.max((deviceData.interval || 5) * 1000, 5000);
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api.post<{ status: string; accessToken?: string; refreshToken?: string; expiresIn?: number; description?: string }>(
          '/oauth/openai/poll',
          { deviceAuthId: deviceData.deviceAuthId, userCode: deviceData.userCode },
        );
        if (cancelled) return;

        if (result.status === 'success' && result.accessToken) {
          await api.post(`/instances/${instanceId}/credentials`, {
            provider: 'openai',
            credentialType: 'oauth_token',
            value: result.accessToken,
            metadata: { refreshToken: result.refreshToken, expiresIn: result.expiresIn },
          });
          setPolling(false);
          onComplete();
          return;
        }

        if (result.status === 'authorization_pending' || result.status === 'slow_down') {
          setTimeout(poll, interval);
          return;
        }

        setError(result.description || t('instance.oauth.openai.oauthError', { status: result.status }));
        setPolling(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('instance.oauth.openai.pollingFailed'));
          setPolling(false);
        }
      }
    };

    const timer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, deviceData, instanceId, onComplete, t]);

  const handleCancel = () => {
    setPolling(false);
    setDeviceData(null);
  };

  return (
    <div className="oauth-section">
      <h4>{t('instance.oauth.openai.title')}</h4>
      {error && <div className="error-message" role="alert">{error}</div>}

      {!deviceData && (
        <div>
          <p style={{ marginBottom: '0.75rem', color: '#666' }}>
            {t('instance.oauth.openai.description')}
          </p>
          <Button onClick={startFlow} disabled={loading}>
            {loading ? t('instance.oauth.openai.startingButton') : t('instance.oauth.openai.authenticateButton')}
          </Button>
        </div>
      )}

      {deviceData && (
        <div className="device-code-display">
          <div className="device-code-steps">
            <p><strong>{t('instance.oauth.openai.step1')}</strong> {t('instance.oauth.openai.step1Text')}</p>
            <div className="user-code-row">
              <div className="user-code">{deviceData.userCode}</div>
              <Button variant="ghost" size="sm" className="btn-copy" onClick={copyCode}>
                {copied ? t('instance.oauth.openai.copiedCode') : t('common.buttons.copy')}
              </Button>
            </div>
            <p><strong>{t('instance.oauth.openai.step2')}</strong> {t('instance.oauth.openai.step2Text')}</p>
            <p>
              <a href={deviceData.verificationUri} target="_blank" rel="noopener noreferrer">
                {deviceData.verificationUri}
              </a>
              {' '}
              <Button variant="secondary" size="sm" onClick={() => window.open(deviceData.verificationUri, '_blank', 'noopener,noreferrer')}>
                {t('instance.oauth.openai.openAgain')}
              </Button>
            </p>
            <p><strong>{t('instance.oauth.openai.step3')}</strong> {t('instance.oauth.openai.step3Text')}</p>
          </div>
          {polling && (
            <p style={{ marginTop: '1rem' }}><span className="spinner" /> {t('instance.oauth.openai.waitingForAuth')}</p>
          )}
          <div style={{ marginTop: '1rem' }}>
            <Button variant="secondary" onClick={handleCancel}>{t('common.buttons.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Google OAuth (PKCE Redirect Flow) ─── */

function GoogleOAuthFlow({ instanceId, onComplete }: { instanceId: string; onComplete: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleGoogleCallback = () => {
      const stored = sessionStorage.getItem('google_oauth_success');
      if (stored) {
        sessionStorage.removeItem('google_oauth_success');
        try {
          const data = JSON.parse(stored) as { instanceId: string };
          if (data.instanceId === instanceId) {
            onComplete();
          }
        } catch { /* malformed data */ }
      }
    };
    handleGoogleCallback();

    window.addEventListener('focus', handleGoogleCallback);
    return () => window.removeEventListener('focus', handleGoogleCallback);
  }, [instanceId, onComplete]);

  const startFlow = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<{ authUrl: string; state: string }>('/oauth/google/authorize', {});

      sessionStorage.setItem('google_oauth_pending', JSON.stringify({
        state: data.state,
        instanceId,
      }));

      window.location.href = data.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('instance.oauth.google.failedToStart'));
      setLoading(false);
    }
  }, [instanceId, t]);

  return (
    <div className="oauth-section">
      <h4>{t('instance.oauth.google.title')}</h4>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div>
        <p style={{ marginBottom: '0.75rem', color: '#666' }}>
          {t('instance.oauth.google.description')}
        </p>
        <Button onClick={startFlow} disabled={loading}>
          {loading ? <><span className="spinner" /> {t('instance.oauth.google.redirectingButton')}</> : t('instance.oauth.google.authenticateButton')}
        </Button>
      </div>
    </div>
  );
}
