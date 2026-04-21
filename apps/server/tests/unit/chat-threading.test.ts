import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  setupTestDb,
  teardownTestDb,
  seedRuntime,
  seedAgent,
  seedIssue,
  seedTask,
} from './test-db.js';
import {
  createUserComment,
  createAgentComment,
} from '../../src/services/comment-store.js';

/**
 * Phase 24-05 — CHAT-01 threading invariants for createAgentComment +
 * DB-select-fallback completion paths (hosted-worker + daemon /complete).
 *
 * These tests establish the four hard invariants from 24-05-PLAN.md:
 *
 *   1. createAgentComment rejects parents that are NOT user comments
 *      (mirrors createUserComment's parent guard — no agent replies under
 *       system status_change rows).
 *   2. createAgentComment hard-codes author_type='agent' + sets author_agent_id
 *      + NULLs author_user_id (XOR invariant per migration 006).
 *   3. createAgentComment creates a threaded reply under a user comment via
 *      parent_id; the row is readable back with the expected shape.
 *   4. The DB-select fallback — listTaskMessagesOfKind(taskId, 'text') —
 *      reconstructs the agent's final text from seeded task_messages (no
 *      dependency on caller-supplied finalText). Used identically by the
 *      hosted-worker + daemon /complete paths.
 */

// Each test owns its own throwaway DB; the service functions accept a `trx`
// arg so we never mutate the real CE database.

async function seedWorkspace(db: ReturnType<typeof setupTestDb> extends Promise<infer T> ? T extends { db: infer DB } ? DB : never : never): Promise<void> {
  // migration 003 already seeds workspace 'AQ' — no-op.
  void db;
}

test('Test 1: createAgentComment rejects parent that is not a user comment', async () => {
  const ctx = await setupTestDb();
  try {
    await seedWorkspace(ctx.db);
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 1, assigneeId: agentId });

    // Seed a system comment as the forbidden parent.
    const sysId = 'sys-1';
    const now = new Date().toISOString();
    await ctx.db('comments').insert({
      id: sysId,
      issue_id: issueId,
      author_type: 'system',
      author_user_id: null,
      author_agent_id: null,
      content: 'status change',
      type: 'status_change',
      parent_id: null,
      metadata: '{}',
      created_at: now,
      updated_at: now,
    });

    await assert.rejects(
      createAgentComment({
        workspaceId: 'AQ',
        issueId,
        authorAgentId: agentId,
        content: 'reply',
        parentId: sysId,
        trx: ctx.db,
      }),
      /parent comment must be a user comment/,
    );
  } finally {
    await teardownTestDb(ctx);
  }
});

test('Test 2: createAgentComment inserts with author_type=agent + author_agent_id set + author_user_id null', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 2, assigneeId: agentId });

    const comment = await createAgentComment({
      workspaceId: 'AQ',
      issueId,
      authorAgentId: agentId,
      content: 'agent reply text',
      parentId: null,
      trx: ctx.db,
    });

    assert.equal(comment.authorType, 'agent');
    assert.equal(comment.authorAgentId, agentId);
    assert.equal(comment.authorUserId, null);
    assert.equal(comment.type, 'comment');
    assert.equal(comment.content, 'agent reply text');

    // Verify the row in the DB has the right XOR shape (migration 006).
    const row = await ctx.db('comments').where({ id: comment.id }).first();
    assert.equal(row.author_type, 'agent');
    assert.equal(row.author_agent_id, agentId);
    assert.equal(row.author_user_id, null);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('Test 3: createAgentComment threads under a user comment via parent_id', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 3, assigneeId: agentId });

    // Seed a user via createUserComment — need a user row for author_user_id.
    const userId = randomUUID();
    const now = new Date().toISOString();
    await ctx.db('users').insert({
      id: userId,
      email: `user-${userId.slice(0, 8)}@test.local`,
      display_name: 'Test User',
      role: 'admin',
      totp_enabled: 0,
      force_password_change: 0,
      created_at: now,
      updated_at: now,
    });

    const userResult = await createUserComment({
      workspaceId: 'AQ',
      issueId,
      authorUserId: userId,
      content: 'What should I do?',
      trx: ctx.db,
    });

    const agentReply = await createAgentComment({
      workspaceId: 'AQ',
      issueId,
      authorAgentId: agentId,
      content: 'Here is what to do.',
      parentId: userResult.comment.id,
      trx: ctx.db,
    });

    assert.equal(agentReply.parentId, userResult.comment.id);
    assert.equal(agentReply.authorType, 'agent');

    // DB-level read-back: parent_id column populated.
    const row = await ctx.db('comments').where({ id: agentReply.id }).first();
    assert.equal(row.parent_id, userResult.comment.id);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('Test 4: DB-select fallback — listTaskMessagesOfKind reconstructs final text from seeded task_messages', async () => {
  const ctx = await setupTestDb();
  try {
    const runtimeId = await seedRuntime(ctx.db);
    const agentId = await seedAgent(ctx.db, { runtimeId });
    const issueId = await seedIssue(ctx.db, { issueNumber: 4, assigneeId: agentId });
    const taskId = await seedTask(ctx.db, { issueId, agentId, runtimeId, status: 'running' });

    // Seed 3 text messages + 1 tool_use (proves kind filter works).
    const now = new Date().toISOString();
    const insertMsg = async (seq: number, type: string, content: string | null, input: unknown) => {
      await ctx.db('task_messages').insert({
        id: randomUUID(),
        task_id: taskId,
        seq,
        type,
        tool: null,
        content,
        input: input === null ? null : JSON.stringify(input),
        output: null,
        metadata: '{}',
        created_at: now,
      });
    };
    await insertMsg(1, 'text', 'alpha', null);
    await insertMsg(2, 'tool_use', null, { path: 'README.md' });
    await insertMsg(3, 'text', 'beta', null);
    await insertMsg(4, 'text', 'gamma', null);

    // Reconstruct via the Wave-0 helper — same code path used by BOTH
    // hosted-worker and daemon /complete per 24-05-PLAN.md's uniformity
    // invariant.
    const { listTaskMessagesOfKind } = await import(
      '../../src/services/task-message-store.js'
    );
    const textRows = await listTaskMessagesOfKind(ctx.db, taskId, 'text');
    assert.equal(textRows.length, 3, 'kind filter excludes the tool_use row');
    const concatenated = textRows
      .map((r) => r.content ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n')
      .trim();
    assert.equal(concatenated, 'alpha\n\nbeta\n\ngamma');

    // And — the final step the completion path performs — createAgentComment
    // writes the reconstructed text with parent_id = trigger comment id.
    // Seed a user comment as the trigger parent.
    const userId = randomUUID();
    await ctx.db('users').insert({
      id: userId,
      email: `user-${userId.slice(0, 8)}@test.local`,
      display_name: 'Test User',
      role: 'admin',
      totp_enabled: 0,
      force_password_change: 0,
      created_at: now,
      updated_at: now,
    });
    const triggerResult = await createUserComment({
      workspaceId: 'AQ',
      issueId,
      authorUserId: userId,
      content: 'tell me stuff',
      trx: ctx.db,
    });

    const agentReply = await createAgentComment({
      workspaceId: 'AQ',
      issueId,
      authorAgentId: agentId,
      content: concatenated,
      parentId: triggerResult.comment.id,
      trx: ctx.db,
    });
    assert.equal(agentReply.parentId, triggerResult.comment.id);
    assert.ok(agentReply.content.includes('alpha'));
    assert.ok(agentReply.content.includes('beta'));
    assert.ok(agentReply.content.includes('gamma'));
    assert.equal(agentReply.authorType, 'agent');
  } finally {
    await teardownTestDb(ctx);
  }
});
