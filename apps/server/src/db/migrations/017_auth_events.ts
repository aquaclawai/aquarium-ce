import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_events', (table) => {
    addUuidPrimary(table, knex, 'id');
    table.string('event_type', 50).notNullable();
    addUuidColumn(table, 'user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('email', 255).notNullable();
    table.string('ip_address', 45);
    table.text('user_agent');
    table.string('failure_reason', 255);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.raw('CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at DESC)');
  await knex.schema.raw('CREATE INDEX idx_auth_events_type ON auth_events(event_type, created_at DESC)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_events');
}
