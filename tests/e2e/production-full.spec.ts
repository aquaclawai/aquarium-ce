import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

const API = process.env.PROD_URL || 'http://agent.jinkomcp.com/api';
const OPENAI_API_KEY = process.env.E2E_OPENAI_API_KEY || '';
const EMAIL = process.env.PROD_EMAIL || 'groupchat-demo@openclaw.dev';
const PASSWORD = process.env.PROD_PASSWORD || 'Demo2026!GroupChat';

const HAS_PROD_CREDS = !!process.env.PROD_URL && !!process.env.PROD_EMAIL && !!process.env.PROD_PASSWORD;

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/test-login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `Login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.token).toBeTruthy();
  return body.data.token;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function waitForRunning(request: APIRequestContext, token: string, instanceId: string, timeoutMs = 360_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    if (res.ok()) {
      const body = await res.json();
      if (body.data?.status === 'running') return true;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return false;
}

async function cleanupInstance(request: APIRequestContext, token: string, instanceId: string) {
  await request.post(`${API}/instances/${instanceId}/stop`, { headers: authHeaders(token) }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  await request.delete(`${API}/instances/${instanceId}`, { headers: authHeaders(token) }).catch(() => {});
}

// ── Skip entire file when production credentials are not available ────────
test.beforeEach(({ }, testInfo) => {
  test.skip(!HAS_PROD_CREDS, 'Requires PROD_URL, PROD_EMAIL, PROD_PASSWORD env vars');
});

// ── Health & Auth ──────────────────────────────────────

test.describe.serial('Health & Auth', () => {
  let token: string;

  test('health check', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('login with test account', async ({ request }) => {
    token = await login(request);
    expect(token).toBeTruthy();
  });

  test('/me returns current user', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe(EMAIL);
  });
});

// ── Instance Full Lifecycle ────────────────────────────

test.describe.serial('Instance Full Lifecycle', () => {
  let token: string;
  let instanceId: string;
  const instanceName = `e2e-full-${Date.now()}`;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('list instances (baseline)', async ({ request }) => {
    const res = await request.get(`${API}/instances`, { headers: authHeaders(token) });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('create instance', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(res.status(), `Create failed: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe(instanceName);
    expect(body.data.status).toBe('created');
    instanceId = body.data.id;
  });

  test('get instance by id', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(instanceName);
    expect(body.data.agentType).toBe('openclaw');
  });

  test('instance appears in list', async ({ request }) => {
    const res = await request.get(`${API}/instances`, { headers: authHeaders(token) });
    const body = await res.json();
    const names = body.data.map((i: { name: string }) => i.name);
    expect(names).toContain(instanceName);
  });

  test('start instance', async ({ request }) => {
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Start failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(['running', 'starting']).toContain(body.data.status);
  });

  test('wait for pod ready', async ({ request }) => {
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state within 360s').toBe(true);
  });

  test('fetch logs', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/logs?tail=20`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Logs failed: ${res.status()}`).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/plain');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test('fetch events', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/events`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('update config', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514' },
    });
    expect(res.ok(), `Config update failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('stop instance', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Stop failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBe('stopped');
  });

  test('restart from stopped', async ({ request }) => {
    test.setTimeout(180_000);
    // Wait for K8s to fully tear down the previous pod before restarting
    await new Promise(r => setTimeout(r, 10_000));
    const res = await request.post(`${API}/instances/${instanceId}/restart`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Restart failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(['running', 'starting']).toContain(body.data.status);
  });

  test('wait for pod ready after restart', async ({ request }) => {
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state after restart').toBe(true);
  });

  test('stop instance (final)', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
  });

  test('delete instance', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Delete failed: ${await res.text()}`).toBeTruthy();
  });

  test('verify deleted (404)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.status()).toBe(404);
  });
});

// ── Credentials CRUD ───────────────────────────────────

test.describe.serial('Credentials CRUD', () => {
  let token: string;
  let instanceId: string;
  let firstCredId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create instance for credential tests', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-cred-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    instanceId = (await res.json()).data.id;
  });

  test('list credentials (empty)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  test('add api_key credential', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'anthropic', credentialType: 'api_key', value: 'sk-test-fake-key-12345' },
    });
    expect(res.ok(), `Add cred failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeTruthy();
    firstCredId = body.data.id;
  });

  test('list credentials (1 item)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].provider).toBe('anthropic');
    expect(body.data[0].value).toBeUndefined();
  });

  test('add second credential', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: 'sk-test-openai-12345' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('list credentials (2 items)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  test('delete first credential', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}/credentials/${firstCredId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
  });

  test('list credentials after delete (1 item)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].provider).toBe('openai');
  });

  test('cleanup: delete instance', async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, { headers: authHeaders(token) });
  });
});

// ── Templates Marketplace ──────────────────────────────

test.describe.serial('Templates Marketplace', () => {
  let token: string;
  let templateId: string;
  let forkedTemplateId: string;
  let instantiatedInstanceId: string;
  const slug = `e2e-tpl-${Date.now()}`;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('list templates', async ({ request }) => {
    const res = await request.get(`${API}/templates?page=1&limit=10`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items).toBeDefined();
    expect(typeof body.data.total).toBe('number');
  });

  test('create template', async ({ request }) => {
    const res = await request.post(`${API}/templates`, {
      headers: authHeaders(token),
      data: {
        slug,
        name: 'E2E Test Template',
        description: 'Created by production-full E2E suite',
        category: 'custom',
        tags: ['e2e', 'test'],
        license: 'private',
        content: {
          workspaceFiles: {
            'AGENTS.md': '# E2E Test Agent\nAutomated test template.',
            'SOUL.md': '# E2E Test Soul',
          },
        },
      },
    });
    expect(res.ok(), `Create template failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe(slug);
    templateId = body.data.id;
  });

  test('get template by id', async ({ request }) => {
    const res = await request.get(`${API}/templates/${templateId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe('E2E Test Template');
  });

  test('get template content', async ({ request }) => {
    const res = await request.get(`${API}/templates/${templateId}/content`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.workspaceFiles).toBeDefined();
    expect(body.data.workspaceFiles['AGENTS.md']).toContain('E2E Test Agent');
  });

  test('fork template', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/fork`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Fork failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    forkedTemplateId = body.data.id;
  });

  test('instantiate template', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: authHeaders(token),
      data: { instanceName: `e2e-from-tpl-${Date.now()}` },
    });
    expect(res.ok(), `Instantiate failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.instance?.id).toBeTruthy();
    instantiatedInstanceId = body.data.instance.id;
  });

  test('verify instantiated instance exists', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instantiatedInstanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.templateId).toBe(templateId);
  });

  test('cleanup: delete instantiated instance', async ({ request }) => {
    await request.delete(`${API}/instances/${instantiatedInstanceId}`, {
      headers: authHeaders(token),
    });
  });

  test('cleanup: delete forked template', async ({ request }) => {
    await request.delete(`${API}/templates/${forkedTemplateId}`, {
      headers: authHeaders(token),
    });
  });

  test('cleanup: delete original template', async ({ request }) => {
    await request.delete(`${API}/templates/${templateId}`, {
      headers: authHeaders(token),
    });
  });
});

// ── User Credential Vault ──────────────────────────────

test.describe.serial('User Credential Vault', () => {
  let token: string;
  let credentialId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('list user credentials', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('add user credential', async ({ request }) => {
    const res = await request.post(`${API}/credentials`, {
      headers: authHeaders(token),
      data: {
        provider: 'e2e-test-provider',
        credentialType: 'api_key',
        value: 'vault-e2e-test-12345',
        displayName: 'E2E Vault Test',
      },
    });
    expect(res.ok(), `Add vault cred failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    credentialId = body.data.id;
  });

  test('credential appears in list', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    const found = body.data.find((c: { id: string }) => c.id === credentialId);
    expect(found).toBeTruthy();
    expect(found.displayName).toBe('E2E Vault Test');
  });

  test('update credential', async ({ request }) => {
    const res = await request.put(`${API}/credentials/${credentialId}`, {
      headers: authHeaders(token),
      data: { displayName: 'E2E Vault Updated' },
    });
    expect(res.ok(), `Update failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.data.displayName).toBe('E2E Vault Updated');
  });

  test('delete credential', async ({ request }) => {
    const res = await request.delete(`${API}/credentials/${credentialId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
  });

  test('verify credential deleted', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    const found = body.data.find((c: { id: string }) => c.id === credentialId);
    expect(found).toBeUndefined();
  });
});

// ── Agent Types ────────────────────────────────────────

test.describe.serial('Agent Types', () => {
  let token: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('list agent types includes openclaw', async ({ request }) => {
    const res = await request.get(`${API}/agent-types`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const openclaw = body.data.find((t: { id: string }) => t.id === 'openclaw');
    expect(openclaw).toBeTruthy();
    expect(openclaw.defaultImageTag).toBeTruthy();
  });
});

// ── RPC Proxy ──────────────────────────────────────────

test.describe.serial('RPC Proxy', () => {
  let token: string;
  let instanceId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create and start instance', async ({ request }) => {
    test.setTimeout(180_000);
    const createRes = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-rpc-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.status()).toBe(201);
    instanceId = (await createRes.json()).data.id;

    const startRes = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(startRes.ok(), `Start failed: ${await startRes.text()}`).toBeTruthy();
  });

  test('wait for pod ready', async ({ request }) => {
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state').toBe(true);
  });

  test('RPC platform.ping', async ({ request }) => {
    test.setTimeout(30_000);
    // Small delay to ensure RPC readiness after health check passes
    await new Promise(r => setTimeout(r, 3000));
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'platform.ping', params: {} },
    });
    expect(res.ok(), `RPC failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('cleanup: stop and delete', async ({ request }) => {
    await cleanupInstance(request, token, instanceId);
  });
});

// ── Admin API ──────────────────────────────────────────

test.describe.serial('Admin API', () => {
  let token: string;
  let isAdmin = false;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('check admin status', async ({ request }) => {
    const res = await request.get(`${API}/admin/check`, {
      headers: authHeaders(token),
    });
    if (res.status() === 403) {
      isAdmin = false;
      test.skip();
      return;
    }
    expect(res.ok()).toBeTruthy();
    isAdmin = true;
  });

  test('get admin stats', async ({ request }) => {
    if (!isAdmin) test.skip();
    const res = await request.get(`${API}/admin/stats`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.totalUsers).toBe('number');
    expect(typeof body.data.totalInstances).toBe('number');
  });

  test('list users', async ({ request }) => {
    if (!isAdmin) test.skip();
    const res = await request.get(`${API}/admin/users`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });
});

// ── Helpers for LLM chat tests ────────────────────────

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  const textParts = content
    .filter((p: Record<string, unknown>) => p.type === 'text' && typeof p.text === 'string')
    .map((p: Record<string, unknown>) => p.text as string)
    .join('\n');
  return textParts || JSON.stringify(content);
}

async function pollChatHistory(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  sessionKey: string,
  timeoutMs = 60_000,
  minAssistantMessages = 1,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000));
    try {
      const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'chat.history', params: { sessionKey, limit: 50 } },
      });
      if (res.ok()) {
        const body = await res.json();
        const messages = body.data?.messages as Array<{ role: string; content: unknown }> | undefined;
        if (messages) {
          const assistantMsgs = messages.filter(m => m.role !== 'user');
          if (assistantMsgs.length >= minAssistantMessages) {
            return extractText(assistantMsgs[assistantMsgs.length - 1].content);
          }
        }
      }
    } catch {
      // transient — retry
    }
  }
  throw new Error('Chat history poll timeout: no bot reply received');
}

// ── Chat with Real LLM ───────────────────────────────

test.describe.serial('Chat with Real LLM', () => {
  let token: string;
  let instanceId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create instance', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-chat-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    instanceId = (await res.json()).data.id;
  });

  test('add OpenAI API key credential', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
    });
    expect(res.ok(), `Add cred failed: ${await res.text()}`).toBeTruthy();
  });

  test('configure model', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
    });
    expect(res.ok(), `Config update failed: ${await res.text()}`).toBeTruthy();
  });

  test('start instance', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Start failed: ${await res.text()}`).toBeTruthy();
  });

  test('wait for pod ready', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state').toBe(true);
  });

  test('send chat message via RPC', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(60_000);
    await new Promise(r => setTimeout(r, 3_000));
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: {
        method: 'chat.send',
        params: { sessionKey: 'e2e-chat-test', message: 'Reply with exactly the word PONG', idempotencyKey: randomUUID() },
      },
    });
    expect(res.ok(), `chat.send failed: ${await res.text()}`).toBeTruthy();
  });

  test('poll chat history for LLM response', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(90_000);
    const reply = await pollChatHistory(request, token, instanceId, 'e2e-chat-test');
    expect(reply.length).toBeGreaterThan(0);
  });

  test('cleanup: stop and delete', async ({ request }) => {
    if (!OPENAI_API_KEY || !instanceId) { test.skip(); return; }
    await cleanupInstance(request, token, instanceId);
  });
});

// ── Group Chat ────────────────────────────────────────

test.describe.serial('Group Chat', () => {
  let token: string;
  let instanceIdA: string;
  let instanceIdB: string;
  let groupChatId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create two instances', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const resA = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-gc-a-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(resA.status()).toBe(201);
    instanceIdA = (await resA.json()).data.id;

    const resB = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-gc-b-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(resB.status()).toBe(201);
    instanceIdB = (await resB.json()).data.id;
  });

  test('add OpenAI credentials to both', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const resA = await request.post(`${API}/instances/${instanceIdA}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
    });
    expect(resA.ok()).toBeTruthy();

    const resB = await request.post(`${API}/instances/${instanceIdB}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
    });
    expect(resB.ok()).toBeTruthy();
  });

  test('configure both instances', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const resA = await request.patch(`${API}/instances/${instanceIdA}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
    });
    expect(resA.ok()).toBeTruthy();

    const resB = await request.patch(`${API}/instances/${instanceIdB}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
    });
    expect(resB.ok()).toBeTruthy();
  });

  test('start both instances', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(360_000);
    const resA = await request.post(`${API}/instances/${instanceIdA}/start`, {
      headers: authHeaders(token),
    });
    expect(resA.ok(), `Start A failed: ${await resA.text()}`).toBeTruthy();

    const resB = await request.post(`${API}/instances/${instanceIdB}/start`, {
      headers: authHeaders(token),
    });
    expect(resB.ok(), `Start B failed: ${await resB.text()}`).toBeTruthy();
  });

  test('wait for both instances ready', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(420_000);
    const [runA, runB] = await Promise.all([
      waitForRunning(request, token, instanceIdA),
      waitForRunning(request, token, instanceIdB),
    ]);
    expect(runA, 'Instance A did not reach running state').toBe(true);
    expect(runB, 'Instance B did not reach running state').toBe(true);
  });

  test('create group chat', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const displayNames: Record<string, string> = {};
    displayNames[instanceIdA] = 'Bot-A';
    displayNames[instanceIdB] = 'Bot-B';

    const res = await request.post(`${API}/group-chats`, {
      headers: authHeaders(token),
      data: {
        name: 'E2E Test Group',
        instanceIds: [instanceIdA, instanceIdB],
        displayNames,
      },
    });
    expect(res.status(), `Create group chat failed: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe('E2E Test Group');
    expect(body.data.members).toHaveLength(2);
    groupChatId = body.data.id;
  });

  test('list group chats', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.get(`${API}/group-chats`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = body.data.find((gc: { id: string }) => gc.id === groupChatId);
    expect(found).toBeTruthy();
  });

  test('get group chat details', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.get(`${API}/group-chats/${groupChatId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.members).toHaveLength(2);
  });

  test('send message to group', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: authHeaders(token),
      data: { content: 'Hello bots, reply with your name in one word' },
    });
    expect(res.status(), `Send message failed: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.data.messageId).toBeTruthy();
  });

  test('poll messages for bot replies', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(180_000);
    const deadline = Date.now() + 120_000;
    let botReplyCount = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5_000));
      const res = await request.get(`${API}/group-chats/${groupChatId}/messages?limit=20`, {
        headers: authHeaders(token),
      });
      if (res.ok()) {
        const body = await res.json();
        const messages = body.data?.messages as Array<{ senderType: string; content: string }> | undefined;
        if (messages) {
          botReplyCount = messages.filter(m => m.senderType === 'bot').length;
          if (botReplyCount >= 1) break;
        }
      }
    }

    expect(botReplyCount, 'Expected at least 1 bot reply in group chat').toBeGreaterThanOrEqual(1);
  });

  test('cleanup: delete group chat', async ({ request }) => {
    if (!OPENAI_API_KEY || !groupChatId) { test.skip(); return; }
    const res = await request.delete(`${API}/group-chats/${groupChatId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
  });

  test('cleanup: stop and delete instances', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    await cleanupInstance(request, token, instanceIdA);
    await cleanupInstance(request, token, instanceIdB);
  });
});

// ── Template Instantiation with Chat ──────────────────

test.describe.serial('Template Instantiation with Chat', () => {
  let token: string;
  let templateId: string;
  let instanceId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create a test template', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/templates`, {
      headers: authHeaders(token),
      data: {
        slug: `e2e-chat-tpl-${Date.now()}`,
        name: 'E2E Chat Template',
        description: 'Template for E2E chat testing',
        category: 'custom',
        tags: ['e2e', 'chat-test'],
        license: 'private',
        content: {
          workspaceFiles: {
            'AGENTS.md': '# E2E Chat Test Agent\nYou are a helpful test assistant. Keep responses very short (under 20 words).',
            'SOUL.md': '# E2E Test Soul\nBe concise and helpful.',
          },
        },
      },
    });
    expect(res.ok(), `Create template failed: ${await res.text()}`).toBeTruthy();
    templateId = (await res.json()).data.id;
  });

  test('instantiate template', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: authHeaders(token),
      data: { instanceName: `e2e-tpl-chat-${Date.now()}` },
    });
    expect(res.ok(), `Instantiate failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    instanceId = body.data.instance.id;
  });

  test('add OpenAI credential', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('configure model', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('start instance', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Start failed: ${await res.text()}`).toBeTruthy();
  });

  test('wait for pod ready', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state').toBe(true);
  });

  test('verify chat works', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(90_000);
    await new Promise(r => setTimeout(r, 3_000));

    const sendRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: {
        method: 'chat.send',
        params: { sessionKey: 'e2e-tpl-chat', message: 'Say OK', idempotencyKey: randomUUID() },
      },
    });
    expect(sendRes.ok(), `chat.send failed: ${await sendRes.text()}`).toBeTruthy();

    const reply = await pollChatHistory(request, token, instanceId, 'e2e-tpl-chat');
    expect(reply.length).toBeGreaterThan(0);
  });

  test('cleanup: stop and delete instance', async ({ request }) => {
    if (!OPENAI_API_KEY || !instanceId) { test.skip(); return; }
    await cleanupInstance(request, token, instanceId);
  });

  test('cleanup: delete template', async ({ request }) => {
    if (!OPENAI_API_KEY || !templateId) { test.skip(); return; }
    await request.delete(`${API}/templates/${templateId}`, {
      headers: authHeaders(token),
    });
  });
});

// ── ClaWHub Skills: Enable, Install jinko-flight, Search Flight ──

test.describe.serial('ClaWHub Skills & Flight Search', () => {
  let token: string;
  let instanceId: string;
  let chatSessionKey: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create instance with OpenAI credentials', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    const createRes = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-clawhub-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.status()).toBe(201);
    instanceId = (await createRes.json()).data.id;

    // Add OpenAI credential
    const credRes = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: authHeaders(token),
      data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
    });
    expect(credRes.ok(), `Add cred failed: ${await credRes.text()}`).toBeTruthy();

    // Configure model
    const configRes = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: authHeaders(token),
      data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
    });
    expect(configRes.ok(), `Config update failed: ${await configRes.text()}`).toBeTruthy();
  });

  test('start instance', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Start failed: ${await res.text()}`).toBeTruthy();
  });

  test('wait for pod ready', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state').toBe(true);
  });

  test('list skills and verify bundled skills exist', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(30_000);
    await new Promise(r => setTimeout(r, 3_000));
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'skills.status', params: {} },
    });
    expect(res.ok(), `skills.status failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const skills = body.data?.skills || body.data?.entries || [];
    expect(skills.length).toBeGreaterThan(0);
    // Verify some bundled skills exist
    const bundled = skills.filter((s: { source?: string }) => s.source === 'openclaw-bundled');
    expect(bundled.length, 'Expected bundled skills').toBeGreaterThan(0);
  });

  test('enable a disabled bundled skill', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(30_000);
    // First, get the list of skills
    const listRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'skills.status', params: {} },
    });
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const skills = listBody.data?.skills || listBody.data?.entries || [];

    // Find a disabled bundled skill to enable
    const disabledBundled = skills.find(
      (s: { source?: string; disabled: boolean; eligible: boolean }) =>
        s.source === 'openclaw-bundled' && s.disabled && s.eligible,
    );
    if (!disabledBundled) {
      console.log('No disabled+eligible bundled skill found, enabling any bundled skill');
      // All bundled skills may already be enabled — toggle one off then on
      const anyBundled = skills.find(
        (s: { source?: string; eligible: boolean }) =>
          s.source === 'openclaw-bundled' && s.eligible,
      );
      expect(anyBundled, 'No eligible bundled skill found at all').toBeTruthy();

      // Disable then re-enable to verify toggle works
      const disableRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'skills.update', params: { skillKey: anyBundled.skillKey, enabled: false } },
      });
      expect(disableRes.ok(), `skills.update (disable) failed: ${await disableRes.text()}`).toBeTruthy();

      const enableRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'skills.update', params: { skillKey: anyBundled.skillKey, enabled: true } },
      });
      expect(enableRes.ok(), `skills.update (enable) failed: ${await enableRes.text()}`).toBeTruthy();
    } else {
      // Enable the disabled skill
      const enableRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'skills.update', params: { skillKey: disabledBundled.skillKey, enabled: true } },
      });
      expect(enableRes.ok(), `skills.update failed: ${await enableRes.text()}`).toBeTruthy();

      // Verify the skill is now enabled
      const verifyRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'skills.status', params: {} },
      });
      expect(verifyRes.ok()).toBeTruthy();
      const verifyBody = await verifyRes.json();
      const updated = (verifyBody.data?.skills || verifyBody.data?.entries || []).find(
        (s: { skillKey: string }) => s.skillKey === disabledBundled.skillKey,
      );
      expect(updated, 'Skill not found after enable').toBeTruthy();
      expect(updated.disabled, 'Skill should be enabled after update').toBe(false);
    }
  });

  test('install clawhub CLI via skills.install RPC', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(120_000);
    // The clawhub skill is bundled but its CLI binary needs to be installed first
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'skills.install', params: { name: 'clawhub', installId: 'node', timeoutMs: 120000 } },
    });
    expect(res.ok(), `skills.install clawhub failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok, `skills.install clawhub RPC error: ${JSON.stringify(body)}`).toBe(true);
    console.log('clawhub CLI installed successfully');
  });

  test('install jinko-flight and search flight via chat', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(300_000);
    await new Promise(r => setTimeout(r, 2_000));
    chatSessionKey = `e2e-clawhub-${Date.now()}`;
    const sendRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: {
        method: 'chat.send',
        params: {
          sessionKey: chatSessionKey,
          message: 'Do the following two tasks in order:\n1. Run this exact shell command: clawhub install jinko-flight-search --force\n2. After that completes, use the Jinko flight search tool (Jinko:find_flight) to find flights from Paris CDG to New York JFK departing on 2026-07-15. Do NOT use web search, use the Jinko MCP tool.',
          idempotencyKey: randomUUID(),
        },
      },
    });
    expect(sendRes.ok(), `chat.send failed: ${await sendRes.text()}`).toBeTruthy();

    const reply = await pollChatHistory(request, token, instanceId, chatSessionKey, 240_000);
    expect(reply.length).toBeGreaterThan(0);
    console.log('Combined chat reply (first 1000 chars):', reply.slice(0, 1000));
  });

  test('verify jinko-flight skill appears in skills list', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(90_000);
    let found = false;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: authHeaders(token),
        data: { method: 'skills.status', params: {} },
      });
      if (res.ok()) {
        const body = await res.json();
        const skills = body.data?.skills || body.data?.entries || [];
        const jinkoFlight = skills.find(
          (s: { skillKey: string; name: string }) =>
            s.skillKey.includes('jinko-flight') || s.name.toLowerCase().includes('jinko'),
        );
        if (jinkoFlight) {
          console.log('jinko-flight skill found:', jinkoFlight.skillKey, jinkoFlight.name);
          found = true;
          break;
        }
        console.log('jinko-flight not yet visible, retrying... Available:', skills.length, 'skills');
      }
      await new Promise(r => setTimeout(r, 5_000));
    }
    expect(found, 'jinko-flight skill did not appear in skills list within 60s').toBe(true);
  });

  test('verify flight search results in chat reply', async ({ request }) => {
    if (!OPENAI_API_KEY) { test.skip(); return; }
    test.setTimeout(30_000);
    const histRes = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'chat.history', params: { sessionKey: chatSessionKey, limit: 50 } },
    });
    expect(histRes.ok()).toBeTruthy();
    const body = await histRes.json();
    const messages = body.data?.messages as Array<{ role: string; content: unknown }> | undefined;
    expect(messages, 'No messages in chat history').toBeTruthy();
    const allText = messages!
      .filter(m => m.role !== 'user')
      .map(m => extractText(m.content))
      .join(' ')
      .toLowerCase();
    console.log('All assistant text (first 800 chars):', allText.slice(0, 800));
    const hasFlightContent = allText.includes('flight') || allText.includes('cdg') || allText.includes('jfk')
      || allText.includes('paris') || allText.includes('new york') || allText.includes('jinko')
      || allText.includes('find_flight') || allText.includes('find_destination')
      || allText.includes('clawhub') || allText.includes('install');
    expect(hasFlightContent, `Expected flight/install content in chat: ${allText.slice(0, 300)}`).toBe(true);
  });

  test('cleanup: stop and delete', async ({ request }) => {
    if (!OPENAI_API_KEY || !instanceId) { test.skip(); return; }
    await cleanupInstance(request, token, instanceId);
  });
});

// ── Gateway RPC Features ─────────────────────────────

test.describe.serial('Gateway RPC Features', () => {
  let token: string;
  let instanceId: string;

  test('login', async ({ request }) => {
    token = await login(request);
  });

  test('create and start instance', async ({ request }) => {
    test.setTimeout(180_000);
    const createRes = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: `e2e-rpc-feat-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.status()).toBe(201);
    instanceId = (await createRes.json()).data.id;

    const startRes = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(startRes.ok(), `Start failed: ${await startRes.text()}`).toBeTruthy();
  });

  test('wait for pod ready', async ({ request }) => {
    test.setTimeout(420_000);
    const running = await waitForRunning(request, token, instanceId);
    expect(running, 'Instance did not reach running state').toBe(true);
  });

  test('RPC config.schema returns schema object', async ({ request }) => {
    test.setTimeout(30_000);
    await new Promise(r => setTimeout(r, 3000));
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'config.schema', params: {} },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    }
  });

  test('RPC logs.tail returns log entries', async ({ request }) => {
    test.setTimeout(30_000);
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'logs.tail', params: { limit: 10 } },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('RPC sessions.list returns array', async ({ request }) => {
    test.setTimeout(30_000);
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'sessions.list', params: {} },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('RPC sessions.usage returns usage data', async ({ request }) => {
    test.setTimeout(30_000);
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'sessions.usage', params: {} },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('RPC exec.approvals.list returns array', async ({ request }) => {
    test.setTimeout(30_000);
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'exec.approvals.list', params: {} },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('RPC skills.list returns skills', async ({ request }) => {
    test.setTimeout(30_000);
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: authHeaders(token),
      data: { method: 'skills.list', params: {} },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('cleanup: stop and delete', async ({ request }) => {
    await cleanupInstance(request, token, instanceId);
  });
});
