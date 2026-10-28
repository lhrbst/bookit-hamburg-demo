## Permissions

Deny by default at workflow level, grant per job:

```yaml
permissions: {}

jobs:
  build:
    permissions:
      contents: read
```

`GITHUB_TOKEN` inherits whatever the workflow grants, so an unset `permissions` block
gives every job the repository default — usually far more than it needs.

## OIDC login

No client secret. The `id-token: write` permission is what mints the token:

```yaml
jobs:
  deploy:
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: azure/login@<sha>  # v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

The federated credential on the app registration must match the subject exactly —
`repo:<org>/<repo>:environment:<name>` for an environment, `repo:<org>/<repo>:ref:refs/heads/main`
for a branch. One credential per environment.

## Pinning

Pin actions to a commit SHA with the version in a trailing comment:

```yaml
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8  # v5.0.0
```

A tag can be moved; a SHA cannot.

Pin the SHA of the action's **latest release**, not of whatever major tag the
surrounding file already uses. Resolve it when you write the workflow — a `v4` in
a neighbouring job is not evidence that `v4` is current:

```bash
tag=$(gh api repos/<owner>/<repo>/releases/latest --jq .tag_name)
gh api repos/<owner>/<repo>/commits/"$tag" --jq .sha
```

An annotated tag resolves to a tag object rather than a commit. Dereference it
before pinning, or let `gh api .../commits/<tag>` do it for you.

A pinned SHA never moves on its own, so pinning without an upgrade path strands
the pipeline on a stale and eventually vulnerable action. Whenever you add or
change a SHA pin, check that Dependabot covers the `github-actions` ecosystem for
that repository, and add it in the same change if it does not:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"          # covers every file under .github/workflows
    schedule:
      interval: "weekly"
    groups:
      github-actions:
        patterns: ["*"]
```

Dependabot rewrites the SHA and the trailing version comment together, so the
comment stays truthful. Group the updates unless you want one pull request per
action. Reusable workflows called by path (`./.github/workflows/x.yml`) are not
pinned and need no entry; ones called from another repository do.
