import type { Knex } from 'knex';

/**
 * CE edition: default security profile should be 'unrestricted' so agents
 * have full tool access (web_search, web_fetch, fs, etc.) out of the box.
 * Migrate existing instances that still use 'standard' or 'developer'.
 */
export async function up(knex: Knex): Promise<void> {
  // Only apply for CE — check EDITION env at migration time
  if ((process.env.EDITION ?? 'ce') !== 'ce') return;

  await knex('instances')
    .whereIn('security_profile', ['standard', 'developer'])
    .update({ security_profile: 'unrestricted' });
}

export async function down(knex: Knex): Promise<void> {
  // No-op: can't reliably revert since we don't know original profiles
}
