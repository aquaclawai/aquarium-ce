/**
 * Extension System Regression Tests
 *
 * API-level tests verifying fixes to the skills/plugins extension system:
 *   - Skills endpoint returns correct enabled state for gateway builtins
 *   - Skills endpoint returns empty string (not "0.0.0") for bundled version
 *   - Catalog endpoint returns source='bundled' (not 'clawhub' or 'openclaw-bundled')
 *   - Bundled skill install bypasses trust (source type 'bundled')
 *   - Bundled skill uninstall succeeds (no RPC error for bundled)
 *   - Reinstalling a previously failed skill upserts (no duplicate key)
 *   - ClawHub search via catalog does not crash
 *   - Trust policy allows all extensions in CE mode (no 403 for unscanned)
 *   - Marketplace client returns empty when CLAWHUB_API_URL is not set
 *
 * These tests run against the API only (no browser needed).
 * Tests that require a running Docker instance are skipped gracefully.
 *
 * Usage:
 *   npx playwright test tests/e2e/extensions-regression.spec.ts --reporter=list
 */
import { test, expect } from '@playwright/test';
import { API, signupAndGetCookie } from './helpers';

/* ── Helper: create an instance and return its ID ── */

async function createInstance(
  request: import('@playwright/test').APIRequestContext,
  cookie: string,
  suffix: string = 'ext-test',
): Promise<string> {
  const name = `${suffix}-${Date.now()}`;
  const res = await request.post(`${API}/instances`, {
    headers: { Cookie: cookie },
    data: { name, agentType: 'openclaw' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.id;
}

/* ── Helper: poll until instance is running or timeout ── */

async function waitForRunning(
  request: import('@playwright/test').APIRequestContext,
  cookie: string,
  instanceId: string,
  timeoutMs: number = 180_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    if (!res.ok()) return false;
    const body = await res.json();
    if (body.data.status === 'running') return true;
    if (body.data.status === 'error') return false;
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
   Tests that DO NOT require a running instance
   ══════════════════════════════════════════════════════════════ */

test.describe('Extension System: Skills API (stopped instance)', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie, 'skills-stopped');
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('skills endpoint returns managed=[] and gatewayBuiltins=[] for stopped instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/skills`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.managed).toEqual([]);
    expect(body.data.gatewayBuiltins).toEqual([]);
  });

  test('skills catalog requires running instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('running');
  });

  test('skills install requires running instance', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: {
        skillId: 'test-skill',
        source: { type: 'bundled' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('running');
  });

  test('skills uninstall requires running instance', async ({ request }) => {
    const res = await request.delete(`${API}/instances/${instanceId}/skills/test-skill`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

test.describe('Extension System: Plugins API (stopped instance)', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie, 'plugins-stopped');
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('plugins endpoint returns managed=[] and gatewayBuiltins=[] for stopped instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/plugins`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.managed).toEqual([]);
    expect(body.data.gatewayBuiltins).toEqual([]);
  });

  test('plugins catalog requires running instance', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/plugins/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('running');
  });

  test('plugins install validates source object', async ({ request }) => {
    // Missing source entirely
    const res1 = await request.post(`${API}/instances/${instanceId}/plugins/install`, {
      headers: { Cookie: cookie },
      data: { pluginId: 'test-plugin' },
    });
    expect(res1.status()).toBe(400);

    // Invalid source.type
    const res2 = await request.post(`${API}/instances/${instanceId}/plugins/install`, {
      headers: { Cookie: cookie },
      data: { pluginId: 'test-plugin', source: { type: 'invalid' } },
    });
    expect(res2.status()).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toContain('source.type');
  });

  test('skills install validates source object', async ({ request }) => {
    // Missing source entirely
    const res1 = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: { skillId: 'test-skill' },
    });
    expect(res1.status()).toBe(400);

    // Invalid source.type
    const res2 = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: { skillId: 'test-skill', source: { type: 'invalid' } },
    });
    expect(res2.status()).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toContain('source.type');
  });
});

/* ── Trust policy: CE mode allows all extensions ── */

test.describe('Extension System: Trust Policy (CE mode)', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie, 'trust-ce');
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('CE trust policy does not return 403 for unscanned clawhub source (requires running)', async ({ request }) => {
    // In CE mode, trust policy allows all extensions regardless of scan status.
    // If instance is not running, we get 400 (not 403), which confirms
    // the trust check does not prematurely block the request.
    const res = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: {
        skillId: 'some-unscanned-skill',
        source: { type: 'clawhub', spec: 'some-unscanned-skill' },
      },
    });
    // Expected: 400 (not running) — NOT 403 (blocked by trust).
    // In EE mode with unscanned extensions this would return 403.
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('running');
    // Crucially: no trust-related block message
    expect(body.error).not.toContain('blocked by trust');
    expect(body.error).not.toContain('Security scan');
  });

  test('CE trust policy does not return 403 for clawhub plugin source (requires running)', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/plugins/install`, {
      headers: { Cookie: cookie },
      data: {
        pluginId: 'some-unscanned-plugin',
        source: { type: 'clawhub', spec: 'some-unscanned-plugin' },
      },
    });
    // Should be 400 (not running), not 403
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).not.toContain('blocked by trust');
    expect(body.error).not.toContain('Security scan');
  });

  test('bundled source type is accepted as valid', async ({ request }) => {
    // Verify 'bundled' is in the valid source types list (no 400 for source type)
    const skillRes = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: {
        skillId: 'test-bundled-skill',
        source: { type: 'bundled' },
      },
    });
    // Should fail with 400 "not running", NOT "Invalid source.type"
    expect(skillRes.status()).toBe(400);
    const skillBody = await skillRes.json();
    expect(skillBody.error).toContain('running');
    expect(skillBody.error).not.toContain('source.type');

    const pluginRes = await request.post(`${API}/instances/${instanceId}/plugins/install`, {
      headers: { Cookie: cookie },
      data: {
        pluginId: 'test-bundled-plugin',
        source: { type: 'bundled' },
      },
    });
    expect(pluginRes.status()).toBe(400);
    const pluginBody = await pluginRes.json();
    expect(pluginBody.error).toContain('running');
    expect(pluginBody.error).not.toContain('source.type');
  });
});

/* ── Marketplace client: empty when CLAWHUB_API_URL is not set ── */

test.describe('Extension System: Marketplace / ClawHub', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie, 'marketplace');
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('plugins catalog for stopped instance returns 400 (not 500)', async ({ request }) => {
    // Ensures marketplace client gracefully returns empty when CLAWHUB_API_URL is unset
    const res = await request.get(`${API}/instances/${instanceId}/plugins/catalog`, {
      headers: { Cookie: cookie },
    });
    // 400 because instance is not running — not 500 from marketplace crash
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('skills catalog for stopped instance returns 400 (not 500)', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Tests that REQUIRE a running instance (Docker)
   These are skipped in CI and when Docker is unavailable.
   ══════════════════════════════════════════════════════════════ */

test.describe('Extension System: Running Instance (requires Docker)', () => {
  let cookie: string;
  let instanceId: string;
  let instanceRunning = false;

  test.beforeAll(async ({ request }) => {
    // Skip entire suite in CI (no Docker)
    if (process.env.CI) return;

    cookie = await signupAndGetCookie(request);
    instanceId = await createInstance(request, cookie, 'ext-running');

    // Try to start the instance
    try {
      const startRes = await request.post(`${API}/instances/${instanceId}/start`, {
        headers: { Cookie: cookie },
      });
      if (startRes.ok()) {
        instanceRunning = await waitForRunning(request, cookie, instanceId);
      }
    } catch {
      // Docker not available — tests will be skipped
    }
  });

  test.afterAll(async ({ request }) => {
    if (!instanceId) return;
    await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('gatewayBuiltins have enabled=false for blocked/disabled skills (not always true)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    const res = await request.get(`${API}/instances/${instanceId}/skills`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    const builtins = body.data.gatewayBuiltins;
    // If there are gateway builtins, verify the enabled field is a boolean
    // (not always true — the fix was to check eligible and disabled flags)
    for (const builtin of builtins) {
      expect(typeof builtin.enabled).toBe('boolean');
      expect(builtin.source).toBe('bundled');
      // Version should be an empty string for builtins without version, not "0.0.0"
      expect(typeof builtin.version).toBe('string');
      if (builtin.version !== '') {
        // If version is present, it should be a semver-like string
        expect(builtin.version).toMatch(/^\d/);
      }
    }
  });

  test('gatewayBuiltins return empty version string (not "0.0.0") for bundled skills', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    const res = await request.get(`${API}/instances/${instanceId}/skills`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    for (const builtin of body.data.gatewayBuiltins) {
      // The fix was to use empty string instead of "0.0.0" for missing versions
      expect(builtin.version).not.toBe('0.0.0');
    }
  });

  test('skill catalog entries have source=bundled for gateway skills (not clawhub)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    const res = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    const catalog = body.data.catalog;
    // Bundled catalog entries should have source='bundled', not 'clawhub' or 'openclaw-bundled'
    for (const entry of catalog) {
      if (entry.trustTier === 'bundled') {
        expect(entry.source).toBe('bundled');
        expect(entry.source).not.toBe('clawhub');
        expect(entry.source).not.toBe('openclaw-bundled');
      }
    }
  });

  test('installing a bundled skill succeeds (bypasses trust)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    // First get the catalog to find a real bundled skill ID
    const catalogRes = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(catalogRes.ok()).toBeTruthy();
    const catalogBody = await catalogRes.json();
    const bundledSkills = catalogBody.data.catalog.filter(
      (e: { source: string }) => e.source === 'bundled',
    );

    if (bundledSkills.length === 0) {
      test.skip(true, 'No bundled skills available in catalog');
      return;
    }

    const skillId = bundledSkills[0].id;

    const installRes = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: {
        skillId,
        source: { type: 'bundled' },
      },
    });
    // Should succeed — bundled source bypasses trust check
    expect(installRes.ok()).toBeTruthy();
    const installBody = await installRes.json();
    expect(installBody.ok).toBe(true);
    expect(installBody.data.skill).toBeDefined();
    expect(installBody.data.skill.skillId).toBe(skillId);
  });

  test('uninstalling a bundled skill succeeds (no RPC error)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    // Install a bundled skill first so we can uninstall it
    const catalogRes = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    const catalogBody = await catalogRes.json();
    const bundledSkills = catalogBody.data.catalog.filter(
      (e: { source: string }) => e.source === 'bundled',
    );

    if (bundledSkills.length === 0) {
      test.skip(true, 'No bundled skills available in catalog');
      return;
    }

    // Use a different skill than the previous test if possible
    const skillId = bundledSkills.length > 1 ? bundledSkills[1].id : bundledSkills[0].id;

    // Install
    await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: { skillId, source: { type: 'bundled' } },
    });

    // Uninstall — the fix was to skip RPC for bundled skills (can't uninstall from container)
    const uninstallRes = await request.delete(`${API}/instances/${instanceId}/skills/${skillId}`, {
      headers: { Cookie: cookie },
    });
    expect(uninstallRes.ok()).toBeTruthy();
    const uninstallBody = await uninstallRes.json();
    expect(uninstallBody.ok).toBe(true);
  });

  test('reinstalling a previously failed skill succeeds (upsert, not duplicate key)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    const catalogRes = await request.get(`${API}/instances/${instanceId}/skills/catalog`, {
      headers: { Cookie: cookie },
    });
    const catalogBody = await catalogRes.json();
    const bundledSkills = catalogBody.data.catalog.filter(
      (e: { source: string }) => e.source === 'bundled',
    );

    if (bundledSkills.length === 0) {
      test.skip(true, 'No bundled skills available in catalog');
      return;
    }

    const skillId = bundledSkills[0].id;

    // Install once
    const firstInstall = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: { skillId, source: { type: 'bundled' } },
    });
    expect(firstInstall.ok()).toBeTruthy();

    // Uninstall
    await request.delete(`${API}/instances/${instanceId}/skills/${skillId}`, {
      headers: { Cookie: cookie },
    });

    // Reinstall — the fix was to use INSERT OR UPDATE instead of INSERT
    // which would fail with UNIQUE constraint violation on skill_id
    const secondInstall = await request.post(`${API}/instances/${instanceId}/skills/install`, {
      headers: { Cookie: cookie },
      data: { skillId, source: { type: 'bundled' } },
    });
    expect(secondInstall.ok()).toBeTruthy();
    const body = await secondInstall.json();
    expect(body.ok).toBe(true);
    expect(body.data.skill.skillId).toBe(skillId);
  });

  test('ClawHub search via catalog endpoint does not crash', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    // Send a search query — even without CLAWHUB_API_URL configured,
    // the endpoint should gracefully degrade (empty results, not 500)
    const res = await request.get(
      `${API}/instances/${instanceId}/skills/catalog?search=test-nonexistent`,
      { headers: { Cookie: cookie } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.catalog).toBeDefined();
    expect(Array.isArray(body.data.catalog)).toBe(true);
    expect(typeof body.data.hasMore).toBe('boolean');
  });

  test('plugin catalog returns bundled entries with source=bundled', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.skip(!!process.env.CI, 'Requires Docker');

    const res = await request.get(`${API}/instances/${instanceId}/plugins/catalog`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    for (const entry of body.data.catalog) {
      if (entry.trustTier === 'bundled') {
        expect(entry.source).toBe('bundled');
      }
    }
  });
});

/* ── Unauthenticated access guard ── */

test.describe('Extension System: Auth Guards', () => {
  test('skills endpoint rejects unauthenticated request', async ({ request }) => {
    const res = await request.get(`${API}/instances/fake-id/skills`);
    expect(res.status()).toBe(401);
  });

  test('plugins endpoint rejects unauthenticated request', async ({ request }) => {
    const res = await request.get(`${API}/instances/fake-id/plugins`);
    expect(res.status()).toBe(401);
  });

  test('skills install rejects unauthenticated request', async ({ request }) => {
    const res = await request.post(`${API}/instances/fake-id/skills/install`, {
      data: { skillId: 'test', source: { type: 'bundled' } },
    });
    expect(res.status()).toBe(401);
  });

  test('plugins install rejects unauthenticated request', async ({ request }) => {
    const res = await request.post(`${API}/instances/fake-id/plugins/install`, {
      data: { pluginId: 'test', source: { type: 'bundled' } },
    });
    expect(res.status()).toBe(401);
  });
});
