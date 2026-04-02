import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_credentials', (t) => {
    t.string('role', 20).notNullable().defaultTo('default');
    t.string('status', 20).notNullable().defaultTo('active');
    t.integer('usage_count').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_credentials', (t) => {
    t.dropColumn('role');
    t.dropColumn('status');
    t.dropColumn('usage_count');
  });
}
