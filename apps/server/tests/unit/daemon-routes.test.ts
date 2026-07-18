import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Knex } from 'knex';
import {
  setupTestDb,
  teardownTestDb,
  seedRuntime,
  seedAgent,
  seedIssue,
  seedTask,
  seedDaemonToken,
  type TestDbContext,
} from './test-db.js';
import {
  __setDaemonAuthDbForTests__,
  __resetDaemonAuthDb__,
} from '../../src/middleware/daemon-auth.js';
import {
  __setDbForTests__,
  __resetDbForTests__,
} from '../../src/db/index.js';

/**
 * Phase 19-02 daemon-routes integration tests.
 *
 * Mounts the router under /api/daemon on a throwaway Express app, pointed at
 * an isolated SQLite fixture via the two db-override hooks:
 *
 *   • __setDaemonAuthDbForTests__  — lets the auth middleware read the fixture
 *   • __setDbForTests__            — swaps the app-wide db singleton so
 *                                    runtime-registry / task-queue services
 *                                    see the fixture (they import { db } directly)
 *
 * Tests cover the behaviours locked by 19-02-PLAN.md must_haves.truths:
 *   - register / heartbeat / deregister (DAEMON-01..03)
 *   - runtimes/:id/tasks/claim (DAEMON-04, workspace-scoping)
 *   - tasks/:id/{start,progress,messages,complete,fail,status} (DAEMON-05..06)
 *   - cancel-race returns HTTP 200 with { discarded: true } (TASK-06)
 *   - /heartbeat 409 when daemonId is null
 *   - /messages batch-cap 413
 */

interface TestServer {
  server: Server;
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

async function startTestApp(): Promise<TestServer> {
  // Dynamic import so the router resolves AFTER we call __setDbForTests__.
  const { default: daemonRoutes } = await import('../../src/routes/daemon.js');
  const app = express();
  app.use(express.json());
  app.use('/api/daemon', daemonRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface Ctx {
  db: TestDbContext;
  app: TestServer;
}

async function bootstrap(): Promise<Ctx> {
  const db = await setupTestDb();
  __setDaemonAuthDbForTests__(db.db);
  __setDbForTests__(db.db);
  const app = await startTestApp();
  return { db, app };
}

async function shutdown(ctx: Ctx): Promise<void> {
  try {
    await ctx.app.close();
  } catch {
    // ignore
  }
  __resetDaemonAuthDb__();
  __resetDbForTests__();
  await teardownTestDb(ctx.db);
}

async function jsonFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function bearer(plaintext: string): Record<string, string> {
  return { authorization: `Bearer ${plaintext}` };
}

// Seed a workspace-scoped daemon token with daemon_id already populated (so
// /heartbeat passes the lifecycle guard). Returns { plaintext, tokenId }.
async function seedActiveDaemonToken(
  db: Knex,
  opts: { daemonId?: string | null; workspaceId?: string } = {},
): Promise<{ plaintext: string; tokenId: string }> {
  const seeded = await seedDaemonToken(db, {
    workspaceId: opts.workspaceId ?? 'AQ',
    daemonId: opts.daemonId !== undefined ? opts.daemonId : 'D1',
  });
  return { plaintext: seeded.plaintext, tokenId: seeded.id };
}

// ── Test 1: register happy path ─────────────────────────────────────────────

test('daemon-routes: POST /register upserts runtimes per provider (DAEMON-01)', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db, { daemonId: null });
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/register`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: {
        workspaceId: 'AQ',
        daemonId: 'D1',
        deviceName: 'laptop',
        cliVersion: '0.1',
        launchedBy: 'shuai',
        runtimes: [
          { name: 'claude-cli', provider: 'claude', version: '1.0.0', status: 'online' },
        ],
      },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { runtimes: Array<Record<string, unknown>> } };
    assert.equal(body.ok, true);
    assert.equal(body.data.runtimes.length, 1);
    assert.equal(body.data.runtimes[0].provider, 'claude');
    assert.equal(body.data.runtimes[0].kind, 'local_daemon');
    assert.equal(body.data.runtimes[0].status, 'online');

    // DB row exists
    const row = await ctx.db.db('runtimes')
      .where({ workspace_id: 'AQ', daemon_id: 'D1', provider: 'claude' })
      .first();
    assert.ok(row, 'runtime row persisted');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 2: /register rejects workspaceId mismatch ──────────────────────────

test('daemon-routes: POST /register rejects body workspaceId mismatch (400)', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/register`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: {
        workspaceId: 'OTHER',
        daemonId: 'D1',
        deviceName: 'x',
        cliVersion: 'x',
        launchedBy: 'x',
        runtimes: [{ name: 'n', provider: 'claude', version: '1', status: 'online' }],
      },
    });
    assert.equal(res.status, 400);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /workspace mismatch/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 3: /register without Authorization → 401 ───────────────────────────

test('daemon-routes: POST /register without auth returns 401', async () => {
  const ctx = await bootstrap();
  try {
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/register`, {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 401);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 4: /heartbeat updates last_heartbeat_at ────────────────────────────

test('daemon-routes: POST /heartbeat updates last_heartbeat_at (DAEMON-02)', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db, { daemonId: 'D1' });
    const runtimeId = await seedRuntime(ctx.db.db, { status: 'offline' });
    const before = await ctx.db.db('runtimes').where({ id: runtimeId }).first('last_heartbeat_at', 'status');
    await new Promise((r) => setTimeout(r, 20));

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/heartbeat`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { runtimeIds: [runtimeId] },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { pendingPings: unknown[]; pendingUpdates: unknown[] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.pendingPings, []);
    assert.deepEqual(body.data.pendingUpdates, []);

    const after = await ctx.db.db('runtimes').where({ id: runtimeId }).first('last_heartbeat_at', 'status');
    assert.notEqual(String(after.last_heartbeat_at), String(before.last_heartbeat_at));
    assert.equal(after.status, 'online');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 5: /heartbeat 409 when daemon_id is null ───────────────────────────

test('daemon-routes: POST /heartbeat returns 409 when daemonId is null', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db, { daemonId: null });
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/heartbeat`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { runtimeIds: [] },
    });
    assert.equal(res.status, 409);
    const body = res.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /daemon not registered/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 6: /deregister sets status = 'offline' ─────────────────────────────

test('daemon-routes: POST /deregister flips runtimes to offline (DAEMON-03)', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db, { status: 'online' });
    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/deregister`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { runtimeIds: [runtimeId] },
    });
    assert.equal(res.status, 200);
    const row = await ctx.db.db('runtimes').where({ id: runtimeId }).first('status');
    assert.equal(row.status, 'offline');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 7: /claim dispatches the queued task ───────────────────────────────

test('daemon-routes: POST /runtimes/:id/tasks/claim returns ClaimedTask (DAEMON-04)', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, { issueId, agentId, runtimeId });

    const res = await jsonFetch(
      `${ctx.app.baseUrl}/api/daemon/runtimes/${runtimeId}/tasks/claim`,
      { method: 'POST', headers: bearer(plaintext), body: {} },
    );
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { task: { id: string; status: string } | null } };
    assert.equal(body.ok, true);
    assert.ok(body.data.task, 'task present');
    assert.equal(body.data.task?.id, taskId);
    assert.equal(body.data.task?.status, 'dispatched');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 8: /claim returns null when nothing queued ─────────────────────────

test('daemon-routes: POST /claim returns null when no queued work', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);

    const res = await jsonFetch(
      `${ctx.app.baseUrl}/api/daemon/runtimes/${runtimeId}/tasks/claim`,
      { method: 'POST', headers: bearer(plaintext), body: {} },
    );
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { task: null } };
    assert.equal(body.data.task, null);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 9: cross-workspace runtime → 404 (AUTH4 IDOR guard) ────────────────

test('daemon-routes: POST /claim on cross-workspace runtime returns 404', async () => {
  const ctx = await bootstrap();
  try {
    // Seed workspace OTHER + its runtime before the token (FK seeding order)
    await ctx.db.db('workspaces').insert({
      id: 'OTHER',
      name: 'Other Workspace',
      issue_prefix: 'OT',
      issue_counter: 0,
      metadata: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const foreignRuntime = await seedRuntime(ctx.db.db, { workspaceId: 'OTHER' });

    const { plaintext } = await seedActiveDaemonToken(ctx.db.db, {
      workspaceId: 'AQ',
    });
    const res = await jsonFetch(
      `${ctx.app.baseUrl}/api/daemon/runtimes/${foreignRuntime}/tasks/claim`,
      { method: 'POST', headers: bearer(plaintext), body: {} },
    );
    assert.equal(res.status, 404);
    const body = res.body as { ok: boolean; error: string };
    assert.match(body.error, /runtime not found/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 10: /start transitions dispatched → running ────────────────────────

test('daemon-routes: POST /tasks/:id/start → running', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'dispatched',
      dispatchedAtIso: new Date().toISOString(),
    });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/start`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: {},
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { started: boolean; status: string } };
    assert.equal(body.data.started, true);
    assert.equal(body.data.status, 'running');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 11: /start on already-running task → started:false, status:running ─

test('daemon-routes: POST /tasks/:id/start on already running → started=false', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'running',
      startedAtIso: new Date().toISOString(),
    });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/start`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: {},
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { started: boolean; status: string } };
    assert.equal(body.data.started, false);
    assert.equal(body.data.status, 'running');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 12: /progress: WS-only, no DB mutation ─────────────────────────────

test('daemon-routes: POST /tasks/:id/progress emits event, no DB write', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, { issueId, agentId, runtimeId, status: 'running' });
    const before = await ctx.db.db('agent_task_queue').where({ id: taskId }).first('updated_at');

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/progress`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { progress: 0.5, note: 'halfway' },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { ok: boolean } };
    assert.equal(body.data.ok, true);

    // updated_at unchanged (no DB mutation)
    const after = await ctx.db.db('agent_task_queue').where({ id: taskId }).first('updated_at');
    assert.equal(String(after.updated_at), String(before.updated_at));
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 13: /messages accepts batch ────────────────────────────────────────

test('daemon-routes: POST /tasks/:id/messages accepts batch', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, { issueId, agentId, runtimeId, status: 'running' });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: {
        messages: [
          { type: 'text', content: 'hi', workspaceId: 'AQ', issueId },
          { type: 'text', content: 'there', workspaceId: 'AQ', issueId },
        ],
      },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { accepted: number } };
    assert.equal(body.data.accepted, 2);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 14: /messages 413 on batch too large ───────────────────────────────

test('daemon-routes: POST /tasks/:id/messages rejects >100 batch with 413', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, { issueId, agentId, runtimeId, status: 'running' });

    const messages = Array.from({ length: 101 }, (_, i) => ({
      type: 'text',
      content: `m${i}`,
      workspaceId: 'AQ',
      issueId,
    }));

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { messages },
    });
    assert.equal(res.status, 413);
    const body = res.body as { ok: boolean; error: string };
    assert.match(body.error, /batch too large/);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 15: /complete on running task → completed ──────────────────────────

test('daemon-routes: POST /tasks/:id/complete → status=completed', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'running',
      startedAtIso: new Date().toISOString(),
    });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { result: { ok: true } },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { discarded: boolean; status: string } };
    assert.equal(body.data.discarded, false);
    assert.equal(body.data.status, 'completed');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 16: /complete on cancelled → HTTP 200, discarded=true (TASK-06) ────

test('daemon-routes: POST /tasks/:id/complete on cancelled returns 200 + discarded', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'cancelled',
    });
    // seedTask starts with cancelled_at NULL; set it so CHECK triggers (if any) agree.
    await ctx.db.db('agent_task_queue')
      .where({ id: taskId })
      .update({ cancelled_at: new Date().toISOString() });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { result: { ok: true } },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { discarded: boolean; status: string } };
    assert.equal(body.data.discarded, true);
    assert.equal(body.data.status, 'cancelled');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 17: /fail on running task → failed ─────────────────────────────────

test('daemon-routes: POST /tasks/:id/fail → status=failed', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'running',
      startedAtIso: new Date().toISOString(),
    });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/fail`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { error: 'boom' },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { discarded: boolean; status: string } };
    assert.equal(body.data.discarded, false);
    assert.equal(body.data.status, 'failed');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 18: /fail on cancelled → 200 + discarded ──────────────────────────

test('daemon-routes: POST /tasks/:id/fail on cancelled returns 200 + discarded', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'cancelled',
    });
    await ctx.db.db('agent_task_queue')
      .where({ id: taskId })
      .update({ cancelled_at: new Date().toISOString() });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/fail`, {
      method: 'POST',
      headers: bearer(plaintext),
      body: { error: 'boom' },
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { discarded: boolean; status: string } };
    assert.equal(body.data.discarded, true);
    assert.equal(body.data.status, 'cancelled');
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 19: /status returns current status + cancelled flag ────────────────

test('daemon-routes: GET /tasks/:id/status returns {status, cancelled}', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, { issueId, agentId, runtimeId, status: 'running' });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/status`, {
      method: 'GET',
      headers: bearer(plaintext),
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { status: string; cancelled: boolean } };
    assert.equal(body.data.status, 'running');
    assert.equal(body.data.cancelled, false);
  } finally {
    await shutdown(ctx);
  }
});

// ── Test 20: /status on cancelled task → cancelled:true ─────────────────────

test('daemon-routes: GET /tasks/:id/status on cancelled → cancelled:true', async () => {
  const ctx = await bootstrap();
  try {
    const { plaintext } = await seedActiveDaemonToken(ctx.db.db);
    const runtimeId = await seedRuntime(ctx.db.db);
    const agentId = await seedAgent(ctx.db.db, { runtimeId });
    const issueId = await seedIssue(ctx.db.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'cancelled',
    });
    await ctx.db.db('agent_task_queue')
      .where({ id: taskId })
      .update({ cancelled_at: new Date().toISOString() });

    const res = await jsonFetch(`${ctx.app.baseUrl}/api/daemon/tasks/${taskId}/status`, {
      method: 'GET',
      headers: bearer(plaintext),
    });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean; data: { status: string; cancelled: boolean } };
    assert.equal(body.data.status, 'cancelled');
    assert.equal(body.data.cancelled, true);
  } finally {
    await shutdown(ctx);
  }
});
