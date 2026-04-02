import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';

export async function up(knex: Knex): Promise<void> {
  if (getAdapter().dialect === 'pg') {
    await knex.raw(`
      UPDATE instances
      SET config = jsonb_set(
        jsonb_set(
          config::jsonb,
          '{defaultProvider}',
          '"openrouter"'
        ),
        '{defaultModel}',
        '"anthropic/claude-sonnet-4"'
      )
      WHERE agent_type = 'openclaw'
        AND config::jsonb ->> 'defaultProvider' = 'anthropic'
    `);
  } else {
    await knex.raw(`
      UPDATE instances
      SET config = json_set(
        json_set(config, '$.defaultProvider', 'openrouter'),
        '$.defaultModel', 'anthropic/claude-sonnet-4'
      )
      WHERE agent_type = 'openclaw'
        AND json_extract(config, '$.defaultProvider') = 'anthropic'
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (getAdapter().dialect === 'pg') {
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
      WHERE agent_type = 'openclaw'
        AND config::jsonb ->> 'defaultProvider' = 'openrouter'
    `);
  } else {
    await knex.raw(`
      UPDATE instances
      SET config = json_set(
        json_set(config, '$.defaultProvider', 'anthropic'),
        '$.defaultModel', 'claude-sonnet-4-20250514'
      )
      WHERE agent_type = 'openclaw'
        AND json_extract(config, '$.defaultProvider') = 'openrouter'
    `);
  }
}
