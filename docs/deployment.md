# Dev delivery operations

This runbook implements [ADR-004](adr/ADR-004-dev-cicd-deployment-strategy.md).
The workflows are `validate.yml`, `deploy-dev.yml` and reusable `apply-dev.yml`;
see the [README workflow guide](../README.md#github-actions) for triggers and
manual inputs. Validation never deploys PRs. Dev delivery applies the exact
saved plan after its policy/approval gate, not a newly generated plan.

## Boundaries and toolchain

- Target only `dev`, `rg-Herbst-Lukas`, in subscription
  `d960facb-8e1a-44d3-be23-1c460b7077ee`.
- Use Node 22, OpenTofu 1.13.1 and the committed provider locks. Dockerfile
  base images and the PostgreSQL 16 image are pinned by digest.
- OpenTofu is the only Azure resource writer. Azure CLI is for authentication
  and read-only discovery. Do not use CLI deployment commands to change the
  Container App image, jobs, firewall, identities, secrets or role assignments.
- The committed `infra/environments/dev.release.tfvars.json` is only the
  initial preparation selection. After an apply, the `release_inputs`
  state output persists the selected API/migration digests and enabled flag.
  Run `node scripts/prepare-release.mjs` before every dev plan, then load
  `../.local/dev.release.tfvars.json` alongside `environments/dev.tfvars`.
  This retains the deployed release instead of resetting it to the committed
  placeholder. Explicit `API_IMAGE`, `MIGRATION_IMAGE` and
  `APPLICATION_ENABLED` overrides select a new release. Untracked real
  images without persisted inputs fail closed and need operator recovery.
- The operator object ID is stable input, not the current caller's ID.
  Supply it as `TF_VAR_operator_object_id`; CI uses `TF_OPERATOR_OBJECT_ID`.

The initial release inputs pin the existing public MCR quickstart image,
with `application_enabled=false` and `migration_image=null`. This is a
preparation stage, not a deployed bookit API. In this stage the app serves
port 80 with its placeholder probe and receives no database credential.
Jobs are not created with fictional
GHCR digests. Enabling the real app requires public API and migration digests.

## GitHub prerequisites

Configured on github.com for `lhrbst/bookit-hamburg-demo`:

| Setting | Contract |
|---|---|
| `main` protection | Required check `validate`, up-to-date branch, resolved conversations; no force pushes/deletion |
| Administrator bypass | Retained for the initial workflow installation; normal changes use the required validation gate |
| Actions defaults | Read-only token, cannot approve PRs; full action SHA pinning required |
| `dev` environment | Only `main`, no human approval for normal delivery |
| `dev-destructive` environment | Only `main`, required reviewer `lhrbst`; self-review permitted for this single-maintainer demo |
| Dependabot | Weekly Actions, npm and Docker updates |

`validate.yml` publishes an aggregate job named exactly `validate`, with no
path filters. It fails unless every validation step succeeds. Existing
high/critical runtime audit findings block this gate until separately
remediated; they are not allowlisted by the workflows.

`dev` variables: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_RESOURCE_GROUP`, `TF_STATE_STORAGE_ACCOUNT`, `TF_STATE_CONTAINER`,
`TF_STATE_KEY`, `TF_OPERATOR_OBJECT_ID`, `GHCR_API_IMAGE`,
`GHCR_MIGRATION_IMAGE`, and `AZURE_CLIENT_ID` from the applied bootstrap output.
The established dev environment already has these configured.
No Azure client secret or SWA token is stored in GitHub.

The only federated subject is
`repo:lhrbst/bookit-hamburg-demo:environment:dev`. The destructive-approval
job must have no Azure access; once approved, the privileged apply job runs
in `dev`. The approval environment does not have a federated identity.

## Operator bootstrap and state recovery

The operator-controlled bootstrap stack owns the GitHub managed
identity/federation, resource-group Contributor and
secret-management access, dev-container Blob Data Contributor, and a
conditional Key Vault Data Access Administrator grant that can assign/delete
only the Key Vault Secrets User role. GitHub's Blob data grant covers only the dev
container, and workflows never apply the bootstrap stack.

The operator's existing Azure ABAC policy prohibits delegating Owner,
User Access Administrator and Role Based Access Control Administrator.
The specialized Key Vault role avoids those general administrator roles;
the assignment's additional condition still permits only Secrets User
grants, not the other Key Vault roles the built-in role normally supports.

This is operator ownership, not a management-plane deny boundary: the
resource-group Contributor grant can manage resources in this shared group,
including bootstrap storage and identities. Treat trusted `main` deployment
code as privileged. Strict isolation of bootstrap resources would require
a separate scope and narrower management permissions.

Bootstrap state for the established dev environment has been migrated to
`stbookittfstateb08qzp/tfstate-bootstrap/bookit-bootstrap.tfstate`, separate
from dev state. The migration preserved lineage, resources and outputs,
and its remote-backed plan showed no changes. Private backups are retained.
The checked-in `bootstrap/backend.tf` activates that remote backend; on a
fresh checkout, copy/fill the ignored `backend.hcl.example` and initialize
with `tofu init -backend-config=backend.hcl` in `infra/bootstrap/`.

For a completely new target with no state storage, temporarily keep
`backend.tf` outside the active configuration and initialize the bootstrap
locally. Review/apply its saved plan as the authorized operator. Only once
the storage account and containers exist, restore `backend.tf`, fill the
private backend config and separately approve
`tofu init -migrate-state -backend-config=backend.hcl`. Verify state integrity
and a no-change plan before removing any local copy. Refuse an existing
destination blob unless its ownership/state has been explicitly reviewed;
do not use `-reconfigure` as a substitute for copying state.

Keep bootstrap state and its backups private until remote verification.
The storage account uses Entra authentication (no shared keys), blob
versioning and 30-day blob/container soft deletion. The state account and
both containers have `prevent_destroy`; protect bootstrap changes with
operator review as well. If state is lost, recover the correct blob version
or private backup and verify a no-change plan; do not recreate managed
resources blindly. Never delete the state account to reset the app.

## Plans, approvals and workflow handoff

Every Azure-backed plan is from trusted, validated `main`, never PR code.
Offline PR checks use backend-disabled init, format and validate only.
Delivery checks the validation workflow ID, event, repository, branch, exact
successful `validate` job, source SHA and main ancestry before using artifacts.
Automatic delivery additionally refuses superseded main SHAs. Manual delivery
can select an older validated main revision with retained matching artifacts.
Deployments serialize under one `dev` concurrency group without cancelling
an active apply. Serialize operator changes with that group too; generate
fresh release inputs for each plan instead of reusing an old local file.

Use the plan's binary file for apply; do not regenerate after approval.
Inspect its private JSON with `node scripts/check-plan.mjs <private-json>`.
Exit 0 permits ordinary review, exit 2 requires `dev-destructive` approval,
and any other nonzero status is a failure. A replacement is destructive too.
This script is a gate, not an apply command.

Saved plans, JSON exports and logs can contain database passwords/state.
Keep them owner-readable in an ephemeral deployment workspace; never upload
them as ordinary public-repository Actions artifacts, caches, PR comments or
logs. Between jobs, transfer the binary plan only through the existing
private dev state Blob container, under a unique
`plans/dev/<run-id>/<attempt>/<sha>/<phase>/`
prefix, using Entra/OIDC authentication. Pass only its path and SHA-256 hash
as job outputs; download and verify that exact hash after approval. Keep the
state key separate, never use account keys/SAS, and delete the plan blobs
after completion, including rejected approvals. Successful/skipped applies
also remove their private Terraform logs. Failed plan/apply diagnostics remain
private at the same prefix for operator investigation; remove them afterward.
Storage soft-delete/version retention applies after deletion; it is not a TTL
for live diagnostic blobs. Cancelled or interrupted cleanup can require the
same operator cleanup.
Destroy local sensitive exports when the reviewed plan is no longer needed.

The validation sequence is lint/type/format, build, backend unit tests,
dependency/policy checks, real PostgreSQL integration, then Playwright.
All commands are available locally (see the root README). Use a disposable
PostgreSQL 16 service with the Compose digest, explicit provisioning,
migrations and test seed. Integration failures must not become skips.
Playwright uses the built SPA, injected API/browser time and zero retries.
Publish only non-sensitive reports/traces with short retention.

## First application release

1. Validation builds the Dockerfile `api` and `migrations` targets once per validated
   revision, for `linux/amd64` (or a multi-platform manifest including it).
   Publish to the two GHCR paths in GitHub variables using a job-scoped
   `GITHUB_TOKEN` with `packages:write`, not a PAT. It exports image archives
   and a source/file-hash manifest; delivery verifies and loads those bytes
   instead of rebuilding.
2. Newly created GHCR packages may initially be private. Make both public
   after first publication and verify anonymous digest pulls before planning
   jobs or the app. Package visibility cannot be set before a package exists.
   Persist the resolved immutable migration digest; do not select a mutable tag.
   Prepare the plan inputs with `MIGRATION_IMAGE=<digest> node scripts/prepare-release.mjs`;
   the existing API selection remains unchanged.
3. Keep the current API digest unchanged and plan/apply the job preparation
   with the new migration digest. The provision job alone receives the admin
   URL and both role URLs; the normal release job receives only the migrator.
   Each uses its own managed identity and per-secret Key Vault reader grants.
4. Manually dispatch `Deploy dev` with `mode=release` and
   `provision_database=true` for initial setup. The prepare approval gate uses
   `dev-destructive` even for a non-destructive plan when provisioning is
   requested. Execute the provision job once through the Container Apps Job execution
   API, then execute the release job and wait for its terminal success.
   Provisioning/rotation is operator-controlled; routine delivery runs only
   release. The workflow uses `scripts/run-database-job.mjs` and the ARM REST
   API, not Azure CLI mutation commands. It polls only the execution returned
   by its single start request, including Azure's 202/Location start response.
   Execution is workload activity, not an ad hoc resource update.
   Neither job retries automatically. A failure prevents API rollout.
5. Set `API_IMAGE=<digest> APPLICATION_ENABLED=true` when running
   `scripts/prepare-release.mjs`; generate/review/apply
   a new saved plan. This changes ingress to 3001 and enables `/health`
   startup/liveness plus `/ready` checks. Single revision mode is retained.
   Its successful apply persists the selection in the state output for the
   next application or infrastructure plan; no workflow bot pushes to `main`.
6. Smoke-test `/health`, `/ready`, `/api/resources`, `/api/me`, booking
   create/clash/cancel behavior and the frontend. Record the released source,
   both image digests and frontend artifact identity for rollback.

Future releases repeat job preparation, successful migration, then API
rollout. Do not enable the real API before roles/migrations/seed exist.
Schema changes must remain compatible with the old API during migration
and with the retained rollback image.

An untracked legacy Azure schema requires the explicit review described in
[migration operations](../backend/migrations/README.md); the tool refuses
to invent a baseline.

## Frontend artifact and SWA token exception

Build `frontend/dist` without an API URL. For each target, copy the retained
artifact to a deployment directory and run
`API_BASE_URL=<https-api-origin> npm --prefix frontend run configure -- <directory>`.
The directory is relative to `frontend/`, because npm sets the working
directory. Only `config.json` changes; hashed JavaScript is not rebuilt.
Upload this directory with prebuilt-app mode and no Oryx rebuild.

Only a public HTTPS origin is accepted (HTTP is limited to loopback for
local testing). No credentials, query strings or paths belong in the URL.
The SPA loads config before making API calls, times out after ten seconds
and displays an accessible reload action on failure. SWA configuration keeps
config uncached, HTML revalidated, hashed assets immutable, and deep links
working without turning missing config/assets into `index.html`.

OIDC still authenticates the Azure lookup that retrieves the SWA deployment
token. The approved token exception is limited to the upload step:
capture the lookup result privately, register log masking before use,
pass it only to that action and discard it immediately afterward.
Never echo the token or retain it in artifacts/GitHub secrets. If exposed,
stop delivery and revoke/rotate via an approved managed-resource operation;
do not conceal the incident or merely remove a log line. Schedule rotation,
verify upload with the replacement, and do not assume resetting this token
changes the app's public demo identity.

## Rollback and maintenance

Manually dispatch `Deploy dev` from `main`, selecting a known-good validated
run and `mode=rollback`. Restore its retained API digest through the release
inputs and another reviewed OpenTofu plan/apply. Re-upload the matching retained frontend
artifact with its public config overlay. Never roll back by a direct image
update, mutable tag or automatic reverse migration. Rollback preserves the
current migration image and skips job execution. The release record reports
that actual migration image, not the old candidate's migration artifact.
If the schema is
incompatible, stop and restore/repair through a separately approved database
recovery procedure; an API rollback cannot undo destructive SQL.

Rotate DB passwords through OpenTofu/Key Vault followed by operator
provisioning and consumer restart/readiness checks. Do not rotate just one
side. Retain the previous images until the replacement passes smoke checks.

The visible disclaimer, synthetic-only data, shared current person, public
endpoints and broad Azure-services DB firewall rule are dev-only concessions.
Do not treat this configuration as a production security baseline.
