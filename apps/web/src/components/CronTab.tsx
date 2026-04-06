import './CronTab.css';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../api';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import type { CronJob, CronJobRun, CronListResponse, CronRunsResponse } from '@aquarium/shared';

interface CronTabProps {
  instanceId: string;
  instanceStatus: string;
}

type ViewMode = 'list' | 'create' | 'edit' | 'history';

interface FormState {
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: 'cron' | 'at' | 'every';
  cronExpr: string;
  cronTz: string;
  atDatetime: string;
  everyMinutes: string;
  payloadKind: 'agentTurn' | 'systemEvent';
  message: string;
  eventText: string;
  deliveryMode: 'none' | 'announce';
  deliveryChannel: string;
  deliveryTo: string;
  sessionTarget: 'main' | 'isolated';
  model: string;
  timeoutSeconds: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  enabled: true,
  scheduleKind: 'cron',
  cronExpr: '',
  cronTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  atDatetime: '',
  everyMinutes: '60',
  payloadKind: 'agentTurn',
  message: '',
  eventText: '',
  deliveryMode: 'none',
  deliveryChannel: '',
  deliveryTo: '',
  sessionTarget: 'isolated',
  model: '',
  timeoutSeconds: '300',
};

function rpc<T>(instanceId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return api.post<T>(`/instances/${instanceId}/rpc`, { method, params });
}

export function CronTab({ instanceId, instanceStatus }: CronTabProps) {
  const { t } = useTranslation();
  const isRunning = instanceStatus === 'running';

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    if (!isRunning) { setLoading(false); return; }
    try {
      const result = await rpc<CronListResponse>(instanceId, 'cron.list', { includeDisabled: true, limit: 100 });
      setJobs(result.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [instanceId, isRunning]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const fetchRuns = useCallback(async (jobId: string) => {
    setRunsLoading(true);
    try {
      const result = await rpc<CronRunsResponse>(instanceId, 'cron.runs', { id: jobId, limit: 20, sortDir: 'desc' });
      setRuns(result.entries ?? []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [instanceId]);

  function buildJobPayload(f: FormState) {
    const schedule = f.scheduleKind === 'cron'
      ? { kind: 'cron' as const, expr: f.cronExpr, tz: f.cronTz || undefined }
      : f.scheduleKind === 'at'
        ? { kind: 'at' as const, at: new Date(f.atDatetime).toISOString() }
        : { kind: 'every' as const, everyMs: parseInt(f.everyMinutes, 10) * 60_000 };

    const payload = f.payloadKind === 'agentTurn'
      ? {
          kind: 'agentTurn' as const,
          message: f.message,
          ...(f.model ? { model: f.model } : {}),
          ...(f.timeoutSeconds ? { timeoutSeconds: parseInt(f.timeoutSeconds, 10) } : {}),
        }
      : { kind: 'systemEvent' as const, text: f.eventText };

    const delivery = f.deliveryMode === 'announce'
      ? { mode: 'announce' as const, channel: f.deliveryChannel || undefined, to: f.deliveryTo || undefined }
      : { mode: 'none' as const };

    return {
      name: f.name,
      description: f.description || undefined,
      enabled: f.enabled,
      schedule,
      payload,
      delivery,
      sessionTarget: f.sessionTarget,
      wakeMode: 'now' as const,
    };
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (form.payloadKind === 'agentTurn' && !form.message.trim()) { toast.error('Prompt is required'); return; }
    if (form.payloadKind === 'systemEvent' && !form.eventText.trim()) { toast.error('Event text is required'); return; }
    if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) { toast.error('Cron expression is required'); return; }
    if (form.scheduleKind === 'at' && !form.atDatetime) { toast.error('Date/time is required'); return; }

    setSaving(true);
    try {
      if (editingJobId) {
        await rpc(instanceId, 'cron.update', { id: editingJobId, patch: buildJobPayload(form) });
        toast.success('Task updated');
      } else {
        await rpc(instanceId, 'cron.add', buildJobPayload(form));
        toast.success('Task created');
      }
      setView('list');
      setForm(EMPTY_FORM);
      setEditingJobId(null);
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(jobId: string) {
    if (!confirm(t('cron.deleteConfirm'))) return;
    try {
      await rpc(instanceId, 'cron.remove', { id: jobId });
      toast.success('Task deleted');
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleRunNow(jobId: string) {
    try {
      await rpc(instanceId, 'cron.run', { id: jobId, mode: 'force' });
      toast.success('Task triggered');
      setTimeout(fetchJobs, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger');
    }
  }

  async function handleToggleEnabled(job: CronJob) {
    try {
      await rpc(instanceId, 'cron.update', { id: job.id, patch: { enabled: !job.enabled } });
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  function startEdit(job: CronJob) {
    const s = job.schedule;
    const p = job.payload;
    setForm({
      name: job.name,
      description: job.description ?? '',
      enabled: job.enabled,
      scheduleKind: s.kind,
      cronExpr: s.kind === 'cron' ? s.expr : '',
      cronTz: s.kind === 'cron' ? (s.tz ?? '') : EMPTY_FORM.cronTz,
      atDatetime: s.kind === 'at' ? s.at.slice(0, 16) : '',
      everyMinutes: s.kind === 'every' ? String(s.everyMs / 60_000) : '60',
      payloadKind: p.kind,
      message: p.kind === 'agentTurn' ? p.message : '',
      eventText: p.kind === 'systemEvent' ? p.text : '',
      deliveryMode: job.delivery?.mode === 'announce' ? 'announce' : 'none',
      deliveryChannel: job.delivery?.channel ?? '',
      deliveryTo: job.delivery?.to ?? '',
      sessionTarget: job.sessionTarget ?? 'isolated',
      model: p.kind === 'agentTurn' ? (p.model ?? '') : '',
      timeoutSeconds: p.kind === 'agentTurn' ? String(p.timeoutSeconds ?? 300) : '300',
    });
    setEditingJobId(job.id);
    setView('edit');
  }

  function openHistory(jobId: string) {
    setSelectedJobId(jobId);
    setView('history');
    fetchRuns(jobId);
  }

  const updateForm = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  // ─── Not running ───
  if (!isRunning) {
    return (
      <div className="cron-tab">
        <div className="cron-tab__header">
          <h2>{t('cron.title')}</h2>
        </div>
        <div className="channels-tab__banner">{t('cron.instanceNotRunning')}</div>
      </div>
    );
  }

  // ─── History view ───
  if (view === 'history' && selectedJobId) {
    const job = jobs.find(j => j.id === selectedJobId);
    return (
      <div className="cron-tab">
        <div className="cron-tab__header">
          <h2>{t('cron.history')}: {job?.name ?? selectedJobId}</h2>
          <Button variant="outline" size="sm" onClick={() => setView('list')}>{t('cron.cancel')}</Button>
        </div>
        {runsLoading ? (
          <p>{t('cron.loading')}</p>
        ) : runs.length === 0 ? (
          <p className="cron-tab__empty">{t('cron.noRuns')}</p>
        ) : (
          <div className="cron-tab__runs">
            {runs.map(run => (
              <div key={run.id} className={`cron-run cron-run--${run.status}`}>
                <span className="cron-run__status">{t(`cron.status.${run.status}`)}</span>
                <span className="cron-run__time">{new Date(run.startedAt).toLocaleString()}</span>
                {run.durationMs != null && <span className="cron-run__duration">{(run.durationMs / 1000).toFixed(1)}s</span>}
                {run.error && <span className="cron-run__error">{run.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create/Edit form ───
  if (view === 'create' || view === 'edit') {
    return (
      <div className="cron-tab">
        <div className="cron-tab__header">
          <h2>{editingJobId ? t('cron.edit') : t('cron.createJob')}</h2>
        </div>
        <div className="cron-tab__form">
          {/* Name */}
          <div className="cron-field">
            <label>{t('cron.name')} *</label>
            <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ name: e.target.value })} placeholder={t('cron.namePlaceholder')} />
          </div>
          <div className="cron-field">
            <label>{t('cron.description')}</label>
            <Input value={form.description} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ description: e.target.value })} placeholder={t('cron.descriptionPlaceholder')} />
          </div>

          {/* Schedule */}
          <div className="cron-field">
            <label>{t('cron.scheduleType')}</label>
            <Select value={form.scheduleKind} onValueChange={(v: string) => updateForm({ scheduleKind: v as FormState['scheduleKind'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cron">{t('cron.scheduleTypes.cron')}</SelectItem>
                <SelectItem value="at">{t('cron.scheduleTypes.at')}</SelectItem>
                <SelectItem value="every">{t('cron.scheduleTypes.every')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.scheduleKind === 'cron' && (
            <>
              <div className="cron-field">
                <label>{t('cron.cronExpr')} *</label>
                <Input value={form.cronExpr} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ cronExpr: e.target.value })} placeholder={t('cron.cronExprPlaceholder')} />
                <p className="cron-field__help">{t('cron.cronExprHelp')}</p>
              </div>
              <div className="cron-field">
                <label>{t('cron.timezone')}</label>
                <Input value={form.cronTz} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ cronTz: e.target.value })} placeholder="UTC" />
              </div>
            </>
          )}
          {form.scheduleKind === 'at' && (
            <div className="cron-field">
              <label>{t('cron.atDatetime')} *</label>
              <Input type="datetime-local" value={form.atDatetime} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ atDatetime: e.target.value })} />
            </div>
          )}
          {form.scheduleKind === 'every' && (
            <div className="cron-field">
              <label>{t('cron.everyMs')} *</label>
              <Input type="number" min="1" value={form.everyMinutes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ everyMinutes: e.target.value })} />
            </div>
          )}

          {/* Payload */}
          <div className="cron-field">
            <label>{t('cron.payloadType')}</label>
            <Select value={form.payloadKind} onValueChange={(v: string) => updateForm({ payloadKind: v as FormState['payloadKind'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="agentTurn">{t('cron.agentTurn')}</SelectItem>
                <SelectItem value="systemEvent">{t('cron.systemEvent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.payloadKind === 'agentTurn' ? (
            <>
              <div className="cron-field">
                <label>{t('cron.message')} *</label>
                <textarea className="cron-textarea" rows={3} value={form.message} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ message: e.target.value })} placeholder={t('cron.messagePlaceholder')} />
              </div>
              <div className="cron-field-row">
                <div className="cron-field">
                  <label>{t('cron.sessionTarget')}</label>
                  <Select value={form.sessionTarget} onValueChange={(v: string) => updateForm({ sessionTarget: v as 'main' | 'isolated' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="isolated">{t('cron.sessionIsolated')}</SelectItem>
                      <SelectItem value="main">{t('cron.sessionMain')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="cron-field">
                  <label>{t('cron.timeout')}</label>
                  <Input type="number" min="10" value={form.timeoutSeconds} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ timeoutSeconds: e.target.value })} />
                </div>
              </div>
            </>
          ) : (
            <div className="cron-field">
              <label>{t('cron.eventText')} *</label>
              <Input value={form.eventText} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ eventText: e.target.value })} placeholder={t('cron.eventTextPlaceholder')} />
            </div>
          )}

          {/* Delivery */}
          <div className="cron-field">
            <label>{t('cron.deliveryMode')}</label>
            <Select value={form.deliveryMode} onValueChange={(v: string) => updateForm({ deliveryMode: v as 'none' | 'announce' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('cron.deliveryNone')}</SelectItem>
                <SelectItem value="announce">{t('cron.deliveryAnnounce')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.deliveryMode === 'announce' && (
            <div className="cron-field-row">
              <div className="cron-field">
                <label>{t('cron.deliveryChannel')}</label>
                <Input value={form.deliveryChannel} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ deliveryChannel: e.target.value })} placeholder="slack, telegram..." />
              </div>
              <div className="cron-field">
                <label>{t('cron.deliveryTo')}</label>
                <Input value={form.deliveryTo} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateForm({ deliveryTo: e.target.value })} placeholder="channel:C123..." />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="cron-tab__actions">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('cron.saving') : t('cron.save')}
            </Button>
            <Button variant="ghost" onClick={() => { setView('list'); setForm(EMPTY_FORM); setEditingJobId(null); }}>
              {t('cron.cancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── List view ───
  return (
    <div className="cron-tab">
      <div className="cron-tab__header">
        <h2>{t('cron.title')}</h2>
        <p className="cron-tab__subtitle">{t('cron.subtitle')}</p>
        <Button onClick={() => { setForm(EMPTY_FORM); setEditingJobId(null); setView('create'); }} style={{ marginLeft: 'auto' }}>
          {t('cron.createJob')}
        </Button>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      {loading ? (
        <p>{t('cron.loading')}</p>
      ) : jobs.length === 0 ? (
        <p className="cron-tab__empty">{t('cron.noJobs')}</p>
      ) : (
        <div className="cron-tab__list">
          {jobs.map(job => (
            <div key={job.id} className={`cron-job${!job.enabled ? ' cron-job--disabled' : ''}`}>
              <div className="cron-job__header">
                <button className={`cron-job__toggle${job.enabled ? ' cron-job__toggle--on' : ''}`} onClick={() => handleToggleEnabled(job)} title={job.enabled ? t('cron.enabled') : t('cron.disabled')}>
                  {job.enabled ? '●' : '○'}
                </button>
                <div className="cron-job__info">
                  <span className="cron-job__name">{job.name}</span>
                  {job.description && <span className="cron-job__desc">{job.description}</span>}
                </div>
                <div className="cron-job__schedule">
                  {formatSchedule(job.schedule, t)}
                </div>
              </div>
              <div className="cron-job__state">
                {job.state.nextRunAtMs && (
                  <span>{t('cron.state.nextRun')}: {new Date(job.state.nextRunAtMs).toLocaleString()}</span>
                )}
                {job.state.lastRunStatus && (
                  <span className={`cron-job__status cron-job__status--${job.state.lastRunStatus}`}>
                    {t(`cron.status.${job.state.lastRunStatus}`)}
                  </span>
                )}
                {job.state.lastDurationMs != null && (
                  <span>{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
                )}
                {job.state.lastError && (
                  <span className="cron-job__error">{job.state.lastError}</span>
                )}
              </div>
              <div className="cron-job__actions">
                <Button variant="ghost" size="sm" onClick={() => handleRunNow(job.id)}>{t('cron.runNow')}</Button>
                <Button variant="ghost" size="sm" onClick={() => openHistory(job.id)}>{t('cron.history')}</Button>
                <Button variant="ghost" size="sm" onClick={() => startEdit(job)}>{t('cron.edit')}</Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(job.id)}>{t('cron.delete')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSchedule(s: CronJob['schedule'], t: (key: string) => string): string {
  if (s.kind === 'cron') return `${s.expr}${s.tz ? ` (${s.tz})` : ''}`;
  if (s.kind === 'at') return new Date(s.at).toLocaleString();
  if (s.kind === 'every') {
    const mins = s.everyMs / 60_000;
    if (mins >= 1440) return `${t('cron.scheduleTypes.every')}: ${(mins / 1440).toFixed(0)}d`;
    if (mins >= 60) return `${t('cron.scheduleTypes.every')}: ${(mins / 60).toFixed(0)}h`;
    return `${t('cron.scheduleTypes.every')}: ${mins}m`;
  }
  return '?';
}
