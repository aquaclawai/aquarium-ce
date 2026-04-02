import { test, expect } from '@playwright/test';
import { API, signupAndGetCookie } from './helpers';

/**
 * Advanced Snapshot API tests — covers gaps in acceptance criteria (§11)
 * that are NOT covered by snapshot-api.spec.ts or snapshot-browser.spec.ts:
 *
 * 1. Diff with actual modifications (modified / added / removed entries)
 * 2. Restore updates instance config in DB
 * 3. Config change (PATCH /config) triggers pre_operation auto-snapshot
 * 4. Restart triggers pre_operation auto-snapshot
 * 5. Credential refs are captured in snapshot
 * 6. Cross-user isolation (user B cannot access user A's snapshots)
 */

test.describe.serial('Snapshot Advanced — Diff & Restore Config', () => {
  let cookie: string;
  let instanceId: string;
  let snapshotId: string;

  const originalConfig = {
    'AGENTS.md': '# Original agents config',
    'SOUL.md': '# Original soul config',
    'IDENTITY.md': '# Original identity',
  };

  const modifiedConfig = {
    'AGENTS.md': '# Modified agents config',
    'SOUL.md': '# Original soul config', // unchanged
    // IDENTITY.md removed
    'TOOLS.md': '# New tools file', // added
  };

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);

    // Create instance with known config
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `snap-adv-${Date.now()}`, agentType: 'openclaw' },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceId = body.data.id;

    // Set initial config via PATCH
    const configRes = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: originalConfig,
    });
    expect(configRes.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('create snapshot of original config', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'original config snapshot' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    snapshotId = body.data.id;

    // Verify config was captured in snapshot
    expect(body.data.configSnapshot).toBeDefined();
    expect(body.data.configSnapshot['AGENTS.md']).toBe('# Original agents config');
    expect(body.data.configSnapshot['SOUL.md']).toBe('# Original soul config');
    expect(body.data.configSnapshot['IDENTITY.md']).toBe('# Original identity');
  });

  test('modify instance config to create divergence', async ({ request }) => {
    // Overwrite config with modified version (deep-merge via PATCH)
    // Since patchGatewayConfig does deep merge, we need to send the full config.
    // But deep merge won't remove keys, so we'll just modify existing ones and add new ones.
    const res = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: {
        'AGENTS.md': '# Modified agents config',
        'TOOLS.md': '# New tools file',
      },
    });
    expect(res.ok()).toBeTruthy();

    // Verify the instance config was updated
    const instRes = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const instBody = await instRes.json();
    expect(instBody.ok).toBe(true);
    expect(instBody.data.config['AGENTS.md']).toBe('# Modified agents config');
    expect(instBody.data.config['TOOLS.md']).toBe('# New tools file');
    // SOUL.md should be unchanged (deep merge preserves it)
    expect(instBody.data.config['SOUL.md']).toBe('# Original soul config');
  });

  test('diff shows modified and added entries', async ({ request }) => {
    const res = await request.get(
      `${API}/instances/${instanceId}/snapshots/${snapshotId}/diff`,
      { headers: { Cookie: cookie } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.snapshotId).toBe(snapshotId);
    expect(Array.isArray(body.data.changes)).toBe(true);

    const changes = body.data.changes as Array<{
      file: string;
      type: 'modified' | 'added' | 'removed' | 'unchanged';
      snapshotContent?: string;
      currentContent?: string;
    }>;

    // AGENTS.md should be modified
    const agentsEntry = changes.find((c) => c.file === 'AGENTS.md');
    expect(agentsEntry).toBeDefined();
    expect(agentsEntry!.type).toBe('modified');
    expect(agentsEntry!.snapshotContent).toBe('# Original agents config');
    expect(agentsEntry!.currentContent).toBe('# Modified agents config');

    // SOUL.md should be unchanged
    const soulEntry = changes.find((c) => c.file === 'SOUL.md');
    expect(soulEntry).toBeDefined();
    expect(soulEntry!.type).toBe('unchanged');

    // TOOLS.md was added (not in snapshot, exists in current)
    const toolsEntry = changes.find((c) => c.file === 'TOOLS.md');
    expect(toolsEntry).toBeDefined();
    expect(toolsEntry!.type).toBe('added');
    expect(toolsEntry!.currentContent).toBe('# New tools file');
  });

  test('restore snapshot rolls back instance config in DB', async ({ request }) => {
    // Restore the original config snapshot
    const restoreRes = await request.post(
      `${API}/instances/${instanceId}/snapshots/${snapshotId}/restore`,
      { headers: { Cookie: cookie } },
    );
    expect(restoreRes.ok()).toBeTruthy();
    const restoreBody = await restoreRes.json();
    expect(restoreBody.ok).toBe(true);

    // Verify the instance config was rolled back
    const instRes = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    const instBody = await instRes.json();
    expect(instBody.ok).toBe(true);

    // Config should match the snapshot's config
    expect(instBody.data.config['AGENTS.md']).toBe('# Original agents config');
    expect(instBody.data.config['SOUL.md']).toBe('# Original soul config');
    expect(instBody.data.config['IDENTITY.md']).toBe('# Original identity');
  });
});

test.describe.serial('Snapshot Advanced — Auto-Snapshot Triggers', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);

    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `snap-auto-${Date.now()}`, agentType: 'openclaw' },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('initially no snapshots', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(0);
  });

  test('config change (PATCH) triggers pre_operation auto-snapshot', async ({ request }) => {
    // PATCH config — should trigger safeAutoSnapshot internally
    const patchRes = await request.patch(`${API}/instances/${instanceId}/config`, {
      headers: { Cookie: cookie },
      data: { 'AGENTS.md': '# Updated config via PATCH' },
    });
    expect(patchRes.ok()).toBeTruthy();

    // Check that a pre_operation snapshot was auto-created
    const listRes = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data.total).toBeGreaterThanOrEqual(1);

    const preOpSnapshots = listBody.data.items.filter(
      (s: { triggerType: string }) => s.triggerType === 'pre_operation',
    );
    expect(preOpSnapshots.length).toBeGreaterThanOrEqual(1);

    // The trigger detail should mention config modification
    const configSnap = preOpSnapshots.find(
      (s: { triggerDetail: string | null }) => s.triggerDetail?.includes('修改'),
    );
    expect(configSnap).toBeDefined();
  });

  test('restart triggers pre_operation auto-snapshot', async ({ request }) => {
    const countBefore = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    const beforeBody = await countBefore.json();
    const totalBefore = beforeBody.data.total;

    // Restart — will fail at Docker level since instance is 'created',
    // but safeAutoSnapshot runs BEFORE Docker operations
    await request.post(`${API}/instances/${instanceId}/restart`, {
      headers: { Cookie: cookie },
    });
    // We don't check the restart response status — it may fail due to no Docker.
    // The important thing is the snapshot was created.

    const listRes = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data.total).toBeGreaterThan(totalBefore);

    // Find the restart-triggered snapshot
    const restartSnap = listBody.data.items.find(
      (s: { triggerType: string; triggerDetail: string | null }) =>
        s.triggerType === 'pre_operation' && s.triggerDetail?.includes('重启'),
    );
    expect(restartSnap).toBeDefined();
  });
});

test.describe.serial('Snapshot Advanced — Credential Refs', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);

    // Create instance
    const instRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `snap-creds-${Date.now()}`, agentType: 'openclaw' },
    });
    const instBody = await instRes.json();
    expect(instBody.ok).toBe(true);
    instanceId = instBody.data.id;

    // Add a credential to the instance
    const credRes = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
      data: { provider: 'openai', credentialType: 'api_key', value: 'sk-test-for-snapshot' },
    });
    expect(credRes.status()).toBe(201);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('snapshot captures credential refs (provider/type only, no values)', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'snapshot with credentials' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // credentialRefs should include the credential metadata
    expect(Array.isArray(body.data.credentialRefs)).toBe(true);
    expect(body.data.credentialRefs.length).toBe(1);
    expect(body.data.credentialRefs[0].provider).toBe('openai');
    expect(body.data.credentialRefs[0].type).toBe('api_key');

    // Ensure no encrypted values leaked
    const snapshot = body.data;
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('sk-test-for-snapshot');
  });

  test('workspaceFiles is empty for non-running instance', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'non-running workspace check' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.workspaceFiles).toEqual({});
  });
});

test.describe.serial('Snapshot Advanced — Cross-User Isolation', () => {
  // Verify that snapshot routes enforce instance ownership.
  // User B must NOT be able to access user A's snapshots.
  let cookieA: string;
  let cookieB: string;
  let instanceIdA: string;
  let snapshotIdA: string;

  test.beforeAll(async ({ request }) => {
    // User A
    cookieA = await signupAndGetCookie(request);
    const instA = await request.post(`${API}/instances`, {
      headers: { Cookie: cookieA },
      data: { name: `snap-iso-a-${Date.now()}`, agentType: 'openclaw' },
    });
    const bodyA = await instA.json();
    expect(bodyA.ok).toBe(true);
    instanceIdA = bodyA.data.id;

    // User A creates a snapshot
    const snapRes = await request.post(`${API}/instances/${instanceIdA}/snapshots`, {
      headers: { Cookie: cookieA },
      data: { description: 'User A snapshot' },
    });
    expect(snapRes.status()).toBe(201);
    const snapBody = await snapRes.json();
    snapshotIdA = snapBody.data.id;

    // User B
    cookieB = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceIdA}`, {
      headers: { Cookie: cookieA },
    }).catch(() => {});
  });

  test('user B cannot list user A snapshots', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceIdA}/snapshots`, {
      headers: { Cookie: cookieB },
    });
    expect(res.ok()).toBeFalsy();
  });

  test('user B cannot get user A single snapshot', async ({ request }) => {
    const res = await request.get(
      `${API}/instances/${instanceIdA}/snapshots/${snapshotIdA}`,
      { headers: { Cookie: cookieB } },
    );
    expect(res.ok()).toBeFalsy();
  });

  test('user B cannot delete user A snapshot', async ({ request }) => {
    const res = await request.delete(
      `${API}/instances/${instanceIdA}/snapshots/${snapshotIdA}`,
      { headers: { Cookie: cookieB } },
    );
    expect(res.ok()).toBeFalsy();

    // Verify snapshot still exists for user A
    const verifyRes = await request.get(
      `${API}/instances/${instanceIdA}/snapshots/${snapshotIdA}`,
      { headers: { Cookie: cookieA } },
    );
    expect(verifyRes.ok()).toBeTruthy();
  });

  test('user B cannot restore user A snapshot', async ({ request }) => {
    const res = await request.post(
      `${API}/instances/${instanceIdA}/snapshots/${snapshotIdA}/restore`,
      { headers: { Cookie: cookieB } },
    );
    expect(res.ok()).toBeFalsy();
  });

  test('user B cannot diff user A snapshot', async ({ request }) => {
    const res = await request.get(
      `${API}/instances/${instanceIdA}/snapshots/${snapshotIdA}/diff`,
      { headers: { Cookie: cookieB } },
    );
    expect(res.ok()).toBeFalsy();
  });
});
