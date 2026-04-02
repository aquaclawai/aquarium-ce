import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.string('status_message', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('status_message');
  });
}
