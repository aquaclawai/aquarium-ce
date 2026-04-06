import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import './SnapshotsTab.css';
import { SnapshotCard } from './SnapshotCard';
import { SnapshotDiffView } from './SnapshotDiffView';
import { RestoreConfirmModal } from './RestoreConfirmModal';
import type { SnapshotSummary, PaginatedResponse } from '@aquarium/shared';
import { Button } from '@/components/ui';
import { TableSkeleton } from '@/components/skeletons';

interface SnapshotsTabProps {
  instanceId: string;
  instanceStatus: string;
}

export function SnapshotsTab({ instanceId, instanceStatus }: SnapshotsTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addHandler, removeHandler } = useWebSocket();
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [creating, setCreating] = useState(false);

  // Diff / restore state
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; createdAt: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchSnapshots = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<PaginatedResponse<SnapshotSummary>>(
        `/instances/${instanceId}/snapshots?page=${p}&limit=20`,
      );
      setSnapshots(result.items);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('snapshots.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [instanceId, t]);

  useEffect(() => {
    fetchSnapshots(page);
  }, [page, fetchSnapshots]);

  // Re-fetch snapshot list when a snapshot_restored WS event arrives
  useEffect(() => {
    const handler = () => { fetchSnapshots(page); };
    addHandler('instance:snapshot_restored', handler);
    return () => { removeHandler('instance:snapshot_restored', handler); };
  }, [addHandler, removeHandler, fetchSnapshots, page]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/snapshots`, {});
      setPage(1);
      await fetchSnapshots(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('snapshots.failedToCreate'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (snapshotId: string) => {
    if (!window.confirm(t('snapshots.deleteConfirm'))) return;
    try {
      await api.delete(`/instances/${instanceId}/snapshots/${snapshotId}`);
      if (selectedSnapshotId === snapshotId) setSelectedSnapshotId(null);
      await fetchSnapshots(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('snapshots.failedToDelete'));
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/snapshots/${restoreTarget.id}/restore`, {});
      setRestoreTarget(null);
      setSelectedSnapshotId(null);
      await fetchSnapshots(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('snapshots.failedToRestore'));
    } finally {
      setRestoring(false);
    }
  };

  const isRunning = instanceStatus === 'running';

  // Diff view
  if (selectedSnapshotId) {
    return (
      <div className="details-tab">
        <SnapshotDiffView
          instanceId={instanceId}
          snapshotId={selectedSnapshotId}
          onRestore={() => {
            const snap = snapshots.find(s => s.id === selectedSnapshotId);
            if (snap) setRestoreTarget({ id: snap.id, createdAt: snap.createdAt });
          }}
          onClose={() => setSelectedSnapshotId(null)}
        />
        {restoreTarget && (
          <RestoreConfirmModal
            instanceId={instanceId}
            snapshotId={restoreTarget.id}
            snapshotDate={restoreTarget.createdAt}
            instanceStatus={instanceStatus}
            onConfirm={handleRestore}
            onCancel={() => setRestoreTarget(null)}
            restoring={restoring}
          />
        )}
      </div>
    );
  }

  return (
    <div className="details-tab">
      <div className="snapshots-header">
        <h3>{t('snapshots.title')}</h3>
        <div className="snapshots-header__actions">
          <Button
            variant="secondary"
            onClick={() => navigate(`/assistants/${instanceId}/versions`)}
          >
            {t('snapshots.viewVersionHistory')}
          </Button>
          <Button onClick={handleCreate} disabled={!isRunning || creating}>
            {creating ? <><span className="spinner" /> {t('snapshots.creating')}</> : t('snapshots.createButton')}
          </Button>
        </div>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      {!isRunning && (
        <div className="info-message">
          {t('snapshots.instanceMustBeRunning')}
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} columns={3} />
      ) : snapshots.length === 0 ? (
        <div className="info-message">{t('snapshots.noSnapshots')}</div>
      ) : (
        <>
          <div className="snapshot-list">
            {snapshots.map(snap => (
              <SnapshotCard
                key={snap.id}
                snapshot={snap}
                onSelect={() => setSelectedSnapshotId(snap.id)}
                onDelete={() => handleDelete(snap.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="snapshot-pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                {t('common.pagination.previous')}
              </Button>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                {t('common.pagination.pageOf', { page, totalPages })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                {t('common.pagination.next')}
              </Button>
            </div>
          )}
        </>
      )}

      {restoreTarget && (
        <RestoreConfirmModal
          instanceId={instanceId}
          snapshotId={restoreTarget.id}
          snapshotDate={restoreTarget.createdAt}
          instanceStatus={instanceStatus}
          onConfirm={handleRestore}
          onCancel={() => setRestoreTarget(null)}
          restoring={restoring}
        />
      )}
    </div>
  );
}
