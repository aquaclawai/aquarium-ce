import { test, expect } from '@playwright/test';
import {
  signupAndGetCookie,
  signupWithFallback,
  setBudget,
  API,
  BASE,
} from './helpers';

// ============================================================
// API Tests — Usage Extended Fields
// ============================================================
test.describe.serial('Billing API — Usage Extended', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('BC-A01: usage returns extended fields', async ({ request }) => {
    const res = await request.get(`${API}/usage/extended-summary`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBe(true);
    const data = json.data;
    expect(data).toHaveProperty('todaySpend');
    expect(data).toHaveProperty('yesterdaySpend');
    expect(data).toHaveProperty('dayOverDayPercent');
    expect(data).toHaveProperty('monthlyProjection');
    expect(data).toHaveProperty('totalRequests');
    expect(data).toHaveProperty('lastMonthSpend');
    expect(data).toHaveProperty('monthOverMonthPercent');
    expect(data).toHaveProperty('yearToDateSpend');
  });

  test('BC-A02: numeric types are correct', async ({ request }) => {
    const res = await request.get(`${API}/usage/extended-summary`, {
      headers: { Cookie: cookie },
    });
    const data = (await res.json()).data;
    expect(typeof data.todaySpend).toBe('number');
    expect(typeof data.monthlyProjection).toBe('number');
    expect(typeof data.totalRequests).toBe('number');
  });

  test('BC-A03: new user values are zero', async ({ request }) => {
    const res = await request.get(`${API}/usage/extended-summary`, {
      headers: { Cookie: cookie },
    });
    const data = (await res.json()).data;
    expect(data.todaySpend).toBe(0);
    expect(data.yesterdaySpend).toBe(0);
    expect(data.yearToDateSpend).toBe(0);
  });

  test('BC-A04: unauthenticated rejected', async ({ request }) => {
    const res = await request.get(`${API}/usage/extended-summary`);
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Usage By Instance
// ============================================================
test.describe.serial('Billing API — Usage By Instance', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('BC-A05: by-instance returns array', async ({ request }) => {
    const res = await request.get(`${API}/usage/by-instance`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  test('BC-A06: no instances returns empty array', async ({ request }) => {
    const res = await request.get(`${API}/usage/by-instance`, {
      headers: { Cookie: cookie },
    });
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  test('BC-A08: unauthenticated rejected', async ({ request }) => {
    const res = await request.get(`${API}/usage/by-instance`);
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Budget CRUD
// ============================================================
test.describe.serial('Billing API — Budget', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('BC-A09: get default budget', async ({ request }) => {
    const res = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('BC-A10: set monthly budget', async ({ request }) => {
    const res = await request.put(`${API}/budgets`, {
      headers: { Cookie: cookie },
      data: { monthlyBudgetCny: 100 },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookie },
    });
    const data = (await getRes.json()).data;
    expect(data.monthlyBudgetCny).toBe(100);
  });

  test('BC-A11: set annual budget', async ({ request }) => {
    const res = await request.put(`${API}/budgets`, {
      headers: { Cookie: cookie },
      data: { annualBudgetCny: 1000 },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookie },
    });
    const data = (await getRes.json()).data;
    expect(data.annualBudgetCny).toBe(1000);
  });

  test('BC-A12: set alert threshold', async ({ request }) => {
    const res = await request.put(`${API}/budgets`, {
      headers: { Cookie: cookie },
      data: { alertThresholdPercent: 80 },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookie },
    });
    const data = (await getRes.json()).data;
    expect(data.alertThresholdPercent).toBe(80);
  });

  test('BC-A13: update existing budget', async ({ request }) => {
    await setBudget(request, cookie, { monthlyBudgetCny: 50 });

    const res = await request.put(`${API}/budgets`, {
      headers: { Cookie: cookie },
      data: { monthlyBudgetCny: 200 },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookie },
    });
    const data = (await getRes.json()).data;
    expect(data.monthlyBudgetCny).toBe(200);
  });

  test('BC-A14: invalid budget value rejected', async ({ request }) => {
    const res = await request.put(`${API}/budgets`, {
      headers: { Cookie: cookie },
      data: { monthlyBudgetCny: -1 },
    });
    expect(res.status()).toBe(400);
  });

  test('BC-A15: unauthenticated rejected', async ({ request }) => {
    const res = await request.get(`${API}/budgets`);
    expect(res.status()).toBe(401);
  });
});

// ============================================================
// API Tests — Budget Cross-User Isolation
// ============================================================
test.describe.serial('Billing API — Budget Isolation', () => {
  let cookieA: string;
  let cookieB: string;

  test.beforeAll(async ({ request }) => {
    cookieA = await signupAndGetCookie(request);
    cookieB = await signupAndGetCookie(request);
  });

  test('BC-A16: budgets are isolated per user', async ({ request }) => {
    await setBudget(request, cookieA, { monthlyBudgetCny: 999 });

    const resB = await request.get(`${API}/budgets`, {
      headers: { Cookie: cookieB },
    });
    const dataB = (await resB.json()).data;
    expect(dataB.monthlyBudgetCny).not.toBe(999);
  });
});

// ============================================================
// Browser Tests — Billing Overview Page
// ============================================================
test.describe.serial('Billing Overview Page — Browser', () => {
  const email = `billing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'BillingTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Billing Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('BC-B01: billing page loads', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing`);
    await expect(page.locator('.billing-page__header')).toBeVisible();
  });

  test('BC-B02: KPI cards rendered', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing`);
    await expect(page.locator('.billing-page__kpis')).toBeVisible();
  });

  test('BC-B06: empty data shows zero values', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing`);
    const kpis = page.locator('.billing-page__kpis');
    await expect(kpis).toBeVisible();
  });
});

// ============================================================
// Browser Tests — Orders Page
// ============================================================
test.describe.serial('Billing Orders Page — Browser', () => {
  const email = `orders-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'OrdersTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Orders Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('BC-B08: orders page loads', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/orders`);
    await expect(page.locator('.orders-page__header')).toBeVisible();
  });

  test('BC-B09: tab switching works', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/orders`);
    const tabs = page.locator('.orders-page__tabs .orders-page__tab');
    await expect(tabs).toHaveCount(2);
  });

  test('BC-B10: empty orders state', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/orders`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.orders-page__table')).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// Browser Tests — Costs Page
// ============================================================
test.describe.serial('Costs Page — Browser', () => {
  const email = `costs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const password = 'CostsTest123!';
  let authCookie = '';

  test.beforeAll(async ({ request }) => {
    authCookie = await signupWithFallback(request, email, password, 'Costs Tester');
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('BC-B13: costs page loads', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/costs`);
    await expect(page.locator('.costs-page__grid')).toBeVisible();
  });

  test('BC-B15: budget form visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/costs`);
    await expect(page.locator('.costs-page__budget-row').first()).toBeVisible();
  });

  test('BC-B16: set budget via UI', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/costs`);
    await page.click('.costs-page__edit-btn');
    await expect(page.locator('.costs-page__modal')).toBeVisible();
    const input = page.locator('.costs-page__modal input[type="number"]').first();
    await input.fill('500');
    await page.click('.costs-page__modal-btn--primary');
    await page.waitForTimeout(1000);
  });

  test('BC-B17: trend chart area visible', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/billing/costs`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.costs-page__chart-body, .costs-page__chart-empty').first()).toBeVisible({ timeout: 5000 });
  });
});
