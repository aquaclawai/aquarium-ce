import './InstancePage.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { SnapshotsTab } from '../components/SnapshotsTab';
import { AgentUIFrame } from '../components/AgentUIFrame';
import { useAgentTypes } from '../hooks/useAgentTypes';
import { AITab } from '../components/AITab';
import { OverviewTab } from '../components/OverviewTab';
import { LogsTab } from '../components/LogsTab';
import { EventsTab } from '../components/EventsTab';
import { UsageTab } from '../components/UsageTab';
import { FilesTab } from '../components/files/FilesTab';
import type { Instance, WsMessage, ExecApprovalRequest } from '@aquarium/shared';
import { ExecApprovalDialog } from '../components/ExecApprovalDialog';
import type { ExecApprovalItem } from '../components/ExecApprovalDialog';
import { SecurityTimeline } from '../components/SecurityTimeline';
import { SecurityStatusBadge } from '../components/SecurityStatusBadge';
import { ChatTab } from '../components/chat/ChatTab';
import { ExtensionsTab } from '../components/extensions/ExtensionsTab';
import { VaultConfigSection } from '../components/extensions/VaultConfigSection';
import { ChannelsTab } from '../components/channels/ChannelsTab';
import { CronTab } from '../components/CronTab';
import { PageHeaderSkeleton, TabsSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

type TabId = 'overview' | 'ai' | 'chat' | 'channels' | 'extensions' | 'agent-management' | 'usage' | 'files' | 'logs' | 'events' | 'snapshots' | 'security' | 'cron';

const ADVANCED_TABS: ReadonlySet<TabId> = new Set(['agent-management', 'snapshots', 'security', 'logs', 'events', 'cron']);

const ADVANCED_TAB_KEYS: Record<string, string> = {
  'agent-management': 'instance.tabs.agentManagement',
  'snapshots': 'instance.tabs.snapshots',
  'security': 'instance.tabs.security',
  'logs': 'instance.tabs.logs',
  'events': 'instance.tabs.events',
  'cron': 'instance.tabs.cron',
};

export function InstancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const { agentTypes } = useAgentTypes();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const fetchInstance = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<Instance>(`/instances/${id}`);
      setInstance(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  useEffect(() => {
    if (!id) return;
    subscribe(id);
    return () => unsubscribe(id);
  }, [id, subscribe, unsubscribe]);

  const handleStatusUpdate = useCallback((message: WsMessage) => {
    if (message.instanceId === id && message.type === 'instance:status' && message.payload) {
      const newStatus = message.payload.status as Instance['status'];
      const newStatusMessage = (message.payload.statusMessage as string) ?? null;
      setInstance(prev => prev ? { ...prev, status: newStatus, statusMessage: newStatusMessage } : null);
    }
  }, [id]);

  useEffect(() => {
    addHandler('instance:status', handleStatusUpdate);
    return () => removeHandler('instance:status', handleStatusUpdate);
  }, [addHandler, removeHandler, handleStatusUpdate]);

  useEffect(() => {
    if (instance?.status !== 'starting') return;
    const timer = setInterval(fetchInstance, 5000);
    return () => clearInterval(timer);
  }, [instance?.status, fetchInstance]);

  const [execApprovals, setExecApprovals] = useState<ExecApprovalItem[]>([]);

  const handleExecApprovalRequest = useCallback((message: WsMessage) => {
    if (message.instanceId !== id) return;
    const p = message.payload as unknown as ExecApprovalRequest;
    if (typeof p.approvalId !== 'string' || !p.approvalId) return;
    setExecApprovals(prev => {
      if (prev.some(a => a.approvalId === p.approvalId)) return prev;
      return [...prev, p];
    });
  }, [id]);

  const handleExecApprovalResolved = useCallback((message: WsMessage) => {
    if (message.instanceId !== id) return;
    if (!message.payload) return;
    const approvalId = message.payload.approvalId as string;
    setExecApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
  }, [id]);

  useEffect(() => {
    addHandler('instance:exec_approval_request', handleExecApprovalRequest);
    addHandler('instance:exec_approval_resolved', handleExecApprovalResolved);
    return () => {
      removeHandler('instance:exec_approval_request', handleExecApprovalRequest);
      removeHandler('instance:exec_approval_resolved', handleExecApprovalResolved);
    };
  }, [addHandler, removeHandler, handleExecApprovalRequest, handleExecApprovalResolved]);

  useEffect(() => {
    if (!id || instance?.status !== 'running') {
      setExecApprovals([]);
      return;
    }
    api.get<ExecApprovalRequest[]>(`/instances/${id}/exec-approval/pending`)
      .then(data => setExecApprovals(data))
      .catch(() => {});
  }, [id, instance?.status]);

  const handleExecApprove = useCallback(async (approvalId: string) => {
    if (!id) return;
    const item = execApprovals.find(a => a.approvalId === approvalId);
    setExecApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
    try {
      await api.post(`/instances/${id}/exec-approval`, { approvalId, approved: true });
    } catch {
      if (item) setExecApprovals(prev => [...prev, item]);
    }
  }, [id, execApprovals]);

  const handleExecDeny = useCallback(async (approvalId: string) => {
    if (!id) return;
    const item = execApprovals.find(a => a.approvalId === approvalId);
    setExecApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
    try {
      await api.post(`/instances/${id}/exec-approval`, { approvalId, approved: false });
    } catch {
      if (item) setExecApprovals(prev => [...prev, item]);
    }
  }, [id, execApprovals]);

  const [securityToasts, setSecurityToasts] = useState<Array<{ id: string; message: string }>>([]);

  const handleSecurityEvent = useCallback((message: WsMessage) => {
    if (message.instanceId !== id) return;
    if (!message.payload) return;
    const severity = message.payload.severity as string;
    if (severity === 'critical') {
      const category = (message.payload.category as string) ?? 'security_event';
      const toastId = `${Date.now()}-${Math.random()}`;
      setSecurityToasts(prev => [...prev, { id: toastId, message: category }]);
      setTimeout(() => {
        setSecurityToasts(prev => prev.filter(t => t.id !== toastId));
      }, 6000);
    }
  }, [id]);

  useEffect(() => {
    addHandler('security_event', handleSecurityEvent);
    return () => removeHandler('security_event', handleSecurityEvent);
  }, [addHandler, removeHandler, handleSecurityEvent]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    if (moreOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  const [actionInProgress, setActionInProgress] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [cloning, setCloning] = useState(false);

  const handleClone = async () => {
    if (!id) return;
    setCloning(true);
    try {
      const cloned = await api.post<Instance>(`/instances/${id}/clone`, {});
      navigate(`/instances/${cloned.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.actionFailed'));
    } finally {
      setCloning(false);
    }
  };

  const handleLifecycle = async (action: 'start' | 'stop' | 'restart') => {
    if (!id) return;
    setError(null);
    setActionInProgress(action);
    if (action === 'start' || action === 'restart') {
      setInstance(prev => prev ? { ...prev, status: 'starting', statusMessage: null } : null);
    } else if (action === 'stop') {
      setInstance(prev => prev ? { ...prev, status: 'stopping', statusMessage: null } : null);
    }
    try {
      const updated = await api.post<Instance>(`/instances/${id}/${action}`, {});
      setInstance(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.actionFailed'));
      fetchInstance();
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) return (
    <div className="instance-page">
      <PageHeaderSkeleton showAction={false} />
      <TabsSkeleton count={6} />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
  if (!instance) return <div className="instance-page">{t('instance.notFound')}</div>;

  const isTransitioning = instance.status === 'starting' || instance.status === 'stopping';

  return (
    <main className="instance-page">
      <header className="instance-header">
        <div>
          <Link to="/dashboard" className="back-link">{t('instance.backToDashboard')}</Link>
          <h1>{instance.name}</h1>
        </div>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="instance-status-bar">
        {t('instance.statusBar.status')} {isTransitioning && <span className="spinner" />}{' '}
        <span className={`status-${instance.status}`}>{t(`common.status.${instance.status}`)}</span>
        {instance.status === 'starting' && instance.statusMessage && (
          <span className="status-message"> — {instance.statusMessage}</span>
        )}
        <span className="separator">|</span>
        {t('instance.statusBar.type', { type: instance.agentType })}
        <span className="separator">|</span>
        {t('instance.statusBar.image', { tag: instance.imageTag })}
        <span className="separator">|</span>
        {t('instance.statusBar.target', { target: instance.deploymentTarget })}
      </div>

      <div className="tabs">
        <Button variant="ghost" className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>{t('instance.tabs.chat')}</Button>
        <Button variant="ghost" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>{t('instance.tabs.overview')}</Button>
        <Button variant="ghost" className={activeTab === 'channels' ? 'active' : ''} onClick={() => setActiveTab('channels')}>{t('instance.tabs.channels', 'Channels')}</Button>
        <Button variant="ghost" className={activeTab === 'extensions' ? 'active' : ''} onClick={() => setActiveTab('extensions')}>{t('instance.tabs.extensions')}</Button>
        <Button variant="ghost" className={activeTab === 'ai' ? 'active' : ''} onClick={() => setActiveTab('ai')}>AI</Button>
        <Button variant="ghost" className={activeTab === 'usage' ? 'active' : ''} onClick={() => setActiveTab('usage')}>{t('instance.tabs.usage')}</Button>
        <Button variant="ghost" className={activeTab === 'files' ? 'active' : ''} onClick={() => setActiveTab('files')}>{t('instance.tabs.files')}</Button>
        {ADVANCED_TABS.has(activeTab) && (
          <Button variant="ghost" className="active" onClick={() => setActiveTab(activeTab)}>
            {t(ADVANCED_TAB_KEYS[activeTab])}
          </Button>
        )}
        <div className="tabs-more" ref={moreRef}>
          <Button variant="outline" size="sm" className={`tabs-more__trigger${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen(prev => !prev)}>
            {t('instance.tabs.advanced', 'Advanced')} ▾
          </Button>
          {moreOpen && (
            <div className="tabs-more-menu">
              <Button variant="ghost" onClick={() => { setActiveTab('agent-management'); setMoreOpen(false); }}>{t('instance.tabs.agentManagement')}</Button>
              <Button variant="ghost" onClick={() => { setActiveTab('snapshots'); setMoreOpen(false); }}>{t('instance.tabs.snapshots')}</Button>
              <Button variant="ghost" onClick={() => { setActiveTab('security'); setMoreOpen(false); }}>{t('instance.tabs.security')}</Button>
              <Button variant="ghost" onClick={() => { setActiveTab('logs'); setMoreOpen(false); }}>{t('instance.tabs.logs')}</Button>
              <Button variant="ghost" onClick={() => { setActiveTab('events'); setMoreOpen(false); }}>{t('instance.tabs.events')}</Button>
              <Button variant="ghost" onClick={() => { setActiveTab('cron'); setMoreOpen(false); }}>{t('instance.tabs.cron', 'Scheduled Tasks')}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="tab-content">
        {activeTab === 'overview' && (
          <>
            <OverviewTab instance={instance} onInstanceUpdate={fetchInstance} onLifecycle={handleLifecycle} actionInProgress={actionInProgress} onClone={handleClone} cloning={cloning} />
            <VaultConfigSection instanceId={instance.id} disabled={instance.status === 'starting' || instance.status === 'stopping'} />
          </>
        )}
        {activeTab === 'ai' && <AITab instance={instance} agentType={agentTypes.find(a => a.id === instance.agentType) ?? null} onInstanceUpdate={fetchInstance} />}
        {activeTab === 'chat' && <ChatTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'channels' && <ChannelsTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'extensions' && <ExtensionsTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'agent-management' && <AgentUIFrame instance={instance} agentType={agentTypes.find(a => a.id === instance.agentType) ?? null} />}
        {activeTab === 'usage' && <UsageTab instanceId={instance.id} instanceStatus={instance.status} billingMode={instance.billingMode} />}
        {activeTab === 'files' && <FilesTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'logs' && <LogsTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'events' && <EventsTab instanceId={instance.id} />}
        {activeTab === 'snapshots' && <SnapshotsTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'cron' && <CronTab instanceId={instance.id} instanceStatus={instance.status} />}
        {activeTab === 'security' && (
          <div className="security-tab">
            <SecurityTimeline instanceId={instance.id} />
            <SecurityStatusBadge instanceId={instance.id} />
          </div>
        )}
      </div>
      <ExecApprovalDialog items={execApprovals} onApprove={handleExecApprove} onDeny={handleExecDeny} />
      {securityToasts.length > 0 && (
        <div className="security-toast">
          {securityToasts.map(st => (
            <div key={st.id} className="security-toast-item">⚠ {st.message}</div>
          ))}
        </div>
      )}
    </main>
  );
}
