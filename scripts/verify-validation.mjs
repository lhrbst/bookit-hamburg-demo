import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function verifyValidation(run, workflow, jobs, repository, mainSha, automatic) {
  assert.equal(run.status, 'completed', 'Validation must be completed');
  assert.equal(run.conclusion, 'success', 'Validation must succeed');
  assert.equal(run.workflow_id, workflow.id, 'Wrong validation workflow');
  assert.equal(workflow.path, '.github/workflows/validate.yml', 'Wrong workflow path');
  assert.equal(run.head_repository?.full_name, repository, 'Fork validation cannot deploy');
  assert.equal(run.head_branch, 'main', 'Only main validation can deploy');
  assert.ok(['push', 'workflow_dispatch'].includes(run.event), 'PR validation cannot deploy');
  assert.match(run.head_sha, /^[0-9a-f]{40}$/);
  const gate = jobs.filter((job) => job.name === 'validate');
  assert.equal(gate.length, 1, 'Expected exactly one validate gate');
  assert.equal(gate[0].conclusion, 'success', 'The validate gate did not succeed');
  if (automatic) assert.equal(run.head_sha, mainSha, 'Superseded automatic deployment refused');
  return run.head_sha;
}

function github(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`GitHub lookup failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Delivery must be dispatched from main');
  const automatic = process.env.GITHUB_EVENT_NAME === 'workflow_run';
  assert.ok(automatic || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Unsupported trigger');
  if (!automatic) {
    assert.ok(['release', 'rollback'].includes(event.inputs.mode), 'Invalid delivery mode');
    assert.ok(['true', 'false'].includes(event.inputs.provision_database), 'Invalid provisioning flag');
  }
  const id = String(automatic ? event.workflow_run.id : event.inputs.validation_run_id);
  assert.match(id, /^\d+$/, 'Supply a validation run ID');
  const repository = process.env.GITHUB_REPOSITORY;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const base = `repos/${repository}`;
  const run = github(`${base}/actions/runs/${id}`);
  const workflow = github(`${base}/actions/workflows/validate.yml`);
  const jobs = github(`${base}/actions/runs/${id}/jobs?per_page=100`).jobs;
  const mainSha = github(`${base}/git/ref/heads/main`).object.sha;
  const sha = verifyValidation(run, workflow, jobs, repository, mainSha, automatic);
  const comparison = github(`${base}/compare/${sha}...${mainSha}`);
  assert.ok(['ahead', 'identical'].includes(comparison.status), 'Validated commit is not on main history');
  const rollback = !automatic && event.inputs.mode === 'rollback';
  const provision = !automatic && event.inputs.provision_database === 'true';
  assert.ok(!(rollback && provision), 'Rollback must not provision the database');
  await appendFile(process.env.GITHUB_OUTPUT,
    `sha=${sha}\nrun_id=${id}\nrollback=${rollback}\nprovision=${provision}\n`);
}
