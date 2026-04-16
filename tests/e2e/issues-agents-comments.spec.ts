import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 17 — Agents + Issues + Comments E2E coverage.
 *
 * Covers every Phase 17 requirement with at least one scenario that provably
 * exercises the end-to-end code path:
 *   - AGENT-01 + AGENT-02 (test #2): agent CRUD + archive/restore + MCT range
 *   - ISSUE-01 (test #3): issue CRUD + issue_number monotonicity under burst +
 *                         CASCADE to comments on delete
 *   - ISSUE-05 (test #4): fractional reorder + renumber-sweep on precision
 *                         collapse (epsilon < 1e-6)
 *   - ISSUE-02 (test #5): assignee change on non-backlog issue enqueues a task
 *   - ISSUE-03 (test #6): reassignment swap — cancel old pending, enqueue new,
 *                         partial-unique invariant holds
 *   - ISSUE-04 (test #7): status='cancelled' cancels every live task atomically
 *   - COMMENT-01 + COMMENT-02 + COMMENT-03 (test #8): user comment + system
 *                         status_change + threaded reply + triggerCommentId
 *                         enqueue + parent-delete SET NULL preserves child
 *
 * Patterns cloned from tests/e2e/runtimes.spec.ts (Phase 16-04 SUMMARY §"Pattern
 * introductions"):
 *   - Direct SQLite read/write against ~/.aquarium/aquarium.db via better-sqlite3
 *     — the only way to assert invariants HTTP can't observe (partial-unique,
 *     CASCADE, collapse-renumber, system comment content).
 *   - test.describe.serial single block sharing one signed-up user + one
 *     runtime + one-or-two agents across cases.
 *   - writeDb() for fixture injection (daemon runtime row, stale 'running'
 *     task, forced 1.0 / 1.0000005 positions) where no HTTP route exists yet.
 */

const API = 'http://localhost:3001/api';
const DB_PATH = process.env.AQUARIUM_DB_PATH || join(homedir(), '.aquarium', 'aquarium.db');

function uniqueEmail(): string {
  return `phase17-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function readDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function writeDb(fn: (db: Database.Database) => void): void {
  const db = new Database(DB_PATH);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

async function signUpTestUser(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password: 'hunter2', displayName: 'Phase17 Test' },
  });
  expect(res.status(), `test-signup failed: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { ok: boolean; data?: { user: { id: string } } };
  expect(body.ok).toBe(true);
  return body.data!.user.id;
}

interface AgentShape {
  id: string;
  workspaceId: string;
  runtimeId: string | null;
  name: string;
  instructions: string;
  customEnv: Record<string, string>;
  customArgs: string[];
  maxConcurrentTasks: number;
  visibility: string;
  status: string;
  archivedAt: string | null;
}

interface IssueShape {
  id: string;
  workspaceId: string;
  issueNumber: number;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  position: number | null;
}

interface CommentShape {
  id: string;
  issueId: string;
  authorType: string;
  content: string;
  type: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
}

interface EnqueuedTaskShape {
  id: string;
  triggerCommentId: string | null;
}

test.describe.serial('Phase 17 — Agents + Issues + Comments', () => {
  let runtimeId: string;
  let agentId: string;
  let secondAgentId: string;
  let issueId: string;

  test.beforeAll(() => {
    // Fail loudly if DB_PATH is misconfigured — catches "wrong DB_PATH" before
    // the first SQL query inside a test body. Same pattern as runtimes.spec.ts.
    const probe = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    probe.close();
  });

  test('signup + fetch an existing runtime for agent FK', async ({ request }) => {
    await signUpTestUser(request, uniqueEmail());

    // Phase 16 reconcile mirrors instances into runtimes. Fetch any viable
    // row; otherwise inject a fake daemon runtime directly — Phase 19's
    // /api/daemon/register doesn't exist yet, so raw INSERT is the only way
    // to guarantee an `agents.runtime_id` FK target in a clean CE dev DB.
    const res = await request.get(`${API}/runtimes`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      ok: boolean;
      data?: Array<{ id: string; kind: string; status: string }>;
    };
    expect(body.ok).toBe(true);

    let runtime = body.data?.find(
      (r) =>
        r.kind === 'local_daemon' ||
        r.kind === 'external_cloud_daemon' ||
        r.kind === 'hosted_instance',
    );
    if (!runtime) {
      const injectedId = `rt-phase17-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const injectedDaemonId = `daemon-phase17-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      writeDb((db) => {
        db.prepare(
          `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                                 daemon_id, instance_id, metadata,
                                 last_heartbeat_at, created_at, updated_at)
           VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                   ?, NULL, '{}',
                   datetime('now'), datetime('now'), datetime('now'))`,
        ).run(injectedId, 'phase17-test-rt', injectedDaemonId);
      });
      runtime = { id: injectedId, kind: 'local_daemon', status: 'online' };
    }
    runtimeId = runtime.id;
    expect(runtimeId).toBeTruthy();
  });

  test('AGENT-01 + AGENT-02: create/update/archive/restore with MCT validation', async ({
    request,
  }) => {
    // Create with instructions + MCT=6
    const createRes = await request.post(`${API}/agents`, {
      data: {
        name: uniqueName('agent'),
        runtimeId,
        instructions: 'Be helpful',
        maxConcurrentTasks: 6,
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { ok: boolean; data: AgentShape };
    expect(created.ok).toBe(true);
    expect(created.data.runtimeId).toBe(runtimeId);
    expect(created.data.maxConcurrentTasks).toBe(6);
    expect(created.data.instructions).toBe('Be helpful');
    agentId = created.data.id;

    // Update
    const updateRes = await request.patch(`${API}/agents/${agentId}`, {
      data: { instructions: 'Be thorough', maxConcurrentTasks: 12 },
    });
    expect(updateRes.status()).toBe(200);
    const updated = (await updateRes.json()) as { ok: boolean; data: AgentShape };
    expect(updated.data.instructions).toBe('Be thorough');
    expect(updated.data.maxConcurrentTasks).toBe(12);

    // AGENT-02: MCT out-of-range (>16) → 400
    const badRes = await request.patch(`${API}/agents/${agentId}`, {
      data: { maxConcurrentTasks: 17 },
    });
    expect(badRes.status()).toBe(400);

    // AGENT-02: MCT=0 on create → 400
    const zeroRes = await request.post(`${API}/agents`, {
      data: { name: uniqueName('bad'), runtimeId, maxConcurrentTasks: 0 },
    });
    expect(zeroRes.status()).toBe(400);

    // Archive (soft-delete via DELETE)
    const archiveRes = await request.delete(`${API}/agents/${agentId}`);
    expect(archiveRes.status()).toBe(200);
    const archived = (await archiveRes.json()) as { ok: boolean; data: AgentShape };
    expect(archived.data.archivedAt).not.toBeNull();

    // Default list excludes archived
    const listRes = await request.get(`${API}/agents`);
    const listBody = (await listRes.json()) as { ok: boolean; data: AgentShape[] };
    expect(listBody.data.find((a) => a.id === agentId)).toBeUndefined();

    // includeArchived=true shows it
    const listAllRes = await request.get(`${API}/agents?includeArchived=true`);
    const listAllBody = (await listAllRes.json()) as { ok: boolean; data: AgentShape[] };
    expect(listAllBody.data.find((a) => a.id === agentId)).toBeDefined();

    // Restore
    const restoreRes = await request.post(`${API}/agents/${agentId}/restore`);
    expect(restoreRes.status()).toBe(200);
    const restored = (await restoreRes.json()) as { ok: boolean; data: AgentShape };
    expect(restored.data.archivedAt).toBeNull();

    // Create a second agent for ISSUE-03 reassignment tests later
    const secondRes = await request.post(`${API}/agents`, {
      data: { name: uniqueName('agent2'), runtimeId, maxConcurrentTasks: 4 },
    });
    expect(secondRes.status()).toBe(201);
    secondAgentId = ((await secondRes.json()) as { data: AgentShape }).data.id;
  });

  test('ISSUE-01: CRUD + issue_number monotonicity under concurrency', async ({ request }) => {
    // Baseline counter before burst — direct SQL because the API projects
    // issueNumber per row, not the workspace counter.
    const beforeCounter = readDb((db) => {
      const row = db
        .prepare(`SELECT issue_counter FROM workspaces WHERE id = 'AQ'`)
        .get() as { issue_counter: number };
      return row.issue_counter;
    });

    // Sequential create — also captures issueId for later ISSUE-02/03/04 tests
    const createRes = await request.post(`${API}/issues`, {
      data: { title: uniqueName('issue'), priority: 'medium' },
    });
    expect(createRes.status()).toBe(201);
    const firstIssue = ((await createRes.json()) as { data: IssueShape }).data;
    expect(firstIssue.issueNumber).toBe(beforeCounter + 1);
    issueId = firstIssue.id;

    // Concurrent burst of 5 — all must get unique sequential issue_numbers
    const burstResults = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request
          .post(`${API}/issues`, { data: { title: uniqueName('burst') } })
          .then((r) => r.json() as Promise<{ data: IssueShape }>),
      ),
    );
    const burstNumbers = burstResults
      .map((b) => b.data.issueNumber)
      .sort((a, b) => a - b);
    expect(burstNumbers.length).toBe(5);
    expect(new Set(burstNumbers).size).toBe(5); // all unique
    // Perfect sequence → max - min = 4. Allow 1-gap tolerance for fairness.
    expect(burstNumbers[burstNumbers.length - 1] - burstNumbers[0]).toBeLessThanOrEqual(4);

    // Update
    const updateRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { priority: 'high', description: 'updated description' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = ((await updateRes.json()) as { data: IssueShape }).data;
    expect(updated.priority).toBe('high');

    // Invalid status (not in 6-state enum) → 400. Trigger rejects 'in_review'.
    const badRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { status: 'in_review' },
    });
    expect(badRes.status()).toBe(400);

    // Delete one of the burst issues + confirm CASCADE removes its comments
    const toDelete = burstResults[0].data.id;
    await request.post(`${API}/issues/${toDelete}/comments`, {
      data: { content: 'will cascade' },
    });
    const commentsBefore = readDb(
      (db) =>
        db
          .prepare(`SELECT COUNT(*) as n FROM comments WHERE issue_id = ?`)
          .get(toDelete) as { n: number },
    );
    expect(commentsBefore.n).toBeGreaterThanOrEqual(1);

    const deleteRes = await request.delete(`${API}/issues/${toDelete}`);
    expect(deleteRes.status()).toBe(200);
    const remaining = readDb(
      (db) =>
        db
          .prepare(`SELECT COUNT(*) as n FROM comments WHERE issue_id = ?`)
          .get(toDelete) as { n: number },
    );
    expect(remaining.n).toBe(0); // CASCADE worked
  });

  test('ISSUE-05: reorder midpoint + renumber sweep on precision collapse', async ({
    request,
  }) => {
    // Create 3 fresh issues for this test (independent of issueId).
    const makeIssue = async (title: string): Promise<IssueShape> => {
      const r = await request.post(`${API}/issues`, { data: { title } });
      return ((await r.json()) as { data: IssueShape }).data;
    };
    const a = await makeIssue(uniqueName('reorder-a'));
    const b = await makeIssue(uniqueName('reorder-b'));
    const c = await makeIssue(uniqueName('reorder-c'));

    // Directly inject collapsing positions on a and b so that a reorder
    // between them triggers the renumber sweep (|a - b| < COLLAPSE_EPSILON=1e-6).
    writeDb((db) => {
      db.prepare(`UPDATE issues SET position = 1.0 WHERE id = ?`).run(a.id);
      db.prepare(`UPDATE issues SET position = 1.0000005 WHERE id = ?`).run(b.id);
    });

    // Reorder c between them → must trigger workspace-wide renumber sweep
    const reorderRes = await request.post(`${API}/issues/${c.id}/reorder`, {
      data: { beforeId: a.id, afterId: b.id },
    });
    expect(reorderRes.status()).toBe(200);

    // After the renumber sweep, RENUMBER_STEP=1000, so all non-null positions
    // must be on multiples of ~1000. After re-inserting c mid-way the gap
    // between c and its neighbours is >= RENUMBER_STEP/2 = 500.
    const positions = readDb(
      (db) =>
        db
          .prepare(
            `SELECT id, position FROM issues
             WHERE workspace_id='AQ' AND position IS NOT NULL
             ORDER BY position ASC`,
          )
          .all() as Array<{ id: string; position: number }>,
    );
    expect(positions.length).toBeGreaterThanOrEqual(3);
    const gaps = positions.slice(1).map((p, i) => p.position - positions[i].position);
    // Every gap >= 500 → collapse-renumber swept the space
    expect(gaps.every((g) => g >= 500)).toBeTruthy();

    // c must be between a and b in the final ordering
    const idOrder = positions.map((p) => p.id);
    const aIdx = idOrder.indexOf(a.id);
    const bIdx = idOrder.indexOf(b.id);
    const cIdx = idOrder.indexOf(c.id);
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx > aIdx && cIdx < bIdx).toBeTruthy();
  });

  test('ISSUE-02: assign agent to non-backlog issue enqueues exactly one task', async ({
    request,
  }) => {
    // Move to 'todo' (non-backlog) then assign agentId. Expect exactly 1 queued.
    const todoRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { status: 'todo' },
    });
    expect(todoRes.status()).toBe(200);

    const assignRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { assigneeId: agentId },
    });
    expect(assignRes.status()).toBe(200);

    const tasks = readDb(
      (db) =>
        db
          .prepare(
            `SELECT id, status, agent_id, runtime_id
             FROM agent_task_queue
             WHERE issue_id = ? AND status IN ('queued','dispatched')`,
          )
          .all(issueId) as Array<{
          id: string;
          status: string;
          agent_id: string;
          runtime_id: string;
        }>,
    );
    expect(tasks.length).toBe(1);
    expect(tasks[0].agent_id).toBe(agentId);
    expect(tasks[0].status).toBe('queued');

    // Re-assigning the SAME agent is idempotent (ladder is mutually-exclusive;
    // same-agent is not a reassignment so no new task is enqueued).
    const sameRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { assigneeId: agentId },
    });
    expect(sameRes.status()).toBe(200);
    const tasksAgain = readDb(
      (db) =>
        db
          .prepare(
            `SELECT COUNT(*) as n FROM agent_task_queue
             WHERE issue_id = ? AND agent_id = ? AND status IN ('queued','dispatched')`,
          )
          .get(issueId, agentId) as { n: number },
    );
    expect(tasksAgain.n).toBe(1);
  });

  test('ISSUE-03: reassignment cancels old pending task and enqueues for new agent', async ({
    request,
  }) => {
    const reassignRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { assigneeId: secondAgentId },
    });
    expect(reassignRes.status()).toBe(200);

    // Every task for OLD agent on this issue must now be cancelled
    const oldTasks = readDb(
      (db) =>
        db
          .prepare(
            `SELECT status FROM agent_task_queue
             WHERE issue_id = ? AND agent_id = ?`,
          )
          .all(issueId, agentId) as Array<{ status: string }>,
    );
    expect(oldTasks.length).toBeGreaterThanOrEqual(1);
    expect(oldTasks.every((t) => t.status === 'cancelled')).toBeTruthy();

    // Exactly one pending task for NEW agent
    const newTasks = readDb(
      (db) =>
        db
          .prepare(
            `SELECT status FROM agent_task_queue
             WHERE issue_id = ? AND agent_id = ? AND status IN ('queued','dispatched')`,
          )
          .all(issueId, secondAgentId) as Array<{ status: string }>,
    );
    expect(newTasks.length).toBe(1);
    expect(newTasks[0].status).toBe('queued');

    // Partial-unique invariant: no (issue, agent) pair has 2+ pending rows
    // GROUP BY issue_id, agent_id HAVING n > 1 must be empty.
    const duplicates = readDb(
      (db) =>
        db
          .prepare(
            `SELECT issue_id, agent_id, COUNT(*) as n
             FROM agent_task_queue
             WHERE status IN ('queued','dispatched')
             GROUP BY issue_id, agent_id HAVING n > 1`,
          )
          .all() as Array<{ issue_id: string; agent_id: string; n: number }>,
    );
    expect(duplicates).toEqual([]);
  });

  test("ISSUE-04: status='cancelled' transitions all live tasks to cancelled in one transaction", async ({
    request,
  }) => {
    // Ensure there's at least one queued task for secondAgentId (from ISSUE-03)
    // AND a fake 'running' task injected directly. ISSUE-04 intent is "issue
    // is dead, kill all work for it" — cancelAllTasksForIssue covers running.
    writeDb((db) => {
      db.prepare(
        `INSERT INTO agent_task_queue
           (id, workspace_id, issue_id, agent_id, runtime_id,
            status, priority, metadata, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, ?,
                 'running', 0, '{}', datetime('now'), datetime('now'))`,
      ).run(
        `fake-running-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        issueId,
        secondAgentId,
        runtimeId,
      );
    });

    const cancelRes = await request.patch(`${API}/issues/${issueId}`, {
      data: { status: 'cancelled' },
    });
    expect(cancelRes.status()).toBe(200);

    // No live tasks remain for this issue
    const live = readDb(
      (db) =>
        db
          .prepare(
            `SELECT status FROM agent_task_queue
             WHERE issue_id = ? AND status IN ('queued','dispatched','running')`,
          )
          .all(issueId) as Array<{ status: string }>,
    );
    expect(live.length).toBe(0);
  });

  test('COMMENT-01 + COMMENT-02 + COMMENT-03: trigger enqueue, system comments, threading', async ({
    request,
  }) => {
    // Fresh issue so assignee/status changes produce clean system-comment
    // entries not polluted by prior ISSUE-02/03/04 transitions.
    const newIssue = await (async () => {
      const r = await request.post(`${API}/issues`, {
        data: { title: uniqueName('c-issue'), priority: 'low' },
      });
      return ((await r.json()) as { data: IssueShape }).data;
    })();

    // COMMENT-02: status change backlog → todo produces a status_change system
    // comment authored by 'system' via applyIssueSideEffects.
    const toTodoRes = await request.patch(`${API}/issues/${newIssue.id}`, {
      data: { status: 'todo' },
    });
    expect(toTodoRes.status()).toBe(200);

    const systemComments = readDb(
      (db) =>
        db
          .prepare(
            `SELECT type, content, author_type FROM comments
             WHERE issue_id = ? AND type = 'status_change'
             ORDER BY created_at ASC`,
          )
          .all(newIssue.id) as Array<{
          type: string;
          content: string;
          author_type: string;
        }>,
    );
    expect(systemComments.length).toBeGreaterThanOrEqual(1);
    expect(systemComments[0].author_type).toBe('system');
    expect(systemComments[0].content).toContain('backlog');
    expect(systemComments[0].content).toContain('todo');

    // Assign to secondAgentId → another system comment + enqueue
    const assignRes = await request.patch(`${API}/issues/${newIssue.id}`, {
      data: { assigneeId: secondAgentId },
    });
    expect(assignRes.status()).toBe(200);
    const afterAssign = readDb(
      (db) =>
        db
          .prepare(
            `SELECT COUNT(*) as n FROM comments
             WHERE issue_id = ? AND type = 'status_change'`,
          )
          .get(newIssue.id) as { n: number },
    );
    expect(afterAssign.n).toBeGreaterThanOrEqual(2);

    // COMMENT-01 user post: simple root-level comment
    const postRes = await request.post(`${API}/issues/${newIssue.id}/comments`, {
      data: { content: 'Root-level user comment' },
    });
    expect(postRes.status()).toBe(201);
    const postBody = (await postRes.json()) as {
      data: { comment: CommentShape; enqueuedTask: EnqueuedTaskShape | null };
    };
    const rootComment = postBody.data.comment;
    expect(rootComment.authorType).toBe('user');
    expect(rootComment.parentId).toBeNull();
    expect(rootComment.type).toBe('comment');

    // COMMENT-03: threaded reply via parentId
    const replyRes = await request.post(`${API}/issues/${newIssue.id}/comments`, {
      data: { content: 'Reply to root', parentId: rootComment.id },
    });
    expect(replyRes.status()).toBe(201);
    const replyBody = (await replyRes.json()) as {
      data: { comment: CommentShape; enqueuedTask: EnqueuedTaskShape | null };
    };
    const replyComment = replyBody.data.comment;
    expect(replyComment.parentId).toBe(rootComment.id);

    // COMMENT-01: triggerCommentId post → agent task enqueued with the NEWLY
    // written comment id as its trigger_comment_id (not the anchor). The
    // issue is in 'todo' with assigneeId=secondAgentId from the assign
    // above — applyIssueSideEffects already enqueued one pending task then,
    // so we cancel it directly before posting, otherwise the partial-unique
    // idx_one_pending_task_per_issue_agent rejects the new insert.
    writeDb((db) => {
      db.prepare(
        `UPDATE agent_task_queue
         SET status='cancelled', cancelled_at=datetime('now')
         WHERE issue_id=? AND agent_id=? AND status IN ('queued','dispatched')`,
      ).run(newIssue.id, secondAgentId);
    });

    const triggerRes = await request.post(`${API}/issues/${newIssue.id}/comments`, {
      data: {
        content: 'please ask the agent',
        triggerCommentId: rootComment.id,
      },
    });
    expect(triggerRes.status()).toBe(201);
    const triggerBody = (await triggerRes.json()) as {
      data: { comment: CommentShape; enqueuedTask: EnqueuedTaskShape | null };
    };
    expect(triggerBody.data.enqueuedTask).not.toBeNull();
    // triggerCommentId on the new task row points at the just-created comment,
    // NOT the anchor rootComment (see 17-04 plan §"triggerCommentId inversion").
    expect(triggerBody.data.enqueuedTask!.triggerCommentId).toBe(
      triggerBody.data.comment.id,
    );

    // COMMENT-03: parent-delete preserves children via schema SET NULL.
    // Delete rootComment — replyComment.parent_id must become NULL.
    const deleteRes = await request.delete(`${API}/comments/${rootComment.id}`);
    expect(deleteRes.status()).toBe(200);

    const preservedReply = readDb(
      (db) =>
        db
          .prepare(`SELECT parent_id FROM comments WHERE id = ?`)
          .get(replyComment.id) as { parent_id: string | null },
    );
    expect(preservedReply.parent_id).toBeNull();
  });
});
