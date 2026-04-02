import { test, expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api';

function uniqueEmail() {
  return `proxy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email: uniqueEmail(), password: 'TestPass123!', displayName: 'Proxy E2E' },
  });
  const setCookie = res.headers()['set-cookie'];
  const match = setCookie?.match(/token=([^;]+)/);
  return `token=${match![1]}`;
}

async function createInstance(request: APIRequestContext, cookie: string): Promise<string> {
  const res = await request.post(`${API}/instances`, {
    headers: { Cookie: cookie },
    data: { name: `proxy-test-${Date.now()}`, agentType: 'openclaw' },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

test.describe('Proxy route', () => {
  test.describe.configure({ mode: 'serial' });

  let cookie1: string;
  let cookie2: string;
  let instanceId: string;

  test('setup: create two users and one instance', async ({ request }) => {
    cookie1 = await signupAndGetCookie(request);
    cookie2 = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie1);
    expect(instanceId).toBeTruthy();
  });

  test('PROXY-04: different user gets 403 on proxy endpoint', async ({ request }) => {
    // Instance belongs to user1 but user2 tries to access it
    const res = await request.get(`${API}/instances/${instanceId}/proxy/`, {
      headers: { Cookie: cookie2 },
    });
    expect(res.status()).toBe(403);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test('PROXY-02: same user gets 409 when instance is not running', async ({ request }) => {
    // Instance exists but is not running (just created = 'created' status)
    const res = await request.get(`${API}/instances/${instanceId}/proxy/`, {
      headers: { Cookie: cookie1 },
    });
    expect(res.status()).toBe(409);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not running');
  });

  test('unauthenticated request returns 401', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/proxy/`);
    expect(res.status()).toBe(401);
  });
});
