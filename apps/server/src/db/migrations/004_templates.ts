import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // 1. templates — manifest / metadata for bot templates
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

    // author
    addUuidColumn(t, 'author_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('author_name', 256).nullable();

    // publishing
    t.string('license', 32).notNullable().defaultTo('private');
    t.string('trust_level', 32).notNullable().defaultTo('community');

    // compatibility
    t.string('min_image_tag', 64).nullable();
    t.string('agent_type', 64).notNullable().defaultTo('openclaw');

    // declarations (structured, indexable)
    addJsonColumn(t, 'required_credentials').notNullable().defaultTo('[]');
    addJsonColumn(t, 'mcp_servers').notNullable().defaultTo('{}');
    addJsonColumn(t, 'skills').notNullable().defaultTo('[]');
    addJsonColumn(t, 'suggested_channels').notNullable().defaultTo('[]');

    // fork tracking
    addUuidColumn(t, 'forked_from').nullable().references('id').inTable('templates').onDelete('SET NULL');

    // stats
    t.integer('install_count').notNullable().defaultTo(0);
    t.integer('fork_count').notNullable().defaultTo(0);
    t.decimal('rating', 3, 2).notNullable().defaultTo(0);

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['slug', 'version']);
    t.index('author_id');
  });

  // Partial indexes use WHERE clause — SQLite supports these, so they stay as-is
  await knex.raw('CREATE INDEX idx_templates_category ON templates(category) WHERE is_latest = true');
  await knex.raw('CREATE INDEX idx_templates_license ON templates(license) WHERE is_latest = true');

  // GIN index is Postgres-specific — no equivalent at CE scale
  if (getAdapter().dialect === 'pg') {
    await knex.raw('CREATE INDEX idx_templates_tags ON templates USING GIN(tags)');
  }
  // SQLite: no GIN index equivalent; not needed at CE scale. Regular queries on tags use json_extract.

  // 2. template_contents — full template payload (workspace files, MCP configs, skills, openclaw config)
  await knex.schema.createTable('template_contents', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE');
    addJsonColumn(t, 'workspace_files').notNullable().defaultTo('{}');
    addJsonColumn(t, 'mcp_server_configs').notNullable().defaultTo('{}');
    addJsonColumn(t, 'inline_skills').notNullable().defaultTo('{}');
    addJsonColumn(t, 'openclaw_config').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['template_id']);
  });

  // 3. user_credentials — user-level credential vault (cross-instance)
  await knex.schema.createTable('user_credentials', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('provider', 128).notNullable();
    t.string('credential_type', 128).notNullable();
    t.text('encrypted_value').notNullable();
    t.string('display_name', 256).nullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'provider', 'credential_type']);
    t.index('user_id');
  });

  // 4. ALTER instances — track which template/version created the instance
  await knex.schema.alterTable('instances', (t) => {
    addUuidColumn(t, 'template_id').nullable().references('id').inTable('templates').onDelete('SET NULL');
    t.string('template_version', 32).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Reverse order: remove added columns first, then drop tables
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('template_version');
    t.dropColumn('template_id');
  });

  await knex.schema.dropTableIfExists('user_credentials');
  await knex.schema.dropTableIfExists('template_contents');

  // Drop partial/GIN indexes before dropping the table
  if (getAdapter().dialect === 'pg') {
    await knex.raw('DROP INDEX IF EXISTS idx_templates_tags');
  }
  await knex.raw('DROP INDEX IF EXISTS idx_templates_license');
  await knex.raw('DROP INDEX IF EXISTS idx_templates_category');

  await knex.schema.dropTableIfExists('templates');
}
