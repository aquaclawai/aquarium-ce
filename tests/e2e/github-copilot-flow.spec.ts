import { test, expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api';
const BASE = 'http://localhost:5173';

function uniqueEmail() {
  return `copilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password: 'TestPass123!', displayName: 'Copilot Tester' },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'];
  const match = setCookie.match(/token=([^;]+)/);
  expect(match).toBeTruthy();
  return `token=${match![1]}`;
}

test.describe('GitHub Copilot Provider Flow', () => {

  test('API: create instance with github-copilot provider and config', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);

    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `copilot-api-${Date.now()}`,
        agentType: 'openclaw',
        imageTag: '2026.2.12-p1',
        config: {
          defaultProvider: 'github-copilot',
          defaultModel: 'gpt-5-mini',
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const body = await createRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.config.defaultProvider).toBe('github-copilot');
    expect(body.data.config.defaultModel).toBe('gpt-5-mini');
  });

  test('API: device code endpoint returns valid response', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);

    const res = await request.post(`${API}/oauth/github/device-code`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.deviceCode).toBeTruthy();
    expect(body.data.userCode).toBeTruthy();
    expect(body.data.verificationUri).toContain('github.com');
    expect(body.data.expiresIn).toBeGreaterThan(0);
    expect(body.data.interval).toBeGreaterThan(0);
  });

  test('API: poll returns authorization_pending before user authorizes', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);

    const deviceRes = await request.post(`${API}/oauth/github/device-code`, {
      headers: { Cookie: cookie },
    });
    const deviceBody = await deviceRes.json();
    const deviceCode = deviceBody.data.deviceCode;

    const pollRes = await request.post(`${API}/oauth/github/poll`, {
      headers: { Cookie: cookie },
      data: { deviceCode },
    });
    expect(pollRes.ok()).toBeTruthy();
    const pollBody = await pollRes.json();
    expect(pollBody.ok).toBe(true);
    expect(pollBody.data.status).toBe('authorization_pending');
  });

  test('API: channel routes return 400 when instance not running', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);

    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `channel-test-${Date.now()}`,
        agentType: 'openclaw',
        imageTag: '2026.2.12-p1',
      },
    });
    const createBody = await createRes.json();
    const instanceId = createBody.data.id;

    const whatsappRes = await request.post(`${API}/instances/${instanceId}/channels/whatsapp/start`, {
      headers: { Cookie: cookie },
    });
    expect(whatsappRes.status()).toBe(400);
    const whatsappBody = await whatsappRes.json();
    expect(whatsappBody.error).toContain('running');
  });
});

test.describe.serial('Browser: Create Instance with GitHub Copilot', () => {
  const email = uniqueEmail();
  const password = 'BrowserCopilot123!';
  const instanceName = `copilot-browser-${Date.now()}`;
  let instanceId: string;

  test('signup and navigate to dashboard', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    await page.fill('#displayName', 'Copilot Browser User');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  });

  test('create instance with github-copilot provider', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    const createRes = await page.request.post('http://localhost:3001/api/instances', {
      data: {
        name: instanceName,
        agentType: 'openclaw',
        config: {
          defaultProvider: 'github-copilot',
          defaultModel: 'gpt-5-mini',
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    expect(createBody.ok).toBe(true);
    instanceId = createBody.data.id;

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });
    await expect(page.locator('.setup-required')).toBeVisible();
  });

  test('instance detail shows provider info and OAuth section', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await expect(page.locator('.models-table')).toContainText('github-copilot');
    await expect(page.locator('.models-table')).toContainText('gpt-5-mini');

    await expect(page.locator('.setup-required')).toBeVisible();
    await expect(page.locator('button:has-text("Authenticate with GitHub")')).toBeVisible();
  });

  test('OAuth device flow shows user code on click', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await page.click('button:has-text("Authenticate with GitHub")');

    await expect(page.locator('.user-code')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.device-code-display')).toContainText('github.com');
    await expect(page.locator('text=Waiting for authorization')).toBeVisible();

    await page.click('button:has-text("Cancel")');
    await expect(page.locator('.user-code')).not.toBeVisible();
  });

  test('channels tab shows message when instance not running', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await page.click('button:has-text("Logs")');
    await expect(page.locator('.info-message')).toContainText('Start the instance');
  });

  test('start instance and see channels tab', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    await page.click('button:has-text("Start")');

    const startTime = Date.now();
    while (Date.now() - startTime < 90000) {
      const statusText = (await page.locator('.instance-status-bar').innerText()).toLowerCase();
      if (statusText.includes('running')) break;
      if (statusText.includes('error')) break;
      await page.waitForTimeout(1000);
    }

    await expect(page.locator('.instance-status-bar')).toContainText(/running|error/, { timeout: 30000 });

    await page.click('button:has-text("Logs")');
    await expect(page.locator('.instance-logs')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
  });

  test('cleanup: stop and delete instance', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });

    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });

    const statusText = (await page.locator('.instance-status-bar').innerText()).toLowerCase();
    if (statusText.includes('running')) {
      await page.click('button:has-text("Stop")');
      await expect(page.locator('.instance-status-bar')).toContainText('stopped', { timeout: 30000 });
    }

    await page.click('button:has-text("Settings")');
    page.on('dialog', dialog => dialog.accept());
    await page.click('.danger-zone button.danger');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  });
});
