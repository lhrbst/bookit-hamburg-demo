# Migrations

Versioned SQL migrations for the PostgreSQL schema (ADR-003). Applied in
filename order (`0001_...`, `0002_...`, ...).

Nothing here is applied automatically by the application yet — that runner
is added alongside the first HTTP route that needs one. Docker Compose
mounts this directory as `/docker-entrypoint-initdb.d`, so on a fresh
(empty) volume `postgres:16` runs every `*.sql` file here in filename order
automatically. Against an existing database, apply by hand:

```sh
psql "$DATABASE_URL" -f migrations/0001_enable_btree_gist.sql
psql "$DATABASE_URL" -f migrations/0002_create_schema.sql
psql "$DATABASE_URL" -f migrations/0003_seed_data.sql
```

- `0001_enable_btree_gist.sql` enables the `btree_gist` extension needed by
  the booking exclusion constraint.
- `0002_create_schema.sql` creates `resource`, `person`, and `booking`,
  including the `EXCLUDE USING GIST (resource_id WITH =, during WITH &&)`
  constraint that makes booking non-overlap unbreakable at commit
  (ADR-003). `booking.purpose` is plain `text`; the predefined category set
  it must belong to is validated at the application layer (see
  `src/domain/purposes.ts`), not by a database check constraint, so the
  set can change without a migration.
- `0003_seed_data.sql` seeds resources, people, and bookings for local
  development, including a back-to-back pair on one resource (its end time
  equals the next booking's start time) usable for the FS-03 clash test
  scenarios.

Re-running these against a database that already has the schema/seed rows
will fail (tables/rows already exist) — they are intended for a fresh
database, matching the Docker Compose `initdb.d` behaviour above.
