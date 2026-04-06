import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { InstanceEvent } from '@aquarium/shared';
import { TableSkeleton } from '@/components/skeletons';

interface EventsTabProps {
  instanceId: string;
}

export function EventsTab({ instanceId }: EventsTabProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<InstanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<InstanceEvent[]>(`/instances/${instanceId}/events`)
      .then(setEvents)
      .catch(err => setError(err instanceof Error ? err.message : t('common.errors.failedToLoad')))
      .finally(() => setLoading(false));
  }, [instanceId, t]);

  if (loading) return <div><TableSkeleton rows={8} columns={3} /></div>;

  return (
    <div>
      <h3>{t('instance.events.title')}</h3>
      {error && <div className="error-message" role="alert">{error}</div>}

      {events.length === 0 ? (
        <div className="info-message">{t('instance.events.noEvents')}</div>
      ) : (
        <table className="models-table">
          <thead>
            <tr>
              <th>{t('instance.events.columns.time')}</th>
              <th>{t('instance.events.columns.event')}</th>
              <th>{t('instance.events.columns.details')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td>{new Date(ev.createdAt).toLocaleString()}</td>
                <td>{ev.eventType}</td>
                <td><pre className="result-payload" style={{ margin: 0, maxHeight: '100px' }}>{JSON.stringify(ev.metadata, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
