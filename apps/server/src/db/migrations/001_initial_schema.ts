import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn, addUuidArrayColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // ── Users ──────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).nullable();
    t.string('display_name', 100).notNullable();
    t.string('role', 20).notNullable().defaultTo('user');
    t.string('avatar_url', 500).nullable();
    t.timestamp('password_changed_at', { useTz: true }).nullable();
    t.string('totp_secret', 200).nullable();
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    addJsonColumn(t, 'totp_backup_codes').nullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.string('workos_id', 255).nullable().unique();
    t.boolean('force_password_change').notNullable().defaultTo(false);
    t.string('clerk_id', 255).nullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── Instances ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('instances', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('agent_type', 50).notNullable();
    t.string('image_tag', 100).notNullable();
    t.string('status', 20).notNullable().defaultTo('created');
    t.string('deployment_target', 20).notNullable().defaultTo('docker');
    t.string('runtime_id', 255).nullable();
    t.string('control_endpoint', 512).nullable();
    t.string('auth_token', 255).notNullable();
    addJsonColumn(t, 'config').notNullable().defaultTo('{}');
    t.string('status_message', 255).nullable();
    t.string('config_hash', 64).nullable();
    t.string('security_profile', 20).notNullable().defaultTo('unrestricted');
    t.text('avatar').nullable();
    t.string('billing_mode', 20).nullable().defaultTo('byok');
    t.string('proxy_key_id', 255).nullable();
    t.string('litellm_key_hash', 255).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'name']);
    t.index('user_id');
    t.index('status');
  });

  // template FK added after templates table exists
  // (handled below after templates table creation)

  // ── Instance Credentials ───────────────────────────────────────────────────
  await knex.schema.createTable('instance_credentials', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('provider', 50).notNullable();
    t.string('credential_type', 20).notNullable();
    t.text('encrypted_value').notNullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['instance_id', 'provider', 'credential_type']);
    t.index('instance_id');
  });

  // ── Instance Events ────────────────────────────────────────────────────────
  await knex.schema.createTable('instance_events', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('event_type', 50).notNullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('instance_id');
    t.index('created_at');
  });

  // ── Templates ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('templates', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('slug', 128).notNullable();
    t.string('version', 32).notNullable().defaultTo('1.0.0');
    t.boolean('is_latest').notNullable().defaultTo(true);
    t.string('name', 256).notNullable();
    t.text('description').nullable();
    t.string('category', 64).notNullable().defaultTo('custom');
    addJsonColumn(t, 'tags').notNullable().defaultTo('[]');
    t.string('locale', 16).notNullable().defaultTo('en-US');
    addUuidColumn(t, 'author_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('author_name', 256).nullable();
    t.string('license', 32).notNullable().defaultTo('private');
    t.string('trust_level', 32).notNullable().defaultTo('community');
    t.string('min_image_tag', 64).nullable();
    t.string('agent_type', 64).notNullable().defaultTo('openclaw');
    addJsonColumn(t, 'required_credentials').notNullable().defaultTo('[]');
    addJsonColumn(t, 'mcp_servers').notNullable().defaultTo('{}');
    addJsonColumn(t, 'skills').notNullable().defaultTo('[]');
    addJsonColumn(t, 'suggested_channels').notNullable().defaultTo('[]');
    addUuidColumn(t, 'forked_from').nullable().references('id').inTable('templates').onDelete('SET NULL');
    t.integer('install_count').notNullable().defaultTo(0);
    t.integer('fork_count').notNullable().defaultTo(0);
    t.decimal('rating', 3, 2).notNullable().defaultTo(0);
    t.integer('usage_count').notNullable().defaultTo(0);
    t.boolean('featured').notNullable().defaultTo(false);
    t.integer('security_score').notNullable().defaultTo(0);
    addJsonColumn(t, 'plugin_dependencies').notNullable().defaultTo('[]');
    t.string('billing_mode', 20).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['slug', 'version']);
    t.index('author_id');
  });

  // Add template FK to instances now that templates table exists
  await knex.schema.alterTable('instances', (t) => {
    addUuidColumn(t, 'template_id').nullable().references('id').inTable('templates').onDelete('SET NULL');
    t.string('template_version', 32).nullable();
  });

  // ── Template Contents ──────────────────────────────────────────────────────
  await knex.schema.createTable('template_contents', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE').unique();
    addJsonColumn(t, 'workspace_files').notNullable().defaultTo('{}');
    addJsonColumn(t, 'mcp_server_configs').notNullable().defaultTo('{}');
    addJsonColumn(t, 'inline_skills').notNullable().defaultTo('{}');
    addJsonColumn(t, 'openclaw_config').notNullable().defaultTo('{}');
    addJsonColumn(t, 'setup_commands').notNullable().defaultTo('[]');
    t.text('custom_image').nullable();
    addJsonColumn(t, 'security').nullable();
    addJsonColumn(t, 'plugin_dependencies').notNullable().defaultTo('[]');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── User Credentials ───────────────────────────────────────────────────────
  await knex.schema.createTable('user_credentials', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('provider', 128).notNullable();
    t.string('credential_type', 128).notNullable();
    t.text('encrypted_value').notNullable();
    t.string('display_name', 256).nullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.string('role', 20).notNullable().defaultTo('default');
    t.string('status', 20).notNullable().defaultTo('active');
    t.integer('usage_count').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'provider', 'credential_type']);
    t.index('user_id');
  });

  // ── Group Chats ────────────────────────────────────────────────────────────
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

  await knex.schema.createTable('group_chat_members', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'group_chat_id').notNullable().references('id').inTable('group_chats').onDelete('CASCADE');
    addUuidColumn(t, 'instance_id').nullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('display_name', 100).notNullable();
    t.text('role').nullable();
    t.boolean('is_human').notNullable().defaultTo(false);
    addUuidColumn(t, 'user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('joined_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('group_chat_id');
    t.index('instance_id');
  });

  await knex.schema.createTable('group_chat_messages', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'group_chat_id').notNullable().references('id').inTable('group_chats').onDelete('CASCADE');
    t.string('sender_type', 10).notNullable();
    addUuidColumn(t, 'sender_instance_id').nullable().references('id').inTable('instances').onDelete('SET NULL');
    addUuidColumn(t, 'sender_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('content').notNullable();
    addUuidArrayColumn(t, 'mentioned_instance_ids').notNullable().defaultTo('{}');
    addUuidColumn(t, 'reply_to_message_id').nullable().references('id').inTable('group_chat_messages').onDelete('SET NULL');
    t.integer('chain_depth').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('group_chat_id');
    t.index(['group_chat_id', 'created_at']);
  });

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
    t.integer('retry_count').notNullable().defaultTo(0);
    t.integer('max_retries').notNullable().defaultTo(3);
    t.timestamp('next_retry_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['message_id', 'target_instance_id']);
    t.index('message_id');
    t.index('target_instance_id');
  });

  // ── Snapshots ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('snapshots', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users');
    addJsonColumn(t, 'config_snapshot').notNullable();
    addJsonColumn(t, 'workspace_files').notNullable().defaultTo('{}');
    addJsonColumn(t, 'credential_refs').notNullable().defaultTo('[]');
    t.text('description').nullable();
    t.string('trigger_type', 32).notNullable().defaultTo('manual');
    t.text('trigger_detail').nullable();
    t.string('instance_status', 32).nullable();
    t.integer('total_size_bytes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['instance_id', 'created_at']);
    t.index('user_id');
  });

  // ── Notifications ──────────────────────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    addUuidColumn(t, 'instance_id').nullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('type', 50).notNullable();
    t.string('severity', 20).notNullable();
    t.string('title', 200).notNullable();
    t.text('body').nullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('read_at', { useTz: true }).nullable();
    t.timestamp('dismissed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── Auth Events ────────────────────────────────────────────────────────────
  await knex.schema.createTable('auth_events', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('event_type', 50).notNullable();
    addUuidColumn(t, 'user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('email', 255).notNullable();
    t.string('ip_address', 45).nullable();
    t.text('user_agent').nullable();
    t.string('failure_reason', 255).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
    t.index(['event_type', 'created_at']);
  });

  // ── System Settings ────────────────────────────────────────────────────────
  await knex.schema.createTable('system_settings', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('key', 255).notNullable().unique();
    addJsonColumn(t, 'value').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── Credential Audit Log ───────────────────────────────────────────────────
  await knex.schema.createTable('credential_audit_log', (t) => {
    t.increments('id').primary();
    t.string('action', 20).notNullable();
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    addUuidColumn(t, 'instance_id').nullable().references('id').inTable('instances').onDelete('SET NULL');
    t.string('provider', 100).notNullable();
    t.string('credential_type', 100).notNullable();
    t.string('source', 20).notNullable();
    t.string('ip_address', 45).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
    t.index(['instance_id', 'created_at']);
  });

  // ── Wizard Configs ─────────────────────────────────────────────────────────
  await knex.schema.createTable('wizard_configs', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('config_type', 50).notNullable();
    t.string('agent_type', 50).notNullable().defaultTo('openclaw');
    t.string('locale', 10).notNullable().defaultTo('zh-CN');
    addJsonColumn(t, 'items').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['config_type', 'agent_type', 'locale', 'is_active']);
  });

  // ── Extension Tables ───────────────────────────────────────────────────────
  await knex.schema.createTable('instance_plugins', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('plugin_id').notNullable();
    addJsonColumn(t, 'source').notNullable();
    t.string('version').nullable();
    t.string('locked_version').nullable();
    t.string('integrity_hash').nullable();
    t.integer('enabled').notNullable().defaultTo(1);
    addJsonColumn(t, 'config').notNullable().defaultTo('{}');
    t.string('status').notNullable().defaultTo('pending');
    t.text('error_message').nullable();
    t.text('failed_at').nullable();
    t.text('pending_owner').nullable();
    t.integer('retry_count').notNullable().defaultTo(0);
    t.timestamp('installed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['instance_id', 'plugin_id']);
  });

  await knex.schema.createTable('instance_skills', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('skill_id').notNullable();
    addJsonColumn(t, 'source').notNullable();
    t.string('version').nullable();
    t.string('locked_version').nullable();
    t.string('integrity_hash').nullable();
    t.integer('enabled').notNullable().defaultTo(1);
    addJsonColumn(t, 'config').notNullable().defaultTo('{}');
    t.string('status').notNullable().defaultTo('pending');
    t.text('error_message').nullable();
    t.text('failed_at').nullable();
    t.text('pending_owner').nullable();
    t.integer('retry_count').notNullable().defaultTo(0);
    t.timestamp('installed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['instance_id', 'skill_id']);
  });

  await knex.schema.createTable('extension_operations', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.text('fencing_token').notNullable().unique();
    t.text('operation_type').notNullable();
    t.text('target_extension').notNullable();
    t.text('extension_kind').notNullable();
    t.text('pending_owner').notNullable();
    t.integer('cancel_requested').notNullable().defaultTo(0);
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('completed_at').nullable();
    t.text('result').nullable();
    t.text('error_message').nullable();
    t.index(['instance_id', 'completed_at']);
  });

  // Partial unique index: one active (uncompleted) operation per instance
  await knex.raw(
    `CREATE UNIQUE INDEX idx_one_active_op ON extension_operations (instance_id) WHERE completed_at IS NULL`
  );

  // ── Trust Overrides ────────────────────────────────────────────────────────
  await knex.schema.createTable('trust_overrides', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('extension_id').notNullable();
    t.string('extension_kind').notNullable();
    t.string('action').notNullable().defaultTo('allow');
    t.text('reason').notNullable();
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users');
    t.integer('credential_access_acknowledged').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['instance_id', 'extension_id', 'extension_kind']);
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'trust_overrides', 'extension_operations', 'instance_skills', 'instance_plugins',
    'wizard_configs', 'credential_audit_log', 'system_settings', 'auth_events',
    'notifications', 'snapshots', 'group_chat_delivery_status', 'group_chat_messages',
    'group_chat_members', 'group_chats', 'user_credentials', 'template_contents',
    'instance_events', 'instance_credentials', 'instances', 'templates', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
