import type { Knex } from 'knex';
import { getAdapter } from '../adapter.js';

/**
 * Migration: Remap orphan config keys from AssistantEditPage bug.
 *
 * The frontend was saving:
 *   - config.principles (should be config.soulmd)
 *   - config.identityDescription (should be config.identitymd)
 *   - config.agentName (should sync to instances.name column)
 *
 * These orphan fields were stored in the JSONB blob but never read by the
 * gateway adapter (which expects soulmd/identitymd). This migration:
 *   1. Copies orphan values to correct keys (only if correct key is absent)
 *   2. Syncs config.agentName to instances.name (only if name differs)
 *   3. Removes all three orphan keys from the config blob
 *
 * Note: Uses jsonb_exists() instead of the ? operator because Knex treats
 * ? as a parameter placeholder in raw queries.
 */
export async function up(knex: Knex): Promise<void> {
  if (getAdapter().dialect === 'pg') {
    // Step 1: Copy principles → soulmd where soulmd is missing
    await knex.raw(`
      UPDATE instances
      SET config = jsonb_set(
        config::jsonb,
        '{soulmd}',
        config::jsonb -> 'principles'
      )
      WHERE jsonb_exists(config::jsonb, 'principles')
        AND NOT jsonb_exists(config::jsonb, 'soulmd')
    `);

    // Step 2: Copy identityDescription → identitymd where identitymd is missing
    await knex.raw(`
      UPDATE instances
      SET config = jsonb_set(
        config::jsonb,
        '{identitymd}',
        config::jsonb -> 'identityDescription'
      )
      WHERE jsonb_exists(config::jsonb, 'identityDescription')
        AND NOT jsonb_exists(config::jsonb, 'identitymd')
    `);

    // Step 3: Sync config.agentName → instances.name where they differ
    await knex.raw(`
      UPDATE instances
      SET name = config::jsonb ->> 'agentName'
      WHERE jsonb_exists(config::jsonb, 'agentName')
        AND config::jsonb ->> 'agentName' IS NOT NULL
        AND config::jsonb ->> 'agentName' != ''
        AND name != config::jsonb ->> 'agentName'
    `);

    // Step 4: Remove orphan keys from config
    await knex.raw(`
      UPDATE instances
      SET config = config::jsonb - 'principles' - 'identityDescription' - 'agentName'
      WHERE jsonb_exists(config::jsonb, 'principles')
         OR jsonb_exists(config::jsonb, 'identityDescription')
         OR jsonb_exists(config::jsonb, 'agentName')
    `);
  } else {
    // SQLite: Use json_extract / json_set / json_remove
    // Step 1: Copy principles → soulmd where soulmd is missing
    await knex.raw(`
      UPDATE instances
      SET config = json_set(config, '$.soulmd', json_extract(config, '$.principles'))
      WHERE json_extract(config, '$.principles') IS NOT NULL
        AND json_extract(config, '$.soulmd') IS NULL
    `);

    // Step 2: Copy identityDescription → identitymd where identitymd is missing
    await knex.raw(`
      UPDATE instances
      SET config = json_set(config, '$.identitymd', json_extract(config, '$.identityDescription'))
      WHERE json_extract(config, '$.identityDescription') IS NOT NULL
        AND json_extract(config, '$.identitymd') IS NULL
    `);

    // Step 3: Sync config.agentName → instances.name where they differ
    await knex.raw(`
      UPDATE instances
      SET name = json_extract(config, '$.agentName')
      WHERE json_extract(config, '$.agentName') IS NOT NULL
        AND json_extract(config, '$.agentName') != ''
        AND name != json_extract(config, '$.agentName')
    `);

    // Step 4: Remove orphan keys from config
    await knex.raw(`
      UPDATE instances
      SET config = json_remove(config, '$.principles', '$.identityDescription', '$.agentName')
      WHERE json_extract(config, '$.principles') IS NOT NULL
         OR json_extract(config, '$.identityDescription') IS NOT NULL
         OR json_extract(config, '$.agentName') IS NOT NULL
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // No-op: we cannot reconstruct the original orphan state,
  // and the orphan keys were non-functional anyway
}
