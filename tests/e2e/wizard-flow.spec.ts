import { test, expect } from '@playwright/test';
import { signupAndGetCookie, API } from './helpers';

test.describe.serial('Wizard Full Flow API', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await request.delete(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
  });

  test('create instance with provider config', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `wizard-${Date.now()}`,
        agentType: 'openclaw',
        config: {
          defaultProvider: 'anthropic',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceId = body.data.id;
    expect(instanceId).toBeTruthy();
  });

  test('store credential for provider', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'anthropic',
        credentialType: 'api_key',
        value: 'sk-ant-test-wizard',
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('get instance shows config', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.config.defaultProvider).toBe('anthropic');
  });

  test('delete instance cleans up', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    // Clear so afterAll doesn't try to delete again
    instanceId = '';
  });
});

test.describe.serial('Wizard with Different Providers', () => {
  let cookie: string;
  const instanceIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    for (const id of instanceIds) {
      await request.delete(`${API}/instances/${id}`, {
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
  });

  test('create with openai provider', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `wizard-openai-${Date.now()}`,
        agentType: 'openclaw',
        config: {
          defaultProvider: 'openai',
          defaultModel: 'gpt-4o',
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceIds.push(body.data.id);
  });

  test('create with google provider', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `wizard-google-${Date.now()}`,
        agentType: 'openclaw',
        config: {
          defaultProvider: 'google',
          defaultModel: 'gemini-2.0-flash',
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceIds.push(body.data.id);
  });
});

test.describe.serial('Wizard Backward Compat - No Config', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await request.delete(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
  });

  test('create instance without config still works', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `wizard-noconfig-${Date.now()}`,
        agentType: 'openclaw',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceId = body.data.id;
  });
});
