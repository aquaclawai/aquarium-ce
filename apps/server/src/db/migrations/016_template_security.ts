import type { Knex } from 'knex';
import { addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('template_contents', (t) => {
    addJsonColumn(t, 'security').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('template_contents', (t) => {
    t.dropColumn('security');
  });
}
