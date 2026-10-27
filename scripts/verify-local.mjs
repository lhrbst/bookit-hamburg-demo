import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const suffix = randomBytes(5).toString('hex');
const network = `bookit-verify-${suffix}`;
const database = `${network}-db`;
const api = `${network}-api`;
const password = () => randomBytes(24).toString('hex');
const adminPassword = password();
const migrationPassword = password();
const runtimePassword = password();
const postgres = 'postgres:16-bookworm@sha256:d81f7b51697014367236d07ec58b54153fc28f828b72bf247fe5c7487520bcb0';
const env = {
  ...process.env,
  POSTGRES_PASSWORD: adminPassword,
  DATABASE_ADMIN_URL: `postgres://bookit:${adminPassword}@${database}:5432/bookit`,
  MIGRATION_DATABASE_URL: `postgres://bookit_migrator:${migrationPassword}@${database}:5432/bookit`,
  RUNTIME_DATABASE_URL: `postgres://bookit_runtime:${runtimePassword}@${database}:5432/bookit`,
  DATABASE_URL: `postgres://bookit_runtime:${runtimePassword}@${database}:5432/bookit`,
};
let networkCreated = false;
let dbCreated = false;
let apiCreated = false;
const images = [];
const apiImage = process.env.VERIFY_API_IMAGE ?? `bookit-api:${suffix}`;
const migrationImage = process.env.VERIFY_MIGRATION_IMAGE ?? `bookit-migrations:${suffix}`;
assert.equal(Boolean(process.env.VERIFY_API_IMAGE), Boolean(process.env.VERIFY_MIGRATION_IMAGE),
  'Supply both prebuilt verification images, or neither');

function run(args, capture = false) {
  if (args[0] === 'build' || args[0] === 'run') {
    args = [args[0], '--platform', 'linux/amd64', ...args.slice(1)];
  }
  const result = spawnSync('docker', args, {
    cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    if (capture) console.error(result.stderr);
    throw new Error(`Docker ${args[0]} failed (${result.status})`);
  }
  return result.stdout?.trim();
}

function job(command, provision = false) {
  return run(['run', '--rm', '--network', network, '-e', 'MIGRATION_DATABASE_URL',
    ...(provision ? ['-e', 'DATABASE_ADMIN_URL', '-e', 'RUNTIME_DATABASE_URL'] : []),
    migrationImage, 'node', 'scripts/database.mjs', command]);
}

async function waitFor(probe, description) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${description} did not become ready`);
}

try {
  if (!process.env.VERIFY_API_IMAGE) {
    run(['build', '--quiet', '--target', 'api', '-t', apiImage, 'backend']);
    images.push(apiImage);
    run(['build', '--quiet', '--target', 'migrations', '-t', migrationImage, 'backend']);
    images.push(migrationImage);
  }
  assert.equal(run(['image', 'inspect', apiImage, '--format', '{{.Config.User}}'], true), 'node');
  assert.equal(run(['image', 'inspect', apiImage, '--format', '{{.Architecture}}'], true), 'amd64');
  run(['network', 'create', network], true);
  networkCreated = true;
  run(['run', '-d', '--name', database, '--network', network,
    '-e', 'POSTGRES_USER=local_cluster_admin', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=bookit',
    '--health-cmd=pg_isready -U local_cluster_admin -d bookit', '--health-interval=1s',
    '--health-timeout=3s', '--health-retries=30', postgres], true);
  dbCreated = true;
  await waitFor(() => run(['inspect', database, '--format', '{{.State.Health.Status}}'], true) === 'healthy', 'PostgreSQL');
  run(['run', '--rm', '--network', network, '-e', 'POSTGRES_PASSWORD', '-e', `DB_HOST=${database}`,
    migrationImage, 'node', '--input-type=module', '-e', `
      import pg from 'pg';
      const client=new pg.Client({host:process.env.DB_HOST, database:'bookit',
        user:'local_cluster_admin', password:process.env.POSTGRES_PASSWORD});
      await client.connect();
      const statement=await client.query(
        "SELECT format('CREATE ROLE bookit LOGIN CREATEROLE PASSWORD %L', $1::text) AS sql",
        [process.env.POSTGRES_PASSWORD]);
      await client.query(statement.rows[0].sql);
      await client.query('ALTER DATABASE bookit OWNER TO bookit');
      await client.end();
    `]);
  job('provision', true);
  job('provision', true);
  job('release');
  job('release');
  run(['run', '--rm', '--network', network, '-e', 'DATABASE_URL', migrationImage,
    'node', '--input-type=module', '-e', `
      import pg from 'pg'; import assert from 'node:assert/strict';
      const client=new pg.Client({connectionString:process.env.DATABASE_URL});
      await client.connect();
      assert.equal((await client.query('SELECT count(*)::int AS count FROM booking')).rows[0].count,0);
      for (const sql of ['CREATE TABLE public.forbidden(id int)', 'SELECT * FROM pgmigrations',
        "UPDATE resource SET name='forbidden'"]) {
        await assert.rejects(client.query(sql),{code:'42501'});
      }
      await client.end(); console.log('Runtime privilege boundary verified');
    `]);
  run(['run', '-d', '--name', api, '--network', network, '-p', '127.0.0.1::3001',
    '-e', 'DATABASE_URL', '-e', 'CORS_ORIGIN=http://localhost:5173', apiImage], true);
  apiCreated = true;
  const port = JSON.parse(run(['inspect', api, '--format', '{{json .NetworkSettings.Ports}}'], true))['3001/tcp'][0].HostPort;
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    try { return (await fetch(`${origin}/ready`)).ok; } catch { return false; }
  }, 'API');
  for (const path of ['/health', '/ready', '/api/resources', '/api/me']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    console.log(`GET ${path}: ${response.status}`);
  }
  const resources = await (await fetch(`${origin}/api/resources`)).json();
  assert.equal(resources.length, 3);
  const localTime = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const day = localTime(new Date(Date.now() + 172800000)).slice(0, 10);
  const body = {
    resourceId: resources[0].id, bookedForId: '22222222-2222-2222-2222-222222222221',
    purposeId: 'Meeting', start: `${day}T12:00`, end: `${day}T13:00`,
  };
  const post = () => fetch(`${origin}/api/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const created = await post();
  assert.equal(created.status, 201);
  const booking = (await created.json()).booking;
  assert.equal((await post()).status, 409);
  job('release');
  assert.equal((await fetch(`${origin}/api/bookings/${booking.id}`)).status, 200);
  assert.equal((await fetch(`${origin}/api/bookings/${booking.id}`, { method: 'DELETE' })).status, 204);
  console.log('Create 201, overlapping create 409, cancel 204 verified');
  run(['stop', '--time', '20', database], true);
  assert.equal((await fetch(`${origin}/ready`)).status, 503);
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  console.log('Database outage: readiness 503, liveness 200 verified');
  run(['stop', '--time', '20', api], true);
  assert.equal(run(['inspect', api, '--format', '{{.State.ExitCode}}'], true), '0');
  console.log('Non-root production API image, migrations, permissions and graceful shutdown verified');
} finally {
  for (const name of [apiCreated && api, dbCreated && database].filter(Boolean)) {
    run(['rm', '-f', '-v', name], true);
  }
  if (networkCreated) run(['network', 'rm', network], true);
  if (images.length) run(['image', 'rm', ...images], true);
}
