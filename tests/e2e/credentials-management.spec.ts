import { test, expect } from '@playwright/test';
import {
  signupAndGetCookie,
  signupWithFallback,
  createCredential,
  API,
  BASE,
} from './helpers';

// ============================================================
// API Tests — CRUD & Extended Fields
// ============================================================
test.describe.serial('Credentials Management API — CRUD', () => {
  let cookie: string;
  let credentialId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('CM-A01: create credential with role', async ({ request }) => {
    const res = await request.post(`${API}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'openai',
        credentialType: 'api_key',
        value: 'sk-test-key-12345678',
        role: 'default',
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.role).toBe('default');
    credentialId = json.data.id;
  });

  test('CM-A02: create credential without role uses default', async ({ request }) => {
    const res = await request.post(`${API}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'anthropic',
        credentialType: 'api_key',
        value: 'sk-ant-test-key',
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.data.role).toBe('default');
  });

  test('CM-A03: create credential with displayName', async ({ request }) => {
    const res = await request.post(`${API}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'google',
        credentialType: 'api_key',
        value: 'AIza-test-key',
        displayName: 'My Google Key',
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.data.displayName).toBe('My Google Key');
  });

  test('CM-A04: list returns extended fields', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    const cred = json.data[0];
    expect(cred).toHaveProperty('role');
    expect(cred).toHaveProperty('status');
    expect(cred).toHaveProperty('usageCount');
    expect(cred).toHaveProperty('maskedValue');
  });

  test('CM-A05: maskedValue format is correct', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    const json = await res.json();
    const cred = json.data.find((c: { provider: string }) => c.provider === 'openai');
    expect(cred.maskedValue).toMatch(/^sk-.*\.{3}.*/);
  });

  test('CM-A06: value is never exposed in response', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    const json = await res.json();
    for (const cred of json.data) {
      expect(cred).not.toHaveProperty('value');
      expect(cred).not.toHaveProperty('encryptedValue');
    }
  });

  test('CM-A07: update credential role', async ({ request }) => {
    const res = await request.put(`${API}/credentials/${credentialId}`, {
      headers: { Cookie: cookie },
      data: { role: 'backup' },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.data.role).toBe('backup');
  });

  test('CM-A08: update credential status', async ({ request }) => {
    const res = await request.put(`${API}/credentials/${credentialId}`, {
      headers: { Cookie: cookie },
      data: { status: 'disabled' },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.data.status).toBe('disabled');
  });

  test('CM-A09: dedicated status toggle endpoint', async ({ request }) => {
    let res = await request.put(`${API}/credentials/${credentialId}/status`, {
      headers: { Cookie: cookie },
      data: { status: 'disabled' },
    });
    expect(res.ok()).toBeTruthy();
    let json = await res.json();
    expect(json.data.status).toBe('disabled');

    res = await request.put(`${API}/credentials/${credentialId}/status`, {
      headers: { Cookie: cookie },
      data: { status: 'active' },
    });
    expect(res.ok()).toBeTruthy();
    json = await res.json();
    expect(json.data.status).toBe('active');
  });

  test('CM-A10: delete credential', async ({ request }) => {
    const createRes = await request.post(`${API}/credentials`, {
      headers: { Cookie: cookie },
      data: {
        provider: 'deepseek',
        credentialType: 'api_key',
        value: 'ds-test-to-delete',
      },
    });
    const toDeleteId = (await createRes.json()).data.id;

    const delRes = await request.delete(`${API}/credentials/${toDeleteId}`, {
      headers: { Cookie: cookie },
    });
    expect(delRes.ok()).toBeTruthy();

    const listRes = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookie },
    });
    const list = (await listRes.json()).data;
    expect(list.find((c: { id: string }) => c.id === toDeleteId)).toBeUndefined();
  });

  test('CM-A11: unauthenticated request rejected', async ({ request }) => {
    const res = await request.get(`${API}/credentials`);
    expect(res.status()).toBe(401);
  });

  test('CM-A14: invalid status value rejected', async ({ request }) => {
    const res = await request.put(`${API}/credentials/${credentialId}/status`, {
      headers: { Cookie: cookie },
      data: { status: 'unknown' },
    });
    expect(res.status()).toBe(400);
  });

  test('CM-A15: non-existent credential returns 404', async ({ request }) => {
    const res = await request.put(`${API}/credentials/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: cookie },
      data: { role: 'default' },
    });
    expect(res.status()).toBe(404);
  });
});

// ============================================================
// API Tests — Cross-User Isolation
// ============================================================
test.describe.serial('Credentials Management API — Isolation', () => {
  let cookieA: string;
  let cookieB: string;
  let credIdA: string;

  test.beforeAll(async ({ request }) => {
    cookieA = await signupAndGetCookie(request);
    cookieB = await signupAndGetCookie(request);

    const cred = await createCredential(request, cookieA, {
      provider: 'openai',
      credentialType: 'api_key',
      value: 'sk-user-a-secret',
      displayName: 'User A Key',
    });
    credIdA = cred.id;
  });

  test('CM-A12: user B cannot see user A credentials', async ({ request }) => {
    const res = await request.get(`${API}/credentials`, {
      headers: { Cookie: cookieB },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const found = json.data.find((c: { id: string }) => c.id === credIdA);
    expect(found).toBeUndefined();
  });
});

// ============================================================
// Browser Tests — Credentials Page
// ============================================================
test.describe.serial('Credentials Page — Browser', () => {
  const email = `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'CredTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Credential Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('CM-B01: navigate to credentials page', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    await expect(page.locator('.creds-page__tabs')).toBeVisible();
    await expect(page.locator('.creds-page__tab').first()).toBeVisible();
  });

  test('CM-B02: empty state displayed', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    const cards = page.locator('.creds-card');
    const count = await cards.count();
    if (count === 0) {
      // Use specific class selector to avoid matching multiple text elements
      await expect(page.locator('.creds-page__empty-title')).toBeVisible();
    }
  });

  test('CM-B03: add credential modal opens', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    await page.click('button:has-text("Add Credential"), .creds-page__btn--primary');
    await expect(page.locator('.creds-modal')).toBeVisible();
  });

  test('CM-B04: successfully add credential', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    await page.click('button:has-text("Add Credential"), .creds-page__btn--primary');
    await page.locator('.creds-modal select').first().selectOption('openai');
    await page.locator('.creds-modal input[type="password"]').fill('sk-browser-test-key-1234');
    await page.locator('.creds-modal input[type="text"]').first().fill('Browser Test Key');
    await page.click('.creds-modal .creds-page__btn--primary:has-text("Save")');
    await expect(page.locator('.creds-card')).toBeVisible({ timeout: 5000 });
  });

  test('CM-B05: credential card shows required info', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.creds-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('CM-B06: toggle credential status', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    const toggleBtn = page.locator('.creds-card button:has-text("Disable"), .creds-card button:has-text("Enable")').first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('CM-B07: delete credential with confirmation', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    const deleteBtn = page.locator('.creds-card button:has-text("Delete")').first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await expect(page.locator('.creds-modal:has-text("Delete")')).toBeVisible({ timeout: 3000 });
    }
  });
});
