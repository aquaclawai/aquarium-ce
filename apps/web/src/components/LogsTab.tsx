import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../utils/rpc.js';
import type { Instance } from '@aquarium/shared';
import { Button, Input } from '@/components/ui';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  raw: string;
  time?: string | null;
  level?: LogLevel | null;
  subsystem?: string | null;
  message?: string | null;
}

const LOG_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LOG_LEVEL_SET = new Set<string>(LOG_LEVELS);
const LOG_BUFFER_LIMIT = 2000;
const LOG_POLL_INTERVAL = 2000;

function parseLogLine(line: string): LogEntry {
  if (!line.trim()) return { raw: line, message: line };
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const meta = obj && typeof obj._meta === 'object' && obj._meta !== null
      ? (obj._meta as Record<string, unknown>)
      : null;
    const time = typeof obj.time === 'string' ? obj.time : typeof meta?.date === 'string' ? (meta.date as string) : null;
    const rawLevel = (meta?.logLevelName ?? meta?.level) as string | undefined;
    const level = typeof rawLevel === 'string' && LOG_LEVEL_SET.has(rawLevel.toLowerCase())
      ? (rawLevel.toLowerCase() as LogLevel)
      : null;
    const contextCandidate = typeof obj['0'] === 'string' ? obj['0'] : typeof meta?.name === 'string' ? (meta.name as string) : null;
    let subsystem: string | null = null;
    if (contextCandidate && contextCandidate.length < 120) {
      try {
        const parsed = JSON.parse(contextCandidate) as Record<string, unknown>;
        subsystem = typeof parsed.subsystem === 'string' ? parsed.subsystem : typeof parsed.module === 'string' ? parsed.module : contextCandidate;
      } catch { subsystem = contextCandidate; }
    }
    let message: string | null = null;
    if (typeof obj['1'] === 'string') message = obj['1'];
    else if (typeof obj['0'] === 'string' && !subsystem) message = obj['0'];
    else if (typeof obj.message === 'string') message = obj.message;
    return { raw: line, time, level, subsystem, message: message ?? line };
  } catch {
    return { raw: line, message: line };
  }
}

function formatLogTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString();
}

interface LogsTabProps {
  instanceId: string;
  instanceStatus: Instance['status'];
}

export function LogsTab({ instanceId, instanceStatus }: LogsTabProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const l of LOG_LEVELS) init[l] = true;
    return init as Record<LogLevel, boolean>;
  });
  const [autoFollow, setAutoFollow] = useState(true);
  const cursorRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async (reset?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { limit: 500 };
      if (!reset && cursorRef.current != null) params.cursor = cursorRef.current;
      const result = await rpc<{
        file?: string;
        cursor?: number;
        size?: number;
        lines?: string[];
        truncated?: boolean;
        reset?: boolean;
      }>(instanceId, 'logs.tail', params);
      const lines = Array.isArray(result.lines) ? result.lines.filter((l): l is string => typeof l === 'string') : [];
      const parsed = lines.map(parseLogLine);
      const shouldReset = reset || result.reset || cursorRef.current == null;
      setEntries(prev => shouldReset ? parsed : [...prev, ...parsed].slice(-LOG_BUFFER_LIMIT));
      if (typeof result.cursor === 'number') cursorRef.current = result.cursor;
      setTruncated(Boolean(result.truncated));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  const isRunnable = instanceStatus === 'running' || instanceStatus === 'stopping' || instanceStatus === 'error';

  useEffect(() => {
    if (!isRunnable) return;
    cursorRef.current = null;
    fetchLogs(true);
    pollTimerRef.current = setInterval(() => { fetchLogs(); }, LOG_POLL_INTERVAL);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [isRunnable, fetchLogs]);

  useEffect(() => {
    if (autoFollow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, autoFollow]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (autoFollow && !atBottom) setAutoFollow(false);
  }, [autoFollow]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevelFilters(prev => ({ ...prev, [level]: !prev[level] }));
  }, []);

  const needle = filterText.trim().toLowerCase();
  const filtered = entries.filter(entry => {
    if (entry.level && !levelFilters[entry.level]) return false;
    if (needle) {
      const hay = [entry.message, entry.subsystem, entry.raw].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  if (!isRunnable) {
    return (
      <div className="instance-logs">
        <div className="info-message">{t('instance.logs.startRequired')}</div>
      </div>
    );
  }

  return (
    <div className="instance-logs">
      <div className="logs-toolbar">
        <Input
          type="text"
          className="logs-filter-input"
          placeholder={t('instance.logs.filterPlaceholder')}
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        <div className="logs-level-chips">
          {LOG_LEVELS.map(level => (
            <label key={level} className={`logs-level-chip logs-level-chip--${level} ${levelFilters[level] ? 'active' : ''}`}>
              <input type="checkbox" checked={levelFilters[level]} onChange={() => toggleLevel(level)} />
              <span>{t(`instance.logs.levels.${level}`)}</span>
            </label>
          ))}
        </div>
        <div className="logs-actions">
          <label className="logs-autofollow">
            <input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)} />
            <span>{t('instance.logs.autoFollow')}</span>
          </label>
          <Button size="sm" onClick={() => { cursorRef.current = null; fetchLogs(true); }} disabled={loading}>
            {loading ? t('common.labels.loading') : t('common.buttons.refresh')}
          </Button>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {truncated && <div className="info-message">{t('instance.logs.truncated')}</div>}
      <div className="logs-container" ref={containerRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="log-line log-empty">{t('instance.logs.noEntries')}</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className={`log-row ${entry.level ?? ''}`}>
              <span className="log-time">{formatLogTime(entry.time)}</span>
              <span className={`log-level ${entry.level ?? ''}`}>{entry.level ?? ''}</span>
              <span className="log-subsystem">{entry.subsystem ?? ''}</span>
              <span className="log-message">{entry.message ?? entry.raw}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
