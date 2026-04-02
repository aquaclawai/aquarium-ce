import { useTranslation } from 'react-i18next';
import type { SnapshotSummary } from '@aquarium/shared';

interface SnapshotCardProps {
  snapshot: SnapshotSummary;
  onSelect: () => void;
  onDelete: () => void;
}

const TRIGGER_I18N_KEYS: Record<string, string> = {
  manual: 'snapshots.triggerTypes.manual',
  pre_operation: 'snapshots.triggerTypes.preOperation',
  daily: 'snapshots.triggerTypes.daily',
};

const TRIGGER_CLASSES: Record<string, string> = {
  manual: 'snapshot-badge--manual',
  pre_operation: 'snapshot-badge--auto',
  daily: 'snapshot-badge--daily',
};

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotCard({ snapshot, onSelect, onDelete }: SnapshotCardProps) {
  const { t } = useTranslation();

  return (
    <button type="button" className="snapshot-card" onClick={onSelect}>
      <div className="snapshot-card-row">
        <span className={`snapshot-badge ${TRIGGER_CLASSES[snapshot.triggerType] ?? ''}`}>
          {TRIGGER_I18N_KEYS[snapshot.triggerType] ? t(TRIGGER_I18N_KEYS[snapshot.triggerType]) : snapshot.triggerType}
        </span>
        <span className="snapshot-card-date">
          {new Date(snapshot.createdAt).toLocaleString()}
        </span>
        <span className="snapshot-card-desc">
          {snapshot.description || snapshot.triggerDetail || t('snapshots.noDescription')}
        </span>
        <span className="snapshot-card-meta">
          <span className="snapshot-card-size">{formatBytes(snapshot.totalSizeBytes)}</span>
          {snapshot.instanceStatus && (
            <span className={`snapshot-card-status snapshot-card-status--${snapshot.instanceStatus}`}>
              {snapshot.instanceStatus}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            className="snapshot-card-delete"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDelete(); } }}
          >
            {t('common.buttons.delete')}
          </span>
        </span>
      </div>
    </button>
  );
}
