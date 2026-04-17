import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 24 — Issue Detail + Task Message Streaming E2E coverage.
 *
 * Wave 0 scaffold. Every scenario is skipped until wired by the downstream
 * plan noted in the skip reason. Scenario titles match the VALIDATION.md
 * per-task verification map verbatim — do NOT rename without updating the
 * `-g` grep invocations there.
 *
 * Plan wiring map:
 *   24-01 → "issue detail renders", "threaded comments"
 *   24-02 → "task stream live", "background tab recovery"
 *   24-03 → "reconnect replay", "replay no reorder"
 *   24-04 → "truncation marker"
 *   24-05 → "chat on issue"
 *
 * Test infrastructure patterns cloned from tests/e2e/issues-board.spec.ts
 * (API helper + DB fixtures via better-sqlite3). Plans 01–05 attach
 * concrete fixtures as they wire each scenario; Wave 0 only reserves the
 * file + titles + helpers.
 */

const API = 'http://localhost:3001/api';
const DB_PATH = process.env.AQUARIUM_DB_PATH || join(homedir(), '.aquarium', 'aquarium.db');

function uniqueEmail(): string {
  return `phase24-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
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
    data: { email, password: 'hunter2', displayName: 'Phase24 Test' },
  });
  expect(res.status(), `test-signup failed: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { ok: boolean; data?: { user: { id: string } } };
  expect(body.ok).toBe(true);
  return body.data!.user.id;
}

// Keep helper imports referenced so unused-import lint does not flag the
// scaffold. Each helper will be called by the wiring plan that activates a
// scenario; until then, this list documents the contract.
void uniqueEmail;
void uniqueName;
void readDb;
void writeDb;
void signUpTestUser;
void readFileSync;

test.describe.serial('Phase 24 — Issue Detail + Task Message Streaming', () => {
  test('issue detail renders', async ({ page, request }) => {
    // Plan 24-01: render the read-only slice (title, description via
    // SafeMarkdown, comments timeline scaffold, action sidebar on >=1024px).
    //
    // CE auto-auth: apps/server/src/middleware/auth.ts:66-81 grants the
    // first user in the DB to any request without a bearer token —
    // mirrors Phase 23's test pattern. No explicit signup needed.
    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    // Seed issue via API so issue_number + auth are handled server-side.
    const seedRes = await request.post(`${API}/issues`, {
      data: {
        title: 'Phase 24 smoke',
        status: 'todo',
        description: 'This is **markdown** body',
      },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;

    await page.goto(`http://localhost:5173/issues/${issueId}`);

    // Page shell rendered — data-testid covers the detail shell; the issue
    // id round-trips through the data attribute.
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await expect(page.locator(`[data-testid="issue-detail"][data-issue-id="${issueId}"]`)).toHaveCount(1);

    // IssueHeader rendered the title + data-issue-header marker.
    await expect(page.locator(`[data-issue-header="${issueId}"]`)).toBeVisible();
    await expect(page.locator('h1')).toContainText('Phase 24 smoke');

    // SafeMarkdown rendered **markdown** → <strong>markdown</strong>.
    // (sanitized, no raw innerHTML — UX6 hard invariant.)
    await expect(page.locator('strong').first()).toContainText('markdown');

    // CommentsTimeline section is rendered (empty-state path for fresh issue).
    await expect(page.getByTestId('comments-timeline')).toBeVisible();
  });

  test('threaded comments', async ({ page, request }) => {
    // Plan 24-01: threaded by parent_id. Seed an issue + 2 user comments
    // where the second points at the first via parent_id; assert the DOM
    // renders exactly one [data-comment-thread] root and the reply lives
    // nested inside it with a pl-6 indent wrapper.
    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Threaded comments smoke', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as {
      ok: boolean;
      data: { id: string; creatorUserId: string };
    };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;
    const userId = seedBody.data.creatorUserId;

    const firstCommentId = `c1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const secondCommentId = `c2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    writeDb((db) => {
      const insert = db.prepare(`
        INSERT INTO comments (id, issue_id, author_type, author_user_id, author_agent_id, content, type, parent_id, metadata, created_at, updated_at)
        VALUES (?, ?, 'user', ?, NULL, ?, 'comment', ?, '{}', datetime('now', ?), datetime('now', ?))
      `);
      insert.run(firstCommentId, issueId, userId, 'Root comment body', null, '-10 seconds', '-10 seconds');
      insert.run(secondCommentId, issueId, userId, 'Reply to the root', firstCommentId, '-5 seconds', '-5 seconds');
    });

    await page.goto(`http://localhost:5173/issues/${issueId}`);
    await expect(page.getByTestId('issue-detail')).toBeVisible();

    // Exactly one root-thread container — the reply is nested under the
    // first comment, not a sibling root.
    await expect(page.locator(`[data-comment-thread="${firstCommentId}"]`)).toHaveCount(1);

    // The reply lives inside the root thread container (proves nesting).
    await expect(
      page.locator(`[data-comment-thread="${firstCommentId}"] [data-comment="${secondCommentId}"]`),
    ).toHaveCount(1);

    // The reply's wrapping thread ancestor carries the pl-6 indent class.
    const replyAncestorClass = await page
      .locator(`[data-comment="${secondCommentId}"]`)
      .evaluate((el) => {
        let cur: HTMLElement | null = el.parentElement;
        while (cur && !cur.hasAttribute('data-comment-thread')) {
          cur = cur.parentElement;
        }
        return cur?.className ?? '';
      });
    expect(replyAncestorClass).toContain('pl-6');
  });

  test('task stream live', async ({ page, request }) => {
    // Plan 24-02: TaskPanel renders the latest task's state + message stream.
    // Seed an issue + runtime + agent + queued task + 3 task_messages of
    // different kinds (text / tool_use / tool_result) and assert the page
    // renders them through the deterministic data-attribute selectors.
    //
    // Backgrounded-tab recovery (24-02-02) stays manual-only below.

    // Clear prior issues so list pages stay under the N-issue virtualizer
    // threshold and the detail page is the only thing under test.
    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    // Seed an issue via the API so issue_number + auth flow through the
    // server's normal paths.
    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Phase 24-02 task stream', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;

    // Seed a runtime + agent + task + 3 messages directly in the DB — the
    // CE build doesn't expose admin routes for these and Wave 0's Playwright
    // scaffold already established this pattern for the board spec.
    const runtimeId = `rt-24-02-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentId = `ag-24-02-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const taskId = `task-24-02-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg1 = `msg1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg2 = `msg2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg3 = `msg3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    writeDb((db) => {
      // Runtime row — minimum columns that satisfy NOT NULL constraints.
      // daemon_id is part of a UNIQUE composite index — use the full unique
      // runtimeId tail to avoid colliding with prior test invocations.
      db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, metadata,
                               created_at, updated_at)
         VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                 ?, NULL, '{}',
                 datetime('now'), datetime('now'))`,
      ).run(runtimeId, `phase24-02-rt-${runtimeId}`, `daemon-${runtimeId}`);

      // Agent row.
      db.prepare(
        `INSERT INTO agents (id, workspace_id, runtime_id, name, instructions,
                             custom_env, custom_args, max_concurrent_tasks,
                             visibility, status, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, 'stream live test',
                 '{}', '[]', 6,
                 'workspace', 'idle', datetime('now'), datetime('now'))`,
      ).run(agentId, runtimeId, `phase24-02-agent-${agentId}`);

      // Task row — running state so TaskPanel shows the cancel button.
      db.prepare(
        `INSERT INTO agent_task_queue
           (id, workspace_id, issue_id, agent_id, runtime_id,
            trigger_comment_id, status, priority,
            metadata, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, ?,
                 NULL, 'running', 0,
                 '{}', datetime('now', '-5 seconds'), datetime('now'))`,
      ).run(taskId, issueId, agentId, runtimeId);

      // Three task_messages — one of each kind the SafeMarkdown / pre / pre
      // renderers cover. seq values 1, 2, 3 in insertion order.
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'))`,
      );
      insertMsg.run(msg1, taskId, 1, 'text', null, 'Agent **hello** reply', null, null);
      insertMsg.run(
        msg2,
        taskId,
        2,
        'tool_use',
        'Read',
        null,
        JSON.stringify({ path: 'README.md' }),
        null,
      );
      insertMsg.run(
        msg3,
        taskId,
        3,
        'tool_result',
        'Read',
        null,
        null,
        JSON.stringify('file contents preview'),
      );
    });

    await page.goto(`http://localhost:5173/issues/${issueId}`);
    await expect(page.getByTestId('issue-detail')).toBeVisible();

    // TaskPanel rendered with the seeded task id.
    await expect(page.locator(`[data-task-panel="${taskId}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-task-panel="${taskId}"][data-task-state="running"]`),
    ).toHaveCount(1);

    // All three seeded messages render with their kind-specific data-attrs.
    // The REST seed (GET /api/tasks/:id/messages?afterSeq=0) delivers them
    // before the WS subscribe_task live takeover, so they're visible without
    // waiting on a WS event.
    await expect(
      page.locator('[data-task-message-seq="1"][data-task-message-kind="text"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-task-message-seq="2"][data-task-message-kind="tool_use"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-task-message-seq="3"][data-task-message-kind="tool_result"]'),
    ).toBeVisible();
  });

  test.skip('background tab recovery', async () => {
    // plan 24-02 (CI-skipped / manual-only per 24-VALIDATION.md row 24-02-02):
    // Chrome tab-throttle + BFcache behaviour is not reliably reproducible in
    // headless Playwright. Manual verification steps live in
    // 24-VALIDATION.md §Manual-Only Verifications.
  });

  test('reconnect replay', async ({ page, request }) => {
    // Plan 24-03 / UI-06 / ST2 end-to-end proof. Scenario:
    //   1. Seed an issue + runtime + agent + running task + 5 task_messages
    //      (seq 1..5) via direct DB writes.
    //   2. Navigate the page; confirm the first 5 messages render through the
    //      REST seed (GET /api/tasks/:id/messages?afterSeq=0).
    //   3. Force-close the WS socket via the `__aquariumForceWsClose` test
    //      hook (gated to DEV / test mode by WebSocketContext).
    //   4. While the page is disconnected, seed seq 6..10 into the DB —
    //      these are the "missed" messages the client never saw.
    //   5. Wait for WebSocketContext's 3 s reconnect backoff + auth handshake.
    //      useTaskStream's isConnected-driven effect re-fires subscribe_task
    //      with lastSeqRef.current = 5. Server replays 6..10 via the Wave 0
    //      DESC-LIMIT-500 path.
    //   6. Assert seq 1..10 all present, total row count = 10 (no duplicates).

    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Phase 24-03 reconnect replay', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;

    const runtimeId = `rt-24-03r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentId = `ag-24-03r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const taskId = `task-24-03r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    writeDb((db) => {
      db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, metadata,
                               created_at, updated_at)
         VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                 ?, NULL, '{}',
                 datetime('now'), datetime('now'))`,
      ).run(runtimeId, `phase24-03r-rt-${runtimeId}`, `daemon-${runtimeId}`);
      db.prepare(
        `INSERT INTO agents (id, workspace_id, runtime_id, name, instructions,
                             custom_env, custom_args, max_concurrent_tasks,
                             visibility, status, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, 'reconnect replay test',
                 '{}', '[]', 6,
                 'workspace', 'idle', datetime('now'), datetime('now'))`,
      ).run(agentId, runtimeId, `phase24-03r-agent-${agentId}`);
      db.prepare(
        `INSERT INTO agent_task_queue
           (id, workspace_id, issue_id, agent_id, runtime_id,
            trigger_comment_id, status, priority,
            metadata, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, ?,
                 NULL, 'running', 0,
                 '{}', datetime('now', '-5 seconds'), datetime('now'))`,
      ).run(taskId, issueId, agentId, runtimeId);
      // Seed the initial 5 messages. Bulk insert via a prepared statement —
      // seq is monotonic ASC, content payload is a plain text string.
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, 'text', NULL, ?, NULL, NULL, '{}', datetime('now'))`,
      );
      for (let i = 1; i <= 5; i++) {
        insertMsg.run(`m-${taskId}-${i}`, taskId, i, `seq ${i}`);
      }
    });

    await page.goto(`http://localhost:5173/issues/${issueId}`);
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await expect(page.locator(`[data-task-panel="${taskId}"]`)).toBeVisible();

    // REST seed delivered the initial 5 rows; all visible before we drop WS.
    await expect(page.locator('[data-task-message-seq="5"]')).toBeVisible();
    await expect(page.locator('[data-task-message-seq]')).toHaveCount(5);

    // Force-close the WS socket. The test hook is exposed in DEV (Vite
    // `npm run dev -w @aquarium/web` sets import.meta.env.DEV = true).
    await page.evaluate(() => {
      const win = window as unknown as { __aquariumForceWsClose?: () => void };
      if (typeof win.__aquariumForceWsClose !== 'function') {
        throw new Error('__aquariumForceWsClose not available — reconnect test needs DEV or MODE=test build');
      }
      win.__aquariumForceWsClose();
    });

    // While disconnected, seed the next 5 rows. The client can never see
    // these via live broadcast because there's no socket — the only delivery
    // channel is the reconnect replay.
    writeDb((db) => {
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, 'text', NULL, ?, NULL, NULL, '{}', datetime('now'))`,
      );
      for (let i = 6; i <= 10; i++) {
        insertMsg.run(`m-${taskId}-${i}`, taskId, i, `seq ${i}`);
      }
    });

    // Wait for the 3 s WebSocketContext reconnect backoff + auth handshake +
    // replay flush. The isConnected effect in useTaskStream fires
    // subscribe_task with lastSeqRef.current = 5.
    await expect(page.locator('[data-task-message-seq="10"]')).toBeVisible({ timeout: 15_000 });

    // No gaps: every seq 1..10 must appear exactly once.
    for (let i = 1; i <= 10; i++) {
      await expect(page.locator(`[data-task-message-seq="${i}"]`)).toHaveCount(1);
    }
    // No duplicates: total row count matches the DB row count.
    await expect(page.locator('[data-task-message-seq]')).toHaveCount(10);
  });

  test('replay no reorder', async ({ page, request }) => {
    // Plan 24-03 / UI-06 / ST2. Tighter than "reconnect replay" — seeds 40
    // rows across two post-disconnect waves and asserts the final DOM order
    // is monotonically increasing. Exercises the defence-in-depth sort
    // client-side (useTaskStream) + the buffer-replay-live ordering
    // server-side (Wave 0 — ws/index.ts subscribe_task handler).

    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Phase 24-03 replay no reorder', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;

    const runtimeId = `rt-24-03o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentId = `ag-24-03o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const taskId = `task-24-03o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    writeDb((db) => {
      db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, metadata,
                               created_at, updated_at)
         VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                 ?, NULL, '{}',
                 datetime('now'), datetime('now'))`,
      ).run(runtimeId, `phase24-03o-rt-${runtimeId}`, `daemon-${runtimeId}`);
      db.prepare(
        `INSERT INTO agents (id, workspace_id, runtime_id, name, instructions,
                             custom_env, custom_args, max_concurrent_tasks,
                             visibility, status, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, 'replay no reorder test',
                 '{}', '[]', 6,
                 'workspace', 'idle', datetime('now'), datetime('now'))`,
      ).run(agentId, runtimeId, `phase24-03o-agent-${agentId}`);
      db.prepare(
        `INSERT INTO agent_task_queue
           (id, workspace_id, issue_id, agent_id, runtime_id,
            trigger_comment_id, status, priority,
            metadata, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, ?,
                 NULL, 'running', 0,
                 '{}', datetime('now', '-5 seconds'), datetime('now'))`,
      ).run(taskId, issueId, agentId, runtimeId);
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, 'text', NULL, ?, NULL, NULL, '{}', datetime('now'))`,
      );
      for (let i = 1; i <= 20; i++) {
        insertMsg.run(`m-${taskId}-${i}`, taskId, i, `seq ${i}`);
      }
    });

    await page.goto(`http://localhost:5173/issues/${issueId}`);
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await expect(page.locator(`[data-task-panel="${taskId}"]`)).toBeVisible();
    await expect(page.locator('[data-task-message-seq="20"]')).toBeVisible();

    // Force the socket down.
    await page.evaluate(() => {
      const win = window as unknown as { __aquariumForceWsClose?: () => void };
      if (typeof win.__aquariumForceWsClose !== 'function') {
        throw new Error('__aquariumForceWsClose not available — reconnect test needs DEV or MODE=test build');
      }
      win.__aquariumForceWsClose();
    });

    // Wave A: seq 21..30 while disconnected.
    writeDb((db) => {
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, 'text', NULL, ?, NULL, NULL, '{}', datetime('now'))`,
      );
      for (let i = 21; i <= 30; i++) {
        insertMsg.run(`m-${taskId}-${i}`, taskId, i, `seq ${i}`);
      }
    });

    // Small gap then wave B: seq 31..40.
    await page.waitForTimeout(800);
    writeDb((db) => {
      const insertMsg = db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, ?, 'text', NULL, ?, NULL, NULL, '{}', datetime('now'))`,
      );
      for (let i = 31; i <= 40; i++) {
        insertMsg.run(`m-${taskId}-${i}`, taskId, i, `seq ${i}`);
      }
    });

    // Reconnect + replay. The watermark at reconnect is 20 → server emits
    // 21..40 in a single DESC-LIMIT-500-sorted-ASC stream.
    await expect(page.locator('[data-task-message-seq="40"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-task-message-seq]')).toHaveCount(40);

    // Extract the DOM order of data-task-message-seq attrs. useTaskStream's
    // defence-in-depth sort guarantees strict ASC even if the server
    // delivered them out of order. Assert monotonic.
    const seqs = await page
      .locator('[data-task-message-seq]')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-task-message-seq'))));
    expect(seqs.length).toBe(40);
    for (let i = 1; i < seqs.length; i++) {
      expect(
        seqs[i] > seqs[i - 1],
        `DOM out of order at i=${i}: ${seqs[i - 1]} then ${seqs[i]}`,
      ).toBe(true);
    }
  });

  test('truncation marker', async ({ page, request }) => {
    // Plan 24-04 / UI-07 / UX6. Seeds a task_message with 20 KB content +
    // metadata.truncated, plus an overflow row holding the uncapped text.
    // Asserts:
    //   • TaskMessageItem row flags truncated (data-task-message-truncated="true")
    //   • TruncationMarker renders (data-truncated="true" + data-original-bytes)
    //   • Click "Show full" fetches GET /api/tasks/:id/messages/:seq/full
    //   • Full content replaces body; button flips to Collapse
    //   • Collapse reverts to the truncated body

    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Phase 24-04 truncation marker', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const issueId = seedBody.data.id;

    const runtimeId = `rt-24-04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentId = `ag-24-04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const taskId = `task-24-04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msgId = `m-24-04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const truncatedText = 'A'.repeat(16_384);
    const fullText = truncatedText + 'B'.repeat(20_480 - 16_384);
    const originalBytes = 20_480;

    writeDb((db) => {
      db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, metadata,
                               created_at, updated_at)
         VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                 ?, NULL, '{}',
                 datetime('now'), datetime('now'))`,
      ).run(runtimeId, `phase24-04-rt-${runtimeId}`, `daemon-${runtimeId}`);
      db.prepare(
        `INSERT INTO agents (id, workspace_id, runtime_id, name, instructions,
                             custom_env, custom_args, max_concurrent_tasks,
                             visibility, status, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, 'truncation marker test',
                 '{}', '[]', 6,
                 'workspace', 'idle', datetime('now'), datetime('now'))`,
      ).run(agentId, runtimeId, `phase24-04-agent-${agentId}`);
      db.prepare(
        `INSERT INTO agent_task_queue
           (id, workspace_id, issue_id, agent_id, runtime_id,
            trigger_comment_id, status, priority,
            metadata, created_at, updated_at)
         VALUES (?, 'AQ', ?, ?, ?,
                 NULL, 'running', 0,
                 '{}', datetime('now', '-5 seconds'), datetime('now'))`,
      ).run(taskId, issueId, agentId, runtimeId);

      // Truncated row (16 KB) + overflow row (uncapped 20 KB).
      db.prepare(
        `INSERT INTO task_messages
           (id, task_id, seq, type, tool, content, input, output, metadata, created_at)
         VALUES (?, ?, 1, 'text', NULL, ?, NULL, NULL, ?, datetime('now'))`,
      ).run(
        msgId,
        taskId,
        truncatedText,
        JSON.stringify({ truncated: true, originalBytes }),
      );
      db.prepare(
        `INSERT INTO task_message_overflow
           (task_id, seq, content, input_json, output, original_bytes, created_at)
         VALUES (?, 1, ?, NULL, NULL, ?, datetime('now'))`,
      ).run(taskId, fullText, originalBytes);
    });

    await page.goto(`http://localhost:5173/issues/${issueId}`);
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await expect(page.locator(`[data-task-panel="${taskId}"]`)).toBeVisible();

    // Truncated row marker on the message container + the explicit marker.
    await expect(
      page.locator('[data-task-message-seq="1"][data-task-message-truncated="true"]'),
    ).toBeVisible();
    await expect(
      page.locator(`[data-truncated="true"][data-original-bytes="${originalBytes}"]`),
    ).toBeVisible();

    // Click "Show full" — resolves the full content via /messages/1/full.
    await page.locator('[data-action="show-full"][data-seq="1"]').click();

    // Full content now contains the 'B' tail that the truncated payload lacks.
    // Guard: locate a unique sub-slice of the 'B' run to confirm expansion.
    await expect(page.locator('[data-task-message-seq="1"]')).toContainText('B'.repeat(40));

    // Button flips to Collapse.
    const collapseButton = page.locator('[data-task-message-seq="1"]').getByRole('button', {
      name: /Collapse/i,
    });
    await expect(collapseButton).toBeVisible();

    // Collapse reverts — Show-full button reappears.
    await collapseButton.click();
    await expect(
      page.locator('[data-action="show-full"][data-seq="1"]'),
    ).toBeVisible();
  });

  test.skip('chat on issue', async () => {
    // plan 24-05: user types → task enqueued with trigger_comment_id → response streams → completes as threaded agent comment
  });
});
