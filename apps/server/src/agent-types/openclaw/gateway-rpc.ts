import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { getGatewayClient, waitForChatCompletion, cancelChatCompletion } from '../../services/gateway-event-relay.js';
import { config } from '../../config.js';
import type { ChatAttachment } from '@aquarium/shared';

const PROTOCOL_VERSION = 3;

/**
 * Unified gateway RPC facade. All gateway calls route through this function.
 *
 * If the persistent client is connected, sends immediately.
 * If disconnected but client exists, queues the request (with 30s timeout).
 * If no client exists (instance not running), throws immediately.
 */
export async function gatewayCall(
  instanceId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const client = getGatewayClient(instanceId);
  if (!client) {
    throw new Error(
      `No gateway connection for instance ${instanceId}. ` +
      `Instance may not be running or persistent client not yet created.`
    );
  }
  return client.call(method, params, timeoutMs);
}

// ── Plugin presence from tools.catalog ──

export interface PluginPresenceInfo {
  pluginId: string;
  loaded: boolean;
  toolCount: number;
}

/**
 * Extract plugin presence from tools.catalog response.
 * Returns a Map of pluginId -> info for all plugins that have loaded tools.
 * Used to replace the non-existent `plugins.list` RPC.
 */
export function extractPluginPresence(
  toolsCatalogResult: unknown,
): Map<string, PluginPresenceInfo> {
  const map = new Map<string, PluginPresenceInfo>();
  if (typeof toolsCatalogResult !== 'object' || toolsCatalogResult === null) return map;

  const result = toolsCatalogResult as Record<string, unknown>;
  const groups = Array.isArray(result.groups) ? result.groups : [];

  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const g = group as Record<string, unknown>;
    if (g.source === 'plugin' && typeof g.pluginId === 'string') {
      const existing = map.get(g.pluginId);
      const tools = Array.isArray(g.tools) ? g.tools : [];
      if (existing) {
        // Multiple tool groups from same plugin -- aggregate
        existing.toolCount += tools.length;
      } else {
        map.set(g.pluginId, {
          pluginId: g.pluginId,
          loaded: true,
          toolCount: tools.length,
        });
      }
    }
  }
  return map;
}

// ── Plugin config from config.get ──

export interface PluginConfigEntry {
  pluginId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Extract plugin config entries from config.get response.
 * Returns a Map of pluginId -> config entry for all plugins in the gateway config.
 * The config.get response contains config.plugins.entries as Record<id, {enabled, config}>.
 * Used alongside extractPluginPresence to get complete plugin state (RPC-03).
 */
export function extractPluginConfigEntries(
  configGetResult: unknown,
): Map<string, PluginConfigEntry> {
  const map = new Map<string, PluginConfigEntry>();
  if (typeof configGetResult !== 'object' || configGetResult === null) return map;

  const result = configGetResult as Record<string, unknown>;
  const cfg = (typeof result.config === 'object' && result.config !== null)
    ? result.config as Record<string, unknown>
    : null;
  if (!cfg) return map;

  const plugins = (typeof cfg.plugins === 'object' && cfg.plugins !== null)
    ? cfg.plugins as Record<string, unknown>
    : null;
  if (!plugins) return map;

  const entries = (typeof plugins.entries === 'object' && plugins.entries !== null)
    ? plugins.entries as Record<string, unknown>
    : null;
  if (!entries) return map;

  for (const [pluginId, value] of Object.entries(entries)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    map.set(pluginId, {
      pluginId,
      enabled: entry.enabled !== false, // default to true if not explicitly false
      config: (typeof entry.config === 'object' && entry.config !== null)
        ? entry.config as Record<string, unknown>
        : {},
    });
  }
  return map;
}

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
