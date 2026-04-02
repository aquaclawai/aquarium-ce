import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { getGatewayClient, waitForChatCompletion, cancelChatCompletion } from '../../services/gateway-event-relay.js';
import { config } from '../../config.js';
import type { ChatAttachment } from '@aquarium/shared';

const PROTOCOL_VERSION = 3;

export class GatewayRPCClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private endpoint: string;
  private token: string;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint;
    this.token = token;
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.endpoint, {
        headers: { Origin: config.corsOrigin },
      });
      this.ws = ws;
      const connectId = randomUUID();
      const callId = randomUUID();
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(`Gateway RPC timeout: ${method}`));
        }
      }, timeoutMs);

      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      };

      const succeed = (result: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(result);
        }
      };

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        // Step 1: Gateway sends connect.challenge — respond with connect request
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

        // Step 2: Connect response — send the actual RPC call
        if (msg.type === 'res' && msg.id === connectId) {
          if (msg.error || msg.ok === false) {
            fail(new Error(`Gateway connect failed: ${msg.error?.message || 'unknown error'}`));
            return;
          }
          this.connected = true;
          ws.send(JSON.stringify({ type: 'req', id: callId, method, params }));
          return;
        }

        // Step 3: RPC response — return result
        if (msg.type === 'res' && msg.id === callId && this.connected) {
          if (msg.error || msg.ok === false) {
            fail(new Error(`Gateway RPC error [${method}]: ${msg.error?.message || 'unknown error'}`));
          } else {
            succeed(msg.result ?? msg.payload);
          }
          return;
        }

        // Ignore other events (tick, health, etc.)
      });

      ws.on('close', (code) => {
        fail(new Error(`Gateway WebSocket closed unexpectedly (code ${code}) during ${method}`));
      });

      ws.on('error', (err) => fail(err));
    });
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}

/**
 * GroupChatRPCClient — sends chat.send then polls chat.history for bot reply.
 * Same pattern as web UI chat (InstancePage).
 */
/**
 * Extract human-readable text from Gateway chat message content.
 * Content can be a plain string, or an array of content parts
 * (text, toolCall, toolResult, etc.) as returned by the Gateway.
 */
function extractTextFromContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  const texts: string[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      texts.push(p.text);
    } else if (p.type === 'toolCall') {
      const args = p.arguments as Record<string, unknown> | undefined;
      if (args && typeof args.message === 'string') {
        texts.push(args.message);
      } else if (args && typeof args.text === 'string') {
        texts.push(args.text);
      }
    }
  }
  return texts.length > 0 ? texts.join('\n') : JSON.stringify(content);
}

export class GroupChatRPCClient {
  private rpc: GatewayRPCClient;
  private endpoint: string;
  private token: string;
  private instanceId: string | undefined;

  constructor(endpoint: string, token: string, instanceId?: string) {
    this.endpoint = endpoint;
    this.token = token;
    this.instanceId = instanceId;
    this.rpc = new GatewayRPCClient(endpoint, token);
  }

  private async rpcCall(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    // Try persistent client first
    if (this.instanceId) {
      const persistent = getGatewayClient(this.instanceId);
      if (persistent) {
        return persistent.call(method, params, timeoutMs);
      }
    }
    // Fallback to ephemeral
    const client = new GatewayRPCClient(this.endpoint, this.token);
    try {
      return await client.call(method, params, timeoutMs);
    } finally {
      client.close();
    }
  }

  async sendChat(content: string, sessionKey: string, timeoutMs = 120_000, attachments?: ChatAttachment[]): Promise<string> {
    if (!this.instanceId) {
      throw new Error('instanceId required for event-driven chat');
    }

    const completionPromise = waitForChatCompletion(this.instanceId, sessionKey, timeoutMs);

    completionPromise.catch(() => {});

    try {
      const rpcParams: Record<string, unknown> = {
        sessionKey,
        message: content,
        idempotencyKey: randomUUID(),
      };
      if (attachments?.length) {
        rpcParams.attachments = attachments.map(a => ({
          type: a.mimeType?.startsWith('image/') ? 'image' : 'file',
          mimeType: a.mimeType,
          content: a.content,
          ...(a.fileName ? { fileName: a.fileName } : {}),
        }));
      }
      await this.rpcCall('chat.send', rpcParams, 30_000);
    } catch (err) {
      cancelChatCompletion(this.instanceId, sessionKey);
      throw err;
    }

    const result = await completionPromise;

    return extractTextFromContent(result.content);
  }

  close() {
    this.rpc.close();
  }
}
