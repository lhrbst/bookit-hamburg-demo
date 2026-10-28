# GitLab CI

## Avoid duplicate pipelines

A branch push with an open merge request triggers two pipelines unless you say otherwise.
Set this once at the top of `.gitlab-ci.yml`:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH
```

## rules, not only/except

`only`/`except` are legacy and do not compose. Use `rules`:

```yaml
plan:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: [infra/**/*]
    - when: never
```

`when: never` as the final rule makes the default explicit instead of implied.

## OIDC login

`id_tokens` mints the token; no long-lived credential:

```yaml
deploy:
  id_tokens:
    AZURE_TOKEN:
      aud: api://AzureADTokenExchange
  script:
    - az login --service-principal -u "$AZURE_CLIENT_ID" -t "$AZURE_TENANT_ID"
        --federated-token "$AZURE_TOKEN"
```

The federated credential subject must match the job — scope it to
`project_path:<group>/<project>:environment:<name>` rather than to the whole project.

## include

Split once the file grows past roughly 200 lines:

```yaml
include:
  - local: .gitlab/ci/validate.yml
  - project: platform/ci-templates
    ref: v2.4.0            # a tag, never a branch
    file: /terraform.yml
```

Pin `ref` to a tag. A `ref: main` include means a template change can break every
consuming pipeline without a commit in that project.

## needs

`stages` are sequential; `needs` turns the pipeline into a DAG so independent jobs start
as soon as their inputs exist:

```yaml
integration-test:
  stage: test
  needs: [build]
```

## Environments

```yaml
deploy:production:
  environment:
    name: production
    url: https://example.com
  when: manual
```

Protect the environment in project settings so only maintainers can run the job — `when: manual`
alone controls timing, not authorisation.

## Artifacts and reports

```yaml
artifacts:
  when: always
  expire_in: 1 week
  reports:
    junit: report.xml
```

`when: always` matters: the report you need most is the one from the run that failed.
