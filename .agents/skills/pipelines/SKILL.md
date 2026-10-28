---
name: pipelines
description: Use when writing or reviewing a CI/CD pipeline — a .github/workflows file, a GitHub Actions workflow, .gitlab-ci.yml, azure-pipelines.yml, or any job, stage or deploy step. Carries the house conventions an agent does not apply by default — OIDC and workload identity federation instead of stored secrets, third-party actions pinned to a commit SHA, explicit permissions, the cheapest check first, environments and approvals. Not for local build scripts or pre-commit hooks.
---

# Pipeline conventions

Before applying these rules to an existing repository, check whether it already has a
convention of its own. An established local pattern beats the guide; match it and move on.
Only if the user asks you to refactor should you consider changing it.

## What a pipeline is for

A pipeline proves that a change is safe and then ships it. Everything it does falls into
one of those two jobs. Work that does neither — generating documentation nobody reads,
posting notifications nobody acts on — belongs somewhere else.

Anything a pipeline checks must be runnable locally with the same command. A rule that can
only be enforced in CI is a rule developers discover after they push.

## File layout

- `.github/workflows/<purpose>.yml` — one file per purpose, named for what it does
  (`validate.yml`, `release.yml`), never for what it runs on (`push.yml`).
- `.gitlab-ci.yml` at the root, with stages split into `.gitlab/ci/<stage>.yml` once it
  passes roughly 200 lines.
- `azure-pipelines.yml` at the root, templates under `.azuredevops/templates/`.

Keep one pipeline per outcome. A single file that builds, tests, releases and deploys
behind a thicket of conditions is harder to reason about than three files with clear names.

## Triggers

- Pull request: everything that validates. This is the only gate that blocks a merge.
- Push to the default branch: validate again, then publish or deploy to the first environment.
- Tag: release. Tags are immutable, so a tag build must not depend on mutable inputs.
- Manual dispatch: anything destructive or expensive, and every production deploy.

Never trigger on a schedule to work around a missing dependency between pipelines.

## Stage order

1. Lint and format checks — cheapest, fails fastest.
2. Build.
3. Unit tests.
4. Security and policy scans.
5. Integration tests against real dependencies.
6. Publish artifacts.
7. Deploy, one environment per stage.

Order stages so the cheapest thing that can fail runs first. A pipeline that spends eight
minutes building before finding a formatting error wastes eight minutes on every run.

## Cloud authentication

Use workload identity federation — OIDC — for every cloud login. No long-lived cloud
credentials in a pipeline, in any platform, including for a proof of concept.

Grant the token the narrowest scope that works: one identity per repository and
environment, not one shared identity per subscription. When a deploy needs more rights
than a validation run, they are two identities.

If federation is genuinely unavailable, say so explicitly and ask the user before falling
back to a secret.

## Secrets

- Read secrets from the platform's secret store or a key vault at run time. Never from a
  file in the repository, and never from a variable committed to a template.
- Reference a secret only in the step that needs it, not as a job-wide environment variable.
- A secret that reaches a log is compromised. Do not echo them, and do not pass them as
  command-line arguments, where they land in process listings.
- Rotate on a schedule, and treat a rotation that breaks the pipeline as a defect in the
  pipeline.

## Environments and approvals

Model every deployment target as a platform environment, so approvals, secrets and
deployment history hang off it. Production always requires a human approval; lower
environments should not, or the approval becomes a reflex.

Deployments to one environment run one at a time. Use the platform's concurrency control
rather than hoping two runs never overlap.

## Pinning

Pin third-party actions, images and templates to an immutable reference — a commit SHA for
actions, a digest for container images. A moving tag is a supply chain risk and makes a
failed build impossible to reproduce.

Pin your own reusable templates to a tag, and let a bot propose the upgrades.

## Caching and artifacts

Cache dependencies, never build output. A cache is an optimisation and must be safe to
lose; if a cold cache produces a different result, it is not a cache.

Publish as artifacts what the next stage needs and what a human would need to debug a
failure — test reports, plan files, logs from failed integration tests. Keep retention
short for everything else.

## Failure behaviour

- A failing pipeline blocks the merge. Never `continue-on-error` to get a green check.
- Retry only what is genuinely flaky — a network call — and never a test.
- A step that can fail without consequence should not be in the pipeline.
- Fail with the actual command output, not a summary. The next reader is debugging at
  02:00 without the context you have now.

## References

Read the one matching the platform you are working in.

- `references/github.md` — GitHub Actions: `permissions` defaults, OIDC login, SHA
  pinning, `workflow_call` versus composite actions, concurrency, environments.
- `references/gitlab.md` — GitLab CI: suppressing duplicate pipelines, `rules`,
  `id_tokens` for OIDC, `include` with a pinned ref, `needs`, artifact reports.
- `references/azure-devops.md` — Azure DevOps: `deployment` jobs, `extends` and
  `template` with typed parameters, service connections with workload identity
  federation, environment approvals.
