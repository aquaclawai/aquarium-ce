import type { Knex } from 'knex';
import { addCheckConstraint, dropConstraint } from '../migration-helpers.js';

/**
 * 'standard' profile disables bundled skills, plugins, and coding tools —
 * too restrictive for most use cases.  Switch default to 'developer' and
 * migrate existing 'standard' instances so they get full tool/skill access.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('instances')
    .where('security_profile', 'standard')
    .update({ security_profile: 'developer' });

  await knex.schema.alterTable('instances', (t) => {
    t.string('security_profile', 20).notNullable().defaultTo('developer').alter();
  });

  await dropConstraint(knex, 'instances', 'chk_security_profile');
  await addCheckConstraint(
    knex,
    'instances',
    'chk_security_profile',
    "security_profile IN ('strict','standard','developer','unrestricted')"
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.string('security_profile', 20).notNullable().defaultTo('standard').alter();
  });
}
