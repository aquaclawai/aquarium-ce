import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Fix instances where defaultProvider was never set (NULL).
  // These fall back to adapter defaults at runtime but cause issues
  // because the gateway sees a model path like "openrouter/anthropic/..."
  // and tries to use "anthropic" as the provider directly.
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
}

export async function down(knex: Knex): Promise<void> {
  // No-op: we can't distinguish which instances had NULL vs 'anthropic' before
}
