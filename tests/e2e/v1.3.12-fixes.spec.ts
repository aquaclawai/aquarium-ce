/**
 * E2E tests for v1.3.12 — 3 Critical Pain Point Fixes
 *
 * Fix 1: Group chat tool use enabled (prompt change — verified via message routing)
 * Fix 2: Brave API key credential CRUD
 * Fix 3: Config PATCH accepts partial updates
 *
 * Usage:
 *   npx playwright test tests/e2e/v1.3.12-fixes.spec.ts --reporter=list
 */
import { test, expect } from '@playwright/test';
import { API, signupAndGetCookie } from './helpers';

// ─── Fix 2: Brave API Key Credential CRUD ──────────────────────

test.describe.serial('Brave Credential CRUD (Fix 2)', () => {
  let cookie: string;
  let instanceId: string;
  let braveCredId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `brave-cred-${Date.now()}`, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('add brave credential', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
      data: { provider: 'brave', credentialType: 'api_key', value: 'test-brave-key-12345' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.provider).toBe('brave');
    expect(body.data.credentialType).toBe('api_key');
    braveCredId = body.data.id;
  });

  test('list credentials includes brave', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const brave = body.data.find((c: { provider: string }) => c.provider === 'brave');
    expect(brave).toBeTruthy();
    expect(brave.credentialType).toBe('api_key');
  });

  test('delete brave credential', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}/credentials/${braveCredId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();

    const after = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    const body = await after.json();
    const brave = body.data.find((c: { provider: string }) => c.provider === 'brave');
    expect(brave).toBeUndefined();
  });
});

// ─── Fix 3: Config PATCH Accepts Partial Updates ───────────────

test.describe.serial('Config PATCH Validation (Fix 3)', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `cfg-patch-${Date.now()}`,
        agentType: 'openclaw',
        config: { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514' },
      },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('PATCH config with partial model change succeeds', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: { defaultModel: 'gpt-4o' },
    });
    expect(res.ok(), `PATCH failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('PATCH config preserves existing fields (deep merge)', async ({ request }) => {
    // The previous test changed defaultModel to gpt-4o; defaultProvider should still be anthropic
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(body.data.config.defaultProvider).toBe('anthropic');
    expect(body.data.config.defaultModel).toBe('gpt-4o');
  });

  test('PATCH config with provider change succeeds', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: { defaultProvider: 'openai' },
    });
    expect(res.ok()).toBeTruthy();

    const get = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const body = await get.json();
    expect(body.data.config.defaultProvider).toBe('openai');
    expect(body.data.config.defaultModel).toBe('gpt-4o');
  });

  test('PATCH config with multiple fields succeeds', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514' },
    });
    expect(res.ok()).toBeTruthy();

    const get = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const body = await get.json();
    expect(body.data.config.defaultProvider).toBe('anthropic');
    expect(body.data.config.defaultModel).toBe('claude-sonnet-4-20250514');
  });

  test('PATCH config with empty object succeeds (no-op)', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: {},
    });
    expect(res.ok()).toBeTruthy();
  });

  test('PATCH config with nested object succeeds', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: { customSettings: { key: 'value', nested: { deep: true } } },
    });
    expect(res.ok()).toBeTruthy();

    const get = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const body = await get.json();
    expect(body.data.config.customSettings).toEqual({ key: 'value', nested: { deep: true } });
  });

  test('PATCH config rejects unauthenticated request', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      data: { defaultModel: 'gpt-4o' },
    });
    expect(res.status()).toBe(401);
  });

  test('PATCH config rejects cross-user access', async ({ request }) => {
    const otherCookie = await signupAndGetCookie(request);
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: otherCookie },
      data: { defaultModel: 'gpt-4o' },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── Fix 1: Group Chat with Tool-Enabled Bots ─────────────────

test.describe.serial('Group Chat Tool Use (Fix 1)', () => {
  let cookie: string;
  let instanceId: string;
  let groupChatId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `gc-tools-${Date.now()}`, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    if (groupChatId) {
      await request.delete(`${API}/group-chats/${groupChatId}`, {
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('create group chat with bot member and role', async ({ request }) => {
    const res = await request.post(`${API}/group-chats`, {
      headers: { Cookie: cookie },
      data: {
        name: 'Tool Test Group',
        instanceIds: [instanceId],
        displayNames: { [instanceId]: 'ResearchBot' },
        roles: { [instanceId]: 'Research assistant with web search' },
        defaultMentionMode: 'broadcast',
      },
    });
    expect(res.ok(), `Create group chat failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    groupChatId = body.data.id;
    expect(groupChatId).toBeTruthy();
  });

  test('send message in group chat', async ({ request }) => {
    const res = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: { Cookie: cookie },
      data: { content: '@ResearchBot search for the latest news' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.messageId).toBeTruthy();
  });

  test('message is retrievable with correct content', async ({ request }) => {
    const res = await request.get(`${API}/group-chats/${groupChatId}/messages?limit=10`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const messages = body.data.messages;
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const found = messages.find(
      (m: { content: string }) => m.content === '@ResearchBot search for the latest news',
    );
    expect(found).toBeTruthy();
    expect(found.senderType).toBe('user');
  });

  test('group chat members include bot with role', async ({ request }) => {
    const res = await request.get(`${API}/group-chats/${groupChatId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const members = body.data.members;
    const bot = members.find((m: { displayName: string }) => m.displayName === 'ResearchBot');
    expect(bot).toBeTruthy();
    expect(bot.role).toBe('Research assistant with web search');
    expect(bot.isHuman).toBe(false);
  });
});

// ─── Regression: Existing Functionality Not Broken ─────────────

test.describe('Regression — Auth & Instance CRUD', () => {
  test('signup still works', async ({ request }) => {
    const email = `regr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
    const res = await request.post(`${API}/auth/test-signup`, {
      data: { email, password: 'TestPass123!', displayName: 'Regression User' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(email);
  });

  test('instance create-get-delete cycle', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);

    // Create
    const name = `regr-inst-${Date.now()}`;
    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    expect(createRes.status()).toBe(201);
    const { data: created } = await createRes.json();
    expect(created.name).toBe(name);

    // Get
    const getRes = await request.get(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.ok()).toBeTruthy();
    const { data: got } = await getRes.json();
    expect(got.name).toBe(name);

    // Delete
    const delRes = await request.delete(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(delRes.ok()).toBeTruthy();

    // Verify deleted
    const check = await request.get(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(check.status()).toBe(404);
  });

  test('non-brave credential CRUD still works', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);
    const instRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `regr-cred-${Date.now()}`, agentType: 'openclaw' },
    });
    const { data: inst } = await instRes.json();

    // Add openai credential
    const addRes = await request.post(`${API}/instances/${inst.id}/credentials`, {
      headers: { Cookie: cookie },
      data: { provider: 'openai', credentialType: 'api_key', value: 'sk-test-regression' },
    });
    expect(addRes.status()).toBe(201);
    const { data: cred } = await addRes.json();

    // List
    const listRes = await request.get(`${API}/instances/${inst.id}/credentials`, {
      headers: { Cookie: cookie },
    });
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].provider).toBe('openai');

    // Delete credential
    const delCredRes = await request.delete(`${API}/instances/${inst.id}/credentials/${cred.id}`, {
      headers: { Cookie: cookie },
    });
    expect(delCredRes.ok()).toBeTruthy();

    // Cleanup instance
    await request.delete(`${API}/instances/${inst.id}`, {
      headers: { Cookie: cookie },
    });
  });
});
