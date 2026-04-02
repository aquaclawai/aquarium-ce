import { test, expect } from '@playwright/test';
import { signupAndGetCookie, API } from './helpers';

test.describe.serial('User Credentials API', () => {
  let cookie: string;
  let credentialId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('list user credentials initially empty', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  test('add user credential', async ({ request }) => {
    const res = await request.post(`${API}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'anthropic',
        credentialType: 'api_key',
        value: 'sk-user-test-cred',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.provider).toBe('anthropic');
    // Store id from response if available
    if (body.data.id) {
      credentialId = body.data.id;
    }
  });

  test('list user credentials shows added', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const anthropic = body.data.find((c: { provider: string }) => c.provider === 'anthropic');
    expect(anthropic).toBeDefined();
    // Fallback: grab id from list if POST didn't return it
    if (!credentialId) {
      credentialId = anthropic.id;
    }
  });

  test('delete user credential', async ({ request }) => {
    expect(credentialId).toBeTruthy();
    const res = await request.delete(`${API}/credentials/${credentialId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('list after delete is empty again', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  test('unauthenticated request rejected', async ({ request }) => {
    const res = await request.get(`${API}/credentials`);
    expect(res.status()).toBe(401);
  });
});
