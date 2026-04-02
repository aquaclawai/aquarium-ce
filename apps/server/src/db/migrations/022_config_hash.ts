import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (table) => {
    table.string('config_hash', 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (table) => {
    table.dropColumn('config_hash');
  });
}
