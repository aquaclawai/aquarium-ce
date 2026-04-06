import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { InstanceEvent, PaginatedResponse } from '@aquarium/shared';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { ListSkeleton } from '@/components/skeletons';
import './SecurityTimeline.css';

interface SecurityTimelineProps {
  instanceId: string;
}

const SEVERITY_OPTIONS = ['critical', 'warning', 'info'] as const;
const TYPE_OPTIONS = [
  'security:prompt_injection',
  'security:trust_violation',
  'security:tool_abuse',
  'security:credential_accessed',
  'security:config_changed',
  'security:suspicious_activity',
] as const;

function getSeverity(event: InstanceEvent): string {
  return (event.metadata?.severity as string) ?? 'info';
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SecurityTimeline({ instanceId }: SecurityTimelineProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<InstanceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (severityFilter) params.set('severity', severityFilter);
      if (typeFilter) params.set('type', typeFilter);
      const result = await api.get<PaginatedResponse<InstanceEvent>>(
        `/instances/${instanceId}/security-events?${params}`,
      );
      setEvents(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [instanceId, page, severityFilter, typeFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  useEffect(() => { setPage(1); }, [severityFilter, typeFilter]);

  return (
    <div className="security-timeline">
      <div className="security-timeline-header">
        <h3>{t('instance.security.timeline.title')} ({total})</h3>
        <div className="security-timeline-filters">
          <Select value={severityFilter || '__all__'} onValueChange={(val) => setSeverityFilter(val === '__all__' ? '' : val)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('instance.security.timeline.allSeverities')}</SelectItem>
              {SEVERITY_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{t(`instance.security.severity.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter || '__all__'} onValueChange={(val) => setTypeFilter(val === '__all__' ? '' : val)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('instance.security.timeline.allTypes')}</SelectItem>
              {TYPE_OPTIONS.map(tp => (
                <SelectItem key={tp} value={tp}>{t(`instance.security.eventType.${tp}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && <ListSkeleton rows={4} showIcon />}

      {!loading && events.length === 0 && (
        <div className="security-timeline-empty">{t('instance.security.timeline.noEvents')}</div>
      )}

      {!loading && events.length > 0 && (
        <>
          <div className="security-event-list">
            {events.map(event => {
              const sev = getSeverity(event);
              return (
                <div key={event.id} className={`security-event-item security-event-item--${sev}`}>
                  <div className={`security-event-severity security-event-severity--${sev}`} />
                  <div className="security-event-body">
                    <div className="security-event-type">
                      {t(`instance.security.eventType.${event.eventType}`, { defaultValue: event.eventType })}
                    </div>
                    <div className="security-event-time">{formatEventTime(event.createdAt)}</div>
                    {event.metadata && Object.keys(event.metadata).filter(k => k !== 'severity').length > 0 && (
                      <div className="security-event-meta">
                        {Object.entries(event.metadata)
                          .filter(([k]) => k !== 'severity')
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="security-timeline-pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&laquo;</Button>
              <span>{t('instance.security.timeline.page', { page, total: totalPages })}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>&raquo;</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
