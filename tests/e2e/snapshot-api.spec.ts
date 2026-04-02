import { test, expect } from '@playwright/test';
import { API, signupAndGetCookie } from './helpers';

test.describe.serial('Snapshot API', () => {
  let cookie: string;
  let instanceId: string;
  let firstSnapshotId: string;
  let secondSnapshotId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const name = `snap-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
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

  test('list snapshots — initially empty', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  test('create manual snapshot with description', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: { description: 'test snapshot' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeTruthy();
    expect(body.data.triggerType).toBe('manual');
    expect(body.data.description).toBe('test snapshot');
    expect(typeof body.data.configSnapshot).toBe('object');
    expect(body.data.workspaceFiles).toEqual({});
    expect(typeof body.data.totalSizeBytes).toBe('number');
    firstSnapshotId = body.data.id;
  });

  test('create second snapshot without description', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: {},
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.description).toBeNull();
    secondSnapshotId = body.data.id;
  });

  test('list snapshots — returns 2 sorted by created_at desc', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.items.length).toBe(2);
    // Most recent first
    expect(body.data.items[0].id).toBe(secondSnapshotId);
    expect(body.data.items[1].id).toBe(firstSnapshotId);
  });

  test('list snapshots with pagination', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots?page=1&limit=1`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.items.length).toBe(1);
    expect(body.data.totalPages).toBe(2);
  });

  test('get single snapshot', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots/${firstSnapshotId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(firstSnapshotId);
    expect(body.data.instanceId).toBe(instanceId);
    expect(typeof body.data.configSnapshot).toBe('object');
    expect(typeof body.data.workspaceFiles).toBe('object');
    expect(Array.isArray(body.data.credentialRefs)).toBe(true);
    expect(body.data.triggerType).toBe('manual');
    expect(body.data.createdAt).toBeTruthy();
  });

  test('get nonexistent snapshot returns 404', async ({ request }) => {
    const res = await request.get(
      `${API}/instances/${instanceId}/snapshots/00000000-0000-0000-0000-000000000000`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('diff snapshot vs current — all unchanged', async ({ request }) => {
    const res = await request.get(
      `${API}/instances/${instanceId}/snapshots/${firstSnapshotId}/diff`,
      { headers: { Cookie: cookie } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.snapshotId).toBe(firstSnapshotId);
    expect(body.data.snapshotCreatedAt).toBeTruthy();
    expect(Array.isArray(body.data.changes)).toBe(true);
    for (const entry of body.data.changes) {
      expect(entry.type).toBe('unchanged');
    }
  });

  test('restore snapshot creates pre_operation auto-snapshot', async ({ request }) => {
    const res = await request.post(
      `${API}/instances/${instanceId}/snapshots/${firstSnapshotId}/restore`,
      { headers: { Cookie: cookie } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('verify pre-restore auto-snapshot was created', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    // 2 manual + 1 pre_operation = at least 3
    expect(body.data.total).toBeGreaterThanOrEqual(3);
    const preOp = body.data.items.find(
      (s: { triggerType: string }) => s.triggerType === 'pre_operation',
    );
    expect(preOp).toBeDefined();
  });

  test('delete snapshot', async ({ request }) => {
    const delRes = await request.delete(
      `${API}/instances/${instanceId}/snapshots/${secondSnapshotId}`,
      { headers: { Cookie: cookie } },
    );
    expect(delRes.ok()).toBeTruthy();
    const delBody = await delRes.json();
    expect(delBody.ok).toBe(true);

    // Confirm it's gone
    const getRes = await request.get(
      `${API}/instances/${instanceId}/snapshots/${secondSnapshotId}`,
      { headers: { Cookie: cookie } },
    );
    expect(getRes.status()).toBe(404);
  });

  test('unauthenticated access rejected', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/snapshots`);
    expect(res.status()).toBe(401);
  });
});
