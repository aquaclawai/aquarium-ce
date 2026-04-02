import { test, expect } from '@playwright/test';
import {
  signupAndGetCookie,
  signupWithFallback,
  signupWithCredentials,
  loginAndGetCookie,
  API,
  BASE,
} from './helpers';

// ============================================================
// API Tests — User Profile Extended Fields
// ============================================================
test.describe.serial('Profile API — Extended User Info', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('PA-A01: /me returns extended fields', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const user = json.data.user;
    expect(user).toHaveProperty('avatarUrl');
    expect(user).toHaveProperty('passwordChangedAt');
    expect(user).toHaveProperty('totpEnabled');
    expect(user).toHaveProperty('role');
  });

  test('PA-A02: new user has correct defaults', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    const user = (await res.json()).data.user;
    expect(user.avatarUrl).toBeNull();
    expect(user.totpEnabled).toBe(false);
    expect(user.role).toBe('user');
  });

  test('PA-A03: unauthenticated rejected', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`);
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Profile Update
// ============================================================
test.describe.serial('Profile API — Update', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('PA-A04: update displayName', async ({ request }) => {
    const res = await request.put(`${API}/auth/profile`, {
      headers: { Cookie: cookie },
      data: { displayName: 'Updated Name' },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    const user = (await getRes.json()).data.user;
    expect(user.displayName).toBe('Updated Name');
  });

  test('PA-A05: empty displayName rejected', async ({ request }) => {
    const res = await request.put(`${API}/auth/profile`, {
      headers: { Cookie: cookie },
      data: { displayName: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('PA-A06: unauthenticated rejected', async ({ request }) => {
    const res = await request.put(`${API}/auth/profile`, {
      data: { displayName: 'Test' },
    });
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Password Change
// ============================================================
test.describe.serial('Profile API — Password Change', () => {
  let email: string;
  let password: string;
  let cookie: string;
  const newPassword = 'NewSecurePass456!';

  test.beforeAll(async ({ request }) => {
    const result = await signupWithCredentials(request);
    email = result.email;
    password = result.password;
    cookie = result.cookie;
  });

  test('PA-A07: successfully change password', async ({ request }) => {
    const res = await request.put(`${API}/auth/password`, {
      headers: { Cookie: cookie },
      data: {
        currentPassword: password,
        newPassword: newPassword,
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('PA-A08: passwordChangedAt updated after change', async ({ request }) => {
    const newCookie = await loginAndGetCookie(request, email, newPassword);
    const res = await request.get(`${API}/auth/me`, {
      headers: { Cookie: newCookie },
    });
    const user = (await res.json()).data.user;
    expect(user.passwordChangedAt).not.toBeNull();
    const changedAt = new Date(user.passwordChangedAt);
    const now = new Date();
    expect(now.getTime() - changedAt.getTime()).toBeLessThan(60000);
  });

  test('PA-A09: old password login blocked', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    expect(res.status()).toBe(401);
  });

  test('PA-A10: new password login works', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password: newPassword },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// API Tests — Password Change Validation
// ============================================================
test.describe.serial('Profile API — Password Validation', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('PA-A11: wrong current password rejected', async ({ request }) => {
    const res = await request.put(`${API}/auth/password`, {
      headers: { Cookie: cookie },
      data: {
        currentPassword: 'WrongPassword123!',
        newPassword: 'ValidNewPass123!',
      },
    });
    expect([400, 401, 429]).toContain(res.status());
  });

  test('PA-A12: unauthenticated rejected', async ({ request }) => {
    const res = await request.put(`${API}/auth/password`, {
      data: {
        currentPassword: 'test',
        newPassword: 'test2',
      },
    });
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Login History
// ============================================================
test.describe.serial('Profile API — Login History', () => {
  let email: string;
  let password: string;
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    const result = await signupWithCredentials(request);
    email = result.email;
    password = result.password;
    cookie = result.cookie;
  });

  test('PA-A13: login history returns array', async ({ request }) => {
    const res = await request.get(`${API}/auth/login-history`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  test('PA-A14: includes signup event', async ({ request }) => {
    const res = await request.get(`${API}/auth/login-history`, {
      headers: { Cookie: cookie },
    });
    const events = (await res.json()).data;
    const hasSignup = events.some(
      (e: { eventType: string }) =>
        e.eventType === 'signup' || e.eventType === 'register'
    );
    expect(hasSignup).toBe(true);
  });

  test('PA-A15: login adds new record', async ({ request }) => {
    const beforeRes = await request.get(`${API}/auth/login-history`, {
      headers: { Cookie: cookie },
    });
    const beforeCount = (await beforeRes.json()).data.length;

    await loginAndGetCookie(request, email, password);

    const afterRes = await request.get(`${API}/auth/login-history`, {
      headers: { Cookie: cookie },
    });
    const afterCount = (await afterRes.json()).data.length;

    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('PA-A16: unauthenticated rejected', async ({ request }) => {
    const res = await request.get(`${API}/auth/login-history`);
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// Browser Tests — Profile Page
// ============================================================
test.describe.serial('Profile Page — Browser', () => {
  const email = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'ProfileTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Profile Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('PA-B01: profile page loads', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await expect(page.locator('.profile-page__avatar')).toBeVisible();
  });

  test('PA-B02: avatar section visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await expect(page.locator('.profile-page__avatar')).toBeVisible();
  });

  test('PA-B03: user info card visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await expect(page.locator('.profile-page__info-grid')).toBeVisible();
  });

  test('PA-B04: edit display name', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await page.waitForLoadState('networkidle');
    const input = page.locator('.profile-page__input').first();
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('Browser Updated Name');
    await page.click('.profile-page__btn--primary:has-text("Update")');
    await page.waitForTimeout(1000);
  });

  test('PA-B05: security settings visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.profile-page__security-row').first()).toBeVisible({ timeout: 5000 });
  });

  test.skip('PA-B06: change password modal opens — skipped: auth managed by Clerk', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await page.click('.profile-page__btn:has-text("Change Password")');
    await expect(page.locator('.profile-page__modal')).toBeVisible();
  });

  test('PA-B09: danger zone visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await expect(page.locator('.profile-page__section--danger')).toBeVisible();
  });

  test('PA-B10: login history button visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    const historyBtn = page.locator('.profile-page__btn:has-text("View History"), .profile-page__btn:has-text("Login History")');
    await expect(historyBtn).toBeVisible();
  });
});

// ============================================================
// Integration Tests — Navigation
// ============================================================
test.describe.serial('Integration — Navigation', () => {
  const email = `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'NavTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Nav Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('INT-01: navigate to credentials page', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/user/credentials`);
    await expect(page).toHaveURL(/\/user\/credentials/);
  });

  test('INT-02: navigate to billing overview', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing`);
    await expect(page).toHaveURL(/\/billing/);
  });

  test('INT-03: navigate to orders page', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/orders`);
    await expect(page).toHaveURL(/\/billing\/orders/);
  });

  test('INT-04: navigate to costs page', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/costs`);
    await expect(page).toHaveURL(/\/billing\/costs/);
  });

  test('INT-05: navigate to profile page', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/profile`);
    await expect(page).toHaveURL(/\/profile/);
  });

  test('INT-06: unauthenticated redirects to login', async ({ page }) => {
    await page.goto(`${BASE}/billing`);
    await expect(page).toHaveURL(/\/login/);
  });
});
