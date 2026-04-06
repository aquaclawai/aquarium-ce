import { useTranslation } from 'react-i18next';
import type { SystemConfig, StorageStats } from '@aquarium/shared';
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
import { KPICardSkeleton } from '@/components/skeletons';

export interface DataSectionProps {
  storageStats: StorageStats | null;
  loadingStats: boolean;
  cleaningUp: boolean;
  exportFormat: 'json' | 'csv';
  onExportFormatChange: (format: 'json' | 'csv') => void;
  onCleanup: () => Promise<void>;
  onExport: (type: 'users' | 'instances' | 'events') => Promise<void>;
  onRefreshStats: () => Promise<void>;
  config: SystemConfig;
  onConfigChange: (config: SystemConfig) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  hasChanges: boolean;
}

export function DataSection({
  storageStats,
  loadingStats,
  cleaningUp,
  exportFormat,
  onExportFormatChange,
  onCleanup,
  onExport,
  onRefreshStats,
  config,
  onConfigChange,
  saving,
  onSave,
  onReset,
  hasChanges,
}: DataSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.retentionPolicies')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.retentionPoliciesDesc')}</p>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.eventLogRetention')}</label>
          <Input
            type="number"
            min={1}
            value={config.dataRetentionEventsDays ?? 90}
            onChange={e => onConfigChange({ ...config, dataRetentionEventsDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.authEventRetention')}</label>
          <Input
            type="number"
            min={1}
            value={config.dataRetentionAuthEventsDays ?? 90}
            onChange={e => onConfigChange({ ...config, dataRetentionAuthEventsDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__field">
          <label>{t('systemConfig.data.auditLogRetention')}</label>
          <Input
            type="number"
            min={1}
            value={config.dataRetentionAuditLogDays ?? 90}
            onChange={e => onConfigChange({ ...config, dataRetentionAuditLogDays: parseInt(e.target.value, 10) || 90 })}
          />
        </div>

        <div className="sys-config__toggle-row">
          <div className="sys-config__toggle-info">
            <span className="sys-config__toggle-label">{t('systemConfig.data.autoCleanup')}</span>
            <span className="sys-config__toggle-desc">{t('systemConfig.data.autoCleanupDesc')}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            role="switch"
            aria-checked={config.dataAutoCleanupEnabled ?? false}
            className={`sys-config__switch${config.dataAutoCleanupEnabled ? ' sys-config__switch--on' : ''}`}
            onClick={() => onConfigChange({ ...config, dataAutoCleanupEnabled: !config.dataAutoCleanupEnabled })}
          >
            <span className="sys-config__switch-thumb" />
          </Button>
        </div>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.storageUsage')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.storageUsageDesc')}</p>

        {loadingStats ? (
          <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}><KPICardSkeleton /><KPICardSkeleton /></div>
        ) : storageStats ? (
          <>
            <table className="sys-config__table">
              <thead>
                <tr>
                  <th>{t('systemConfig.data.tableName')}</th>
                  <th>{t('systemConfig.data.tableSize')}</th>
                  <th>{t('systemConfig.data.tableRows')}</th>
                </tr>
              </thead>
              <tbody>
                {storageStats.tables.map(tbl => (
                  <tr key={tbl.table}>
                    <td><code>{tbl.table}</code></td>
                    <td>{tbl.sizeFormatted}</td>
                    <td>{tbl.rowCount.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="sys-config__table-total">
                  <td><strong>{t('systemConfig.data.totalSize')}</strong></td>
                  <td><strong>{storageStats.totalSizeFormatted}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefreshStats}
              disabled={loadingStats}
            >
              {t('systemConfig.data.refreshStats')}
            </Button>
          </>
        ) : null}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.manualCleanup')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.manualCleanupDesc')}</p>
        <Button
          variant="destructive"
          onClick={onCleanup}
          disabled={cleaningUp}
        >
          {cleaningUp ? '...' : t('systemConfig.data.runCleanup')}
        </Button>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.data.dataExport')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.data.dataExportDesc')}</p>

        <div className="sys-config__export-controls">
          <div className="sys-config__field" style={{ marginBottom: 'var(--spacing-md)' }}>
            <label>{t('systemConfig.data.exportFormat')}</label>
            <Select value={exportFormat} onValueChange={v => onExportFormatChange(v as 'json' | 'csv')}>
              <SelectTrigger style={{ width: 'auto', minWidth: 120 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">{t('systemConfig.data.formatJson')}</SelectItem>
                <SelectItem value="csv">{t('systemConfig.data.formatCsv')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="sys-config__export-buttons">
            <Button variant="secondary" onClick={() => onExport('users')}>
              {t('systemConfig.data.exportUsers')}
            </Button>
            <Button variant="secondary" onClick={() => onExport('instances')}>
              {t('systemConfig.data.exportInstances')}
            </Button>
            <Button variant="secondary" onClick={() => onExport('events')}>
              {t('systemConfig.data.exportEvents')}
            </Button>
          </div>
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
