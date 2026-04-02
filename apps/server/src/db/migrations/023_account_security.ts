import type { Knex } from 'knex';
import { addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.string('avatar_url', 500).nullable();
    t.timestamp('password_changed_at', { useTz: true }).nullable();
    t.string('totp_secret', 200).nullable();
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    addJsonColumn(t, 'totp_backup_codes').nullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('avatar_url');
    t.dropColumn('password_changed_at');
    t.dropColumn('totp_secret');
    t.dropColumn('totp_enabled');
    t.dropColumn('totp_backup_codes');
    t.dropColumn('deleted_at');
  });
}
