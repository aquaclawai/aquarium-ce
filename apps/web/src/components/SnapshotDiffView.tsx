import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { SnapshotDiff, SnapshotDiffEntry } from '@aquarium/shared';

interface SnapshotDiffViewProps {
  instanceId: string;
  snapshotId: string;
  onRestore: () => void;
  onClose: () => void;
}

const CHANGE_I18N_KEYS: Record<string, string> = {
  modified: 'snapshots.diff.changeTypes.modified',
  added: 'snapshots.diff.changeTypes.added',
  removed: 'snapshots.diff.changeTypes.removed',
  unchanged: 'snapshots.diff.changeTypes.unchanged',
};

const CHANGE_CLASSES: Record<string, string> = {
  modified: 'diff-modified',
  added: 'diff-added',
  removed: 'diff-removed',
  unchanged: 'diff-unchanged',
};

function DiffEntry({ entry }: { entry: SnapshotDiffEntry }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(entry.type !== 'unchanged');

  return (
    <div className={`diff-entry ${CHANGE_CLASSES[entry.type] ?? ''}`}>
      <button
        className="diff-entry-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={`diff-badge ${CHANGE_CLASSES[entry.type] ?? ''}`}>
          {CHANGE_I18N_KEYS[entry.type] ? t(CHANGE_I18N_KEYS[entry.type]) : entry.type}
        </span>
        <span className="diff-entry-file">{entry.file}</span>
        <span className="diff-entry-toggle">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && entry.type !== 'unchanged' && (
        <div className="diff-entry-content">
          {entry.type === 'removed' && entry.snapshotContent != null && (
            <div className="diff-block diff-block--old">
              <div className="diff-block-label">{t('snapshots.diff.snapshotWillBeRestored')}</div>
              <pre>{entry.snapshotContent}</pre>
            </div>
          )}
          {entry.type === 'added' && entry.currentContent != null && (
            <div className="diff-block diff-block--new">
              <div className="diff-block-label">{t('snapshots.diff.currentWillBeRemoved')}</div>
              <pre>{entry.currentContent}</pre>
            </div>
          )}
          {entry.type === 'modified' && (
            <div className="diff-side-by-side">
              <div className="diff-block diff-block--old">
                <div className="diff-block-label">{t('snapshots.diff.snapshotWillBeRestored')}</div>
                <pre>{entry.snapshotContent ?? ''}</pre>
              </div>
              <div className="diff-block diff-block--new">
                <div className="diff-block-label">{t('snapshots.diff.current')}</div>
                <pre>{entry.currentContent ?? ''}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SnapshotDiffView({ instanceId, snapshotId, onRestore, onClose }: SnapshotDiffViewProps) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<SnapshotDiff>(`/instances/${instanceId}/snapshots/${snapshotId}/diff`)
      .then(data => { if (!cancelled) setDiff(data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t('snapshots.diff.failedToLoadDiff')); })
      .finally(() => { if (!cancelled) setSettled(true); });
    return () => { cancelled = true; };
  }, [instanceId, snapshotId, t]);

  const loading = !settled;

  const changedCount = diff ? diff.changes.filter(c => c.type !== 'unchanged').length : 0;

  return (
    <div className="snapshot-diff-view">
      <div className="snapshot-diff-header">
        <div>
          <h3>{t('snapshots.diff.title')}</h3>
          {diff && (
            <span className="snapshot-diff-subtitle">
              {t('snapshots.diff.takenAt', { date: new Date(diff.snapshotCreatedAt).toLocaleString(), count: changedCount })}
            </span>
          )}
        </div>
        <div className="snapshot-diff-actions">
          <button onClick={onRestore} disabled={loading || !!error}>
            {t('snapshots.diff.restoreButton')}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            {t('common.buttons.close')}
          </button>
        </div>
      </div>

      {loading && <div className="snapshot-diff-loading">{t('snapshots.diff.loadingDiff')}</div>}
      {error && <div className="error-message" role="alert">{error}</div>}

      {diff && (
        <div className="snapshot-diff-entries">
          {diff.changes.length === 0 ? (
            <div className="info-message">{t('snapshots.diff.noChanges')}</div>
          ) : (
            diff.changes.map(entry => <DiffEntry key={entry.file} entry={entry} />)
          )}
        </div>
      )}
    </div>
  );
}
