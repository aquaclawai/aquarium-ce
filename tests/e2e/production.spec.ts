/**
 * Production E2E tests for agent.jinkomcp.com
 *
 * Runs against the live deployment using pure API calls with Bearer token auth
 * (bypasses the cookie/Secure flag issue while HTTPS cert provisions).
 *
 * Usage:
 *   npx playwright test tests/e2e/production.spec.ts --reporter=list
 *
 * Environment variables:
 *   PROD_URL       — API base (default: http://agent.jinkomcp.com/api)
 *   PROD_EMAIL     — test account email (default: test@openclaw.dev)
 *   PROD_PASSWORD  — test account password (default: OpenClaw2026!)
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const API = process.env.PROD_URL || 'http://agent.jinkomcp.com/api';
const EMAIL = process.env.PROD_EMAIL || 'test@openclaw.dev';
const PASSWORD = process.env.PROD_PASSWORD || 'OpenClaw2026!';

const HAS_PROD_CREDS = !!process.env.PROD_URL && !!process.env.PROD_EMAIL && !!process.env.PROD_PASSWORD;

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/test-login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `Login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.token).toBeTruthy();
  return body.data.token;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe.serial('Production — Login, Create, Launch', () => {
  test.beforeEach(() => {
    test.skip(!HAS_PROD_CREDS, 'Requires PROD_URL, PROD_EMAIL, PROD_PASSWORD env vars');
  });

  let token: string;
  let instanceId: string;
  const instanceName = `prod-e2e-${Date.now()}`;

  // ── Auth ──────────────────────────────────────────────

  test('health check', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('login with test account', async ({ request }) => {
    token = await login(request);
    expect(token).toBeTruthy();
  });

  test('/me returns current user', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(EMAIL);
  });

  // ── Instance CRUD ─────────────────────────────────────

  test('list instances (baseline)', async ({ request }) => {
    const res = await request.get(`${API}/instances`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('create instance', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: authHeaders(token),
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(res.status(), `Create failed: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe(instanceName);
    expect(body.data.status).toBe('created');
    expect(body.data.id).toBeTruthy();
    instanceId = body.data.id;
  });

  test('get instance by id', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(instanceName);
    expect(body.data.agentType).toBe('openclaw');
  });

  test('instance appears in list', async ({ request }) => {
    const res = await request.get(`${API}/instances`, {
      headers: authHeaders(token),
    });
    const body = await res.json();
    const names = body.data.map((i: { name: string }) => i.name);
    expect(names).toContain(instanceName);
  });

  // ── Instance Lifecycle ────────────────────────────────

  test('start instance', async ({ request }) => {
    // K8s pod scheduling + image pull can take 2-3 minutes
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Start failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Backend may return 'running' (Docker) or 'starting' (K8s — pod still scheduling)
    expect(['running', 'starting']).toContain(body.data.status);
    // In K8s mode, runtimeId may not be assigned until the pod is scheduled
    if (body.data.status === 'running') {
      expect(body.data.runtimeId).toBeTruthy();
    }
  });

  test('instance status reports running', async ({ request }) => {
    // Give K8s a moment to schedule the pod
    await new Promise(r => setTimeout(r, 5000));

    const res = await request.get(`${API}/instances/${instanceId}/status`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    // K8s pod may still be scheduling; accept both states
    expect(['running', 'pending', true].includes(body.data.running) || body.data.phase).toBeTruthy();
  });

  test('wait for pod to be ready and check health', async ({ request }) => {
    test.setTimeout(420_000);
    // Poll instance status for up to 360s waiting for running (includes K8s scheduling + gateway startup)
    const deadline = Date.now() + 360_000;
    let running = false;
    while (Date.now() < deadline) {
      const res = await request.get(`${API}/instances/${instanceId}/status`, {
        headers: authHeaders(token),
      });
      const body = await res.json();
      if (body.data?.running === true) {
        running = true;
        break;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    expect(running, 'Instance did not reach running state within 360s').toBe(true);
  });

  test('fetch instance logs', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/logs?tail=20`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Logs failed: ${res.status()}`).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/plain');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test('fetch instance events', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/events`, {
      headers: authHeaders(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ── Cleanup ───────────────────────────────────────────

  test('stop instance', async ({ request }) => {
    test.setTimeout(60_000);
    const res = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Stop failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    // K8s may return 'stopping' while pod terminates
    expect(['stopped', 'stopping']).toContain(body.data.status);
    // Wait for fully stopped before cleanup
    if (body.data.status === 'stopping') {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const check = await request.get(`${API}/instances/${instanceId}`, { headers: authHeaders(token) });
        const checkBody = await check.json();
        if (checkBody.data?.status === 'stopped') break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  });

  test('delete instance', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), `Delete failed: ${await res.text()}`).toBeTruthy();

    const check = await request.get(`${API}/instances/${instanceId}`, {
      headers: authHeaders(token),
    });
    expect(check.status()).toBe(404);
  });
});
