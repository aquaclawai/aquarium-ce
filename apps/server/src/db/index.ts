import knex from 'knex';
import type { Knex } from 'knex';
import knexConfig from './knexfile.js';

/**
 * Active knex instance. In production this is a single `knex(knexConfig)` —
 * in unit tests, `__setDbForTests__` swaps it for a throwaway SQLite fixture
 * so services that import the `db` singleton directly (e.g. runtime-registry,
 * instance-manager) can be exercised against an isolated test DB without a
 * rewrite to pass `dbOverride` through every signature.
 *
 * The exported `db` is a Proxy over this reference: every `db('table')` call,
 * `db.fn.now()`, `db.raw(...)`, `db.transaction(...)`, `db.migrate.latest()`,
 * and every other knex API goes through the proxy's `apply` / `get` traps.
 */
let activeKx: Knex = knex(knexConfig);

const handler: ProxyHandler<Knex> = {
  // Calling the knex fn itself: db('table') → activeKx('table')
  apply(_target, _thisArg, args: unknown[]) {
    return (activeKx as unknown as (...a: unknown[]) => unknown)(...args);
  },
  // Property access: db.fn, db.raw, db.transaction, db.schema, etc.
  get(_target, prop, _receiver) {
    return Reflect.get(activeKx as unknown as object, prop, activeKx);
  },
  has(_target, prop) {
    return prop in (activeKx as unknown as object);
  },
  getPrototypeOf(_target) {
    return Reflect.getPrototypeOf(activeKx as unknown as object);
  },
};

export const db: Knex = new Proxy(activeKx, handler);
export default db;

/** Test hook — swap the active knex instance (unit tests). */
export function __setDbForTests__(kx: Knex): void {
  activeKx = kx;
}

/** Test hook — restore the production knex singleton. */
export function __resetDbForTests__(): void {
  activeKx = knex(knexConfig);
}
