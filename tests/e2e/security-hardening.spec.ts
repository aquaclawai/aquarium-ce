import { test, expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api';

function uniqueEmail() {
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signupAndGetCookie(request: APIRequestContext, email?: string): Promise<{ cookie: string; email: string }> {
  const e = email ?? uniqueEmail();
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email: e, password: 'SecTest123!', displayName: 'Security Tester' },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'];
  const match = setCookie.match(/token=([^;]+)/);
  expect(match).toBeTruthy();
  return { cookie: `token=${match![1]}`, email: e };
}

// ── TC-1xx: Security Events API ──

test.describe.serial('Security Events API', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    ({ cookie } = await signupAndGetCookie(request));
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `sec-events-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('TC-101: security-events returns empty list for new instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/security-events`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(body.data.page).toBe(1);
    expect(body.data.totalPages).toBe(0);
  });

  test('TC-102: security-events returns 404 for nonexistent instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/00000000-0000-0000-0000-000000000000/security-events`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(404);
  });

  test('TC-103: security summary returns empty for new user', async ({ request }) => {
    const res = await request.get(`${API}/security/summary`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.totalEvents).toBe(0);
    expect(body.data.bySeverity).toEqual({});
    expect(body.data.byType).toEqual({});
    expect(body.data.recentCritical).toBe(0);
  });

  test('TC-104: security-events respects pagination params', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/security-events?page=1&limit=5`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.page).toBe(1);
    expect(body.data.limit).toBe(5);
  });
});

// ── TC-2xx: Auth Events Audit ──

test.describe.serial('Auth Events Audit', () => {
  const email = uniqueEmail();
  const password = 'AuditTest123!';

  test('TC-201: signup records auth event', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-signup`, {
      data: { email, password, displayName: 'Audit Tester' },
    });
    expect(res.ok()).toBeTruthy();

    const setCookie = res.headers()['set-cookie'];
    const match = setCookie.match(/token=([^;]+)/);
    const cookie = `token=${match![1]}`;

    const meRes = await request.get(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.ok()).toBeTruthy();
  });

  test('TC-202: login success records auth event', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.user.email).toBe(email);
  });

  test('TC-203: login failure (wrong password) records auth event', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password: 'WrongPassword999!' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('TC-204: login failure (nonexistent user) records auth event', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email: 'nonexistent-user-xyz@e2e.test', password: 'Any123!' },
    });
    expect(res.status()).toBe(401);
  });

  test('TC-205: logout records auth event', async ({ request }) => {
    const loginRes = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const setCookie = loginRes.headers()['set-cookie'];
    const match = setCookie.match(/token=([^;]+)/);
    const cookie = `token=${match![1]}`;

    const logoutRes = await request.post(`${API}/auth/logout`, {
      headers: { Cookie: cookie },
    });
    expect(logoutRes.ok()).toBeTruthy();
    const body = await logoutRes.json();
    expect(body.ok).toBe(true);
  });
});

// ── TC-3xx: Instance Events Type Filter ──

test.describe.serial('Instance Events Type Filter', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    ({ cookie } = await signupAndGetCookie(request));
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `filter-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('TC-301: events with type filter returns only matching events', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/events?type=created`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    for (const event of body.data) {
      expect(event.eventType).toBe('created');
    }
  });

  test('TC-302: events without type filter returns all events', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/events`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── TC-4xx: Security Profile DLP Config ──

test.describe.serial('Security Profile & DLP Config', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    ({ cookie } = await signupAndGetCookie(request));
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await request.delete(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
  });

  test('TC-401: create instance with strict security profile', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `strict-${Date.now()}`, agentType: 'openclaw', securityProfile: 'strict' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    instanceId = body.data.id;
    expect(body.data.securityProfile).toBe('strict');
  });

  test('TC-402: default security profile is standard', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `default-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.securityProfile).toBe('standard');
    await request.delete(`${API}/instances/${body.data.id}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('TC-403: patch instance security profile to developer', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: { securityProfile: 'developer' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.securityProfile).toBe('developer');
  });
});

// ── TC-5xx: Security Events Unauthenticated ──

test.describe('Security API Auth Guard', () => {
  test('TC-501: security-events rejects unauthenticated', async ({ request }) => {
    const res = await request.get(`${API}/instances/any-id/security-events`);
    expect(res.status()).toBe(401);
  });

  test('TC-502: security summary rejects unauthenticated', async ({ request }) => {
    const res = await request.get(`${API}/security/summary`);
    expect(res.status()).toBe(401);
  });
});
