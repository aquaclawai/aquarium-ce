import type { Knex } from 'knex';
import { addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    addJsonColumn(t, 'config').notNullable().defaultTo('{}');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('config');
  });
}
