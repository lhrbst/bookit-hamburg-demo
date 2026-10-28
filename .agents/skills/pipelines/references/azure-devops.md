# Azure DevOps

## Structure

`stages` → `jobs` → `steps`. Use a `deployment` job rather than a plain `job` for anything
that ships — it binds to an environment and records deployment history:

```yaml
stages:
  - stage: deploy_prod
    jobs:
      - deployment: deploy
        environment: production
        strategy:
          runOnce:
            deploy:
              steps: [...]
```

## Templates

`extends` for a whole pipeline shape, `template` for a fragment:

```yaml
# azure-pipelines.yml
extends:
  template: .azuredevops/templates/terraform.yml
  parameters:
    workingDirectory: infra
```

Declare parameters with types and defaults so a mistake fails at expansion, not at run time:

```yaml
parameters:
  - name: workingDirectory
    type: string
  - name: applyEnabled
    type: boolean
    default: false
```

A template pulled from another repository is pinned in `resources.repositories` by `ref`;
use a tag.

## Service connections

Create the service connection with **workload identity federation**, not a service
principal secret. Azure DevOps mints the token per run.

To get the credentials into a script, use `AzureCLI@2` with `addSpnToEnvironment: true`
rather than passing them yourself:

```yaml
- task: AzureCLI@2
  inputs:
    azureSubscription: sc-platform-prod
    scriptType: bash
    scriptLocation: inlineScript
    addSpnToEnvironment: true
    inlineScript: |
      az account show
```

One service connection per environment, each scoped to its own subscription or resource
group. Restrict it to the pipelines that need it instead of granting access to all.

## Approvals

Approvals and checks live on the environment in the Environments UI, not in YAML. A
`deployment` job targeting that environment inherits them.

## Triggers

```yaml
trigger:
  branches: { include: [main] }
pr:
  branches: { include: [main] }
```

Both default to every branch when omitted, which is rarely what you want. Set `trigger: none`
on a template-only pipeline.

## Variables

Link variable groups to Azure Key Vault rather than storing secrets in the group. Mark
non-secret configuration as plain variables so it stays readable in the log.
