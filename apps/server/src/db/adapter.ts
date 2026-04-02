import type { Knex } from 'knex';
import { config } from '../config.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { PostgresAdapter } from './postgres-adapter.js';

export interface DbAdapter {
  /** Generate a UUID for INSERT (app-level, not DB-level) */
  generateId(): string;

  /** Wrap a JS value for storage in a JSON column. Postgres uses jsonb natively; SQLite stores as TEXT. */
  jsonValue(val: unknown): string;

  /** Parse a JSON column value from a DB row. Postgres returns objects; SQLite returns strings that need parsing. */
  parseJson<T>(val: unknown): T;

  /** Get the column builder method name for UUID columns in migrations. Postgres: .uuid(), SQLite: .string(36) */
  uuidColumnType(): 'uuid' | 'string';

  /** Get the Knex raw expression for a UUID column default. Postgres: gen_random_uuid(), SQLite: no default (app generates). Returns null if no DB-level default. */
  uuidDefault(knex: Knex): Knex.Raw | null;

  /** Build a Knex raw expression for "N units ago" interval. Postgres: now() - interval 'N days', SQLite: datetime('now', '-N days') */
  intervalAgo(knex: Knex, amount: number, unit: 'days' | 'hours' | 'minutes'): Knex.Raw;

  /** Build a Knex raw for extracting a JSON field as text. Postgres: metadata->>'key', SQLite: json_extract(col, '$.key') */
  jsonExtract(knex: Knex, column: string, key: string): Knex.Raw;

  /** The dialect name for conditionals in service code */
  readonly dialect: 'pg' | 'sqlite';
}

let _adapter: DbAdapter | undefined;

export function getAdapter(): DbAdapter {
  if (_adapter) return _adapter;
  _adapter = config.isCE ? new SqliteAdapter() : new PostgresAdapter();
  return _adapter;
}
