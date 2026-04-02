import { test, expect } from '@playwright/test';
import { BASE, signupWithFallback, uniqueEmail } from './helpers';

const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe.serial('Mobile sidebar (CIT-187)', () => {
  let email: string;
  let password: string;

  test('signup and login', async ({ page, request }) => {
    email = uniqueEmail();
    password = 'TestPass123!';
    await signupWithFallback(request, email, password, 'Mobile Test');

    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
  });

  test('sidebar hidden and hamburger visible at 375px', async ({ page, request }) => {
    await signupWithFallback(request, email, password, 'Mobile Test');
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForTimeout(300);

    const hamburger = page.locator('.app-layout__hamburger');
    await expect(hamburger).toBeVisible();

    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    expect(box === null || box.x + box.width <= 0).toBeTruthy();
  });

  test('hamburger opens sidebar with backdrop', async ({ page, request }) => {
    await signupWithFallback(request, email, password, 'Mobile Test');
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForTimeout(300);

    await page.click('.app-layout__hamburger');
    await page.waitForTimeout(400);

    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);

    const backdrop = page.locator('.app-layout__backdrop');
    await expect(backdrop).toBeVisible();
  });

  test('clicking backdrop closes sidebar', async ({ page, request }) => {
    await signupWithFallback(request, email, password, 'Mobile Test');
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForTimeout(300);

    await page.click('.app-layout__hamburger');
    await page.waitForTimeout(400);

    await page.click('.app-layout__backdrop', { position: { x: 350, y: 400 } });
    await page.waitForTimeout(400);

    const backdrop = page.locator('.app-layout__backdrop');
    await expect(backdrop).not.toBeVisible();

    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    expect(box === null || box.x + box.width <= 0).toBeTruthy();
  });

  test('nav click closes sidebar', async ({ page, request }) => {
    await signupWithFallback(request, email, password, 'Mobile Test');
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForTimeout(300);

    await page.click('.app-layout__hamburger');
    await page.waitForTimeout(400);

    await page.click('.sidebar__nav-item >> nth=1');
    await page.waitForTimeout(400);

    const backdrop = page.locator('.app-layout__backdrop');
    await expect(backdrop).not.toBeVisible();
  });

  test('desktop toggle hidden at mobile width', async ({ page, request }) => {
    await signupWithFallback(request, email, password, 'Mobile Test');
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForTimeout(300);

    const toggle = page.locator('.app-layout__toggle');
    await expect(toggle).not.toBeVisible();
  });
});
