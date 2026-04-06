import { useState, useEffect } from 'react';
import { api } from '../api';
import type { FormEvent } from 'react';
import type { SnapshotDiff } from '@aquarium/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';

interface RestoreConfirmModalProps {
  instanceId: string;
  snapshotId: string;
  snapshotDate: string;
  instanceStatus: string;
  onConfirm: () => void;
  onCancel: () => void;
  restoring: boolean;
}

export function RestoreConfirmModal({
  instanceId,
  snapshotId,
  snapshotDate,
  instanceStatus,
  onConfirm,
  onCancel,
  restoring,
}: RestoreConfirmModalProps) {
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffSettled, setDiffSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<SnapshotDiff>(`/instances/${instanceId}/snapshots/${snapshotId}/diff`)
      .then(data => { if (!cancelled) setDiff(data); })
      .catch(() => { if (!cancelled) setDiff(null); })
      .finally(() => { if (!cancelled) setDiffSettled(true); });
    return () => { cancelled = true; };
  }, [instanceId, snapshotId]);

  const loadingDiff = !diffSettled;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  const isRunning = instanceStatus === 'running';
  const affectedFiles = diff?.changes.filter(c => c.type !== 'unchanged') ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !restoring) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore Snapshot</DialogTitle>
          <DialogDescription>
            This will restore the instance configuration to the state captured on{' '}
            <strong>{new Date(snapshotDate).toLocaleString()}</strong>.
          </DialogDescription>
        </DialogHeader>

        {isRunning && (
          <p style={{
            color: 'var(--color-warning)',
            fontSize: '0.9rem',
            marginBottom: 'var(--spacing-sm)',
            padding: 'var(--spacing-sm) var(--spacing-md)',
            background: 'var(--color-warning-bg, rgba(255,170,0,0.08))',
            borderRadius: 'var(--radius-sm)',
          }}>
            ⚠ Instance is currently running. Restoring will trigger a hot-reload or restart.
          </p>
        )}

        <p style={{ color: 'var(--color-warning)', fontSize: '0.9rem', marginBottom: 'var(--spacing-md)' }}>
          A safety snapshot of the current state will be created automatically before restoring.
        </p>

        {loadingDiff ? (
          <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : affectedFiles.length > 0 ? (
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-xs)' }}>
              The following files will be affected:
            </p>
            <ul style={{
              fontSize: '0.85rem',
              fontFamily: 'var(--font-mono)',
              margin: 0,
              padding: '0 0 0 var(--spacing-lg)',
              listStyle: 'none',
            }}>
              {affectedFiles.map(f => (
                <li key={f.file} style={{ padding: '2px 0' }}>
                  <span className={`diff-badge ${f.type === 'modified' ? 'diff-modified' : f.type === 'added' ? 'diff-added' : 'diff-removed'}`}
                    style={{ fontSize: '0.75rem', marginRight: 'var(--spacing-xs)' }}>
                    {f.type === 'modified' ? 'M' : f.type === 'added' ? 'A' : 'R'}
                  </span>
                  {f.file}
                </li>
              ))}
            </ul>
          </div>
        ) : diff && affectedFiles.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            No file changes detected — snapshot matches current state.
          </p>
        ) : null}

        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
          Snapshot ID: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{snapshotId}</code>
        </p>

        <form onSubmit={handleSubmit}>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={restoring}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={restoring}>
              {restoring ? <><span className="spinner" /> Restoring…</> : 'Restore'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
