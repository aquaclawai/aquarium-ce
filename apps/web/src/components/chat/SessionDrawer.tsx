import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../utils/rpc';
import './SessionDrawer.css';

interface GatewaySession {
  key: string;
  kind?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  updatedAt?: number;
  model?: string;
  totalTokens?: number;
  label?: string;
  displayName?: string;
  startedAt?: number;
  endedAt?: number;
  estimatedCostUsd?: number;
  status?: string;
}

export interface SessionDrawerProps {
  instanceId: string;
  currentSessionKey: string;
  isOpen: boolean;
  isStreaming: boolean;
  onSelectSession: (key: string) => void;
  onNewChat: () => string;
  onClose: () => void;
  mode?: 'sidebar' | 'overlay';
  refreshFlag?: number;
}

type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'older';

function getDateGroup(timestamp: number): DateGroup {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - (now.getDay() * 86_400_000);

  if (timestamp >= todayStart) return 'today';
  if (timestamp >= yesterdayStart) return 'yesterday';
  if (timestamp >= weekStart) return 'thisWeek';
  return 'older';
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const STALE_MS = 30_000; // 30 seconds

export function SessionDrawer({
  instanceId,
  currentSessionKey,
  isOpen,
  isStreaming,
  onSelectSession,
  onNewChat,
  onClose,
  mode = 'sidebar',
  refreshFlag,
}: SessionDrawerProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const lastFetchRef = useRef(0);
  const lastRefreshFlagRef = useRef(refreshFlag);

  const fetchSessions = useCallback(async (force = false) => {
    const now = Date.now();
    const flagChanged = refreshFlag !== lastRefreshFlagRef.current;
    if (!force && !flagChanged && now - lastFetchRef.current < STALE_MS) return;

    lastRefreshFlagRef.current = refreshFlag;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<{ sessions?: GatewaySession[] }>(
        instanceId,
        'sessions.list',
        { limit: 50, includeGlobal: false, includeDerivedTitles: true, includeLastMessage: true },
      );
      const EXCLUDED_KINDS = new Set(['group', 'cron', 'hook', 'node']);
      const userSessions = (res.sessions ?? [])
        .filter(s => !s.kind || !EXCLUDED_KINDS.has(s.kind))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(userSessions);
      lastFetchRef.current = Date.now();
    } catch {
      setError(t('chat.sessionDrawer.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [instanceId, refreshFlag, t]);

  useEffect(() => {
    if (isOpen) fetchSessions();
  }, [isOpen, fetchSessions]);

  const handleNewChat = useCallback(() => {
    const newKey = onNewChat();
    setSessions(prev => {
      if (prev.some(s => s.key === newKey)) return prev;
      return [{ key: newKey, updatedAt: Date.now() }, ...prev];
    });
  }, [onNewChat]);

  const handleDeleteClick = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteKey(key);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    const key = confirmDeleteKey;
    if (!key) return;
    setConfirmDeleteKey(null);
    setDeletingKey(key);
    try {
      await rpc(instanceId, 'sessions.delete', { key, deleteTranscript: true });
      setSessions(prev => prev.filter(s => s.key !== key));
      if (key === currentSessionKey) handleNewChat();
    } catch {
      setError(t('chat.sessionDrawer.fetchError'));
    } finally {
      setDeletingKey(null);
    }
  }, [confirmDeleteKey, instanceId, currentSessionKey, handleNewChat, t]);

  const handleDeleteCancel = useCallback(() => {
    setConfirmDeleteKey(null);
  }, []);

  const handleSelect = useCallback((key: string) => {
    if (isStreaming) return;
    onSelectSession(key);
  }, [isStreaming, onSelectSession]);

  const grouped: Record<DateGroup, GatewaySession[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const s of sessions) {
    const group = s.updatedAt ? getDateGroup(s.updatedAt) : 'older';
    grouped[group].push(s);
  }
  const groupOrder: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'older'];

  const drawerClass = [
    'achat-drawer',
    isOpen ? 'achat-drawer--open' : 'achat-drawer--hidden',
    mode === 'overlay' ? 'achat-drawer--overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {mode === 'overlay' && isOpen && (
        <div className="achat-drawer__overlay" onClick={onClose} />
      )}
      <aside className={drawerClass}>
        <div className="achat-drawer__header">
          <span>{t('chat.sessionDrawer.sessions')}</span>
          <button className="achat-drawer__new-btn" onClick={handleNewChat} disabled={isStreaming}>
            {t('chat.sessionDrawer.newChat')}
          </button>
        </div>

        {loading && sessions.length === 0 ? (
          <div className="achat-drawer__loading"><span className="spinner" /></div>
        ) : error && sessions.length === 0 ? (
          <div className="achat-drawer__error">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="achat-drawer__empty">{t('chat.sessionDrawer.emptyState')}</div>
        ) : (
          <div className="achat-drawer__list">
            {groupOrder.map(group => {
              const items = grouped[group];
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <div className="achat-drawer__group-label">
                    {t(`chat.sessionDrawer.${group}`)}
                  </div>
                  {items.map(s => {
                    const isActive = s.key === currentSessionKey;
                    const isDeleting = s.key === deletingKey;
                    const title = s.derivedTitle
                      ?? s.lastMessagePreview?.slice(0, 40)
                      ?? t('chat.sessionDrawer.newChat');
                    const preview = s.lastMessagePreview?.slice(0, 60);
                    return (
                      <div
                        key={s.key}
                        className={[
                          'achat-drawer__item',
                          isActive ? 'achat-drawer__item--active' : '',
                          isStreaming && !isActive ? 'achat-drawer__item--disabled' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => handleSelect(s.key)}
                      >
                        <div className="achat-drawer__item-body">
                          <div className="achat-drawer__item-title">{title}</div>
                          {preview && <div className="achat-drawer__item-preview">{preview}</div>}
                        </div>
                        <div className="achat-drawer__item-actions">
                          {s.updatedAt && (
                            <span className="achat-drawer__item-time">
                              {formatRelativeTime(s.updatedAt)}
                            </span>
                          )}
                          {s.key !== 'main' && !s.key.endsWith(':main') && (
                            <button
                              className="achat-drawer__item-delete"
                              onClick={(e) => handleDeleteClick(s.key, e)}
                              disabled={isDeleting}
                              title={t('chat.sessionDrawer.deleteConfirm')}
                            >
                              {isDeleting ? '…' : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5.5 4V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4 4v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {confirmDeleteKey && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h3>{t('chat.sessionDrawer.deleteTitle')}</h3>
            <p style={{ color: 'var(--color-text-secondary)', margin: 'var(--spacing-sm) 0 var(--spacing-md)' }}>
              {t('chat.sessionDrawer.deleteConfirm')}
            </p>
            <div className="form-actions" style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={handleDeleteCancel}>
                {t('chat.sessionDrawer.deleteCancel')}
              </button>
              <button type="button" className="danger" onClick={handleDeleteConfirm}>
                {t('common.buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
