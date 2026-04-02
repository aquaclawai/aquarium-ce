import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Zap, Bot } from 'lucide-react';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { AssistantCard } from '../components/assistant/AssistantCard';
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
        <div className="my-assistants-page__loading">{t('common.labels.loading')}</div>
      </main>
    );
  }

  return (
    <main className="my-assistants-page">
      <header className="my-assistants-page__header">
        <div>
          <h1 className="my-assistants-page__title">{t('myAssistants.title')}</h1>
          <p className="my-assistants-page__subtitle">{t('myAssistants.subtitle')}</p>
        </div>
        <button className="my-assistants-page__create" onClick={() => navigate('/create')}>
          <Plus size={18} />
          {t('myAssistants.createNew')}
        </button>
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}

      {instances.length === 0 ? (
        <div className="my-assistants-page__empty-banner">
          <div className="my-assistants-page__empty-content">
            <div className="my-assistants-page__empty-icon">
              <Zap size={22} />
            </div>
            <div className="my-assistants-page__empty-text">
              <h3>{t('myAssistants.emptyTitle')}</h3>
              <p>{t('myAssistants.emptyDescription')}</p>
            </div>
          </div>
          <button className="my-assistants-page__empty-btn" onClick={() => navigate('/create')}>
            <Bot size={18} />
            <span>{t('myAssistants.createFirst')}</span>
          </button>
        </div>
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
