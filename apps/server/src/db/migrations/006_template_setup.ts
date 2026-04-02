import type { Knex } from 'knex';
import { addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('template_contents', (t) => {
    addJsonColumn(t, 'setup_commands').notNullable().defaultTo('[]');
    t.text('custom_image').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('template_contents', (t) => {
    t.dropColumn('setup_commands');
    t.dropColumn('custom_image');
  });
}
