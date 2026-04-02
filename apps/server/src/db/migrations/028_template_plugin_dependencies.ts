import type { Knex } from 'knex';
import { addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('templates', (t) => {
    addJsonColumn(t, 'plugin_dependencies').notNullable().defaultTo('[]');
  });

  await knex.schema.alterTable('template_contents', (t) => {
    addJsonColumn(t, 'plugin_dependencies').notNullable().defaultTo('[]');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('template_contents', (t) => {
    t.dropColumn('plugin_dependencies');
  });

  await knex.schema.alterTable('templates', (t) => {
    t.dropColumn('plugin_dependencies');
  });
}
