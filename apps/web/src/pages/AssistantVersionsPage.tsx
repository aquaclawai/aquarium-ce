import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { InstancePublic, SnapshotSummary, SnapshotDiff, PaginatedResponse, ConfigChangeSummary } from '@aquarium/shared';
import './MyAssistantsPage.css';

interface DisplayChange {
  label: string;
  old: string;
  newVal: string;
}

interface DisplaySnapshot {
  id: string;
  version: string;
  description: string;
  createdAt: string;
  changes: DisplayChange[];
}

function mapChangeSummaryToDisplay(changeSummary?: ConfigChangeSummary[]): DisplayChange[] {
  if (!changeSummary || changeSummary.length === 0) return [];
  return changeSummary.slice(0, 3).map((c) => ({
    label: c.fieldLabel,
    old: c.oldValue ?? '（空）',
    newVal: c.newValue ?? '（空）',
  }));
}

function toDisplaySnapshot(snap: SnapshotSummary): DisplaySnapshot {
  return {
    id: snap.id,
    version: snap.version ?? 'v1',
    description: snap.description ?? snap.triggerDetail ?? '',
    createdAt: snap.createdAt,
    changes: mapChangeSummaryToDisplay(snap.changeSummary),
  };
}

export function AssistantVersionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [instance, setInstance] = useState<InstancePublic | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<{ snapshotId: string; diff: SnapshotDiff } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      api.get<InstancePublic>(`/instances/${id}`),
      api.get<PaginatedResponse<SnapshotSummary>>(`/instances/${id}/snapshots?page=1&limit=50`),
    ])
      .then(([inst, snapshotRes]) => {
        if (cancelled) return;
        setInstance(inst);
        setSnapshots(snapshotRes.items);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('assistantVersions.loadFailed'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, t]);

  const handleRestore = useCallback(async (snapshotId: string) => {
    if (!id) return;
    setRestoringId(snapshotId);
    setError(null);
    try {
      await api.post(`/instances/${id}/snapshots/${snapshotId}/restore`, {});
      const snapshotRes = await api.get<PaginatedResponse<SnapshotSummary>>(`/instances/${id}/snapshots?page=1&limit=50`);
      setSnapshots(snapshotRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assistantVersions.restoreFailed'));
    } finally {
      setRestoringId(null);
    }
  }, [id, t]);

  const handleViewDiff = useCallback(async (snapshotId: string) => {
    if (!id) return;
    try {
      const diff = await api.get<SnapshotDiff>(`/instances/${id}/snapshots/${snapshotId}/diff`);
      setSelectedDiff({ snapshotId, diff });
    } catch { /* ignore */ }
  }, [id]);

  if (loading) {
    return <div className="aver-page"><div className="aver-loading">{t('common.labels.loading')}</div></div>;
  }

  const displaySnapshots: DisplaySnapshot[] = snapshots.map(toDisplaySnapshot);

  const currentVersion = displaySnapshots.length > 0
    ? displaySnapshots[0].version
    : instance?.imageTag ?? '—';

  return (
    <div className="aver-page">
      <button className="aver-back" onClick={() => navigate('/assistants')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('assistantVersions.backToAssistants')}
      </button>

      <header className="aver-header">
        <div>
          <h1 className="aver-header__title">
            {instance?.name ?? ''} — {t('assistantVersions.titleSuffix')}
          </h1>
          <p className="aver-header__subtitle">
            {t('assistantVersions.currentVersion')} <strong>{currentVersion}</strong>
          </p>
        </div>
        <div className="aver-header__actions">
          <button className="aver-header__btn aver-header__btn--primary" onClick={() => setSelectedDiff(null)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 8a5.5 5.5 0 1 0 1-3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M2.5 4v1.5H4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('assistantVersions.versionList')}
          </button>
          <button
            className="aver-header__btn"
            onClick={() => { if (snapshots[1]) handleViewDiff(snapshots[1].id); }}
            disabled={snapshots.length < 2}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 3v10M5 13l-2-2M5 13l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11 13V3M11 3l-2 2M11 3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('assistantVersions.compareDiff')}
          </button>
        </div>
      </header>

      {error && <div className="aver-error">{error}</div>}

      {selectedDiff ? (
        <div className="aver-diff-panel">
          <button className="aver-back" onClick={() => setSelectedDiff(null)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('assistantVersions.versionList')}
          </button>
          <div className="aver-diff-list">
            {selectedDiff.diff.changes.filter(c => c.type !== 'unchanged').map((change, i) => (
              <div key={i} className="aver-diff-entry">
                <span className="aver-diff-entry__file">{change.file}</span>
                <span className={`aver-diff-entry__type aver-diff-entry__type--${change.type}`}>{change.type}</span>
              </div>
            ))}
            {selectedDiff.diff.changes.filter(c => c.type !== 'unchanged').length === 0 && (
              <p className="aver-empty">{t('assistantVersions.noVersions')}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="aver-list">
          {displaySnapshots.map((snap, idx) => {
            const isCurrent = idx === 0;
            return (
              <div key={snap.id} className={`aver-card${isCurrent ? ' aver-card--current' : ''}`}>
                <div className="aver-card__header">
                  <div className="aver-card__version-row">
                    <span className="aver-card__version">{snap.version}</span>
                    {isCurrent && (
                      <span className="aver-card__badge">{t('assistantVersions.currentVersion')}</span>
                    )}
                  </div>
                  <span className="aver-card__date">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                      <path d="M7 4.5V7l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    {new Date(snap.createdAt).toLocaleString()}
                  </span>
                </div>
                {snap.description && (
                  <p className="aver-card__desc">{snap.description}</p>
                )}
                {snap.changes.length > 0 && (
                  <div className="aver-card__changes">
                    {snap.changes.map((change, i) => (
                      <div key={i} className="aver-card__change-row">
                        <span className="aver-card__change-label">{change.label}</span>
                        <span className="aver-card__change-old">{change.old}</span>
                        <span className="aver-card__change-arrow">→</span>
                        <span className="aver-card__change-new">{change.newVal}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!isCurrent && (
                  <div className="aver-card__footer">
                    <button
                      className="aver-card__restore"
                      onClick={() => handleRestore(snap.id)}
                      disabled={restoringId !== null}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7a4.5 4.5 0 1 0 .8-2.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M2.5 3.5V5.5H4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {restoringId === snap.id
                        ? t('assistantVersions.restoring')
                        : t('assistantVersions.restoreVersion')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
