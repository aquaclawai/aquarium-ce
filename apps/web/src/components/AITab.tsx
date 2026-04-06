import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { getProviderDisplayName, formatModelDisplayName } from '../utils/provider-display';
import '../pages/CreateWizardPage.css';
import type {
  Instance,
  Credential,
  CredentialType,
  CredentialRequirement,
  AgentTypeInfo,
} from '@aquarium/shared';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui';
import { CardSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ───────────────────────────────────────────────

type AuthMode = 'api_key' | 'oauth';

interface ProviderDef {
  value: string;
  label: string;
  authModes: AuthMode[];
  oauthFlow: 'device_code' | 'pkce' | null;
}

interface TemplateRequirementsData {
  requirements: CredentialRequirement[];
  credentialStatus: Record<string, 'fulfilled' | 'missing'>;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  recommended: boolean;
}

interface AITabProps {
  instance: Instance;
  agentType: AgentTypeInfo | null;
  onInstanceUpdate: () => void;
}

// ─── Constants ───────────────────────────────────────────

/** AI providers for BYOK mode */
const AI_PROVIDERS: ProviderDef[] = [
  { value: 'anthropic', label: 'Anthropic', authModes: ['api_key'], oauthFlow: null },
  { value: 'openai', label: 'OpenAI', authModes: ['api_key', 'oauth'], oauthFlow: 'device_code' },
  { value: 'google', label: 'Google', authModes: ['api_key', 'oauth'], oauthFlow: 'pkce' },
  { value: 'openrouter', label: 'OpenRouter', authModes: ['api_key'], oauthFlow: null },
  { value: 'ollama', label: 'Ollama', authModes: ['api_key'], oauthFlow: null },
  { value: 'bedrock', label: 'AWS Bedrock', authModes: ['api_key'], oauthFlow: null },
  { value: 'github-copilot', label: 'GitHub Copilot', authModes: ['oauth'], oauthFlow: 'device_code' },
  { value: 'xai', label: 'xAI (Grok)', authModes: ['api_key'], oauthFlow: null },
  { value: 'together', label: 'Together AI', authModes: ['api_key'], oauthFlow: null },
  { value: 'venice', label: 'Venice AI', authModes: ['api_key'], oauthFlow: null },
  { value: 'groq', label: 'Groq', authModes: ['api_key'], oauthFlow: null },
  { value: 'deepseek', label: 'DeepSeek', authModes: ['api_key'], oauthFlow: null },
  { value: 'mistral', label: 'Mistral', authModes: ['api_key'], oauthFlow: null },
  { value: 'moonshot', label: 'Moonshot / Kimi', authModes: ['api_key'], oauthFlow: null },
  { value: 'minimax', label: 'MiniMax', authModes: ['api_key'], oauthFlow: null },
  { value: 'litellm', label: 'LiteLLM', authModes: ['api_key'], oauthFlow: null },
  { value: 'custom', label: 'Custom Provider', authModes: ['api_key'], oauthFlow: null },
];

/** Non-AI tool/channel credential providers */
const TOOL_PROVIDERS: ProviderDef[] = [
  { value: 'brave', label: 'Brave Search', authModes: ['api_key'], oauthFlow: null },
  { value: 'telegram', label: 'Telegram Bot', authModes: ['api_key'], oauthFlow: null },
  { value: 'discord', label: 'Discord Bot', authModes: ['api_key'], oauthFlow: null },
  { value: 'slack_bot', label: 'Slack Bot', authModes: ['api_key'], oauthFlow: null },
  { value: 'salevoice', label: 'SaleVoice (GEO)', authModes: ['api_key', 'oauth'], oauthFlow: null },
];

const OTHER_PROVIDER_VALUE = '__other__';

// ─── Styles ──────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1.5rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 1rem 0',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
};

const radioGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const radioCardStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  padding: '1rem',
  borderRadius: '8px',
  border: `2px solid ${selected ? 'var(--color-primary)' : 'var(--border)'}`,
  background: selected ? 'var(--color-primary-bg, rgba(99, 102, 241, 0.05))' : 'transparent',
  cursor: 'pointer',
  transition: 'border-color 0.15s, background 0.15s',
});

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
};

// ─── Component ───────────────────────────────────────────

export function AITab({ instance, agentType, onInstanceUpdate }: AITabProps) {
  const isPlatform = instance.billingMode === 'platform';

  return (
    <div className="details-tab">

      {/* Section 2: Model Selection */}
      <ModelSection
        instance={instance}
        agentType={agentType}
        isPlatform={isPlatform}
        onInstanceUpdate={onInstanceUpdate}
      />

      {/* Section 3: Tool Credentials */}
      <ToolCredentialsSection instanceId={instance.id} />
    </div>
  );
}

// ─── Section 1: Provider Mode (switchable, requires restart) ─
// EE-only component — CE always uses BYOK, so this is unused in CE builds.
// Exported to suppress TS6133 (noUnusedLocals) without breaking React hooks rules.
export function ProviderModeSection({
  instanceId,
  isPlatform,
  instanceStatus,
  onInstanceUpdate,
}: {
  instanceId: string;
  isPlatform: boolean;
  instanceStatus: string;
  onInstanceUpdate: () => void;
}) {
  const { t } = useTranslation();
  const [switching, setSwitching] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<boolean | null>(null);
  const [switchedModeName, setSwitchedModeName] = useState<string | null>(null);

  function requestSwitch(toPlatform: boolean) {
    if (toPlatform === isPlatform || switching) return;
    setConfirmTarget(toPlatform);
  }

  async function executeSwitch() {
    if (confirmTarget === null) return;
    setConfirmTarget(null);
    setSwitching(true);
    setError(null);
    try {
      await api.patch(`/instances/${instanceId}/config`, {
        billingMode: confirmTarget ? 'platform' : 'byok',
      });
      setSwitchedModeName(confirmTarget ? t('aiTab.providerMode.platformTitle') : t('aiTab.providerMode.byokTitle'));
      onInstanceUpdate();
      setPendingRestart(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.providerMode.switchError'));
    } finally {
      setSwitching(false);
    }
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      await api.post(`/instances/${instanceId}/restart`, {});
      setPendingRestart(false);
      onInstanceUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.providerMode.switchError'));
    } finally {
      setRestarting(false);
    }
  }

  const canRestart = instanceStatus === 'running' || instanceStatus === 'error';

  return (
    <div style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{t('aiTab.providerMode.title')}</h3>
      <div style={radioGroupStyle}>
        <label
          style={{ ...radioCardStyle(isPlatform), opacity: switching ? 0.6 : 1 }}
          onClick={() => requestSwitch(true)}
        >
          <input type="radio" checked={isPlatform} readOnly style={{ marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 600 }}>{t('aiTab.providerMode.platformTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {t('aiTab.providerMode.platformDesc')}
            </div>
          </div>
        </label>
        <label
          style={{ ...radioCardStyle(!isPlatform), opacity: switching ? 0.6 : 1 }}
          onClick={() => requestSwitch(false)}
        >
          <input type="radio" checked={!isPlatform} readOnly style={{ marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 600 }}>{t('aiTab.providerMode.byokTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {t('aiTab.providerMode.byokDesc')}
            </div>
          </div>
        </label>
      </div>

      {switching && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem', marginBottom: 0 }}>
          {t('aiTab.providerMode.switching')}
        </p>
      )}

      {error && (
        <div className="error-message" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      {pendingRestart && !switching && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          background: 'var(--color-warning-bg, rgba(245, 158, 11, 0.1))',
          border: '1px solid var(--color-warning, #f59e0b)',
        }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
            {t('aiTab.providerMode.switchSuccess', {
              mode: switchedModeName ?? (isPlatform ? t('aiTab.providerMode.platformTitle') : t('aiTab.providerMode.byokTitle')),
            })}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canRestart && (
              <Button onClick={handleRestart} disabled={restarting}>
                {restarting ? t('aiTab.providerMode.switching') : t('aiTab.providerMode.restartNow')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPendingRestart(false)}>
              {t('aiTab.providerMode.restartLater')}
            </Button>
          </div>
        </div>
      )}

      {!pendingRestart && !switching && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.75rem', marginBottom: 0 }}>
          {t('aiTab.providerMode.immutableNote')}
        </p>
      )}

      {/* Confirm switch dialog */}
      <Dialog open={confirmTarget !== null} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('aiTab.providerMode.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('aiTab.providerMode.switchConfirm', {
                mode: confirmTarget
                  ? t('aiTab.providerMode.platformTitle')
                  : t('aiTab.providerMode.byokTitle'),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmTarget(null)}>
              {t('aiTab.providerMode.confirmCancel')}
            </Button>
            <Button onClick={executeSwitch}>
              {t('aiTab.providerMode.confirmOk')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Section 2: Model Selection ──────────────────────────

function ModelSection({
  instance,
  agentType,
  isPlatform,
  onInstanceUpdate,
}: {
  instance: Instance;
  agentType: AgentTypeInfo | null;
  isPlatform: boolean;
  onInstanceUpdate: () => void;
}) {
  const currentModel = (instance.config?.defaultModel as string) || '';
  const currentProvider = (instance.config?.defaultProvider as string) || '';
  const isCurrentlyAuto = currentModel === 'auto';
  const { t } = useTranslation();

  const [modelMode, setModelMode] = useState<'auto' | 'specific'>(isCurrentlyAuto ? 'auto' : 'specific');
  const [selectedProvider, setSelectedProvider] = useState(currentProvider);
  const [selectedModel, setSelectedModel] = useState(isCurrentlyAuto ? '' : currentModel);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [dynamicModels, setDynamicModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');

  const [byokCredentials, setByokCredentials] = useState<Credential[]>([]);
  const [byokApiKey, setByokApiKey] = useState('');
  const [byokCredSaving, setByokCredSaving] = useState(false);
  const [byokCredMessage, setByokCredMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isPlatform) return;
    let cancelled = false;
    setModelsLoading(true);
    api.get<{ models: AvailableModel[]; source: string }>('/litellm/models/available')
      .then(data => {
        if (!cancelled) setDynamicModels(data.models);
      })
      .catch(() => {
        if (!cancelled) {
          const manifest = agentType?.wizard?.platformModels ?? [];
          setDynamicModels(manifest.map(m => ({
            id: m.id,
            name: m.displayName || m.id,
            provider: '',
            recommended: m.isDefault ?? false,
          })));
        }
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [isPlatform, agentType]);

  const fetchByokCredentials = useCallback(() => {
    if (isPlatform) return;
    api.get<Credential[]>(`/instances/${instance.id}/credentials`)
      .then(data => setByokCredentials(data))
      .catch(() => { /* non-critical */ });
  }, [isPlatform, instance.id]);

  useEffect(() => { fetchByokCredentials(); }, [fetchByokCredentials]);

  const existingByokCred = useMemo(
    () => byokCredentials.find(c => c.provider === selectedProvider && c.credentialType === 'api_key'),
    [byokCredentials, selectedProvider],
  );

  const groupedModels = useMemo(() => {
    // Deduplicate: when a "latest" alias exists (e.g. claude-sonnet-4-0),
    // hide older date-versioned entries (e.g. claude-sonnet-4-20250514)
    // unless the user is searching. Keep recommended and selected models.
    let models = dynamicModels;
    if (!modelSearchQuery) {
      const latestIds = new Set(models.filter(m => m.id.includes('-latest') || m.name.includes('(latest)')).map(m => m.id));
      const keepIds = new Set([selectedModel]);
      models = models.filter(m => {
        if (keepIds.has(m.id) || m.recommended) return true;
        // Hide date-stamped versions (e.g. claude-3-5-haiku-20241022) when latest exists
        if (/\d{6,}/.test(m.id) && !m.id.includes('latest') && !latestIds.has(m.id)) {
          // Check if there's a "latest" or non-dated version for this model family
          const base = m.id.replace(/-\d{6,}.*$/, '');
          const hasLatest = models.some(o => o.id !== m.id && o.id.startsWith(base) && !(/\d{6,}/.test(o.id)));
          if (hasLatest) return false;
        }
        return true;
      });
    }
    const filtered = modelSearchQuery
      ? models.filter(m =>
          m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
          m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()))
      : models;
    const groups = new Map<string, AvailableModel[]>();
    for (const m of filtered) {
      const key = m.provider || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    // Sort: recommended first within each group
    for (const [, list] of groups) {
      list.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) || a.name.localeCompare(b.name));
    }
    return groups;
  }, [dynamicModels, modelSearchQuery, selectedModel]);

  const providers = agentType?.wizard?.providers ?? [];
  const selectedProviderInfo = providers.find(p => p.name === selectedProvider);
  const byokModels = selectedProviderInfo?.models ?? [];

  const hasChanges = isPlatform
    ? (modelMode === 'auto' && currentModel !== 'auto') ||
      (modelMode === 'specific' && (selectedModel !== currentModel))
    : (selectedProvider !== currentProvider || selectedModel !== currentModel);

  function handleProviderChange(providerId: string) {
    setSelectedProvider(providerId);
    const providerInfo = providers.find(p => p.name === providerId);
    const defaultModel = providerInfo?.models.find(m => m.isDefault)?.id ?? providerInfo?.models[0]?.id ?? '';
    setSelectedModel(defaultModel);
    setMessage(null);
    setByokApiKey('');
    setByokCredMessage(null);
  }

  async function handleByokCredSave() {
    if (!selectedProvider || !byokApiKey.trim()) return;
    setByokCredSaving(true);
    setByokCredMessage(null);
    try {
      await api.post(`/instances/${instance.id}/credentials`, {
        provider: selectedProvider,
        credentialType: 'api_key' as CredentialType,
        value: byokApiKey.trim(),
      });
      if (existingByokCred) {
        await api.delete(`/instances/${instance.id}/credentials/${existingByokCred.id}`);
      }
      setByokApiKey('');
      setByokCredMessage({ type: 'success', text: t('aiTab.byokCredential.saved') });
      fetchByokCredentials();
    } catch (err) {
      setByokCredMessage({ type: 'error', text: err instanceof Error ? err.message : t('aiTab.byokCredential.saveFailed') });
    } finally {
      setByokCredSaving(false);
    }
  }

  async function handleByokCredDelete() {
    if (!existingByokCred) return;
    try {
      await api.delete(`/instances/${instance.id}/credentials/${existingByokCred.id}`);
      setByokCredMessage({ type: 'success', text: t('aiTab.byokCredential.deleted') });
      fetchByokCredentials();
    } catch (err) {
      setByokCredMessage({ type: 'error', text: err instanceof Error ? err.message : t('aiTab.byokCredential.deleteFailed') });
    }
  }

  async function handleSave() {
    if (!hasChanges) return;
    setSaving(true);
    setMessage(null);
    try {
      if (isPlatform) {
        await api.patch(`/instances/${instance.id}/config`, {
          defaultModel: modelMode === 'auto' ? 'auto' : selectedModel,
        });
      } else {
        await api.patch(`/instances/${instance.id}/config`, {
          defaultProvider: selectedProvider,
          defaultModel: selectedModel,
        });
      }
      setMessage({ type: 'success', text: t('aiTab.save.success') });
      onInstanceUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('aiTab.save.error') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{t('aiTab.model.title')}</h3>

      {isPlatform ? (
        <>
          {/* Auto / Specific toggle */}
          <div style={radioGroupStyle}>
            <label
              style={radioCardStyle(modelMode === 'auto')}
              onClick={() => { setModelMode('auto'); setMessage(null); }}
            >
              <input type="radio"
                checked={modelMode === 'auto'}
                onChange={() => setModelMode('auto')}
                style={{ marginTop: '2px' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{t('aiTab.model.autoTitle')}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {t('aiTab.model.autoDesc')}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '6px', lineHeight: 1.6 }}>
                  {t('aiTab.model.autoRouting1')}<br />
                  {t('aiTab.model.autoRouting2')}<br />
                  {t('aiTab.model.autoRouting3')}
                </div>
              </div>
            </label>

            <label
              style={radioCardStyle(modelMode === 'specific')}
              onClick={() => {
                setModelMode('specific');
                if (!selectedModel || selectedModel === 'auto') {
                  const def = dynamicModels.find(m => m.recommended)?.id ?? dynamicModels[0]?.id ?? '';
                  setSelectedModel(def);
                }
                setMessage(null);
              }}
            >
              <input type="radio"
                checked={modelMode === 'specific'}
                onChange={() => setModelMode('specific')}
                style={{ marginTop: '2px' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t('aiTab.model.specificTitle')}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {t('aiTab.model.specificDesc')}
                </div>
                {modelMode === 'specific' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    {dynamicModels.length > 0 ? (
                      <>
                        {dynamicModels.length > 10 && (
                          <Input
                            className="wiz-input wiz-model-search"
                            type="text"
                            placeholder={t('wizard.confirm.modelSearchPlaceholder')}
                            value={modelSearchQuery}
                            onChange={e => setModelSearchQuery(e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                        )}
                        <div className="wiz-model-list">
                          {[...groupedModels.entries()].map(([provider, models]) => (
                            <div key={provider} className="wiz-model-group">
                              {groupedModels.size > 1 && (
                                <div className="wiz-model-group__label">{provider}</div>
                              )}
                              {models.map(m => (
                                <Button
                                  key={m.id}
                                  type="button"
                                  variant="ghost"
                                  className={`wiz-model-item${selectedModel === m.id ? ' wiz-model-item--active' : ''}`}
                                  onClick={e => { e.stopPropagation(); setSelectedModel(m.id); setMessage(null); }}
                                >
                                  <span className="wiz-model-item__name">{m.name || formatModelDisplayName(m.id)}</span>
                                  <span className="wiz-model-item__id">{formatModelDisplayName(m.id)}</span>
                                  {m.recommended && <span className="wiz-model-item__badge">{t('wizard.confirm.modelRecommended')}</span>}
                                </Button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : modelsLoading ? (
                      <div style={{ padding: '0.5rem 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    ) : (
                      <Input
                        type="text"
                        value={selectedModel}
                        onChange={e => { setSelectedModel(e.target.value); setMessage(null); }}
                        placeholder={t('aiTab.model.placeholder')}
                        style={selectStyle}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>{t('aiTab.model.providerLabel')}</label>
            <Select value={selectedProvider} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!providers.some(p => p.name === selectedProvider) && (
                  <SelectItem value={selectedProvider}>{getProviderDisplayName(selectedProvider, t)}</SelectItem>
                )}
                {providers.map(p => (
                  <SelectItem key={p.name} value={p.name}>{p.displayName} ({p.models.length} models)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProvider && (() => {
            const providerDef = AI_PROVIDERS.find(p => p.value === selectedProvider);
            const hasOAuth = providerDef?.authModes.includes('oauth') ?? false;
            const hasApiKey = providerDef?.authModes.includes('api_key') ?? true;
            const oauthCred = byokCredentials.find(c => c.provider === selectedProvider && c.credentialType === 'oauth_token');
            const isOAuthConnected = !!oauthCred;

            return (
              <div style={{
                marginBottom: '1rem',
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: (existingByokCred || isOAuthConnected) ? 'var(--color-primary-bg, rgba(99, 102, 241, 0.05))' : 'transparent',
              }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
                  {t('aiTab.byokCredential.label')}
                </label>

                {/* OAuth option */}
                {hasOAuth && (
                  <div style={{ marginBottom: hasApiKey ? '0.75rem' : 0 }}>
                    {isOAuthConnected ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-success, #059669)', fontWeight: 500 }}>
                          ✓ {t('aiTab.byokCredential.oauthConnected', 'OAuth connected')}
                        </span>
                        <Button variant="secondary" size="sm" onClick={async () => {
                          if (!oauthCred) return;
                          try {
                            await api.delete(`/instances/${instance.id}/credentials/${oauthCred.id}`);
                            fetchByokCredentials();
                          } catch { /* ignore */ }
                        }}>
                          {t('aiTab.byokCredential.disconnectButton', 'Disconnect')}
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (providerDef?.oauthFlow === 'device_code' && selectedProvider === 'openai') {
                              // Navigate to Overview tab which has the full OpenAI device-code flow
                              // Or trigger it inline — for now, link to the Overview tab
                              window.open(`/instances/${instance.id}#oauth-openai`, '_self');
                            } else if (providerDef?.oauthFlow === 'device_code' && selectedProvider === 'github-copilot') {
                              window.open(`/instances/${instance.id}#oauth-github`, '_self');
                            }
                          }}
                          style={{ width: '100%', justifyContent: 'center' }}
                        >
                          {t('aiTab.byokCredential.oauthButton', `Sign in with ${providerDef?.label ?? selectedProvider}`)}
                        </Button>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '0.25rem 0 0 0' }}>
                          {providerDef?.oauthFlow === 'device_code'
                            ? t('aiTab.byokCredential.oauthDeviceHint', 'Uses device code flow — opens a new page to authenticate.')
                            : t('aiTab.byokCredential.oauthHint', 'Opens a popup to authenticate.')}
                        </p>
                      </div>
                    )}
                    {hasApiKey && !isOAuthConnected && (
                      <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-tertiary)', margin: '0.5rem 0' }}>
                        {t('aiTab.byokCredential.orDivider', '— or use API key —')}
                      </div>
                    )}
                  </div>
                )}

                {/* API key option */}
                {hasApiKey && (
                  <>
                    {existingByokCred ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1 }}>
                          {t('aiTab.byokCredential.configured', {
                            date: new Date(existingByokCred.createdAt).toLocaleDateString(),
                          })}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleByokCredDelete}
                        >
                          {t('aiTab.byokCredential.deleteButton')}
                        </Button>
                      </div>
                    ) : !isOAuthConnected ? (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: '0 0 0.5rem 0' }}>
                        {t('aiTab.byokCredential.hint')}
                      </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: existingByokCred ? '0.5rem' : 0 }}>
                      <Input
                        type="password"
                        value={byokApiKey}
                        onChange={e => { setByokApiKey(e.target.value); setByokCredMessage(null); }}
                        placeholder={existingByokCred
                          ? t('aiTab.byokCredential.updatePlaceholder')
                          : t('aiTab.byokCredential.placeholder')}
                        style={{ flex: 1 }}
                      />
                      <Button
                        onClick={handleByokCredSave}
                        disabled={!byokApiKey.trim() || byokCredSaving}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {byokCredSaving
                          ? t('aiTab.save.saving')
                          : existingByokCred
                            ? t('aiTab.byokCredential.updateButton')
                            : t('aiTab.byokCredential.saveButton')}
                      </Button>
                    </div>
                  </>
                )}

                {byokCredMessage && (
                  <div
                    className={byokCredMessage.type === 'success' ? 'success-message' : 'error-message'}
                    role="alert"
                    style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                  >
                    {byokCredMessage.text}
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>{t('aiTab.model.modelLabel')}</label>
            {byokModels.length > 0 ? (
              <div className="wiz-model-list">
                {byokModels.map(m => (
                  <Button
                    key={m.id}
                    type="button"
                    variant="ghost"
                    className={`wiz-model-item${selectedModel === m.id ? ' wiz-model-item--active' : ''}`}
                    onClick={() => { setSelectedModel(m.id); setMessage(null); }}
                  >
                    <span className="wiz-model-item__name">{m.displayName || formatModelDisplayName(m.id)}</span>
                    <span className="wiz-model-item__id">{formatModelDisplayName(m.id)}</span>
                    {m.isDefault && <span className="wiz-model-item__badge">{t('aiTab.model.defaultSuffix')}</span>}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                type="text"
                value={selectedModel}
                onChange={e => { setSelectedModel(e.target.value); setMessage(null); }}
                placeholder={t('aiTab.model.placeholder')}
                style={selectStyle}
              />
            )}
          </div>
        </>
      )}

      {message && (
        <div className={message.type === 'success' ? 'success-message' : 'error-message'} role="alert" style={{ marginTop: '1rem' }}>
          {message.text}
        </div>
      )}

      <Button onClick={handleSave} disabled={!hasChanges || saving} style={{ marginTop: '1rem' }}>
        {saving ? t('aiTab.save.saving') : t('aiTab.save.button')}
      </Button>
    </div>
  );
}

// ─── Section 3: Tool Credentials ─────────────────────────

function ToolCredentialsSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState('');
  const [customProvider, setCustomProvider] = useState('');
  const [value, setValue] = useState('');
  const [templateReqs, setTemplateReqs] = useState<TemplateRequirementsData | null>(null);

  // SaleVoice / GEO credential state
  const [geoCredentialMode, setGeoCredentialMode] = useState<'oauth' | 'apikey'>('oauth');
  const [geoApiKey, setGeoApiKey] = useState('');
  const [geoConnected, setGeoConnected] = useState(false);
  const [geoConnecting, setGeoConnecting] = useState(false);

  const effectiveProvider = provider === OTHER_PROVIDER_VALUE ? customProvider : provider;

  const fetchCredentials = useCallback(async () => {
    try {
      const data = await api.get<Credential[]>(`/instances/${instanceId}/credentials`);
      setCredentials(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.toolCredentials.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  const fetchTemplateRequirements = useCallback(async () => {
    try {
      const data = await api.get<TemplateRequirementsData>(`/instances/${instanceId}/template-requirements`);
      setTemplateReqs(data);
    } catch { /* non-critical */ }
  }, [instanceId]);

  useEffect(() => {
    fetchCredentials();
    fetchTemplateRequirements();
  }, [fetchCredentials, fetchTemplateRequirements]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const providerToSend = effectiveProvider;
    if (!providerToSend) {
      setError(t('aiTab.toolCredentials.selectError'));
      return;
    }
    try {
      await api.post(`/instances/${instanceId}/credentials`, {
        provider: providerToSend,
        credentialType: 'api_key' as CredentialType,
        value,
      });
      setShowForm(false);
      setProvider('');
      setCustomProvider('');
      setValue('');
      fetchCredentials();
      fetchTemplateRequirements();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.toolCredentials.addFailed'));
    }
  };

  const handleDelete = async (credId: string) => {
    if (!window.confirm(t('aiTab.toolCredentials.deleteConfirm'))) return;
    try {
      await api.delete(`/instances/${instanceId}/credentials/${credId}`);
      fetchCredentials();
      fetchTemplateRequirements();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.toolCredentials.deleteFailed'));
    }
  };

  const handleSalevoiceOAuth = async () => {
    setGeoConnecting(true);
    setError(null);
    try {
      const data = await api.post<{ authUrl: string; state: string }>('/oauth/salevoice/authorize', {});
      sessionStorage.setItem('salevoice_oauth_pending', JSON.stringify({ state: data.state }));

      let settled = false;
      const settle = (msgData: { type?: string; success?: boolean; code?: string; state?: string }) => {
        if (settled) return;
        if (msgData?.type !== 'salevoice_oauth_complete' || !msgData.success) return;
        settled = true;
        cleanupListeners();
        setGeoConnected(true);
        setGeoConnecting(false);
        // Save credential at instance level so template requirements are fulfilled
        api.post(`/instances/${instanceId}/credentials`, {
          provider: 'salevoice',
          credentialType: 'api_key',
          value: 'oauth_connected',
        }).then(() => {
          fetchCredentials();
          fetchTemplateRequirements();
        }).catch(() => { /* best-effort */ });
      };

      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel('salevoice_oauth');
        bc.onmessage = (e: MessageEvent) => settle(e.data);
      } catch { /* unsupported */ }

      const onWindowMessage = (e: MessageEvent) => settle(e.data);
      window.addEventListener('message', onWindowMessage);

      const onStorage = (e: StorageEvent) => {
        if (e.key !== 'salevoice_oauth_result' || !e.newValue) return;
        try { settle(JSON.parse(e.newValue)); } catch { /* ignore */ }
      };
      window.addEventListener('storage', onStorage);

      const cleanupListeners = () => {
        bc?.close();
        window.removeEventListener('message', onWindowMessage);
        window.removeEventListener('storage', onStorage);
        try { localStorage.removeItem('salevoice_oauth_result'); } catch { /* ignore */ }
      };

      const popup = window.open(data.authUrl, 'salevoice_oauth', 'width=600,height=700,popup=yes');
      if (!popup) {
        cleanupListeners();
        setError(t('aiTab.toolCredentials.salevoice.authFailed'));
        setGeoConnecting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.toolCredentials.salevoice.authFailed'));
      setGeoConnecting(false);
    }
  };

  const handleSaveGeoApiKey = async () => {
    if (!geoApiKey.trim()) return;
    setGeoConnecting(true);
    setError(null);
    try {
      await api.post('/credentials', {
        provider: 'salevoice',
        credentialType: 'api_key',
        value: geoApiKey.trim(),
        displayName: 'SaleVoice (API Key)',
      });
      await api.post(`/instances/${instanceId}/credentials`, {
        provider: 'salevoice',
        credentialType: 'api_key',
        value: geoApiKey.trim(),
      });
      setGeoConnected(true);
      setGeoConnecting(false);
      setGeoApiKey('');
      fetchCredentials();
      fetchTemplateRequirements();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiTab.toolCredentials.salevoice.saveFailed'));
      setGeoConnecting(false);
    }
  };

  const needsSalevoice = templateReqs?.requirements.some(req => req.provider === 'salevoice') ?? false;
  const salevoiceFulfilled = templateReqs?.credentialStatus['salevoice:api_key'] === 'fulfilled';

  const missingRequirements = templateReqs
    ? Object.entries(templateReqs.credentialStatus).filter(([, status]) => status === 'missing')
    : [];

  if (loading) return <div style={sectionStyle}><CardSkeleton lines={4} /></div>;

  return (
    <div style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{t('aiTab.toolCredentials.title')}</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1rem' }}>
        {t('aiTab.toolCredentials.description')}
      </p>

      {error && <div className="error-message" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Template requirements checklist */}
      {templateReqs && templateReqs.requirements.length > 0 && missingRequirements.length > 0 && (
        <div className="credential-checklist has-missing" style={{ marginBottom: '1rem' }}>
          <div className="credential-checklist-header">
            {t('aiTab.toolCredentials.required', { count: missingRequirements.length })}
          </div>
          {templateReqs.requirements.map(req => {
            const key = `${req.provider}:${req.credentialType}`;
            const status = templateReqs.credentialStatus[key];
            return (
              <div key={key} className={`credential-checklist-item ${status === 'fulfilled' ? 'credential-fulfilled' : 'credential-missing'}`}>
                <span className="credential-checklist-icon">{status === 'fulfilled' ? '✓' : '✗'}</span>
                <div className="credential-checklist-info">
                  <strong>{req.provider}</strong> : {req.credentialType}
                  {req.description && <span className="credential-checklist-desc"> — {req.description}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SaleVoice / GEO credential section */}
      {needsSalevoice && !salevoiceFulfilled && !geoConnected && (
        <div style={{
          marginBottom: '1rem',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid var(--color-primary)',
          background: 'var(--bg-tertiary)',
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            {t('aiTab.toolCredentials.salevoice.title')}
          </h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>
            {t('aiTab.toolCredentials.salevoice.description')}
          </p>

          <div style={radioGroupStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="radio"
                name="geo-cred-mode"
                checked={geoCredentialMode === 'oauth'}
                onChange={() => setGeoCredentialMode('oauth')}
              />
              <div>
                <strong>{t('aiTab.toolCredentials.salevoice.oauthLabel')}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {t('aiTab.toolCredentials.salevoice.oauthDescription')}
                </div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="radio"
                name="geo-cred-mode"
                checked={geoCredentialMode === 'apikey'}
                onChange={() => setGeoCredentialMode('apikey')}
              />
              <div>
                <strong>{t('aiTab.toolCredentials.salevoice.apiKeyLabel')}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {t('aiTab.toolCredentials.salevoice.apiKeyDescription')}
                </div>
              </div>
            </label>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {geoCredentialMode === 'oauth' ? (
              <Button onClick={handleSalevoiceOAuth} disabled={geoConnecting}>
                {geoConnecting ? t('aiTab.toolCredentials.salevoice.connecting') : t('aiTab.toolCredentials.salevoice.connectButton')}
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Input
                  type="password"
                  value={geoApiKey}
                  onChange={e => setGeoApiKey(e.target.value)}
                  placeholder={t('aiTab.toolCredentials.salevoice.apiKeyPlaceholder')}
                  style={{ flex: 1 }}
                />
                <Button onClick={handleSaveGeoApiKey} disabled={geoConnecting || !geoApiKey.trim()}>
                  {geoConnecting ? t('aiTab.toolCredentials.salevoice.connecting') : t('aiTab.toolCredentials.salevoice.saveButton')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {needsSalevoice && (salevoiceFulfilled || geoConnected) && (
        <div style={{
          marginBottom: '1rem',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid var(--color-success, #22c55e)',
          background: 'var(--bg-tertiary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-success, #22c55e)' }}>
            <span>✓</span>
            <strong>{t('aiTab.toolCredentials.salevoice.connected')}</strong>
          </div>
        </div>
      )}

      {/* Existing credentials list */}
      {credentials.length > 0 && (
        <div className="provider-list" style={{ marginBottom: '1rem' }}>
          {credentials.map(cred => (
            <div key={cred.id} className="provider-card">
              <div className="provider-card-header">
                <strong>{cred.provider}</strong>
                <div className="provider-card-actions">
                   <Button variant="destructive" size="sm" onClick={() => handleDelete(cred.id)}>{t('aiTab.toolCredentials.deleteButton')}</Button>
                </div>
              </div>
              <div className="provider-card-details">
                <span>{t('aiTab.toolCredentials.type')} {cred.credentialType}</span>
                <span>{t('aiTab.toolCredentials.added')} {new Date(cred.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {credentials.length === 0 && !showForm && missingRequirements.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('aiTab.toolCredentials.noCredentials')}</p>
      )}

      {/* Add credential form */}
      {showForm ? (
        <div className="provider-form">
          <div className="form-group">
            <label htmlFor="tool-cred-provider">{t('aiTab.model.providerLabel')}</label>
            <select
              id="tool-cred-provider"
              value={provider}
              onChange={e => { setProvider(e.target.value); if (e.target.value !== OTHER_PROVIDER_VALUE) setCustomProvider(''); setValue(''); }}
            >
              <option value="">{t('aiTab.toolCredentials.selectProvider')}</option>
              <optgroup label={t('aiTab.toolCredentials.toolsGroup')}>
                {TOOL_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </optgroup>
              <optgroup label={t('aiTab.toolCredentials.aiProvidersGroup')}>
                {AI_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </optgroup>
              <option value={OTHER_PROVIDER_VALUE}>{t('aiTab.toolCredentials.other')}</option>
            </select>
          </div>

          {provider === OTHER_PROVIDER_VALUE && (
            <div className="form-group">
              <label htmlFor="tool-cred-custom">{t('aiTab.toolCredentials.providerName')}</label>
              <Input
                type="text"
                id="tool-cred-custom"
                value={customProvider}
                onChange={e => setCustomProvider(e.target.value)}
                placeholder={t('aiTab.toolCredentials.providerPlaceholder')}
                required
              />
            </div>
          )}

          {effectiveProvider && (
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label htmlFor="tool-cred-value">{t('aiTab.toolCredentials.apiKeyLabel')}</label>
                <Input
                  type="password"
                  id="tool-cred-value"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={t('aiTab.toolCredentials.apiKeyPlaceholder')}
                  required
                />
              </div>
              <div className="form-actions">
                <Button type="submit">{t('aiTab.toolCredentials.addButton')}</Button>
              </div>
            </form>
          )}

          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setProvider(''); setCustomProvider(''); }}>{t('aiTab.toolCredentials.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowForm(true)}>{t('aiTab.toolCredentials.addButton')}</Button>
      )}
    </div>
  );
}
