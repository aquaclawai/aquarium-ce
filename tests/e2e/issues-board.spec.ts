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

test.describe.serial('Phase 23 — Issue Board UI (Kanban)', () => {
  test('renders columns', () => {
    test.skip(true, 'wired in 23-01');
  });

  test('mouse drag', () => {
    test.skip(true, 'wired in 23-02');
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
