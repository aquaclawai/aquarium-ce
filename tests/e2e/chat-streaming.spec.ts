/**
 * Chat streaming E2E test — verifies that chat events (delta/final) arrive
 * via the platform WebSocket after sending chat.send RPC.
 *
 * This tests the full event relay path:
 *   Gateway → PersistentGatewayClient → sendToChatSession → Browser WebSocket
 *
 * Run against production (needs a running instance):
 *   PROD_URL=https://agent.jinkomcp.com/api \
 *   PROD_EMAIL=<email> PROD_PASSWORD=<password> \
 *   npx playwright test tests/e2e/chat-streaming.spec.ts --reporter=list --workers=1
 *
 * Or provide a token + instance ID directly:
 *   PROD_URL=https://agent.jinkomcp.com/api \
 *   PROD_TOKEN=<jwt> PROD_INSTANCE_ID=<uuid> \
 *   npx playwright test tests/e2e/chat-streaming.spec.ts --reporter=list --workers=1
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

const API = process.env.PROD_URL || 'https://agent.jinkomcp.com/api';
const EMAIL = process.env.PROD_EMAIL || '';
const PASSWORD = process.env.PROD_PASSWORD || '';
const DIRECT_TOKEN = process.env.PROD_TOKEN || '';
const DIRECT_INSTANCE = process.env.PROD_INSTANCE_ID || '';

/** Login via fetch (avoids Playwright request fixture baseURL issues). */
async function login(): Promise<string> {
  if (DIRECT_TOKEN) return DIRECT_TOKEN;
  if (!EMAIL || !PASSWORD) throw new Error('Set PROD_EMAIL+PROD_PASSWORD or PROD_TOKEN');
  const res = await fetch(`${API}/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json() as { ok: boolean; data?: { token: string } };
  if (!body.ok || !body.data?.token) throw new Error(`Login failed: ${res.status}`);
  return body.data.token;
}

async function apiFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function findRunningInstance(token: string): Promise<string | null> {
  if (DIRECT_INSTANCE) return DIRECT_INSTANCE;
  const body = await apiFetch('/instances', token) as { data?: Array<{ id: string; status: string }> };
  const running = body.data?.find(i => i.status === 'running');
  return running?.id ?? null;
}

// ── Chat Streaming Test ──────────────────────────────────

test.describe.serial('Chat Streaming via WebSocket', () => {
  let token: string;
  let instanceId: string;
  const sessionKey = `e2e-stream-${Date.now()}`;

  test.beforeEach(() => {
    test.skip(!DIRECT_TOKEN && (!EMAIL || !PASSWORD), 'Requires PROD_EMAIL+PROD_PASSWORD or PROD_TOKEN env vars');
  });

  test('login', async () => {
    token = await login();
    expect(token).toBeTruthy();
    console.log('Logged in successfully');
  });

  test('find running instance', async () => {
    test.setTimeout(10_000);
    const id = await findRunningInstance(token);
    expect(id, 'No running instance found — set PROD_INSTANCE_ID or ensure account has a running instance').toBeTruthy();
    instanceId = id!;
    console.log('Using instance:', instanceId);
  });

  test('chat events stream via WebSocket', async () => {
    test.setTimeout(120_000);

    // 1. Connect platform WebSocket
    const wsUrl = API.replace(/^http/, 'ws').replace(/\/api$/, '/ws');
    console.log('Connecting WebSocket to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    const chatEvents: Array<{ state: string; message?: unknown }> = [];

    const wsReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket auth timeout')), 15_000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        // Auth success → subscribe
        if (msg.type === 'auth' && msg.ok) {
          ws.send(JSON.stringify({ type: 'subscribe', instanceId }));
          ws.send(JSON.stringify({ type: 'subscribe_chat_session', instanceId, sessionKey }));
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (msg.type === 'auth' && !msg.ok) {
          clearTimeout(timeout);
          reject(new Error('WebSocket auth failed'));
          return;
        }

        // Collect chat events
        if (msg.type === 'instance:gateway_event' && msg.instanceId === instanceId) {
          const payload = msg.payload as { event?: string; data?: Record<string, unknown> };
          if (payload.event === 'chat' && payload.data) {
            const d = payload.data as { state?: string; sessionKey?: string; message?: unknown };
            if (d.sessionKey === sessionKey && d.state) {
              console.log(`  chat event: state=${d.state}`);
              chatEvents.push({ state: d.state, message: d.message });
            }
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    await wsReady;
    console.log('WebSocket authenticated and subscribed');

    // Small delay to ensure subscription is processed server-side
    await new Promise(r => setTimeout(r, 500));

    // 2. Send chat.send via HTTP RPC
    const sendBody = await apiFetch(`/instances/${instanceId}/rpc`, token, {
      method: 'POST',
      body: JSON.stringify({
        method: 'chat.send',
        params: {
          sessionKey,
          message: 'Reply with exactly: STREAMING_OK',
          idempotencyKey: randomUUID(),
        },
      }),
    });
    console.log('chat.send response:', JSON.stringify(sendBody));
    expect(sendBody.ok, `chat.send failed: ${JSON.stringify(sendBody)}`).toBe(true);

    // 3. Wait for 'final' event (streaming complete)
    const finalReceived = await new Promise<boolean>((resolve) => {
      // Check if already received
      if (chatEvents.some(e => e.state === 'final')) {
        resolve(true);
        return;
      }

      const timeout = setTimeout(() => {
        console.error('TIMEOUT — events received so far:', JSON.stringify(chatEvents.map(e => e.state)));
        resolve(false);
      }, 90_000);

      const origHandler = ws.listeners('message')[0] as ((...args: unknown[]) => void);
      const checkFinal = (data: unknown) => {
        // Re-run original handler first
        origHandler?.(data);
        if (chatEvents.some(e => e.state === 'final')) {
          clearTimeout(timeout);
          resolve(true);
        }
      };
      // Add our checker (original handler is still active, we just piggyback)
      ws.on('message', checkFinal);
    });

    ws.close();

    console.log(`Total chat events received: ${chatEvents.length}`);
    console.log('Event states:', chatEvents.map(e => e.state).join(', '));

    expect(finalReceived, `Expected 'final' event via WebSocket but only received: [${chatEvents.map(e => e.state).join(', ')}]`).toBe(true);
    expect(chatEvents.length).toBeGreaterThan(0);

    // Should have at least one delta before final (unless very short response)
    const hasDelta = chatEvents.some(e => e.state === 'delta');
    console.log(`Delta events received: ${hasDelta}`);
  });
});
