# Database migrations and role provisioning

SQL migrations are applied by `node-pg-migrate` 9 through
`scripts/database.mjs`, never by API startup or Compose's initdb hook.
The runner records successful migrations in `public.pgmigrations`, uses its
database lock, checks ordering and runs pending migrations transactionally.
Never edit a migration after it has been applied; add a new numbered SQL file.

- `0001_enable_btree_gist.sql` enables the booking constraint's extension.
- `0002_create_schema.sql` creates resources, people and bookings, including
  the exclusion constraint from ADR-003.
- `../seeds/dev.sql` separately initializes synthetic resources/people.
- `../seeds/test.sql` adds fixed-ID historical bookings for disposable tests.
  It is not a migration or an Azure seed.

## Credentials and order

The database tooling loads `.env` in its working directory. npm commands run
in `backend/`; container jobs receive secrets through environment references.
Never pass connection strings as command arguments or print them.

| Variable | Consumer | Privileges |
|---|---|---|
| `DATABASE_ADMIN_URL` | Operator provisioning only | Database owner with role-creation rights; creates the trusted extension |
| `MIGRATION_DATABASE_URL` | Migrations/seeding | `bookit_migrator`: schema ownership/DDL and migration ledger |
| `RUNTIME_DATABASE_URL` | Operator provisioning only | Desired `bookit_runtime` login/password |
| `DATABASE_URL` | API | `bookit_runtime`: read catalog/people, read/insert/delete bookings |

Provisioning requires all three tooling URLs to point to the same database.
It creates or updates the two fixed-name logins, refuses privileged existing
roles, limits PUBLIC database/schema privileges and enables `btree_gist`.
On Azure, OpenTofu must first allowlist `BTREE_GIST` via `azure.extensions`.
Provisioning does not require PostgreSQL superuser privileges.

```sh
npm --prefix backend run db:provision
npm --prefix backend run db:migrate
npm --prefix backend run db:seed:dev
```

The provision operation is for initial setup and password rotation, not
every application release. `node scripts/database.mjs release` applies
pending migrations and the dev seed using **only** the migrator URL.
Running release again does not recreate bookings or reset user data.
Applied migrations are not rolled back automatically on an API rollback.

After migration the runtime role receives SELECT on resource/person and
SELECT/INSERT/DELETE on booking. It cannot change catalog data, create tables
or access the migration ledger. The API receives neither an administrator
nor a migrator credential.

## Disposable tests

On a dedicated, migrated test database:

```sh
ALLOW_TEST_SEED=true npm --prefix backend run db:seed:test
```

This opt-in additionally installs historical bookings needed by the browser
suite, including the back-to-back pair. Only run it on a disposable database;
never supply `ALLOW_TEST_SEED` to Azure jobs. E2E uses the fixed API/browser
clock from `test-support/server.ts` and `frontend/e2e/support/test.ts`.

The concurrency suite needs `DATABASE_URL` set to the migrator connection
because it owns its test fixtures. Connection/setup failures fail the test;
they are not skipped.

## Existing hand-migrated databases

The runner refuses a booking schema without a migration ledger. Do not
fake a baseline, delete application tables or insert migration-history rows
just to make a deployment green.

For an existing database, stop delivery and take/verify a backup. Compare
the actual tables, owners, constraints, extension and grants against the
versioned SQL, and review any data that must be retained. Choose an explicit,
operator-reviewed adoption/data-migration procedure before running the new
runner. Transfer ownership to the migrator where needed and record exactly
which schema was adopted. The repository deliberately supplies no automatic
baseline for an unverified legacy schema.

For a genuinely disposable local database, start with a new named
database/volume instead. Do not delete a shared or Azure database.

## Rotation and failure handling

Change passwords in Key Vault through an approved OpenTofu change, then run
the operator provisioning job with the new URLs. Restart the affected API/job
consumers and verify `/ready` and application requests. Coordinate this
maintenance: switching a password invalidates the previous credential.
Never rotate or modify Azure resources through an ad hoc CLI write.

Migration errors exit nonzero and leave the old API deployed. Logs report
the SQLSTATE/routine but not driver SQL or credential-bearing statements.
Investigate the failed job and migration transaction before retrying;
never mark a failed migration as applied.
