import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import {
  setupTestDb,
  teardownTestDb,
  seedAgent,
  seedIssue,
  seedRuntime,
  seedTask,
} from './test-db.js';
import {
  failOrphanedHostedTasks,
  __setBroadcastForTests__,
  __resetBroadcastForTests__,
} from '../../src/task-dispatch/hosted-orphan-sweep.js';

/**
 * Phase 20-03 hosted-orphan-sweep tests.
 *
 * Ships HOSTED-04: on every server boot, fail all in-flight hosted tasks
 * (status IN ('dispatched','running') with runtime.kind='hosted_instance')
 * before the task-reaper's first sweep fires.
 *
 * Tests:
 *   1. Happy path — hosted in-flight rows flip to failed; daemon rows and
 *      hosted queued rows are untouched.
 *   2. Empty table — no rows, no throw, returns {failed: 0}.
 *   3. Broadcast-per-SELECT-row with ST6 benign over-broadcast — 2 reapable
 *      rows + 1 concurrent-completed row → UPDATE guard keeps count accurate
 *      (2), broadcast count = 3 (benign at boot; no WS clients connected).
 *   4. ST6 race guard — single-row flipped to 'completed' before sweep stays
 *      'completed'; return.failed === 0.
 *   5. Reason string — error column is exactly 'hosted-orphan-on-boot'.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed a hosted_instance runtime linked to a fresh instances row in 'running'
 * status. Inserts a parent users row because instances.user_id is a NOT NULL
 * FK and foreign_keys=ON is applied at setup. Mirrors the helper in
 * hosted-task-worker.test.ts to avoid cross-test coupling.
 */
async function seedHostedRuntime(
  kx: Knex,
  opts: { name?: string } = {},
): Promise<{ runtimeId: string; instanceId: string; userId: string }> {
  const userId = randomUUID();
  const now = new Date().toISOString();
  await kx('users').insert({
    id: userId,
    email: `user-${userId.slice(0, 8)}@test.local`,
    display_name: `Test User ${userId.slice(0, 8)}`,
    role: 'admin',
    totp_enabled: 0,
    force_password_change: 0,
    created_at: now,
    updated_at: now,
  });

  const instanceId = randomUUID();
  await kx('instances').insert({
    id: instanceId,
    user_id: userId,
    name: opts.name ?? `test-inst-${instanceId.slice(0, 8)}`,
    agent_type: 'openclaw',
    image_tag: 'test-image:latest',
    status: 'running',
    deployment_target: 'docker',
    auth_token: `auth-${instanceId.slice(0, 8)}`,
    config: '{}',
    security_profile: 'unrestricted',
    billing_mode: 'byok',
    created_at: now,
    updated_at: now,
  });

  const runtimeId = randomUUID();
  await kx('runtimes').insert({
    id: runtimeId,
    workspace_id: 'AQ',
    name: opts.name ?? `hosted-${instanceId.slice(0, 8)}`,
    kind: 'hosted_instance',
    provider: 'openclaw',
    status: 'online',
    daemon_id: null,
    instance_id: instanceId,
    metadata: '{}',
    created_at: now,
    updated_at: now,
  });

  return { runtimeId, instanceId, userId };
}

interface BroadcastCall {
  workspaceId: string;
  message: unknown;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('Test 1: hosted in-flight rows flip to failed with correct reason; daemon + queued rows untouched', async () => {
  const ctx = await setupTestDb();
  try {
    __setBroadcastForTests__(() => {
      // noop — this test does not assert broadcast count
    });

    // Hosted runtime with 2 dispatched + 1 running + 1 queued task.
    const { runtimeId: hostedRuntimeId } = await seedHostedRuntime(ctx.db);
    const hostedAgentId = await seedAgent(ctx.db, { runtimeId: hostedRuntimeId });
    const issueH1 = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: hostedAgentId });
    const issueH2 = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: hostedAgentId });
    const issueH3 = await seedIssue(ctx.db, { issueNumber: 3, assigneeId: hostedAgentId });
    const issueH4 = await seedIssue(ctx.db, { issueNumber: 4, assigneeId: hostedAgentId });

    const hostedTask1 = await seedTask(ctx.db, {
      issueId: issueH1,
      agentId: hostedAgentId,
      runtimeId: hostedRuntimeId,
      status: 'dispatched',
    });
    const hostedTask2 = await seedTask(ctx.db, {
      issueId: issueH2,
      agentId: hostedAgentId,
      runtimeId: hostedRuntimeId,
      status: 'dispatched',
    });
    const hostedTask3 = await seedTask(ctx.db, {
      issueId: issueH3,
      agentId: hostedAgentId,
      runtimeId: hostedRuntimeId,
      status: 'running',
    });
    const hostedTaskQueued = await seedTask(ctx.db, {
      issueId: issueH4,
      agentId: hostedAgentId,
      runtimeId: hostedRuntimeId,
      status: 'queued',
    });

    // Daemon runtime with 1 dispatched task — must NOT be touched.
    const daemonRuntimeId = await seedRuntime(ctx.db, { kind: 'local_daemon' });
    const daemonAgentId = await seedAgent(ctx.db, { runtimeId: daemonRuntimeId });
    const issueD1 = await seedIssue(ctx.db, { issueNumber: 10, assigneeId: daemonAgentId });
    const daemonTask = await seedTask(ctx.db, {
      issueId: issueD1,
      agentId: daemonAgentId,
      runtimeId: daemonRuntimeId,
      status: 'dispatched',
    });

    const result = await failOrphanedHostedTasks(ctx.db);

    assert.equal(result.failed, 3, 'three hosted in-flight rows should flip to failed');

    for (const id of [hostedTask1, hostedTask2, hostedTask3]) {
      const row = await ctx.db('agent_task_queue').where({ id }).first('status', 'error', 'completed_at');
      assert.equal(row?.status, 'failed', `hosted task ${id} should be failed`);
      assert.equal(row?.error, 'hosted-orphan-on-boot', `hosted task ${id} should have boot-orphan reason`);
      assert.ok(row?.completed_at, `hosted task ${id} should have completed_at set`);
    }

    const queuedRow = await ctx.db('agent_task_queue').where({ id: hostedTaskQueued }).first('status', 'error');
    assert.equal(queuedRow?.status, 'queued', 'hosted queued task must remain queued');
    assert.equal(queuedRow?.error, null, 'hosted queued task must not have an error');

    const daemonRow = await ctx.db('agent_task_queue').where({ id: daemonTask }).first('status', 'error');
    assert.equal(daemonRow?.status, 'dispatched', 'daemon task must remain dispatched (sweep skips daemons)');
    assert.equal(daemonRow?.error, null, 'daemon task must not have an error');
  } finally {
    __resetBroadcastForTests__();
    await teardownTestDb(ctx);
  }
});

test('Test 2: empty table — no matching rows, no throw, returns {failed: 0}', async () => {
  const ctx = await setupTestDb();
  try {
    __setBroadcastForTests__(() => {
      // noop
    });

    const result = await failOrphanedHostedTasks(ctx.db);
    assert.equal(result.failed, 0);
    assert.equal(result.rows.length, 0);
  } finally {
    __resetBroadcastForTests__();
    await teardownTestDb(ctx);
  }
});

test('Test 3: broadcasts fire per SELECTed row — ST6 benign over-broadcast at boot', async () => {
  const ctx = await setupTestDb();
  try {
    const calls: BroadcastCall[] = [];
    __setBroadcastForTests__((workspaceId: string, message: unknown) => {
      calls.push({ workspaceId, message });
    });

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issue1 = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const issue2 = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });
    const issue3 = await seedIssue(ctx.db, { issueNumber: 3, assigneeId: agentId });

    const t1 = await seedTask(ctx.db, {
      issueId: issue1,
      agentId,
      runtimeId,
      status: 'dispatched',
    });
    const t2 = await seedTask(ctx.db, {
      issueId: issue2,
      agentId,
      runtimeId,
      status: 'dispatched',
    });
    const t3 = await seedTask(ctx.db, {
      issueId: issue3,
      agentId,
      runtimeId,
      status: 'dispatched',
    });

    // Simulate the ST6 race: a concurrent legitimate writer flips t3 to
    // 'completed' between the SELECT and the UPDATE. The UPDATE guard
    // (whereIn status, dispatched|running) must skip t3.
    await ctx.db('agent_task_queue').where({ id: t3 }).update({ status: 'completed' });

    const result = await failOrphanedHostedTasks(ctx.db);

    // (a) UPDATE guard kept t3 as 'completed'; only 2 rows actually transitioned.
    assert.equal(result.failed, 2, 'ST6 guard prevents clobbering the concurrently-completed row');

    const t1Row = await ctx.db('agent_task_queue').where({ id: t1 }).first('status', 'error');
    const t2Row = await ctx.db('agent_task_queue').where({ id: t2 }).first('status', 'error');
    const t3Row = await ctx.db('agent_task_queue').where({ id: t3 }).first('status', 'error');

    assert.equal(t1Row?.status, 'failed');
    assert.equal(t1Row?.error, 'hosted-orphan-on-boot');
    assert.equal(t2Row?.status, 'failed');
    assert.equal(t2Row?.error, 'hosted-orphan-on-boot');
    // (b) t3 stays 'completed' (benign — the concurrent writer won).
    assert.equal(t3Row?.status, 'completed');
    assert.equal(t3Row?.error, null);

    // (c) Broadcast count = 3 — one per SELECTed row.
    // The 3rd broadcast (for the concurrently-completed t3) is BENIGN at boot:
    // no WS clients are connected because HTTP is not yet listening.
    // See hosted-orphan-sweep.ts for the documented rationale (no filter-by-
    // index anti-pattern: iteration is over the SELECT result directly).
    assert.equal(calls.length, 3, 'broadcast fires per SELECTed row (ST6 benign over-broadcast accepted)');

    // All broadcasts target workspace 'AQ' and carry the task:failed shape.
    for (const call of calls) {
      assert.equal(call.workspaceId, 'AQ');
      const msg = call.message as Record<string, unknown>;
      assert.equal(msg.type, 'task:failed');
      assert.ok(typeof msg.taskId === 'string');
      assert.ok(typeof msg.issueId === 'string');
    }
  } finally {
    __resetBroadcastForTests__();
    await teardownTestDb(ctx);
  }
});

test('Test 4: ST6 race guard — single row flipped to completed pre-sweep stays completed', async () => {
  const ctx = await setupTestDb();
  try {
    __setBroadcastForTests__(() => {
      // noop
    });

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'dispatched',
    });

    // Flip to 'completed' BEFORE the sweep — mimics a concurrent completeTask().
    await ctx.db('agent_task_queue').where({ id: taskId }).update({ status: 'completed' });

    const result = await failOrphanedHostedTasks(ctx.db);

    // The SELECT ran after the pre-flip, so rows.length === 0 and failed === 0.
    assert.equal(result.failed, 0, 'no row matched the pre-UPDATE SELECT (status filter)');

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first('status', 'error');
    assert.equal(row?.status, 'completed', 'row stays completed — race guard preserved state');
    assert.equal(row?.error, null, 'race guard prevented error-column clobber');
  } finally {
    __resetBroadcastForTests__();
    await teardownTestDb(ctx);
  }
});

test('Test 5: reason string — error column is exactly hosted-orphan-on-boot', async () => {
  const ctx = await setupTestDb();
  try {
    __setBroadcastForTests__(() => {
      // noop
    });

    const { runtimeId } = await seedHostedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, {
      issueId,
      agentId,
      runtimeId,
      status: 'running',
    });

    const result = await failOrphanedHostedTasks(ctx.db);
    assert.equal(result.failed, 1);

    const row = await ctx.db('agent_task_queue').where({ id: taskId }).first('error');
    assert.equal(row?.error, 'hosted-orphan-on-boot', 'reason string must match HOSTED-04 literal');
  } finally {
    __resetBroadcastForTests__();
    await teardownTestDb(ctx);
  }
});
