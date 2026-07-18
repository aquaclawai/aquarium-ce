import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 16 — Runtime Registry + Bridge E2E coverage.
 *
 * Covers: RT-01, RT-02, RT-03 (rename + delete via FK CASCADE), RT-04 (derived
 * status + ST1), RT-05 (offline sweeper), plus an ST1 global proof that the
 * stored `runtimes.status` column for hosted_instance rows never changes from
 * its 'offline' placeholder throughout the test run.
 *
 * Patterns (new to the repo, but intentional for this spec):
 *   - Direct SQLite read/write against ~/.aquarium/aquarium.db via better-sqlite3
 *     — the only way to assert ST1 at the column level and to inject a stale
 *     daemon fixture for RT-05 without a /api/daemon/register route (Phase 19).
 *   - Unauthenticated probe acknowledges CE-mode pass-through auth (first user
 *     auto-authenticates when no token cookie is present).
 */

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api';
const DB_PATH = process.env.AQUARIUM_DB_PATH || join(homedir(), '.aquarium', 'aquarium.db');
const DEFAULT_WORKSPACE_ID = 'AQ';

function uniqueEmail(): string {
  return `runtimes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function pollUntil<T>(
  fn: () => Promise<T | null> | T | null,
  timeoutMs: number,
  intervalMs = 100,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`[runtimes.spec] pollUntil '${label}' timed out after ${timeoutMs}ms (last=${String(last)})`);
}

interface RuntimeShape {
  id: string;
  name: string;
  kind: 'local_daemon' | 'external_cloud_daemon' | 'hosted_instance';
  provider: string;
  status: 'online' | 'offline' | 'error';
  instanceId: string | null;
  daemonId: string | null;
  lastHeartbeatAt: string | null;
}

async function listRuntimes(request: APIRequestContext): Promise<RuntimeShape[]> {
  const res = await request.get(`${API}/runtimes`);
  expect(res.ok(), `GET /api/runtimes failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; data?: RuntimeShape[]; error?: string };
  expect(body.ok).toBe(true);
  return body.data ?? [];
}

async function findMirrorByInstance(
  request: APIRequestContext,
  instanceId: string,
): Promise<RuntimeShape | null> {
  const runtimes = await listRuntimes(request);
  return runtimes.find((r) => r.instanceId === instanceId) ?? null;
}

/**
 * Signs up a disposable test user via the test-signup API and returns the
 * cookie jar attached to the page's request context. CE has no /signup UI
 * route — the TestLoginPage in `apps/web/src/pages/TestLoginPage.tsx` invokes
 * the same `/api/auth/test-signup` endpoint. Using the API directly is
 * faster + browser-DOM-free.
 */
async function signupTestUser(
  request: APIRequestContext,
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password, displayName },
  });
  expect(res.status(), `test-signup failed: ${await res.text()}`).toBe(201);
}

test.describe.serial('Phase 16 — Runtime Registry + Bridge', () => {
  const email = uniqueEmail();
  const password = 'RuntimesTest123!';
  const displayName = 'Runtimes Tester';
  const instanceName = uniqueName('rt-inst');
  let instanceId = '';

  test.beforeAll(() => {
    // Fail loudly if DB_PATH is misconfigured — catches "wrong DB_PATH" before
    // the first SQL query inside a test body.
    const probe = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    probe.close();
  });

  test('signup disposable test user via /api/auth/test-signup', async ({ request }) => {
    await signupTestUser(request, email, password, displayName);
  });

  test('RT-01: GET /api/runtimes returns 200 with a Runtime[] shape', async ({ request, browser }) => {
    // Anonymous probe — in CE mode, requireAuth auto-authenticates as the first
    // user when no token cookie is present (see apps/server/src/middleware/auth.ts
    // lines 60-74), so anonymous requests still succeed. In EE (Clerk secret set)
    // this would 401. We assert shape either way: ok:true + Array data.
    const anonContext = await browser.newContext();
    const anonRes = await anonContext.request.get(`${API}/runtimes`);
    const anonStatus = anonRes.status();
    expect([200, 401]).toContain(anonStatus);
    if (anonStatus === 200) {
      const anonBody = (await anonRes.json()) as { ok: boolean; data?: unknown };
      expect(anonBody.ok).toBe(true);
      expect(Array.isArray(anonBody.data)).toBe(true);
    }
    await anonContext.close();

    // Authenticated request returns 200 with Runtime[]
    const runtimes = await listRuntimes(request);
    expect(Array.isArray(runtimes)).toBe(true);
    for (const r of runtimes) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('kind');
      expect(['hosted_instance', 'local_daemon', 'external_cloud_daemon']).toContain(r.kind);
      expect(['online', 'offline', 'error']).toContain(r.status);
    }
  });

  test('RT-02: creating an instance produces a mirror runtime within 2s', async ({ request }) => {
    const createRes = await request.post(`${API}/instances`, {
      data: { name: instanceName, agentType: 'openclaw' },
    });
    expect(createRes.ok(), `create instance failed: ${await createRes.text()}`).toBeTruthy();
    const createBody = (await createRes.json()) as { ok: boolean; data?: { id: string } };
    expect(createBody.ok).toBe(true);
    instanceId = createBody.data?.id ?? '';
    expect(instanceId).toBeTruthy();

    const t0 = Date.now();
    const mirror = await pollUntil(
      () => findMirrorByInstance(request, instanceId),
      2000,
      100,
      `mirror runtime for instance ${instanceId}`,
    );
    const elapsed = Date.now() - t0;

    expect(mirror.kind).toBe('hosted_instance');
    expect(mirror.provider).toBe('hosted');
    expect(mirror.name).toBe(instanceName);
    expect(mirror.daemonId).toBeNull();
    console.log(`[RT-02] mirror appeared in ${elapsed}ms`);
  });

  test('RT-03: renaming instance propagates to mirror.name within 2s', async ({ request }) => {
    expect(instanceId, 'RT-02 must run before RT-03').toBeTruthy();
    const renamed = `${instanceName}-renamed`;
    const patchRes = await request.patch(`${API}/instances/${instanceId}/config`, {
      data: { agentName: renamed },
    });
    expect(patchRes.ok(), `patch config failed: ${await patchRes.text()}`).toBeTruthy();

    const t0 = Date.now();
    const mirror = await pollUntil(
      async () => {
        const m = await findMirrorByInstance(request, instanceId);
        return m && m.name === renamed ? m : null;
      },
      2000,
      100,
      `mirror.name = ${renamed}`,
    );
    const elapsed = Date.now() - t0;
    expect(mirror.name).toBe(renamed);
    console.log(`[RT-03 rename] mirror.name updated in ${elapsed}ms`);
  });

  test('RT-03: deleting instance removes mirror runtime within 2s (FK CASCADE)', async ({ request }) => {
    expect(instanceId, 'RT-02 must run before RT-03-delete').toBeTruthy();
    const delRes = await request.delete(`${API}/instances/${instanceId}?purge=true`);
    expect(delRes.ok(), `delete instance failed: ${await delRes.text()}`).toBeTruthy();

    const t0 = Date.now();
    await pollUntil<'deleted'>(
      async () => {
        const m = await findMirrorByInstance(request, instanceId);
        return m === null ? 'deleted' : null;
      },
      2000,
      100,
      `mirror row for ${instanceId} gone`,
    );
    const elapsed = Date.now() - t0;
    console.log(`[RT-03 delete] mirror CASCADE removed in ${elapsed}ms`);

    // Also assert CASCADE at the SQL level for defense in depth
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare(`SELECT id FROM runtimes WHERE instance_id = ?`).get(instanceId);
    db.close();
    expect(row).toBeUndefined();
  });

  test('RT-04: derived status + ST1 — stored r.status never written for hosted rows', async ({ request }) => {
    // Create a second instance specifically for RT-04 (RT-03 already deleted the first)
    const rt4Name = uniqueName('rt04');
    const createRes = await request.post(`${API}/instances`, {
      data: { name: rt4Name, agentType: 'openclaw' },
    });
    expect(createRes.ok(), `create rt04 instance failed: ${await createRes.text()}`).toBeTruthy();
    const createBody = (await createRes.json()) as { ok: boolean; data?: { id: string; status: string } };
    const rt4InstanceId = createBody.data?.id ?? '';
    expect(rt4InstanceId).toBeTruthy();

    await pollUntil(() => findMirrorByInstance(request, rt4InstanceId), 2000, 100, 'rt04 mirror');

    // Direct SQL: stored runtimes.status for a hosted_instance row must be
    // the 'offline' placeholder. ST1 HARD: bridge never writes this column
    // for hosted rows post-INSERT, even when instance transitions state.
    const dbRead = new Database(DB_PATH, { readonly: true });
    const storedRow = dbRead
      .prepare(
        `SELECT r.status AS stored_status, i.status AS instance_status, r.kind
         FROM runtimes r
         JOIN instances i ON r.instance_id = i.id
         WHERE r.instance_id = ? AND r.workspace_id = ?`,
      )
      .get(rt4InstanceId, DEFAULT_WORKSPACE_ID) as
      | { stored_status: string; instance_status: string; kind: string }
      | undefined;
    dbRead.close();

    expect(storedRow, 'expected mirror row to exist in runtimes').toBeDefined();
    expect(storedRow!.kind).toBe('hosted_instance');
    expect(storedRow!.stored_status).toBe('offline'); // ST1: placeholder never mutated
    expect(['created', 'stopped']).toContain(storedRow!.instance_status);

    // GET-side: API returns derived status (instance=created → offline)
    const mirror = await findMirrorByInstance(request, rt4InstanceId);
    expect(mirror).toBeTruthy();
    expect(mirror!.status).toBe('offline');

    // Cleanup RT-04 fixture
    const delRes = await request.delete(`${API}/instances/${rt4InstanceId}?purge=true`);
    expect(delRes.ok()).toBeTruthy();
  });

  test('RT-05: daemon runtime with stale heartbeat flips offline within one sweep tick', async () => {
    // Inject a fake daemon runtime with a stale heartbeat directly into the DB.
    // The offline-sweeper (apps/server/src/task-dispatch/offline-sweeper.ts)
    // runs every 30s and transitions rows where last_heartbeat_at < now-90s
    // to 'offline'. A 45s budget covers one full cycle plus tick jitter.
    test.setTimeout(120_000);
    const dbWrite = new Database(DB_PATH);
    const fakeId = `rt05-daemon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fakeDaemonId = `rt05-daemon-id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const staleIso = new Date(Date.now() - 120_000).toISOString();
    const nowIso = new Date().toISOString();

    try {
      dbWrite
        .prepare(
          `INSERT INTO runtimes
             (id, workspace_id, name, kind, provider, status, daemon_id, instance_id,
              metadata, last_heartbeat_at, created_at, updated_at)
           VALUES (?, ?, ?, 'local_daemon', 'claude', 'online', ?, NULL,
              '{}', ?, ?, ?)`,
        )
        .run(fakeId, DEFAULT_WORKSPACE_ID, 'RT-05 test daemon', fakeDaemonId, staleIso, nowIso, nowIso);

      // Seed check
      const pre = dbWrite
        .prepare(`SELECT status FROM runtimes WHERE id = ?`)
        .get(fakeId) as { status: string } | undefined;
      expect(pre?.status).toBe('online');

      const t0 = Date.now();
      await pollUntil<'flipped'>(
        () => {
          const row = dbWrite.prepare(`SELECT status FROM runtimes WHERE id = ?`).get(fakeId) as
            | { status: string }
            | undefined;
          return row?.status === 'offline' ? 'flipped' : null;
        },
        45_000,
        500,
        `daemon ${fakeId} status -> offline`,
      );
      const elapsed = Date.now() - t0;
      console.log(`[RT-05] sweeper flipped daemon to offline in ${elapsed}ms`);
    } finally {
      // Cleanup even if assertions throw
      dbWrite.prepare(`DELETE FROM runtimes WHERE id = ?`).run(fakeId);
      dbWrite.close();
    }
  });

  test('ST1 global proof: r.status for every hosted_instance row is still offline placeholder', async () => {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db
      .prepare(
        `SELECT r.id, r.status, i.status AS instance_status
         FROM runtimes r
         LEFT JOIN instances i ON r.instance_id = i.id
         WHERE r.kind = 'hosted_instance' AND r.workspace_id = ?`,
      )
      .all(DEFAULT_WORKSPACE_ID) as Array<{
        id: string;
        status: string;
        instance_status: string | null;
      }>;
    db.close();

    for (const row of rows) {
      expect(
        row.status,
        `hosted mirror ${row.id} r.status must be offline placeholder (ST1)`,
      ).toBe('offline');
    }
  });
});
