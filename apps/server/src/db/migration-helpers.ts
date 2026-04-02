import type { Knex } from 'knex';
import { getAdapter } from './adapter.js';

/**
 * Add a UUID primary key column with auto-generation.
 * - Postgres: uuid type with gen_random_uuid() default
 * - SQLite: string(36) with no default (app generates IDs via crypto.randomUUID())
 */
export function addUuidPrimary(table: Knex.CreateTableBuilder, knex: Knex, columnName = 'id'): Knex.ColumnBuilder {
  const adapter = getAdapter();
  const col = adapter.uuidColumnType() === 'uuid'
    ? table.uuid(columnName)
    : table.string(columnName, 36);

  const defaultVal = adapter.uuidDefault(knex);
  if (defaultVal) {
    col.defaultTo(defaultVal);
  }
  return col.primary();
}

/**
 * Add a UUID column (non-primary, for foreign keys etc).
 * - Postgres: uuid type
 * - SQLite: string(36)
 */
export function addUuidColumn(table: Knex.CreateTableBuilder, columnName: string): Knex.ColumnBuilder {
  const adapter = getAdapter();
  return adapter.uuidColumnType() === 'uuid'
    ? table.uuid(columnName)
    : table.string(columnName, 36);
}

/**
 * Add a JSONB/JSON column.
 * - Postgres: jsonb type
 * - SQLite: text type (JSON stored as string)
 */
export function addJsonColumn(table: Knex.CreateTableBuilder, columnName: string): Knex.ColumnBuilder {
  const adapter = getAdapter();
  return adapter.dialect === 'pg'
    ? table.jsonb(columnName)
    : table.text(columnName);
}

/**
 * Add a UUID array column.
 * - Postgres: UUID[] via specificType
 * - SQLite: text (JSON array stored as string)
 */
export function addUuidArrayColumn(table: Knex.CreateTableBuilder, columnName: string): Knex.ColumnBuilder {
  const adapter = getAdapter();
  return adapter.dialect === 'pg'
    ? table.specificType(columnName, 'UUID[]')
    : table.text(columnName);
}

/**
 * Add a CHECK constraint via raw SQL.
 * - Postgres: ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)
 * - SQLite: no-op (CHECK constraints enforced at app level; SQLite ADD CONSTRAINT is not supported)
 */
export async function addCheckConstraint(knex: Knex, table: string, name: string, expression: string): Promise<void> {
  const adapter = getAdapter();
  if (adapter.dialect === 'pg') {
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (${expression})`, [table, name]);
  }
  // SQLite: no-op — CHECK constraints not supported via ALTER TABLE, enforced at app level
}

/**
 * Drop a constraint by name.
 * - Postgres: ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...
 * - SQLite: no-op (constraints don't exist on SQLite in this system)
 */
export async function dropConstraint(knex: Knex, table: string, name: string): Promise<void> {
  const adapter = getAdapter();
  if (adapter.dialect === 'pg') {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [table, name]);
  }
  // SQLite: no-op
}

/**
 * Alter a column's nullability.
 * - Postgres: ALTER TABLE ... ALTER COLUMN ... DROP/SET NOT NULL
 * - SQLite: no-op (SQLite does not support ALTER COLUMN; column was created with correct nullability
 *   or the difference is acceptable at CE scale)
 */
export async function alterColumnNullable(knex: Knex, table: string, column: string, nullable: boolean): Promise<void> {
  const adapter = getAdapter();
  if (adapter.dialect === 'pg') {
    const action = nullable ? 'DROP NOT NULL' : 'SET NOT NULL';
    await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? ${action}`, [table, column]);
  }
  // SQLite: no-op — column nullability changes not supported via ALTER TABLE.
  // For CE, the column starts nullable (SQLite doesn't enforce NOT NULL strictly for existing columns).
}
