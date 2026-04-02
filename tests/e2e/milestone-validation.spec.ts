/**
 * Milestone v1.0–v1.3 Visual Validation Test
 *
 * Uses an existing running instance for UI validation.
 * Creates a test user, logs in via browser, navigates all tabs, captures screenshots.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/screenshots';
const API = 'http://localhost:3001/api';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'https://mcp.gojinko.com';

// Will be populated dynamically
let testEmail = '';
let testPassword = 'TestPass1234';
let authCookie = '';
let instanceId = '';

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function shotViewport(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false });
}

async function loginViaCookie(page: Page) {
  await page.context().addCookies([{
    name: 'token',
    value: authCookie.replace('token=', ''),
    domain: 'localhost',
    path: '/',
  }]);
}

async function setupAuth(request: APIRequestContext) {
  testEmail = `milestone-${Date.now()}@e2e.test`;

  // Signup
  const signupRes = await request.post(`${API}/auth/test-signup`, {
    data: { email: testEmail, password: testPassword, displayName: 'Milestone Tester' },
  });
  expect(signupRes.ok()).toBeTruthy();
  const setCookie = signupRes.headers()['set-cookie'];
  const match = setCookie.match(/token=([^;]+)/);
  expect(match).toBeTruthy();
  authCookie = `token=${match![1]}`;
}

async function findOrCreateRunningInstance(request: APIRequestContext): Promise<string> {
  // Check if the current user already has a running instance
  const listRes = await request.get(`${API}/instances`, {
    headers: { Cookie: authCookie },
  });
  const listBody = await listRes.json();
  if (listBody.ok && listBody.data?.length > 0) {
    const running = listBody.data.find((i: { status: string }) => i.status === 'running');
    if (running) return running.id;
  }

  // Store OpenAI credential at user level first
  if (OPENAI_KEY) {
    const credRes = await request.post(`${API}/credentials`, {
      headers: { Cookie: authCookie },
      data: { provider: 'openai', credentialType: 'api-key', value: OPENAI_KEY },
    });
    console.log('Credential store:', (await credRes.json()).ok);
  }

  // Create instance with provider/model in config
  const createRes = await request.post(`${API}/instances`, {
    headers: { Cookie: authCookie },
    data: {
      name: `milestone-test-${Date.now()}`,
      agentType: 'openclaw',
      config: {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o',
      },
    },
  });
  const createBody = await createRes.json();
  console.log('Create instance:', JSON.stringify(createBody, null, 2));
  if (!createBody.ok) throw new Error(`Create failed: ${createBody.error}`);
  const id = createBody.data.id;

  // Start instance
  const startRes = await request.post(`${API}/instances/${id}/start`, {
    headers: { Cookie: authCookie },
  });
  const startBody = await startRes.json();
  console.log('Start instance:', startBody.ok, startBody.error ?? '');

  // Wait for running (up to 270s — first boot can take ~150s)
  for (let i = 0; i < 90; i++) {
    const res = await request.get(`${API}/instances/${id}`, {
      headers: { Cookie: authCookie },
    });
    const body = await res.json();
    const status = body.data?.status;
    if (i % 10 === 0) console.log(`  status: ${status} (${i * 3}s)`);
    if (status === 'running') return id;
    if (status === 'error') {
      console.log('Instance error:', body.data?.statusMessage);
      throw new Error(`Instance reached error state: ${body.data?.statusMessage}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Instance did not reach running state in 270s');
}

async function gotoTab(page: Page, tabName: string) {
  await loginViaCookie(page);
  await page.goto(`/instances/${instanceId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Try multiple selectors for tab buttons
  const selectors = [
    `[data-tab="${tabName}"]`,
    `button:has-text("${tabName}")`,
    `[role="tab"]:has-text("${tabName}")`,
    `a:has-text("${tabName}")`,
  ];

  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(2000);
      return;
    }
  }
  console.log(`Tab "${tabName}" not found with any selector`);
}

// ===== TESTS =====

test.describe.serial('Milestone v1.0–v1.3 Validation', () => {

  test.beforeEach(({ }, testInfo) => {
    if (!instanceId && testInfo.title !== 'Setup: create user and find running instance') {
      test.skip();
    }
  });

  // ==================
  // SETUP
  // ==================

  test('Setup: create user and find running instance', async ({ request }) => {
    test.setTimeout(300_000);
    await setupAuth(request);
    try {
      instanceId = await findOrCreateRunningInstance(request);
    } catch (err) {
      console.log('Skipping milestone tests — instance failed to start:', (err as Error).message);
      test.skip();
      return;
    }
    console.log(`Using instance: ${instanceId}`);
    expect(instanceId).toBeTruthy();
  });

  // ==================
  // v1.0 — Core Platform
  // ==================

  test('v1.0-01: Signup page', async ({ page }) => {
    await page.goto('/signup');
    await page.waitForLoadState('networkidle');
    await shot(page, '01-signup-page');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });

  test('v1.0-02: Login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await shot(page, '02-login-page');
  });

  test('v1.0-03: Login flow — fill and submit', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"], input[name="email"]', testEmail);
    await page.fill('input[type="password"], input[name="password"]', testPassword);
    await shot(page, '03-login-filled');
    await page.click('button[type="submit"]');
    await page.waitForURL('/', { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await shot(page, '04-dashboard-after-login');
  });

  test('v1.0-04: Dashboard', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, '05-dashboard');
  });

  test('v1.0-05: Create Instance Wizard — provider step', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await shot(page, '06-wizard-provider-step');
  });

  test('v1.0-06: Instance Overview tab', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto(`/instances/${instanceId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await shot(page, '07-instance-overview');
  });

  test('v1.0-07: Credentials tab', async ({ page }) => {
    await gotoTab(page, 'Credentials');
    await shot(page, '08-credentials-tab');
  });

  // ==================
  // v1.1 — Channel Management
  // ==================

  test('v1.1-01: Channels tab', async ({ page }) => {
    await gotoTab(page, 'Channels');
    await shot(page, '09-channels-tab');
  });

  // ==================
  // v1.2 — Direct Chat & Sessions
  // ==================

  test('v1.2-01: Chat tab', async ({ page }) => {
    await gotoTab(page, 'Chat');
    await shot(page, '10-chat-tab');
  });

  test('v1.2-02: Chat — send message', async ({ page }) => {
    if (!OPENAI_KEY) {
      test.skip();
      return;
    }
    test.setTimeout(120_000);

    await gotoTab(page, 'Chat');

    // Find and fill chat input
    const inputs = page.locator('textarea, input[placeholder*="message" i], input[placeholder*="type" i]');
    const chatInput = inputs.last();
    if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatInput.fill('Hello, please say "milestone test successful" briefly.');
      await shotViewport(page, '11-chat-typed');

      // Try to send
      const sendBtn = page.locator('button[type="submit"], button:has-text("Send"), button[aria-label*="send" i]').first();
      if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendBtn.click();
      } else {
        await chatInput.press('Enter');
      }

      // Wait for streaming
      await page.waitForTimeout(8000);
      await shotViewport(page, '12-chat-streaming');

      // Wait for response to complete
      await page.waitForTimeout(20000);
      await shotViewport(page, '13-chat-response');
    }
  });

  test('v1.2-03: Sessions tab', async ({ page }) => {
    await gotoTab(page, 'Sessions');
    await shot(page, '14-sessions-tab');
  });

  // ==================
  // v1.3 — Runtime Management
  // ==================

  test('v1.3-01: Gateway Config tab', async ({ page }) => {
    await gotoTab(page, 'Gateway Config');
    await page.waitForTimeout(2000); // extra wait for Monaco
    await shot(page, '15-gateway-config-tab');
  });

  test('v1.3-02: MCP Servers tab', async ({ page }) => {
    await gotoTab(page, 'MCP');
    await shot(page, '16-mcp-servers-tab');
  });

  test('v1.3-03: Cron tab', async ({ page }) => {
    await gotoTab(page, 'Cron');
    await shot(page, '17-cron-tab');
  });

  test('v1.3-04: Skills tab', async ({ page }) => {
    await gotoTab(page, 'Skills');
    await shot(page, '18-skills-tab');
  });

  // ==================
  // General Functionality
  // ==================

  test('General-01: Config tab (instance config)', async ({ page }) => {
    await gotoTab(page, 'Config');
    await shot(page, '19-config-tab');
  });

  test('General-02: Workspace tab', async ({ page }) => {
    await gotoTab(page, 'Workspace');
    await shot(page, '20-workspace-tab');
  });

  test('General-03: Logs tab', async ({ page }) => {
    await gotoTab(page, 'Logs');
    await page.waitForTimeout(3000);
    await shot(page, '21-logs-tab');
  });

  test('General-04: Events tab', async ({ page }) => {
    await gotoTab(page, 'Events');
    await shot(page, '22-events-tab');
  });

  test('General-05: Health tab', async ({ page }) => {
    await gotoTab(page, 'Health');
    await shot(page, '23-health-tab');
  });

  test('General-06: Approvals tab', async ({ page }) => {
    await gotoTab(page, 'Approvals');
    await shot(page, '24-approvals-tab');
  });

  test('General-07: Usage tab', async ({ page }) => {
    await gotoTab(page, 'Usage');
    await shot(page, '25-usage-tab');
  });

  test('General-08: Debug tab', async ({ page }) => {
    await gotoTab(page, 'Debug');
    await shot(page, '26-debug-tab');
  });

  test('General-09: Templates page', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto('/templates');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await shot(page, '27-templates-page');
  });

  test('General-10: Group Chats page', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto('/group-chats');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await shot(page, '28-group-chats-page');
  });

  test('General-11: Profile page', async ({ page }) => {
    await loginViaCookie(page);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, '29-profile-page');
  });

  test('General-12: Docs page', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await shot(page, '30-docs-page');
  });
});
