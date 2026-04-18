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

  test('agents list renders', async ({ page }) => {
    test.skip(true, 'Wave 1 / plan 25-01 wires this');
    // Seeds 2 runtimes + 3 agents via DB writes, navigates to /agents, and
    // asserts the shadcn Table renders 3 [data-agent-row] rows with the
    // runtime badge, status badge, and max-concurrent column populated.
    void page;
  });

  test('agent form create', async ({ page }) => {
    test.skip(true, 'Wave 1 / plan 25-01 wires this');
    // Opens AgentFormDialog, fills name + instructions + runtime +
    // custom_env + custom_args + max_concurrent_tasks, clicks Create agent,
    // asserts new row appears in AgentList + POST /api/agents was called.
    void page;
  });

  test('agent archive', async ({ page }) => {
    test.skip(true, 'Wave 1 / plan 25-01 wires this');
    // Opens row dropdown → Archive, confirms dialog, asserts agent moves
    // to Archived tab + archivedAt is non-null in DB.
    void page;
  });

  test('runtimes unified list', async ({ page }) => {
    test.skip(true, 'Wave 2 / plan 25-02 wires this');
    // Seeds 1 hosted_instance runtime + 1 local_daemon runtime + 1
    // external_cloud_daemon runtime. Navigates to /runtimes. Asserts all
    // three appear in the unified table (MGMT-02 HARD invariant: NO
    // per-kind table split). Clicks each kind filter chip, asserts the
    // chip count matches + only matching rows remain visible.
    void page;
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
