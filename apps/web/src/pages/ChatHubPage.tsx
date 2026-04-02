import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, MessageSquare, Zap } from 'lucide-react';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { AgentSidebar } from '../components/AgentSidebar';
import { ChatTab } from '../components/chat/ChatTab';
import type { InstancePublic, WsMessage } from '@aquarium/shared';
import './ChatHubPage.css';

export function ChatHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();

  const [instances, setInstances] = useState<InstancePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [startingInstance, setStartingInstance] = useState<string | null>(null);

  useEffect(() => {
    api.get<InstancePublic[]>('/instances')
      .then(data => {
        setInstances(data);
        const running = data.find(i => i.status === 'running');
        if (running) {
          setSelectedId(running.id);
        } else if (data.length > 0) {
          setSelectedId(data[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  const selectedInstance = instances.find(i => i.id === selectedId) ?? null;

  const handleStartInstance = async (id: string) => {
    setStartingInstance(id);
    try {
      const updated = await api.post<InstancePublic>(`/instances/${id}/start`, {});
      setInstances(prev => prev.map(inst =>
        inst.id === id ? { ...inst, status: updated.status, statusMessage: updated.statusMessage } : inst,
      ));
    } catch {
      const refreshed = await api.get<InstancePublic[]>('/instances').catch(() => null);
      if (refreshed) setInstances(refreshed);
    } finally {
      setStartingInstance(null);
    }
  };

  if (loading) {
    return <div className="chat-hub chat-hub--loading"><span className="spinner" /></div>;
  }

  if (instances.length === 0) {
    return (
      <div className="chat-hub chat-hub--empty">
        <div className="chat-hub__empty-card">
          <div className="chat-hub__empty-icon"><Zap size={32} /></div>
          <h2 className="chat-hub__empty-title">{t('chatHub.emptyTitle')}</h2>
          <p className="chat-hub__empty-desc">{t('chatHub.emptyDesc')}</p>
          <button className="btn-primary" onClick={() => navigate('/create')}>
            <Bot size={18} />
            <span>{t('chatHub.createFirst')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-hub">
      <div className="chat-hub__main">
        {selectedInstance ? (
          selectedInstance.status === 'running' ? (
            <ChatTab
              key={selectedInstance.id}
              instanceId={selectedInstance.id}
              instanceStatus={selectedInstance.status}
            />
          ) : (
            <div className="chat-hub__offline">
              <div className="chat-hub__offline-card">
                <MessageSquare size={28} className="chat-hub__offline-icon" />
                <h3 className="chat-hub__offline-name">{selectedInstance.name}</h3>
                <p className="chat-hub__offline-status">
                  {t(`chatHub.status.${selectedInstance.status}`, selectedInstance.status)}
                </p>
                {selectedInstance.statusMessage && (
                  <p className="chat-hub__offline-msg">{selectedInstance.statusMessage}</p>
                )}
                {(selectedInstance.status === 'stopped' || selectedInstance.status === 'created' || selectedInstance.status === 'error') && (
                  <button
                    className="btn-primary"
                    onClick={() => handleStartInstance(selectedInstance.id)}
                    disabled={startingInstance === selectedInstance.id}
                  >
                    {startingInstance === selectedInstance.id
                      ? t('chatHub.starting')
                      : t('chatHub.startAgent')}
                  </button>
                )}
                {selectedInstance.status === 'starting' && (
                  <div className="chat-hub__offline-spinner">
                    <span className="spinner" />
                    <span>{t('chatHub.waitingStart')}</span>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="chat-hub__no-selection">
            <MessageSquare size={28} />
            <p>{t('chatHub.selectAgent')}</p>
          </div>
        )}
      </div>

      <AgentSidebar
        instances={instances}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(prev => !prev)}
      />
    </div>
  );
}
