import { useTranslation } from 'react-i18next';
import type { SystemConfig } from '@aquarium/shared';
import '../../pages/SystemConfigPage.css';
import { Button } from '@/components/ui';

export interface NotificationsSectionProps {
  config: SystemConfig;
  onConfigChange: (config: SystemConfig) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  hasChanges: boolean;
}

export function NotificationsSection({ saving, onSave, onReset, hasChanges }: NotificationsSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="sys-config__coming-soon">
        {t('common.comingSoon')}
      </div>

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
