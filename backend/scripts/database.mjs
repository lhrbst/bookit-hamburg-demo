import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import 'dotenv/config';

const root = new URL('../', import.meta.url);
const command = process.argv[2];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function databaseUrl(name) {
  const url = new URL(required(name));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`Invalid ${name}`);
  return url;
}

async function connected(url, action) {
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}

async function provision() {
  const admin = databaseUrl('DATABASE_ADMIN_URL');
  const migration = databaseUrl('MIGRATION_DATABASE_URL');
  const runtime = databaseUrl('RUNTIME_DATABASE_URL');
  for (const [url, role] of [[migration, 'bookit_migrator'], [runtime, 'bookit_runtime']]) {
    if (decodeURIComponent(url.username) !== role || !url.password ||
        url.host !== admin.host || url.pathname !== admin.pathname) {
      throw new Error('Role URLs must use the expected role and the same database/server as the admin');
    }
  }
  await connected(admin, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('bookit-role-provision'))");
      for (const url of [migration, runtime]) {
        const role = decodeURIComponent(url.username);
        const found = await client.query(
          'SELECT rolsuper, rolreplication, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1', [role],
        );
        if (found.rows.some((row) => row.rolsuper || row.rolreplication || row.rolbypassrls || row.rolcreatedb || row.rolcreaterole)) {
          throw new Error('Refusing to reuse a privileged application database role');
        }
        if (!found.rowCount) await client.query(`CREATE ROLE ${role} NOLOGIN`);
        const statement = await client.query(
          "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
          [role, decodeURIComponent(url.password)],
        );
        await client.query(statement.rows[0].sql);
      }
      const current = await client.query('SELECT current_user AS name, current_database() AS database');
      const grant = await client.query(
        "SELECT format('GRANT bookit_migrator TO %I', $1::text) AS sql",
        [current.rows[0].name],
      );
      await client.query(grant.rows[0].sql);
      const revoke = await client.query(
        "SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', $1::text) AS sql",
        [current.rows[0].database],
      );
      await client.query(revoke.rows[0].sql);
      const connect = await client.query(
        "SELECT format('GRANT CONNECT ON DATABASE %I TO bookit_migrator, bookit_runtime', $1::text) AS sql",
        [current.rows[0].database],
      );
      await client.query(connect.rows[0].sql);
      await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await client.query('GRANT USAGE, CREATE ON SCHEMA public TO bookit_migrator');
      await client.query('GRANT USAGE ON SCHEMA public TO bookit_runtime');
      await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  console.log('Database roles provisioned; runtime has no schema administration privileges');
}

async function migrate() {
  const url = databaseUrl('MIGRATION_DATABASE_URL');
  await connected(url, async (client) => {
    const result = await client.query(`SELECT to_regclass('public.pgmigrations') AS ledger,
      to_regclass('public.booking') AS booking`);
    if (result.rows[0].booking && !result.rows[0].ledger) {
      throw new Error('Existing untracked schema: migration refused. Follow migrations/README.md baseline review.');
    }
  });
  await runner({
    databaseUrl: url.toString(),
    dir: fileURLToPath(new URL('migrations/', root)),
    ignorePattern: '.*\\.(?!sql$).*',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    singleTransaction: true,
    checkOrder: true,
    log: () => {},
  });
  await connected(url, async (client) => {
    await client.query('GRANT SELECT ON resource, person TO bookit_runtime');
    await client.query('GRANT SELECT, INSERT, DELETE ON booking TO bookit_runtime');
  });
  console.log('Pending migrations applied and runtime grants verified');
}

async function seed(test) {
  await connected(databaseUrl('MIGRATION_DATABASE_URL'), async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('bookit-seed'))");
      await client.query(await readFile(new URL('seeds/dev.sql', root), 'utf8'));
      if (test) {
        if (process.env.ALLOW_TEST_SEED !== 'true') throw new Error('Test fixtures require ALLOW_TEST_SEED=true on a disposable database');
        await client.query(await readFile(new URL('seeds/test.sql', root), 'utf8'));
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  console.log(test ? 'Disposable test fixtures initialized' : 'Demo resources and people initialized; bookings unchanged');
}

try {
  if (command === 'provision') await provision();
  else if (command === 'migrate') await migrate();
  else if (command === 'seed:dev') await seed(false);
  else if (command === 'seed:test') await seed(true);
  else if (command === 'release') {
    await migrate();
    await seed(false);
  } else throw new Error('Expected provision, migrate, seed:dev, seed:test or release');
} catch (error) {
  // Database statements can contain credentials. Never serialize driver errors or SQL.
  const message = error instanceof Error && !('code' in error) ? error.message : 'Database operation failed';
  console.error(message, error && typeof error === 'object' && 'code' in error
    ? `(SQLSTATE ${error.code}, routine ${error.routine ?? 'unknown'})` : '');
  process.exitCode = 1;
}
