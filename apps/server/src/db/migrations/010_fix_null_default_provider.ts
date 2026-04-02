import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';

export async function up(knex: Knex): Promise<void> {
  // Fix instances where defaultProvider was never set (NULL).
  // These fall back to adapter defaults at runtime but cause issues
  // because the gateway sees a model path like "openrouter/anthropic/..."
  // and tries to use "anthropic" as the provider directly.
  if (getAdapter().dialect === 'pg') {
    await knex.raw(`
      UPDATE instances
      SET config = jsonb_set(
        jsonb_set(
          COALESCE(config::jsonb, '{}'::jsonb),
          '{defaultProvider}',
          '"openrouter"'
        ),
        '{defaultModel}',
        '"anthropic/claude-sonnet-4.5"'
      )
      WHERE config::jsonb ->> 'defaultProvider' IS NULL
         OR config::jsonb ->> 'defaultProvider' = 'anthropic'
    `);
  } else {
    await knex.raw(`
      UPDATE instances
      SET config = json_set(
        json_set(COALESCE(config, '{}'), '$.defaultProvider', 'openrouter'),
        '$.defaultModel', 'anthropic/claude-sonnet-4.5'
      )
      WHERE json_extract(config, '$.defaultProvider') IS NULL
         OR json_extract(config, '$.defaultProvider') = 'anthropic'
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // No-op: we can't distinguish which instances had NULL vs 'anthropic' before
}
