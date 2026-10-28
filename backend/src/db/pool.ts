import { Pool } from 'pg';
import { config } from '../config';

/**
 * Shared PostgreSQL connection pool.
 *
 * - Use `pool.query` for single statements.
 * - For a transaction, check out a single client with `pool.connect()` and
 *   `release()` it in a `finally` block. Never run a transaction through
 *   `pool.query`, since its statements are not guaranteed to land on the
 *   same underlying client.
 * - An unhandled `'error'` event on the pool (e.g. an idle client dropped by
 *   the server) crashes the process, so it must always be listened for.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle PostgreSQL client', err);
});
