import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 23 — Issue Board UI (Kanban) E2E coverage.
 *
 * Wave 0 scaffold. Every scenario is skipped until wired by the downstream
 * plan noted in the skip reason. Scenario titles match the VALIDATION.md
 * per-task verification map verbatim — do NOT rename without updating the
 * `-g` grep invocations there.
 *
 * Plan wiring map:
 *   23-01 → "renders columns"
 *   23-02 → "mouse drag", "concurrent reorder", "own echo"
 *   23-03 → "virtualization", "virtualization drag"
 *   23-04 → "keyboard drag", "a11y announcer"
 *
 * Test infrastructure patterns cloned from
 * tests/e2e/issues-agents-comments.spec.ts (API helper + DB fixtures via
 * better-sqlite3). Plans 01–04 attach concrete fixtures as they wire each
 * scenario; Wave 0 only reserves the file + titles + helpers.
 */

const API = 'http://localhost:3001/api';
const DB_PATH = process.env.AQUARIUM_DB_PATH || join(homedir(), '.aquarium', 'aquarium.db');

function uniqueEmail(): string {
  return `phase23-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
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
    data: { email, password: 'hunter2', displayName: 'Phase23 Test' },
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

const EXPECTED_COLUMNS = ['backlog', 'todo', 'in_progress', 'done', 'blocked', 'cancelled'] as const;

test.describe.serial('Phase 23 — Issue Board UI (Kanban)', () => {
  test('renders columns', async ({ page, request }) => {
    // CE auto-auths as the first user in the DB (see apps/server/src/middleware/auth.ts
    // lines 66-81) — no explicit signup is required for authenticated API access
    // in the CE test environment. This mirrors how a self-hosted CE operator
    // uses the app without a Clerk-backed login flow.
    // Pre-clean existing issues to keep the test deterministic (prior seeds
    // from earlier runs would inflate column counts).
    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    // Seed 3 initial issues across distinct statuses via the HTTP API.
    const initial: { title: string; status: 'todo' | 'in_progress' | 'done' }[] = [
      { title: 'Seed issue A (todo)', status: 'todo' },
      { title: 'Seed issue B (in_progress)', status: 'in_progress' },
      { title: 'Seed issue C (done)', status: 'done' },
    ];
    const seeded: { id: string; status: string }[] = [];
    for (const spec of initial) {
      const res = await request.post(`${API}/issues`, { data: spec });
      expect(res.status(), `POST /issues failed: ${await res.text()}`).toBe(201);
      const body = (await res.json()) as { ok: boolean; data: { id: string; status: string } };
      expect(body.ok).toBe(true);
      seeded.push({ id: body.data.id, status: body.data.status });
    }

    // Navigate to the board. CE auto-auth hydrates TestAuthProvider on first
    // /api/auth/me call, and WebSocketContext connects once user is set.
    await page.goto('http://localhost:5173/issues');

    // Page shell rendered.
    await expect(page.getByTestId('issues-board')).toBeVisible();

    // Assert all 6 columns present in exact order.
    const columnEls = page.locator('[data-issue-column]');
    await expect(columnEls).toHaveCount(6);
    const columnStatuses = await columnEls.evaluateAll(els =>
      els.map(el => (el as HTMLElement).dataset.issueColumn),
    );
    expect(columnStatuses).toEqual([...EXPECTED_COLUMNS]);

    // Each seeded issue renders as a data-issue-card inside the matching column.
    for (const { id, status } of seeded) {
      await expect(
        page.locator(`[data-issue-column="${status}"] [data-issue-card="${id}"]`),
      ).toHaveCount(1);
    }

    // Give the page's WebSocket time to (a) open, (b) authenticate, and
    // (c) send subscribe('AQ') to the server. React StrictMode in dev tears
    // down the first WS and immediately reopens a second — if the POST
    // arrives between those moments the server has 0 subscribers for 'AQ'
    // and the broadcast is silently dropped. 3 s is a comfortable margin;
    // subscribe latency in practice is <50 ms.
    await page.waitForTimeout(3000);

    // WS reconciliation proof: POST a 4th issue and wait for it to appear
    // WITHOUT reloading. This exercises subscribe('AQ') + issue:created
    // handler path end-to-end.
    const lateRes = await request.post(`${API}/issues`, {
      data: { title: 'Late issue (via WS)', status: 'todo' },
    });
    expect(lateRes.status()).toBe(201);
    const lateBody = (await lateRes.json()) as { ok: boolean; data: { id: string } };
    expect(lateBody.ok).toBe(true);

    await page.locator(`[data-issue-card="${lateBody.data.id}"]`).waitFor({ timeout: 5000 });
    await expect(
      page.locator(`[data-issue-column="todo"] [data-issue-card="${lateBody.data.id}"]`),
    ).toHaveCount(1);
  });

  test('mouse drag', async ({ page, request }) => {
    // Scenario 23-02-01: mouse drag from Todo to In Progress. Verifies:
    //   - PATCH /api/issues/:id { status } fires exactly once (cross-column)
    //   - POST /api/issues/:id/reorder { beforeId, afterId } fires exactly once
    //   - UI reflects authoritative position after drop
    // Pre-clean to keep counts deterministic.
    const existingRes = await request.get(`${API}/issues`);
    if (existingRes.ok()) {
      const existingBody = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (existingBody.ok) {
        for (const row of existingBody.data) {
          await request.delete(`${API}/issues/${row.id}`);
        }
      }
    }

    // Seed one Todo issue; we'll drag it to In Progress.
    const seedRes = await request.post(`${API}/issues`, {
      data: { title: 'Drag me to In Progress', status: 'todo' },
    });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string; status: string } };
    expect(seedBody.ok).toBe(true);
    const draggedId = seedBody.data.id;

    // Capture network calls for the dragged issue.
    const patchCalls: { method: string; url: string; postData: unknown }[] = [];
    const reorderCalls: { method: string; url: string; postData: unknown }[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes(`/api/issues/${draggedId}/reorder`)) {
        let postData: unknown = null;
        try { postData = req.postDataJSON(); } catch { /* ignore */ }
        reorderCalls.push({ method: req.method(), url, postData });
        return;
      }
      if (url.includes(`/api/issues/${draggedId}`) && req.method() === 'PATCH') {
        let postData: unknown = null;
        try { postData = req.postDataJSON(); } catch { /* ignore */ }
        patchCalls.push({ method: req.method(), url, postData });
      }
    });

    await page.goto('http://localhost:5173/issues');
    await expect(page.getByTestId('issues-board')).toBeVisible();

    // Let the WS subscribe settle before the drag.
    await page.waitForTimeout(3000);

    const sourceCard = page.locator(`[data-issue-card="${draggedId}"]`);
    await expect(sourceCard).toHaveCount(1);

    // Source card must currently live in the `todo` column.
    await expect(
      page.locator(`[data-issue-column="todo"] [data-issue-card="${draggedId}"]`),
    ).toHaveCount(1);

    // Manual mouse drag: press down on the source card, move >5 px
    // (PointerSensor activation), then move over the in_progress column drop
    // zone, then release. @dnd-kit's PointerSensor reads document-level
    // pointermove events so driving page.mouse directly is sufficient.
    const sourceBox = await sourceCard.boundingBox();
    expect(sourceBox).not.toBeNull();
    const targetColumn = page.locator('[data-issue-column="in_progress"]');
    await expect(targetColumn).toHaveCount(1);
    const targetBox = await targetColumn.boundingBox();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    // Move >5 px to cross the activation threshold.
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2 + 10,
      sourceBox!.y + sourceBox!.height / 2 + 10,
      { steps: 5 },
    );
    // Move over the target column center.
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    // Wait for the POST /reorder round-trip + state application.
    await page.waitForTimeout(1500);

    // Verify the card now lives under the in_progress column.
    await expect(
      page.locator(`[data-issue-column="in_progress"] [data-issue-card="${draggedId}"]`),
    ).toHaveCount(1);

    // Exactly one PATCH (cross-column) and exactly one POST /reorder.
    expect(patchCalls.length, `PATCH calls: ${JSON.stringify(patchCalls)}`).toBe(1);
    expect(reorderCalls.length, `reorder calls: ${JSON.stringify(reorderCalls)}`).toBe(1);

    // PATCH body shape must contain status: 'in_progress'.
    expect(patchCalls[0].postData).toMatchObject({ status: 'in_progress' });
    // POST /reorder body shape must contain beforeId + afterId keys (values
    // may be null when the target column is empty).
    const reorderBody = reorderCalls[0].postData as { beforeId?: unknown; afterId?: unknown };
    expect(reorderBody).toHaveProperty('beforeId');
    expect(reorderBody).toHaveProperty('afterId');

    // Server-side verification: DB now holds status='in_progress'.
    const finalRes = await request.get(`${API}/issues/${draggedId}`);
    expect(finalRes.ok()).toBeTruthy();
    const finalBody = (await finalRes.json()) as { ok: boolean; data: { status: string; position: number | null } };
    expect(finalBody.ok).toBe(true);
    expect(finalBody.data.status).toBe('in_progress');
  });

  test('concurrent reorder', () => {
    test.skip(true, 'wired in 23-02');
  });

  test('own echo', () => {
    test.skip(true, 'wired in 23-02');
  });

  test('virtualization', () => {
    test.skip(true, 'wired in 23-03');
  });

  test('virtualization drag', () => {
    test.skip(true, 'wired in 23-03');
  });

  test('keyboard drag', () => {
    test.skip(true, 'wired in 23-04');
  });

  test('a11y announcer', () => {
    test.skip(true, 'wired in 23-04');
  });
});
