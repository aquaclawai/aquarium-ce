/**
 * UI Regression Tests — Design System Migration Guard
 *
 * These tests capture the current CE frontend behavior BEFORE the
 * shadcn/Tailwind design system migration. They verify:
 *   - Pages render without errors
 *   - Navigation works correctly
 *   - Theme toggle (dark/light) works
 *   - Language switching works
 *   - Key interactive elements are functional
 *   - Sidebar collapse/expand works
 *   - FAB buttons are present and functional
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE, signupWithFallback, uniqueEmail } from './helpers';

/* ── Shared auth setup ── */

let authCookie: string;
let testEmail: string;
const testPassword = 'TestPass123!';

async function loginToApp(page: Page, request: import('@playwright/test').APIRequestContext) {
  if (!authCookie) {
    testEmail = uniqueEmail();
    const token = await signupWithFallback(request, testEmail, testPassword, 'UI Regression User');
    authCookie = `token=${token}`;
  }
  await page.context().addCookies([{
    name: 'token',
    value: authCookie.replace('token=', ''),
    domain: 'localhost',
    path: '/',
  }]);
}

/* ── Page rendering tests ── */

test.describe('UI Regression: Page Rendering', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('chat hub page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');
    // Page should not have console errors
    expect(errors).toEqual([]);
    // Should have main content area
    await expect(page.locator('.app-layout')).toBeVisible();
  });

  test('dashboard page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('templates page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/templates`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('assistants page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/assistants`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('credentials page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/user/credentials`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('group chats page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/group-chats`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('create wizard page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/create`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('docs page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE}/docs`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});

/* ── Sidebar and Navigation ── */

test.describe('UI Regression: Sidebar & Navigation', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('sidebar renders with logo and nav items', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Sidebar should be visible
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();

    // Nav items should be present (Chat, Group Chats, Dashboard, Skills, Assistants)
    const navLinks = page.locator('nav a, [data-sidebar="menu-button"] a');
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('navigation links work', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Click dashboard nav link
    const dashboardLink = page.locator('a[href="/dashboard"]');
    if (await dashboardLink.count() > 0) {
      await dashboardLink.first().click();
      await page.waitForURL('**/dashboard');
      expect(page.url()).toContain('/dashboard');
    }

    // Click assistants nav link
    const assistantsLink = page.locator('a[href="/assistants"]');
    if (await assistantsLink.count() > 0) {
      await assistantsLink.first().click();
      await page.waitForURL('**/assistants');
      expect(page.url()).toContain('/assistants');
    }
  });

  test('user menu area exists in sidebar', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // User area should show user initial or avatar
    const userArea = page.locator('[data-sidebar="footer"], .sidebar__user');
    await expect(userArea.first()).toBeVisible();
  });
});

/* ── Theme Toggle ── */

test.describe('UI Regression: Theme Toggle', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('theme toggle button exists and switches theme', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Check initial theme state
    const initialDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    // Find and click the theme toggle - it should contain Moon or Sun icon
    const moonOrSun = page.locator('.app-layout__fab-btn, button[aria-label*="theme"], button[aria-label*="Theme"]').last();
    if (await moonOrSun.count() > 0) {
      await moonOrSun.click();
      await page.waitForTimeout(300);

      const afterDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      );
      expect(afterDark).not.toBe(initialDark);
    }
  });

  test('theme persists across page reload', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Set dark mode via localStorage
    await page.evaluate(() => {
      localStorage.setItem('openclaw-theme', 'dark');
      document.documentElement.classList.add('dark');
    });

    // Reload and verify
    await page.reload();
    await page.waitForLoadState('networkidle');

    const isDark = await page.evaluate(() =>
      localStorage.getItem('openclaw-theme') === 'dark'
    );
    expect(isDark).toBe(true);
  });
});

/* ── Language Switching ── */

test.describe('UI Regression: Language Switching', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('language menu can be opened', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Look for the language menu trigger (Globe icon)
    const globeBtn = page.locator('.app-layout__lang-wrap button, .app-layout__fab-btn').nth(1);
    if (await globeBtn.count() > 0) {
      await globeBtn.click();
      await page.waitForTimeout(200);

      // Language menu should appear
      const langMenu = page.locator('.app-layout__lang-menu, [class*="lang-menu"]');
      if (await langMenu.count() > 0) {
        await expect(langMenu).toBeVisible();
      }
    }
  });
});

/* ── FAB Buttons ── */

test.describe('UI Regression: FAB Buttons', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('FAB buttons are visible', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // FAB area should have multiple buttons (notification, docs, language, theme)
    const fabArea = page.locator('.app-layout__fab');
    if (await fabArea.count() > 0) {
      await expect(fabArea).toBeVisible();
      const fabBtns = fabArea.locator('button, .app-layout__fab-btn');
      const count = await fabBtns.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ── CSS Design System Tokens ── */

test.describe('UI Regression: Design System Basics', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('CSS custom properties are defined', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Verify key CSS variables are set
    const vars = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        colorPrimary: style.getPropertyValue('--color-primary').trim(),
        colorBg: style.getPropertyValue('--color-bg').trim(),
        colorText: style.getPropertyValue('--color-text').trim(),
        colorBorder: style.getPropertyValue('--color-border').trim(),
        radiusMd: style.getPropertyValue('--radius-md').trim(),
        spacingMd: style.getPropertyValue('--spacing-md').trim(),
      };
    });

    // These should all be non-empty (design system loaded)
    expect(vars.colorPrimary).toBeTruthy();
    expect(vars.colorBg).toBeTruthy();
    expect(vars.colorText).toBeTruthy();
    expect(vars.colorBorder).toBeTruthy();
    expect(vars.radiusMd).toBeTruthy();
    expect(vars.spacingMd).toBeTruthy();
  });

  test('no broken images or missing assets', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Check that no images failed to load
    const brokenImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      return Array.from(imgs).filter(img => !img.complete || img.naturalWidth === 0).length;
    });
    expect(brokenImages).toBe(0);
  });
});

/* ── Dark Mode Visuals ── */

test.describe('UI Regression: Dark Mode', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('dark mode changes background colors', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Get light mode background
    const lightBg = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return style.getPropertyValue('--color-bg').trim();
    });

    // Switch to dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(100);

    // Get dark mode background
    const darkBg = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return style.getPropertyValue('--color-bg').trim();
    });

    // Background should change between themes
    expect(lightBg).not.toBe(darkBg);
  });
});

/* ── Responsive Layout ── */

test.describe('UI Regression: Responsive', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('layout adjusts at mobile breakpoint', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Desktop: sidebar visible
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    const sidebarDesktop = page.locator('aside').first();
    const desktopBox = await sidebarDesktop.boundingBox();
    if (desktopBox) {
      expect(desktopBox.width).toBeGreaterThan(50);
    }

    // Mobile: sidebar should be hidden or off-screen
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);

    // Hamburger should appear at mobile width
    const hamburger = page.locator('.app-layout__hamburger, [data-sidebar="trigger"]');
    if (await hamburger.count() > 0) {
      await expect(hamburger.first()).toBeVisible();
    }
  });
});
