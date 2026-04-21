import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 004 — Runtimes.
 *
 * Single table unifying hosted Aquarium instances with external daemon-reported
 * runtimes. `kind` discriminator + CHECK constraint enforces that each row is
 * either daemon-backed (kind IN ('local_daemon','external_cloud_daemon')) with
 * `daemon_id IS NOT NULL` AND `instance_id IS NULL`, OR instance-backed
 * (kind='hosted_instance') with `instance_id IS NOT NULL` AND `daemon_id IS NULL`.
 *
 * SCH-02 requirement. Owned pitfalls: SCH2 (CASCADE from instances to hosted
 * runtime mirror row), SCH3 (no circular FK — runtimes does not reference
 * agents), ST4 (workspace_id CASCADE, instance_id CASCADE).
 *
 * SQLite note: the schema builder does not expose a table-level CHECK via
 * ALTER TABLE (the helper for this is a no-op on SQLite). To get a schema-level
 * guarantee we install BEFORE INSERT/UPDATE triggers that RAISE(ABORT, ...) on
 * violation. Postgres uses native CHECK constraints.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('runtimes', (t) => {
    // Column definitions
    addUuidPrimary(t, knex, 'id');
    t.string('workspace_id', 36).notNullable()
      .references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('kind', 24).notNullable();       // CHECK added below via triggers/raw
    t.string('provider', 32).notNullable();   // 'claude' | 'codex' | 'openclaw' | 'opencode' | 'hermes' | 'hosted'
    t.string('status', 16).notNullable().defaultTo('offline'); // 'online'|'offline'|'error'
    t.string('daemon_id', 36).nullable();     // nanoid-produced daemon identifier
    addJsonColumn(t, 'device_info').nullable(); // nullable JSON: { os, hostname, arch, version }
    t.timestamp('last_heartbeat_at', { useTz: true }).nullable();
    addUuidColumn(t, 'instance_id').nullable()
      .references('id').inTable('instances').onDelete('CASCADE');
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    addUuidColumn(t, 'owner_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Constraints + indexes
    t.unique(['workspace_id', 'daemon_id', 'provider'], { indexName: 'uq_runtimes_ws_daemon_provider' });
    t.index(['workspace_id', 'status'], 'idx_runtimes_workspace_status');
  });

  // CHECK constraints — SQLite requires them inline in CREATE TABLE OR via triggers.
  // Knex's schema builder does NOT expose a table-level CHECK on SQLite via ALTER,
  // and the ALTER-level helper is a no-op on SQLite by design. For SCH-02 we MUST
  // have a schema-level guarantee, so we create triggers that RAISE(ABORT) on violation.
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();

  if (adapter.dialect === 'sqlite') {
    // Trigger-based kind enum enforcement
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_kind_check
      BEFORE INSERT ON runtimes
      FOR EACH ROW
      WHEN NEW.kind NOT IN ('local_daemon','external_cloud_daemon','hosted_instance')
      BEGIN
        SELECT RAISE(ABORT, 'runtimes.kind must be local_daemon, external_cloud_daemon, or hosted_instance');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_kind_check_upd
      BEFORE UPDATE OF kind ON runtimes
      FOR EACH ROW
      WHEN NEW.kind NOT IN ('local_daemon','external_cloud_daemon','hosted_instance')
      BEGIN
        SELECT RAISE(ABORT, 'runtimes.kind must be local_daemon, external_cloud_daemon, or hosted_instance');
      END;
    `);

    // Trigger-based daemon_id XOR instance_id enforcement
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_discriminator
      BEFORE INSERT ON runtimes
      FOR EACH ROW
      WHEN NOT (
        (NEW.kind IN ('local_daemon','external_cloud_daemon') AND NEW.daemon_id IS NOT NULL AND NEW.instance_id IS NULL)
        OR
        (NEW.kind = 'hosted_instance' AND NEW.instance_id IS NOT NULL AND NEW.daemon_id IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'runtimes: daemon kinds require daemon_id and no instance_id; hosted_instance requires instance_id and no daemon_id');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_discriminator_upd
      BEFORE UPDATE ON runtimes
      FOR EACH ROW
      WHEN NOT (
        (NEW.kind IN ('local_daemon','external_cloud_daemon') AND NEW.daemon_id IS NOT NULL AND NEW.instance_id IS NULL)
        OR
        (NEW.kind = 'hosted_instance' AND NEW.instance_id IS NOT NULL AND NEW.daemon_id IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'runtimes: daemon kinds require daemon_id and no instance_id; hosted_instance requires instance_id and no daemon_id');
      END;
    `);

    // Trigger-based status enum enforcement
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_status_check
      BEFORE INSERT ON runtimes
      FOR EACH ROW
      WHEN NEW.status NOT IN ('online','offline','error')
      BEGIN
        SELECT RAISE(ABORT, 'runtimes.status must be online, offline, or error');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_runtimes_status_check_upd
      BEFORE UPDATE OF status ON runtimes
      FOR EACH ROW
      WHEN NEW.status NOT IN ('online','offline','error')
      BEGIN
        SELECT RAISE(ABORT, 'runtimes.status must be online, offline, or error');
      END;
    `);

    // Partial index: only hosted_instance rows need fast lookup by instance_id
    await knex.raw(`
      CREATE INDEX idx_runtimes_instance
      ON runtimes(instance_id)
      WHERE instance_id IS NOT NULL
    `);
  } else {
    // Postgres: native CHECK constraints + unconditional index
    await knex.raw(`ALTER TABLE runtimes ADD CONSTRAINT ck_runtimes_kind CHECK (kind IN ('local_daemon','external_cloud_daemon','hosted_instance'))`);
    await knex.raw(`ALTER TABLE runtimes ADD CONSTRAINT ck_runtimes_status CHECK (status IN ('online','offline','error'))`);
    await knex.raw(`
      ALTER TABLE runtimes ADD CONSTRAINT ck_runtimes_discriminator CHECK (
        (kind IN ('local_daemon','external_cloud_daemon') AND daemon_id IS NOT NULL AND instance_id IS NULL)
        OR
        (kind = 'hosted_instance' AND instance_id IS NOT NULL AND daemon_id IS NULL)
      )
    `);
    await knex.raw(`CREATE INDEX idx_runtimes_instance ON runtimes(instance_id) WHERE instance_id IS NOT NULL`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();
  if (adapter.dialect === 'sqlite') {
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_kind_check');
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_kind_check_upd');
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_discriminator');
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_discriminator_upd');
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_status_check');
    await knex.raw('DROP TRIGGER IF EXISTS trg_runtimes_status_check_upd');
  }
  await knex.raw('DROP INDEX IF EXISTS idx_runtimes_instance');
  await knex.schema.dropTableIfExists('runtimes');
}
