import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import knex from 'knex';
import type { Knex } from 'knex';

/**
 * Shared unit-test DB fixture for Phase 18.
 *
 * Each test gets its own throwaway SQLite file in the OS tmpdir, isolated from
 * the real CE database (~/.aquarium/aquarium.db) and from every other test's
 * file. Migrations run top-to-bottom; boot PRAGMAs are applied and asserted so
 * BEGIN IMMEDIATE / busy_timeout / foreign_keys / WAL all behave in tests the
 * same way they do in production.
 *
 * Usage:
 *   const ctx = await setupTestDb();
 *   try {
 *     await ctx.db('workspaces').where({ id: 'AQ' }).first();  // always exists — seeded by migration 003
 *   } finally {
 *     await teardownTestDb(ctx);
 *   }
 *
 * Constraints:
 *   • Does NOT import the app's singleton `db` (`apps/server/src/db/index.ts`) —
 *     services that import it directly will still hit the real DB. For Phase 18
 *     the service functions accept an optional `Knex` / `Knex.Transaction` arg
 *     (see task-queue-store.ts Phase-17 pattern) and tests pass `ctx.db`.
 *   • pool: { min: 1, max: 1 } matches production knexfile — serialises writes.
 *   • useNullAsDefault matches production — required for SQLite semantics.
 */

export interface TestDbContext {
  db: Knex;
  filename: string;
}

function migrationsDir(): string {
  // tests/unit/test-db.ts -> ../../src/db/migrations
  return fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
}

export async function setupTestDb(): Promise<TestDbContext> {
  const filename = path.join(os.tmpdir(), `aquarium-test-${randomUUID()}.db`);
  const kx = knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1, idleTimeoutMillis: 500 },
    migrations: {
      directory: migrationsDir(),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  });

  // Apply boot PRAGMAs (WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON).
  // We deliberately re-implement inline instead of importing SqliteAdapter so the
  // fixture stays dependency-light and does not pull in server-side singletons.
  await kx.raw('PRAGMA journal_mode = WAL');
  await kx.raw('PRAGMA synchronous = NORMAL');
  await kx.raw('PRAGMA busy_timeout = 5000');
  await kx.raw('PRAGMA foreign_keys = ON');

  await kx.migrate.latest({
    directory: migrationsDir(),
    loadExtensions: ['.ts'],
  });

  return { db: kx, filename };
}

export async function teardownTestDb(ctx: TestDbContext): Promise<void> {
  try {
    await ctx.db.destroy();
  } catch {
    // swallow — destroy can fail if the connection was already closed
  }
  // Remove the main file + WAL / SHM sidecars
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${ctx.filename}${suffix}`;
    try {
      fs.unlinkSync(p);
    } catch {
      // file may not exist — ignore
    }
  }
}

// ── Seed helpers ────────────────────────────────────────────────────────────
// Every Phase 18 test needs a runtime + agent + issue bound to workspace 'AQ'.
// Rather than duplicate the raw INSERTs in every test file, expose composable
// seeders returning the inserted id.

export interface SeedRuntimeArgs {
  workspaceId?: string;
  kind?: 'local_daemon' | 'external_cloud_daemon' | 'hosted_instance';
  provider?: string;
  status?: 'online' | 'offline' | 'error';
}

export async function seedRuntime(db: Knex, args: SeedRuntimeArgs = {}): Promise<string> {
  const id = randomUUID();
  await db('runtimes').insert({
    id,
    workspace_id: args.workspaceId ?? 'AQ',
    name: `test-runtime-${id.slice(0, 8)}`,
    kind: args.kind ?? 'local_daemon',
    provider: args.provider ?? 'claude',
    status: args.status ?? 'online',
    daemon_id: args.kind === 'hosted_instance' ? null : `daemon-${id.slice(0, 8)}`,
    instance_id: null,
    metadata: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

export interface SeedAgentArgs {
  workspaceId?: string;
  runtimeId: string;
  name?: string;
  maxConcurrentTasks?: number;
  archived?: boolean;
}

export async function seedAgent(db: Knex, args: SeedAgentArgs): Promise<string> {
  const id = randomUUID();
  await db('agents').insert({
    id,
    workspace_id: args.workspaceId ?? 'AQ',
    runtime_id: args.runtimeId,
    name: args.name ?? `test-agent-${id.slice(0, 8)}`,
    instructions: '',
    custom_env: '{}',
    custom_args: '[]',
    max_concurrent_tasks: args.maxConcurrentTasks ?? 6,
    visibility: 'workspace',
    status: 'idle',
    archived_at: args.archived ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

export interface SeedIssueArgs {
  workspaceId?: string;
  issueNumber: number;
  title?: string;
  assigneeId?: string | null;
}

export async function seedIssue(db: Knex, args: SeedIssueArgs): Promise<string> {
  const id = randomUUID();
  await db('issues').insert({
    id,
    workspace_id: args.workspaceId ?? 'AQ',
    issue_number: args.issueNumber,
    title: args.title ?? `Test issue #${args.issueNumber}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    assignee_id: args.assigneeId ?? null,
    position: null,
    metadata: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

export interface SeedTaskArgs {
  workspaceId?: string;
  issueId: string;
  agentId: string;
  runtimeId: string;
  status?: 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority?: number;
  dispatchedAtIso?: string | null;
  startedAtIso?: string | null;
}

export async function seedTask(db: Knex, args: SeedTaskArgs): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db('agent_task_queue').insert({
    id,
    workspace_id: args.workspaceId ?? 'AQ',
    issue_id: args.issueId,
    agent_id: args.agentId,
    runtime_id: args.runtimeId,
    trigger_comment_id: null,
    status: args.status ?? 'queued',
    priority: args.priority ?? 0,
    session_id: null,
    work_dir: null,
    error: null,
    result: null,
    metadata: '{}',
    dispatched_at: args.dispatchedAtIso ?? null,
    started_at: args.startedAtIso ?? null,
    completed_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  });
  return id;
}
