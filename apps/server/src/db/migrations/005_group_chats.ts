import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addUuidArrayColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // 1. group_chats — chat rooms
  await knex.schema.createTable('group_chats', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('default_mention_mode', 20).notNullable().defaultTo('broadcast');
    t.integer('max_bot_chain_depth').notNullable().defaultTo(3);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('user_id');
  });

  // 2. group_chat_members — bot instances in a group chat
  await knex.schema.createTable('group_chat_members', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'group_chat_id').notNullable().references('id').inTable('group_chats').onDelete('CASCADE');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('display_name', 100).notNullable();
    t.timestamp('joined_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['group_chat_id', 'instance_id']);
    t.index('group_chat_id');
    t.index('instance_id');
  });

  // 3. group_chat_messages — message history (single source of truth)
  await knex.schema.createTable('group_chat_messages', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'group_chat_id').notNullable().references('id').inTable('group_chats').onDelete('CASCADE');
    t.string('sender_type', 10).notNullable(); // 'user' | 'bot' | 'system'
    addUuidColumn(t, 'sender_instance_id').nullable().references('id').inTable('instances').onDelete('SET NULL');
    t.text('content').notNullable();
    addUuidArrayColumn(t, 'mentioned_instance_ids').notNullable().defaultTo('{}');
    addUuidColumn(t, 'reply_to_message_id').nullable().references('id').inTable('group_chat_messages').onDelete('SET NULL');
    t.integer('chain_depth').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('group_chat_id');
  });

  await knex.raw(
    'CREATE INDEX idx_group_chat_messages_created ON group_chat_messages(group_chat_id, created_at)',
  );

  // 4. group_chat_delivery_status — per-message per-target delivery tracking
  await knex.schema.createTable('group_chat_delivery_status', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'message_id').notNullable().references('id').inTable('group_chat_messages').onDelete('CASCADE');
    addUuidColumn(t, 'target_instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('pending');
    t.text('error_message').nullable();
    addUuidColumn(t, 'response_message_id').nullable().references('id').inTable('group_chat_messages').onDelete('SET NULL');
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.timestamp('processing_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('error_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['message_id', 'target_instance_id']);
    t.index('message_id');
    t.index('target_instance_id');
  });

  await knex.raw(
    `CREATE INDEX idx_delivery_status_pending ON group_chat_delivery_status(status) WHERE status IN ('pending', 'delivered', 'processing')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_delivery_status_pending');
  await knex.schema.dropTableIfExists('group_chat_delivery_status');

  await knex.raw('DROP INDEX IF EXISTS idx_group_chat_messages_created');
  await knex.schema.dropTableIfExists('group_chat_messages');

  await knex.schema.dropTableIfExists('group_chat_members');
  await knex.schema.dropTableIfExists('group_chats');
}
