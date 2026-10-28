# ADR-004: Use GitHub Actions and OpenTofu to deliver the dev environment

**Status:** accepted
**Date:** 2026-10-27
**Deciders:** Project team

## Context

The application has separate React/Vite and Express projects, PostgreSQL migrations, and an Azure stack managed with OpenTofu. The stack provisions Azure Container Apps and Static Web Apps, but application delivery, image publication, migration execution, and GitHub/Azure identity wiring are not yet implemented. The current dev API image is a placeholder, the frontend otherwise defaults to calling localhost, migrations are manual, and the app has no real user authentication. The delivery strategy therefore needs to make the dev demo repeatable without implying that its public, shared-user setup is suitable for production.

## Decision

Use GitHub Actions to validate pull requests and deliver the dev environment from trusted commits on `main`. Deploy dev automatically only after validation succeeds, and also support manual dispatch of a validated revision. Do not deploy pull requests or establish a production environment in this decision.

Build and publish the backend container to **public GHCR**, identify releases by immutable image digest, and keep OpenTofu as the sole owner of the Container App image field. Persist the selected digest in the dev release inputs so subsequent infrastructure applies retain the deployed image. GitHub authenticates to Azure through OIDC using a repository-specific user-assigned managed identity and the `dev` GitHub environment; its federated subject is `repo:lhrbst/bookit-hamburg-demo:environment:dev`. Pull requests receive offline infrastructure checks only; trusted `main` runs an Azure-backed plan and applies that same plan. A destructive plan requires explicit human approval.

Require validation checks for merging to `main`. Order them from inexpensive lint, type and format checks through builds, unit tests, security/policy checks, database integration tests, and Playwright. A failure blocks delivery; do not retry tests to obtain a green run. Grant each workflow job only the GitHub token permissions it needs, pin third-party Actions to commit SHAs, and keep those pins current through Dependabot. Serialize deployments to the dev environment.

Run CI against disposable PostgreSQL 16 service containers pinned by digest. Apply SQL migrations explicitly, require the real-database concurrency tests to execute, and run Playwright against the production-shaped app and isolated fixtures. Use controlled API and browser clocks for time-sensitive tests. Keep Playwright as the only frontend behavioural test layer.

Use `node-pg-migrate` with SQL-based migrations. Deploy migrations through an on-demand Azure Container Apps Job, using the release's migration code. Prepare and run the job, wait for success, then apply the OpenTofu image update; a failed migration leaves the existing API revision in service. Seed Azure dev with demo resources and people only, separate from migrations, and do not reset user data on redeployment.

Deploy one environment-independent frontend build artifact to Azure Static Web Apps. The SPA loads a separately supplied public runtime configuration containing the API URL, validates it before starting, reports configuration errors, and uses an explicit cache policy to avoid stale settings. Do not put credentials in the frontend bundle or runtime configuration.

Use separate password-based database roles for API runtime and migration execution, with Key Vault references and narrowly scoped managed-identity access. Retain the current public dev endpoints and PostgreSQL Azure-services firewall rule as a documented dev-only trade-off. Keep the API in Single revision mode with readiness and post-deployment smoke checks; roll back by applying a retained image digest through OpenTofu. Treat the application as a public demo with synthetic data and a visible shared-user limitation, not as an authenticated service.

Run the initial infrastructure bootstrap as an authorized operator, then keep bootstrap state in Azure Blob storage under a key separate from the dev stack. Keep bootstrap operator-controlled and document recovery and deletion safeguards. The dev stack and workflow use remote Blob state with Entra authentication; state and saved plans are sensitive and must not be published as ordinary CI artifacts.

The Static Web Apps upload requires its deployment token. The team explicitly approves a narrow exception: retrieve the token at runtime through Azure OIDC and use it only in the dev SWA upload step. Do not store it in GitHub, log or publish it, or commit it; document token rotation and revocation.

## Consequences

### Positive

- Pull-request validation does not receive Azure credentials or state access, while trusted deployment uses short-lived OIDC authentication rather than a stored Azure client secret.
- An immutable GHCR digest and OpenTofu ownership make the running API image reproducible and prevent an unrelated infrastructure apply from silently restoring a placeholder image.
- A disposable database and mandatory PostgreSQL concurrency test verify the database invariant against the real dependency without touching Azure demo data.
- Migration success is an explicit prerequisite to the API update. A failed migration does not proceed to replace the running API.
- A single frontend artifact can be promoted without rebuilding environment-specific JavaScript; runtime configuration keeps the API endpoint out of the bundle.
- The public demo's shared identity, synthetic-data boundary, and broad dev network exposure are explicit rather than mistaken for production security properties.
- Single-revision operation, a single registry, and a single frontend test framework keep the initial dev delivery path relatively small.

### Negative

- GHCR images and their contents are public. The container build must exclude credentials, local environment files, test artefacts, and any non-public data.
- The SWA deployment-token exception remains a long-lived credential, even though it is fetched just in time. Its use, logs, step scope, and rotation need ongoing care.
- The managed identity, federated credential, RBAC assignments, state access, Key Vault references, and initial bootstrap require operator setup and careful permission scoping.
- OpenTofu owns application image releases, so even an application-only update includes an infrastructure plan/apply and requires the deployment identity's corresponding permissions.
- The on-demand migration job, role provisioning, migration history, and deliberate handling of already-initialized databases add operational work beyond the current hand-run SQL files.
- Public database and Key Vault endpoints and the PostgreSQL Azure-services firewall rule are accepted only for dev; they broaden network reachability beyond this application's own Azure resources.
- A shared unauthenticated demo identity permits visitors to affect the same synthetic bookings. This does not satisfy the authenticated-person requirement for a real deployment.
- Runtime frontend configuration needs an explicit delivery and cache-invalidation contract; the SPA must fail visibly when configuration is absent or invalid.
- Single revision does not provide gradual traffic shifting, and application rollback cannot reverse a destructive database migration.
- Runtime database passwords still require rotation, and OpenTofu state must be protected because it can contain secret values.

## Rejected Alternatives

### Option: Deploy production alongside dev

**Reason rejected:** Production is not currently configured or required. The existing stack's public networking, demo identity, and lack of production recovery policy are not an acceptable production baseline. Adding production now would expand the work beyond the dev delivery objective.

### Option: Manual-only dev deployment

**Reason rejected:** Requiring an operator for every validated dev update would leave the demo stale and provide less frequent evidence that the full deployment path works. Manual dispatch remains available for deliberate redeployments.

### Option: Automatically deploy pull requests

**Reason rejected:** Pull requests, especially from forks, are untrusted code and must not receive Azure, registry, or state privileges. PR preview deployments are outside this dev-only strategy.

### Option: Private ACR

**Reason rejected:** ACR would keep images private and support OIDC publishing plus managed-identity pulls, but it adds an Azure resource and cost. Public GHCR is adequate for this explicitly public demo and permits publishing with the job-scoped `GITHUB_TOKEN` while allowing credentialless image pulls.

### Option: Private GHCR

**Reason rejected:** Container Apps would need credentials to pull private GHCR images. That introduces a persistent pull secret and rotation burden, undermining the secretless deployment goal.

### Option: Let a separate application deployer own the Container App image

**Reason rejected:** Splitting image ownership from OpenTofu would require ignoring or reconciling image drift and could cause later infrastructure applies to change the running release. Keeping the digest in OpenTofu provides one authoritative deployment record, despite requiring an infrastructure apply per release.

### Option: Entra application/service principal for GitHub federation

**Reason rejected:** It is a valid OIDC option, but this deployment only needs Azure resource access and already has an Azure IaC bootstrap. A user-assigned managed identity keeps the deployment identity in Azure's resource lifecycle and avoids a separate application-registration lifecycle.

### Option: Keep bootstrap state only on an operator's machine

**Reason rejected:** A local-only state file makes recovery and later bootstrap changes dependent on one operator's machine and backups. After the authorized initial bootstrap, retain bootstrap state in Azure Blob storage under a key separate from the application stack; keep bootstrap operator-controlled.

### Option: Give pull-request plans Azure and state access

**Reason rejected:** OpenTofu provider/configuration execution is privileged, and remote state can contain secrets. Offline checks on every PR avoid exposing Azure credentials or state to PR code. A trusted `main` run produces and applies the same saved Azure-backed plan instead.

### Option: Use Docker Compose for the CI database

**Reason rejected:** The CI topology needs only one database. A PostgreSQL 16 service container gives each job a disposable instance with less volume lifecycle and cleanup complexity. Compose remains available for local development.

### Option: Skip database integration tests when PostgreSQL is unavailable

**Reason rejected:** The concurrency guarantee depends on real PostgreSQL locking and the exclusion constraint; silently skipping would let the required check pass without testing that guarantee. CI provisions the database and fails when it is unavailable or the integration tests do not run.

### Option: Use wall-clock-dependent E2E fixtures

**Reason rejected:** Tests using the real current day or randomly selected dates can cross midnight, land in the past, or vary at DST boundaries. Injected API time and controlled browser time make these scenarios repeatable while keeping production time real.

### Option: Build a custom SQL migration runner

**Reason rejected:** A custom runner would make the project responsible for migration history, locking, transactional behaviour, and recovery. `node-pg-migrate` supplies these mechanisms while allowing schema changes to remain SQL-based.

### Option: Run Azure migrations on a GitHub-hosted runner or a self-managed runner

**Reason rejected:** A GitHub-hosted runner has changing network addresses and would require temporary database firewall changes and robust cleanup. A self-managed runner would add persistent runner operations and maintenance. An on-demand Container Apps Job runs within the existing Azure environment and avoids opening database access for the CI runner.

### Option: Include example bookings in dev initialization

**Reason rejected:** The existing bookings are fixed-date fixtures that become stale, and automatic re-seeding risks restoring or altering application data on redeployment. Initialize only demo resources and people; keep bookings as data and do not reset them on release.

### Option: Store the SWA deployment token as a GitHub secret

**Reason rejected:** It would create a persistent GitHub credential and a separate secret-rotation step. Instead, retrieve the token at runtime through Azure OIDC. This is still a long-lived token and is explicitly approved only as a narrow exception for the upload step.

### Option: Require a token-free Static Web Apps upload

**Reason rejected:** The selected deployment action requires an SWA deployment token, and no supported token-free upload path was established for the provisioned Static Web App. The explicit, limited runtime-token exception allows delivery without storing the token in GitHub.

### Option: Build a separate frontend artifact for every environment

**Reason rejected:** Vite embeds `VITE_API_BASE_URL` at build time, making each bundle environment-specific and preventing promotion of the exact same frontend artifact. Runtime-loaded public configuration allows one build to be deployed with environment-specific API endpoints kept outside the bundle.

### Option: Use Entra database authentication immediately

**Reason rejected:** Managed-identity database authentication removes passwords but requires PostgreSQL Entra configuration, database principal/role provisioning, and token-refresh support in the `pg` connection path. Separate password roles and Key Vault references are a smaller first step while still removing administrator access from the API.

### Option: Keep the database administrator as the API identity

**Reason rejected:** The API does not need schema-administration privileges. Separate runtime and migration roles limit the impact of an application credential compromise and give migrations only the extra privileges they require.

### Option: Introduce private networking for dev

**Reason rejected:** Private endpoints, DNS, and a connected migration/deployment executor add cost and troubleshooting to a synthetic-data demo. Retain the current dev networking and explicitly do not treat it as a production design.

### Option: Use multiple Container App revisions with traffic shifting

**Reason rejected:** Controlled traffic would add revision and traffic-management complexity for a single dev environment. Single revision plus readiness, smoke tests, retained image digests, and OpenTofu rollback is sufficient for the current scope.

### Option: Add frontend Vitest or a component-testing framework

**Reason rejected:** The repository already has Playwright coverage for browser behaviour and accessibility. Avoid another frontend test stack; keep Playwright as the only frontend behavioural layer and verify the production-shaped artifact with it.

## Related

- [ADR-001: Use React with TypeScript and Vite as the frontend framework](./ADR-001-react-typescript-spa.md) — defines the SPA artifact and frontend configuration affected by this strategy.
- [ADR-002: Use Node.js with Express and TypeScript for the backend REST API](./ADR-002-express-rest-backend.md) — defines the API image, runtime configuration, and migration consumer.
- [ADR-003: Use PostgreSQL with an exclusion constraint to enforce booking non-overlap](./ADR-003-postgresql-exclusion-constraint.md) — motivates mandatory real-PostgreSQL integration tests and ordered migrations.
