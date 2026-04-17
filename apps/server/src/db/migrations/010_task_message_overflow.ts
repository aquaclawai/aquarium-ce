import type { Knex } from 'knex';

/**
 * v1.4 migration 010 — Phase 24-00 UX6 truncation overflow storage.
 *
 * Preserves the full, uncapped original payload for any task_message row
 * whose serialized content / input / output exceeded the 16 KB limit
 * enforced at INSERT time by `truncateForStorage` (see
 * apps/server/src/services/task-message-store.ts).
 *
 * The truncated row lands in `task_messages` so WS wire size and initial
 * render cost stay bounded; the uncapped original lands here so the
 * "Show full" affordance in the UI can hit
 * GET /api/tasks/:id/messages/:seq/full and pull it back.
 *
 * Invariants:
 *   • Primary key (task_id, seq) mirrors the UNIQUE index on task_messages
 *     (migration 007). No row exists here unless a matching row exists in
 *     task_messages.
 *   • ON DELETE CASCADE from agent_task_queue so cancelled / deleted tasks
 *     don't leave orphaned overflow blobs.
 *   • `content` / `input_json` / `output` are independently truncated at
 *     the INSERT path — the overflow blob is ONLY populated for fields
 *     that actually exceeded the limit. Fields stored verbatim in
 *     task_messages have NULL columns here.
 *
 * Pitfalls addressed:
 *   - UX6 (truncation + XSS): overflow mitigates data loss without
 *     enlarging the wire-size bound on WS broadcasts.
 *   - SCH1 (sequential numbering): previous migration is 009.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_message_overflow', (t) => {
    t.string('task_id', 36).notNullable();
    t.integer('seq').notNullable();
    t.text('content').nullable();        // full original text content (text / thinking kinds)
    t.text('input_json').nullable();     // full original serialized JSON (tool_use kind)
    t.text('output').nullable();         // full original output (tool_result kind)
    t.integer('original_bytes').notNullable();
    t.string('created_at').notNullable();
    t.primary(['task_id', 'seq']);
    t.foreign('task_id').references('id').inTable('agent_task_queue').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('task_message_overflow');
}
