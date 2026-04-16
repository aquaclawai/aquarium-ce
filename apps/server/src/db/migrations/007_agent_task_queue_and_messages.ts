import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 007 — Agent task queue + task messages.
 *
 * Task queue: 6-state machine (queued/dispatched/running/completed/failed/
 * cancelled). Partial unique index (SCH-05 + pitfall SQ3) rejects a second
 * pending task for the same (issue_id, agent_id) at the SQLite layer. This
 * complements the Phase-18 BEGIN IMMEDIATE claim transaction: even if two
 * concurrent request paths try to enqueue, the DB itself rejects the
 * duplicate.
 *
 * Task messages: streamed agent execution events indexed by (task_id, seq)
 * for replay-on-reconnect (pitfall ST2).
 *
 * SCH-05 + SCH-06. ROADMAP owned pitfall ST4: ON DELETE CASCADE for runtime
 * -> task (authoritative over PITFALLS.md prose).
 *
 * SQLite note: follows the trigger pattern from migrations 004-006. SQLite
 * does not support ALTER TABLE ADD CONSTRAINT CHECK, so enum enforcement is
 * handled by BEFORE INSERT / BEFORE UPDATE OF <col> triggers. The partial
 * unique index uses raw SQL because Knex's .unique() builder does not emit
 * WHERE clauses (SQLite 3.8+ and Postgres both support partial indexes).
 */
export async function up(knex: Knex): Promise<void> {
  // ── agent_task_queue ────────────────────────────────────────────────────────
  await knex.schema.createTable('agent_task_queue', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('workspace_id', 36).notNullable()
      .references('id').inTable('workspaces').onDelete('CASCADE');
    addUuidColumn(t, 'issue_id').notNullable()
      .references('id').inTable('issues').onDelete('CASCADE');
    addUuidColumn(t, 'agent_id').notNullable()
      .references('id').inTable('agents').onDelete('CASCADE');
    addUuidColumn(t, 'runtime_id').notNullable()
      .references('id').inTable('runtimes').onDelete('CASCADE'); // ROADMAP ST4: CASCADE
    addUuidColumn(t, 'trigger_comment_id').nullable()
      .references('id').inTable('comments').onDelete('SET NULL');
    t.string('status', 16).notNullable().defaultTo('queued'); // 6-state via trigger
    t.integer('priority').notNullable().defaultTo(0);          // higher = more urgent
    t.string('session_id', 128).nullable();                    // Phase 21 writes; v1.5 reads
    t.text('work_dir').nullable();                             // Phase 21 writes; v1.5 reads
    t.text('error').nullable();
    addJsonColumn(t, 'result').nullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('dispatched_at', { useTz: true }).nullable();
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('cancelled_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Claim query hot path
    t.index(['runtime_id', 'status', 'priority', 'created_at'], 'idx_atq_claim');
    // Reaper / listing by issue
    t.index(['issue_id', 'status'], 'idx_atq_issue_status');
    // Agent concurrency enforcement
    t.index(['agent_id', 'status'], 'idx_atq_agent_status');
  });

  // ── task_messages ───────────────────────────────────────────────────────────
  await knex.schema.createTable('task_messages', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'task_id').notNullable()
      .references('id').inTable('agent_task_queue').onDelete('CASCADE');
    t.integer('seq').notNullable();                // monotonic per task
    t.string('type', 16).notNullable();            // text|thinking|tool_use|tool_result|error
    t.string('tool', 128).nullable();              // tool name when type IN ('tool_use','tool_result')
    t.text('content').nullable();                  // text/thinking body
    addJsonColumn(t, 'input').nullable();          // tool_use arguments (JSON)
    addJsonColumn(t, 'output').nullable();         // tool_result payload (JSON)
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Replay-on-reconnect unique index (ST2 pitfall): fetches messages > lastSeq for a task
    t.unique(['task_id', 'seq'], { indexName: 'uq_task_messages_task_seq' });
    t.index(['task_id', 'created_at'], 'idx_task_messages_task_created');
  });

  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();

  if (adapter.dialect === 'sqlite') {
    // Partial unique index — SCH-05 + pitfall SQ3. Schema-level coalescing
    // guarantee for the (issue_id, agent_id) pair while the task is still
    // pending (queued|dispatched). Knex's .unique() does not emit WHERE, so
    // raw SQL is required. Runs at migration time, outside any claim txn.
    await knex.raw(`
      CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent
        ON agent_task_queue (issue_id, agent_id)
        WHERE status IN ('queued','dispatched')
    `);

    // agent_task_queue.status 6-state enum
    await knex.raw(`
      CREATE TRIGGER trg_atq_status_check
      BEFORE INSERT ON agent_task_queue
      FOR EACH ROW
      WHEN NEW.status NOT IN ('queued','dispatched','running','completed','failed','cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'agent_task_queue.status must be queued, dispatched, running, completed, failed, or cancelled');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_atq_status_check_upd
      BEFORE UPDATE OF status ON agent_task_queue
      FOR EACH ROW
      WHEN NEW.status NOT IN ('queued','dispatched','running','completed','failed','cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'agent_task_queue.status must be queued, dispatched, running, completed, failed, or cancelled');
      END;
    `);

    // task_messages.type 5-state enum
    await knex.raw(`
      CREATE TRIGGER trg_task_messages_type_check
      BEFORE INSERT ON task_messages
      FOR EACH ROW
      WHEN NEW.type NOT IN ('text','thinking','tool_use','tool_result','error')
      BEGIN
        SELECT RAISE(ABORT, 'task_messages.type must be text, thinking, tool_use, tool_result, or error');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_task_messages_type_check_upd
      BEFORE UPDATE OF type ON task_messages
      FOR EACH ROW
      WHEN NEW.type NOT IN ('text','thinking','tool_use','tool_result','error')
      BEGIN
        SELECT RAISE(ABORT, 'task_messages.type must be text, thinking, tool_use, tool_result, or error');
      END;
    `);
  } else {
    // Postgres (EE) native CHECK constraints + partial unique index
    await knex.raw(
      `ALTER TABLE agent_task_queue ADD CONSTRAINT ck_atq_status CHECK (status IN ('queued','dispatched','running','completed','failed','cancelled'))`
    );
    await knex.raw(
      `ALTER TABLE task_messages ADD CONSTRAINT ck_task_messages_type CHECK (type IN ('text','thinking','tool_use','tool_result','error'))`
    );
    await knex.raw(
      `CREATE UNIQUE INDEX idx_one_pending_task_per_issue_agent ON agent_task_queue (issue_id, agent_id) WHERE status IN ('queued','dispatched')`
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();
  if (adapter.dialect === 'sqlite') {
    for (const trg of [
      'trg_atq_status_check', 'trg_atq_status_check_upd',
      'trg_task_messages_type_check', 'trg_task_messages_type_check_upd',
    ]) {
      await knex.raw(`DROP TRIGGER IF EXISTS ${trg}`);
    }
  }
  await knex.raw('DROP INDEX IF EXISTS idx_one_pending_task_per_issue_agent');
  await knex.schema.dropTableIfExists('task_messages');
  await knex.schema.dropTableIfExists('agent_task_queue');
}
