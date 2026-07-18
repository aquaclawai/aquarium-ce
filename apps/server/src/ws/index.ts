import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import type { Server as HttpServer } from 'node:http';
import { db } from '../db/index.js';

/**
 * Per-task subscription state used by `subscribe_task` / `pause_stream` /
 * `resume_stream`. Phase 24-00 (ST2 ordering invariant):
 *   • `replayBuffer !== null` means a replay flush is currently running;
 *     live broadcasts MUST be buffered until the flush completes.
 *   • `replayBuffer === null` means live-only mode.
 *   • `paused === true` means the client asked the server to stop pushing
 *     live messages for this task; the server drops them on the floor
 *     (client resubscribes via subscribe_task to refill on resume).
 *   • `lastSeq` is the highest seq the client claims to have seen.
 */
interface TaskSubscriptionState {
  lastSeq: number;
  paused: boolean;
  replayBuffer: unknown[] | null;
}

interface WsClient {
  ws: WebSocket;
  userId: string | null;
  instanceSubscriptions: Set<string>;
  groupChatSubscriptions: Set<string>;
  /** Composite keys of the form "instanceId:sessionKey" */
  chatSessionSubscriptions: Set<string>;
  /** Phase 24-00: per-taskId subscription state for task message streaming. */
  taskSubscriptions: Map<string, TaskSubscriptionState>;
}

const clients = new Set<WsClient>();

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url?.split('?')[0];
    if (pathname !== '/ws') return; // let other upgrade handlers (e.g. instance proxy) handle it
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const client: WsClient = {
      ws,
      userId: null,
      instanceSubscriptions: new Set(),
      groupChatSubscriptions: new Set(),
      chatSessionSubscriptions: new Set(),
      taskSubscriptions: new Map(),
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

          // Phase 24-00 (ST2): subscribe_task — strict 6-step buffer-replay-live
          // ordering. Spoofing guard: Math.max+floor coerces negatives / NaN.
          if (
            msg.type === 'subscribe_task' &&
            typeof msg.taskId === 'string' &&
            typeof msg.lastSeq === 'number'
          ) {
            const taskId = msg.taskId;
            const lastSeq = Math.max(0, Math.floor(msg.lastSeq));
            // Step 1: install replay buffer — any incoming live broadcast for
            // this taskId is buffered until step 5.
            const state: TaskSubscriptionState = {
              lastSeq,
              paused: false,
              replayBuffer: [],
            };
            client.taskSubscriptions.set(taskId, state);
            // Step 2-3: query DB for the most-recent 500 rows with seq > lastSeq
            // (DESC LIMIT 500, reversed to ASC). Lazy-import keeps the startup
            // order free of circular import headaches.
            const { listRecentMessagesAfterSeq, REPLAY_ROW_CAP } = await import(
              '../services/task-message-store.js'
            );
            const { db } = await import('../db/index.js');
            const { messages, olderOmittedCount } = await listRecentMessagesAfterSeq(
              db,
              taskId,
              lastSeq,
              REPLAY_ROW_CAP,
            );
            // Step 3a: emit `replay_truncated` sentinel BEFORE the replay rows
            // when older entries were omitted — client fetches them via REST.
            if (olderOmittedCount > 0) {
              sendToClient(ws, {
                type: 'task:message',
                taskId,
                seq: lastSeq,
                payload: null,
                replay_truncated: true,
                older_omitted: true,
                olderOmittedCount,
              });
            }
            // Step 4: flush replay in ASC order.
            for (const m of messages) {
              sendToClient(ws, {
                type: 'task:message',
                taskId,
                issueId: m.taskId, // placeholder — real issueId lives in the payload
                seq: m.seq,
                payload: m,
                replay: true,
              });
              if (m.seq > state.lastSeq) state.lastSeq = m.seq;
            }
            // Step 5: drain any live broadcasts that accumulated during 2-4.
            const buffered = state.replayBuffer;
            state.replayBuffer = null; // switch to live-only BEFORE draining so
            // concurrent broadcasts land via the live path; already-buffered
            // frames are flushed here in arrival order.
            if (buffered) {
              for (const b of buffered) {
                sendToClient(ws, b);
              }
            }
            return;
          }

          if (msg.type === 'pause_stream' && typeof msg.taskId === 'string') {
            const state = client.taskSubscriptions.get(msg.taskId);
            if (state) state.paused = true;
            return;
          }

          if (msg.type === 'resume_stream' && typeof msg.taskId === 'string') {
            const state = client.taskSubscriptions.get(msg.taskId);
            if (state) state.paused = false;
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

/**
 * Phase 24-00 — route a per-task broadcast to subscribed clients honouring
 * subscribe_task / pause_stream / resume_stream state. Unlike `broadcast`,
 * this helper ignores workspace-level subscribers that never sent
 * subscribe_task — they're not interested in per-message task events.
 *
 * Ordering invariant: when a client's per-task replay buffer is populated
 * (i.e. replay flush is in progress) live broadcasts are appended to the
 * buffer instead of being sent, so the receiver sees replay rows before
 * any live rows.
 */
export function broadcastTaskMessage(
  workspaceId: string,
  taskId: string,
  message: unknown,
): void {
  for (const client of clients) {
    if (!client.instanceSubscriptions.has(workspaceId)) continue;
    const state = client.taskSubscriptions.get(taskId);
    if (!state) continue;
    if (state.paused) continue;
    if (state.replayBuffer !== null) {
      state.replayBuffer.push(message);
      continue;
    }
    sendToClient(client.ws, message);
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
