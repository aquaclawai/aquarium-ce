import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn, addCheckConstraint } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('snapshots', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users');

    // Snapshot content
    addJsonColumn(t, 'config_snapshot').notNullable();
    addJsonColumn(t, 'workspace_files').notNullable().defaultTo('{}');
    addJsonColumn(t, 'credential_refs').notNullable().defaultTo('[]');

    // Metadata
    t.text('description').nullable();
    t.string('trigger_type', 32).notNullable().defaultTo('manual');
    t.text('trigger_detail').nullable();
    t.string('instance_status', 32).nullable();
    t.integer('total_size_bytes').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Constraint and indexes
  await addCheckConstraint(knex, 'snapshots', 'valid_trigger', "trigger_type IN ('manual', 'pre_operation', 'daily')");
  await knex.raw(
    'CREATE INDEX idx_snapshots_instance ON snapshots(instance_id, created_at DESC)'
  );
  await knex.raw(
    'CREATE INDEX idx_snapshots_user ON snapshots(user_id)'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('snapshots');
}
