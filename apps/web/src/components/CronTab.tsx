import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { TableSkeleton } from '@/components/skeletons';
import type {
  CronJob,
  CronJobRun,
  CreateCronJobRequest,
  UpdateCronJobRequest,
  CronJobSchedule,
  CronJobPayload,
  CronJobDelivery,
} from '@aquarium/shared';

interface CronTabProps {
  instanceId: string;
  instanceStatus: string;
}

type ViewMode = 'list' | 'create' | 'edit';

interface FormState {
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: 'cron' | 'at' | 'every';
  cronExpr: string;
  cronTz: string;
  atDatetime: string;
  everyValue: number;
  everyUnit: 'seconds' | 'minutes' | 'hours';
  payloadKind: 'systemEvent' | 'agentTurn';
  systemEventText: string;
  agentTurnMessage: string;
  agentTurnModel: string;
  agentTurnTimeout: string;
  sessionTarget: 'main' | 'isolated';
  deliveryMode: 'none' | 'announce';
  deliveryChannel: string;
  deliveryTo: string;
}

const DEFAULT_FORM: FormState = {
  name: '',
  description: '',
  enabled: true,
  scheduleKind: 'cron',
  cronExpr: '0 9 * * *',
  cronTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  atDatetime: '',
  everyValue: 60,
  everyUnit: 'minutes',
  payloadKind: 'agentTurn',
  systemEventText: '',
  agentTurnMessage: '',
  agentTurnModel: '',
  agentTurnTimeout: '',
  sessionTarget: 'isolated',
  deliveryMode: 'none',
  deliveryChannel: '',
  deliveryTo: '',
};

function buildSchedule(form: FormState): CronJobSchedule {
  switch (form.scheduleKind) {
    case 'cron':
      return { kind: 'cron', expr: form.cronExpr, tz: form.cronTz || undefined };
    case 'at':
      return { kind: 'at', at: new Date(form.atDatetime).toISOString() };
    case 'every': {
      const multipliers = { seconds: 1000, minutes: 60_000, hours: 3_600_000 };
      return { kind: 'every', everyMs: form.everyValue * multipliers[form.everyUnit] };
    }
  }
}

function buildPayload(form: FormState): CronJobPayload {
  if (form.payloadKind === 'systemEvent') {
    return { kind: 'systemEvent', text: form.systemEventText };
  }
  return {
    kind: 'agentTurn',
    message: form.agentTurnMessage,
    ...(form.agentTurnModel ? { model: form.agentTurnModel } : {}),
    ...(form.agentTurnTimeout ? { timeoutSeconds: parseInt(form.agentTurnTimeout, 10) } : {}),
  };
}

function buildDelivery(form: FormState): CronJobDelivery | undefined {
  if (form.deliveryMode === 'none') return undefined;
  return {
    mode: 'announce',
    ...(form.deliveryChannel ? { channel: form.deliveryChannel } : {}),
    ...(form.deliveryTo ? { to: form.deliveryTo } : {}),
  };
}

function formFromJob(job: CronJob): FormState {
  const form: FormState = { ...DEFAULT_FORM };
  form.name = job.name;
  form.description = job.description ?? '';
  form.enabled = job.enabled;
  form.sessionTarget = job.sessionTarget;

  switch (job.schedule.kind) {
    case 'cron':
      form.scheduleKind = 'cron';
      form.cronExpr = job.schedule.expr;
      form.cronTz = job.schedule.tz ?? DEFAULT_FORM.cronTz;
      break;
    case 'at':
      form.scheduleKind = 'at';
      form.atDatetime = job.schedule.at.slice(0, 16);
      break;
    case 'every':
      form.scheduleKind = 'every';
      if (job.schedule.everyMs >= 3_600_000 && job.schedule.everyMs % 3_600_000 === 0) {
        form.everyValue = job.schedule.everyMs / 3_600_000;
        form.everyUnit = 'hours';
      } else if (job.schedule.everyMs >= 60_000 && job.schedule.everyMs % 60_000 === 0) {
        form.everyValue = job.schedule.everyMs / 60_000;
        form.everyUnit = 'minutes';
      } else {
        form.everyValue = job.schedule.everyMs / 1000;
        form.everyUnit = 'seconds';
      }
      break;
  }

  if (job.payload.kind === 'systemEvent') {
    form.payloadKind = 'systemEvent';
    form.systemEventText = job.payload.text;
  } else {
    form.payloadKind = 'agentTurn';
    form.agentTurnMessage = job.payload.message;
    form.agentTurnModel = job.payload.model ?? '';
    form.agentTurnTimeout = job.payload.timeoutSeconds?.toString() ?? '';
  }

  if (job.delivery) {
    form.deliveryMode = job.delivery.mode;
    form.deliveryChannel = job.delivery.channel ?? '';
    form.deliveryTo = job.delivery.to ?? '';
  }

  return form;
}

function formatSchedule(schedule: CronJobSchedule, t: (k: string) => string): string {
  switch (schedule.kind) {
    case 'cron':
      return `${t('cron.scheduleCron')}: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
    case 'at':
      return `${t('cron.scheduleAt')}: ${new Date(schedule.at).toLocaleString()}`;
    case 'every': {
      const ms = schedule.everyMs;
      if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${t('cron.scheduleEvery')}: ${ms / 3_600_000}h`;
      if (ms >= 60_000 && ms % 60_000 === 0) return `${t('cron.scheduleEvery')}: ${ms / 60_000}m`;
      return `${t('cron.scheduleEvery')}: ${ms / 1000}s`;
    }
  }
}

export function CronTab({ instanceId, instanceStatus }: CronTabProps) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const isRunning = instanceStatus === 'running';

  const fetchJobs = useCallback(async () => {
    if (!isRunning) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CronJob[]>(`/instances/${instanceId}/cron/jobs?includeDisabled=true`);
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cron.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [instanceId, isRunning, t]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const pendingCronApplied = useRef(false);
  useEffect(() => {
    if (!isRunning || loading || pendingCronApplied.current) return;
    if (jobs.length > 0) return;
    const storageKey = `pending-cron:${instanceId}`;
    let pendingName = '';
    let pendingSchedule = '';
    let pendingTz: string | undefined;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { name?: string; schedule?: string; tz?: string };
        pendingName = parsed.name ?? '';
        pendingSchedule = parsed.schedule ?? '';
        pendingTz = parsed.tz;
      }
    } catch { /* JSON.parse may throw on corrupt data */ }
    if (!pendingSchedule) return;
    pendingCronApplied.current = true;

    const cronRequest: CreateCronJobRequest = {
      name: pendingName,
      description: '',
      enabled: true,
      schedule: { kind: 'cron', expr: pendingSchedule, tz: pendingTz },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: '请执行今日行业资讯采集和简报生成任务。严格按照 SOUL.md 中的分析框架和输出规范执行。',
      },
    };
    api.post(`/instances/${instanceId}/cron/jobs`, cronRequest)
      .then(() => {
        try { localStorage.removeItem(storageKey); } catch { /* noop */ }
        fetchJobs();
      })
      .catch(() => {
        pendingCronApplied.current = false;
      });
  }, [isRunning, loading, jobs.length, instanceId, fetchJobs]);

  const handleCreate = () => {
    setForm({ ...DEFAULT_FORM });
    setEditingJobId(null);
    setViewMode('create');
  };

  const handleEdit = (job: CronJob) => {
    setForm(formFromJob(job));
    setEditingJobId(job.id);
    setViewMode('edit');
  };

  const handleCancel = () => {
    setViewMode('list');
    setEditingJobId(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const schedule = buildSchedule(form);
      const payload = buildPayload(form);
      const delivery = buildDelivery(form);

      if (viewMode === 'create') {
        const body: CreateCronJobRequest = {
          name: form.name,
          description: form.description || undefined,
          enabled: form.enabled,
          schedule,
          sessionTarget: form.sessionTarget,
          payload,
          delivery,
        };
        await api.post(`/instances/${instanceId}/cron/jobs`, body);
      } else {
        const body: UpdateCronJobRequest = {
          name: form.name,
          description: form.description || undefined,
          enabled: form.enabled,
          schedule,
          sessionTarget: form.sessionTarget,
          payload,
          delivery,
        };
        await api.patch(`/instances/${instanceId}/cron/jobs/${editingJobId}`, body);
      }
      setViewMode('list');
      setEditingJobId(null);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cron.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!window.confirm(t('cron.confirmDelete'))) return;
    setError(null);
    try {
      await api.delete(`/instances/${instanceId}/cron/jobs/${jobId}`);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cron.deleteFailed'));
    }
  };

  const handleRunNow = async (jobId: string) => {
    setError(null);
    try {
      await api.post(`/instances/${instanceId}/cron/jobs/${jobId}/run`, { mode: 'force' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cron.runFailed'));
    }
  };

  const handleToggleEnabled = async (job: CronJob) => {
    setError(null);
    try {
      await api.patch(`/instances/${instanceId}/cron/jobs/${job.id}`, { enabled: !job.enabled });
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cron.saveFailed'));
    }
  };

  const handleViewRuns = async (jobId: string) => {
    if (expandedRuns === jobId) {
      setExpandedRuns(null);
      return;
    }
    setExpandedRuns(jobId);
    setRunsLoading(true);
    try {
      const data = await api.get<CronJobRun[]>(`/instances/${instanceId}/cron/jobs/${jobId}/runs?limit=20`);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  };

  const updateForm = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  if (!isRunning) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
        {t('cron.instanceNotRunning')}
      </div>
    );
  }

  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
        <h3 style={{ margin: '0 0 var(--space-4)' }}>
          {viewMode === 'create' ? t('cron.createJob') : t('cron.editJob')}
        </h3>
        {error && <div className="error-message" role="alert">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label style={labelStyle}>
            {t('cron.form.name')} *
            <Input
              value={form.name}
              onChange={e => updateForm({ name: e.target.value })}
              placeholder={t('cron.form.namePlaceholder')}
            />
          </label>

          <label style={labelStyle}>
            {t('cron.form.description')}
            <Input
              value={form.description}
              onChange={e => updateForm({ description: e.target.value })}
            />
          </label>

          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox"
              checked={form.enabled}
              onChange={e => updateForm({ enabled: e.target.checked })}
            />
            {t('cron.form.enabled')}
          </label>

          <fieldset style={fieldsetStyle}>
            <legend>{t('cron.form.schedule')}</legend>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              {(['cron', 'at', 'every'] as const).map(kind => (
                <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                  <input type="radio" name="scheduleKind" checked={form.scheduleKind === kind} onChange={() => updateForm({ scheduleKind: kind })} />
                  {t(`cron.form.schedule${kind.charAt(0).toUpperCase() + kind.slice(1)}`)}
                </label>
              ))}
            </div>
            {form.scheduleKind === 'cron' && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Input style={{ flex: 1 }} value={form.cronExpr} onChange={e => updateForm({ cronExpr: e.target.value })} placeholder="0 9 * * *" />
                <Input style={{ flex: 1 }} value={form.cronTz} onChange={e => updateForm({ cronTz: e.target.value })} placeholder="Asia/Shanghai" />
              </div>
            )}
            {form.scheduleKind === 'at' && (
              <Input type="datetime-local" value={form.atDatetime} onChange={e => updateForm({ atDatetime: e.target.value })} />
            )}
            {form.scheduleKind === 'every' && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Input type="number" min={1} style={{ width: 100 }} value={form.everyValue} onChange={e => updateForm({ everyValue: parseInt(e.target.value, 10) || 1 })} />
                <Select value={form.everyUnit} onValueChange={(val) => updateForm({ everyUnit: val as FormState['everyUnit'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">{t('cron.form.seconds')}</SelectItem>
                    <SelectItem value="minutes">{t('cron.form.minutes')}</SelectItem>
                    <SelectItem value="hours">{t('cron.form.hours')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend>{t('cron.form.payload')}</legend>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="payloadKind" checked={form.payloadKind === 'systemEvent'} onChange={() => updateForm({ payloadKind: 'systemEvent' })} />
                {t('cron.form.systemEvent')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="payloadKind" checked={form.payloadKind === 'agentTurn'} onChange={() => updateForm({ payloadKind: 'agentTurn' })} />
                {t('cron.form.agentTurn')}
              </label>
            </div>
            {form.payloadKind === 'systemEvent' && (
              <textarea
                style={{ minHeight: 80, resize: 'vertical', padding: 'var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem' }}
                value={form.systemEventText}
                onChange={e => updateForm({ systemEventText: e.target.value })}
                placeholder={t('cron.form.systemEventPlaceholder')}
              />
            )}
            {form.payloadKind === 'agentTurn' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <textarea
                  style={{ minHeight: 80, resize: 'vertical', padding: 'var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem' }}
                  value={form.agentTurnMessage}
                  onChange={e => updateForm({ agentTurnMessage: e.target.value })}
                  placeholder={t('cron.form.agentTurnMessagePlaceholder')}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Input style={{ flex: 1 }} value={form.agentTurnModel} onChange={e => updateForm({ agentTurnModel: e.target.value })} placeholder={t('cron.form.modelPlaceholder')} />
                  <Input type="number" style={{ width: 120 }} value={form.agentTurnTimeout} onChange={e => updateForm({ agentTurnTimeout: e.target.value })} placeholder={t('cron.form.timeoutPlaceholder')} />
                </div>
              </div>
            )}
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend>{t('cron.form.sessionTarget')}</legend>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="sessionTarget" checked={form.sessionTarget === 'isolated'} onChange={() => updateForm({ sessionTarget: 'isolated' })} />
                {t('cron.form.isolated')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="sessionTarget" checked={form.sessionTarget === 'main'} onChange={() => updateForm({ sessionTarget: 'main' })} />
                {t('cron.form.main')}
              </label>
            </div>
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend>{t('cron.form.delivery')}</legend>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="deliveryMode" checked={form.deliveryMode === 'none'} onChange={() => updateForm({ deliveryMode: 'none' })} />
                {t('cron.form.deliveryNone')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input type="radio" name="deliveryMode" checked={form.deliveryMode === 'announce'} onChange={() => updateForm({ deliveryMode: 'announce' })} />
                {t('cron.form.deliveryAnnounce')}
              </label>
            </div>
            {form.deliveryMode === 'announce' && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Input style={{ flex: 1 }} value={form.deliveryChannel} onChange={e => updateForm({ deliveryChannel: e.target.value })} placeholder={t('cron.form.channelPlaceholder')} />
                <Input style={{ flex: 1 }} value={form.deliveryTo} onChange={e => updateForm({ deliveryTo: e.target.value })} placeholder={t('cron.form.toPlaceholder')} />
              </div>
            )}
          </fieldset>

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? t('cron.saving') : (viewMode === 'create' ? t('cron.create') : t('cron.save'))}
            </Button>
            <Button variant="secondary" onClick={handleCancel}>{t('cron.cancel')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>{t('cron.title')}</h3>
        <Button onClick={handleCreate}>{t('cron.createJob')}</Button>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      {loading && <TableSkeleton rows={5} />}

      {!loading && jobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-secondary)' }}>
          {t('cron.noJobs')}
        </div>
      )}

      {!loading && jobs.map(job => (
        <div key={job.id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <strong>{job.name}</strong>
                <span style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: job.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)',
                  color: '#fff',
                }}>
                  {job.enabled ? t('cron.enabled') : t('cron.disabled')}
                </span>
              </div>
              {job.description && <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: 'var(--space-1)' }}>{job.description}</div>}
              <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', marginTop: 'var(--space-1)' }}>
                {formatSchedule(job.schedule, t)}
              </div>
              {job.nextRunAt && (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>
                  {t('cron.nextRun')}: {new Date(job.nextRunAt).toLocaleString()}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
              <Button variant="ghost" size="sm" onClick={() => handleToggleEnabled(job)} title={job.enabled ? t('cron.disable') : t('cron.enable')}>
                {job.enabled ? '⏸' : '▶'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleRunNow(job.id)} title={t('cron.runNow')}>
                {'⚡'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleViewRuns(job.id)} title={t('cron.viewHistory')}>
                {'📋'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleEdit(job)} title={t('cron.editJob')}>
                {'✏'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(job.id)} title={t('cron.deleteJob')} style={{ color: 'var(--color-error)' }}>
                {'✕'}
              </Button>
            </div>
          </div>

          {expandedRuns === job.id && (
            <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
              <strong style={{ fontSize: '0.875rem' }}>{t('cron.runHistory')}</strong>
              {runsLoading && <TableSkeleton rows={5} />}
              {!runsLoading && runs.length === 0 && (
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{t('cron.noRuns')}</div>
              )}
              {!runsLoading && runs.map(run => (
                <div key={run.id} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: '0.8rem', padding: 'var(--space-1) 0', alignItems: 'center' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: run.status === 'completed' ? 'var(--color-success)' : run.status === 'failed' ? 'var(--color-error)' : 'var(--color-warning)',
                  }} />
                  <span>{new Date(run.startedAt).toLocaleString()}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{run.status}</span>
                  {run.error && <span style={{ color: 'var(--color-error)' }}>{run.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-1)',
  fontSize: '0.875rem',
  fontWeight: 500,
};

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: 'var(--space-3)',
  margin: 0,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 'var(--space-3)',
  marginBottom: 'var(--space-3)',
  background: 'var(--color-bg-elevated, var(--color-bg))',
};
