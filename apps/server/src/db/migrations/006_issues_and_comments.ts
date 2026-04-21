import type { Knex } from 'knex';
import { addUuidPrimary, addUuidColumn, addJsonColumn } from '../migration-helpers.js';

/**
 * v1.4 migration 006 — Issues + Comments.
 *
 * Issues: 6-status kanban (backlog/todo/in_progress/done/blocked/cancelled,
 * no in_review), 5 priorities, fractional REAL position, monotonic
 * issue_number per workspace (service-level atomicity via workspaces.issue_counter).
 *
 * Comments: 4 types (comment/status_change/progress_update/system), self-FK
 * parent_id for threading (SET NULL — preserve orphaned children), XOR author
 * via twin nullable FKs (author_user_id, author_agent_id) + trigger enforcing
 * the polymorphic author rule.
 *
 * SCH-04 (issues) + SCH-07 (comments). Plan 15-04.
 *
 * SQLite note: follows the trigger pattern from migrations 004/005. SQLite
 * does not support ALTER TABLE ADD CONSTRAINT CHECK, so we install
 * BEFORE INSERT / BEFORE UPDATE triggers that RAISE(ABORT, ...) on violation.
 * Postgres (EE) uses native CHECK constraints.
 */
export async function up(knex: Knex): Promise<void> {
  // ── issues ──────────────────────────────────────────────────────────────────
  await knex.schema.createTable('issues', (t) => {
    addUuidPrimary(t, knex, 'id');
    t.string('workspace_id', 36).notNullable()
      .references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('issue_number').notNullable();   // filled by service from workspaces.issue_counter (Phase 17)
    t.string('title', 500).notNullable();
    t.text('description').nullable();
    t.string('status', 16).notNullable().defaultTo('backlog');  // 6-state via trigger
    t.string('priority', 12).notNullable().defaultTo('medium'); // 5-state via trigger
    addUuidColumn(t, 'assignee_id').nullable()
      .references('id').inTable('agents').onDelete('SET NULL'); // agents outlive issues (PITFALLS §ST4)
    addUuidColumn(t, 'creator_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.float('position').nullable();             // REAL/DOUBLE — fractional kanban ordering
    t.timestamp('due_date', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('cancelled_at', { useTz: true }).nullable();
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['workspace_id', 'issue_number'], { indexName: 'uq_issues_ws_number' });
    t.index(['workspace_id', 'status'], 'idx_issues_workspace_status');
    t.index(['assignee_id'], 'idx_issues_assignee');
    t.index(['workspace_id', 'status', 'position'], 'idx_issues_kanban');
  });

  // ── comments ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('comments', (t) => {
    addUuidPrimary(t, knex, 'id');
    addUuidColumn(t, 'issue_id').notNullable()
      .references('id').inTable('issues').onDelete('CASCADE');  // deleting issue removes its comments (child-of-issue semantics)
    t.string('author_type', 16).notNullable(); // 'user' | 'agent' | 'system' — XOR trigger enforces
    addUuidColumn(t, 'author_user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    addUuidColumn(t, 'author_agent_id').nullable()
      .references('id').inTable('agents').onDelete('SET NULL');
    t.text('content').notNullable();
    t.string('type', 24).notNullable().defaultTo('comment'); // 4-state via trigger
    addUuidColumn(t, 'parent_id').nullable()
      .references('id').inTable('comments').onDelete('SET NULL'); // threading; orphans preserved per PITFALLS §ST4
    addJsonColumn(t, 'metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['issue_id', 'created_at'], 'idx_comments_issue_created');
    t.index(['parent_id'], 'idx_comments_parent');
  });

  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();

  if (adapter.dialect === 'sqlite') {
    // issues.status 6-state enum
    await knex.raw(`
      CREATE TRIGGER trg_issues_status_check
      BEFORE INSERT ON issues
      FOR EACH ROW
      WHEN NEW.status NOT IN ('backlog','todo','in_progress','done','blocked','cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'issues.status must be backlog, todo, in_progress, done, blocked, or cancelled');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_issues_status_check_upd
      BEFORE UPDATE OF status ON issues
      FOR EACH ROW
      WHEN NEW.status NOT IN ('backlog','todo','in_progress','done','blocked','cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'issues.status must be backlog, todo, in_progress, done, blocked, or cancelled');
      END;
    `);

    // issues.priority 5-state enum
    await knex.raw(`
      CREATE TRIGGER trg_issues_priority_check
      BEFORE INSERT ON issues
      FOR EACH ROW
      WHEN NEW.priority NOT IN ('urgent','high','medium','low','none')
      BEGIN
        SELECT RAISE(ABORT, 'issues.priority must be urgent, high, medium, low, or none');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_issues_priority_check_upd
      BEFORE UPDATE OF priority ON issues
      FOR EACH ROW
      WHEN NEW.priority NOT IN ('urgent','high','medium','low','none')
      BEGIN
        SELECT RAISE(ABORT, 'issues.priority must be urgent, high, medium, low, or none');
      END;
    `);

    // comments.type 4-state enum
    await knex.raw(`
      CREATE TRIGGER trg_comments_type_check
      BEFORE INSERT ON comments
      FOR EACH ROW
      WHEN NEW.type NOT IN ('comment','status_change','progress_update','system')
      BEGIN
        SELECT RAISE(ABORT, 'comments.type must be comment, status_change, progress_update, or system');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_comments_type_check_upd
      BEFORE UPDATE OF type ON comments
      FOR EACH ROW
      WHEN NEW.type NOT IN ('comment','status_change','progress_update','system')
      BEGIN
        SELECT RAISE(ABORT, 'comments.type must be comment, status_change, progress_update, or system');
      END;
    `);

    // comments.author_type enum + XOR author_user_id/author_agent_id enforcement
    await knex.raw(`
      CREATE TRIGGER trg_comments_author_check
      BEFORE INSERT ON comments
      FOR EACH ROW
      WHEN NOT (
        (NEW.author_type = 'user'  AND NEW.author_user_id IS NOT NULL AND NEW.author_agent_id IS NULL)
        OR
        (NEW.author_type = 'agent' AND NEW.author_agent_id IS NOT NULL AND NEW.author_user_id IS NULL)
        OR
        (NEW.author_type = 'system' AND NEW.author_user_id IS NULL AND NEW.author_agent_id IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'comments: author_type=user requires author_user_id; agent requires author_agent_id; system requires neither');
      END;
    `);
    await knex.raw(`
      CREATE TRIGGER trg_comments_author_check_upd
      BEFORE UPDATE ON comments
      FOR EACH ROW
      WHEN NOT (
        (NEW.author_type = 'user'  AND NEW.author_user_id IS NOT NULL AND NEW.author_agent_id IS NULL)
        OR
        (NEW.author_type = 'agent' AND NEW.author_agent_id IS NOT NULL AND NEW.author_user_id IS NULL)
        OR
        (NEW.author_type = 'system' AND NEW.author_user_id IS NULL AND NEW.author_agent_id IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'comments: author_type=user requires author_user_id; agent requires author_agent_id; system requires neither');
      END;
    `);
  } else {
    // Postgres (EE) native CHECK constraints
    await knex.raw(`ALTER TABLE issues ADD CONSTRAINT ck_issues_status CHECK (status IN ('backlog','todo','in_progress','done','blocked','cancelled'))`);
    await knex.raw(`ALTER TABLE issues ADD CONSTRAINT ck_issues_priority CHECK (priority IN ('urgent','high','medium','low','none'))`);
    await knex.raw(`ALTER TABLE comments ADD CONSTRAINT ck_comments_type CHECK (type IN ('comment','status_change','progress_update','system'))`);
    await knex.raw(`
      ALTER TABLE comments ADD CONSTRAINT ck_comments_author CHECK (
        (author_type = 'user' AND author_user_id IS NOT NULL AND author_agent_id IS NULL)
        OR (author_type = 'agent' AND author_agent_id IS NOT NULL AND author_user_id IS NULL)
        OR (author_type = 'system' AND author_user_id IS NULL AND author_agent_id IS NULL)
      )
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const { getAdapter } = await import('../adapter.js');
  const adapter = getAdapter();
  if (adapter.dialect === 'sqlite') {
    for (const trg of [
      'trg_issues_status_check', 'trg_issues_status_check_upd',
      'trg_issues_priority_check', 'trg_issues_priority_check_upd',
      'trg_comments_type_check', 'trg_comments_type_check_upd',
      'trg_comments_author_check', 'trg_comments_author_check_upd',
    ]) {
      await knex.raw(`DROP TRIGGER IF EXISTS ${trg}`);
    }
  }
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('issues');
}
