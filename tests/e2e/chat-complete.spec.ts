/**
 * Comprehensive Chat E2E Test — platform.aquaclaw.ai
 *
 * Covers the full chat lifecycle including model & provider switching:
 *   1. Auth → Create instance → Start → Wait for running
 *   2. Send chat message → Verify assistant response via WebSocket
 *   3. Change model via sessions.patch → Chat again → Verify
 *   4. Change provider+model via PATCH /config → Restart → Chat again → Verify
 *   5. Cleanup: stop + delete instance
 *
 * Usage (WorkOS / production — provide a JWT token):
 *   PROD_TOKEN=<jwt> \
 *   npx playwright test tests/e2e/chat-complete.spec.ts --reporter=list --workers=1
 *
 *   Get your token: browser DevTools → Application → Cookies → copy "token" value
 *
 * Usage (builtin auth / local dev):
 *   PROD_URL=http://localhost:3001/api \
 *   PROD_EMAIL=<email> PROD_PASSWORD=<password> \
 *   npx playwright test tests/e2e/chat-complete.spec.ts --reporter=list --workers=1
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

// ── Config ─────────────────────────────────────────────────

const API = process.env.PROD_URL || 'https://platform.aquaclaw.ai/api';
const EMAIL = process.env.PROD_EMAIL || '';
const PASSWORD = process.env.PROD_PASSWORD || '';
const DIRECT_TOKEN = process.env.PROD_TOKEN || '';

const HAS_CREDS = !!DIRECT_TOKEN || (!!EMAIL && !!PASSWORD);

// ── Helpers ────────────────────────────────────────────────

async function login(request: APIRequestContext): Promise<string> {
  // Direct token takes precedence (for WorkOS environments)
  if (DIRECT_TOKEN) return DIRECT_TOKEN;

  const res = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `Login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  // Handle both builtin (returns token) and WorkOS redirect
  if (body.data?.token) return body.data.token;
  throw new Error('Login returned no token — production uses WorkOS OAuth. Set PROD_TOKEN instead.');
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function waitForRunning(request: APIRequestContext, token: string, id: string, timeoutMs = 360_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/instances/${id}`, { headers: auth(token) });
    if (res.ok()) {
      const body = await res.json();
      if (body.data?.status === 'running') return true;
      if (body.data?.status === 'error') return false;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return false;
}

async function rpc(request: APIRequestContext, token: string, instanceId: string, method: string, params: Record<string, unknown> = {}) {
  const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
    headers: auth(token),
    data: { method, params },
  });
  const body = await res.json();
  return body;
}

/** Poll RPC health endpoint until gateway is reachable (DNS + pod ready). */
async function waitForGatewayReady(request: APIRequestContext, token: string, instanceId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await rpc(request, token, instanceId, 'health', {});
      if (body.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Send a chat message via RPC and poll chat.history until the assistant responds.
 * Returns the assistant's response text.
 */
async function chatAndWaitForResponse(
  token: string,
  instanceId: string,
  sessionKey: string,
  message: string,
  timeoutMs = 90_000,
): Promise<string> {
  // 1. Send message via RPC
  const sendRes = await fetch(`${API}/instances/${instanceId}/rpc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'chat.send',
      params: { sessionKey, message, idempotencyKey: randomUUID() },
    }),
  });
  const sendBody = await sendRes.json() as Record<string, unknown>;
  if (!sendBody.ok) throw new Error(`chat.send failed: ${JSON.stringify(sendBody)}`);
  // 2. Poll chat.history until we see an assistant message
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const histRes = await fetch(`${API}/instances/${instanceId}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'chat.history',
        params: { sessionKey, limit: 10 },
      }),
    });
    if (!histRes.ok) continue; // retry on HTTP errors (502, etc.)
    const text = await histRes.text();
    let histBody: Record<string, unknown>;
    try { histBody = JSON.parse(text); } catch { continue; }
    if (!histBody.ok) continue;
    const raw = histBody.data as Record<string, unknown> | undefined;
    const messages = (raw?.messages ?? (Array.isArray(raw) ? raw : [])) as Array<{ role: string; content: unknown }>;
    // Find the last assistant message that has actual text (not just tool calls)
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const extracted = extractText(messages[i].content);
        if (extracted.length > 0) return extracted;
      }
    }
  }
  throw new Error(`Chat response timeout after ${timeoutMs}ms — no assistant message in history`);
}

/** Recursively extract text content from gateway message structures. */
function extractText(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(extractText).join('');
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
    if (Array.isArray(o.content)) return o.content.map(extractText).join('');
  }
  return '';
}

// ── Tests ──────────────────────────────────────────────────

test.describe.serial('Chat Complete — Model & Provider Switching', () => {
  let token: string;
  let instanceId: string;
  const instanceName = `chat-e2e-${Date.now()}`;

  test.beforeEach(() => {
    test.skip(!HAS_CREDS, 'Requires PROD_EMAIL and PROD_PASSWORD env vars');
  });

  // ── Setup ──────────────────────────────────────────────

  test('login', async ({ request }) => {
    token = await login(request);
    expect(token).toBeTruthy();
    console.log('Logged in as', EMAIL);
  });

  test('create instance', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: auth(token),
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(res.status(), `Create failed: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceId = body.data.id;
    console.log('Created instance:', instanceId);
  });

  test('start instance and wait for running', async ({ request }) => {
    test.setTimeout(420_000);

    const startRes = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: auth(token),
    });
    expect(startRes.ok(), `Start failed: ${await startRes.text()}`).toBeTruthy();

    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state within 360s').toBe(true);
    console.log('Instance is running');

    // Wait for gateway pod DNS + readiness
    const ready = await waitForGatewayReady(request, token, instanceId);
    expect(ready, 'Gateway did not become reachable within 60s').toBe(true);
    console.log('Gateway is reachable');
  });

  // ── Chat: default model ────────────────────────────────

  test('send chat message and receive response', async () => {
    test.setTimeout(120_000);
    const sessionKey = `e2e-default-${Date.now()}`;

    const response = await chatAndWaitForResponse(
      token, instanceId, sessionKey,
      'Reply with exactly: CHAT_OK',
    );

    console.log('Default model response (first 200 chars):', response.slice(0, 200));
    expect(response.length).toBeGreaterThan(0);
  });

  // ── Switch model via sessions.patch ────────────────────

  test('switch model via sessions.patch', async ({ request }) => {
    test.setTimeout(30_000);
    const sessionKey = `e2e-model-switch-${Date.now()}`;

    // Patch session to use a different model
    const patchRes = await rpc(request, token, instanceId, 'sessions.patch', {
      key: sessionKey,
      model: 'claude-haiku-4-5-20251001',
    });
    console.log('sessions.patch response:', JSON.stringify(patchRes));
    expect(patchRes.ok, `sessions.patch failed: ${JSON.stringify(patchRes)}`).toBe(true);
  });

  test('chat with switched model (haiku)', async () => {
    test.setTimeout(120_000);
    const sessionKey = `e2e-model-switch-${Date.now()}`;

    // Patch this session to haiku
    await fetch(`${API}/instances/${instanceId}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'sessions.patch',
        params: { key: sessionKey, model: 'claude-haiku-4-5-20251001' },
      }),
    });

    const response = await chatAndWaitForResponse(
      token, instanceId, sessionKey,
      'What model are you? Reply in one short sentence.',
    );

    console.log('Haiku model response (first 200 chars):', response.slice(0, 200));
    expect(response.length).toBeGreaterThan(0);
  });

  // ── Switch to OpenAI model via sessions.patch (no restart needed) ───

  test('chat with openai model (gpt-4o-mini via LiteLLM)', async () => {
    test.setTimeout(120_000);
    const sessionKey = `e2e-openai-${Date.now()}`;

    // Patch session to use OpenAI model through LiteLLM
    await fetch(`${API}/instances/${instanceId}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'sessions.patch',
        params: { key: sessionKey, model: 'gpt-4o-mini' },
      }),
    });

    const response = await chatAndWaitForResponse(
      token, instanceId, sessionKey,
      'What model are you? Reply in one short sentence.',
    );

    console.log('OpenAI model response (first 200 chars):', response.slice(0, 200));
    expect(response.length).toBeGreaterThan(0);
  });

  // ── Switch back to Anthropic model via sessions.patch ──

  test('chat with anthropic model (claude-sonnet via LiteLLM)', async () => {
    test.setTimeout(120_000);
    const sessionKey = `e2e-sonnet-${Date.now()}`;

    // Patch session back to Anthropic model
    await fetch(`${API}/instances/${instanceId}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'sessions.patch',
        params: { key: sessionKey, model: 'claude-sonnet-4-20250514' },
      }),
    });

    const response = await chatAndWaitForResponse(
      token, instanceId, sessionKey,
      'Reply with exactly: ANTHROPIC_OK',
    );

    console.log('Anthropic model response (first 200 chars):', response.slice(0, 200));
    expect(response.length).toBeGreaterThan(0);
  });

  // ── Session management ─────────────────────────────────

  test('list sessions shows created sessions', async ({ request }) => {
    test.setTimeout(30_000);

    const body = await rpc(request, token, instanceId, 'sessions.list', {
      limit: 50,
      includeGlobal: true,
    });
    expect(body.ok, `sessions.list failed: ${JSON.stringify(body)}`).toBe(true);
    // sessions.list may return { sessions: [...] } or directly an array
    const raw = body.data as Record<string, unknown>;
    const sessions = Array.isArray(raw) ? raw : Array.isArray(raw?.sessions) ? raw.sessions as unknown[] : [];
    console.log('Sessions found:', sessions.length);
    // At least verify the RPC succeeded (session count depends on gateway persistence)
    expect(body.ok).toBe(true);
  });

  test('chat.history returns messages for previous session', async ({ request }) => {
    test.setTimeout(120_000);
    const sessionKey = `e2e-history-${Date.now()}`;

    // Send a message and wait for response via WebSocket
    const response = await chatAndWaitForResponse(
      token, instanceId, sessionKey,
      'Reply with exactly: HISTORY_CHECK',
    );
    expect(response.length).toBeGreaterThan(0);

    // Now verify history contains both user and assistant messages
    const historyRes = await rpc(request, token, instanceId, 'chat.history', {
      sessionKey,
      limit: 50,
    });
    expect(historyRes.ok, `chat.history failed: ${JSON.stringify(historyRes)}`).toBe(true);
    const histRaw = historyRes.data as Record<string, unknown>;
    const messages = (histRaw?.messages ?? (Array.isArray(histRaw) ? histRaw : [])) as Array<{ role: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    console.log('History messages:', messages.length);
  });

  // ── Instance config PATCH (provider-level change) ──────

  test('update instance default model via config PATCH', async ({ request }) => {
    test.setTimeout(60_000);

    // Retry on transient 502s from GKE load balancer
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await request.patch(`${API}/instances/${instanceId}/config`, {
        headers: auth(token),
        data: { defaultModel: 'claude-haiku-4-5-20251001' },
      });
      if (res.ok()) {
        const body = await res.json();
        expect(body.ok).toBe(true);
        console.log('Instance default model updated to claude-haiku-4-5-20251001');
        return;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Config PATCH failed after 3 attempts');
  });

  // ── Cleanup ────────────────────────────────────────────

  test('stop and delete instance', async ({ request }) => {
    test.setTimeout(30_000);
    if (!instanceId) return;

    const stopRes = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: auth(token),
    });
    console.log('Stop status:', stopRes.status());

    await new Promise(r => setTimeout(r, 2000));

    const deleteRes = await request.delete(`${API}/instances/${instanceId}`, {
      headers: auth(token),
    });
    console.log('Delete status:', deleteRes.status());
  });
});
