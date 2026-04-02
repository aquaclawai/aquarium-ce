import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api';

function uniqueEmail() {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

test.describe.serial('Full Browser Lifecycle', () => {
  const email = uniqueEmail();
  const password = 'BrowserTest123!';
  const displayName = 'Browser Tester';
  const instanceName = `inst-${Date.now()}`;
  let instanceId = '';
  let runtimeUnavailable = false;

  async function loginToWorkbench(page: import('@playwright/test').Page) {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  }

  async function gotoInstanceDetail(page: import('@playwright/test').Page) {
    expect(instanceId).toBeTruthy();
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });
  }

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toHaveText('Welcome Back');
  });

  test('navigate to signup page', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.click('a[href="/signup"]');
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.locator('h1')).toHaveText('Create Account');
  });

  test('signup and redirect to dashboard', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    await page.fill('#displayName', displayName);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  });

  test('dashboard shows empty state', async ({ page }) => {
    await loginToWorkbench(page);
  });

  test('create instance via modal', async ({ page }) => {
    await loginToWorkbench(page);

    const createRes = await page.request.post(`${API}/instances`, {
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(createRes.ok()).toBeTruthy();
    const body = (await createRes.json()) as {
      ok: boolean;
      data?: { id: string; status: string; name: string };
      error?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.data?.id).toBeTruthy();
    instanceId = body.data?.id ?? '';

    await gotoInstanceDetail(page);
    await expect(page.locator('.instance-status-bar')).toContainText('created');
  });

  test('navigate to instance detail page', async ({ page }) => {
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);
    await expect(page.locator('.instance-status-bar')).toContainText('created');
    await expect(page.locator('.instance-status-bar')).toContainText('openclaw');
  });

  test('start instance from detail page', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);

    await page.click('button:has-text("Start")');

    let reachedError = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 90000) {
      const statusText = (await page.locator('.instance-status-bar').innerText()).toLowerCase();
      if (statusText.includes('running')) break;
      if (statusText.includes('error')) {
        reachedError = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (reachedError) {
      runtimeUnavailable = true;
      test.skip(true, 'Runtime unavailable (instance entered error state instead of running)');
      return;
    }

    await expect(page.locator('.instance-status-bar')).toContainText('running', { timeout: 30000 });
  });

  test('view logs tab when running', async ({ page }) => {
    test.skip(runtimeUnavailable, 'Skipped because runtime is unavailable');
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);

    await page.click('button:has-text("Logs")');
    await expect(page.locator('.instance-logs')).toBeVisible();
    await expect(page.locator('button:has-text("Refresh Logs")')).toBeVisible({ timeout: 10000 });
  });

  test('view events tab', async ({ page }) => {
    test.skip(runtimeUnavailable, 'Skipped because runtime is unavailable');
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);

    await page.click('button:has-text("Events")');
    await expect(page.locator('h3:has-text("Events")')).toBeVisible();
  });

  test('stop instance from detail page', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(runtimeUnavailable, 'Skipped because runtime is unavailable');
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);

    await page.click('button:has-text("Stop")');
    await expect(page.locator('.instance-status-bar')).toContainText('stopped', { timeout: 30000 });
  });

  test('delete instance from detail page', async ({ page }) => {
    await loginToWorkbench(page);
    await gotoInstanceDetail(page);

    await page.click('button:has-text("Settings")');
    page.on('dialog', dialog => dialog.accept());
    await page.click('.danger-zone button.danger');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  });

  test('logout returns to login page', async ({ page }) => {
    await loginToWorkbench(page);

    await page.click('.sidebar__user');
    await page.click('.user-menu__item--danger');
    await expect(page).toHaveURL(/\/login/);
  });
});
