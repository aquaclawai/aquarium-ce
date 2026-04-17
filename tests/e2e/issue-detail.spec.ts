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

  test.skip('reconnect replay', async () => {
    // plan 24-03: WS drop mid-stream → reconnect replays gap with no duplicates
  });

  test.skip('replay no reorder', async () => {
    // plan 24-03: server-side replay + live-handoff buffer prevents out-of-order delivery
  });

  test.skip('truncation marker', async () => {
    // plan 24-04: truncated messages show explicit marker + "Show full" affordance
  });

  test.skip('chat on issue', async () => {
    // plan 24-05: user types → task enqueued with trigger_comment_id → response streams → completes as threaded agent comment
  });
});
