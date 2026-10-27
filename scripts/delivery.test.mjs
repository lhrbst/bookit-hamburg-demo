import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyValidation } from './verify-validation.mjs';
import { planKey, downloadPlan } from './private-plan.mjs';
import { azureClient, blobUrl } from './azure.mjs';
import { executeJob } from './run-database-job.mjs';
import { inventory } from './release-artifact.mjs';

const sha = 'a'.repeat(40);
const workflow = { id: 1, path: '.github/workflows/validate.yml' };
const jobs = [{ name: 'validate', conclusion: 'success' }];
const run = {
  status: 'completed', conclusion: 'success', workflow_id: 1, head_branch: 'main',
  head_repository: { full_name: 'lhrbst/bookit-hamburg-demo' }, event: 'push', head_sha: sha,
};
const check = (candidate, automatic = true, gate = jobs) =>
  verifyValidation(candidate, workflow, gate, 'lhrbst/bookit-hamburg-demo', sha, automatic);

test('only successful exact main validation can deploy automatically', () => {
  assert.equal(check(run), sha);
  for (const change of [
    { conclusion: 'failure' }, { status: 'in_progress' }, { workflow_id: 2 },
    { head_branch: 'feature' }, { event: 'pull_request' }, { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'attacker/fork' } },
  ]) assert.throws(() => check({ ...run, ...change }));
  assert.throws(() => check(run, true, []));
  assert.throws(() => check(run, true, [{ name: 'validate', conclusion: 'skipped' }]));
  assert.equal(check({ ...run, head_sha: 'b'.repeat(40) }, false), 'b'.repeat(40));
});

test('plan transfer binds run, attempt, source and phase, and rejects tampering before apply', async () => {
  const key = planKey({ GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: sha, PLAN_PHASE: 'prepare' });
  assert.equal(key, `plans/dev/12/2/${sha}/prepare/plan.tfplan`);
  assert.throws(() => planKey({ GITHUB_RUN_ID: '../bad', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: sha, PLAN_PHASE: 'prepare' }));
  const bytes = Buffer.from('private saved plan');
  const hash = createHash('sha256').update(bytes).digest('hex');
  let downloads = 0;
  const request = async () => { downloads += 1; return new Response(bytes); };
  await assert.rejects(downloadPlan(request, 'url', `${key}-wrong`, key, hash), /different run/);
  assert.equal(downloads, 0);
  await assert.rejects(downloadPlan(request, 'url', key, key, '0'.repeat(64)), /hash mismatch/);
  assert.deepEqual(await downloadPlan(request, 'url', key, key, hash), bytes);
});

test('Azure tokens are scoped, not command arguments, and never sent to redirects or unrelated hosts', async () => {
  const calls = [];
  const request = azureClient({
    execute: (_command, args) => {
      assert.ok(!args.includes('short-lived-token'));
      return { status: 0, stdout: JSON.stringify({ accessToken: 'short-lived-token', expires_on: Math.floor(Date.now() / 1000) + 3600 }) };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('', { status: 200 });
    },
  });
  await assert.rejects(request('https://attacker.example/token'), /unexpected endpoint/);
  assert.equal(calls.length, 0);
  await request(blobUrl('validaccount', 'tfstate', 'plans/dev/one'));
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer short-lived-token');
  assert.equal(calls[0].options.headers['x-ms-version'], '2023-11-03');
  assert.throws(() => blobUrl('bad.example', 'tfstate', 'key'));
});

const jobUrl = 'https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/jobs/job-bookit-release-dev';
test('job polling uses only the returned execution, not a previous successful one', async () => {
  const calls = [];
  await executeJob(jobUrl, {
    sleep: async () => {},
    request: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (options.method === 'POST') return Response.json({ name: 'exact-execution' });
      assert.ok(url.includes('/executions/exact-execution?'));
      return Response.json({ properties: { status: calls.length < 3 ? 'Running' : 'Succeeded' } });
    },
  });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});
test('job start LRO retains Location across subsequent 202 responses', async () => {
  const responses = [
    new Response(null, { status: 202, headers: { Location: 'https://management.azure.com/operation' } }),
    new Response(null, { status: 202 }),
    Response.json({ name: 'execution' }),
    Response.json({ properties: { status: 'Succeeded' } }),
  ];
  await executeJob(jobUrl, { sleep: async () => {}, request: async () => responses.shift() });
});
for (const status of ['Failed', 'Stopped', 'Degraded', 'Unknown']) {
  test(`database ${status} blocks rollout without retrying the job`, async () => {
    let starts = 0;
    await assert.rejects(executeJob(jobUrl, {
      sleep: async () => {},
      request: async (_url, options = {}) => {
        if (options.method === 'POST') { starts += 1; return Response.json({ name: 'execution' }); }
        return Response.json({ properties: { status } });
      },
    }), /rollout blocked/);
    assert.equal(starts, 1);
  });
}
test('database timeouts and failed starts fail explicitly', async () => {
  await assert.rejects(executeJob(jobUrl, {
    attempts: 1, sleep: async () => {},
    request: async (_url, options = {}) => options.method === 'POST'
      ? Response.json({ name: 'execution' }) : Response.json({ properties: { status: 'Running' } }),
  }), /timed out/);
  let starts = 0;
  await assert.rejects(executeJob(jobUrl, { request: async () => { starts += 1; throw new Error('HTTP 503'); } }), /HTTP 503/);
  assert.equal(starts, 1);
});
test('release inventory is deterministic, detects changed bytes, and rejects symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bookit-artifact-test-'));
  try {
    await writeFile(join(directory, 'index.html'), 'validated');
    await writeFile(join(directory, 'manifest.json'), 'not part of inventory');
    const before = await inventory(directory);
    assert.deepEqual(before.map((file) => file.path), ['index.html']);
    await writeFile(join(directory, 'index.html'), 'tampered');
    assert.notDeepEqual(await inventory(directory), before);
    await symlink(join(directory, 'index.html'), join(directory, 'link'));
    await assert.rejects(inventory(directory), /symlinks/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('frontend promotion verifies source and bytes before adding only public runtime configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bookit-promotion-test-'));
  const site = join(directory, 'site');
  const artifactScript = fileURLToPath(new URL('./release-artifact.mjs', import.meta.url));
  const configureScript = fileURLToPath(new URL('../frontend/scripts/configure.mjs', import.meta.url));
  const execute = (args, environment = {}) => spawnSync(process.execPath, args, {
    env: { ...process.env, SOURCE_SHA: sha, ...environment }, encoding: 'utf8',
  });
  try {
    await mkdir(site);
    await writeFile(join(site, 'index.html'), '<div id="root"></div>');
    await writeFile(join(site, 'app.js'), 'validated JavaScript');
    assert.equal(execute([artifactScript, 'create', directory]).status, 0);
    assert.equal(execute([artifactScript, 'verify', directory]).status, 0);
    assert.notEqual(execute([artifactScript, 'verify', directory], { SOURCE_SHA: 'b'.repeat(40) }).status, 0);
    await writeFile(join(site, 'app.js'), 'tampered JavaScript');
    assert.notEqual(execute([artifactScript, 'verify', directory]).status, 0);
    await writeFile(join(site, 'app.js'), 'validated JavaScript');
    const before = await inventory(directory);
    assert.equal(execute([configureScript, site], { API_BASE_URL: 'https://api.example.test' }).status, 0);
    const after = await inventory(directory);
    assert.deepEqual(after.filter((file) => file.path !== 'site/config.json'), before);
    assert.deepEqual(JSON.parse(await readFile(join(site, 'config.json'), 'utf8')), {
      apiBaseUrl: 'https://api.example.test',
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
