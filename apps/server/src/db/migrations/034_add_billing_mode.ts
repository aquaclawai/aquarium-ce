import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.string('billing_mode', 20).nullable().defaultTo('byok');
    t.string('proxy_key_id', 255).nullable();
    t.string('litellm_key_hash', 255).nullable();
  });

  await knex.schema.alterTable('templates', (t) => {
    t.string('billing_mode', 20).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('billing_mode');
    t.dropColumn('proxy_key_id');
    t.dropColumn('litellm_key_hash');
  });

  await knex.schema.alterTable('templates', (t) => {
    t.dropColumn('billing_mode');
  });
}
