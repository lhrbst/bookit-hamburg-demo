import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { azureClient, blobUrl } from './azure.mjs';

export function planKey(environment) {
  assert.match(environment.GITHUB_RUN_ID, /^\d+$/);
  assert.match(environment.GITHUB_RUN_ATTEMPT, /^\d+$/);
  assert.match(environment.SOURCE_SHA, /^[0-9a-f]{40}$/);
  assert.ok(['prepare', 'rollout'].includes(environment.PLAN_PHASE));
  return `plans/dev/${environment.GITHUB_RUN_ID}/${environment.GITHUB_RUN_ATTEMPT}/${environment.SOURCE_SHA}/${environment.PLAN_PHASE}/plan.tfplan`;
}

export function verifyPlan(bytes, expected) {
  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'Saved plan hash mismatch; refusing apply');
}

export async function downloadPlan(request, url, key, expectedKey, hash) {
  assert.equal(key, expectedKey, 'Plan belongs to a different run, attempt, source or phase');
  const bytes = Buffer.from(await (await request(url)).arrayBuffer());
  verifyPlan(bytes, hash);
  return bytes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  await mkdir('.local', { recursive: true });
  const command = process.argv[2];
  const key = planKey(process.env);
  const url = blobUrl(process.env.TF_STATE_STORAGE_ACCOUNT, process.env.TF_STATE_CONTAINER, key);
  const request = azureClient();
  const local = '.local/deployment.tfplan';
  const log = '.local/tofu-private.log';
  const output = async (text) => appendFile(process.env.GITHUB_OUTPUT, text);
  const put = async (target, bytes) => request(target, {
    method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'If-None-Match': '*' }, body: bytes,
  });
  const tofu = async (args) => {
    const result = spawnSync('tofu', ['-chdir=infra', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    await writeFile(log, diagnostics, { mode: 0o600 });
    await put(`${url}.${command}.log`, Buffer.from(diagnostics));
    if (result.status !== 0) {
      throw new Error(`OpenTofu ${command} failed (${result.status}); private diagnostics: ${key}.${command}.log`);
    }
  };
  if (command === 'create') {
    await tofu(['plan', '-input=false', '-no-color', '-lock-timeout=5m',
      '-var-file=environments/dev.tfvars', '-var-file=../.local/dev.release.tfvars.json',
      '-out=../.local/deployment.tfplan']);
    const json = spawnSync('tofu', ['-chdir=infra', 'show', '-json', '../.local/deployment.tfplan'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (json.status !== 0) throw new Error('Cannot inspect saved plan');
    await writeFile('.local/plan.json', json.stdout, { mode: 0o600 });
    const checked = spawnSync(process.execPath, ['scripts/check-plan.mjs', '.local/plan.json'], { stdio: 'inherit' });
    if (![0, 2].includes(checked.status)) throw new Error('Saved plan policy check failed');
    const bytes = await readFile(local);
    await put(url, bytes);
    await output(`blob_key=${key}\nhash=${createHash('sha256').update(bytes).digest('hex')}\ndestructive=${checked.status === 2}\n`);
  } else if (command === 'apply') {
    const bytes = await downloadPlan(request, url, process.env.PLAN_BLOB_KEY, key, process.env.PLAN_HASH);
    await writeFile(local, bytes, { mode: 0o600 });
    await tofu(['apply', '-input=false', '-no-color', '-lock-timeout=5m', '../.local/deployment.tfplan']);
    for (const [name, value] of [['api_url', 'api_url'], ['web_url', 'web_url'], ['swa_name', 'static_web_app_name'], ['database_jobs', 'database_jobs']]) {
      const result = spawnSync('tofu', ['-chdir=infra', 'output', '-json', value], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Missing deployment output: ${name}`);
      const parsed = JSON.parse(result.stdout);
      await output(`${name}=${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}\n`);
    }
    const release = spawnSync('tofu', ['-chdir=infra', 'output', '-json', 'release_inputs'], { encoding: 'utf8' });
    if (release.status !== 0) throw new Error('Missing persisted release inputs');
    await output(`migration_image=${JSON.parse(release.stdout).migration_image}\n`);
    console.log('Saved plan applied successfully; sensitive diagnostics retained privately.');
  } else if (command === 'cleanup') {
    assert.equal(process.env.PLAN_BLOB_KEY, key, 'Unexpected plan cleanup target');
    await request(url, { method: 'DELETE', allowNotFound: true });
    if (['success', 'skipped'].includes(process.env.APPLY_RESULT)) {
      for (const suffix of ['create', 'apply']) {
        await request(`${url}.${suffix}.log`, { method: 'DELETE', allowNotFound: true });
      }
    }
    console.log('Private binary plan deleted; storage soft-delete retention still applies.');
  } else throw new Error('Expected create, apply or cleanup');
}
