import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('credential_audit_log', (t) => {
    t.increments('id').primary();
    t.string('action', 20).notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('instance_id').nullable().references('id').inTable('instances').onDelete('SET NULL');
    t.string('provider', 100).notNullable();
    t.string('credential_type', 100).notNullable();
    t.string('source', 20).notNullable();
    t.string('ip_address', 45).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_credential_audit_user ON credential_audit_log(user_id, created_at)');
  await knex.raw('CREATE INDEX idx_credential_audit_instance ON credential_audit_log(instance_id, created_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('credential_audit_log');
}
