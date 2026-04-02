import type { Knex } from 'knex';
import { addCheckConstraint, dropConstraint } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.string('security_profile', 20).notNullable().defaultTo('standard');
  });
  await addCheckConstraint(
    knex,
    'instances',
    'chk_security_profile',
    "security_profile IN ('strict','standard','developer','unrestricted')"
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropConstraint(knex, 'instances', 'chk_security_profile');
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('security_profile');
  });
}
