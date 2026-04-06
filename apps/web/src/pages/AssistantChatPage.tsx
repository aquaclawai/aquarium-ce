import './AssistantChatPage.css';
import './MyAssistantsPage.css';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { ChatTab } from '../components/chat/ChatTab';
import { ChatSkeleton } from '@/components/skeletons';
import type { InstancePublic, AgentTypeInfo, WsMessage } from '@aquarium/shared';

export function AssistantChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { subscribe, unsubscribe, addHandler, removeHandler } = useWebSocket();

  const [instance, setInstance] = useState<InstancePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Fetch instance + agent type suggestions
  useEffect(() => {
    if (!id) return;
    api.get<InstancePublic>(`/instances/${id}`)
      .then(inst => {
        setInstance(inst);
        api.get<AgentTypeInfo>(`/agent-types/${inst.agentType}`)
          .then(at => setSuggestions(at.wizard?.chatSuggestions ?? []))
          .catch(() => setSuggestions([]));
      })
      .catch(() => setInstance(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Subscribe to instance status updates
  useEffect(() => {
    if (!id) return;
    subscribe(id);
    return () => unsubscribe(id);
  }, [id, subscribe, unsubscribe]);

  const handleStatusUpdate = useCallback((msg: WsMessage) => {
    if (msg.instanceId !== id) return;
    const p = msg.payload as { status?: string; statusMessage?: string };
    if (p.status) {
      setInstance(prev => prev
        ? { ...prev, status: p.status as InstancePublic['status'], statusMessage: (p.statusMessage as string) ?? null }
        : null,
      );
    }
  }, [id]);

  useEffect(() => {
    addHandler('instance:status', handleStatusUpdate);
    return () => removeHandler('instance:status', handleStatusUpdate);
  }, [addHandler, removeHandler, handleStatusUpdate]);

  if (loading) return <div className="achat-page"><ChatSkeleton /></div>;
  if (!instance) return <div className="achat-page"><div className="achat-loading">{t('instance.notFound')}</div></div>;

  return (
    <ChatTab
      key={instance.id}
      mode="page"
      instanceId={instance.id}
      instanceStatus={instance.status}
      instanceName={instance.name}
      suggestions={suggestions}
    />
  );
}
