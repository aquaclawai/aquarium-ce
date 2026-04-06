import { useTranslation } from 'react-i18next';
import type { SystemConfig } from '@aquarium/shared';
import '../../pages/SystemConfigPage.css';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';

const TIMEZONE_OPTIONS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
];

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
];

export interface GeneralSectionProps {
  config: SystemConfig;
  onConfigChange: (config: SystemConfig) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  hasChanges: boolean;
}

export function GeneralSection({ config, onConfigChange, saving, onSave, onReset, hasChanges }: GeneralSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.general.basicSettings')}</h2>

        <div className="sys-config__field">
          <label htmlFor="platform-name">{t('systemConfig.general.platformName')}</label>
          <Input
            id="platform-name"
            type="text"
            value={config.platformName ?? ''}
            onChange={e => onConfigChange({ ...config, platformName: e.target.value })}
            placeholder={t('systemConfig.general.platformNamePlaceholder')}
          />
        </div>

        <div className="sys-config__field">
          <label htmlFor="platform-desc">{t('systemConfig.general.platformDescription')}</label>
          <textarea
            id="platform-desc"
            value={config.platformDescription ?? ''}
            onChange={e => onConfigChange({ ...config, platformDescription: e.target.value })}
            placeholder={t('systemConfig.general.platformDescriptionPlaceholder')}
            rows={3}
          />
        </div>

        <div className="sys-config__field">
          <label htmlFor="timezone">{t('systemConfig.general.timezone')}</label>
          <Select
            value={config.timezone ?? 'UTC'}
            onValueChange={v => onConfigChange({ ...config, timezone: v })}
          >
            <SelectTrigger id="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map(tz => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sys-config__field">
          <label htmlFor="language">{t('systemConfig.general.language')}</label>
          <Select
            value={config.language ?? 'zh'}
            onValueChange={v => onConfigChange({ ...config, language: v })}
          >
            <SelectTrigger id="language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map(lang => (
                <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.general.featureToggles')}</h2>

        <div className="sys-config__toggle-row">
          <div className="sys-config__toggle-info">
            <span className="sys-config__toggle-label">{t('systemConfig.general.enableUserRegistration')}</span>
            <span className="sys-config__toggle-desc">{t('systemConfig.general.enableUserRegistrationDesc')}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            role="switch"
            aria-checked={config.enableUserRegistration ?? true}
            className={`sys-config__switch${config.enableUserRegistration !== false ? ' sys-config__switch--on' : ''}`}
            onClick={() => onConfigChange({ ...config, enableUserRegistration: !(config.enableUserRegistration ?? true) })}
          >
            <span className="sys-config__switch-thumb" />
          </Button>
        </div>
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
