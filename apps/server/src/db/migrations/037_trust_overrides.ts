import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('trust_overrides', (table) => {
    addUuidPrimary(table, knex, 'id');
    addUuidColumn(table, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    table.string('extension_id').notNullable();
    table.string('extension_kind').notNullable();  // 'plugin' | 'skill'
    table.string('action').notNullable().defaultTo('allow');
    table.text('reason').notNullable();
    addUuidColumn(table, 'user_id').notNullable();
    table.integer('credential_access_acknowledged').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Unique: one override per extension per instance
    table.unique(['instance_id', 'extension_id', 'extension_kind']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('trust_overrides');
}
