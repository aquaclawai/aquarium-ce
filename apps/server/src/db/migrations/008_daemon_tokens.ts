import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 008 — Daemon tokens.
 *
 * Stores the SHA-256 hash of plaintext `adt_<32nanoid>` tokens. Plaintext is
 * shown exactly once on creation (Phase 19 service code) and never persisted.
 * Phase 19 `requireDaemonAuth` middleware verifies incoming Bearer tokens via
 * `crypto.createHash('sha256').update(token).digest('hex')` → lookup by
 * `token_hash` UNIQUE + `crypto.timingSafeEqual`.
 *
 * SCH-08. Pitfalls AUTH3 (DB-backed → revocation effective on next request),
 * AUTH4 (per-token rate limiting uses `id`), AUTH5 (audit trail via
 * created_by_user_id + last_used_at).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('daemon_tokens', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('workspace_id', 36).notNullable()
      .references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique(); // sha256 hex
    t.string('name', 100).notNullable();                // user-friendly label shown in UI
    t.string('daemon_id', 36).nullable();               // populated after first register
    addUuidColumn(t, 'created_by_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('expires_at', { useTz: true }).nullable();   // NULL = no expiry
    t.timestamp('last_used_at', { useTz: true }).nullable(); // updated by daemon-auth middleware
    t.timestamp('revoked_at', { useTz: true }).nullable();   // soft revocation; middleware rejects if set
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['workspace_id'], 'idx_daemon_tokens_workspace');
    t.index(['revoked_at'], 'idx_daemon_tokens_revoked');
    // Composite index for the hot-path auth query:
    // SELECT * FROM daemon_tokens WHERE token_hash = ? AND revoked_at IS NULL
    // UNIQUE(token_hash) already provides O(log n) lookup; revoked_at filter is a scan reducer.
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('daemon_tokens');
}
