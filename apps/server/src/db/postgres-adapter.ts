import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { DbAdapter } from './adapter.js';

export class PostgresAdapter implements DbAdapter {
  readonly dialect = 'pg' as const;

  generateId(): string {
    return randomUUID();
  }

  jsonValue(val: unknown): string {
    return JSON.stringify(val);
  }

  parseJson<T>(val: unknown): T {
    // Postgres driver returns parsed objects from jsonb columns
    return val as T;
  }

  uuidColumnType(): 'uuid' | 'string' {
    return 'uuid';
  }

  uuidDefault(knex: Knex): Knex.Raw | null {
    return knex.raw('gen_random_uuid()');
  }

  intervalAgo(knex: Knex, amount: number, unit: 'days' | 'hours' | 'minutes'): Knex.Raw {
    return knex.raw(`now() - interval '${amount} ${unit}'`);
  }

  jsonExtract(knex: Knex, column: string, key: string): Knex.Raw {
    return knex.raw('??->>?', [column, key]);
  }
}
