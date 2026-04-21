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

  /**
   * applyBootPragmas — apply and assert v1.4 boot-time SQLite concurrency PRAGMAs.
   *
   * Settings:
   *   - journal_mode = WAL         (single-writer/multi-reader concurrency; pitfall SQ1)
   *   - synchronous   = NORMAL     (safe with WAL, better throughput)
   *   - busy_timeout  = 5000       (5s wait before SQLITE_BUSY; pitfall SQ5)
   *   - foreign_keys  = ON         (required for CASCADE / SET NULL semantics; SCH/ST cascade rules)
   *
   * Every PRAGMA is read back and checked; if any value did not stick, this
   * method throws so boot fails fast (preferred over silent concurrency bugs).
   *
   * Called from server-core.ts immediately after `db.migrate.latest()` and
   * before any downstream state reconciliation. Must NOT live inside a
   * migration file because PRAGMAs apply per-connection, whereas migrations
   * run once.
   */
  async applyBootPragmas(knex: Knex): Promise<void> {
    await knex.raw('PRAGMA journal_mode = WAL');
    await knex.raw('PRAGMA synchronous = NORMAL');
    await knex.raw('PRAGMA busy_timeout = 5000');
    await knex.raw('PRAGMA foreign_keys = ON');

    // Read-back helper. better-sqlite3 via Knex returns a bare array of row
    // objects; pg would return `{ rows: [...] }`. Normalize both shapes.
    const readPragma = async (name: string): Promise<string | number> => {
      const res: unknown = await knex.raw(`PRAGMA ${name}`);
      const rows = Array.isArray(res)
        ? (res as unknown[])
        : ((res as { rows?: unknown[] }).rows ?? []);
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`PRAGMA ${name} returned no rows`);
      }
      const value = Object.values(row)[0];
      return value as string | number;
    };

    const journal = String(await readPragma('journal_mode')).toLowerCase();
    if (journal !== 'wal') {
      throw new Error(`boot PRAGMA assertion failed: journal_mode='${journal}' (expected 'wal')`);
    }
    const busy = Number(await readPragma('busy_timeout'));
    if (busy !== 5000) {
      throw new Error(`boot PRAGMA assertion failed: busy_timeout=${busy} (expected 5000)`);
    }
    const sync = Number(await readPragma('synchronous'));
    if (sync !== 1) {
      // 1 == NORMAL per SQLite docs
      throw new Error(`boot PRAGMA assertion failed: synchronous=${sync} (expected 1 NORMAL)`);
    }
    const fk = Number(await readPragma('foreign_keys'));
    if (fk !== 1) {
      throw new Error(`boot PRAGMA assertion failed: foreign_keys=${fk} (expected 1)`);
    }

    console.log(
      '[CE] SQLite boot PRAGMAs applied and verified: journal_mode=wal, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON',
    );
  }
}
