import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';
import { addUuidPrimary, addUuidColumn, addJsonColumn, addCheckConstraint } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notifications', (table) => {
    addUuidPrimary(table, knex, 'id');
    addUuidColumn(table, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    addUuidColumn(table, 'instance_id').nullable().references('id').inTable('instances').onDelete('CASCADE');
    table.string('type', 50).notNullable();
    table.string('severity', 20).notNullable();
    table.string('title', 200).notNullable();
    table.text('body').nullable();
    addJsonColumn(table, 'metadata').notNullable().defaultTo('{}');
    table.timestamp('read_at', { useTz: true }).nullable();
    table.timestamp('dismissed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await addCheckConstraint(
    knex,
    'notifications',
    'chk_notification_type',
    "type IN ('budget_warning', 'budget_critical', 'budget_exhausted', 'burn_rate_spike', 'instance_stopped', 'daily_digest')"
  );

  await addCheckConstraint(
    knex,
    'notifications',
    'chk_notification_severity',
    "severity IN ('info', 'warn', 'critical')"
  );

  // Partial index on unread notifications — SQLite supports WHERE clause
  await knex.raw(`
    CREATE INDEX idx_notifications_user_unread
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL
  `);

  // Dedup index: Postgres uses timezone()::date, SQLite uses date()
  if (getAdapter().dialect === 'pg') {
    await knex.raw(`
      CREATE UNIQUE INDEX idx_notifications_dedup
      ON notifications (user_id, type, (timezone('UTC', created_at)::date))
      WHERE dismissed_at IS NULL
    `);
  } else {
    // SQLite: use date() function for equivalent dedup index
    await knex.raw(`
      CREATE UNIQUE INDEX idx_notifications_dedup
      ON notifications (user_id, type, date(created_at))
      WHERE dismissed_at IS NULL
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notifications');
}
