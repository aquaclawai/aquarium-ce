import type { Knex } from 'knex';

/**
 * v1.4 migration 009 — Promote the partial `idx_runtimes_instance` index
 * to a partial UNIQUE index `uq_runtimes_instance`.
 *
 * Phase 16 invariant: "at most one hosted_instance mirror runtime per instance".
 * Enforcing at the schema level (partial UNIQUE) rather than the application
 * level (check-then-insert) lets the runtime-bridge's UPSERT rely on ON CONFLICT
 * (instance_id) semantics and naturally serialises the boot-reconcile race
 * against the create-hook race that 16-RESEARCH flagged (§Known Pitfalls →
 * RT-bridge double-register hazard).
 *
 * The partial predicate `WHERE instance_id IS NOT NULL` is mandatory:
 * daemon rows (kind IN ('local_daemon','external_cloud_daemon')) carry
 * instance_id = NULL and must remain able to multi-register per workspace.
 *
 * SQLite and Postgres 12+ both support partial UNIQUE indexes with
 * identical syntax, so no dialect branching is required for the index
 * itself — but the DROP+CREATE pair is split so rollback is clean.
 *
 * Pitfalls addressed:
 *   - RT-bridge double-register (Phase 16-RESEARCH.md §Known Pitfalls)
 *   - SCH1 — sequential numbering (previous: 008_daemon_tokens)
 */
export async function up(knex: Knex): Promise<void> {
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();

  // Drop the non-unique index first so we can reuse the (instance_id) column
  // predicate. SQLite 3.35+ and Postgres both accept IF EXISTS.
  await knex.raw('DROP INDEX IF EXISTS idx_runtimes_instance');

  // Partial UNIQUE index identical on SQLite 3.38+ and Postgres 12+.
  if (adapter.dialect === 'sqlite') {
    await knex.raw(`
      CREATE UNIQUE INDEX uq_runtimes_instance
      ON runtimes(instance_id)
      WHERE instance_id IS NOT NULL
    `);
  } else {
    await knex.raw(`
      CREATE UNIQUE INDEX uq_runtimes_instance
      ON runtimes(instance_id)
      WHERE instance_id IS NOT NULL
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS uq_runtimes_instance');

  // Restore the original non-unique partial index from migration 004
  // so `down()` leaves the schema identical to pre-009 state.
  await knex.raw(`
    CREATE INDEX idx_runtimes_instance
    ON runtimes(instance_id)
    WHERE instance_id IS NOT NULL
  `);
}
