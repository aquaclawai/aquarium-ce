import type { Knex } from 'knex';
import { alterColumnNullable } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.string('workos_id', 255).nullable().unique();
    t.boolean('force_password_change').notNullable().defaultTo(false);
  });

  // Make password_hash nullable for WorkOS users (who have no local password)
  await alterColumnNullable(knex, 'users', 'password_hash', true);
}

export async function down(knex: Knex): Promise<void> {
  // Restore NOT NULL (fill nulls first to avoid failure)
  await knex.raw("UPDATE users SET password_hash = '' WHERE password_hash IS NULL");
  await alterColumnNullable(knex, 'users', 'password_hash', false);

  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('workos_id');
    t.dropColumn('force_password_change');
  });
}
