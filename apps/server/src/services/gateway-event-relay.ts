import { randomUUID } from 'crypto';

import WebSocket from 'ws';

import { config } from '../config.js';
import { db } from '../db/index.js';
import { broadcast, broadcastToUser, sendToChatSession } from '../ws/index.js';
import { filterOutput } from './output-filter.js';
import { getDlpConfig } from '../agent-types/openclaw/security-profiles.js';
import { addOutputFilterEvent } from './instance-manager.js';
import type { ExecApprovalRequest, SecurityProfile, DlpConfig } from '@aquarium/shared';

const PROTOCOL_VERSION = 3;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_RETRIES = 5;
const POLL_INTERVAL_MS = 10_000;

const instanceDlpCache = new Map<string, DlpConfig | null>();

export function preloadDlpConfig(instanceId: string, profile: SecurityProfile): void {
  instanceDlpCache.set(instanceId, getDlpConfig(profile));
}

export function evictDlpConfig(instanceId: string): void {
  instanceDlpCache.delete(instanceId);
}

function getInstanceDlpSync(instanceId: string): DlpConfig | null | undefined {
  return instanceDlpCache.get(instanceId);
}

function applyOutputFilter(
  instanceId: string,
  content: string,
  dlpConfig: DlpConfig,
) {
  const result = filterOutput(content, instanceId, dlpConfig);
  if (result.filtered) {
    addOutputFilterEvent(instanceId, result).catch(() => {});
  }
  return { content: result.filteredContent, result };
}

// ── Persistent Gateway Client ──

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Chat Event Callback System ──
// Allows services (like group-chat-manager) to register one-time callbacks
// for chat events matching a specific session key + completion condition.

interface ChatEventCallback {
  resolve: (data: ChatEventData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  instanceId: string;
  sessionKey: string;
}

export interface ChatEventData {
  sessionKey: string;
  state: string;
  content: unknown;
  role?: string;
  messageId?: string;
}

// Map of "instanceId:sessionKey" -> callback
const chatEventCallbacks = new Map<string, ChatEventCallback>();

// ── Pending Exec Approvals ──

interface PendingApproval extends ExecApprovalRequest {
  instanceId: string;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

function compositeKey(instanceId: string, approvalId: string): string {
  return `${instanceId}:${approvalId}`;
}

export function addPendingApproval(instanceId: string, req: ExecApprovalRequest): void {
  const key = compositeKey(instanceId, req.approvalId);

  const existing = pendingApprovals.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    pendingApprovals.delete(key);
  }, req.timeoutMs + 2_000);

  pendingApprovals.set(key, { ...req, instanceId, timer });
}

export function removePendingApproval(instanceId: string, approvalId: string): void {
  const key = compositeKey(instanceId, approvalId);
  const pending = pendingApprovals.get(key);
  if (pending) {
    clearTimeout(pending.timer);
    pendingApprovals.delete(key);
  }
}

export function consumePendingApproval(instanceId: string, approvalId: string): PendingApproval | null {
  const key = compositeKey(instanceId, approvalId);
  const pending = pendingApprovals.get(key);
  if (!pending) return null;
  clearTimeout(pending.timer);
  pendingApprovals.delete(key);
  return pending;
}

export function getPendingApprovalsForInstance(instanceId: string): ExecApprovalRequest[] {
  const result: ExecApprovalRequest[] = [];
  for (const p of pendingApprovals.values()) {
    if (p.instanceId === instanceId) {
      result.push({
        approvalId: p.approvalId,
        command: p.command,
        args: p.args,
        workDir: p.workDir,
        requestedAt: p.requestedAt,
        timeoutMs: p.timeoutMs,
      });
    }
  }
  return result;
}

async function getInstanceOwnerUserId(instanceId: string): Promise<string | null> {
  const row = await db('instances').where({ id: instanceId }).select('user_id').first();
  return (row?.user_id as string) ?? null;
}

class PersistentGatewayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private retryCount = 0;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(
    private readonly instanceId: string,
    private readonly endpoint: string,
    private readonly token: string,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;

    try {
      const ws = new WebSocket(this.endpoint, {
        headers: { Origin: config.corsOrigin },
      });
      this.ws = ws;

      const connectId = randomUUID();

      ws.on('open', () => {
        console.log(`[gateway-relay] WebSocket opened for instance ${this.instanceId}`);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type: string;
            id?: string;
            event?: string;
            ok?: boolean;
            error?: { message?: string };
            payload?: unknown;
            result?: unknown;
          };

          // Step 1: Gateway sends connect.challenge -- respond with connect request
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            ws.send(JSON.stringify({
              type: 'req',
              id: connectId,
              method: 'connect',
              params: {
                minProtocol: PROTOCOL_VERSION,
                maxProtocol: PROTOCOL_VERSION,
                client: {
                  id: 'openclaw-control-ui',
                  version: '1.0.0',
                  platform: process.platform,
                  mode: 'backend',
                },
                role: 'operator',
                scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
                auth: { token: this.token },
              },
            }));
            return;
          }

          // Step 2: Connect response -- mark as connected
          if (msg.type === 'res' && msg.id === connectId) {
            if (msg.error || msg.ok === false) {
              console.error(`[gateway-relay] Connect failed for instance ${this.instanceId}: ${msg.error?.message || 'unknown error'}`);
              ws.close();
              return;
            }
            this.connected = true;
            this.retryCount = 0;
            console.log(`[gateway-relay] Connected to gateway for instance ${this.instanceId}`);

            // Gateway sends events to all authenticated connections automatically —
            // no explicit subscription required (verified: the gateway rejects the
            // old { type: 'subscribe' } message as INVALID_REQUEST).
            return;
          }

          // Step 2.5: RPC response routing -- match by msg.id in pendingRequests
          if (msg.type === 'res' && msg.id && this.pendingRequests.has(msg.id)) {
            const pending = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.error || msg.ok === false) {
              pending.reject(new Error(`Gateway RPC error: ${msg.error?.message || 'unknown'}`));
            } else {
              pending.resolve(msg.result ?? msg.payload);
            }
            return;
          }

          // Step 3: Relay all gateway events to subscribed browser clients
          if (msg.type === 'event' && this.connected && msg.event) {
            if (msg.event === 'connect.challenge') return;

            if (msg.event === 'exec.approval.request') {
              const p = msg.payload as Record<string, unknown>;
              const approvalId = (p.id ?? p.approvalId) as string;
              const req: ExecApprovalRequest = {
                approvalId,
                command: (p.command as string) ?? '',
                args: p.args as string[] | undefined,
                workDir: p.workDir as string | undefined,
                requestedAt: new Date().toISOString(),
                timeoutMs: (p.timeoutMs as number) || 30_000,
              };
              addPendingApproval(this.instanceId, req);
              const wsMsg = {
                type: 'instance:exec_approval_request' as const,
                instanceId: this.instanceId,
                payload: req as unknown as Record<string, unknown>,
              };
              getInstanceOwnerUserId(this.instanceId).then(userId => {
                if (userId) broadcastToUser(userId, wsMsg);
                else broadcast(this.instanceId, wsMsg);
              }).catch(() => broadcast(this.instanceId, wsMsg));
              return;
            }

            if (msg.event === 'exec.approval.timeout' || msg.event === 'exec.approval.cancelled') {
              const p = msg.payload as Record<string, unknown>;
              const approvalId = (p.id ?? p.approvalId) as string;
              removePendingApproval(this.instanceId, approvalId);
              const wsMsg = {
                type: 'instance:exec_approval_resolved' as const,
                instanceId: this.instanceId,
                payload: {
                  approvalId,
                  approved: false,
                  reason: msg.event === 'exec.approval.timeout' ? 'timeout' : 'cancelled',
                },
              };
              getInstanceOwnerUserId(this.instanceId).then(userId => {
                if (userId) broadcastToUser(userId, wsMsg);
                else broadcast(this.instanceId, wsMsg);
              }).catch(() => broadcast(this.instanceId, wsMsg));
              return;
            }

            // Route chat events to the specific subscribed session
            if (msg.event === 'chat') {
              const chatPayload = msg.payload as Record<string, unknown> | undefined;
              const rawSessionKey = chatPayload?.sessionKey as string | undefined;
              if (rawSessionKey) {
                // Gateway prepends 'agent:{agentId}:' to the sessionKey (e.g. 'chat-123' → 'agent:main:chat-123').
                // Strip it to recover the original key the client sent, so subscriptions match.
                const userSessionKey = rawSessionKey.replace(/^agent:[^:]+:/, '');

                // ── Check for registered chat completion callbacks ──
                const cbKey = `${this.instanceId}:${userSessionKey}`;
                const callback = chatEventCallbacks.get(cbKey);
                if (callback) {
                  const state = chatPayload?.state as string | undefined;
                  if (state === 'final') {
                    clearTimeout(callback.timer);
                    chatEventCallbacks.delete(cbKey);
                    const messageObj = chatPayload?.message as Record<string, unknown> | undefined;
                    callback.resolve({
                      sessionKey: userSessionKey,
                      state: 'final',
                      content: messageObj?.content ?? chatPayload?.content,
                      role: (messageObj?.role ?? chatPayload?.role) as string | undefined,
                      messageId: chatPayload?.messageId as string | undefined,
                    });
                  } else if (state === 'error') {
                    clearTimeout(callback.timer);
                    chatEventCallbacks.delete(cbKey);
                    const errorMessage = (chatPayload?.errorMessage as string) || 'Agent run failed';
                    callback.reject(new Error(errorMessage));
                  }
                }

                const sendChatToSession = (payload: Record<string, unknown>) => {
                  sendToChatSession(this.instanceId, userSessionKey, {
                    type: 'instance:gateway_event',
                    instanceId: this.instanceId,
                    payload: { event: 'chat', data: payload },
                  });
                };

                const baseChatPayload: Record<string, unknown> = { ...chatPayload, sessionKey: userSessionKey };
                const msgObj = baseChatPayload.message as Record<string, unknown> | undefined;
                const textContent = (msgObj?.content ?? baseChatPayload.content) as string | undefined;

                const dlp = getInstanceDlpSync(this.instanceId);
                if (textContent && typeof textContent === 'string' && dlp) {
                  const { content: filteredText, result: filterResult } = applyOutputFilter(this.instanceId, textContent, dlp);
                  let finalPayload = baseChatPayload;
                  if (filterResult.filtered) {
                    if (msgObj) {
                      finalPayload = { ...baseChatPayload, message: { ...msgObj, content: filteredText } };
                    } else {
                      finalPayload = { ...baseChatPayload, content: filteredText };
                    }
                    broadcast(this.instanceId, {
                      type: 'security_event',
                      instanceId: this.instanceId,
                      payload: {
                        category: 'security:output_filtered',
                        mode: filterResult.mode,
                        matchCount: filterResult.matches.length,
                        categories: filterResult.matches.map(m => m.category),
                        durationMs: filterResult.durationMs,
                        timestamp: new Date().toISOString(),
                      },
                    });
                  }
                  sendChatToSession(finalPayload);
                } else {
                  sendChatToSession(baseChatPayload);
                }
                return;
              }
              // If no sessionKey in the event (unexpected), fall through to broadcast
            }

            // All other events use broadcast (status, channels, health, etc.)
            broadcast(this.instanceId, {
              type: 'instance:gateway_event',
              instanceId: this.instanceId,
              payload: {
                event: msg.event,
                data: msg.payload ?? {},
              },
            });
          }
        } catch {
          // Malformed message -- skip
        }
      });

      ws.on('close', () => {
        // Reject all in-flight RPC calls
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Gateway connection lost for instance ${this.instanceId}`));
        }
        this.pendingRequests.clear();

        // Clean up any chat event callbacks for this instance
        for (const [key, cb] of chatEventCallbacks) {
          if (cb.instanceId === this.instanceId) {
            clearTimeout(cb.timer);
            cb.reject(new Error(`Gateway connection lost for instance ${this.instanceId}`));
            chatEventCallbacks.delete(key);
          }
        }

        this.connected = false;
        this.ws = null;

        if (this.closed) return;

        console.log(`[gateway-relay] Connection closed for instance ${this.instanceId}`);
        this.scheduleReconnect();
      });

      ws.on('error', (err) => {
        console.error(`[gateway-relay] WebSocket error for instance ${this.instanceId}:`, err.message);
        // onclose will fire after this
      });
    } catch (err) {
      console.error(`[gateway-relay] Failed to create WebSocket for instance ${this.instanceId}:`, err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    this.retryCount++;
    if (this.retryCount > MAX_RECONNECT_RETRIES) {
      console.log(`[gateway-relay] Max retries reached for instance ${this.instanceId}, giving up until next poll`);
      return;
    }

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error(`Gateway not connected for instance ${this.instanceId}`);
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Gateway RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isExhausted(): boolean {
    return !this.connected && this.retryCount > MAX_RECONNECT_RETRIES;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    // Reject all in-flight RPC calls
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Gateway connection lost for instance ${this.instanceId}`));
    }
    this.pendingRequests.clear();

    // Clean up any chat event callbacks for this instance
    for (const [key, cb] of chatEventCallbacks) {
      if (cb.instanceId === this.instanceId) {
        clearTimeout(cb.timer);
        cb.reject(new Error(`Gateway connection closed for instance ${this.instanceId}`));
        chatEventCallbacks.delete(key);
      }
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// ── Relay Manager ──

const connections = new Map<string, PersistentGatewayClient>();
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

async function reconcileConnections(): Promise<void> {
  try {
    const runningInstances = await db('instances')
      .where({ status: 'running' })
      .whereNotNull('control_endpoint')
      .select('id', 'control_endpoint', 'auth_token');

    const runningIds = new Set<string>();

    for (const row of runningInstances) {
      const id = row.id as string;
      const endpoint = row.control_endpoint as string;
      const token = row.auth_token as string;

      runningIds.add(id);

      const existing = connections.get(id);

      // Skip if already connected or still retrying
      if (existing && !existing.isExhausted) continue;

      // If exhausted, close the old one and recreate
      if (existing?.isExhausted) {
        existing.close();
        connections.delete(id);
      }

      // Create new connection
      const client = new PersistentGatewayClient(id, endpoint, token);
      connections.set(id, client);
    }

    // Close connections for instances that are no longer running
    for (const [id, conn] of connections) {
      if (!runningIds.has(id)) {
        console.log(`[gateway-relay] Disconnecting instance ${id} (no longer running)`);
        conn.close();
        connections.delete(id);
      }
    }
  } catch {
    // DB query failed -- skip this cycle
  }
}

export function startGatewayEventRelay(): void {
  if (pollIntervalId) return;

  // Initial reconciliation
  reconcileConnections().catch(() => { /* handled internally */ });

  // Poll every 10s for new/removed instances
  pollIntervalId = setInterval(() => {
    reconcileConnections().catch(() => { /* handled internally */ });
  }, POLL_INTERVAL_MS);

  console.log('[gateway-relay] Event relay started');
}

export function stopGatewayEventRelay(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  for (const [id, conn] of connections) {
    conn.close();
    connections.delete(id);
  }

  console.log('[gateway-relay] Event relay stopped');
}

export function connectGateway(instanceId: string, endpoint: string, token: string): void {
  const existing = connections.get(instanceId);
  if (existing) {
    existing.close();
  }

  const client = new PersistentGatewayClient(instanceId, endpoint, token);
  connections.set(instanceId, client);
}

export function disconnectGateway(instanceId: string): void {
  const conn = connections.get(instanceId);
  if (conn) {
    conn.close();
    connections.delete(instanceId);
  }
}

export function getGatewayClient(instanceId: string): PersistentGatewayClient | null {
  const client = connections.get(instanceId);
  return (client && client.isConnected) ? client : null;
}

/**
 * Register a one-time callback for a chat completion event.
 * Resolves when the gateway emits a chat event with state === 'final'
 * for the given instanceId + sessionKey combination.
 */
export function waitForChatCompletion(
  instanceId: string,
  sessionKey: string,
  timeoutMs = 120_000,
): Promise<ChatEventData> {
  const compositeKey = `${instanceId}:${sessionKey}`;

  // Clean up any existing callback for this key
  const existing = chatEventCallbacks.get(compositeKey);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error('Superseded by new listener'));
    chatEventCallbacks.delete(compositeKey);
  }

  return new Promise<ChatEventData>((resolve, reject) => {
    const timer = setTimeout(() => {
      chatEventCallbacks.delete(compositeKey);
      reject(new Error(`Chat completion timeout for ${sessionKey} (${timeoutMs}ms)`));
    }, timeoutMs);

    chatEventCallbacks.set(compositeKey, {
      resolve,
      reject,
      timer,
      instanceId,
      sessionKey,
    });
  });
}

/**
 * Cancel a pending chat completion callback.
 */
export function cancelChatCompletion(instanceId: string, sessionKey: string): void {
  const compositeKey = `${instanceId}:${sessionKey}`;
  const cb = chatEventCallbacks.get(compositeKey);
  if (cb) {
    clearTimeout(cb.timer);
    cb.reject(new Error('Chat completion cancelled'));
    chatEventCallbacks.delete(compositeKey);
  }
}
