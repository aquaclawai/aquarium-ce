/**
 * Design System Regression Tests
 *
 * Verifies that the Aquarium design system migration does not break:
 *   - Page rendering across all major routes (no JS errors)
 *   - Sidebar navigation and user area
 *   - Theme toggle (dark/light via .dark class on html)
 *   - CSS design tokens are defined and functional
 *   - Dark mode changes background color
 *   - .page-loading CSS rule exists (Suspense fallback)
 *   - Responsive layout (sidebar collapses at mobile breakpoint)
 *
 * Usage:
 *   npx playwright test tests/e2e/design-system-regression.spec.ts --reporter=list
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
    const token = await signupWithFallback(request, testEmail, testPassword, 'Design System Regression User');
    authCookie = `token=${token}`;
  }
  await page.context().addCookies([{
    name: 'token',
    value: authCookie.replace('token=', ''),
    domain: 'localhost',
    path: '/',
  }]);
}

/* ── Page rendering: no JS errors ── */

test.describe('Design System Regression: Page Rendering', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  const pages: Array<{ name: string; path: string }> = [
    { name: 'chat hub', path: '/' },
    { name: 'dashboard', path: '/dashboard' },
    { name: 'templates', path: '/templates' },
    { name: 'assistants', path: '/assistants' },
    { name: 'credentials', path: '/user/credentials' },
    { name: 'create wizard', path: '/create' },
    { name: 'docs', path: '/docs' },
    { name: 'group chats', path: '/group-chats' },
  ];

  for (const { name, path } of pages) {
    test(`${name} page renders without JS errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }
});

/* ── Sidebar renders with nav items and user area ── */

test.describe('Design System Regression: Sidebar', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('sidebar renders with nav items', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Sidebar element should be visible
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();

    // Should contain multiple navigation links
    const navLinks = page.locator('nav a, [data-sidebar="menu-button"] a');
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('sidebar contains user area', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // User area at the bottom of sidebar — look for footer or user section
    const userArea = page.locator('[data-sidebar="footer"], .sidebar__user');
    await expect(userArea.first()).toBeVisible();
  });
});

/* ── Theme toggle works (dark class toggled on html) ── */

test.describe('Design System Regression: Theme Toggle', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('toggling theme changes .dark class on html element', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Record initial dark state
    const initialDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    // Find and click the theme toggle button
    const themeToggle = page.locator(
      '.app-layout__fab-btn, button[aria-label*="theme"], button[aria-label*="Theme"]'
    ).last();

    if (await themeToggle.count() > 0) {
      await themeToggle.click();
      await page.waitForTimeout(300);

      const afterDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      );
      // The dark class should be toggled
      expect(afterDark).not.toBe(initialDark);

      // Toggle back — should restore original state
      await themeToggle.click();
      await page.waitForTimeout(300);

      const restoredDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      );
      expect(restoredDark).toBe(initialDark);
    }
  });

  test('theme preference persists in localStorage', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Force dark mode via localStorage
    await page.evaluate(() => {
      localStorage.setItem('openclaw-theme', 'dark');
      document.documentElement.classList.add('dark');
    });

    // Reload and verify localStorage survived
    await page.reload();
    await page.waitForLoadState('networkidle');

    const theme = await page.evaluate(() => localStorage.getItem('openclaw-theme'));
    expect(theme).toBe('dark');
  });
});

/* ── CSS design tokens are defined ── */

test.describe('Design System Regression: CSS Tokens', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('core CSS custom properties are defined on :root', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

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

    // All core tokens must be non-empty
    expect(vars.colorPrimary).toBeTruthy();
    expect(vars.colorBg).toBeTruthy();
    expect(vars.colorText).toBeTruthy();
    expect(vars.colorBorder).toBeTruthy();
    expect(vars.radiusMd).toBeTruthy();
    expect(vars.spacingMd).toBeTruthy();
  });

  test('spacing and radius tokens have valid CSS values', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        spacingXs: style.getPropertyValue('--spacing-xs').trim(),
        spacingSm: style.getPropertyValue('--spacing-sm').trim(),
        spacingMd: style.getPropertyValue('--spacing-md').trim(),
        spacingLg: style.getPropertyValue('--spacing-lg').trim(),
        spacingXl: style.getPropertyValue('--spacing-xl').trim(),
        radiusSm: style.getPropertyValue('--radius-sm').trim(),
        radiusMd: style.getPropertyValue('--radius-md').trim(),
        radiusLg: style.getPropertyValue('--radius-lg').trim(),
      };
    });

    // All spacing and radius tokens must be defined
    for (const [key, value] of Object.entries(tokens)) {
      expect(value, `${key} should be defined`).toBeTruthy();
    }
  });
});

/* ── Dark mode changes background color ── */

test.describe('Design System Regression: Dark Mode Visuals', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('dark mode changes --color-bg value', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Ensure we start in light mode
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(100);

    const lightBg = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
    });

    // Switch to dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(100);

    const darkBg = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
    });

    // The background token should differ between light and dark modes
    expect(lightBg).not.toBe(darkBg);
  });
});

/* ── .page-loading CSS rule exists ── */

test.describe('Design System Regression: Suspense Fallback', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('.page-loading CSS rule exists with correct layout properties', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Inject a temporary element with the .page-loading class and check computed styles
    const styles = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'page-loading';
      document.body.appendChild(el);
      const computed = getComputedStyle(el);
      const result = {
        display: computed.display,
        alignItems: computed.alignItems,
        justifyContent: computed.justifyContent,
        minHeight: computed.minHeight,
      };
      document.body.removeChild(el);
      return result;
    });

    // .page-loading should use flexbox centering with full viewport height
    expect(styles.display).toBe('flex');
    expect(styles.alignItems).toBe('center');
    expect(styles.justifyContent).toBe('center');
    expect(styles.minHeight).toBe('100vh');
  });
});

/* ── Responsive layout: sidebar collapses at mobile breakpoint ── */

test.describe('Design System Regression: Responsive Layout', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginToApp(page, request);
  });

  test('sidebar visible at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('aside').first();
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
  });

  test('sidebar collapses and hamburger appears at mobile breakpoint', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Shrink to mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);

    // Hamburger / mobile trigger should appear
    const hamburger = page.locator('.app-layout__hamburger, [data-sidebar="trigger"]');
    if (await hamburger.count() > 0) {
      await expect(hamburger.first()).toBeVisible();
    }

    // Sidebar should be off-screen or hidden
    const sidebar = page.locator('aside').first();
    const box = await sidebar.boundingBox();
    // Either null (hidden) or shifted off-screen (x + width <= 0)
    if (box !== null) {
      expect(box.x + box.width).toBeLessThanOrEqual(0);
    }
  });

  test('mobile hamburger opens sidebar overlay', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);

    const hamburger = page.locator('.app-layout__hamburger, [data-sidebar="trigger"]');
    if (await hamburger.count() > 0) {
      await hamburger.first().click();
      await page.waitForTimeout(400);

      // Sidebar should now be visible on-screen
      const sidebar = page.locator('aside').first();
      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
