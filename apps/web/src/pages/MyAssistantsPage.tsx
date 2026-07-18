import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Bot } from 'lucide-react';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { AssistantCard } from '../components/assistant/AssistantCard';
import { PageHeader } from '../components/PageHeader';
import { PageHeaderSkeleton, CardSkeleton } from '@/components/skeletons';
import { EmptyState } from '../components/EmptyState';
import { Button } from '@/components/ui';
import type { InstancePublic, AgentTypeInfo, WsMessage } from '@aquarium/shared';
import './MyAssistantsPage.css';

export function MyAssistantsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();

  const [instances, setInstances] = useState<InstancePublic[]>([]);
  const [modelMap, setModelMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<InstancePublic[]>('/instances'),
      api.get<AgentTypeInfo[]>('/agent-types'),
    ])
      .then(([inst, agentTypes]) => {
        setInstances(inst);
        const map: Record<string, string> = {};
        for (const at of agentTypes) {
          if (at.wizard?.defaultModel) {
            map[at.id] = at.wizard.defaultModel;
          }
        }
        setModelMap(map);
      })
      .catch(err => setError(err instanceof Error ? err.message : t('myAssistants.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    for (const inst of instances) {
      subscribe(inst.id);
    }
    return () => {
      for (const inst of instances) {
        unsubscribe(inst.id);
      }
    };
  }, [instances, subscribe, unsubscribe]);

  const handleStatusUpdate = useCallback((message: WsMessage) => {
    const { instanceId, payload } = message;
    if (!payload) return;
    setInstances(prev => prev.map(inst =>
      inst.id === instanceId
        ? { ...inst, status: payload.status as InstancePublic['status'], statusMessage: (payload.statusMessage as string) ?? null }
        : inst,
    ));
  }, []);

  useEffect(() => {
    addHandler('instance:status', handleStatusUpdate);
    return () => removeHandler('instance:status', handleStatusUpdate);
  }, [addHandler, removeHandler, handleStatusUpdate]);

  const handleAction = useCallback(async (instanceId: string, action: 'start' | 'stop') => {
    setError(null);
    setActionInProgress(instanceId);
    setInstances(prev => prev.map(inst =>
      inst.id === instanceId
        ? { ...inst, status: action === 'start' ? 'starting' : 'stopping', statusMessage: null }
        : inst,
    ));
    try {
      const updated = await api.post<InstancePublic>(`/instances/${instanceId}/${action}`, {});
      setInstances(prev => prev.map(inst =>
        inst.id === instanceId ? { ...inst, status: updated.status, statusMessage: updated.statusMessage } : inst,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('myAssistants.actionFailed'));
      const refreshed = await api.get<InstancePublic[]>('/instances').catch(() => null);
      if (refreshed) setInstances(refreshed);
    } finally {
      setActionInProgress(null);
    }
  }, [t]);

  if (loading) {
    return (
      <main className="my-assistants-page">
        <PageHeaderSkeleton />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          <CardSkeleton lines={3} showBadge />
          <CardSkeleton lines={3} showBadge />
          <CardSkeleton lines={3} showBadge />
          <CardSkeleton lines={3} showBadge />
          <CardSkeleton lines={3} showBadge />
          <CardSkeleton lines={3} showBadge />
        </div>
      </main>
    );
  }

  return (
    <main className="my-assistants-page">
      <PageHeader
        title={t('myAssistants.title')}
        subtitle={t('myAssistants.subtitle')}
        action={
          <Button onClick={() => navigate('/create')}>
            <Plus size={16} />
            {t('myAssistants.createNew')}
          </Button>
        }
      />

      {error && <div className="error-message" role="alert">{error}</div>}

      {instances.length === 0 ? (
        <EmptyState
          icon={<Bot size={24} />}
          title={t('myAssistants.emptyTitle')}
          description={t('myAssistants.emptyDescription')}
          action={
            <Button onClick={() => navigate('/create')}>
              <Plus size={16} />
              {t('myAssistants.createNew')}
            </Button>
          }
        />
      ) : (
        <div className="my-assistants-page__list">
          {instances.map(inst => (
            <AssistantCard
              key={inst.id}
              instance={inst}
              modelName={modelMap[inst.agentType] ?? null}
              onAction={handleAction}
              actionInProgress={actionInProgress}
            />
          ))}
        </div>
      )}
    </main>
  );
}
