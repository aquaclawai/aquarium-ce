import { test, expect } from '@playwright/test';
import { API } from './helpers';

const BASE = 'http://localhost:5173';

function uniqueEmail() {
  return `snap-browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

test.describe.serial('Snapshots Tab — Browser', () => {
  const email = uniqueEmail();
  const password = 'SnapBrowser123!';
  const displayName = 'Snap Browser';
  const instanceName = `snap-ui-${Date.now()}`;

  let cookie: string;
  let instanceId: string;
  let firstSnapshotId: string;
  let secondSnapshotId: string;

  /** Helper: login via browser */
  async function login(page: import('@playwright/test').Page) {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10000 });
  }

  /** Helper: navigate to instance detail → Snapshots tab */
  async function gotoSnapshotsTab(page: import('@playwright/test').Page) {
    await login(page);
    await page.goto(`${BASE}/instances/${instanceId}`);
    await expect(page.locator('.instance-page h1')).toHaveText(instanceName, { timeout: 5000 });
    await page.click('button:has-text("Snapshots")');
    await page.waitForLoadState('networkidle');
  }

  // ── Setup: create account + instance + snapshots via API ────────

  test.beforeAll(async ({ request }) => {
    // Signup
    const signupRes = await request.post(`${API}/auth/test-signup`, {
      data: { email, password, displayName },
    });
    expect(signupRes.ok()).toBeTruthy();
    const setCookie = signupRes.headers()['set-cookie'];
    const match = setCookie.match(/token=([^;]+)/);
    expect(match).toBeTruthy();
    cookie = `token=${match![1]}`;

    // Create instance (stays in `created` — no Docker needed)
    const instRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: instanceName, agentType: 'openclaw' },
    });
    const instBody = await instRes.json();
    expect(instBody.ok).toBe(true);
    instanceId = instBody.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  // ── Tests ───────────────────────────────────────────────────────

  test('empty state — shows no snapshots message', async ({ page }) => {
    await gotoSnapshotsTab(page);

    await expect(page.locator('.info-message:has-text("No snapshots yet")')).toBeVisible();
  });

  test('create snapshot button is disabled for non-running instance', async ({ page }) => {
    await gotoSnapshotsTab(page);

    const createBtn = page.locator('button:has-text("Create Snapshot")');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeDisabled();
  });

  test('shows "instance must be running" info', async ({ page }) => {
    await gotoSnapshotsTab(page);

    await expect(
      page.locator('.info-message:has-text("Instance must be running")')
    ).toBeVisible();
  });

  test('snapshot list renders after API-created snapshots', async ({ page, request }) => {
    // Create two snapshots via API
    const snap1Res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'First browser snapshot' },
    });
    const snap1Body = await snap1Res.json();
    expect(snap1Body.ok).toBe(true);
    firstSnapshotId = snap1Body.data.id;

    const snap2Res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'Second browser snapshot' },
    });
    const snap2Body = await snap2Res.json();
    expect(snap2Body.ok).toBe(true);
    secondSnapshotId = snap2Body.data.id;

    // Navigate to snapshots tab
    await gotoSnapshotsTab(page);

    // List should be visible with 2 cards
    await expect(page.locator('.snapshot-list')).toBeVisible();
    const cards = page.locator('.snapshot-card');
    await expect(cards).toHaveCount(2);

    // Cards show description text
    await expect(page.locator('.snapshot-card-desc').first()).toContainText('Second browser snapshot');
    await expect(page.locator('.snapshot-card-desc').last()).toContainText('First browser snapshot');
  });

  test('snapshot cards show badge and date', async ({ page }) => {
    await gotoSnapshotsTab(page);

    const firstCard = page.locator('.snapshot-card').first();
    await expect(firstCard.locator('.snapshot-badge')).toBeVisible();
    await expect(firstCard.locator('.snapshot-badge')).toContainText('Manual');
    await expect(firstCard.locator('.snapshot-card-date')).toBeVisible();
  });

  test('clicking snapshot card opens diff view', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Click the first card (most recent)
    await page.locator('.snapshot-card').first().click();

    // Diff view appears
    await expect(page.locator('.snapshot-diff-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.snapshot-diff-header')).toBeVisible();

    // Restore and Close buttons present
    await expect(page.locator('button:has-text("Restore this Snapshot")')).toBeVisible();
    await expect(page.locator('button:has-text("Close")')).toBeVisible();
  });

  test('close button dismisses diff view', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Open diff
    await page.locator('.snapshot-card').first().click();
    await expect(page.locator('.snapshot-diff-view')).toBeVisible({ timeout: 5000 });

    // Close it
    await page.click('button:has-text("Close")');
    await expect(page.locator('.snapshot-diff-view')).not.toBeVisible();
  });

  test('restore button opens confirmation modal', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Open diff
    await page.locator('.snapshot-card').first().click();
    await expect(page.locator('.snapshot-diff-view')).toBeVisible({ timeout: 5000 });

    // Click restore
    await page.click('button:has-text("Restore this Snapshot")');

    // Modal appears
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal h3')).toContainText('Restore Snapshot');
  });

  test('cancel button in restore modal closes it', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Open diff → restore modal
    await page.locator('.snapshot-card').first().click();
    await expect(page.locator('.snapshot-diff-view')).toBeVisible({ timeout: 5000 });
    await page.click('button:has-text("Restore this Snapshot")');
    await expect(page.locator('.modal')).toBeVisible();

    // Cancel
    await page.click('.modal button:has-text("Cancel")');
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });

  test('confirm restore executes and shows success', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Open diff → restore modal → confirm
    await page.locator('.snapshot-card').first().click();
    await expect(page.locator('.snapshot-diff-view')).toBeVisible({ timeout: 5000 });
    await page.click('button:has-text("Restore this Snapshot")');
    await expect(page.locator('.modal')).toBeVisible();

    // Click the Restore button inside the modal (the .danger one)
    await page.click('.modal button.danger:has-text("Restore")');

    // Modal should close after restore
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });

    // Diff view should close after successful restore
    await expect(page.locator('.snapshot-diff-view')).not.toBeVisible({ timeout: 5000 });
  });

  test('after restore, pre_operation auto-snapshot appears in list', async ({ page }) => {
    await gotoSnapshotsTab(page);

    // Should now have at least 3 snapshots (2 manual + 1 pre_operation)
    const cards = page.locator('.snapshot-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Find the auto-snapshot badge (pre_operation renders as "Auto")
    const preOpBadge = page.locator('.snapshot-badge:has-text("Auto")');
    await expect(preOpBadge).toBeVisible();
  });

  test('delete snapshot removes it from list', async ({ page }) => {
    await gotoSnapshotsTab(page);

    const initialCount = await page.locator('.snapshot-card').count();

    // Click delete on the last card (oldest — firstSnapshotId)
    // The delete button triggers window.confirm; accept it
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('.snapshot-card').last().locator('.btn-small.danger').click();

    // Wait for card to be removed
    await expect(page.locator('.snapshot-card')).toHaveCount(initialCount - 1, { timeout: 5000 });
  });
});
