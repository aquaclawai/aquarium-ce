import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE instances
    SET config = jsonb_set(
      jsonb_set(
        config::jsonb,
        '{defaultProvider}',
        '"openrouter"'
      ),
      '{defaultModel}',
      '"anthropic/claude-sonnet-4.5"'
    )
    WHERE agent_type = 'opencode'
      AND config::jsonb ->> 'defaultProvider' = 'anthropic'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE instances
    SET config = jsonb_set(
      jsonb_set(
        config::jsonb,
        '{defaultProvider}',
        '"anthropic"'
      ),
      '{defaultModel}',
      '"claude-sonnet-4-20250514"'
    )
    WHERE agent_type = 'opencode'
      AND config::jsonb ->> 'defaultProvider' = 'openrouter'
  `);
}
