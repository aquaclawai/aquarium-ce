import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // 1. instance_plugins table
  await knex.schema.createTable('instance_plugins', (table) => {
    addUuidPrimary(table, knex, 'id');
    addUuidColumn(table, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    table.string('plugin_id').notNullable();
    addJsonColumn(table, 'source').notNullable();
    table.string('version').nullable();
    table.string('locked_version').nullable();
    table.string('integrity_hash').nullable();
    table.integer('enabled').notNullable().defaultTo(1);
    addJsonColumn(table, 'config').notNullable().defaultTo('{}');
    table.string('status').notNullable().defaultTo('pending');
    table.text('error_message').nullable();
    table.text('failed_at').nullable();
    table.text('pending_owner').nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.timestamp('installed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['instance_id', 'plugin_id']);
  });

  // 2. instance_skills table (same schema as instance_plugins, with skill_id instead of plugin_id)
  await knex.schema.createTable('instance_skills', (table) => {
    addUuidPrimary(table, knex, 'id');
    addUuidColumn(table, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    table.string('skill_id').notNullable();
    addJsonColumn(table, 'source').notNullable();
    table.string('version').nullable();
    table.string('locked_version').nullable();
    table.string('integrity_hash').nullable();
    table.integer('enabled').notNullable().defaultTo(1);
    addJsonColumn(table, 'config').notNullable().defaultTo('{}');
    table.string('status').notNullable().defaultTo('pending');
    table.text('error_message').nullable();
    table.text('failed_at').nullable();
    table.text('pending_owner').nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.timestamp('installed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['instance_id', 'skill_id']);
  });

  // 3. extension_operations table
  await knex.schema.createTable('extension_operations', (table) => {
    addUuidPrimary(table, knex, 'id');
    addUuidColumn(table, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    table.text('fencing_token').notNullable().unique();
    table.text('operation_type').notNullable();
    table.text('target_extension').notNullable();
    table.text('extension_kind').notNullable();
    table.text('pending_owner').notNullable();
    table.integer('cancel_requested').notNullable().defaultTo(0);
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('completed_at').nullable();
    table.text('result').nullable();
    table.text('error_message').nullable();
    // Composite index for querying active operations per instance
    table.index(['instance_id', 'completed_at'], 'idx_ext_ops_instance');
  });

  // Partial unique index: enforce only one active (uncompleted) operation per instance.
  // Knex schema builder does not support partial indexes natively — use raw SQL.
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_op ON extension_operations (instance_id) WHERE completed_at IS NULL'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_one_active_op');
  await knex.schema.dropTableIfExists('extension_operations');
  await knex.schema.dropTableIfExists('instance_skills');
  await knex.schema.dropTableIfExists('instance_plugins');
}
