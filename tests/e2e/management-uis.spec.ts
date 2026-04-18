import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 25 — Management UIs (Agents / Runtimes / Daemon Tokens) E2E coverage.
 *
 * Wave 0 scaffold. Every scenario is skipped until wired by the downstream
 * plan noted in the skip reason. Scenario titles match the VALIDATION.md
 * per-task verification map verbatim — do NOT rename without updating the
 * `-g` grep invocations there.
 *
 * Plan wiring map:
 *   25-00 → "sidebar nav" (stays skipped at Wave 0; Wave 1 un-skips once
 *           AgentList lands so the sidebar-nav assertion + agents-list
 *           assertion share a navigation fixture)
 *   25-01 → "agents list renders", "agent form create", "agent archive"
 *   25-02 → "runtimes unified list", "runtime row details"
 *   25-03 → "token copy once", "token create form", "token revoke"
 *
 * Test infrastructure patterns cloned from tests/e2e/issue-detail.spec.ts
 * (API helper + DB fixtures via better-sqlite3). Plans 01–03 attach
 * concrete fixtures as they wire each scenario; Wave 0 only reserves the
 * file + titles + helpers.
 */

const API = 'http://localhost:3001/api';
const DB_PATH = process.env.AQUARIUM_DB_PATH || join(homedir(), '.aquarium', 'aquarium.db');

function uniqueEmail(): string {
  return `phase25-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
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
    data: { email, password: 'hunter2', displayName: 'Phase25 Test' },
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

test.describe.serial('Phase 25 — Management UIs', () => {
  test('sidebar nav', async ({ page }) => {
    test.skip(true, 'Wave 0 / plan 25-00 wires this');
    // Will assert the 3 new sidebar nav entries are visible + clickable:
    //   [data-nav="agents"]        → /agents
    //   [data-nav="runtimes"]      → /runtimes
    //   [data-nav="daemon-tokens"] → /daemon-tokens
    //
    // Deliberately kept skipped at Wave 0 — the pages are stubs that
    // render only <h1> + description. Wave 1 un-skips this alongside
    // the "agents list renders" assertion so navigation + first page
    // content share a real fixture.
    void page;
  });

  test('agents list renders', async ({ page, request }) => {
    // Plan 25-01 Task 1 — seed 3 agents via POST /api/agents, navigate to
    // /agents, assert the shadcn Table renders 3 [data-agent-row] rows with
    // the runtime badge, SC-1 status badge, and max-concurrent column.
    //
    // CE auto-auth: first user in the DB is granted to requests without a
    // bearer token (apps/server/src/middleware/auth.ts).
    //
    // Cleanup: archive any existing agents so we start from a known state.
    const existingRes = await request.get(`${API}/agents`);
    if (existingRes.ok()) {
      const body = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (body.ok) {
        for (const row of body.data) {
          await request.delete(`${API}/agents/${row.id}`);
        }
      }
    }

    // Seed 3 agents. Names are unique-per-run so parallel fixtures do not
    // collide on the UNIQUE(workspace_id, name) constraint.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentNames = [
      `E2E-Agent-A-${suffix}`,
      `E2E-Agent-B-${suffix}`,
      `E2E-Agent-C-${suffix}`,
    ];
    const seeded: { id: string; name: string; status: string }[] = [];
    for (const name of agentNames) {
      const res = await request.post(`${API}/agents`, {
        data: { name, maxConcurrentTasks: 4 },
      });
      expect(res.status(), `seed agent ${name} failed: ${await res.text()}`).toBe(201);
      const json = (await res.json()) as {
        ok: boolean;
        data: { id: string; name: string; status: string };
      };
      expect(json.ok).toBe(true);
      seeded.push(json.data);
    }

    await page.goto('http://localhost:5173/agents');

    await expect(page.locator('[data-page="agents"]')).toBeVisible();
    await expect(page.locator('[data-agent-new-open]')).toBeVisible();

    // 3 rows render with stable data-agent-row markers.
    for (const seed of seeded) {
      await expect(page.locator(`[data-agent-row="${seed.id}"]`)).toBeVisible();
      await expect(page.locator(`[data-agent-row="${seed.id}"]`)).toContainText(seed.name);
    }

    // SC-1 Status column assertion (Blocker-3 fix) — every row renders a
    // Badge with data-agent-status-badge={status}. Newly created agents
    // default to `idle` server-side (apps/server/src/services/agent-store.ts).
    for (const seed of seeded) {
      const row = page.locator(`[data-agent-row="${seed.id}"]`);
      await expect(row.locator('[data-agent-status-badge]')).toHaveCount(1);
      await expect(row.locator(`[data-agent-status-badge="${seed.status}"]`)).toBeVisible();
    }

    // Status column header carries the data-column="status" marker — asserts
    // the column exists without depending on translated header text.
    await expect(page.locator('th[data-column="status"]')).toHaveCount(1);

    // Switch to Archived tab — the tab should activate, and in a clean DB
    // the archivedEmpty state renders. Other test suites leave archived rows
    // behind (Phase 24 agents are archived not hard-deleted), so we only
    // assert the tab is now selected rather than empty.
    await page.locator('[data-agent-tab="archived"]').click();
    await expect(page.locator('[data-agent-tab="archived"][data-state="active"]')).toBeVisible();
  });

  test('agent form create', async ({ page, request }) => {
    // Plan 25-01 Task 2 — open AgentFormDialog from the /agents page, fill
    // every form field (name + instructions + runtime + custom env + custom
    // args + max concurrent), submit, and assert the new row lands in the
    // Active tab with the correct projection shape (customEnv / customArgs /
    // maxConcurrentTasks round-trip through the server).

    // Clear agents so a known-empty table hosts the test.
    const existingRes = await request.get(`${API}/agents`);
    if (existingRes.ok()) {
      const body = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (body.ok) {
        for (const row of body.data) {
          await request.delete(`${API}/agents/${row.id}`);
        }
      }
    }

    // Seed one runtime directly (avoids depending on hosted_instance flow).
    const runtimeId = `rt-25-01-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const runtimeName = `E2E-Runtime-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
    writeDb((db) => {
      db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, metadata,
                               created_at, updated_at)
         VALUES (?, 'AQ', ?, 'local_daemon', 'claude', 'online',
                 ?, NULL, '{}',
                 datetime('now'), datetime('now'))`,
      ).run(runtimeId, runtimeName, `daemon-${runtimeId}`);
    });

    await page.goto('http://localhost:5173/agents');
    await expect(page.locator('[data-page="agents"]')).toBeVisible();

    // Open dialog.
    await page.locator('[data-agent-new-open]').click();
    await expect(page.locator('[data-agent-form-field="name"]')).toBeVisible();

    // Fill fields.
    const agentName = `E2E-Created-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    await page.locator('[data-agent-form-field="name"]').fill(agentName);
    await page
      .locator('[data-agent-form-field="instructions"]')
      .fill('Created by Playwright — Plan 25-01 Task 2.');

    // Runtime Select (Radix) — click trigger, then select the runtime option.
    // Radix portal-positions the option list relative to the trigger; when the
    // trigger is near the dialog's bottom edge the list can render above it
    // and Playwright reports the element as outside the viewport even though
    // it is visible. Using keyboard navigation avoids the viewport check —
    // Radix Select focuses the first option on open and moves via arrows.
    const runtimeTrigger = page.locator('[data-agent-form-field="runtime"]');
    await runtimeTrigger.click();
    const runtimeOption = page.getByRole('option', { name: new RegExp(runtimeName) });
    await runtimeOption.waitFor({ state: 'attached' });
    // Dispatch the click directly on the element — bypasses Playwright's
    // scroll-into-view heuristic for Radix portal content.
    await runtimeOption.dispatchEvent('click');
    // Wait for the trigger to reflect the chosen runtime name.
    await expect(runtimeTrigger).toContainText(runtimeName, { timeout: 5000 });

    // One env row.
    await page.locator('[data-agent-env-add]').click();
    const envRow = page.locator('[data-agent-env-row="0"]');
    await envRow.locator('input').nth(0).fill('MY_KEY');
    await envRow.locator('input').nth(1).fill('my-value');

    // One custom arg.
    await page.locator('[data-agent-args-input]').fill('--verbose');
    await page.locator('[data-agent-args-input]').press('Enter');

    // Max concurrent.
    await page.locator('[data-agent-form-field="maxConcurrent"]').fill('4');

    // Submit.
    await page.locator('[data-agent-form-submit]').click();

    // Dialog closes + row appears.
    await expect(page.locator('[data-agent-form-submit]')).toHaveCount(0);
    const newRow = page.locator(`[data-agent-row]`).filter({ hasText: agentName });
    await expect(newRow).toBeVisible({ timeout: 10000 });
    await expect(newRow.locator('[data-agent-status-badge]')).toBeVisible();

    // DB verify — customEnv / customArgs / maxConcurrentTasks round-tripped.
    const dbRow = readDb((db) =>
      db
        .prepare(
          `SELECT id, name, runtime_id, custom_env, custom_args, max_concurrent_tasks
           FROM agents WHERE name = ?`,
        )
        .get(agentName) as
        | {
            id: string;
            name: string;
            runtime_id: string;
            custom_env: string;
            custom_args: string;
            max_concurrent_tasks: number;
          }
        | undefined,
    );
    expect(dbRow, 'agent row should exist in DB').toBeTruthy();
    expect(dbRow!.runtime_id).toBe(runtimeId);
    expect(dbRow!.max_concurrent_tasks).toBe(4);
    const envObj = JSON.parse(dbRow!.custom_env) as Record<string, string>;
    expect(envObj['MY_KEY']).toBe('my-value');
    const argsArr = JSON.parse(dbRow!.custom_args) as string[];
    expect(argsArr).toContain('--verbose');
  });

  test('agent archive', async ({ page, request }) => {
    // Plan 25-01 Task 3 — open an agent's action dropdown, click Archive,
    // confirm in the destructive-variant dialog, assert the row disappears
    // from Active tab and shows up in Archived tab with archivedAt set.

    // Start from a clean Active slate.
    const existingRes = await request.get(`${API}/agents`);
    if (existingRes.ok()) {
      const body = (await existingRes.json()) as { ok: boolean; data: { id: string }[] };
      if (body.ok) {
        for (const row of body.data) {
          await request.delete(`${API}/agents/${row.id}`);
        }
      }
    }

    // Seed 1 agent via POST.
    const agentName = `E2E-Archive-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const seedRes = await request.post(`${API}/agents`, { data: { name: agentName } });
    expect(seedRes.status()).toBe(201);
    const seedBody = (await seedRes.json()) as { ok: boolean; data: { id: string } };
    expect(seedBody.ok).toBe(true);
    const agentId = seedBody.data.id;

    await page.goto('http://localhost:5173/agents');
    await expect(page.locator(`[data-agent-row="${agentId}"]`)).toBeVisible();

    // Open the row's action dropdown + click Archive.
    await page.locator(`[data-agent-actions-trigger="${agentId}"]`).click();
    await page.locator('[data-agent-action="archive"]').click();

    // Archive dialog opens — title interpolates agent name.
    await expect(
      page.getByRole('dialog').getByText(agentName, { exact: false }),
    ).toBeVisible();

    await page.locator('[data-agent-archive-confirm]').click();

    // Row disappears from Active tab (zero-agent empty state renders).
    await expect(page.locator(`[data-agent-row="${agentId}"]`)).toHaveCount(0, { timeout: 5000 });

    // Switch to Archived tab — the row should appear there with the
    // Archived secondary badge.
    await page.locator('[data-agent-tab="archived"]').click();
    await expect(page.locator(`[data-agent-row="${agentId}"]`)).toBeVisible({ timeout: 5000 });

    // DB confirmation — archived_at is non-null.
    const archivedAt = readDb((db) =>
      (db
        .prepare(`SELECT archived_at FROM agents WHERE id = ?`)
        .get(agentId) as { archived_at: string | null } | undefined)?.archived_at,
    );
    expect(archivedAt, 'archived_at should be set after archive').toBeTruthy();
  });

  test('runtimes unified list', async ({ page }) => {
    // Plan 25-02 Task 1 — seed 3 runtimes across all 3 kinds directly in the
    // DB, navigate to /runtimes, assert all three appear in the unified
    // table (MGMT-02 HARD invariant: NO per-kind table split), then click
    // each kind-filter chip and assert the URL + visible rows change.

    // Clean any pre-existing rows so our chip counts are deterministic.
    writeDb((db) => {
      db.prepare(`DELETE FROM runtimes WHERE workspace_id = 'AQ'`).run();
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const hostedId = `rt-hosted-${suffix}`;
    const localId = `rt-local-${suffix}`;
    const cloudId = `rt-cloud-${suffix}`;
    const hostedName = `E2E-Hosted-${suffix}`;
    const localName = `E2E-Local-${suffix}`;
    const cloudName = `E2E-Cloud-${suffix}`;
    const recent = new Date(Date.now() - 30_000).toISOString();

    writeDb((db) => {
      const insert = db.prepare(
        `INSERT INTO runtimes (id, workspace_id, name, kind, provider, status,
                               daemon_id, instance_id, device_info,
                               last_heartbeat_at, metadata,
                               created_at, updated_at)
         VALUES (@id, 'AQ', @name, @kind, @provider, @status,
                 @daemon_id, @instance_id, @device_info,
                 @last_heartbeat_at, '{}',
                 datetime('now'), datetime('now'))`,
      );
      insert.run({
        id: hostedId,
        name: hostedName,
        kind: 'hosted_instance',
        provider: 'hosted',
        status: 'online',
        daemon_id: null,
        instance_id: null,
        device_info: null,
        last_heartbeat_at: null,
      });
      insert.run({
        id: localId,
        name: localName,
        kind: 'local_daemon',
        provider: 'claude',
        status: 'online',
        daemon_id: `daemon-${localId}`,
        instance_id: null,
        device_info: '{"os":"darwin","arch":"arm64","hostname":"mbp","version":"14.2"}',
        last_heartbeat_at: recent,
      });
      insert.run({
        id: cloudId,
        name: cloudName,
        kind: 'external_cloud_daemon',
        provider: 'codex',
        status: 'online',
        daemon_id: `daemon-${cloudId}`,
        instance_id: null,
        device_info: '{"os":"linux","arch":"x64","hostname":"fly-io","version":"22.04"}',
        last_heartbeat_at: recent,
      });
    });

    await page.goto('http://localhost:5173/runtimes');
    await expect(page.locator('[data-page="runtimes"]')).toBeVisible();

    // 3 rows rendered with stable data-runtime-row markers.
    await expect(page.locator(`[data-runtime-row="${hostedId}"]`)).toBeVisible();
    await expect(page.locator(`[data-runtime-row="${localId}"]`)).toBeVisible();
    await expect(page.locator(`[data-runtime-row="${cloudId}"]`)).toBeVisible();

    // Per-kind data attributes for the unified-list invariant assertion.
    await expect(
      page.locator(`[data-runtime-row="${hostedId}"][data-runtime-kind="hosted_instance"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-runtime-row="${localId}"][data-runtime-kind="local_daemon"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-runtime-row="${cloudId}"][data-runtime-kind="external_cloud_daemon"]`),
    ).toBeVisible();

    // Click Hosted chip → only hosted row visible + URL contains ?kind=hosted_instance.
    await page.locator('[data-kind-filter="hosted_instance"]').click();
    await expect(page).toHaveURL(/\?kind=hosted_instance/);
    await expect(page.locator(`[data-runtime-row="${hostedId}"]`)).toBeVisible();
    await expect(page.locator(`[data-runtime-row="${localId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-runtime-row="${cloudId}"]`)).toHaveCount(0);

    // Click All chip → all three rows reappear.
    await page.locator('[data-kind-filter="all"]').click();
    await expect(page.locator(`[data-runtime-row="${hostedId}"]`)).toBeVisible();
    await expect(page.locator(`[data-runtime-row="${localId}"]`)).toBeVisible();
    await expect(page.locator(`[data-runtime-row="${cloudId}"]`)).toBeVisible();
  });

  test('runtime row details', async ({ page }) => {
    test.skip(true, 'Wave 2 / plan 25-02 wires this');
    // Asserts each runtime row renders device_info + last_heartbeat_at +
    // status badge. Clicking a row opens the Sheet detail drawer with
    // device_info JSON pretty-printed + metadata.
    void page;
  });

  test('token copy once', async ({ page }) => {
    test.skip(true, 'Wave 3 / plan 25-03 wires this');
    // MGMT-03 HARD invariant. Creates a token via the form → copy-once
    // dialog shows plaintext exactly once in a <pre> block. Clicking
    // "I've saved it" dismisses; revisit /daemon-tokens; plaintext is
    // gone from DOM + never in localStorage/sessionStorage (CI grep
    // guard also enforces the storage invariant at build time).
    void page;
  });

  test('token create form', async ({ page }) => {
    test.skip(true, 'Wave 3 / plan 25-03 wires this');
    // Create modal: name (required, ≤ 100 chars) + optional expiry date
    // picker. Validates name required + expiry-must-be-future. Submits
    // via POST /api/daemon-tokens → response carries plaintext exactly
    // once.
    void page;
  });

  test('token revoke', async ({ page }) => {
    test.skip(true, 'Wave 3 / plan 25-03 wires this');
    // Row action Revoke → confirm dialog → POST /api/daemon-tokens/:id/
    // revoke → row flips to status=revoked (badge + derived projection).
    // Body warns this is NOT reversible. After confirm: revokedAt non-
    // null in DB.
    void page;
  });
});
