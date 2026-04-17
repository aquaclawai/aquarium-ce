import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * Atomic bulk-seed 200 issues in a single SQLite transaction.
 *
 * Why direct DB access (not 200 API calls):
 * - 200 HTTP POSTs would take ~10 s per scenario × 2 scenarios = 20 s overhead.
 * - Direct DB seed completes in ~20 ms.
 *
 * Why atomic via `workspaces.issue_counter` (not a per-row lookup-plus-one):
 * - A per-row lookup (find the current largest issue number then add one) is
 *   non-atomic under concurrent writers — a real application thread (or a
 *   parallel Playwright worker) could allocate an overlapping issue_number
 *   between our SELECT and INSERT, violating the UNIQUE(workspace_id,
 *   issue_number) constraint.
 * - `workspaces.issue_counter` is the canonical monotonic allocator used by
 *   `createIssue` in apps/server/src/services/issue-store.ts. We replicate
 *   that contract here so the seed is a first-class citizen of the same
 *   allocator, not a second axiom that might diverge.
 * - BEGIN IMMEDIATE acquires a write-lock at the start, serialising any
 *   concurrent writer — atomicity guaranteed across the counter bump + 200
 *   INSERTs.
 *
 * Schema reminders (verified against apps/server/src/db/migrations/006_issues_and_comments.ts):
 * - `issues.issue_number` is NOT trigger-assigned (the only INSERT triggers
 *   are status/priority/comments-author CHECKs). The service fills it.
 * - `issues.status` is CHECK-triggered — must be one of the 6-state enum.
 * - `issues.priority` is CHECK-triggered — must be one of the 5-state enum.
 * - `issues.metadata` is notNullable() and defaults to `'{}'` at the table
 *   level, but direct INSERT bypassing the default requires passing `'{}'`
 *   explicitly.
 */
export function seed200Issues(dbPath: string, workspaceId = 'AQ'): string[] {
  const db = new Database(dbPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    // Read current counter — this is the `base`. The INSERTed rows use
    // base + 1, base + 2, …, base + 200 as their issue_number values.
    const row = db
      .prepare('SELECT issue_counter FROM workspaces WHERE id = ?')
      .get(workspaceId) as { issue_counter: number } | undefined;
    if (!row) throw new Error(`workspace ${workspaceId} missing — cannot seed issues`);
    const base = Number(row.issue_counter);

    // Bump counter by 200 in ONE statement — atomic within the transaction.
    // Forbidden pattern (don't reintroduce): reading the largest existing
    // issue number from the issues table and adding one per row — non-atomic
    // under concurrent writers.
    db.prepare(
      'UPDATE workspaces SET issue_counter = issue_counter + 200 WHERE id = ?',
    ).run(workspaceId);

    const insert = db.prepare(
      `INSERT INTO issues (
         id, workspace_id, issue_number, title, description, status, priority,
         assignee_id, creator_user_id, position, due_date, completed_at,
         cancelled_at, metadata, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, NULL, 'todo', 'none',
         NULL, NULL, NULL, NULL, NULL,
         NULL, '{}', datetime('now'), datetime('now')
       )`,
    );

    const ids: string[] = [];
    for (let i = 1; i <= 200; i++) {
      const id = randomUUID();
      insert.run(id, workspaceId, base + i, `Seed issue ${i}`);
      ids.push(id);
    }

    db.exec('COMMIT');
    return ids;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}
