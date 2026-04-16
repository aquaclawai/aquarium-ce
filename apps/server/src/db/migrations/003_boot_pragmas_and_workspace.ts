import type { Knex } from 'knex';
import { addUuidColumn, addJsonColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 003 — Workspaces + CE default workspace seed.
 *
 * Introduces the workspace entity that every v1.4 table FKs to (SCH-01).
 * In CE this is a single `'AQ'` workspace; EE reuses the same table for
 * multi-workspace support.
 *
 * PRAGMAs (journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000,
 * foreign_keys=ON) are applied at boot by SqliteAdapter.applyBootPragmas
 * — NOT in this migration. A migration runs once, but PRAGMAs must apply
 * every connection, so the two responsibilities are split.
 *
 * Pitfalls addressed:
 *   - SCH1 — sequential numbering from 003 (audit: 001, 002 existed)
 *   - CE1  — `workspace_id` enforcement; seeds the single default row so
 *            every future FK has a target on a fresh DB.
 *   - CE2  — no Postgres-specific SQL (no now(), no gen_random_uuid()).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('workspaces', (t) => {
    // CE uses fixed string IDs ('AQ'); EE may insert UUIDs. Primary key is
    // TEXT(36) so both representations coexist without dialect branching.
    t.string('id', 36).primary();
    t.string('name', 100).notNullable();
    t.string('issue_prefix', 10).notNullable();
    t.integer('issue_counter').notNullable().defaultTo(0);
    addUuidColumn(t, 'owner_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['issue_prefix']);
  });

  // CE single default workspace seed. Must exist on a fresh DB before any
  // v1.4 table that references workspaces.id is created (CE1 pitfall).
  await knex('workspaces').insert({
    id: 'AQ',
    name: 'Default Workspace',
    issue_prefix: 'AQ',
    issue_counter: 0,
    metadata: JSON.stringify({}),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('workspaces');
}
