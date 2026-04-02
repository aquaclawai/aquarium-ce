import { test, expect } from '@playwright/test';
import { signupAndGetCookie, API } from './helpers';

test.describe.serial('Usage API', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('GET /api/usage returns spend data for authenticated user', async ({ request }) => {
    const res = await request.get(`${API}/usage`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(typeof body.data.totalSpendUsd).toBe('number');
    expect(body.data.spendByModel).toBeDefined();
  });

  test('GET /api/usage returns 401 for unauthenticated request', async ({ request }) => {
    const res = await request.get(`${API}/usage`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('GET /api/usage/timeseries returns array for authenticated user', async ({ request }) => {
    const res = await request.get(`${API}/usage/timeseries`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/usage/instances/:id returns 403 for non-owned instance', async ({ request }) => {
    // Use a fake UUID that doesn't belong to the user
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.get(`${API}/usage/instances/${fakeId}`, {
      headers: { Cookie: cookie },
    });
    // getInstance returns null for non-existent/non-owned → 403
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('GET /api/usage/admin returns 403 for non-admin user', async ({ request }) => {
    const res = await request.get(`${API}/usage/admin`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
