# bookit-hamburg-momme

A resource-booking application for rooms and equipment. Users can see what is
free, book a room (or other resource) for themselves or someone else, and the
system guarantees that no two bookings on the same resource ever overlap.

The functional behaviour is specified in three functional specs:

- [`specs/FS-01-see-whats-free.md`](specs/FS-01-see-whats-free.md) — browsing
  resource availability.
- [`specs/FS-02-book-a-room.md`](specs/FS-02-book-a-room.md) — creating and
  cancelling bookings, and the booking validity rules.
- [`specs/FS-03-avoid-clashes.md`](specs/FS-03-avoid-clashes.md) — preventing
  and refusing clashing bookings.

## Architecture

- **Frontend** (`frontend/`): a React + TypeScript single-page application
  built with Vite. See
  [`docs/adr/ADR-001-react-typescript-spa.md`](docs/adr/ADR-001-react-typescript-spa.md).
- **Backend** (`backend/`): a JSON REST API on Node.js using Express and
  TypeScript, with Zod for request validation and `@js-temporal/polyfill` for
  Europe/Berlin time rules. See
  [`docs/adr/ADR-002-express-rest-backend.md`](docs/adr/ADR-002-express-rest-backend.md).
- **Database**: PostgreSQL 16+. Each booking's time span is stored as a single
  half-open `tstzrange`, and an `EXCLUDE USING GIST` constraint makes
  overlapping bookings on the same resource impossible to commit. See
  [`docs/adr/ADR-003-postgresql-exclusion-constraint.md`](docs/adr/ADR-003-postgresql-exclusion-constraint.md).

The frontend calls the backend's REST API directly over CORS; there is no
server-side rendering or API gateway in between.

## Prerequisites

- **Node.js 22** (both `backend/` and `frontend/` are developed and typed
  against `@types/node@^22`).
- **PostgreSQL 16+** (required for the `tstzrange` / `EXCLUDE USING GIST`
  constraint used by the schema — see ADR-003).
- **psql** (the PostgreSQL command-line client) available on your `PATH`, to
  apply migrations by hand.

There is a `backend/docker-compose.yml` that runs `postgres:16` and mounts
`backend/migrations` as `/docker-entrypoint-initdb.d` (so migrations apply
automatically to a fresh volume) — use it if you have Docker available.
Docker is **not** required, though: a native PostgreSQL 16 install works
identically. In this environment PostgreSQL 16 was installed and started
directly via Homebrew:

```sh
brew install postgresql@16
/opt/homebrew/Cellar/postgresql@16/16.15/bin/postgres -D /opt/homebrew/var/postgresql@16
```

(or `brew services start postgresql@16` to have Homebrew manage it), then a
`bookit` database and role were created and the migrations in
`backend/migrations/` were applied by hand with `psql`, as documented below.
Either approach — Docker Compose or a native install — is equally valid as
long as a PostgreSQL 16+ server is reachable at the `DATABASE_URL` the
backend is configured with.

## Setup

### 1. Install dependencies

```sh
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment variables

Copy the example env files and adjust if needed:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

The variables that must stay aligned between the two apps:

| Variable | File | Default | Purpose |
|---|---|---|---|
| `PORT` | `backend/.env` | `3001` | Port the Express server listens on. |
| `CORS_ORIGIN` | `backend/.env` | `http://localhost:5173` | Origin the API allows via CORS — must match the frontend's own origin. |
| `DATABASE_URL` | `backend/.env` | `postgres://localhost:5432/bookit` | PostgreSQL connection string. |
| `VITE_API_BASE_URL` | `frontend/.env.local` | `http://localhost:3001` | Base URL of the backend API the SPA calls — must match the backend's `PORT`. |
| `VITE_PORT` | `frontend/.env.local` | `5173` | Port the Vite dev server listens on — must match the backend's `CORS_ORIGIN`. |

`backend/.env` also has `CURRENT_PERSON_ID`, a stand-in "current person" used
until real authentication exists; it defaults to one of the people seeded by
the migrations below, so it can be left unset for local development.

### 3. Create the database and apply migrations

With a PostgreSQL 16+ server reachable (natively installed, or via
`docker compose up -d` from `backend/` if using Docker), create the database
referenced by `DATABASE_URL` (e.g. `createdb bookit`), then apply the
versioned SQL migrations in `backend/migrations/` **in filename order** —
there is no automated migration-runner script yet:

```sh
cd backend
psql "$DATABASE_URL" -f migrations/0001_enable_btree_gist.sql
psql "$DATABASE_URL" -f migrations/0002_create_schema.sql
psql "$DATABASE_URL" -f migrations/0003_seed_data.sql
```

- `0001_enable_btree_gist.sql` enables the `btree_gist` extension the booking
  exclusion constraint needs.
- `0002_create_schema.sql` creates `resource`, `person`, and `booking`,
  including the `EXCLUDE USING GIST (resource_id WITH =, during WITH &&)`
  constraint.
- `0003_seed_data.sql` seeds resources, people, and bookings for local
  development.

Re-running these against a database that already has the schema/seed rows
will fail (tables/rows already exist) — they are meant for a fresh database.
See [`backend/migrations/README.md`](backend/migrations/README.md) for
details.

If you use `docker compose -f backend/docker-compose.yml up -d` against a
**fresh** volume, all three files run automatically via
`/docker-entrypoint-initdb.d` and you can skip the manual `psql` step.

## Running both apps for local development

In two separate terminals:

```sh
cd backend && npm run dev
```

Starts the Express API with `tsx watch` on `http://localhost:3001` (or
whatever `PORT` is set to).

```sh
cd frontend && npm run dev
```

Starts the Vite dev server on `http://localhost:5173` (or whatever
`VITE_PORT` is set to).

With the defaults above, the frontend at `http://localhost:5173` calls the
backend at `http://localhost:3001`, and the backend's `CORS_ORIGIN` allows
that origin — no further configuration is needed.

Verify the backend is up:

```sh
curl http://localhost:3001/health
# {"status":"ok"}
```

Then open `http://localhost:5173` in a browser for the frontend.

## Running tests

Backend unit tests (Vitest):

```sh
cd backend && npm test
```

Frontend end-to-end tests (Playwright — requires the backend and frontend
dev servers, or Playwright's own configured web servers, to be reachable):

```sh
cd frontend && npm run test:e2e
```

## Project structure

```
backend/     Express + TypeScript JSON REST API, SQL migrations, unit tests
frontend/    React + TypeScript + Vite single-page application
specs/       Functional specifications (FS-01, FS-02, FS-03)
docs/adr/    Architecture decision records (ADR-001, ADR-002, ADR-003)
```

## Infrastructure (OpenTofu)

The Azure infrastructure lives in `infra/` and is managed exclusively with OpenTofu. Target is the `dev` environment in resource group `rg-Momme-Ristow`.

```bash
export ARM_SUBSCRIPTION_ID=<subscription-id>   # not committed
cp infra/environments/dev.backend.hcl.example infra/environments/dev.backend.hcl  # fill in state account
tofu -chdir=infra fmt -check -recursive
tofu -chdir=infra init -backend-config=environments/dev.backend.hcl
tofu -chdir=infra validate
tofu -chdir=infra plan -var-file=environments/dev.tfvars -out=dev.tfplan
tofu -chdir=infra apply dev.tfplan   # only after reviewing the plan
```
