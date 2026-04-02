import type { Knex } from 'knex';
import { addUuidPrimary, addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('templates', (table) => {
    table.integer('usage_count').notNullable().defaultTo(0);
    table.boolean('featured').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('system_settings', (table) => {
    addUuidPrimary(table, knex, 'id');
    table.string('key', 255).notNullable().unique();
    addJsonColumn(table, 'value').notNullable();
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_settings');

  await knex.schema.alterTable('templates', (table) => {
    table.dropColumn('usage_count');
    table.dropColumn('featured');
  });
}
