import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';
import { alterColumnNullable, dropConstraint } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // 1. group_chat_members: add role, human member support
  await knex.schema.alterTable('group_chat_members', (t) => {
    t.text('role').nullable();                    // role description for context injection
    t.boolean('is_human').notNullable().defaultTo(false);
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');

    // instance_id must become nullable for human members (they have no instance)
  });

  // Make instance_id nullable (ALTER COLUMN ... DROP NOT NULL)
  await alterColumnNullable(knex, 'group_chat_members', 'instance_id', true);

  // Drop the existing unique constraint on (group_chat_id, instance_id) since
  // human members won't have an instance_id
  await dropConstraint(knex, 'group_chat_members', 'group_chat_members_group_chat_id_instance_id_unique');

  // Add a partial unique index: for bot members, (group_chat_id, instance_id) must be unique
  // SQLite supports partial indexes with WHERE clauses, so this works on both dialects
  await knex.raw(
    'CREATE UNIQUE INDEX idx_gcm_bot_unique ON group_chat_members(group_chat_id, instance_id) WHERE instance_id IS NOT NULL'
  );

  // Add a partial unique index: for human members, (group_chat_id, user_id) must be unique
  await knex.raw(
    'CREATE UNIQUE INDEX idx_gcm_human_unique ON group_chat_members(group_chat_id, user_id) WHERE user_id IS NOT NULL'
  );

  // 2. group_chat_delivery_status: add retry tracking
  await knex.schema.alterTable('group_chat_delivery_status', (t) => {
    t.integer('retry_count').notNullable().defaultTo(0);
    t.integer('max_retries').notNullable().defaultTo(3);
    t.timestamp('next_retry_at', { useTz: true }).nullable();
  });

  // 3. group_chat_messages: add sender_user_id for human senders
  await knex.schema.alterTable('group_chat_messages', (t) => {
    t.uuid('sender_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Reverse message changes
  await knex.schema.alterTable('group_chat_messages', (t) => {
    t.dropColumn('sender_user_id');
  });

  // Reverse delivery_status changes
  await knex.schema.alterTable('group_chat_delivery_status', (t) => {
    t.dropColumn('retry_count');
    t.dropColumn('max_retries');
    t.dropColumn('next_retry_at');
  });

  // Reverse member changes
  await knex.raw('DROP INDEX IF EXISTS idx_gcm_human_unique');
  await knex.raw('DROP INDEX IF EXISTS idx_gcm_bot_unique');

  // Delete human members before restoring NOT NULL
  await knex('group_chat_members').where({ is_human: true }).delete();

  await alterColumnNullable(knex, 'group_chat_members', 'instance_id', false);

  // Re-create original unique constraint (Postgres only — SQLite does not support ADD CONSTRAINT)
  if (getAdapter().dialect === 'pg') {
    await knex.raw(
      'ALTER TABLE group_chat_members ADD CONSTRAINT group_chat_members_group_chat_id_instance_id_unique UNIQUE (group_chat_id, instance_id)'
    );
  }

  await knex.schema.alterTable('group_chat_members', (t) => {
    t.dropColumn('role');
    t.dropColumn('is_human');
    t.dropColumn('user_id');
  });
}
