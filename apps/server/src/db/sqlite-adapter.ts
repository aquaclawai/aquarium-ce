import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { DbAdapter } from './adapter.js';

export class SqliteAdapter implements DbAdapter {
  readonly dialect = 'sqlite' as const;

  generateId(): string {
    return randomUUID();
  }

  jsonValue(val: unknown): string {
    return JSON.stringify(val);
  }

  parseJson<T>(val: unknown): T {
    if (typeof val === 'string') {
      return JSON.parse(val) as T;
    }
    return val as T;
  }

  uuidColumnType(): 'uuid' | 'string' {
    return 'string';
  }

  uuidDefault(_knex: Knex): Knex.Raw | null {
    return null;
  }

  intervalAgo(knex: Knex, amount: number, unit: 'days' | 'hours' | 'minutes'): Knex.Raw {
    return knex.raw("datetime('now', ?)", [`-${amount} ${unit}`]);
  }

  jsonExtract(knex: Knex, column: string, key: string): Knex.Raw {
    return knex.raw('json_extract(??, ?)', [column, `$.${key}`]);
  }
}
