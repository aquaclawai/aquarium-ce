import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../api';
import type {
  TemplateManifest,
  BillingMode,
  SecurityProfile,
  TemplateContent,
  InstantiateTemplateResponse,
} from '@aquarium/shared';
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
import '../../pages/TemplatesPage.css';

export interface InstantiateDialogProps {
  template: TemplateManifest | null;
  templateContent: TemplateContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (instanceId: string) => void;
  platformCredentials: Array<{ provider: string; credentialType: string }>;
}

const SECURITY_PROFILES: SecurityProfile[] = ['strict', 'standard', 'developer', 'unrestricted'];
const CRON_ENABLED_SLUGS = new Set(['industry-news', 'competitor-monitor']);
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

type CronScheduleMode = 'daily' | 'weekdays' | 'custom';

function buildCronExpr(mode: CronScheduleMode, hour: number, custom: string): string {
  if (mode === 'custom') return custom.trim();
  if (mode === 'weekdays') return `0 ${hour} * * 1-5`;
  return `0 ${hour} * * *`;
}

type OAuthResultData = { type?: string; success?: boolean; code?: string; state?: string };

function subscribeToOAuthResult(onResult: (data: { code: string; state: string }) => void): () => void {
  let settled = false;
  const settle = (data: OAuthResultData) => {
    if (settled || data?.type !== 'salevoice_oauth_complete' || !data.success || !data.code || !data.state) return;
    settled = true;
    cleanup();
    onResult({ code: data.code, state: data.state });
  };

  let bc: BroadcastChannel | null = null;
  try { bc = new BroadcastChannel('salevoice_oauth'); bc.onmessage = (e: MessageEvent) => settle(e.data as OAuthResultData); }
  catch { /* unsupported */ }

  const onMsg = (e: MessageEvent) => settle(e.data as OAuthResultData);
  const onStore = (e: StorageEvent) => {
    if (e.key !== 'salevoice_oauth_result' || !e.newValue) return;
    try { settle(JSON.parse(e.newValue) as OAuthResultData); } catch { /* ignore */ }
  };
  window.addEventListener('message', onMsg);
  window.addEventListener('storage', onStore);

  const cleanup = () => {
    bc?.close();
    window.removeEventListener('message', onMsg);
    window.removeEventListener('storage', onStore);
    try { localStorage.removeItem('salevoice_oauth_result'); } catch { /* ignore */ }
  };
  return cleanup;
}

interface CredentialField { provider: string; credentialType: string; description?: string; required?: boolean; }
interface CredentialInputsProps {
  labelKey: string; descKey: string; credentials: CredentialField[];
  values: Record<string, string>; onChange: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  inputType: 'url' | 'password'; idPrefix: string; placeholderKey: string;
  t: (key: string, opts?: Record<string, string>) => string;
}
function CredentialInputs({ labelKey, descKey, credentials, values, onChange, inputType, idPrefix, placeholderKey, t }: CredentialInputsProps) {
  return (
    <div className="form-group" style={{ marginTop: 'var(--spacing-md)' }}>
      <label>{t(labelKey)}</label>
      <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>{t(descKey)}</p>
      {credentials.map(cred => (
        <div key={cred.provider} style={{ marginBottom: 'var(--spacing-sm)' }}>
          <label htmlFor={`${idPrefix}-${cred.provider}`} style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', fontWeight: 500, textTransform: 'capitalize' }}>
            {cred.description || cred.provider}{!cred.required && <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}> ({t('common.optional')})</span>}
          </label>
          <Input id={`${idPrefix}-${cred.provider}`} type={inputType} value={values[cred.provider] ?? ''} onChange={e => onChange(prev => ({ ...prev, [cred.provider]: e.target.value }))} placeholder={t(placeholderKey, { provider: cred.provider })} style={{ width: '100%' }} />
        </div>
      ))}
    </div>
  );
}

export function InstantiateDialog({ template, templateContent, open, onOpenChange, onCreated, platformCredentials }: InstantiateDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [billingMode, setBillingMode] = useState<BillingMode>('byok');
  const [instanceName, setInstanceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [securityProfile, setSecurityProfile] = useState<SecurityProfile>('standard');
  const [geoCredentialMode, setGeoCredentialMode] = useState<'apikey' | 'oauth'>('oauth');
  const [geoApiKey, setGeoApiKey] = useState('');
  const [geoConnected, setGeoConnected] = useState(false);
  const [geoConnecting, setGeoConnecting] = useState(false);
  const [webhookUrls, setWebhookUrls] = useState<Record<string, string>>({});
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [cronMode, setCronMode] = useState<CronScheduleMode>('daily');
  const [cronHour, setCronHour] = useState(9);
  const [cronCustomExpr, setCronCustomExpr] = useState('');

  const templateSecurity = templateContent?.security ?? null;

  // Sync instance name and security profile when dialog opens or template changes
  useEffect(() => {
    if (open && template) {
      setInstanceName(`${template.name} Instance`);
      setBillingMode(template.billingMode ?? 'byok');
    }
  }, [open, template?.id]);

  useEffect(() => {
    if (templateSecurity?.minSecurityProfile) {
      setSecurityProfile(templateSecurity.minSecurityProfile);
    }
  }, [templateContent]);

  const needsSalevoice = template?.requiredCredentials.some(c => c.provider === 'salevoice') ?? false;
  const webhookCredentials = template?.requiredCredentials.filter(c => (c.credentialType as string) === 'webhook_url') ?? [];
  const apiKeyCredentials = template?.requiredCredentials.filter(c => (c.credentialType as string) === 'api_key') ?? [];
  const hasCronSchedule = template ? CRON_ENABLED_SLUGS.has(template.slug) : false;
  const missingCredentials = template?.requiredCredentials.filter(c =>
    c.provider !== 'salevoice' &&
    !platformCredentials.some(pc => pc.provider === c.provider && pc.credentialType === c.credentialType)
  ) ?? [];

  const resetState = () => {
    setInstanceName(''); setBillingMode('byok'); setSecurityProfile('standard');
    setGeoCredentialMode('oauth'); setGeoApiKey(''); setGeoConnected(false); setGeoConnecting(false);
    setWebhookUrls({}); setApiKeyValues({}); setCronMode('daily'); setCronHour(9); setCronCustomExpr('');
  };

  const handleClose = (isOpen: boolean) => { if (!isOpen) resetState(); onOpenChange(isOpen); };

  const doCreateInstance = async () => {
    if (!template || !instanceName.trim()) return;
    setCreating(true);
    try {
      const result = await api.post<InstantiateTemplateResponse>(
        `/templates/${template.id}/instantiate`,
        { instanceName: instanceName.trim(), billingMode, ...(templateSecurity ? { securityProfile } : {}) },
      );
      for (const [provider, url] of Object.entries(webhookUrls).filter(([, u]) => u.trim())) {
        try { await api.post(`/instances/${result.instance.id}/credentials`, { provider, credentialType: 'webhook_url', value: url.trim() }); } catch { /* best-effort */ }
      }
      for (const [provider, key] of Object.entries(apiKeyValues).filter(([, k]) => k.trim())) {
        try { await api.post(`/instances/${result.instance.id}/credentials`, { provider, credentialType: 'api_key', value: key.trim() }); } catch { /* best-effort */ }
      }
      if (hasCronSchedule) {
        const cronExpr = buildCronExpr(cronMode, cronHour, cronCustomExpr);
        if (cronExpr) try { localStorage.setItem(`pending-cron:${result.instance.id}`, JSON.stringify({ name: template.name ?? 'Scheduled Task', schedule: cronExpr, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })); } catch { /* ignore */ }
      }
      onCreated(result.instance.id);
      navigate(`/instances/${result.instance.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('templates.instantiate.failedToCreate'));
    } finally { setCreating(false); }
  };

  const doSalevoiceOAuth = async (thenCreate = false) => {
    setGeoConnecting(true);
    try {
      const data = await api.post<{ authUrl: string; state: string }>('/oauth/salevoice/authorize', {});
      const cleanup = subscribeToOAuthResult(async ({ code, state }) => {
        try {
          const tokenData = await api.post<{ accessToken: string; tokenType: string }>('/oauth/salevoice/token', { code, state });
          await api.post('/credentials', { provider: 'salevoice', credentialType: 'api_key', value: tokenData.accessToken, displayName: 'SaleVoice (OAuth)' });
          setGeoConnected(true); setGeoConnecting(false);
          if (thenCreate) doCreateInstance();
        } catch (err) { toast.error(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed')); setGeoConnecting(false); }
      });
      const popup = window.open(data.authUrl, 'salevoice_oauth', 'width=600,height=700,popup=yes');
      if (!popup) { cleanup(); toast.error(t('templates.instantiate.geoAuthFailed')); setGeoConnecting(false); }
    } catch (err) { toast.error(err instanceof Error ? err.message : t('templates.instantiate.geoAuthFailed')); setGeoConnecting(false); }
  };

  const handleSaveGeoApiKey = async () => {
    if (!geoApiKey.trim()) return;
    setGeoConnecting(true);
    try {
      await api.post('/credentials', { provider: 'salevoice', credentialType: 'api_key', value: geoApiKey.trim(), displayName: 'SaleVoice (API Key)' });
      setGeoConnected(true); setGeoConnecting(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : t('templates.instantiate.geoSaveFailed')); setGeoConnecting(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template || !instanceName.trim()) return;
    if (needsSalevoice && !geoConnected) { doSalevoiceOAuth(true); return; }
    await doCreateInstance();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="modal">
        {template && (
          <>
            <DialogHeader>
              <DialogTitle>{t('templates.instantiate.title')}</DialogTitle>
              <DialogDescription>{t('templates.instantiate.templateLabel', { name: template.name, version: template.version })}</DialogDescription>
            </DialogHeader>

            {missingCredentials.length > 0 && (
              <div className="info-message" style={{ marginBottom: 'var(--spacing-md)' }}>
                {t('templates.instantiate.credentialsRequired', { credentials: missingCredentials.map(c => `${c.provider} (${c.credentialType})`).join(', ') })}
              </div>
            )}

            {template.securityScore > 0 && template.securityScore < 40 && (
              <div className="security-warning" role="alert">⚠️ {t('templates.instantiate.lowSecurityWarning')}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="instance-name">{t('templates.instantiate.instanceNameLabel')}</label>
                <Input type="text" id="instance-name" value={instanceName} onChange={e => setInstanceName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label>{t('templates.instantiate.billingModeLabel')}</label>
                <div className="billing-mode-options">
                  {(['platform', 'byok'] as BillingMode[]).map(mode => (
                    <Button key={mode} type="button" variant="outline" className={`billing-mode-option${billingMode === mode ? ' selected' : ''}`} onClick={() => setBillingMode(mode)}>
                      <strong>{t(`templates.instantiate.${mode === 'platform' ? 'platformProvided' : 'bringYourOwnKey'}`)}</strong>
                      <span>{t(`templates.instantiate.${mode === 'platform' ? 'platformDescription' : 'byokDescription'}`)}</span>
                    </Button>
                  ))}
                </div>
              </div>

              {templateSecurity && (
                <div className="form-group">
                  <label>
                    {t('templates.instantiate.securityProfileLabel')}
                    {templateSecurity.minSecurityProfile && (
                      <span className="template-official-badge" style={{ marginLeft: 'var(--spacing-xs)', fontSize: '0.75rem' }}>
                        {t('templates.instantiate.minSecurityBadge', { profile: templateSecurity.minSecurityProfile })}
                      </span>
                    )}
                  </label>
                  <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>{t('templates.instantiate.securityProfileDescription')}</p>
                  <div className="wizard-provider-grid">
                    {SECURITY_PROFILES.map(profile => {
                      const disabled = SECURITY_PROFILES.indexOf(profile) > (templateSecurity.minSecurityProfile ? SECURITY_PROFILES.indexOf(templateSecurity.minSecurityProfile) : SECURITY_PROFILES.length - 1);
                      return (
                        <Button key={profile} type="button" variant="outline" className={`wizard-provider-card${securityProfile === profile ? ' selected' : ''}${disabled ? ' disabled' : ''}`} onClick={() => !disabled && setSecurityProfile(profile)} disabled={disabled} title={disabled ? t('templates.instantiate.securityProfileDisabled') : undefined}>
                          <strong>{t(`wizard.security.profiles.${profile}.title`)}</strong>
                          <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{t(`wizard.security.profiles.${profile}.description`)}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {needsSalevoice && (
                <div className="form-group" style={{ marginTop: 'var(--spacing-md)' }}>
                  <label>{t('templates.instantiate.geoCredentialLabel')}</label>
                  <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>{t('templates.instantiate.geoCredentialDescription')}</p>
                  {geoConnected ? (
                    <div className="info-message" style={{ color: 'var(--color-success)' }}>✓ {t('templates.instantiate.geoConnected')}</div>
                  ) : (
                    <>
                      <div className="billing-mode-options" style={{ marginBottom: 'var(--spacing-sm)' }}>
                        {(['oauth', 'apikey'] as const).map(mode => (
                          <Button key={mode} type="button" variant="outline" className={`billing-mode-option${geoCredentialMode === mode ? ' selected' : ''}`} onClick={() => setGeoCredentialMode(mode)}>
                            <strong>{t(`templates.instantiate.geo${mode === 'oauth' ? 'OAuth' : 'ApiKey'}Label`)}</strong>
                            <span>{t(`templates.instantiate.geo${mode === 'oauth' ? 'OAuth' : 'ApiKey'}Description`)}</span>
                          </Button>
                        ))}
                      </div>
                      {geoCredentialMode === 'oauth' ? (
                        <Button type="button" className="featured-card__cta" style={{ width: '100%' }} onClick={() => doSalevoiceOAuth(false)} disabled={geoConnecting}>
                          {geoConnecting ? t('templates.instantiate.geoConnecting') : t('templates.instantiate.geoConnectButton')}
                        </Button>
                      ) : (
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                          <Input type="password" value={geoApiKey} onChange={e => setGeoApiKey(e.target.value)} placeholder={t('templates.instantiate.geoApiKeyPlaceholder')} style={{ flex: 1 }} />
                          <Button type="button" onClick={handleSaveGeoApiKey} disabled={!geoApiKey.trim() || geoConnecting}>
                            {geoConnecting ? t('templates.instantiate.geoConnecting') : t('templates.instantiate.geoSaveButton')}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {hasCronSchedule && (
                <div className="form-group" style={{ marginTop: 'var(--spacing-md)' }}>
                  <label>{t('templates.instantiate.cronScheduleSection')}</label>
                  <p className="template-meta" style={{ marginBottom: 'var(--spacing-sm)' }}>{t('templates.instantiate.cronScheduleDescription')}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                    {(['daily', 'weekdays', 'custom'] as CronScheduleMode[]).map(mode => (
                      <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', cursor: 'pointer' }}>
                        <input type="radio" name="cronMode" value={mode} checked={cronMode === mode} onChange={() => setCronMode(mode)} />
                        {t(`templates.instantiate.cronSchedule${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                      </label>
                    ))}
                  </div>
                  {cronMode !== 'custom' ? (
                    <div style={{ marginTop: 'var(--spacing-sm)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                      <label htmlFor="cron-hour" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t('templates.instantiate.cronScheduleTimeLabel')}</label>
                      <Select value={String(cronHour)} onValueChange={v => setCronHour(Number(v))}>
                        <SelectTrigger id="cron-hour" style={{ width: 'auto' }}><SelectValue /></SelectTrigger>
                        <SelectContent>{HOUR_OPTIONS.map(h => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div style={{ marginTop: 'var(--spacing-sm)' }}>
                      <Input type="text" value={cronCustomExpr} onChange={e => setCronCustomExpr(e.target.value)} placeholder={t('templates.instantiate.cronScheduleCustomPlaceholder')} style={{ width: '100%' }} />
                      <p className="template-meta" style={{ marginTop: '4px', fontSize: '0.75rem' }}>{t('templates.instantiate.cronScheduleCustomHint')}</p>
                    </div>
                  )}
                </div>
              )}

              {webhookCredentials.length > 0 && <CredentialInputs labelKey="templates.instantiate.webhookSection" descKey="templates.instantiate.webhookDescription" credentials={webhookCredentials} values={webhookUrls} onChange={setWebhookUrls} inputType="url" idPrefix="webhook" placeholderKey="templates.instantiate.webhookPlaceholder" t={t} />}
              {apiKeyCredentials.length > 0 && <CredentialInputs labelKey="templates.instantiate.apiKeySection" descKey="templates.instantiate.apiKeyDescription" credentials={apiKeyCredentials} values={apiKeyValues} onChange={setApiKeyValues} inputType="password" idPrefix="apikey" placeholderKey="templates.instantiate.apiKeyPlaceholder" t={t} />}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => handleClose(false)} disabled={creating}>{t('common.buttons.cancel')}</Button>
                <Button type="submit" disabled={creating || geoConnecting || !instanceName.trim()}>
                  {geoConnecting ? t('templates.instantiate.geoConnecting') : creating ? t('templates.instantiate.creating') : t('templates.instantiate.createButton')}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
