import { test, expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api';

// ── Inline helpers (no cross-file deps) ──────────────────────────────────────

function uniqueEmail(): string {
  return `oauth-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password: 'TestPass123!', displayName: 'OAuth Smoke' },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'];
  expect(setCookie).toBeDefined();
  const match = setCookie.match(/token=([^;]+)/);
  expect(match).toBeTruthy();
  return `token=${match![1]}`;
}

// ── OAuth Device-Code Endpoint Smoke Tests ───────────────────────────────────
// These test that each OAuth endpoint is registered (not 404).
// We accept 200, 400, 500, 502 as "endpoint exists" confirmations since
// external OAuth providers may reject requests without valid client IDs.

const DEVICE_CODE_PROVIDERS = ['github', 'openai', 'qwen'] as const;

test.describe('OAuth Device-Code Endpoint Smoke Tests', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  for (const provider of DEVICE_CODE_PROVIDERS) {
    test(`${provider} device-code endpoint exists`, async ({ request }) => {
      const res = await request.post(`${API}/oauth/${provider}/device-code`, {
        headers: { Cookie: cookie },
      });

      // Endpoint must be registered -- 404 means it's missing
      expect(res.status(), `${provider} device-code returned 404 -- endpoint not registered`).not.toBe(404);

      // If we got 200, validate response shape
      if (res.status() === 200) {
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.data).toBeDefined();
        // All device-code endpoints return at least userCode + verificationUri (or deviceAuthId for OpenAI)
        if (provider === 'openai') {
          expect(body.data).toHaveProperty('deviceAuthId');
          expect(body.data).toHaveProperty('userCode');
          expect(body.data).toHaveProperty('verificationUri');
        } else {
          expect(body.data).toHaveProperty('deviceCode');
          expect(body.data).toHaveProperty('userCode');
          expect(body.data).toHaveProperty('verificationUri');
        }
      }
    });
  }

  // Google and Gemini CLI use authorize (PKCE redirect) flow, not device-code
  const AUTHORIZE_PROVIDERS = ['google', 'gemini-cli'] as const;

  for (const provider of AUTHORIZE_PROVIDERS) {
    test(`${provider} authorize endpoint exists`, async ({ request }) => {
      const res = await request.post(`${API}/oauth/${provider}/authorize`, {
        headers: { Cookie: cookie },
      });

      expect(res.status(), `${provider} authorize returned 404 -- endpoint not registered`).not.toBe(404);

      if (res.status() === 200) {
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('authUrl');
        expect(body.data).toHaveProperty('state');
        expect(typeof body.data.authUrl).toBe('string');
        expect(body.data.authUrl).toContain('accounts.google.com');
      }
    });
  }
});

// ── Metadata API Validation ──────────────────────────────────────────────────
// Metadata endpoints are public (no auth required).

test.describe('Metadata API Validation', () => {
  test('GET /api/metadata/providers returns valid response', async ({ request }) => {
    const res = await request.get(`${API}/metadata/providers`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // In production the array has 27+ providers; in dev mode without Docker
    // build it returns [] (empty metadata fallback -- decision 03-01).
    // Validate shape if data is present.
    if (body.data.length > 0) {
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      for (const provider of body.data) {
        expect(typeof provider.id).toBe('string');
        expect(typeof provider.name).toBe('string');
      }
    }
  });

  test('provider entries have auth method info when metadata is populated', async ({ request }) => {
    const res = await request.get(`${API}/metadata/providers`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();

    // Skip shape validation if metadata is empty (dev mode without Docker build)
    test.skip(body.data.length === 0, 'Metadata empty -- dev mode without gateway image');

    const first = body.data[0];
    expect(first).toBeDefined();
    expect(first).toHaveProperty('authMethods');
    expect(Array.isArray(first.authMethods)).toBe(true);
    expect(first).toHaveProperty('models');
    expect(Array.isArray(first.models)).toBe(true);
    expect(first).toHaveProperty('hint');
    expect(typeof first.hint).toBe('string');
  });

  test('GET /api/metadata/channels returns valid response', async ({ request }) => {
    const res = await request.get(`${API}/metadata/channels`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // In production: 8+ channels. In dev mode: may be empty.
    if (body.data.length > 0) {
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      for (const channel of body.data) {
        expect(typeof channel.id).toBe('string');
        expect(typeof channel.name).toBe('string');
      }
    }
  });
});

// ── Existing Suite Regression Guard ──────────────────────────────────────────
// Quick sanity check that core auth is not broken (covers UPG-01..04 regression).

test.describe('Existing Suite Regression Guard', () => {
  test('auth signup still works (UPG regression)', async ({ request }) => {
    const email = uniqueEmail();
    const res = await request.post(`${API}/auth/test-signup`, {
      data: { email, password: 'Regression123!', displayName: 'Regression Test' },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(email);
    expect(body.data.token).toBeTruthy();

    // Verify login also works
    const loginRes = await request.post(`${API}/auth/test-login`, {
      data: { email, password: 'Regression123!' },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);
    expect(loginBody.data.user.email).toBe(email);
  });
});
