import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import type { Server as HttpServer } from 'node:http';
import { db } from '../db/index.js';

interface WsClient {
  ws: WebSocket;
  userId: string | null;
  instanceSubscriptions: Set<string>;
  groupChatSubscriptions: Set<string>;
  /** Composite keys of the form "instanceId:sessionKey" */
  chatSessionSubscriptions: Set<string>;
}

const clients = new Set<WsClient>();

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const client: WsClient = {
      ws,
      userId: null,
      instanceSubscriptions: new Set(),
      groupChatSubscriptions: new Set(),
      chatSessionSubscriptions: new Set(),
    };
    clients.add(client);

    ws.on('message', (data) => {
      void (async () => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;

          if (msg.type === 'auth') {
            const token = typeof msg.token === 'string' ? msg.token : null;
            if (!token) {
              ws.send(JSON.stringify({ type: 'auth', ok: false }));
              return;
            }

            // CE mode: static admin token
            if (token === 'ce-admin') {
              client.userId = 'ce-admin';
              ws.send(JSON.stringify({ type: 'auth', ok: true }));
              return;
            }

            // Test mode / local auth: "test:<userId>" cookie token
            if (token.startsWith('test:')) {
              const userId = token.slice(5);
              const row = await db('users').where({ id: userId }).first() as Record<string, unknown> | undefined;
              if (row) {
                client.userId = userId;
                ws.send(JSON.stringify({ type: 'auth', ok: true }));
              } else {
                ws.send(JSON.stringify({ type: 'auth', ok: false }));
              }
              return;
            }

            ws.send(JSON.stringify({ type: 'auth', ok: false }));
            return;
          }

          if (msg.type === 'subscribe' && typeof msg.instanceId === 'string') {
            client.instanceSubscriptions.add(msg.instanceId);
            return;
          }

          if (msg.type === 'subscribe_group_chat' && typeof msg.groupChatId === 'string') {
            client.groupChatSubscriptions.add(msg.groupChatId);
            return;
          }

          if (msg.type === 'unsubscribe_group_chat' && typeof msg.groupChatId === 'string') {
            client.groupChatSubscriptions.delete(msg.groupChatId);
            return;
          }

          if (msg.type === 'subscribe_chat_session' && typeof msg.instanceId === 'string' && typeof msg.sessionKey === 'string') {
            client.chatSessionSubscriptions.add(`${msg.instanceId}:${msg.sessionKey}`);
            return;
          }

          if (msg.type === 'unsubscribe_chat_session' && typeof msg.instanceId === 'string' && typeof msg.sessionKey === 'string') {
            client.chatSessionSubscriptions.delete(`${msg.instanceId}:${msg.sessionKey}`);
            return;
          }
        } catch {
          // Ignore malformed messages
        }
      })();
    });

    ws.on('close', () => { clients.delete(client); });
    ws.on('error', () => { clients.delete(client); });
  });
}

function sendToClient(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function broadcast(instanceId: string, message: unknown): void {
  for (const client of clients) {
    if (client.instanceSubscriptions.has(instanceId)) {
      sendToClient(client.ws, message);
    }
  }
}

export function broadcastToUser(userId: string, message: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) {
      sendToClient(client.ws, message);
    }
  }
}

export function broadcastToGroupChat(groupChatId: string, message: unknown): void {
  for (const client of clients) {
    if (client.groupChatSubscriptions.has(groupChatId)) {
      sendToClient(client.ws, message);
    }
  }
}

export function sendToChatSession(instanceId: string, sessionKey: string, message: unknown): void {
  const key = `${instanceId}:${sessionKey}`;
  for (const client of clients) {
    if (client.chatSessionSubscriptions.has(key)) {
      sendToClient(client.ws, message);
    }
  }
}
