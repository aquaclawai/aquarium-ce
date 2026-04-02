import 'dotenv/config';
import { config } from '../config.js';
import type { Knex } from 'knex';

const migrationDirectories: string[] = ['./migrations'];
if (config.isEE) {
  migrationDirectories.push('./migrations/ee');
}

const knexConfig: Knex.Config = config.isCE
  ? {
      client: 'better-sqlite3',
      connection: { filename: config.sqlite.filename },
      useNullAsDefault: true,
      pool: { min: 1, max: 1, idleTimeoutMillis: 30000 },
      migrations: {
        directory: migrationDirectories,
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
    }
  : {
      client: 'pg',
      connection: {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
      },
      migrations: {
        directory: migrationDirectories,
        extension: 'ts',
      },
    };

export default knexConfig;
