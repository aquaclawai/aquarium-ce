import type { Knex } from 'knex';
import { addCheckConstraint, dropConstraint } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await dropConstraint(knex, 'notifications', 'chk_notification_type');

  await addCheckConstraint(
    knex,
    'notifications',
    'chk_notification_type',
    "type IN ('budget_warning', 'budget_critical', 'budget_exhausted', 'burn_rate_spike', 'instance_stopped', 'daily_digest', 'security_audit', 'config_integrity', 'skill_plugin_change', 'dlp_alert')"
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropConstraint(knex, 'notifications', 'chk_notification_type');

  await addCheckConstraint(
    knex,
    'notifications',
    'chk_notification_type',
    "type IN ('budget_warning', 'budget_critical', 'budget_exhausted', 'burn_rate_spike', 'instance_stopped', 'daily_digest')"
  );
}
