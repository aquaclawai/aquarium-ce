import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 005 — Agents.
 *
 * First-class agent entity owning instructions, custom env/args, concurrency
 * limits, status, and archival. References a runtime (SET NULL on delete, per
 * PITFALLS §ST4 prevention — agents are audit data outliving their runtime).
 *
 * SCH-03 requirement. Covers AGENT-01 (CRUD target) and AGENT-02 (concurrent
 * tasks enforcement at claim time).
 *
 * SQLite note: matches the pattern established by migration 004 for enum and
 * range CHECK enforcement. SQLite does not support ALTER TABLE ADD CONSTRAINT
 * CHECK, so we install BEFORE INSERT / BEFORE UPDATE OF <col> triggers that
 * RAISE(ABORT, ...) on violation. Postgres (EE) uses native CHECK constraints.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agents', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('workspace_id', 36).notNullable()
      .references('id').inTable('workspaces').onDelete('CASCADE');
    addUuidColumn(t, 'runtime_id').nullable()
      .references('id').inTable('runtimes').onDelete('SET NULL'); // SET NULL — agents outlive runtimes (PITFALLS §ST4)
    t.string('name', 100).notNullable();
    t.string('avatar_url', 500).nullable();
    t.text('description').nullable();
    t.text('instructions').notNullable().defaultTo('');
    addJsonColumn(t, 'custom_env').notNullable().defaultTo('{}');   // { KEY: value }
    addJsonColumn(t, 'custom_args').notNullable().defaultTo('[]');  // ["--flag", "value"]
    t.integer('max_concurrent_tasks').notNullable().defaultTo(6);   // 1..16 via trigger
    t.string('visibility', 16).notNullable().defaultTo('workspace'); // private|workspace|public
    t.string('status', 16).notNullable().defaultTo('idle');          // idle|working|blocked|error|offline
    addUuidColumn(t, 'owner_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('archived_at', { useTz: true }).nullable();
    addUuidColumn(t, 'archived_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['workspace_id', 'name'], { indexName: 'uq_agents_ws_name' });
    t.index(['workspace_id', 'status'], 'idx_agents_workspace_status');
    t.index(['runtime_id'], 'idx_agents_runtime');
  });

  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();

  if (adapter.dialect === 'sqlite') {
    // max_concurrent_tasks range 1..16
    await knex.raw(`
      CREATE TRIGGER trg_agents_mct_check
      BEFORE INSERT ON agents
      FOR EACH ROW
      WHEN NEW.max_concurrent_tasks < 1 OR NEW.max_concurrent_tasks > 16
      BEGIN
        SELECT RAISE(ABORT, 'agents.max_concurrent_tasks must be between 1 and 16');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_agents_mct_check_upd
      BEFORE UPDATE OF max_concurrent_tasks ON agents
      FOR EACH ROW
      WHEN NEW.max_concurrent_tasks < 1 OR NEW.max_concurrent_tasks > 16
      BEGIN
        SELECT RAISE(ABORT, 'agents.max_concurrent_tasks must be between 1 and 16');
      END;
    `);

    // visibility enum
    await knex.raw(`
      CREATE TRIGGER trg_agents_visibility_check
      BEFORE INSERT ON agents
      FOR EACH ROW
      WHEN NEW.visibility NOT IN ('private','workspace','public')
      BEGIN
        SELECT RAISE(ABORT, 'agents.visibility must be private, workspace, or public');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_agents_visibility_check_upd
      BEFORE UPDATE OF visibility ON agents
      FOR EACH ROW
      WHEN NEW.visibility NOT IN ('private','workspace','public')
      BEGIN
        SELECT RAISE(ABORT, 'agents.visibility must be private, workspace, or public');
      END;
    `);

    // status enum
    await knex.raw(`
      CREATE TRIGGER trg_agents_status_check
      BEFORE INSERT ON agents
      FOR EACH ROW
      WHEN NEW.status NOT IN ('idle','working','blocked','error','offline')
      BEGIN
        SELECT RAISE(ABORT, 'agents.status must be idle, working, blocked, error, or offline');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_agents_status_check_upd
      BEFORE UPDATE OF status ON agents
      FOR EACH ROW
      WHEN NEW.status NOT IN ('idle','working','blocked','error','offline')
      BEGIN
        SELECT RAISE(ABORT, 'agents.status must be idle, working, blocked, error, or offline');
      END;
    `);
  } else {
    // Postgres native CHECK constraints (EE parity)
    await knex.raw(`ALTER TABLE agents ADD CONSTRAINT ck_agents_mct CHECK (max_concurrent_tasks BETWEEN 1 AND 16)`);
    await knex.raw(`ALTER TABLE agents ADD CONSTRAINT ck_agents_visibility CHECK (visibility IN ('private','workspace','public'))`);
    await knex.raw(`ALTER TABLE agents ADD CONSTRAINT ck_agents_status CHECK (status IN ('idle','working','blocked','error','offline'))`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();
  if (adapter.dialect === 'sqlite') {
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_mct_check');
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_mct_check_upd');
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_visibility_check');
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_visibility_check_upd');
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_status_check');
    await knex.raw('DROP TRIGGER IF EXISTS trg_agents_status_check_upd');
  }
  await knex.schema.dropTableIfExists('agents');
}
