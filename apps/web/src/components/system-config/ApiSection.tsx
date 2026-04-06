import { useTranslation } from 'react-i18next';
import type { SystemConfig, RateLimitConfig, PlatformApiKey } from '@aquarium/shared';
import '../../pages/SystemConfigPage.css';
import { Button, Input } from '@/components/ui';

const DEFAULT_RATE_LIMIT_GENERAL: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 300 };
const DEFAULT_RATE_LIMIT_LOGIN: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 };
const DEFAULT_RATE_LIMIT_CREDENTIALS: RateLimitConfig = { windowMs: 60 * 1000, max: 30 };

export interface ApiSectionProps {
  config: SystemConfig;
  onConfigChange: (config: SystemConfig) => void;
  generatedKey: string | null;
  apiKeys: PlatformApiKey[];
  newKeyName: string;
  onNewKeyNameChange: (v: string) => void;
  onGenerateKey: () => Promise<void>;
  onRevokeKey: (id: string) => Promise<void>;
  newCorsOrigin: string;
  onNewCorsOriginChange: (v: string) => void;
  corsError: string | null;
  onAddCorsOrigin: () => void;
  onRemoveCorsOrigin: (origin: string) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  hasChanges: boolean;
}

export function ApiSection({
  config,
  onConfigChange,
  generatedKey,
  apiKeys,
  newKeyName,
  onNewKeyNameChange,
  onGenerateKey,
  onRevokeKey,
  newCorsOrigin,
  onNewCorsOriginChange,
  corsError,
  onAddCorsOrigin,
  onRemoveCorsOrigin,
  saving,
  onSave,
  onReset,
  hasChanges,
}: ApiSectionProps) {
  const { t } = useTranslation();
  const corsOrigins = config.corsOrigins ?? [];

  const getRateLimit = (field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials'): RateLimitConfig => {
    const defaults: Record<string, RateLimitConfig> = {
      rateLimitGeneral: DEFAULT_RATE_LIMIT_GENERAL,
      rateLimitLogin: DEFAULT_RATE_LIMIT_LOGIN,
      rateLimitCredentials: DEFAULT_RATE_LIMIT_CREDENTIALS,
    };
    return config[field] ?? defaults[field];
  };

  const setRateLimit = (field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials', value: RateLimitConfig) => {
    onConfigChange({ ...config, [field]: value });
  };

  const renderRateLimitGroup = (
    label: string,
    field: 'rateLimitGeneral' | 'rateLimitLogin' | 'rateLimitCredentials',
  ) => {
    const rl = getRateLimit(field);
    return (
      <div className="sys-config__rate-group">
        <h3 className="sys-config__rate-group-title">{label}</h3>
        <div className="sys-config__rate-fields">
          <div className="sys-config__field">
            <label>{t('systemConfig.api.windowMinutes')}</label>
            <Input
              type="number"
              min={1}
              value={Math.round(rl.windowMs / 60000)}
              onChange={e => setRateLimit(field, { ...rl, windowMs: (parseInt(e.target.value, 10) || 1) * 60000 })}
            />
          </div>
          <div className="sys-config__field">
            <label>{t('systemConfig.api.maxRequests')}</label>
            <Input
              type="number"
              min={1}
              value={rl.max}
              onChange={e => setRateLimit(field, { ...rl, max: parseInt(e.target.value, 10) || 1 })}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.api.rateLimiting')}</h2>
        {renderRateLimitGroup(t('systemConfig.api.rateLimitGeneral'), 'rateLimitGeneral')}
        {renderRateLimitGroup(t('systemConfig.api.rateLimitLogin'), 'rateLimitLogin')}
        {renderRateLimitGroup(t('systemConfig.api.rateLimitCredentials'), 'rateLimitCredentials')}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.api.corsOrigins')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.api.corsOriginsDesc')}</p>

        {corsOrigins.length > 0 && (
          <ul className="sys-config__list">
            {corsOrigins.map(origin => (
              <li key={origin} className="sys-config__list-item">
                <span>{origin}</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onRemoveCorsOrigin(origin)}
                >
                  {t('systemConfig.api.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="sys-config__add-row">
          <Input
            type="text"
            value={newCorsOrigin}
            onChange={e => { onNewCorsOriginChange(e.target.value); }}
            placeholder={t('systemConfig.api.originPlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter') onAddCorsOrigin(); }}
          />
          <Button
            size="sm"
            onClick={onAddCorsOrigin}
            disabled={!newCorsOrigin.trim()}
          >
            {t('systemConfig.api.addOrigin')}
          </Button>
        </div>
        {corsError && <div className="error-message" style={{ marginTop: '0.5rem' }}>{corsError}</div>}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.api.webhookUrl')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.api.webhookUrlDesc')}</p>
        <div className="sys-config__field">
          <Input
            type="text"
            value={config.webhookUrl ?? ''}
            onChange={e => onConfigChange({ ...config, webhookUrl: e.target.value })}
            placeholder={t('systemConfig.api.webhookPlaceholder')}
          />
        </div>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.api.apiKeys')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.api.apiKeysDesc')}</p>

        <table className="sys-config__table">
          <thead>
            <tr>
              <th>{t('systemConfig.api.keyName')}</th>
              <th>{t('systemConfig.api.keyPrefix')}</th>
              <th>{t('systemConfig.api.createdAt')}</th>
              <th>{t('systemConfig.api.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {apiKeys.length === 0 ? (
              <tr>
                <td colSpan={4} className="sys-config__table-empty">
                  {t('systemConfig.api.noKeys')}
                </td>
              </tr>
            ) : (
              apiKeys.map((key: PlatformApiKey) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td><code>{key.prefix}...</code></td>
                  <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onRevokeKey(key.id)}
                    >
                      {t('systemConfig.api.revoke')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="sys-config__add-row">
          <Input
            type="text"
            value={newKeyName}
            onChange={e => onNewKeyNameChange(e.target.value)}
            placeholder={t('systemConfig.api.keyNamePlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter') onGenerateKey(); }}
          />
          <Button
            size="sm"
            onClick={onGenerateKey}
            disabled={!newKeyName.trim()}
          >
            {t('systemConfig.api.generateKey')}
          </Button>
        </div>

        {generatedKey && (
          <div className="sys-config__key-display">
            <p>{t('systemConfig.api.generatedKeyMsg')}</p>
            <code>{generatedKey}</code>
          </div>
        )}
      </section>

      <div className="sys-config__header-actions">
        <Button
          variant="secondary"
          onClick={onReset}
          disabled={saving || !hasChanges}
        >
          {t('systemConfig.resetDefaults')}
        </Button>
        <Button
          onClick={onSave}
          disabled={saving || !hasChanges}
        >
          {saving ? t('systemConfig.saving') : t('systemConfig.saveConfig')}
        </Button>
      </div>
    </>
  );
}
