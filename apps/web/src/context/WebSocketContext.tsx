import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { WsMessage, WsEventType } from '@aquarium/shared';

type MessageHandler = (message: WsMessage) => void;

interface WebSocketContextType {
  isConnected: boolean;
  subscribe: (instanceId: string) => void;
  unsubscribe: (instanceId: string) => void;
  subscribeGroupChat: (groupChatId: string) => void;
  unsubscribeGroupChat: (groupChatId: string) => void;
  subscribeChatSession: (instanceId: string, sessionKey: string) => void;
  unsubscribeChatSession: (instanceId: string, sessionKey: string) => void;
  addHandler: (type: WsEventType, handler: MessageHandler) => void;
  removeHandler: (type: WsEventType, handler: MessageHandler) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user, getToken } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<WsEventType, Set<MessageHandler>>>(new Map());
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const groupChatSubscriptionsRef = useRef<Set<string>>(new Set());
  const chatSessionSubscriptionsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authenticatedRef = useRef(false);
  const connectRef = useRef(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!user) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      const token = await getToken();
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      } else {
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'auth' && message.ok) {
          authenticatedRef.current = true;
          setIsConnected(true);
          subscriptionsRef.current.forEach(instanceId => {
            ws.send(JSON.stringify({ type: 'subscribe', instanceId }));
          });
          groupChatSubscriptionsRef.current.forEach(groupChatId => {
            ws.send(JSON.stringify({ type: 'subscribe_group_chat', groupChatId }));
          });
          chatSessionSubscriptionsRef.current.forEach(compositeKey => {
            const [instanceId, sessionKey] = compositeKey.split(':');
            ws.send(JSON.stringify({ type: 'subscribe_chat_session', instanceId, sessionKey }));
          });
          return;
        }

        if (message.type === 'auth' && !message.ok) {
          ws.close();
          return;
        }

        const handlers = handlersRef.current.get(message.type);
        if (handlers) {
          handlers.forEach(handler => handler(message));
        }
      } catch {
        // Ignore malformed WS messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      authenticatedRef.current = false;
      wsRef.current = null;

      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [user, getToken]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const subscribe = useCallback((instanceId: string) => {
    subscriptionsRef.current.add(instanceId);
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', instanceId }));
    }
  }, []);

  const unsubscribe = useCallback((instanceId: string) => {
    subscriptionsRef.current.delete(instanceId);
  }, []);

  const subscribeGroupChat = useCallback((groupChatId: string) => {
    groupChatSubscriptionsRef.current.add(groupChatId);
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_group_chat', groupChatId }));
    }
  }, []);

  const unsubscribeGroupChat = useCallback((groupChatId: string) => {
    groupChatSubscriptionsRef.current.delete(groupChatId);
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe_group_chat', groupChatId }));
    }
  }, []);

  const subscribeChatSession = useCallback((instanceId: string, sessionKey: string) => {
    const compositeKey = `${instanceId}:${sessionKey}`;
    chatSessionSubscriptionsRef.current.add(compositeKey);
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe_chat_session',
        instanceId,
        sessionKey,
      }));
    }
  }, []);

  const unsubscribeChatSession = useCallback((instanceId: string, sessionKey: string) => {
    const compositeKey = `${instanceId}:${sessionKey}`;
    chatSessionSubscriptionsRef.current.delete(compositeKey);
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'unsubscribe_chat_session',
        instanceId,
        sessionKey,
      }));
    }
  }, []);

  const addHandler = useCallback((type: WsEventType, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)?.add(handler);
  }, []);

  const removeHandler = useCallback((type: WsEventType, handler: MessageHandler) => {
    handlersRef.current.get(type)?.delete(handler);
  }, []);

  return (
    <WebSocketContext.Provider value={{ isConnected, subscribe, unsubscribe, subscribeGroupChat, unsubscribeGroupChat, subscribeChatSession, unsubscribeChatSession, addHandler, removeHandler }}>
      {children}
    </WebSocketContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
