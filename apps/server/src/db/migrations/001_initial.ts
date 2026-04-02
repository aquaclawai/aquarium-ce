import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('display_name', 100).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

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
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'name']);
    t.index('user_id');
    t.index('status');
  });

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

  await knex.schema.createTable('instance_events', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.string('event_type', 50).notNullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('instance_id');
    t.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_events');
  await knex.schema.dropTableIfExists('instance_credentials');
  await knex.schema.dropTableIfExists('instances');
  await knex.schema.dropTableIfExists('users');
}
