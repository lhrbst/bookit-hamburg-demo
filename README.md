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
- **Docker** with BuildKit for the container smoke test; optionally use
  `backend/docker-compose.yml` for a digest-pinned PostgreSQL 16 database.
  A native PostgreSQL installation also works.
- **OpenTofu 1.13.1**, Azure CLI and GitHub CLI for infrastructure work.

Migrations are explicit, tracked operations. Compose no longer applies SQL on
first start; an existing volume is never automatically reset.

## Setup

### 1. Install dependencies

```sh
npm --prefix backend ci
npm --prefix frontend ci
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
| `DATABASE_URL` | `backend/.env` | See example | Limited `bookit_runtime` connection; never the administrator. |
| `API_BASE_URL` | `frontend/.env.local` | `http://localhost:3001` | Development runtime configuration, not a value embedded in the bundle. |
| `VITE_PORT` | `frontend/.env.local` | `5173` | Port the Vite dev server listens on — must match the backend's `CORS_ORIGIN`. |

`backend/.env` also has `CURRENT_PERSON_ID`, a stand-in "current person" used
until real authentication exists; it defaults to one of the people seeded by
the demo seed below, so it can be left unset for local development.

### 3. Create the database and apply migrations

Start the local database, then provision separate roles, apply pending
migrations and seed only resources and people. The database commands load
`backend/.env` when invoked through npm. Its three administrative URLs must
refer to the same database, with credentials matching your local database:

```sh
docker compose -f backend/docker-compose.yml up -d --wait
npm --prefix backend run db:provision
npm --prefix backend run db:migrate
npm --prefix backend run db:seed:dev
```

These commands are repeatable and do not reset bookings. Existing schemas
created by the old hand-run SQL are deliberately refused until reviewed;
see [migration operations](backend/migrations/README.md).

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

Real-database integration tests require the migration role because the
concurrency test creates and removes its fixtures. Export the URLs from
your local env file first:

```sh
set -a
. backend/.env
set +a
DATABASE_URL="$MIGRATION_DATABASE_URL" npm --prefix backend run test:integration
```

For Playwright, use a **disposable** migrated database, populate the
historical test fixtures and build the actual frontend artifact:

```sh
ALLOW_TEST_SEED=true npm --prefix backend run db:seed:test
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run build
API_BASE_URL=http://localhost:3001 npm --prefix frontend run configure -- dist
npm --prefix frontend run test:e2e
```

Stop other servers on ports 3001/5173 first. Playwright starts its own API
with a test-only injected clock and serves the production frontend build.
The browser and API share a controlled clock, tests run without retries,
and reports/traces are written under ignored `.local/`.
Production has no test-clock endpoint or environment switch.

The self-contained production-container check creates its own isolated
database, builds both image targets, provisions/migrates/seeds, verifies
limited-role API requests and clash handling, then cleans up its resources:

```sh
node scripts/verify-local.mjs
```

It builds/runs `linux/amd64`, matching Azure Container Apps; an ARM machine
needs Docker's amd64 emulation enabled.

## GitHub Actions

[ADR-004](docs/adr/ADR-004-dev-cicd-deployment-strategy.md) defines dev-only
delivery. These workflows run on github.com:

| Workflow | Trigger | Purpose |
|---|---|---|
| [Validate](.github/workflows/validate.yml) | Every PR, push to `main`, or manual dispatch on `main` | Lint/type/format checks, offline OpenTofu validation, builds, unit/policy tests, runtime dependency audits, real PostgreSQL integration, container smoke and Playwright |
| [Deploy dev](.github/workflows/deploy-dev.yml) | Successful `main` validation, or manual dispatch of a validated run | Publish the tested images, migrate, deploy the API and prebuilt SPA, then smoke-test dev |
| [Apply saved dev plan](.github/workflows/apply-dev.yml) | Reusable workflow called by delivery only | Plan, inspect, approve destructive changes, verify the saved plan hash and apply that exact plan |

`validate` is the required aggregate merge check: skipped, failed or cancelled
validation cannot pass it. PRs receive no Azure/OIDC credentials, secrets,
registry-write permission or remote-state access. Security checks block high
and critical runtime dependency findings. **The current lockfiles already
contain such findings in both projects; validation and delivery will remain
blocked until those dependencies are remediated.** This change does not
suppress them or upgrade unrelated dependencies.

The frontend and both `linux/amd64` images are built once during validation.
Delivery verifies the source SHA and artifact file hashes, then publishes
the exact retained images to public GHCR without rebuilding. Browser
diagnostics are retained for 7 days; frontend/image artifacts and non-sensitive
release records for 30 days. Expired artifacts require a new validation run.

Azure jobs use OIDC through `dev`; third-party actions are pinned to commit
SHAs and maintained by Dependabot. Deployments serialize under `bookit-dev`
without cancelling an active deployment. Superseded automatic validations
cannot roll dev back. The two infrastructure phases preserve the current API
while preparing migration jobs, wait for the exact release execution to
succeed, then update the API digest through OpenTofu. Failed migrations
leave the existing API image selected.

Saved plans and Terraform diagnostics never enter ordinary Actions artifacts
or public logs. Plans are transferred through the private state Blob container
with run/attempt/source/phase binding and SHA-256 verification. Deletions and
replacements require the `dev-destructive` environment reviewer before apply.
The approval job has no Azure credentials.

### First release and manual delivery

The environment variables and Azure prerequisites are documented in
[deployment operations](docs/deployment.md). On the first successful
validation, publishing creates the two GHCR packages. If initially private,
make **both** packages public in GitHub package settings and rerun delivery;
anonymous digest pulls must succeed before any Azure plan is applied.

In **Actions → Deploy dev → Run workflow**, select `main`, provide the ID of
a successful `main` **Validate** run, and choose:

- `release`: normal migration/API/frontend delivery.
- `release` with `provision_database=true`: initial database role setup or
  coordinated password rotation; requires operator approval in
  `dev-destructive`. Normal automatic releases never run provisioning.
- `rollback`: restore that validated API/frontend artifact while preserving
  the current migration image/schema; no migration or reverse SQL is run.
  Confirm schema compatibility first.

The SWA upload retrieves its deployment token just in time through the
OIDC-authenticated Azure lookup, masks it and supplies it only to the upload
action. The SPA receives only the public `config.json` overlay, not a rebuilt
environment-specific bundle. Smoke checks remove only their own synthetic
booking. A failed rollout/upload/smoke check fails delivery; it does not
silently reverse a database migration.

Rerun **all** deployment jobs after a failure so a fresh plan is created;
do not rerun only a stale apply job. GitHub may replace an older pending run
in a concurrency group; it is not a FIFO release queue.

Local workflow/policy checks:

```sh
node scripts/lint-workflows.mjs
node --test scripts/*.test.mjs
npm --prefix backend audit --omit=dev --audit-level=high
npm --prefix frontend audit --omit=dev --audit-level=high
```

The linter installs checksum-verified actionlint 1.7.12 under ignored
`.local/tools/`. Other build, integration and browser commands are above.
Do not invoke the Azure plan/apply helpers merely to lint workflows.

## Project structure

```
backend/     Express + TypeScript JSON REST API, SQL migrations, unit tests
frontend/    React + TypeScript + Vite single-page application
specs/       Functional specifications (FS-01, FS-02, FS-03)
docs/adr/    Architecture decision records (including CI/CD in ADR-004)
scripts/    Reusable local/container verification and plan safety gate
```

## Infrastructure (OpenTofu)

The Azure infrastructure lives in `infra/` and is managed exclusively with OpenTofu. Target is the `dev` environment in resource group `rg-Herbst-Lukas`.

The existing configuration places most resources in North Europe and the Static
Web App in West Europe. Infrastructure deployment does not publish the apps or
run database migrations. The committed release inputs intentionally keep
the initial placeholder until real GHCR digests have been published and
the database release job has succeeded.

See [dev deployment operations](docs/deployment.md) for the approval
boundary, bootstrap state migration, GitHub configuration, first release,
runtime frontend configuration, rollback and rotation. The workflows above
use the required merge check named `validate`.

Bootstrap state for the established dev environment is now remote at
`tfstate-bootstrap/bookit-bootstrap.tfstate`. Initialize its operator-controlled
stack with the private backend configuration:

```bash
export ARM_SUBSCRIPTION_ID=<subscription-id>
cp infra/bootstrap/backend.hcl.example infra/bootstrap/backend.hcl  # fill in existing state account
tofu -chdir=infra/bootstrap init -backend-config=backend.hcl
tofu -chdir=infra/bootstrap plan -out=dev.tfplan
tofu -chdir=infra/bootstrap apply dev.tfplan
tofu -chdir=infra/bootstrap output
```

Use those outputs to fill in the dev backend configuration below. Keep state
backups private; the completed migration preserved the original state lineage,
resources and outputs. GitHub's Blob data grant covers only the dev container.
For a completely new target without state storage, follow the initial local
bootstrap procedure in [deployment operations](docs/deployment.md).

```bash
export ARM_SUBSCRIPTION_ID=<subscription-id>   # not committed
cp infra/environments/dev.backend.hcl.example infra/environments/dev.backend.hcl  # fill in state account
tofu -chdir=infra fmt -check -recursive
tofu -chdir=infra init -backend-config=environments/dev.backend.hcl
tofu -chdir=infra validate
export TF_VAR_operator_object_id=<stable-operator-object-id>
node scripts/prepare-release.mjs
tofu -chdir=infra plan -var-file=environments/dev.tfvars -var-file=../.local/dev.release.tfvars.json -out=dev.tfplan
tofu -chdir=infra apply dev.tfplan   # only after reviewing the plan
```
