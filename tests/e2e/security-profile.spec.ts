import { test, expect } from '@playwright/test';
import { signupAndGetCookie, API } from './helpers';

const BASE = 'http://localhost:5173';

function uniqueEmail() {
  return `secprof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

test.describe.serial('Wizard Security Step', () => {
  // TODO: Wizard was redesigned from 6 steps to 4 steps. Security step removed.
  // Class .wizard-steps-indicator is now .wiz-stepper. Tests reference old UI.
  const email = uniqueEmail();
  const password = 'SecProf123!';

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/auth/test-signup`, {
      data: { email, password, displayName: 'Security Tester' },
    });
    expect(res.ok()).toBeTruthy();
  });

  async function login(page: import('@playwright/test').Page) {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  }

  /** Navigate the wizard from step 1 to the security step. */
  async function navigateToSecurityStep(page: import('@playwright/test').Page) {
    await page.goto(`${BASE}/create`);
    // Step 1: select agent type (required before Next is enabled)
    const agentCard = page.locator('.wizard-provider-card').first();
    await expect(agentCard).toBeVisible({ timeout: 10000 });
    await agentCard.click();

    const nextBtn = page.locator('button', { hasText: /^Next$/ });
    // Step 1 → 2 (provider — platform AI auto-selected)
    await nextBtn.click();
    // Step 2 → 3 (model — auto-selected for platform billing)
    await nextBtn.click();
    // Step 3 → 4 (channels — always can proceed)
    await nextBtn.click();
    // Step 4 → 5 (security)
    await nextBtn.click();

    const activeStep = page.locator('.wizard-steps-indicator li.active');
    await expect(activeStep).toContainText('Security');
  }

  test.skip('wizard shows security step in step indicator', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/create`);
    await expect(page.locator('.wizard-steps-indicator')).toContainText('Security');
  });

  test.skip('security step shows profile cards', async ({ page }) => {
    await login(page);
    await navigateToSecurityStep(page);

    const cards = page.locator('.wizard-provider-card');
    await expect(cards).toHaveCount(4);

    const selectedCard = page.locator('.wizard-provider-card.selected');
    await expect(selectedCard).toContainText('Standard');
  });

  test.skip('clicking a profile card selects it', async ({ page }) => {
    await login(page);
    await navigateToSecurityStep(page);

    await page.locator('.wizard-provider-card').filter({ has: page.locator('strong', { hasText: /^Strict$/ }) }).click();
    const selectedCard = page.locator('.wizard-provider-card.selected');
    await expect(selectedCard).toContainText('Strict');
  });

  test.skip('selected profile shows in review step', async ({ page }) => {
    await login(page);
    await navigateToSecurityStep(page);

    await page.locator('.wizard-provider-card', { hasText: 'Developer' }).click();

    const nextBtn = page.locator('button', { hasText: /^Next$/ });
    // Security → Name
    await nextBtn.click();
    await page.fill('input[type="text"]', `review-test-${Date.now()}`);
    // Name → Review
    await nextBtn.click();

    const reviewTable = page.locator('table');
    await expect(reviewTable).toContainText('Security Profile');
    await expect(reviewTable).toContainText('Developer');
  });
});

test.describe.serial('Instance Page Security Badge', () => {
  let authCookie: string;
  let instanceId: string;
  const email = uniqueEmail();
  const password = 'BadgeTest123!';
  const instanceName = `badge-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const signupRes = await request.post(`${API}/auth/test-signup`, {
      data: { email, password, displayName: 'Badge Tester' },
    });
    expect(signupRes.ok()).toBeTruthy();
    const setCookie = signupRes.headers()['set-cookie'];
    const match = setCookie.match(/token=([^;]+)/);
    authCookie = match![1];

    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: `token=${authCookie}` },
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(createRes.status()).toBe(201);
    const body = await createRes.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: `token=${authCookie}` },
    }).catch(() => {});
  });

  async function injectAuthCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([{
      name: 'token',
      value: authCookie,
      domain: 'localhost',
      path: '/',
    }]);
  }

  test('instance page shows security profile badge', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    const overviewTable = page.locator('.models-table');
    await expect(overviewTable).toContainText('Security Profile');
    await expect(overviewTable).toContainText('Standard');
  });

  test('clicking Change shows security profile dropdown', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await page.locator('button', { hasText: 'Change' }).click();

    await expect(page.locator('.models-table select')).toBeVisible();
    await expect(page.locator('.models-table select')).toHaveValue('standard');
  });

  test('changing and saving security profile updates badge', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await page.locator('button', { hasText: 'Change' }).click();
    await page.locator('.models-table select').selectOption('strict');
    await page.locator('button', { hasText: 'OK' }).click();

    await expect(page.locator('.models-table select')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.models-table')).toContainText('Strict');
  });

  test('security profile persists after page reload', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await expect(page.locator('.models-table')).toContainText('Strict');
  });
});
